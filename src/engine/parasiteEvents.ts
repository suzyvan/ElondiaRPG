// 寄生物的發作、主動觸發、解咒與紋回來（docs/ADULT_EVENTS.md 第 6 節）。
// - 發作：走動每一步、旅途每天、長休之後依機率（parasites.json，乘上存檔規則「寄生發作的機率」與階段的倍率），
//   兩次至少隔 cooldown_hours 小時；模板是 travel_events.json 的 templates（scope: parasite，parasite 寄生物、stages 階段、moments 時機）。
// - 發作事件發生在主角身上，主角自己擲骰回應（和地下城事件一樣）；選項的結果通常是侵蝕度加減。
// - 已馴服的寄生物不會自己發作，可以在寄生物面板主動觸發（每次長休之間一次），得到 tamed.buff 狀態。
// - 解咒：神殿（信仰）或刻印師（智力），擲骰對 DC（侵蝕度越高越難、越貴）；成功拿掉寄生物並中止它的任務線
//   （紀錄與旗標清掉，之後再被寄生可以重來），失敗侵蝕度上升。
// - 紋回來：刻印師把記下來的淫紋（被奴隸印記頂掉、或馴服後洗掉）與被淫紋蓋掉的刺青紋回去。

import { attrOf, mod, proficiency, recalc } from './character'
import { pcBodyAllowed, tagsAllowed } from './content'
import { syncGear } from './gear'
import { classes } from './data'
import { gameRule } from './gameRules'
import { pcEventReport, resolvePcOption } from './dungeonEvents'
import { characterBody } from './look'
import { formatMoney } from './money'
import {
  activeParasites, changeCorruption, detachParasite, growParasites, parasiteDef, parasiteOf, parasiteRules, parasitesOf,
  reinkable, reinkTattoo, removalTerms, stageOf,
} from './parasites'
import { addCondition, pcOf, setHp } from './party'
import { checkModifiers, modifierNote } from './perks'
import { applyPendingMove, travelEvents, type RoadTemplate } from './road'
import { roll as diceRoll, withBonus } from './rng'
import { abandonStory } from './story'
import { commitReport, withRng } from './state'
import { condMet, flagKey } from './storyFlags'
import { shopRefusal, tattooShopHere } from './tattooShop'
import { baseReport } from './town'
import type { GameState, GameTime, ParasiteState, Report } from './types'

/** 發作的時機：走動一步（城鎮、地下城、近郊、臨時地圖）、旅途的一天、長休之後 */
export type ParasiteTrigger = 'step' | 'travel' | 'rest'

const hoursOf = (t: GameTime) => t.day * 24 + (t.hour ?? 0) + (t.minute ?? 0) / 60
const TAG = '寄生物'

export function parasiteTemplates(): RoadTemplate[] {
  return travelEvents.templates.filter((t) => t.scope === 'parasite')
}

/** 這個寄生物、這個階段、這個時機能出現的發作事件 */
export function parasiteCandidates(state: GameState, p: ParasiteState, trigger: ParasiteTrigger): RoadTemplate[] {
  const stage = stageOf(p.corruption)
  const body = characterBody(pcOf(state))
  return parasiteTemplates().filter((t) =>
    t.parasite === p.id
    && (!t.stages?.length || t.stages.includes(stage))
    && (!t.moments?.length || t.moments.includes(trigger))
    && tagsAllowed(t.tags)
    && pcBodyAllowed(t.pc_body, body)
    && condMet(state, t.requires))
}

/**
 * 這個寄生物還能不能發作：存檔規則「寄生發作的機率」不是 0、而且至少有一件發作事件沒有被內容篩選擋掉
 * （例如關掉「主角非自願」）。不能發作時就像詛咒：被動效果還在，但侵蝕度不增長。
 */
export function flaresOn(state: GameState, p: ParasiteState): boolean {
  if (gameRule(state, 'parasiteMult') <= 0) return false
  const body = characterBody(pcOf(state))
  return parasiteTemplates().some((t) => t.parasite === p.id && tagsAllowed(t.tags) && pcBodyAllowed(t.pc_body, body))
}

/** 有別的事情等著處理的時候不發作 */
function busy(state: GameState): boolean {
  return !!(state.parasiteEvent || state.dungeonEvent || state.townEvent || state.roadEvent || state.combat || state.standoff
    || state.pendingMasterEvent || state.pendingAction || state.pendingMark)
}

/**
 * 依時機擲發作：先依時間增長侵蝕度（不能發作的不增長），冷卻過了，每個會發作的寄生物各擲一次（機率 × 存檔規則 × 階段倍率），
 * 中了就從候選裡挑一件（避開最近發作過的）。回傳有沒有開始事件。
 */
export function maybeParasiteEvent(state: GameState, trigger: ParasiteTrigger): boolean {
  const pc = pcOf(state)
  if (!parasitesOf(pc).length) return false
  // 發作關掉時也要把日子往前推（不增長），之後恢復才不會一次補上
  growParasites(pc, state.time, (p) => !flaresOn(state, p))
  if (busy(state)) return false
  const now = hoursOf(state.time)
  const log = state.parasiteEvents
  if (log?.last !== undefined && now - log.last < parasiteRules.cooldown_hours) return false
  const base = (parasiteRules[`${trigger}_chance`] ?? 0) * gameRule(state, 'parasiteMult')
  if (base <= 0) return false
  const recent = log?.recent ?? []
  for (const p of activeParasites(pc)) {
    const list = parasiteCandidates(state, p, trigger)
    if (!list.length) continue
    const chance = Math.min(1, base * (parasiteRules.stages[stageOf(p.corruption)]?.chance_mult ?? 1))
    const fresh = list.filter((t) => !recent.includes(t.id))
    const pick = withRng(state, (rng) => (rng.chance(chance) ? rng.pick(fresh.length ? fresh : list) : undefined))
    if (!pick) continue
    const next = (state.parasiteEvents ??= {})
    next.last = now
    next.recent = [pick.id, ...recent.filter((x) => x !== pick.id)].slice(0, 3)
    state.parasiteEvent = { template: pick.id, parasite: p.id }
    return true
  }
  return false
}

/** 等待回應的發作事件 */
export function pendingParasiteEvent(state: GameState): RoadTemplate | undefined {
  const id = state.parasiteEvent?.template
  return id ? parasiteTemplates().find((t) => t.id === id) : undefined
}

/** 自訂內容拿掉的事件、或寄生物已經不在：等待中的發作作廢（讀檔時，以及自訂內容改變之後） */
export function pruneParasiteEvent(state: GameState) {
  const ev = state.parasiteEvent
  if (ev && (!pendingParasiteEvent(state) || !parasiteOf(pcOf(state), ev.parasite))) delete state.parasiteEvent
}

/** 回應發作：選項的檢定由主角擲骰 */
export function answerParasiteEvent(state: GameState, index: number): Report {
  const t = pendingParasiteEvent(state)
  const o = t?.options?.[index]
  if (!t || !o) throw new Error('沒有這個選項')
  const report = pcEventReport(state, t.title, TAG)
  resolvePcOption(state, report, t, o, TAG)
  delete state.parasiteEvent
  const committed = commitReport(state, report)
  applyPendingMove(state)
  return committed
}

// ---- 已馴服：主動觸發 ----

/** 不能主動觸發的原因（可以時為 undefined） */
export function triggerBlock(state: GameState, id: string): string | undefined {
  const p = parasiteOf(pcOf(state), id)
  const def = parasiteDef(id)
  if (!p || !def?.tamed) return '沒有這個寄生物'
  if (!p.tamed) return '還沒有馴服'
  if (p.dormant || p.stored) return '印記不在身上'
  if (busy(state) || state.road && !state.side) return '現在不是時候'
  const rest = state.lastLongRest
  if (p.triggered && (!rest || hoursOf(rest) <= hoursOf(p.triggered))) return '長休之後才能再一次'
  return undefined
}

/** 主動觸發已馴服的寄生物：親密場景（tamed.scene）與狀態（tamed.buff） */
export function triggerTamed(state: GameState, id: string): Report {
  const block = triggerBlock(state, id)
  if (block) throw new Error(block)
  const pc = pcOf(state)
  const p = parasiteOf(pc, id)!
  const tamed = parasiteDef(id)!.tamed!
  const report = pcEventReport(state, parasiteDef(id)!.name, TAG)
  p.triggered = { ...state.time }
  if (tamed.buff) addCondition(pc, tamed.buff, report)
  report.outcome = { result: 'neutral', summary: tamed.text, tags: [TAG] }
  report.narration = { ...report.narration, length: 'medium', focus: [tamed.text], adult_scene: tamed.scene }
  return commitReport(state, report)
}

// ---- 解咒與紋回來 ----

/** 解咒的地方：站在神殿或刻印師 */
export function curePlace(state: GameState): 'temple' | 'carver' | undefined {
  const shop = tattooShopHere(state)
  return shop === 'temple' || shop === 'carver' ? shop : undefined
}

/** 這裡能解的寄生物：條件與價錢 */
export function cureOffers(state: GameState): { id: string; name: string; dc: number; price: number; attr: string }[] {
  const place = curePlace(state)
  if (!place) return []
  const attr = parasiteRules.remove[place].attr
  return parasitesOf(pcOf(state)).flatMap((p) => {
    const terms = removalTerms(p)
    const def = parasiteDef(p.id)
    return terms && def ? [{ id: p.id, name: def.name, ...terms, attr }] : []
  })
}

/** 解咒：付錢、擲骰；成功拿掉寄生物（中止它的任務線），失敗侵蝕度上升 */
export function cureParasite(state: GameState, id: string): Report {
  const place = curePlace(state)
  if (!place) throw new Error('這裡不能解咒')
  const refused = place === 'temple' ? shopRefusal(state, 'temple') : undefined
  if (refused) throw new Error(refused)
  const pc = pcOf(state)
  const p = parasiteOf(pc, id)
  const def = parasiteDef(id)
  const terms = p && removalTerms(p)
  if (!p || !def || !terms) throw new Error('這個寄生物解不了')
  if (state.money_cc < terms.price) throw new Error(`錢不夠（要 ${formatMoney(terms.price)}）`)
  const rule = parasiteRules.remove[place]
  const report = baseReport(state, 'trade', 2)
  report.location.scene = rule.name
  report.changes.money_cc = -terms.price
  const extra = checkModifiers(pc, { context: 'action', attr: rule.attr })
  const dice = withBonus('1d20', mod(attrOf(pc, rule.attr)) + proficiency(pc.level) + extra.reduce((s, x) => s + x.value, 0))
  const r = withRng(state, (rng) => diceRoll(rng, dice))
  const natural = r.rolls[0] ?? r.total
  const ok = natural === 20 || (natural !== 1 && r.total >= terms.dc)
  report.timeline = [{ seq: 1, time: { ...state.time }, actor: 'pc', action: `${rule.name}：${def.name}${modifierNote(extra)}`, roll: { dice, value: r.total, dc: terms.dc }, result: ok ? 'success' : 'fail' }]
  const lines = [`花了 ${formatMoney(terms.price)} 請人解咒（${def.name}）。`]
  if (ok) {
    lines.push(`${detachParasite(pc, id)}。`)
    syncGear(pc, classes[pc.class]?.weapon)
    recalc(pc)
    setHp(state, pc, pc.hp, report)
  } else {
    const note = changeCorruption(pc, id, 5)
    lines.push(`解咒失敗了，${def.name}反撲${note ? `：${note}` : ''}。`)
  }
  report.outcome = { result: ok ? 'success' : 'failure', summary: lines.join(''), tags: [TAG] }
  report.narration = { pov: 'second_person', length: 'short', focus: [`${rule.name}的過程`, def.desc] }
  const committed = commitReport(state, report)
  // 寄生物沒了，它的任務線也跟著結束；紀錄與旗標清掉，之後再被寄生可以重來
  if (ok) {
    for (const sid of def.stories ?? []) if (state.stories?.[sid]?.status === 'active') abandonStory(state, sid, `${def.name}已經解咒`)
    for (const sid of def.stories ?? []) if (state.stories?.[sid]) delete state.stories[sid]
    const prefix = def.flag_prefix && flagKey(def.flag_prefix)
    if (prefix) for (const k of Object.keys(state.flags)) if (k.startsWith(prefix)) delete state.flags[k]
  }
  return committed
}

/** 刻印師紋回來的清單 */
export function reinkOffers(state: GameState) {
  return tattooShopHere(state) === 'carver' ? reinkable(pcOf(state)) : []
}

/** 刻印師紋回來 */
export function reinkAtCarver(state: GameState, parasite: string, kind: 'curse' | 'covered'): Report {
  if (tattooShopHere(state) !== 'carver') throw new Error('要到刻印師那裡')
  const offer = reinkOffers(state).find((o) => o.parasite === parasite && o.kind === kind)
  if (!offer) throw new Error('沒有可以紋回來的印記')
  if (state.money_cc < offer.price) throw new Error(`錢不夠（要 ${formatMoney(offer.price)}）`)
  const pc = pcOf(state)
  const report = baseReport(state, 'trade', 4)
  report.location.scene = '刻印師'
  const line = reinkTattoo(pc, parasite, kind, state.time)
  report.changes.money_cc = -offer.price
  report.changes.tattoos = [{ actor: 'pc', place: offer.tattoo.place, kind: offer.tattoo.kind, name: offer.tattoo.name ?? '', added: true }]
  recalc(pc)
  setHp(state, pc, pc.hp, report)
  report.outcome = { result: 'neutral', summary: `${line}，花了 ${formatMoney(offer.price)}。`, tags: [TAG] }
  report.narration = { pov: 'second_person', length: 'short', focus: ['刻印的過程與感覺', offer.tattoo.desc ?? ''] }
  return commitReport(state, report)
}
