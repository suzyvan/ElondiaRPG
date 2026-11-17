// 熟成（docs/HOMES.md 第 6.1 節）：房子裡的熟成桶（家具 function: aging，furniture.vessel 是哪一種桶）。
// - 能熟成的東西寫在成品的物品上（aging：什麼桶、放進哪些材料、幾天、做出幾份），和配方一樣寫在做出來的東西身上。
// - 站在熟成桶上選一樣放進去：材料從行囊扣（在自己家裡時，行囊不夠的從箱子補，storage.ts）。
// - 放在地下室時時間 × basement_mult（地窖陰涼）。熟成好的東西不會壞，可以放著；還沒好的可以倒掉（材料不退回）。
// - 裝著東西的桶子不能收起。

import { homeRules, itemDef, itemRules, VESSEL_NAME, type AgingSpec, type FurnitureSpec } from './data'
import type { Area, Cell } from './grid'
import { homeOfArea, homeReport, ownHomeOfArea } from './homes'
import { commitReport, removeItem } from './state'
import { pullFromHome, stockHere } from './storage'
import { cellarMult } from './rooms'
import type { GameState, GameTime, Report } from './types'

const minutesOf = (t: GameTime) => ((t.day - 1) * 24 + (t.hour ?? 0)) * 60 + (t.minute ?? 0)

/** 這一格的家具是熟成桶 */
export function vesselSpec(cell: Cell | undefined): FurnitureSpec | undefined {
  const f = cell?.furniture ? itemDef(cell.furniture)?.furniture : undefined
  return f?.function === 'aging' && f.vessel ? f : undefined
}

/** 能用這種桶熟成的成品（物品的 aging） */
export function agingRecipes(vessel?: string): { name: string; spec: AgingSpec }[] {
  return itemRules.items.filter((i) => i.aging && (!vessel || i.aging.vessel === vessel)).map((i) => ({ name: i.name, spec: i.aging! }))
}

/** 熟成要幾小時：放在地下室時比較快 */
export function agingHours(area: Pick<Area, 'homeFloor'>, spec: AgingSpec): number {
  const mult = area.homeFloor === 'basement' ? homeRules.aging?.basement_mult ?? 1 : 1
  return Math.max(1, Math.round(spec.days * 24 * mult))
}

export interface AgingStatus {
  item: string
  ready: boolean
  /** 還要幾小時（好了是 0） */
  hoursLeft: number
}

export function agingStatus(state: GameState, cell: Cell): AgingStatus | undefined {
  const a = cell.aging
  if (!a) return undefined
  const left = a.hours * 60 - (minutesOf(state.time) - minutesOf(a.started))
  return { item: a.item, ready: left <= 0, hoursLeft: Math.max(0, Math.ceil(left / 60)) }
}

/** 一樣東西現在缺哪些材料（行囊加上家裡的箱子；都夠時是空的） */
export function agingShort(state: GameState, spec: AgingSpec): string[] {
  return spec.inputs.filter((x) => stockHere(state, x.name) < x.qty).map((x) => `${x.name}（需要 ${x.qty}，有 ${stockHere(state, x.name)}）`)
}

function vesselAt(state: GameState, area: Area, x: number, y: number): Cell {
  if (!ownHomeOfArea(state, area)) throw new Error('只能用自己房子裡的熟成桶')
  const cell = area.cells[y * area.width + x]
  if (!cell || (!vesselSpec(cell) && !cell.aging)) throw new Error('這一格不是熟成桶')
  return cell
}

/** 放進去：用掉材料，開始熟成 */
export function startAging(state: GameState, area: Area, x: number, y: number, product: string) {
  const cell = vesselAt(state, area, x, y)
  const vessel = vesselSpec(cell)
  if (!vessel) throw new Error('這不是熟成桶')
  if (cell.aging) throw new Error('桶子裡已經有東西了')
  const spec = itemDef(product)?.aging
  if (!spec) throw new Error(`${product}不能熟成`)
  if (spec.vessel !== vessel.vessel) throw new Error(`${product}要用${VESSEL_NAME[spec.vessel]}`)
  const short = agingShort(state, spec)
  if (short.length) throw new Error(`材料不夠：${short.join('、')}`)
  for (const x2 of spec.inputs) {
    pullFromHome(state, x2.name, x2.qty)
    removeItem(state.inventory, x2.name, x2.qty)
  }
  // 生效的酒窖裡再快一些（rooms.ts）
  cell.aging = { item: product, started: { ...state.time }, hours: Math.max(1, Math.round(agingHours(area, spec) * cellarMult(state, area, x, y))) }
}

/** 倒掉還沒熟成的東西（材料不退回） */
export function dumpAging(state: GameState, area: Area, x: number, y: number) {
  const cell = vesselAt(state, area, x, y)
  if (!cell.aging) throw new Error('桶子是空的')
  delete cell.aging
}

/** 取出熟成好的東西：放進行囊 */
export function takeAged(state: GameState, area: Area, x: number, y: number): Report {
  const cell = vesselAt(state, area, x, y)
  const st = agingStatus(state, cell)
  if (!st) throw new Error('桶子是空的')
  if (!st.ready) throw new Error(`還要 ${st.hoursLeft} 小時才好`)
  const qty = itemDef(st.item)?.aging?.qty ?? 1
  delete cell.aging
  const home = homeOfArea(state, area)!
  const report = homeReport(state, 'action', 0.2, home.name)
  report.changes.items_gained = [{ name: st.item, qty, owner: 'pc' }]
  report.outcome = { result: 'success', summary: `從「${home.name}」的${cell.furniture ?? '熟成桶'}取出 ${qty} 份${st.item}。`, tags: ['熟成'] }
  return commitReport(state, report)
}

/** 熟成的一行說明（物品資訊、編輯器用） */
export function agingSummary(spec: AgingSpec | undefined): string {
  if (!spec) return ''
  return `${VESSEL_NAME[spec.vessel]}熟成：${spec.inputs.map((x) => `${x.name}×${x.qty}`).join('、')}，${spec.days} 天做出 ${spec.qty} 份（放在地下室比較快）`
}
