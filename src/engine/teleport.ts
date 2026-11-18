// 傳送陣（docs/HOMES.md 第 4.2 節；規則在 homes.json 的 teleport）：在兩棟自己的房子之間瞬間移動。
// - 傳送陣是家具（function: teleport），一棟房子一座。站在上面，可以傳送到另一棟也有傳送陣的自己的房子。
// - 全隊每人用掉一顆傳送石，花一小時，沒有旅途事件、不經過城門；抵達時站在目的地的傳送陣上。
// - 不設限制（持有房子的福利）：跟著別人的隊伍時隊長和全隊一起過去，主角是奴隸時主人也一起過去，跨大陸也可以。
//   眼前有要先處理的事（對峙、被制伏的人還沒處置……）時本來就不能移動，這裡也一樣。

import { homeRules, itemDef, locationById } from './data'
import { assertNoStandoff, currentArea, placeAt, position, type Area } from './grid'
import { homeReport, ownHomeOfArea } from './homes'
import { constructionBlock } from './homeExpand'
import { commitReport } from './state'
import { arrive } from './travel'
import type { GameState, Home, Report } from './types'

const rules = () => homeRules.teleport

/** 這棟房子的傳送陣在哪一格 */
export function circleOf(home: Home): { area: Area; x: number; y: number; name: string } | undefined {
  for (const a of Object.values(home.areas)) {
    const i = a.cells.findIndex((c) => c.furniture && itemDef(c.furniture)?.furniture?.function === 'teleport')
    if (i >= 0) return { area: a, x: i % a.width, y: Math.floor(i / a.width), name: a.cells[i]!.furniture! }
  }
  return undefined
}

/** 站在自己房子的傳送陣上時，這棟房子 */
export function circleHere(state: GameState): Home | undefined {
  const area = currentArea(state)
  const home = ownHomeOfArea(state, area)
  if (!home) return undefined
  const p = position(state)
  const f = area.cells[p.y * area.width + p.x]?.furniture
  return f && itemDef(f)?.furniture?.function === 'teleport' ? home : undefined
}

/** 全隊要幾顆傳送石 */
export function stonesNeeded(state: GameState): number {
  return state.party.length * rules().per_member
}

export const stonesHave = (state: GameState) => state.inventory.filter((i) => i.name === rules().stone).reduce((n, i) => n + i.qty, 0)

export interface TeleportTarget {
  home: Home
  /** 不能傳過去的原因（可以時沒有） */
  blocked?: string
}

/** 能傳送過去的房子：別棟有傳送陣的自己的房子 */
export function teleportTargets(state: GameState): TeleportTarget[] {
  const here = circleHere(state)
  if (!here) return []
  return Object.values(state.homes ?? {})
    .filter((h) => h.id !== here.id && !h.master && circleOf(h))
    .map((h) => {
      const c = circleOf(h)!
      const block = constructionBlock(state, c.area)
      return { home: h, ...(block ? { blocked: `傳送陣那一層${block}` } : {}) }
    })
}

/** 不能傳送的原因（沒有時可以） */
export function teleportRefusal(state: GameState): string | undefined {
  try {
    assertNoStandoff(state)
  } catch (e) {
    return (e as Error).message
  }
  if (state.townEvent) return '先決定怎麼應付眼前的事'
  const need = stonesNeeded(state)
  if (stonesHave(state) < need) return `全隊 ${state.party.length} 人要 ${need} 顆${rules().stone}（有 ${stonesHave(state)} 顆）`
  return undefined
}

/** 傳送到另一棟房子的傳送陣上 */
export function teleport(state: GameState, homeId: string): Report {
  const from = circleHere(state)
  if (!from) throw new Error('要站在自己房子的傳送陣上')
  const target = teleportTargets(state).find((t) => t.home.id === homeId)
  if (!target) throw new Error('那棟房子沒有傳送陣')
  if (target.blocked) throw new Error(target.blocked)
  const why = teleportRefusal(state)
  if (why) throw new Error(why)
  const to = target.home
  const need = stonesNeeded(state)
  const fromLoc = locationById(from.location)
  const toLoc = locationById(to.location)
  const report = homeReport(state, 'travel', rules().hours, from.name)
  report.location.to = to.location
  if (need > 0) report.changes.items_lost = [{ name: rules().stone, qty: need, owner: 'pc' }]
  report.outcome = {
    result: 'arrived',
    summary: `全隊站上「${from.name}」的傳送陣，捏碎了 ${need} 顆${rules().stone}，從${fromLoc.name}的家裡傳送過來，出現在${toLoc.name}「${to.name}」的傳送陣上。`,
    tags: ['傳送陣'],
  }
  report.narration = { ...report.narration, tone: '一陣光之後換了地方' }
  report.lore_keys = [...new Set([fromLoc.name, toLoc.name])]
  const committed = commitReport(state, report)
  // 換地點：和走到那座城一樣建立地圖與名單，只是不經過城門
  if (to.location !== state.location) {
    state.location = to.location
    arrive(state, { gate: false })
  }
  const c = circleOf(to)!
  placeAt(state, c.area, c.x, c.y)
  return committed
}
