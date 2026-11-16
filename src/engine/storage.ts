// 儲物箱（見 docs/HOMES.md 第 7 節）：房子裡的家具 function: storage。
// - 每個箱子各自存放（記在格子的 storage），容量是「幾種東西」（slots，同一種的數量不限）。
// - 存進去、拿出來不花時間、不寫日誌，和擺放家具一樣只是整理。
// - 情報物品不能放（放進去就讀不到了）；箱子裡還有東西時不能收起。
// - 保險箱（money）還能存錢：存在箱子裡的錢不算身上的錢，戰敗不會損失。
// - 在自己的房子裡做工藝、播種時，整棟房子的箱子都算（homeStock、takeFromHome）。

import { itemDef, type FurnitureSpec } from './data'
import type { Area, Cell } from './grid'
import { isIntelItem } from './inventory'
import { formatMoney } from './money'
import { addItem, removeItem } from './state'
import type { GameState, Home, InventoryItem } from './types'
import { ownHomeOfArea } from './homes'

/** 這一格的家具是儲物箱 */
export function storageSpec(cell: Cell | undefined): FurnitureSpec | undefined {
  const spec = cell?.furniture ? itemDef(cell.furniture)?.furniture : undefined
  return spec?.function === 'storage' ? spec : undefined
}

/** 箱子裡的東西（沒有時是空的） */
export function storedItems(cell: Cell | undefined): InventoryItem[] {
  return cell?.storage?.items.filter((i) => i.qty > 0) ?? []
}

export function storedMoney(cell: Cell | undefined): number {
  return cell?.storage?.money_cc ?? 0
}

/** 箱子裡還有東西或錢 */
export function storageInUse(cell: Cell | undefined): boolean {
  return storedItems(cell).length > 0 || storedMoney(cell) > 0
}

/** 箱子的容量（幾種）；家具被刪掉時是 0，只能拿出來 */
export function storageSlots(cell: Cell | undefined): number {
  return Math.max(0, storageSpec(cell)?.slots ?? 0)
}

/** 這一格是箱子（或曾經是箱子、裡面還有東西） */
function chestAt(state: GameState, area: Area, x: number, y: number): Cell {
  if (!ownHomeOfArea(state, area)) throw new Error('只能用自己房子裡的箱子')
  const cell = area.cells[y * area.width + x]
  if (!cell || (!storageSpec(cell) && !storageInUse(cell))) throw new Error('這一格不是儲物箱')
  return cell
}

/** 不能放進這個箱子的原因（沒有時可以放） */
export function depositRefusal(state: GameState, cell: Cell, name: string): string | undefined {
  if (!storageSpec(cell)) return '這不是儲物箱'
  if (isIntelItem(state, name)) return '情報要帶在身上才讀得到，不能放進箱子'
  const items = storedItems(cell)
  if (!items.some((i) => i.name === name) && items.length >= storageSlots(cell)) return `箱子滿了（最多 ${storageSlots(cell)} 種）`
  return undefined
}

function tidy(cell: Cell) {
  if (!cell.storage) return
  cell.storage.items = cell.storage.items.filter((i) => i.qty > 0)
  if (!cell.storage.money_cc) delete cell.storage.money_cc
  if (!cell.storage.items.length && !cell.storage.money_cc) delete cell.storage
}

/** 把行囊裡的東西放進箱子（qty 沒填是全部），回傳放進去的數量 */
export function depositItem(state: GameState, area: Area, x: number, y: number, name: string, qty?: number): number {
  const cell = chestAt(state, area, x, y)
  const have = state.inventory.find((i) => i.name === name && i.qty > 0)
  if (!have) throw new Error(`行囊裡沒有${name}`)
  const refused = depositRefusal(state, cell, name)
  if (refused) throw new Error(refused)
  const n = Math.min(have.qty, Math.max(1, Math.floor(qty ?? have.qty)))
  const quality = have.quality
  removeItem(state.inventory, name, n)
  cell.storage ??= { items: [] }
  addItem(cell.storage.items, name, n, quality)
  return n
}

/** 從箱子拿回行囊（qty 沒填是全部），回傳拿出來的數量 */
export function withdrawItem(state: GameState, area: Area, x: number, y: number, name: string, qty?: number): number {
  const cell = chestAt(state, area, x, y)
  const have = storedItems(cell).find((i) => i.name === name)
  if (!have) throw new Error(`箱子裡沒有${name}`)
  const n = Math.min(have.qty, Math.max(1, Math.floor(qty ?? have.qty)))
  const quality = have.quality
  removeItem(cell.storage!.items, name, n)
  addItem(state.inventory, name, n, quality)
  tidy(cell)
  return n
}

/**
 * 一次放進去：same＝箱子裡已經有的東西，行囊裡的全部補進去；category＝這個分類的東西全部放進去（放得下的種類）。
 * 回傳放進去幾種。
 */
export function depositMany(state: GameState, area: Area, x: number, y: number, by: { same: true } | { category: string }): number {
  const cell = chestAt(state, area, x, y)
  if (!storageSpec(cell)) throw new Error('這不是儲物箱')
  const inBox = new Set(storedItems(cell).map((i) => i.name))
  const picks = state.inventory.filter((i) => i.qty > 0 && ('same' in by ? inBox.has(i.name) : itemDef(i.name)?.category === by.category))
  let n = 0
  for (const i of picks.map((p) => p.name)) {
    if (depositRefusal(state, cell, i)) continue
    depositItem(state, area, x, y, i)
    n++
  }
  return n
}

/** 存錢（保險箱） */
export function depositMoney(state: GameState, area: Area, x: number, y: number, amount: number) {
  const cell = chestAt(state, area, x, y)
  if (!storageSpec(cell)?.money) throw new Error('只有保險箱能存錢')
  const n = Math.floor(amount)
  if (n <= 0) throw new Error('要存多少？')
  if (n > state.money_cc) throw new Error(`身上只有 ${formatMoney(state.money_cc)}`)
  state.money_cc -= n
  cell.storage ??= { items: [] }
  cell.storage.money_cc = (cell.storage.money_cc ?? 0) + n
}

/** 領錢（保險箱；家具被刪掉時也能把錢拿出來） */
export function withdrawMoney(state: GameState, area: Area, x: number, y: number, amount: number) {
  const cell = chestAt(state, area, x, y)
  const n = Math.floor(amount)
  if (n <= 0) throw new Error('要領多少？')
  if (n > storedMoney(cell)) throw new Error(`箱子裡只有 ${formatMoney(storedMoney(cell))}`)
  cell.storage!.money_cc = storedMoney(cell) - n
  state.money_cc += n
  tidy(cell)
}

// ---- 整棟房子 ----

/** 房子裡所有的箱子 */
export function chestsIn(home: Home): { area: string; x: number; y: number; cell: Cell }[] {
  const out: { area: string; x: number; y: number; cell: Cell }[] = []
  for (const a of Object.values(home.areas)) {
    a.cells.forEach((c, i) => { if (storageSpec(c) || storageInUse(c)) out.push({ area: a.key, x: i % a.width, y: Math.floor(i / a.width), cell: c }) })
  }
  return out
}

/** 整棟房子的箱子裡，每種東西的合計 */
export function homeStock(home: Home | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!home) return out
  for (const { cell } of chestsIn(home)) for (const i of storedItems(cell)) out.set(i.name, (out.get(i.name) ?? 0) + i.qty)
  return out
}

/** 整棟房子的箱子裡存的錢 */
export function homeMoney(home: Home | undefined): number {
  return home ? chestsIn(home).reduce((n, c) => n + storedMoney(c.cell), 0) : 0
}

/**
 * 從整棟房子的箱子拿出 qty 份放進行囊（不夠就拿得到的全部），回傳實際拿出來的數量。
 * 在家做工藝時，行囊不夠的材料先用這個補進行囊，之後照原本的流程從行囊扣。
 */
export function takeFromHome(state: GameState, home: Home, name: string, qty: number): number {
  let left = Math.max(0, Math.floor(qty))
  for (const { cell } of chestsIn(home)) {
    if (left <= 0) break
    const have = storedItems(cell).find((i) => i.name === name)
    if (!have) continue
    const n = Math.min(have.qty, left)
    const quality = have.quality
    removeItem(cell.storage!.items, name, n)
    addItem(state.inventory, name, n, quality)
    tidy(cell)
    left -= n
  }
  return Math.max(0, Math.floor(qty)) - left
}
