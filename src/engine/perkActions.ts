// 特質的主動行動（見 docs/PERKS.md）：
// - train：在公會、神殿、酒館等設施，或向身邊的老師（固定 NPC 的 mentor）花錢花時間受訓；成功時得到一次學這個特質的機會（也可以改寫說法交給 AI）。
//   身上的缺陷有 train 時，受訓是克服它：成功就拿掉這個缺陷。
//   受訓的人可以是主角或自己的夥伴（target = 特質 id，夥伴時接 @<id>）：能學什麼、等級門檻、檢定都看那個人；學費從隊伍的錢付。
// - perk_pitch：在取得特質的機會上（升級、事件、特殊任務、訓練、物品），不選提供的特質，寫一段說法擲骰交給 AI；
//   AI 依說法合不合理決定成功程度並設計特質（perk 欄位），程式依成功程度把強度夾在提供的特質附近。只有這些場合可以用。

import { locationById, npcs as namedNpcs, perkDef, perkRules, type Degree, type PerkDef } from './data'
import { cellName, currentArea, currentCell } from './grid'
import { closedHere } from './landmarks'
import { formatMoney } from './money'
import { pcOf, trainees } from './party'
import { guildClerkId, npcRecord } from './npcs'
import { shopKey, shopTypeForCell } from './trade'
import { presentHere } from './population'
import { snapshot } from './character'
import {
  dropOffer, grantPerk, learnablePerks, losePerk, offerPerks, overcomablePerks, parsePitchTarget, perkPower, pitchCap, sanitizePerk, takeOffer, trainablePerks, trainDays, trainingFee, trainSpec, type TrainSpec,
} from './perks'
import { addHours, commitReport, newReportId } from './state'
import type { Character, GameState, PerkOffer, Report } from './types'

function memberOf(state: GameState, id: string): Character {
  const m = state.party.find((x) => x.id === id)
  if (!m) throw new Error('隊伍中沒有這位角色')
  return m
}

// ---- 訓練 ----

/** 可以受訓的一項：在這個設施，或向身邊的老師（mentor）；blocked 是還不能學的原因（例如好感、等級不夠） */
export interface TrainOption { def: PerkDef; train: TrainSpec; mentor?: { id: string; name: string }; blocked?: string }

/**
 * 這一格的負責人和主角的親密度（受訓的親密度門檻）：商店看店主、公會看公會職員、地標看待在那裡的固定 NPC。
 * 沒有負責人的設施（例如神殿以外沒有人顧的地方）是 undefined，不看親密度
 */
function keeperHere(state: GameState, cell: string): { name: string; affinity: number } | undefined {
  const who = (id: string | undefined, fallback: string) => ({ name: (id && npcRecord(state, id)?.name) || fallback, affinity: (id && state.relationships?.[id]?.affinity) || 0 })
  if (cell === 'guild') return who(guildClerkId(state.location), '公會職員')
  const type = shopTypeForCell(cell)
  if (type) return who(state.shops?.[shopKey(state, type)]?.keeper, '店主')
  const host = namedNpcs.find((n) => n.landmark === cell)
  return host ? who(host.id, host.name) : undefined
}

/** 強的特質的門檻（perks.json 的 training.gates）：角色等級、老師或店主的親密度 */
function gateBlock(level: number, t: TrainSpec, who?: { name: string; affinity: number }): string | undefined {
  if (t.level && level < t.level) return `要角色 Lv.${t.level} 才學得來`
  if (t.affinity && who && who.affinity < t.affinity) return `和${who.name}的親密度要 ${t.affinity} 才肯教`
  return undefined
}

/**
 * 現在可以受訓的特質：這一格的設施（克服缺陷排前面），加上身邊的老師會教的（docs/LEWD_STATS.md 第 6.1 節）。
 * 學費、時數、DC 照特質強度算（trainSpec）；同一個特質設施和老師都能學時，用老師的（比較便宜、比較簡單）；
 * 好感、等級不夠時照樣列出、標上原因
 */
/** 可以受訓的人（學特質、克服缺陷、學工藝都一樣；party.ts） */
export { trainees }

/** 受訓的人（沒指定時是主角） */
function traineeOf(state: GameState, memberId?: string): Character {
  if (!memberId) return pcOf(state)
  const m = trainees(state).find((x) => x.id === memberId)
  if (!m) throw new Error('這個人不能在這裡受訓')
  return m
}

/** target：特質 id，夥伴受訓時接 @<夥伴 id> */
export function parseTrainTarget(target?: string): { perk?: string; member?: string } {
  const [perk, member] = (target ?? '').split('@')
  return { ...(perk ? { perk } : {}), ...(member ? { member } : {}) }
}

export function trainOptions(state: GameState, memberId?: string): TrainOption[] {
  const pc = traineeOf(state, memberId)
  const cell = currentCell(state).kind
  const keeper = keeperHere(state, cell)
  const out: TrainOption[] = closedHere(state) ? [] : [...overcomablePerks(pc, cell), ...trainablePerks(pc, cell)].map((def) => {
    const train = trainSpec(def)
    const blocked = gateBlock(pc.level, train, keeper)
    return { def, train, ...(blocked ? { blocked } : {}) }
  })
  const learnable = new Map(learnablePerks(pc).map((p) => [p.id, p]))
  const r = perkRules.mentor
  for (const n of namedNpcs) {
    if (!n.mentor?.perks.length || n.id === pc.id || !presentHere(state, n.id)) continue
    const need = n.mentor.affinity ?? r.affinity
    const affinity = state.party.find((m) => m.id === n.id)?.affinity ?? state.relationships?.[n.id]?.affinity ?? 0
    for (const id of n.mentor.perks) {
      const def = learnable.get(id)
      if (!def) continue
      const spec = trainSpec(def, def.train ?? { ...r.default_train, cells: [] })
      const train: TrainSpec = {
        ...spec,
        price_cc: Math.round(spec.price_cc * (n.mentor.price_mult ?? r.price_mult)),
        dc: Math.max(5, spec.dc + r.dc_delta),
      }
      const blocked = affinity < need ? `和${n.name}再熟一點才肯教（好感要 ${need}）` : gateBlock(pc.level, train, { name: n.name, affinity })
      const opt: TrainOption = { def, train, mentor: { id: n.id, name: n.name }, ...(blocked ? { blocked } : {}) }
      const i = out.findIndex((o) => o.def.id === id)
      if (i < 0) out.push(opt)
      else if (!opt.blocked && (out[i]!.blocked || out[i]!.train.price_cc > train.price_cc)) out[i] = opt
    }
  }
  return out
}

function trainDef(state: GameState, target?: string) {
  const { perk: perkId, member } = parseTrainTarget(target)
  const who = traineeOf(state, member)
  const opt = trainOptions(state, member).find((o) => o.def.id === perkId)
  if (!opt) {
    const closed = closedHere(state)
    if (closed) throw new Error(closed)
    throw new Error(perkId && perkDef(perkId)?.flaw ? '這裡沒辦法克服這個缺陷' : '這裡學不到這個特質')
  }
  if (opt.blocked) throw new Error(opt.blocked)
  return { ...opt, who, cell: currentCell(state).kind }
}

export function setupTrain(state: GameState, target?: string) {
  const { def, train, cell, mentor, who } = trainDef(state, target)
  if (state.money_cc < train.price_cc) throw new Error(`錢不夠（受訓要 ${formatMoney(train.price_cc)}）`)
  const by = who.isPlayer ? '' : `${who.name}`
  const fee = (d: Degree) => formatMoney(trainingFee(train.price_cc, d))
  const where = mentor ? `跟著${mentor.name}` : `${locationById(state.location).name}的${cellName(cell)}`
  // 每天練 session_hours 小時，練完要幾天（中間照常吃睡）
  const { days, elapsed } = trainDays(train.hours)
  return {
    attr: train.attr, dc: train.dc, hours: elapsed, situational: [],
    ...(who.isPlayer ? {} : { actor: who.id }),
    scene: `${where}・${by}${def.flaw ? `克服缺陷【${def.name}】` : `學習特質【${def.name}】`}（練 ${train.hours} 小時${days > 1 ? `，分 ${days} 天` : ''}）`,
    outcomes: def.flaw ? {
      critical: `克服了缺陷（學費打對折：${fee('critical')}）`, success: `克服了缺陷（學費 ${fee('success')}）`, partial: `克服了缺陷（學費 ${fee('partial')}）`,
      fail: `還是改不掉（學費收一半：${fee('fail')}）`, fumble: `還是改不掉（學費照收：${fee('fumble')}）`,
    } as Partial<Record<Degree, string>> : {
      critical: `學會的機會（學費打對折：${fee('critical')}）`, success: `學會的機會（學費 ${fee('success')}）`, partial: `學會的機會（學費 ${fee('partial')}）`,
      fail: `沒學會（學費收一半：${fee('fail')}）`, fumble: `沒學會（學費照收：${fee('fumble')}）`,
    } as Partial<Record<Degree, string>>,
  }
}

export function applyTrain(state: GameState, report: Report, target: string, degree: Degree): string {
  const { def, train, mentor, who } = trainDef(state, target)
  const fee = Math.min(state.money_cc, trainingFee(train.price_cc, degree))
  report.changes.money_cc = (report.changes.money_cc ?? 0) - fee
  const by = who.isPlayer ? '' : who.name
  if (def.flaw) {
    if (degree === 'fail' || degree === 'fumble') return `花了 ${formatMoney(fee)}，${by}【${def.name}】的毛病還是改不掉。`
    losePerk(who, def.id, report)
    return `花了 ${formatMoney(fee)}，${by}克服了缺陷【${def.name}】。`
  }
  if (degree === 'fail' || degree === 'fumble') return `花了 ${formatMoney(fee)}，${by}還是沒抓到【${def.name}】的訣竅。`
  // 學會的機會：可以直接學，也可以改寫說法交給 AI
  offerPerks(who, mentor ? `跟著${mentor.name}受訓` : `在${currentArea(state).name}受訓`, [def.id])
  return `花了 ${formatMoney(fee)}，${by}${mentor ? `在${mentor.name}的指導下` : ''}掌握了【${def.name}】的訣竅（在事件視窗選擇學會）。`
}

// ---- 說法 ----

function pitchOffer(state: GameState, target?: string): { member: Character; offer: PerkOffer } {
  const { member, offer } = parsePitchTarget(target)
  const m = memberOf(state, member)
  const o = m.perkOffers?.find((x) => x.id === offer)
  if (!o) throw new Error('沒有這個取得特質的機會')
  if (!o.pitch) throw new Error('這次機會只能從提供的特質選')
  if (o.pitched) throw new Error('這次機會已經試過說法了，只能從提供的特質選')
  return { member: m, offer: o }
}

export function setupPitch(state: GameState, target?: string) {
  const { member, offer } = pitchOffer(state, target)
  const p = perkRules.pitch
  const names = offer.options.map((id) => perkDef(id)?.name ?? id).join('、')
  return {
    attr: p.attr, dc: p.dc, hours: p.hours, situational: [],
    ...(member.isPlayer ? {} : { actor: member.id }),
    scene: `${offer.source}・爭取一個特質（提供的是：${names || '無'}）`,
    outcomes: {
      critical: '照說法設計特質，可以比提供的稍強', success: '照說法設計特質，和提供的一樣強', partial: '照說法設計特質，但比提供的弱一點',
      fail: '說法不被採用，只能從提供的特質選', fumble: '說法不被採用，只能從提供的特質選',
    } as Partial<Record<Degree, string>>,
  }
}

/** 套用說法：成功程度決定強度上限；AI 沒有設計特質時不採用 */
export function applyPitch(state: GameState, report: Report, target: string, degree: Degree, raw: unknown): string {
  const { member, offer } = pitchOffer(state, target)
  const delta = perkRules.pitch.power_delta[degree]
  if (delta === undefined) {
    offer.pitched = true
    return `說法沒有被採用，只能從提供的特質選${offer.options.length ? '' : '（沒有可以選的，這次機會作廢）'}。`
  }
  const cap = pitchCap(offer, delta)
  const def = sanitizePerk(raw, `c-${state.nextReportNo}-${member.id}`, cap)
  if (!def) return '沒有設計出特質（需要 AI 判定），這次機會保留，可以從提供的特質選。'
  grantPerk(member, def, report)
  member.perkOffers = (member.perkOffers ?? []).filter((o) => o.id !== offer.id)
  return `${member.name}學會了特質【${def.name}】：${def.desc}（強度 ${perkPower(def)}／上限 ${cap}）`
}

/** 沒有可以選、也不能再試說法的機會：拿掉 */
export function pruneOffers(c: Character) {
  c.perkOffers = (c.perkOffers ?? []).filter((o) => o.options.length || (o.pitch && !o.pitched))
}

// ---- 從機會選一個、放棄 ----

function perkReport(state: GameState, hours: number): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1', report_id: newReportId(state), kind: 'event',
    time: { start, end: addHours(start, hours) },
    location: { at: loc.id, region: loc.region, scene: currentArea(state).name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'success', tags: ['特質'] },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name],
  }
}

/** 從機會裡選一個特質學會（記一則日誌） */
export function learnFromOffer(state: GameState, memberId: string, offerId: string, perkId: string): Report {
  const m = memberOf(state, memberId)
  const source = m.perkOffers?.find((o) => o.id === offerId)?.source ?? ''
  const report = perkReport(state, 0)
  const def = takeOffer(m, offerId, perkId, report)
  report.outcome.summary = `${m.name}${source ? `（${source}）` : ''}學會了特質【${def.name}】：${def.desc}`
  report.narration = { pov: 'second_person', length: 'short', focus: [`${m.name}學會【${def.name}】的契機`] }
  return commitReport(state, report)
}

/** 放棄這次機會 */
export function declineOffer(state: GameState, memberId: string, offerId: string) {
  dropOffer(memberOf(state, memberId), offerId)
}
