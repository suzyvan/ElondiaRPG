// 房子的擴充（R32，docs/plan/roadmap/HOME_EXPANSION_PLAN.md）：舒適度分段、成套家具、熟成桶
import { describe, expect, it } from 'vitest'
import { companionRules, homeRules, itemDef, itemRules } from '@/engine/data'
import { agingRecipes, agingStatus, dumpAging, startAging, takeAged } from '@/engine/aging'
import { depositItem, homeStock } from '@/engine/storage'
import { sanitizeCondition, sanitizeItem } from '@/engine/mods'
import { crossLink, currentArea, enterLocation, getArea, placeAt, type Area } from '@/engine/grid'
import { expandOptions, floorsAbove, hasBasement, startExpansion, yardDepth } from '@/engine/homeExpand'
import { buyHome, comfortOf, comfortTier, completeSets, lotsOf, placeFurniture, setProgress, takeFurniture } from '@/engine/homes'
import { applyHomeRules, currentHomeRules, restoreHomeRules, sanitizeCustomSet, sanitizeHomeRules, sanitizeSetEffect } from '@/engine/homeMods'
import { buildSetEffectPrompt, parseSetEffect } from '@/narrator/setEffect'
import { pruneStatuses } from '@/engine/state'
import { activeRooms, roomAt, roomComfort, roomsOf, roomStatus, setRoomUse, type Room } from '@/engine/rooms'
import { recipePlan } from '@/engine/recipes'
import { sendHome } from '@/engine/away'
import { generateNpc } from '@/engine/npcs'
import { joinParty } from '@/engine/party'
import { Rng } from '@/engine/rng'
import { ensureRelationship, setAffinity } from '@/engine/social'
import { longRest } from '@/engine/rest'
import { addHours, addItem, advanceTime, newGame } from '@/engine/state'
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
    for (const d of Object.values(homeRules.furniture_sets).filter((x) => typeof x === 'object' && 'need' in x && x.condition)) expect(companionRules.conditions[d.condition!]).toBeDefined()
    // 學者的書齋沒有自己的狀態，改成加強書房（X3）
    expect(homeRules.furniture_sets.scholar!.condition).toBeUndefined()
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

describe('擴建（X2）', () => {
  it('加蓋一層：原本的樓層不動，新樓層用樓梯接上；施工期間走不過去，完工後可以上去', () => {
    const state = game()
    const home = moveIn(state, 'house')
    furnish(state, home, ['盆栽', '書架'])
    const top = home.areas[home.floors.at(-1)!]!
    const before = JSON.stringify(Object.values(home.areas).map((a) => a.cells.filter((c) => c.furniture)))
    const money = state.money_cc
    const opt = expandOptions(state, home).find((o) => o.kind === 'floor')!
    expect(opt.blocked).toBeUndefined()
    startExpansion(state, 'floor')
    expect(state.money_cc).toBe(money - opt.price)
    expect(floorsAbove(home)).toBe(3)
    const f3 = home.areas[home.floors.at(-1)!]!
    expect(f3.key).toMatch(/\/F3$/)
    const up = top.cells.findIndex((c) => c.dir === 'up' && c.link?.area === f3.key)
    expect(up).toBeGreaterThanOrEqual(0)
    expect(f3.cells[up]).toMatchObject({ dir: 'down', link: { area: top.key } })
    expect(JSON.stringify(Object.values(home.areas).filter((a) => a !== f3).map((a) => a.cells.filter((c) => c.furniture)))).toBe(before)
    // 施工中：一次只能做一項，樓梯走不過去
    expect(expandOptions(state, home).every((o) => o.blocked)).toBe(true)
    placeAt(state, top, up % top.width, Math.floor(up / top.width))
    expect(() => crossLink(state)).toThrow('施工')
    advanceTime(state, 24 * opt.days)
    expect(home.construction).toBeUndefined()
    expect(home.staffNotes?.some((n) => n.tag === '擴建' && n.text.includes('三樓'))).toBe(true)
    crossLink(state)
    expect(currentArea(state).key).toBe(f3.key)
    // 宅邸最多 3 層
    expect(expandOptions(state, home).find((o) => o.kind === 'floor')!.blocked).toContain('最多')
  })

  it('挖地下室：從一樓的屋子裡往下', () => {
    const state = game('rivervale')
    const home = moveIn(state, 'townhouse')
    expect(hasBasement(home)).toBe(false)
    startExpansion(state, 'basement')
    expect(hasBasement(home)).toBe(true)
    expect(home.areas[home.floors[0]!]!.homeFloor).toBe('basement')
    const g = ground(home)
    const down = g.cells.findIndex((c) => c.dir === 'down')
    expect(Math.floor(down / g.width)).toBeLessThan(homeRules.districts.townhouse.size[1])
    expect(expandOptions(state, home).find((o) => o.kind === 'basement')!.blocked).toBeDefined()
  })

  it('擴院子：完工時往下加一列，上面的格子不動，出口移到新的圍牆並接回街道', () => {
    const state = game()
    const home = moveIn(state, 'house')
    furnish(state, home, ['菜圃'], 0, 'yard')
    const g = ground(home)
    const depth = yardDepth(home)
    const top = g.cells.slice(0, (g.height - 1) * g.width).map((c) => c.kind + (c.furniture ?? ''))
    startExpansion(state, 'yard')
    expect(yardDepth(home)).toBe(depth)
    advanceTime(state, 24 * homeRules.expand.yard.days)
    expect(yardDepth(home)).toBe(depth + 1)
    // 原本最下面的圍牆變成院子；上面的格子一格都沒動
    expect(g.cells.slice(0, top.length).map((c, i) => (i < top.length - g.width ? c.kind + (c.furniture ?? '') : ''))).toEqual(top.map((x, i) => (i < top.length - g.width ? x : '')))
    const exit = g.cells.findIndex((c) => c.dir === 'out')
    expect(Math.floor(exit / g.width)).toBe(g.height - 1)
    expect(g.cells[exit]!.link?.area).toBe(home.lot.area)
    // 從街上進門，落在新的出口
    const street = getArea(state, home.lot.area)
    expect(street.cells[home.lot.y * street.width + home.lot.x]!.link).toMatchObject({ area: g.key, y: g.height - 1 })
  })
})

describe('房間用途（X3）', () => {
  /** 房間裡空的地板格（不靠門） */
  const freeIn = (room: Room) => room.cells.filter((i) => room.area.cells[i]!.kind === 'floor' && !room.area.cells[i]!.furniture)
  /** 站到這間房間，擺家具 */
  function into(state: GameState, room: Room, names: string[]) {
    for (const n of names) {
      const i = freeIn(room)[0]!
      addItem(state.inventory, n, 1)
      placeFurniture(state, room.area, i % room.area.width, Math.floor(i / room.area.width), n)
    }
    const at = freeIn(room)[0]!
    placeAt(state, room.area, at % room.area.width, Math.floor(at / room.area.width))
  }
  const biggest = (home: Home, floor: 'ground' | 'basement' | 'upper') => roomsOf(home).filter((r) => r.area.homeFloor === floor).sort((a, b) => b.cells.length - a.cells.length)[0]!

  it('用牆與門圍出房間：每一格只屬於一間，院子與門不算；擺家具之後 key 不變', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const g = ground(home)
    const rooms = roomsOf(home).filter((r) => r.area === g)
    expect(rooms.length).toBeGreaterThanOrEqual(homeRules.districts.house.rooms[0])
    const all = rooms.flatMap((r) => r.cells)
    expect(new Set(all).size).toBe(all.length)
    expect(all.some((i) => g.cells[i]!.kind === 'yard')).toBe(false)
    const key = rooms[0]!.key
    into(state, rooms[0]!, ['盆栽'])
    expect(roomsOf(home).find((r) => r.area === g && r.cells.includes(rooms[0]!.cells[0]!))!.key).toBe(key)
  })

  it('臥室：有床才生效，舒適度 +1；條件不滿足時用途保留', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const room = biggest(home, 'ground')
    into(state, room, [])
    setRoomUse(state, 'bedroom')
    expect(roomStatus(home, room)).toMatchObject({ use: 'bedroom', ok: false, why: '要擺一張床' })
    expect(roomComfort(home)).toBe(0)
    into(state, room, ['木板床'])
    expect(roomStatus(home, room).ok).toBe(true)
    expect(roomComfort(home)).toBe(homeRules.rooms.bedroom_comfort)
    expect(() => setRoomUse(state, 'cellar')).toThrow('地下室')
  })

  it('書房：在書房長休得到書房的專注；湊齊學者的書齋時是書齋的沉思（智力 +2）', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const room = biggest(home, 'upper')
    into(state, room, ['木板床', '書架', '書架'])
    setRoomUse(state, 'study')
    expect(activeRooms(home).map((r) => r.use)).toEqual(['study'])
    state.lastLongRest = undefined
    longRest(state, 'home')
    expect(state.party[0]!.status).toContain('study_focus')
    // 湊齊學者的書齋（書架、書桌、地球儀）
    into(state, room, ['書桌', '地球儀'])
    state.lastLongRest = undefined
    const r = longRest(state, 'home')
    expect(state.party[0]!.status).toContain('set_scholar')
    expect(state.party[0]!.status).not.toContain('study_focus')
    expect(companionRules.conditions.set_scholar!.check_penalty).toBe(-2)
    expect(r.outcome.summary).toContain('書齋的沉思')
  })

  it('工坊：站在有這種工藝工作台的工坊裡，工時打折', () => {
    const state = game()
    delete state.party[0]!.crafts
    const home = moveIn(state, 'house')
    const room = biggest(home, 'ground')
    into(state, room, ['石砌大灶'])
    addItem(state.inventory, '野莓', 30)
    const before = recipePlan(state, '野莓派', 4, state.party[0]!).hours
    setRoomUse(state, 'workshop')
    expect(recipePlan(state, '野莓派', 4, state.party[0]!).hours).toBe(Math.round(before * homeRules.rooms.workshop_mult))
  })

  it('酒窖：地下室有熟成桶的房間，熟成再快一些（和地下室的倍率相乘）', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const room = biggest(home, 'basement')
    into(state, room, ['橡木桶'])
    setRoomUse(state, 'cellar')
    const i = room.cells.find((c) => room.area.cells[c]!.furniture === '橡木桶')!
    addItem(state.inventory, '野莓', 6)
    startAging(state, room.area, i % room.area.width, Math.floor(i / room.area.width), '陳年果酒')
    expect(room.area.cells[i]!.aging!.hours).toBe(Math.round(Math.round(7 * 24 * homeRules.aging.basement_mult) * homeRules.rooms.cellar_mult))
  })

  it('客房：留在家裡的夥伴住客房，每天親密度 +1，一週最多 +3', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const room = biggest(home, 'upper')
    into(state, room, ['木板床'])
    setRoomUse(state, 'guest')
    const rec = generateNpc(state, new Rng(3), { kind: 'adventurer', location: state.location }, 'adv')
    joinParty(state, rec, 'voluntary')
    ensureRelationship(state, rec)
    setAffinity(state, rec.id, 10)
    sendHome(state, home.id, rec.id)
    const free = freeIn(room)[0]!
    state.npcs![rec.id]!.at = { area: room.area.key, x: free % room.area.width, y: Math.floor(free / room.area.width), until: 1e9 }
    advanceTime(state, 24 * 10)
    expect(state.relationships![rec.id]!.affinity).toBeGreaterThanOrEqual(13)
    expect(state.relationships![rec.id]!.affinity).toBeLessThanOrEqual(16)
  })

  it('育嬰室的「家人的笑容」多持續一次長休', () => {
    const state = game()
    moveIn(state, 'house')
    state.party[0]!.status.push('family_smile_lasting')
    const g = Object.values(state.homes!)[0]!
    const bed = roomsOf(g).find((r) => r.area.homeFloor === 'ground')!
    into(state, bed, ['木板床'])
    state.lastLongRest = undefined
    longRest(state, 'home')
    expect(state.party[0]!.status).toContain('family_smile')
    expect(state.party[0]!.status).not.toContain('family_smile_lasting')
    state.lastLongRest = undefined
    longRest(state, 'home')
    expect(state.party[0]!.status).not.toContain('family_smile')
    expect(roomAt(ground(g), 0, 0)).toBeUndefined()
  })

  it('世界編輯器整理非戰鬥狀態時留著 then', () => {
    expect(sanitizeCondition('family_smile_lasting', companionRules.conditions.family_smile_lasting as never, false)).toMatchObject({ then: 'family_smile', replaces: ['family_smile'] })
  })
})
