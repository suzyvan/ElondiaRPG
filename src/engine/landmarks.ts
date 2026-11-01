// 城鎮的特色地標：遊戲中的功能（docs/LANDMARKS.md）。資料在 data/world/landmarks.json，內容編輯器見 landmarkMods.ts。
// 開放條件、參訪（付錢或花時間換效果）、探索（主動行動的檢定）、場景（條件成立時的固定場景）；打工與受訓走 work.ts、perkActions.ts（格子的種類就是地標 id）。

import { landmarkDef, landmarks, locationById, npcs as namedNpcs, specialMaps, type Degree, type LandmarkDef, type LandmarkScene } from './data'
import { pcBodyAllowed, tagsAllowed } from './content'
import { characterBody } from './look'
import { npcFree } from './story'
import { npcRecord } from './npcs'
import { applyEffects } from './effects'
import { currentArea, currentCell, position } from './grid'
import { enterSpecial } from './specialMaps'
import { isNight } from './light'
import { wearNote } from './gear'
import { formatMoney } from './money'
import { isFugitive, pcOf } from './party'
import { meetsReputation } from './security'
import { condMet } from './storyFlags'
import { baseReport } from './town'
import { effectText } from './trade'
import { commitReport } from './state'
import type { GameState, Report } from './types'

/** 主角現在站的地標（聚落裡的地標格，或在地標的內部） */
export function landmarkHere(state: GameState): LandmarkDef | undefined {
  const area = currentArea(state)
  if (area.kind === 'special') return landmarkOfInterior(area.special)
  if (area.kind !== 'settlement') return undefined
  return landmarkDef(currentCell(state).kind)
}

/** 以這張特殊地圖為內部的地標 */
export function landmarkOfInterior(id: string | undefined): LandmarkDef | undefined {
  return id ? Object.values(landmarks).find((l) => l.interior === id) : undefined
}

/** 主角在這個地標的內部 */
export function insideLandmark(state: GameState, l: LandmarkDef): boolean {
  const area = currentArea(state)
  return area.kind === 'special' && !!l.interior && area.special === l.interior
}

/** 為什麼現在不能走進地標的內部（可以時是 undefined） */
export function interiorBlocked(state: GameState): string | undefined {
  const l = landmarkHere(state)
  if (!l?.interior || !specialMaps[l.interior]) return '這裡沒有可以進去的地方'
  if (insideLandmark(state, l)) return '已經在裡面了'
  return landmarkClosed(state, l)
}

/** 走進地標的內部（站在入口；從出口離開時回到地標格） */
export function enterLandmark(state: GameState) {
  const why = interiorBlocked(state)
  if (why) throw new Error(why)
  enterSpecial(state, landmarkHere(state)!.interior!)
}

/** 站在地標上行動時，場景帶上地標與它的氛圍（交給 AI） */
export function withLandmark(state: GameState, scene: string): string {
  const l = landmarkHere(state)
  if (!l || scene.includes(l.name)) return scene
  const mood = (l.scene || l.desc).slice(0, 80)
  return `${scene}・${l.name}${mood ? `（${mood}）` : ''}`
}

// ---- 開放條件 ----

/** 地標現在不開放的原因（開放時是 undefined） */
export function landmarkClosed(state: GameState, l: LandmarkDef): string | undefined {
  const o = l.open
  if (!o) return undefined
  if (o.hours === 'day' && isNight(state.time)) return `${l.name}只在白天開放`
  if (o.hours === 'night' && !isNight(state.time)) return `${l.name}只在夜裡開放`
  if (!condMet(state, { ...(o.flags ? { flags: o.flags } : {}), ...(o.flags_none ? { flags_none: o.flags_none } : {}) })) return `${l.name}現在不開放`
  if (o.min_reputation && !meetsReputation(state, locationById(l.location).faction, o.min_reputation)) return `要在這裡的勢力有 ${o.min_reputation} 點聲望，${l.name}才讓你進去`
  if (o.official && isFugitive(state)) return `${l.name}的人認出了你身上的契約印記，不讓你進去`
  return undefined
}

/** 站在不開放的地標上：打工、受訓、參訪、探索都不行 */
export function closedHere(state: GameState): string | undefined {
  const l = landmarkHere(state)
  return l ? landmarkClosed(state, l) : undefined
}

function record(state: GameState, id: string) {
  return ((state.landmarks ??= {})[id] ??= {})
}

/** 還要等幾天才能再參訪／探索（0：現在可以） */
export function waitDays(state: GameState, l: LandmarkDef, what: 'visit' | 'explore'): number {
  const last = what === 'visit' ? state.landmarks?.[l.id]?.visited : state.landmarks?.[l.id]?.explored
  if (last === undefined) return 0
  const gap = what === 'visit' ? l.visit?.cooldown_days ?? 1 : l.explore?.cooldown_days ?? 7
  return Math.max(0, last + gap - state.time.day)
}

/** 為什麼現在不能參訪或探索（可以時是 undefined） */
export function blockedReason(state: GameState, what: 'visit' | 'explore'): string | undefined {
  const l = landmarkHere(state)
  if (!l || !l[what]) return what === 'visit' ? '這裡沒有可以參訪的地方' : '這裡沒有可以探索的地方'
  const closed = landmarkClosed(state, l)
  if (closed) return closed
  const wait = waitDays(state, l, what)
  if (wait) return `${wait} 天後才能再${what === 'visit' ? '來' : '探索'}`
  if (what === 'visit' && (l.visit!.money_cc ?? 0) > state.money_cc) return `錢不夠（要 ${formatMoney(l.visit!.money_cc!)}）`
  return undefined
}

// ---- 參訪 ----

/** 參訪地標：付錢、花時間，得到設定的效果 */
export function visitLandmark(state: GameState): Report {
  const why = blockedReason(state, 'visit')
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const v = l.visit!
  const report = baseReport(state, 'event', v.hours ?? 0.5)
  report.location.scene = `${locationById(state.location).name}・${l.name}・${v.title}${l.scene ? `（${l.scene.slice(0, 80)}）` : ''}`
  report.lore_keys!.push(l.name)
  applyEffects(state, report, [...(v.money_cc ? [{ type: 'money' as const, amount: -v.money_cc }] : []), ...v.effects])
  record(state, l.id).visited = state.time.day
  report.outcome = { result: 'success', summary: `在${l.name}${v.title}。` }
  return commitReport(state, report)
}

// ---- 探索（主動行動 explore） ----

export function setupExplore(state: GameState) {
  const why = blockedReason(state, 'explore')
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const e = l.explore!
  const gains = e.effects.map((x) => effectText(state, x)).join('、') || '有所收穫'
  const extra = (e.critical ?? []).map((x) => effectText(state, x)).join('、')
  return {
    attr: e.attr, dc: e.dc, hours: e.hours, situational: [],
    scene: `${locationById(state.location).name}・${l.name}・${e.title}`,
    outcomes: {
      critical: extra ? `${gains}，另外 ${extra}` : gains, success: gains, partial: '有些頭緒，但沒找到什麼', fail: '一無所獲', fumble: '一無所獲，還弄得狼狽不堪',
    } as Partial<Record<Degree, string>>,
  }
}

export function applyExplore(state: GameState, report: Report, degree: Degree): string {
  const l = landmarkHere(state)
  if (!l?.explore) return '這裡沒有可以探索的地方。'
  record(state, l.id).explored = state.time.day
  const e = l.explore
  if (degree !== 'critical' && degree !== 'success') return `在${l.name}${e.title}，${degree === 'partial' ? '有些頭緒，但沒找到什麼' : '一無所獲'}。`
  applyEffects(state, report, [...e.effects, ...(degree === 'critical' ? e.critical ?? [] : [])])
  return `在${l.name}${e.title}，有所收穫。`
}

// ---- 場景（docs/LANDMARKS.md 第 6 節） ----

const npcName = (id: string) => namedNpcs.find((n) => n.id === id)?.name ?? id

/** 場景裡現在在場的固定 NPC；有寫旗標的人不在場時 missing（換成代替的人） */
export function sceneCast(state: GameState, sc: LandmarkScene): { ids: string[]; missing: boolean } {
  const ids: string[] = []
  let missing = false
  for (const c of sc.cast ?? []) {
    if (npcFree(state, c.npc) && (!c.flags?.length || condMet(state, { flags: c.flags }))) ids.push(c.npc)
    else missing = true
  }
  return { ids, missing }
}

/** 場景現在出不出現：內容標籤、主角的體型、劇情旗標；一定要在場的人（沒寫旗標的）死了或被抓走時也不出現 */
export function sceneShown(state: GameState, sc: LandmarkScene): boolean {
  if (!tagsAllowed(sc.tags)) return false
  if (!pcBodyAllowed(sc.pc_body, characterBody(pcOf(state)))) return false
  if (sc.requires && !condMet(state, sc.requires)) return false
  return (sc.cast ?? []).every((c) => c.flags?.length || npcFree(state, c.npc))
}

/** 場景在不在主角站的這一格：有內部的地標，寫了格子的場景在裡面的那一格，沒寫的在外面的地標格上 */
function sceneAtHere(state: GameState, l: LandmarkDef, sc: LandmarkScene): boolean {
  if (!insideLandmark(state, l)) return !(l.interior && sc.spot)
  const p = position(state)
  return !!sc.spot && sc.spot.x === p.x && sc.spot.y === p.y
}

/** 站在這裡現在出現的場景（index 是地標上的順序） */
export function scenesHere(state: GameState): { index: number; scene: LandmarkScene }[] {
  const l = landmarkHere(state)
  if (!l?.scenes) return []
  return l.scenes.map((scene, index) => ({ index, scene })).filter(({ scene }) => sceneAtHere(state, l, scene) && sceneShown(state, scene))
}

/** 在地標的內部時，有場景的格子（地圖標示用）：「x,y」→ 格子的名稱 */
export function sceneSpots(state: GameState): Map<string, string> {
  const out = new Map<string, string>()
  const l = landmarkHere(state)
  if (!l?.scenes || !insideLandmark(state, l)) return out
  for (const sc of l.scenes) {
    if (!sc.spot || !sceneShown(state, sc)) continue
    const k = `${sc.spot.x},${sc.spot.y}`
    out.set(k, out.get(k) ?? sc.spot_name ?? sc.title)
  }
  return out
}

/** 還要等幾天才能再選這個場景（0：現在可以）；沒有勾自己算冷卻的場景共用地標的冷卻 */
export function sceneWait(state: GameState, l: LandmarkDef, sc: LandmarkScene): number {
  const r = state.landmarks?.[l.id]
  const last = sc.own_cooldown ? r?.scenes?.[sc.title] : r?.scene
  if (last === undefined) return 0
  return Math.max(0, last + (sc.cooldown_days ?? 3) - state.time.day)
}

/** 為什麼現在不能選這個場景（可以時是 undefined） */
export function sceneBlocked(state: GameState, index: number): string | undefined {
  const l = landmarkHere(state)
  const sc = l?.scenes?.[index]
  if (!l || !sc || !sceneAtHere(state, l, sc) || !sceneShown(state, sc)) return '這裡沒有這個場景'
  const closed = landmarkClosed(state, l)
  if (closed) return closed
  const wait = sceneWait(state, l, sc)
  if (wait) return `${wait} 天後才能再來`
  if ((sc.money_cc ?? 0) > state.money_cc) return `錢不夠（要 ${formatMoney(sc.money_cc!)}）`
  return wearNote(pcOf(state), sc.wear)
}

/** 場景裡在場的人的名字（有人不在場時接上代替的人） */
export function sceneCastNames(state: GameState, sc: LandmarkScene): string[] {
  const { ids, missing } = sceneCast(state, sc)
  const names = ids.map(npcName)
  if (missing && sc.extras) names.push(sc.extras)
  return names
}

/** 場景交給 AI 的文字：{cast} 換成在場的人 */
export function sceneText(state: GameState, sc: LandmarkScene): string {
  return sc.scene.replace(/\{cast\}/g, sceneCastNames(state, sc).join('、') || sc.extras || '在場的人')
}

/** 選一個地標的場景：付錢、花時間，在場的人加好感，得到設定的效果；成人向的場景交給 AI 詳細描寫 */
export function playLandmarkScene(state: GameState, index: number): Report {
  const why = sceneBlocked(state, index)
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const sc = l.scenes![index]!
  const { ids } = sceneCast(state, sc)
  const text = sceneText(state, sc)
  const report = baseReport(state, 'event', sc.hours ?? 2)
  report.location.scene = `${locationById(state.location).name}・${l.name}${sc.spot_name ? `・${sc.spot_name}` : ''}・${sc.title}${l.scene ? `（${l.scene.slice(0, 80)}）` : ''}`
  report.lore_keys!.push(l.name, ...ids.map(npcName))
  // 在場的人記在 others：插圖的分鏡從隊伍與 others 挑人
  const present = ids
    .filter((id) => !state.party.some((m) => m.id === id))
    .map((id) => npcRecord(state, id))
    .filter((r): r is NonNullable<typeof r> => !!r && !r.dead)
    .map((r) => ({ id: r.id, name: r.name, race: r.race, class: r.class, level: r.level, personality: r.personality }))
  if (present.length) report.others = [...(report.others ?? []), ...present]
  applyEffects(state, report, [
    ...(sc.money_cc ? [{ type: 'money' as const, amount: -sc.money_cc }] : []),
    ...(sc.affinity ? ids.map((npc) => ({ type: 'affinity' as const, npc, delta: sc.affinity!, reason: `${l.name}・${sc.title}` })) : []),
    ...(sc.effects ?? []),
  ])
  const r = record(state, l.id)
  if (sc.own_cooldown) (r.scenes ??= {})[sc.title] = state.time.day
  else r.scene = state.time.day
  report.outcome = { result: 'success', summary: `在${l.name}${sc.title}：${text}` }
  if (sc.tags?.includes('adult')) report.narration = { ...report.narration, length: 'long', adult_scene: text }
  if (sc.pc_body?.length) report.narration = { ...report.narration, body_limited: true }
  return commitReport(state, report)
}
