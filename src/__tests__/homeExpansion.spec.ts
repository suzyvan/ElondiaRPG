// 房子的擴充（R32，docs/plan/roadmap/HOME_EXPANSION_PLAN.md）：舒適度分段、成套家具、熟成桶
import { describe, expect, it } from 'vitest'
import { companionRules, homeRules, itemDef, itemRules } from '@/engine/data'
import { agingRecipes, agingStatus, dumpAging, startAging, takeAged } from '@/engine/aging'
import { depositItem, homeStock } from '@/engine/storage'
import { sanitizeItem } from '@/engine/mods'
import { enterLocation, placeAt, type Area } from '@/engine/grid'
import { buyHome, comfortOf, comfortTier, completeSets, lotsOf, placeFurniture, setProgress, takeFurniture } from '@/engine/homes'
import { applyHomeRules, currentHomeRules, restoreHomeRules, sanitizeCustomSet, sanitizeHomeRules, sanitizeSetEffect } from '@/engine/homeMods'
import { buildSetEffectPrompt, parseSetEffect } from '@/narrator/setEffect'
import { pruneStatuses } from '@/engine/state'
import { longRest } from '@/engine/rest'
import { addHours, addItem, newGame } from '@/engine/state'
import type { GameState, Home } from '@/engine/types'

function game(birthplace = 'soriel'): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace })
  enterLocation(state)
  state.money_cc = 10_000_000
  return state
}

const ground = (home: Home) => Object.values(home.areas).find((a) => a.homeFloor === 'ground')!

/** 這一層第 n 格空的地板（或院子） */
function spot(area: Area, n = 0, kind = 'floor'): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === kind && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

function moveIn(state: GameState, district = 'house'): Home {
  buyHome(state, lotsOf(state.location).find((l) => l.district === district)!.id)
  const home = Object.values(state.homes!)[0]!
  const p = spot(ground(home), 0)
  placeAt(state, ground(home), p.x, p.y)
  return home
}

/** 在一樓擺家具（第 n 格空地板起） */
function furnish(state: GameState, home: Home, names: string[], from = 1, kind = 'floor') {
  const g = ground(home)
  for (const name of names) {
    const p = spot(g, from, kind)
    addItem(state.inventory, name, 1)
    placeFurniture(state, g, p.x, p.y, name)
  }
}

describe('舒適度分段（X1）', () => {
  it('三段由低到高，同一組只留最高的', () => {
    expect(homeRules.comfort_tiers.map((t) => t.at)).toEqual([6, 12, 20])
    for (const t of homeRules.comfort_tiers) expect(companionRules.conditions[t.condition]?.group).toBe('home_rest')
    expect(comfortTier(5)).toEqual({ next: homeRules.comfort_tiers[0] })
    expect(comfortTier(12)).toEqual({ tier: homeRules.comfort_tiers[1], next: homeRules.comfort_tiers[2] })
    expect(comfortTier(25)).toEqual({ tier: homeRules.comfort_tiers[2] })
  })

  it('在家長休後全隊得到達到的最高一段', () => {
    const state = game()
    const home = moveIn(state)
    furnish(state, home, ['四柱大床', '壁爐', '織錦掛毯', '石雕像'])
    expect(comfortOf(home)).toBeGreaterThanOrEqual(11)
    furnish(state, home, ['書架'])
    expect(comfortOf(home)).toBeGreaterThanOrEqual(12)
    expect(comfortOf(home)).toBeLessThan(20)
    state.lastLongRest = undefined
    const r = longRest(state, 'home')
    const st = state.party[0]!.status
    expect(st).toContain('refreshed')
    expect(st).not.toContain('well_rested')
    expect(r.outcome.summary).toContain('精神飽滿')
  })

  it('房屋設定：分段的門檻由低到高', () => {
    const r = sanitizeHomeRules({ comfort_tiers: [{ at: 10 }, { at: 5 }, { at: 5 }] })
    expect((r.comfort_tiers as { at: number }[]).map((t) => t.at)).toEqual([10, 11, 12])
  })
})

describe('成套家具（X4）', () => {
  it('四套，每一套的家具都存在；東方的庭院在炎華之地賣', () => {
    const members = (id: string) => ['四柱大床', '織錦掛毯', '石雕像', '噴水池', '木板床', '羊毛地毯', '壁爐', '鞣皮工坊', '書架', '書桌', '地球儀', '屏風', '茶几', '竹簾', '石燈籠']
      .filter((n) => itemDef(n)?.furniture?.set === id)
    expect(members('noble')).toHaveLength(4)
    expect(members('hunter')).toHaveLength(4)
    expect(members('scholar')).toHaveLength(3)
    expect(members('east')).toHaveLength(4)
    for (const n of members('east')) expect(itemDef(n)!.regions).toEqual(['yanhua_south', 'yanhua_north'])
    for (const d of Object.values(homeRules.furniture_sets).filter((x) => typeof x === 'object' && 'need' in x)) expect(companionRules.conditions[d.condition!]).toBeDefined()
  })

  it('同一棟房子擺了規定件數的不同家具就湊齊：舒適度再加，長休多一個狀態；同一件擺兩次不算', () => {
    const state = game()
    const home = moveIn(state)
    furnish(state, home, ['四柱大床', '織錦掛毯'])
    furnish(state, home, ['石雕像', '噴水池'], 0, 'yard')
    furnish(state, home, ['石雕像'])
    expect(setProgress(home).find((x) => x.id === 'noble')).toMatchObject({ have: 4, need: 4, done: true })
    expect(completeSets(home)).toEqual(['noble'])
    expect(comfortOf(home)).toBe(5 + 2 + 2 + 3 + 2 + homeRules.furniture_sets.noble!.comfort)
    state.lastLongRest = undefined
    const r = longRest(state, 'home')
    expect(state.party[0]!.status).toContain('set_noble')
    expect(r.outcome.summary).toContain('貴族的居所')
  })

  it('還沒湊齊不加；世界編輯器整理時保留存在的套組', () => {
    const state = game()
    const home = moveIn(state)
    furnish(state, home, ['書架', '書架', '書桌'])
    expect(setProgress(home).find((x) => x.id === 'scholar')).toMatchObject({ have: 2, done: false })
    expect(sanitizeItem('x', { category: 'furniture', furniture: { places: ['indoor'], set: 'scholar' } } as never, true).furniture?.set).toBe('scholar')
    expect(sanitizeItem('x', { category: 'furniture', furniture: { places: ['indoor'], set: 'nope' } } as never, true).furniture?.set).toBeUndefined()
  })
})

describe('熟成桶（X5）', () => {
  const qty = (state: GameState, name: string) => state.inventory.find((i) => i.name === name)?.qty ?? 0

  it('五種熟成，材料都存在；熟成後轉賣大約賺三到五成', () => {
    const list = agingRecipes()
    expect(list.map((r) => r.name).sort()).toEqual(['梅子酒', '燻肉', '熒光蜜酒', '藥酒', '陳年果酒'].sort())
    const sell = (n: string) => { const d = itemDef(n)!; return d.price_cc * (d.category === 'material' ? itemRules.material_sell_ratio : itemRules.sell_ratio) }
    for (const { name, spec } of list) {
      for (const x of spec.inputs) expect(itemDef(x.name), `${name} ← ${x.name}`).toBeDefined()
      const input = spec.inputs.reduce((n, x) => n + itemDef(x.name)!.price_cc * x.qty, 0)
      const gain = (sell(name) * spec.qty) / input - 1
      expect(gain, name).toBeGreaterThanOrEqual(0.3)
      expect(gain, name).toBeLessThanOrEqual(0.5)
    }
  })

  it('放進去用掉材料（行囊不夠的從箱子補）；熟成好了取出；桶子裡有東西不能收起', () => {
    const state = game()
    const home = moveIn(state)
    const g = ground(home)
    const cask = spot(g, 1)
    addItem(state.inventory, '橡木桶', 1)
    placeFurniture(state, g, cask.x, cask.y, '橡木桶')
    const box = spot(g, 1)
    addItem(state.inventory, '木箱', 1)
    placeFurniture(state, g, box.x, box.y, '木箱')
    addItem(state.inventory, '野莓', 6)
    depositItem(state, g, box.x, box.y, '野莓', 4)
    expect(() => startAging(state, g, cask.x, cask.y, '燻肉')).toThrow('燻製架')
    startAging(state, g, cask.x, cask.y, '陳年果酒')
    expect(qty(state, '野莓')).toBe(0)
    expect(homeStock(home).has('野莓')).toBe(false)
    const cell = g.cells[cask.y * g.width + cask.x]!
    expect(agingStatus(state, cell)).toMatchObject({ item: '陳年果酒', ready: false, hoursLeft: 7 * 24 })
    expect(() => takeFurniture(state, g, cask.x, cask.y)).toThrow('熟成')
    expect(() => takeAged(state, g, cask.x, cask.y)).toThrow('小時')
    state.time = addHours(state.time, 7 * 24)
    const r = takeAged(state, g, cask.x, cask.y)
    expect(r.outcome.tags).toContain('熟成')
    expect(qty(state, '陳年果酒')).toBe(1)
    expect(cell.aging).toBeUndefined()
  })

  it('放在地下室熟得比較快；還沒好的可以倒掉', () => {
    const state = game()
    const home = moveIn(state)
    const b = Object.values(home.areas).find((a) => a.homeFloor === 'basement')!
    const p = spot(b, 0)
    addItem(state.inventory, '燻製架', 1)
    placeFurniture(state, b, p.x, p.y, '燻製架')
    addItem(state.inventory, '生肉', 3)
    placeAt(state, b, p.x, p.y)
    startAging(state, b, p.x, p.y, '燻肉')
    const cell = b.cells[p.y * b.width + p.x]!
    expect(cell.aging?.hours).toBe(Math.round(3 * 24 * homeRules.aging.basement_mult))
    dumpAging(state, b, p.x, p.y)
    expect(cell.aging).toBeUndefined()
    expect(qty(state, '生肉')).toBe(0)
  })

  it('世界編輯器整理：桶子的種類、熟成的材料（不能是自己）', () => {
    const r = sanitizeItem('自釀酒', { category: 'food', price_cc: 5, aging: { vessel: 'cask', inputs: [{ name: '野莓', qty: 3 }, { name: '自釀酒', qty: 1 }], days: 99, qty: 2 } } as never, true)
    expect(r.aging).toEqual({ vessel: 'cask', inputs: [{ name: '野莓', qty: 3 }], days: 60, qty: 2 })
    expect(sanitizeItem('桶', { category: 'furniture', furniture: { places: ['indoor'], function: 'aging', vessel: 'bad' } } as never, true).furniture).toMatchObject({ function: 'aging', vessel: 'cask' })
  })
})

describe('自建的成套家具（效果由 AI 決定）', () => {
  it('效果最多兩項好處：檢定（最多兩個屬性）、豁免、迴避、暫時生命；沒有名稱或沒有好處時不算', () => {
    expect(sanitizeSetEffect({ name: '茶香的餘韻', desc: '滿室茶香', check_attrs: ['int', 'cha', 'str'], save: 1, evade: 1, temp_hp: 99 }))
      .toEqual({ name: '茶香的餘韻', desc: '滿室茶香', check_attrs: ['int', 'cha'], save: 1 })
    expect(sanitizeSetEffect({ name: '海風', temp_hp: 99 })).toEqual({ name: '海風', desc: '', temp_hp: 6 })
    expect(sanitizeSetEffect({ name: '空的' })).toBeUndefined()
    expect(sanitizeSetEffect({ check_attrs: ['int'] })).toBeUndefined()
    expect(sanitizeCustomSet('noble', { name: 'x' })).toBeUndefined()
    expect(sanitizeCustomSet('mod_set_a1', { name: '漁村小屋', need: 99, comfort: -3 })).toEqual({ name: '漁村小屋', need: 20, comfort: 0, custom: true })
  })

  it('AI 的提示詞帶上主題與家具；回應照上限整理', () => {
    const p = buildSetEffectPrompt({ name: '漁村小屋', theme: '海邊的小屋，掛著漁網', pieces: ['漁網', '貝殼燈'], need: 2 })
    expect(p.user).toContain('海邊的小屋')
    expect(p.user).toContain('漁網、貝殼燈')
    expect(parseSetEffect('好的：```json\n{"name":"海潮的安眠","desc":"夢裡都是浪聲","evade":1,"temp_hp":4,"save":1}\n```'))
      .toEqual({ name: '海潮的安眠', desc: '夢裡都是浪聲', save: 1, evade: 1 })
    expect(() => parseSetEffect('{"name":"沒用"}')).toThrow('沒有任何好處')
  })

  it('套用後可以湊齊：在家長休得到自建的狀態；刪掉套組時狀態跟著拿掉', () => {
    const state = game()
    const home = moveIn(state)
    const id = 'mod_set_fish'
    const rules = sanitizeHomeRules({ ...currentHomeRules(), furniture_sets: { ...(currentHomeRules().furniture_sets as object), [id]: { name: '漁村小屋', need: 2, comfort: 4, effect: { name: '海潮的安眠', desc: '', evade: 1 } } } })
    try {
      applyHomeRules(rules)
      expect(companionRules.conditions[`set_${id}`]).toMatchObject({ name: '海潮的安眠', combat_mods: { evade: 1 }, clears: 'long_rest' })
      // 把兩件現有的家具指定到這一套
      itemDef('盆栽')!.furniture!.set = id
      itemDef('書架')!.furniture!.set = id
      furnish(state, home, ['羽毛床', '盆栽', '書架'])
      expect(completeSets(home)).toContain(id)
      state.lastLongRest = undefined
      longRest(state, 'home')
      expect(state.party[0]!.status).toContain(`set_${id}`)
      // 刪掉套組：狀態拿掉，角色身上的也清掉
      applyHomeRules(sanitizeHomeRules(currentHomeRules()))
      const { [id]: _gone, ...rest } = currentHomeRules().furniture_sets as Record<string, unknown>
      applyHomeRules(sanitizeHomeRules({ ...currentHomeRules(), furniture_sets: rest }))
      expect(companionRules.conditions[`set_${id}`]).toBeUndefined()
      pruneStatuses(state)
      expect(state.party[0]!.status).not.toContain(`set_${id}`)
    } finally {
      itemDef('盆栽')!.furniture!.set = undefined
      itemDef('書架')!.furniture!.set = 'scholar'
      restoreHomeRules()
    }
    expect(Object.keys(homeRules.furniture_sets).some((k) => k.startsWith('mod_set_'))).toBe(false)
  })

  it('物品編輯器整理時留著自建套組的 id', () => {
    expect(sanitizeItem('x', { category: 'furniture', furniture: { places: ['indoor'], set: 'mod_set_fish' } } as never, true).furniture?.set).toBe('mod_set_fish')
  })
})
