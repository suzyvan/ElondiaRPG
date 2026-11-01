// 成人向的戰敗事件（data/rules/combat.json 的 defeat_event）。
//
// 1. 戰敗而且沒有人搬來救兵時，還站著的敵人裡有符合條件的（NPC 有惡人等標籤、怪物擲到發情等特徵），
//    主角做一次魅力檢定（敵人有沒有起意），成功就觸發：戰報的敘事停在對方準備動手的前一刻（narration.mode = defeat_cliffhanger）。
// 2. 玩家從三個選項選一個，或自己描述反應（主動行動 defeat_event，AI 判定時用另一套敘事規則寫出後續）。
// 3. 結果依成功程度：可能再損失一些錢、驚魂未定、五項指標的加減，敵人的類型另外加上結果（docs/LEWD_STATS.md 第 18 節）；
//    之後和一般戰敗一樣（地下城回到入口、近郊回到城門）。這場戰鬥我方高潮得越多，敵人越容易起意。
// 內容篩選關掉「主角非自願」或戰敗事件的設定關閉時不會發生；已經在等待回應時關閉，可以直接略過。
//
// 隊友的戰敗事件（設定「隊友的戰敗色情事件」，單獨開關）：主角不會遇到時（例如設定成男性形象的主角不發生），
// 改由還在場、符合設定的隊友裡魅力最高的那位遇到（無法戰鬥的隊員戰敗時已經跑開了，不算）。
// 起意的檢定、三個選項與自己描述的反應都由那位隊友擲骰（玩家直接替隊友選擇），結果的指標與狀態也記在隊友身上。

import { attrOf, mod } from './character'
import { adultScene, defeatAdultAllowed, defeatAlwaysOn, defeatCompanionAllowed } from './content'
import { characterBody } from './look'
import { combatRules, locationById, regionById, type AttrId, type Degree, type DefeatVillain } from './data'
import { applyEffects, type RewardEffect } from './effects'
import { addLewdStat } from './lewd'
import { afterDefeat } from './grid'
import { formatMoney } from './money'
import { characterFor, npcRecord } from './npcs'
import { addCondition, isNoncombatant, pcOf } from './party'
import { roll, withBonus, type Rng } from './rng'
import type { Character, GameState, LewdStat, Report, TimelineEntry } from './types'

type Foe = { name: string; npcId?: string; defId?: string; traits?: string[]; hp: number; fled?: boolean; side: string }

function rules() {
  return combatRules.defeat_event
}

/** 會起意的敵人：還站著，NPC 有指定的標籤，或怪物擲到指定的特徵（年幼的不算） */
export function defeatEventFoes(state: GameState, foes: Foe[]): Foe[] {
  const r = rules()
  return foes.filter((f) => {
    if (f.side !== 'enemy' || f.hp <= 0 || f.fled) return false
    if (f.npcId) return (npcRecord(state, f.npcId)?.tags ?? []).some((t) => r.npc_tags.includes(t))
    const traits = f.traits ?? []
    return !traits.some((t) => r.exclude_traits.includes(t)) && traits.some((t) => r.monster_traits.includes(t))
  })
}

/** 起意的 NPC 的類型：依標籤或職業，都不符合時是 default 的那一種；只有怪物時沒有 */
export function villainOf(state: GameState, foes: { npcId?: string }[]): string | undefined {
  const rec = foes.map((f) => (f.npcId ? npcRecord(state, f.npcId) : undefined)).find((r) => !!r)
  if (!rec) return undefined
  const all = Object.entries(rules().villains).filter(([k]) => !k.startsWith('$')) as [string, DefeatVillain][]
  const cls = rec.character?.class ?? rec.class ?? characterFor(state, rec).class
  return all.find(([, v]) => v.tags?.some((t) => rec.tags?.includes(t)))?.[0]
    ?? all.find(([, v]) => v.classes?.includes(cls))?.[0]
    ?? all.find(([, v]) => v.default)?.[0]
}

/**
 * 這次戰敗會被圍住的人：主角會遇到戰敗事件時是主角；不會時，是還在場、符合「隊友的戰敗色情事件」設定的隊友裡
 * 魅力最高的那位（同分時照隊伍的順序）。都沒有時 undefined（不會發生）
 */
export function defeatVictim(state: GameState): Character | undefined {
  const pc = pcOf(state)
  if (defeatAdultAllowed(characterBody(pc))) return pc
  const attr = rules().check.attr
  return state.party
    .filter((m) => !m.isPlayer && !isNoncombatant(m) && !m.status.includes('away') && defeatCompanionAllowed(characterBody(m)))
    .reduce<Character | undefined>((best, m) => (!best || attrOf(m, attr) > attrOf(best, attr) ? m : best), undefined)
}

/** 等待回應的戰敗事件被圍住的人（隊友不在隊伍裡了時當成主角） */
export function defeatVictimOf(state: GameState): Character {
  const id = state.pendingDefeat?.victim
  return (id && state.party.find((m) => m.id === id)) || pcOf(state)
}

/** 等待回應的戰敗事件現在還允許嗎（設定可能改了）：主角看主角的設定，隊友看隊友的設定 */
export function defeatEventAllowed(state: GameState): boolean {
  const who = defeatVictimOf(state)
  return who.isPlayer ? defeatAdultAllowed(characterBody(who)) : defeatCompanionAllowed(characterBody(who))
}

/** 這場戰鬥我方高潮了幾次：起意的 DC 降低（最多 climax_max） */
export function climaxDcCut(climaxes: number): number {
  const r = rules()
  return Math.min(r.climax_max, climaxes * r.climax_dc)
}

/**
 * 戰敗時擲一次：觸發時記下等待回應的事件，戰報的敘事改成停在動手前，並在時間軸加上這次檢定。
 * 呼叫端負責判斷是戰敗、沒有救兵；回傳是否觸發。
 */
export function rollDefeatEvent(state: GameState, rng: Rng, report: Report, foes: Foe[], climaxes = 0): boolean {
  const victim = defeatVictim(state)
  if (!victim) return false
  const eligible = defeatEventFoes(state, foes)
  if (!eligible.length) return false
  const r = rules()
  const mate = victim.isPlayer ? undefined : victim
  const actor = mate?.id ?? 'pc'
  const seq = (report.timeline?.length ?? 0) + 1
  if (defeatAlwaysOn()) {
    // 設定「一定發生」：不擲骰，有會起意的敵人就觸發
    report.timeline = [...(report.timeline ?? []), { seq, time: report.time.end, actor, action: `倒下之後：敵人${mate ? `對${mate.name}` : ''}起了意（設定：一定發生）`, result: 'success' }]
  } else {
    // 刻意不加熟練加值：這不是技能檢定，而是看外表與氣質能不能引起敵人的興趣
    const dice = withBonus('1d20', mod(attrOf(victim, r.check.attr)))
    const res = roll(rng, dice)
    const dc = r.check.dc - climaxDcCut(climaxes)
    const hit = res.total >= dc
    const entry: TimelineEntry = {
      seq, time: report.time.end, actor,
      // 魅力越高越容易引起敵人的興趣：總值達到 DC 時觸發
      action: hit ? `倒下之後：${mate ? `${mate.name}的` : ''}魅力引起了敵人的興趣` : `倒下之後：敵人沒有${mate ? `對${mate.name}` : ''}起意（魅力）`,
      roll: { dice, value: res.total, dc }, result: hit ? 'success' : 'fail',
    }
    report.timeline = [...(report.timeline ?? []), entry]
    if (!hit) return false
  }
  const names = eligible.map((f) => f.name)
  const villain = villainOf(state, eligible)
  const willing = report.outcome.tags?.includes('主動認輸')
  state.pendingDefeat = {
    foes: eligible.map((f) => ({ name: f.name, ...(f.npcId ? { npc: f.npcId } : f.defId ? { monster: f.defId } : {}) })),
    location: report.location.at, scene: report.location.scene ?? locationById(report.location.at).name, report: report.report_id,
    ...(villain ? { villain } : {}),
    ...(willing ? { willing } : {}),
    ...(mate ? { victim: mate.id } : {}),
  }
  report.narration = {
    ...report.narration, mode: 'defeat_cliffhanger',
    focus: [...(report.narration?.focus ?? []), mate
      ? `${names.join('、')}圍上${willing ? '放棄抵抗' : '倒地'}的${mate.name}，準備動手；主角也倒在一旁，無力介入`
      : `${names.join('、')}圍上${willing ? '放棄抵抗' : '倒地'}的主角，準備動手`],
    ...(mate ? { defeat_victim: mate.id } : {}),
  }
  report.outcome.summary = `${report.outcome.summary ?? ''}${mate ? `${names.join('、')}圍住了倒地的${mate.name}，眼神不懷好意……` : `${names.join('、')}圍了上來，看向你的眼神不懷好意……`}`
  report.outcome.tags = [...(report.outcome.tags ?? []), '戰敗事件']
  return true
}

/** 主動行動 defeat_event 的 target：opt:0～2 是三個選項，free 是自己描述 */
export function defeatOption(target?: string): { label: string; attr?: AttrId; dc: number } {
  const r = rules()
  const m = /^opt:(\d)$/.exec(target ?? '')
  const o = m ? r.options[Number(m[1])] : undefined
  return o ?? { label: '自己的反應', dc: r.free_dc }
}

export function setupDefeatEvent(state: GameState, target?: string) {
  const ev = state.pendingDefeat
  if (!ev) throw new Error('現在沒有需要回應的處境')
  const o = defeatOption(target)
  const r = rules()
  const v = ev.villain ? r.villains[ev.villain] : undefined
  const victim = defeatVictimOf(state)
  const mate = victim.isPlayer ? undefined : victim
  const foes = ev.foes.map((f) => f.name).join('、')
  const ratio = (d: Degree) => (r.money_loss[d] ?? 0) + (v?.money?.[d] ?? 0)
  const loss = (d: Degree) => (ratio(d) ? `，再損失 ${Math.round(ratio(d) * 100)}% 的錢` : '')
  const shaken = (d: Degree) => (r.shaken_on.includes(d) ? `，${mate ? mate.name : ''}驚魂未定（下次長休前檢定 -1）` : '')
  return {
    // 沒能脫身時是這段遭遇（部分成功時由 AI 決定代價是否包含）
    ...adultScene(`戰敗後${mate ? mate.name : ''}落入${foes}手中`, ['fail', 'fumble']),
    // 隊友被圍住：由那位隊友擲骰（屬性調整值是隊友的）
    ...(mate ? { actor: mate.id } : {}),
    dc: o.dc, ...(o.attr ? { attr: o.attr } : {}), situational: [],
    targetName: foes,
    scene: mate
      ? `${ev.scene}・戰敗後隊友${mate.name}被${foes}圍住（${mate.name}的反應：${o.label}）；主角也倒在一旁，無力介入${ev.willing ? '；隊伍是主動放棄抵抗、認輸的' : ''}${v ? `；對方是${v.name}的人：${v.hint.split('主角').join(mate.name)}` : ''}`
      : `${ev.scene}・戰敗後被${foes}圍住（${o.label}）${ev.willing ? '；主角是自己放棄抵抗、主動認輸的' : ''}${v ? `；對方是${v.name}的人：${v.hint}` : ''}`,
    outcomes: Object.fromEntries((['critical', 'success', 'partial', 'fail', 'fumble'] as Degree[]).map((d) => [d, {
      critical: '找到破綻全身而退', success: '設法脫身', partial: '勉強脫身', fail: '沒能擺脫', fumble: '吃了大虧',
    }[d] + loss(d) + shaken(d)])) as Partial<Record<Degree, string>>,
  }
}

/** 結算回應：依成功程度損失金錢、驚魂未定，然後和一般戰敗一樣離開 */
export function applyDefeatResponse(state: GameState, report: Report, degree: Degree): string {
  const ev = state.pendingDefeat
  if (!ev) return ''
  const r = rules()
  const who = defeatVictimOf(state)
  const mate = who.isPlayer ? undefined : who
  const v = ev.villain ? r.villains[ev.villain] : undefined
  const lost = Math.floor(state.money_cc * ((r.money_loss[degree] ?? 0) + (v?.money?.[degree] ?? 0)))
  if (lost > 0) applyEffects(state, report, [{ type: 'money', amount: -lost }])
  if (r.shaken_on.includes(degree)) addCondition(who, 'shaken', report)
  // 五項指標（成人向）與敵人的類型另外的結果：記在被圍住的人身上
  for (const [k, d] of Object.entries(r.lewd[degree] ?? {})) if (d) addLewdStat(who, k as LewdStat, d, report)
  const extra = ((v?.effects?.[degree] ?? []) as RewardEffect[]).map((e) => (mate ? retarget(e, mate.id) : e))
  if (extra.length) applyEffects(state, report, extra)
  report.kind = 'event'
  // 隊友：親密場景的主角是那位隊友（淫亂的成長記在隊友身上）
  report.narration = { ...report.narration, mode: 'defeat_event', length: 'medium', ...(mate ? { defeat_victim: mate.id, adult_actor: mate.id } : {}) }
  report.lore_keys = [...new Set([...(report.lore_keys ?? []), ...ev.foes.map((f) => f.name), regionById(locationById(ev.location).region).name])]
  // 圍上來的怪物記在報告的其他人裡（敘事附上怪物的外觀，魔物娘的設定也照這裡）
  const monsters = ev.foes.filter((f) => f.monster && !(report.others ?? []).some((o) => o.monster === f.monster && o.name === f.name))
  if (monsters.length) report.others = [...(report.others ?? []), ...monsters.map((f, i) => ({ id: `defeat-foe-${i + 1}`, name: f.name, monster: f.monster! }))]
  delete state.pendingDefeat
  afterDefeat(state)
  return lost > 0 ? `被搜走了 ${formatMoney(lost)}。` : ''
}

/** 敵人的類型的結果原本寫給主角（target: pc、沒寫對象的指標）：換成被圍住的隊友 */
function retarget(e: RewardEffect, id: string): RewardEffect {
  if (e.type === 'condition' && e.target === 'pc') return { ...e, target: id }
  if (e.type === 'lewd' && (!e.target || e.target === 'pc')) return { ...e, target: id }
  if (e.type === 'hp' && e.target === 'pc') return { ...e, target: id }
  return e
}

/** 戰敗事件不再允許時（內容篩選、戰敗事件的設定），等待中的事件直接略過（和一般戰敗一樣離開） */
export function skipDefeatEvent(state: GameState) {
  if (!state.pendingDefeat) return
  delete state.pendingDefeat
  afterDefeat(state)
}
