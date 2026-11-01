// 主題地下城：魅魔的遊樂園（docs/LUST_PARK.md）。
// - 入口廣場是一張特殊地圖，通道的另一頭寫 `dungeon/<園區 id>`：走上去等於從入口進那座地下城。
// - 園區是沒有周邊的地下城（geography 的地點寫 `park`），最上面一層是淺層，出口回到廣場；不能直接旅行到。
// - 魅氣：在園區裡慾望跨戰鬥保留，每走一格慢慢增加；回到廣場就散了。
// - 戰敗：一律回到廣場；成人向的戰敗開著時，套用那個園區的專屬戰敗（取代一般的戰敗事件）。
// - 擬態寶箱：園區的寶箱有機會是怪物，打開時變成戰鬥。

import { defeatAdultAllowed } from './content'
import { lewdRules, parkPlaza, specialKey, specialMaps } from './data'
import { applyEffects } from './effects'
import { assertNoStandoff, currentArea, currentCell, enterLocation, placeAt, type Area } from './grid'
import { characterBody } from './look'
import { pcOf } from './party'
import { closeOut, entryOf, specialArea } from './specialMaps'
import { addHours } from './state'
import type { GameState, Report } from './types'

export const PARK_LINK = 'dungeon/'

/** 通道的另一頭是園區時，回傳園區的地點 id */
export function parkOfLink(area: string): string | undefined {
  return area.startsWith(PARK_LINK) ? area.slice(PARK_LINK.length) : undefined
}

export function parkRules() {
  return lewdRules.park
}

/** 正在園區裡（地下城的格子上） */
export function inPark(state: GameState): boolean {
  return !!parkPlaza(state.location) && !state.road && state.position?.area?.startsWith(`${state.location}/`) === true
}

/** 從入口廣場的通道走進園區：開始一趟探索，站在淺層的出口；記下回程 */
export function enterPark(state: GameState, park: string, from: { area: string; x: number; y: number }) {
  if (!parkPlaza(park)) throw new Error('那裡不是園區')
  const special = state.special ? { ...state.special, visited: [...state.special.visited] } : undefined
  closeOut(state)
  state.location = park
  enterLocation(state)
  state.expedition!.park = { ...from, ...(special ? { special } : {}) }
}

/** 回到入口廣場（從出口走出去、戰敗）：站在進來的那一格通道上；這趟探索結束 */
export function returnToPlaza(state: GameState) {
  const plaza = parkPlaza(state.location)
  const def = plaza ? specialMaps[plaza] : undefined
  if (!def) return
  const back = state.expedition?.park
  delete state.expedition
  state.special = back?.special ?? { location: def.location, visited: [] }
  state.location = def.location
  const area = specialArea(state, def.id)
  const at = back?.area === specialKey(def.id) ? back : entryOf(area, def)
  placeAt(state, area, at.x, at.y)
}

/** 站在園區淺層的出口，按「回到廣場」 */
export function leavePark(state: GameState) {
  assertNoStandoff(state)
  if (!inPark(state) || currentCell(state).kind !== 'exit') throw new Error('要在園區的出口才能回到廣場')
  returnToPlaza(state)
}

/** 這個人現在的魅氣（慾望上限的比例） */
export function parkLust(state: GameState, id: string): number {
  return inPark(state) ? state.expedition?.lust?.[id] ?? 0 : 0
}

/** 在園區裡走一格：全隊的魅氣增加（走路最多累積到上限；戰鬥留下來的比較高時不變） */
export function stepParkLust(state: GameState, area: Area) {
  if (area.kind !== 'dungeon' || !parkPlaza(area.location) || !state.expedition) return
  const r = parkRules()
  const lust = (state.expedition.lust ??= {})
  for (const m of state.party) {
    const now = lust[m.id] ?? 0
    if (now < r.step_cap) lust[m.id] = Math.round(Math.min(r.step_cap, now + r.step_lust) * 1000) / 1000
  }
}

/** 園區的陷阱沒察覺：觸發的人魅氣大增（媚藥機關）；回傳增加的量 */
export function parkTrap(state: GameState, id: string): number {
  if (!state.expedition) return 0
  const r = parkRules()
  const lust = (state.expedition.lust ??= {})
  lust[id] = Math.round(Math.min(0.95, (lust[id] ?? 0) + r.trap_lust) * 1000) / 1000
  return r.trap_lust
}

/** 戰鬥結束時：把每個人剩下的慾望記成魅氣 */
export function saveParkLust(state: GameState, ratios: Record<string, number>) {
  if (!inPark(state) || !state.expedition) return
  const lust = (state.expedition.lust ??= {})
  for (const [id, ratio] of Object.entries(ratios)) lust[id] = Math.round(Math.max(0, Math.min(0.95, ratio)) * 1000) / 1000
}

/**
 * 在園區戰敗而且沒有人搬來救兵：成人向的戰敗開著時，套用這個園區的專屬戰敗（效果、經過的時間、交給成人場景的寫手）。
 * 之後由 afterDefeat 回到廣場。回傳是否套用。
 */
export function parkDefeat(state: GameState, report: Report): boolean {
  if (!inPark(state)) return false
  const d = parkRules().defeats[state.location]
  if (!d || !defeatAdultAllowed(characterBody(pcOf(state)))) return false
  const notes = applyEffects(state, report, d.effects)
  report.time = { ...report.time, end: addHours(report.time.end, d.hours) }
  report.outcome.summary = `${report.outcome.summary ?? ''}${d.summary}${notes.length ? `（${notes.join('，')}）` : ''}`
  report.outcome.tags = [...(report.outcome.tags ?? []), '園區的戰敗']
  report.narration = { ...report.narration, adult_scene: d.scene, focus: [...(report.narration?.focus ?? []), d.summary] }
  return true
}

/** 擬態寶箱：園區的寶箱打開時變成戰鬥的那一隻（依層） */
export function mimicFor(area: Area): string | undefined {
  const layer = String(area.layer ?? 1)
  return parkRules().mimics_at?.[area.location]?.[layer] ?? parkRules().mimics[layer]
}

/** 打倒這個園區的最終層主會不會蓋集章卡（緋夢樂園底下的遺跡不蓋） */
export function parkStamps(location: string): boolean {
  return !parkRules().unstamped?.includes(location)
}

/** 地圖上這一格是不是園區的出口（畫面用） */
export function atParkExit(state: GameState): boolean {
  return inPark(state) && currentArea(state).kind === 'dungeon' && currentCell(state).kind === 'exit'
}
