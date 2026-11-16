// 儲物箱（docs/HOMES.md 第 7 節，R30）
import { describe, expect, it } from 'vitest'
import { craftRules, homeRules, itemDef } from '@/engine/data'
import { prepareAction, resolveAction } from '@/engine/actions'
import { toolAccess } from '@/engine/crafting'
import { plant, seedsFor } from '@/engine/garden'
import { produceTarget, recipePlan } from '@/engine/recipes'
import { enterLocation, placeAt, type Area } from '@/engine/grid'
import { buyHome, furnitureIn, lotsOf, placeFurniture, takeFurniture } from '@/engine/homes'
import {
  depositItem, depositMany, depositMoney, depositRefusal, homeStock, storageInUse, storedItems, storedMoney, takeFromHome, withdrawItem, withdrawMoney,
} from '@/engine/storage'
import { addItem, newGame } from '@/engine/state'
import { itemUsage, renameItemInState } from '@/engine/usage'
import { sanitizeItem } from '@/engine/mods'
import type { GameState, Home } from '@/engine/types'

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

/** 買下一棟有地下室的房子 */
function bought(state: GameState): Home {
  const lot = lotsOf(state.location).find((l) => homeRules.districts[l.district].basement)!
  buyHome(state, lot.id)
  return Object.values(state.homes!)[0]!
}

const floorOf = (home: Home, kind: 'ground' | 'basement') => Object.values(home.areas).find((a) => a.homeFloor === kind)!

/** 在這一層找第 n 格空的地板 */
function spot(area: Area, n = 0): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'floor' && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

const qty = (state: GameState, name: string) => state.inventory.find((i) => i.name === name)?.qty ?? 0

/** 在一樓擺一個箱子，回傳位置 */
function chest(state: GameState, home: Home, name = '木箱', n = 0) {
  const area = floorOf(home, 'ground')
  const p = spot(area, n)
  addItem(state.inventory, name, 1)
  placeFurniture(state, area, p.x, p.y, name)
  return { area, ...p, cell: area.cells[p.y * area.width + p.x]! }
}

describe('儲物箱的資料', () => {
  it('五件箱子都是儲物家具，只有保險箱能存錢', () => {
    const names = ['木箱', '衣櫃', '鐵皮櫃', '地窖貨架', '保險箱']
    for (const n of names) expect(itemDef(n)?.furniture?.function, n).toBe('storage')
    expect(names.map((n) => itemDef(n)!.furniture!.slots)).toEqual([12, 20, 30, 50, 6])
    expect(names.filter((n) => itemDef(n)!.furniture!.money)).toEqual(['保險箱'])
    expect(itemDef('地窖貨架')!.furniture!.places).toEqual(['basement'])
  })

  it('世界編輯器存檔時保留儲物的欄位', () => {
    for (const n of ['木箱', '保險箱']) {
      const def = itemDef(n)!
      expect(sanitizeItem(n, def as never, false).furniture, n).toEqual(def.furniture)
    }
    expect(sanitizeItem('x', { category: 'furniture', furniture: { places: ['indoor'], function: 'storage', slots: 500 } } as never, true).furniture).toMatchObject({ function: 'storage', slots: 99 })
  })
})

describe('存取', () => {
  it('放進去、拿出來不花時間，數量可以只放一部分', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home)
    addItem(state.inventory, '木材', 10)
    const time = { ...state.time }
    expect(depositItem(state, area, x, y, '木材', 4)).toBe(4)
    expect(qty(state, '木材')).toBe(6)
    expect(storedItems(cell)).toEqual([{ name: '木材', qty: 4 }])
    expect(depositItem(state, area, x, y, '木材')).toBe(6)
    expect(qty(state, '木材')).toBe(0)
    expect(withdrawItem(state, area, x, y, '木材', 3)).toBe(3)
    expect(qty(state, '木材')).toBe(3)
    expect(withdrawItem(state, area, x, y, '木材')).toBe(7)
    expect(cell.storage).toBeUndefined()
    expect(state.time).toEqual(time)
  })

  it('品質跟著東西走', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home)
    addItem(state.inventory, '藥草', 2, 'fine')
    depositItem(state, area, x, y, '藥草')
    expect(storedItems(cell)).toEqual([{ name: '藥草', qty: 2, quality: 'fine' }])
    withdrawItem(state, area, x, y, '藥草')
    expect(state.inventory.find((i) => i.name === '藥草')).toMatchObject({ qty: 2, quality: 'fine' })
  })

  it('容量算種類：滿了放不進新的種類，已經有的照樣能補', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home, '保險箱')
    const kinds = ['木材', '鐵礦石', '藥草', '野莓', '生肉', '亞麻布']
    for (const k of kinds) {
      addItem(state.inventory, k, 2)
      depositItem(state, area, x, y, k, 1)
    }
    addItem(state.inventory, '麥酒', 1)
    expect(depositRefusal(state, cell, '麥酒')).toContain('滿了')
    expect(() => depositItem(state, area, x, y, '麥酒')).toThrow('滿了')
    expect(depositItem(state, area, x, y, '木材')).toBe(1)
  })

  it('情報不能放進箱子', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home)
    addItem(state.inventory, '懸賞告示', 1)
    expect(depositRefusal(state, cell, '懸賞告示')).toContain('情報')
    expect(() => depositItem(state, area, x, y, '懸賞告示')).toThrow('情報')
  })

  it('一次放進去：已經有的種類、或某一類的全部', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home)
    addItem(state.inventory, '木材', 3)
    depositItem(state, area, x, y, '木材', 1)
    addItem(state.inventory, '藥草', 2)
    expect(depositMany(state, area, x, y, { same: true })).toBe(1)
    expect(qty(state, '木材')).toBe(0)
    expect(qty(state, '藥草')).toBe(2)
    expect(depositMany(state, area, x, y, { category: 'material' })).toBeGreaterThanOrEqual(1)
    expect(qty(state, '藥草')).toBe(0)
    expect(storedItems(cell).map((i) => i.name)).toEqual(expect.arrayContaining(['木材', '藥草']))
  })

  it('只能用自己房子裡的箱子，站的格子要是箱子', () => {
    const state = game()
    const home = bought(state)
    const area = floorOf(home, 'ground')
    const p = spot(area)
    addItem(state.inventory, '木材', 1)
    expect(() => depositItem(state, area, p.x, p.y, '木材')).toThrow('不是儲物箱')
    const other = structuredClone(area)
    other.key = 'town/elsewhere'
    expect(() => depositItem(state, other, p.x, p.y, '木材')).toThrow('自己房子')
  })
})

describe('收起箱子', () => {
  it('箱子裡還有東西時不能收起，拿空了才可以', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y } = chest(state, home)
    addItem(state.inventory, '木材', 1)
    depositItem(state, area, x, y, '木材')
    expect(() => takeFurniture(state, area, x, y)).toThrow('箱子裡還有東西')
    expect(furnitureIn(home).find((f) => f.name === '木箱')?.stored).toBe(1)
    withdrawItem(state, area, x, y, '木材')
    takeFurniture(state, area, x, y)
    expect(qty(state, '木箱')).toBe(1)
  })
})

describe('保險箱', () => {
  it('存錢、領錢；只有保險箱能存', () => {
    const state = game()
    const home = bought(state)
    const box = chest(state, home, '木箱', 0)
    const safe = chest(state, home, '保險箱', 1)
    expect(() => depositMoney(state, box.area, box.x, box.y, 100)).toThrow('只有保險箱')
    const before = state.money_cc
    depositMoney(state, safe.area, safe.x, safe.y, 3000)
    expect(state.money_cc).toBe(before - 3000)
    expect(storedMoney(safe.cell)).toBe(3000)
    expect(storageInUse(safe.cell)).toBe(true)
    expect(() => takeFurniture(state, safe.area, safe.x, safe.y)).toThrow('箱子裡還有東西')
    expect(() => withdrawMoney(state, safe.area, safe.x, safe.y, 5000)).toThrow('只有')
    expect(() => depositMoney(state, safe.area, safe.x, safe.y, state.money_cc + 1)).toThrow('身上只有')
    withdrawMoney(state, safe.area, safe.x, safe.y, 3000)
    expect(state.money_cc).toBe(before)
    expect(safe.cell.storage).toBeUndefined()
  })
})

describe('整棟房子', () => {
  it('合計所有箱子；拿出來時從各個箱子湊', () => {
    const state = game()
    const home = bought(state)
    const a = chest(state, home, '木箱', 0)
    const basement = floorOf(home, 'basement')
    const p = spot(basement)
    addItem(state.inventory, '地窖貨架', 1)
    placeFurniture(state, basement, p.x, p.y, '地窖貨架')
    addItem(state.inventory, '木材', 9)
    depositItem(state, a.area, a.x, a.y, '木材', 4)
    depositItem(state, basement, p.x, p.y, '木材', 5)
    expect(homeStock(home).get('木材')).toBe(9)
    expect(takeFromHome(state, home, '木材', 6)).toBe(6)
    expect(qty(state, '木材')).toBe(6)
    expect(homeStock(home).get('木材')).toBe(3)
    expect(takeFromHome(state, home, '木材', 10)).toBe(3)
    expect(homeStock(home).has('木材')).toBe(false)
  })
})

describe('用量檢查與改名', () => {
  it('箱子裡的東西算在用量裡，改名時一起改', () => {
    const state = game()
    const home = bought(state)
    const { area, x, y, cell } = chest(state, home)
    addItem(state.inventory, '木材', 2)
    depositItem(state, area, x, y, '木材')
    expect(itemUsage('木材', state).some((u) => u.includes('箱子裡（×2）'))).toBe(true)
    renameItemInState(state, '木材', '好木材')
    expect(storedItems(cell)).toEqual([{ name: '好木材', qty: 2 }])
  })
})

describe('在家裡直接用（S2）', () => {
  /** 站進房子裡，擺一個箱子並放進東西 */
  function stocked(state: GameState, items: [string, number][]) {
    const home = bought(state)
    const c = chest(state, home)
    for (const [name, n] of items) {
      addItem(state.inventory, name, n)
      depositItem(state, c.area, c.x, c.y, name)
    }
    const area = floorOf(home, 'ground')
    const p = spot(area, 3)
    placeAt(state, area, p.x, p.y)
    return { home, ...c }
  }

  it('配方的材料與工具：行囊不夠的從箱子拿，做完箱子跟著少', () => {
    const state = game()
    state.inventory = []
    delete state.party[0]!.crafts
    state.party[0]!.attrs.dex = 10
    stocked(state, [['野莓', 4], ['炊具組', 1]])
    addItem(state.inventory, '野莓', 2)
    expect(toolAccess(state, 'cooking').tier).toBeGreaterThanOrEqual(1)
    const plan = recipePlan(state, '野莓派', 2, state.party[0]!)
    expect(plan.blocked).toBeUndefined()
    expect(plan.inputs[0]).toMatchObject({ name: '野莓', need: 6, have: 6, home: 4 })
    prepareAction(state, { kind: 'produce', target: produceTarget('pc', '野莓派', 2), text: '' })
    state.pendingAction!.natural = 8
    const r = resolveAction(state, null)
    expect(r.check?.degree).toBe('success')
    expect(qty(state, '野莓派')).toBe(4)
    expect(qty(state, '野莓')).toBe(0)
    expect(homeStock(Object.values(state.homes!)[0]!).has('野莓')).toBe(false)
    // 工具沒有用掉，還在箱子裡
    expect(homeStock(Object.values(state.homes!)[0]!).get('炊具組')).toBe(1)
    expect(qty(state, '炊具組')).toBe(0)
  })

  it('失敗只從箱子拿用掉的份數', () => {
    const state = game()
    state.inventory = []
    delete state.party[0]!.crafts
    stocked(state, [['藥草', 6], ['煉金工具組', 1]])
    state.party[0]!.attrs.int = 4
    prepareAction(state, { kind: 'produce', target: produceTarget('pc', '微弱治療藥劑', 2), text: '' })
    state.pendingAction!.natural = 2
    const r = resolveAction(state, null)
    expect(r.check?.degree).toBe('fail')
    // 損失一半（3 份）：從箱子補進行囊再用掉，剩下的留在箱子裡
    expect(qty(state, '藥草')).toBe(0)
    expect(homeStock(Object.values(state.homes!)[0]!).get('藥草')).toBe(3)
  })

  it('出了房子就不算箱子', () => {
    const state = game()
    state.inventory = []
    delete state.party[0]!.crafts
    stocked(state, [['野莓', 6], ['炊具組', 1]])
    expect(recipePlan(state, '野莓派', 2, state.party[0]!).blocked).toBeUndefined()
    enterLocation(state)
    const away = recipePlan(state, '野莓派', 2, state.party[0]!)
    expect(away.inputs[0]).toMatchObject({ have: 0 })
    expect(away.inputs[0]!.home).toBeUndefined()
    expect(toolAccess(state, 'cooking').tier).toBe(0)
    expect(craftRules.skills.cooking).toBeDefined()
  })

  it('播種可以用箱子裡的種子', () => {
    const state = game()
    const home = bought(state)
    const c = chest(state, home)
    addItem(state.inventory, '藥草種子', 2)
    depositItem(state, c.area, c.x, c.y, '藥草種子')
    const ground = floorOf(home, 'ground')
    const i = ground.cells.findIndex((x) => x.kind === 'yard')
    const yard = { x: i % ground.width, y: Math.floor(i / ground.width) }
    addItem(state.inventory, '菜圃', 1)
    placeFurniture(state, ground, yard.x, yard.y, '菜圃')
    const plot = ground.cells[i]!
    placeAt(state, ground, yard.x, yard.y)
    expect(seedsFor(state, ground, plot)).toEqual([{ name: '藥草種子', qty: 2 }])
    plant(state, ground, yard.x, yard.y, '藥草種子')
    expect(plot.crop?.seed).toBe('藥草種子')
    expect(homeStock(home).get('藥草種子')).toBe(1)
    expect(qty(state, '藥草種子')).toBe(0)
  })
})
