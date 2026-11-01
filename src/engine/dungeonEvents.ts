// 地下城與近郊的事件（docs/ADULT_EVENTS.md）：觸發陷阱、打開寶箱、採集、在安全房長休之後，依機率遇到一件事。
// - 模板和旅途、城鎮事件共用（travel_events.json 的 templates，scope: dungeon），依觸發點、地點、地區、層數、內容標籤、主角體型篩選。
// - 機率與冷卻在 travel_events.json 的 dungeon；同一個事件隔 repeat_days 天（或 cooldown_days）才會再出現。
// - 目前的內建模板都是成人向（色情陷阱、擬態寶箱、花粉、觸手植物、夜襲……），內容篩選關掉「主角非自願」時，非自願的事件不會發生。
// - 事件發生在主角身上：選項的檢定由主角自己擲（不是隊伍裡最擅長的人）。

import { gameRule } from './gameRules'
import { attrOf, mod, proficiency, snapshot } from './character'
import { pcBodyAllowed, tagsAllowed } from './content'
import { locationById, regionById } from './data'
import { currentArea, type Area } from './grid'
import { characterBody } from './look'
import { pcOf } from './party'
import { parasiteOf, parasiteRules, stageOf } from './parasites'
import { checkModifiers, modifierNote } from './perks'
import { applyPendingMove, applyRoadOutcome, sceneOn, travelEvents, type DungeonTrigger, type RoadOption, type RoadTemplate } from './road'
import { commitReport, newReportId, withRng } from './state'
import { condMet } from './storyFlags'
import type { GameState, GameTime, Report } from './types'
import { roll as diceRoll, withBonus } from './rng'

const hoursOf = (t: GameTime) => t.day * 24 + (t.hour ?? 0) + (t.minute ?? 0) / 60

/** 事件選項寫的 DC 以這個為「普通」：14 以下比較容易、以上比較難（相對於這裡的難度） */
export const EVENT_DC_REF = 14
export const DEFAULT_LAYER_DC = [11, 13, 14, 16, 18]

/** 這件事普通難度的 DC：地下城事件依層，寄生物的發作依主角等級與階段；其他事件就是 14 */
export function eventBaseDc(state: GameState, t: Pick<RoadTemplate, 'scope' | 'parasite'>): number {
  if (t.scope === 'dungeon') {
    const area = currentArea(state)
    const layer = layerOf(area) ?? 0
    const table = travelEvents.dungeon?.dc ?? DEFAULT_LAYER_DC
    return table[Math.min(layer, table.length - 1)] ?? EVENT_DC_REF
  }
  if (t.scope === 'parasite') {
    const r = parasiteRules.dc ?? { base: 12, per_level: 0.4, stages: [0, 0, 1, 2] }
    const pc = pcOf(state)
    const p = t.parasite ? parasiteOf(pc, t.parasite) : undefined
    return r.base + Math.round(pc.level * r.per_level) + (r.stages[p ? stageOf(p.corruption) : 0] ?? 0)
  }
  return EVENT_DC_REF
}

/** 選項實際的 DC：這件事的普通難度 +（寫的 DC − 14）+ 存檔規則「事件檢定的難度」（只算發生在主角身上的事件） */
export function eventDc(state: GameState, t: Pick<RoadTemplate, 'scope' | 'parasite'>, dc: number): number {
  if (t.scope !== 'dungeon' && t.scope !== 'parasite') return dc
  return Math.max(5, Math.min(30, eventBaseDc(state, t) + (dc - EVENT_DC_REF) + gameRule(state, 'eventDc')))
}

export function dungeonTemplates(): RoadTemplate[] {
  return travelEvents.templates.filter((t) => t.scope === 'dungeon')
}

/** 這一層：城外的近郊與地下城的周邊 0，地下城 1 淺層 … 4 底層 */
function layerOf(area: Area): number | undefined {
  if (area.kind === 'wild') return 0
  if (area.kind === 'dungeon') return area.layer ?? 0
  return undefined
}

/** 這個觸發點、這個地方能出現的事件 */
export function dungeonCandidates(state: GameState, area: Area, trigger: DungeonTrigger): RoadTemplate[] {
  const layer = layerOf(area)
  if (layer === undefined) return []
  const loc = locationById(area.location)
  const body = characterBody(pcOf(state))
  const seen = state.dungeonEvents?.seen ?? {}
  const repeat = travelEvents.dungeon?.repeat_days ?? 3
  const day = state.time.day
  return dungeonTemplates().filter((t) =>
    (!t.triggers?.length || t.triggers.includes(trigger))
    && (!t.dungeons?.length || t.dungeons.includes(loc.id))
    && (!t.regions?.length || t.regions.includes(loc.region))
    && (!t.layers?.length || t.layers.includes(layer))
    && tagsAllowed(t.tags)
    && pcBodyAllowed(t.pc_body, body)
    && condMet(state, t.requires)
    && (seen[t.id] === undefined || day - seen[t.id]! >= (t.cooldown_days ?? repeat)))
}

/**
 * 觸發點發生之後（陷阱沒察覺、打開寶箱、採集、安全房長休）：冷卻過了、機率中了，就遇到一件事，等主角回應。
 * 回傳有沒有開始事件（寶箱：有事件時寶箱本身不打開）。
 */
export function maybeDungeonEvent(state: GameState, trigger: DungeonTrigger): boolean {
  const rules = travelEvents.dungeon
  if (!rules || state.dungeonEvent || state.parasiteEvent || state.combat || state.standoff || state.pendingMasterEvent || state.pendingAction || state.townEvent) return false
  const area = currentArea(state)
  const now = hoursOf(state.time)
  const last = state.dungeonEvents?.last
  if (last !== undefined && now - last < rules.cooldown_hours) return false
  const list = dungeonCandidates(state, area, trigger)
  if (!list.length) return false
  const chance = Math.min(1, (rules.chance[trigger] ?? 0) * gameRule(state, 'dungeonEventMult'))
  const pick = withRng(state, (rng) => (rng.chance(chance) ? rng.pick(list) : undefined))
  if (!pick) return false
  const log = (state.dungeonEvents ??= { seen: {} })
  log.last = now
  log.seen[pick.id] = state.time.day
  state.dungeonEvent = { template: pick.id, trigger }
  return true
}

/** 等待回應的地下城事件 */
export function pendingDungeonEvent(state: GameState): RoadTemplate | undefined {
  const id = state.dungeonEvent?.template
  return id ? dungeonTemplates().find((t) => t.id === id) : undefined
}

/** 自訂內容拿掉的事件：等待中的地下城事件作廢（讀檔時，以及自訂內容改變之後） */
export function pruneDungeonEvent(state: GameState) {
  if (state.dungeonEvent && !pendingDungeonEvent(state)) delete state.dungeonEvent
}

/** 發生在主角身上的事件的報告（地下城事件、寄生物發作） */
export function pcEventReport(state: GameState, title: string, tag: string): Report {
  const area = currentArea(state)
  const loc = locationById(area.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'event',
    time: { start: { ...state.time }, end: { ...state.time } },
    location: { at: loc.id, region: loc.region, scene: `${area.name}・${title}` },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'neutral', tags: [tag] },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

// 這個選項會不會進入親密場景（城鎮事件也用；定義在 road.ts，旅途事件也用）
export { sceneOn } from './road'

/** 主角回應一個選項：有檢定的由主角擲骰（非戰鬥狀態與特質也算），套用結果、寫進報告；回傳檢定有沒有成功 */
export function resolvePcOption(state: GameState, report: Report, t: RoadTemplate, o: RoadOption, tag: string, scene = t.scene): boolean {
  const pc = pcOf(state)
  let ok = true
  if (o.check) {
    const extra = checkModifiers(pc, { context: 'action', attr: o.check.attr })
    const dice = withBonus('1d20', mod(attrOf(pc, o.check.attr)) + proficiency(pc.level) + extra.reduce((s, x) => s + x.value, 0))
    const r = withRng(state, (rng) => diceRoll(rng, dice))
    const natural = r.rolls[0] ?? r.total
    const dc = eventDc(state, t, o.check.dc)
    ok = natural === 20 || (natural !== 1 && r.total >= dc)
    report.timeline = [{ seq: 1, time: { ...state.time }, actor: 'pc', action: `${t.title}：${o.label}${modifierNote(extra)}`, roll: { dice, value: r.total, dc }, result: ok ? 'success' : 'fail' }]
  }
  const lines = [`${t.text}你選擇${o.label}。`, ...applyRoadOutcome(state, report, ok ? o.success : o.fail)]
  report.outcome = { result: o.check ? (ok ? 'success' : 'failure') : 'neutral', summary: lines.join(''), tags: [tag] }
  report.narration = { ...report.narration, focus: [t.text, `主角的回應：${o.label}`] }
  if (scene && sceneOn(o, ok)) report.narration = { ...report.narration, length: 'medium', adult_scene: scene }
  if (t.pc_body?.length) report.narration = { ...report.narration, body_limited: true }
  return ok
}

/** 選一個回應 */
export function answerDungeonEvent(state: GameState, index: number): Report {
  const t = pendingDungeonEvent(state)
  const o = t?.options?.[index]
  if (!t || !o) throw new Error('沒有這個選項')
  const report = pcEventReport(state, t.title, '地下城事件')
  resolvePcOption(state, report, t, o, '地下城事件')
  delete state.dungeonEvent
  const committed = commitReport(state, report)
  applyPendingMove(state)
  return committed
}
