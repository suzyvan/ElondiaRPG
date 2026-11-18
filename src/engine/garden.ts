// 種植（見 docs/HOMES.md 第 6 節）：房子裡的苗圃（家具 function: garden）可以播種。
// 種子是物品的 seed：種在哪裡（院子的菜圃、地下室的菇床）、幾天成熟、長出什麼、幾份。
// 成熟後站在苗圃上收成；種著東西的苗圃不能收起，可以拔掉（種子不退回）。

import { itemDef, type FurniturePlace, type SeedSpec } from './data'
import type { Area, Cell } from './grid'
import { homeOfArea, homeReport, ownHomeOfArea, PLACE_NAME, placeOf } from './homes'
import { commitReport, removeItem, withRng } from './state'
import { inventoryHere, pullFromHome, stockHere } from './storage'
import type { GameState, GameTime, Report } from './types'

const minutesOf = (t: GameTime) => ((t.day - 1) * 24 + (t.hour ?? 0)) * 60 + (t.minute ?? 0)

/** 這一格是苗圃：能種的地方（院子或地下室） */
export function plotPlace(area: Area, cell: Cell): FurniturePlace | undefined {
  if (!cell.furniture || itemDef(cell.furniture)?.furniture?.function !== 'garden') return undefined
  return placeOf(area, cell)
}

export function seedOf(name: string): SeedSpec | undefined {
  return itemDef(name)?.seed
}

/** 種子的一行說明 */
export function seedSummary(s: SeedSpec | undefined): string {
  if (!s) return ''
  const n = s.qty[0] === s.qty[1] ? `${s.qty[0]}` : `${s.qty[0]}～${s.qty[1]}`
  return `種在${PLACE_NAME[s.place]}的苗圃，${s.days} 天後長出${s.yields.join('或')} ×${n}`
}

/** 能種在這個苗圃的種子：行囊加上家裡的箱子（storage.ts） */
export function seedsFor(state: GameState, area: Area, cell: Cell): { name: string; qty: number }[] {
  const place = plotPlace(area, cell)
  return place ? inventoryHere(state).filter((i) => seedOf(i.name)?.place === place) : []
}

export interface CropStatus {
  seed: string
  spec: SeedSpec
  ready: boolean
  /** 還要幾小時成熟（成熟時 0） */
  hoursLeft: number
}

export function cropStatus(state: GameState, cell: Cell): CropStatus | undefined {
  const crop = cell.crop
  const spec = crop ? seedOf(crop.seed) : undefined
  if (!crop || !spec) return undefined
  const left = spec.days * 24 * 60 - (minutesOf(state.time) - minutesOf(crop.planted))
  return { seed: crop.seed, spec, ready: left <= 0, hoursLeft: Math.max(0, Math.ceil(left / 60)) }
}

function plotAt(state: GameState, area: Area, x: number, y: number): Cell {
  if (!ownHomeOfArea(state, area)) throw new Error('只能在自己的房子裡種東西')
  const cell = area.cells[y * area.width + x]
  if (!cell || !plotPlace(area, cell)) throw new Error('這一格不是苗圃')
  return cell
}

/** 播種：用掉一份種子 */
export function plant(state: GameState, area: Area, x: number, y: number, seed: string) {
  const cell = plotAt(state, area, x, y)
  if (cell.crop) throw new Error('這塊苗圃已經種了東西')
  const spec = seedOf(seed)
  if (!spec) throw new Error(`${seed}不是種子`)
  const place = plotPlace(area, cell)!
  if (spec.place !== place) throw new Error(`${seed}要種在${spec.place === 'yard' ? '院子的菜圃' : '地下室的菇床'}`)
  if (stockHere(state, seed) <= 0) throw new Error(`行囊和家裡的箱子都沒有${seed}`)
  pullFromHome(state, seed, 1)
  removeItem(state.inventory, seed, 1)
  cell.crop = { seed, planted: { ...state.time } }
}

/** 拔掉還沒成熟的作物（種子不退回） */
export function uproot(state: GameState, area: Area, x: number, y: number) {
  const cell = plotAt(state, area, x, y)
  if (!cell.crop) throw new Error('這塊苗圃沒有種東西')
  delete cell.crop
}

/** 收成：長出的東西放進行囊 */
export function harvest(state: GameState, area: Area, x: number, y: number): Report {
  const cell = plotAt(state, area, x, y)
  const status = cropStatus(state, cell)
  if (!status) throw new Error('這塊苗圃沒有種東西')
  if (!status.ready) throw new Error(`還要 ${status.hoursLeft} 小時才成熟`)
  const { yields, qty } = status.spec
  const [name, n] = withRng(state, (rng) => [rng.pick(yields), rng.int(qty[0], qty[1])] as const)
  delete cell.crop
  const home = homeOfArea(state, area)!
  const report = homeReport(state, 'action', 0.2, home.name)
  report.changes.items_gained = [{ name, qty: n, owner: 'pc' }]
  report.outcome = { result: 'success', summary: `在「${home.name}」的${cell.furniture}收成了 ${n} 份${name}。`, tags: ['收成'] }
  return commitReport(state, report)
}
