import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { toolAccess } from '@/engine/crafting'
import { geography, homeRules, locationById } from '@/engine/data'
import { blocksFor, crossLink, currentArea, currentCell, enterLocation, getArea, moveTo, placeAt, position, settlementKey, type Area } from '@/engine/grid'
import {
  buyHome, comfortOf, furnitureIn, generateHome, hasBed, homeOfArea, leaveWithResident, lotById, lotPrice, lotsOf, memberOrResident,
  placeFurniture, renameHome, residents, stayHome, takeFurniture, workbenchFor,
} from '@/engine/homes'
import { generateNpc } from '@/engine/npcs'
import { joinParty } from '@/engine/party'
import { areaOf, hireable } from '@/engine/population'
import { longRest, longRestBlocked } from '@/engine/rest'
import { setAffinity } from '@/engine/social'
import { addItem, migrate, newGame, SAVE_SCHEMA, withRng } from '@/engine/state'
import type { GameState, Home, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

/** 買下這座城的第一塊空地 */
function bought(state: GameState): Home {
  const lot = lotsOf(state.location)[0]!
  buyHome(state, lot.id)
  return Object.values(state.homes!)[0]!
}

const groundOf = (home: Home) => home.areas[home.floors.find((k) => home.areas[k]!.homeFloor === 'ground')!]!

function find(area: Area, test: (c: Area['cells'][number]) => boolean): { x: number; y: number } {
  const i = area.cells.findIndex(test)
  expect(i).toBeGreaterThanOrEqual(0)
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

/** 走得到的格子（不穿牆、不經過通道） */
function reachable(area: Area, from: number): Set<number> {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const i = queue.shift()!
    for (const j of [i - 1, i + 1, i - area.width, i + area.width]) {
      if (j < 0 || j >= area.cells.length || seen.has(j) || area.cells[j]!.kind === 'wall') continue
      if (Math.abs((j % area.width) - (i % area.width)) > 1) continue
      seen.add(j)
      queue.push(j)
    }
  }
  return seen
}

/** 站到某一格（測試用：直接放過去） */
function standAt(state: GameState, area: Area, x: number, y: number) {
  placeAt(state, area, x, y)
}

describe('lots', () => {
  it('are fixed street-side buildings, counted by settlement size', () => {
    const lots = lotsOf('soriel')
    const type = locationById('soriel').type
    expect(lots.length).toBe(homeRules.lots[type])
    expect(lotsOf('soriel')).toEqual(lots)
    for (const lot of lots) {
      const area = getArea(game(), lot.area)
      expect(area.cells[lot.y * area.width + lot.x]).toMatchObject({ kind: 'lot', lot: lot.id })
      expect(area.cells[lot.street.y * area.width + lot.street.x]!.kind).not.toBe('wall')
      expect(lotById(game(), lot.id)).toEqual(lot)
    }
  })

  it('every settlement offers its full count, with one in the noble quarter when it has one', () => {
    for (const loc of geography.locations.filter((l) => l.type !== 'dungeon')) {
      const lots = lotsOf(loc.id)
      expect(lots.length, loc.id).toBe(homeRules.lots[loc.type])
      expect(new Set(lots.map((l) => l.id)).size, loc.id).toBe(lots.length)
      const noble = blocksFor(loc).some((b) => b.zone === 'noble')
      expect(lots.some((l) => l.district === homeRules.noble), loc.id).toBe(noble)
      for (const lot of lots) {
        const grid = blocksFor(loc).find((b) => settlementKey(loc.id, b.id) === lot.area)!.grid
        expect(grid[lot.street.y]![lot.street.x], loc.id).toBe('.')
        // 門口不是別塊空地
        expect(lots.some((o) => o.area === lot.area && o.x === lot.street.x && o.y === lot.street.y), loc.id).toBe(false)
      }
    }
  })

  it('fills in with street houses only where buildings run short, keeping the other lots', () => {
    // 建築格夠的城市：空地和以前一樣（存檔裡的空地 id 不變）
    expect(lotsOf('rhineburg').map((l) => l.id)).toEqual(['rhineburg:noble:8,4', 'rhineburg:gate:8,2', 'rhineburg:noble:8,2', 'rhineburg:gate:4,2'])
    // 貴族區沒有建築格：補一塊街屋在貴族區，其餘照舊
    const [street, ...rest] = lotsOf('soriel')
    expect(street!.area).toBe('soriel/sanctum')
    expect(blocksFor(locationById('soriel')).find((b) => b.id === 'sanctum')!.grid[street!.y]![street!.x]).toBe('.')
    expect(rest.map((l) => l.id)).toEqual(['soriel:market:8,2', 'soriel:market:8,4', 'soriel:harbor:2,4'])
  })
})

describe('buying a house', () => {
  it('costs the district price and stores generated floors in the save', () => {
    const state = game()
    const lot = lotsOf(state.location)[0]!
    const price = lotPrice(state, lot)
    const money = state.money_cc
    const r = buyHome(state, lot.id, '小窩')
    valid(r)
    expect(state.money_cc).toBe(money - price)
    const home = Object.values(state.homes!)[0]!
    expect(home.name).toBe('小窩')
    const def = homeRules.districts[lot.district]
    expect(home.floors.length).toBe(def.floors + (def.basement ? 1 : 0))
    expect(() => buyHome(state, lot.id)).toThrow('已經是你的了')
    // 空地變成房子的門
    const street = getArea(state, lot.area)
    expect(street.cells[lot.y * street.width + lot.x]).toMatchObject({ kind: 'link', home: home.id })
  })

  it('takes you inside when you buy it standing on the lot', () => {
    const state = game()
    const lot = lotsOf(state.location)[0]!
    standAt(state, getArea(state, lot.area), lot.x, lot.y)
    buyHome(state, lot.id)
    expect(currentArea(state).kind).toBe('home')
    expect(currentCell(state).dir).toBe('out')
  })

  it('refuses without enough money', () => {
    const state = game()
    state.money_cc = 0
    expect(() => buyHome(state, lotsOf(state.location)[0]!.id)).toThrow('錢不夠')
  })

  it('generates connected floors with aligned stairs for every district', () => {
    for (const district of Object.keys(homeRules.districts) as Home['district'][]) {
      for (let seed = 1; seed <= 15; seed++) {
        const state = newGame({ name: 'x', race: 'human', classId: 'fighter', seed, birthplace: 'soriel' })
        const base = { id: 'h1-soriel', name: '家', location: 'soriel', district, lot: { area: 'soriel/x', x: 1, y: 1, street: { x: 1, y: 2 } }, bought: { ...state.time }, price_cc: 0 }
        const { floors, areas } = withRng(state, (rng) => generateHome(base, rng))
        for (const key of floors) {
          const a = areas[key]!
          const start = a.cells.findIndex((c) => c.kind !== 'wall')
          const seen = reachable(a, start)
          a.cells.forEach((c, i) => { if (c.kind !== 'wall') expect(seen.has(i), `${district} ${seed} ${key}`).toBe(true) })
        }
        for (let i = 0; i + 1 < floors.length; i++) {
          const lower = areas[floors[i]!]!
          const up = find(lower, (c) => c.dir === 'up')
          const down = areas[floors[i + 1]!]!.cells[up.y * lower.width + up.x]!
          expect(down).toMatchObject({ kind: 'link', dir: 'down', link: { area: lower.key, ...up } })
        }
        expect(Object.values(areas).flatMap((a) => a.cells).filter((c) => c.dir === 'out')).toHaveLength(1)
      }
    }
  })
})

describe('going in and out', () => {
  it('walks through the door into the house and back to the street', () => {
    const state = game()
    const home = bought(state)
    const street = getArea(state, home.lot.area)
    standAt(state, street, home.lot.street.x, home.lot.street.y)
    moveTo(state, home.lot.x, home.lot.y)
    crossLink(state)
    expect(currentArea(state).kind).toBe('home')
    expect(homeOfArea(state, currentArea(state))?.id).toBe(home.id)
    expect(currentCell(state).dir).toBe('out')
    // 走開再踩回門口：回到街上
    const ground = currentArea(state)
    const p = position(state)
    const next = [[0, -1], [1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: p.x + dx!, y: p.y + dy! })).find((q) => ['floor', 'yard'].includes(ground.cells[q.y * ground.width + q.x]?.kind ?? ''))!
    moveTo(state, next.x, next.y)
    moveTo(state, p.x, p.y)
    expect(currentArea(state).kind).toBe('home')
    crossLink(state)
    expect(position(state)).toMatchObject({ area: home.lot.area, x: home.lot.street.x, y: home.lot.street.y })
  })
})

describe('furniture', () => {
  it('goes on matching floor cells, comes back to the pack, and adds comfort', () => {
    const state = game()
    const home = bought(state)
    const ground = groundOf(home)
    const floor = find(ground, (c) => c.kind === 'floor')
    expect(() => placeFurniture(state, ground, floor.x, floor.y, '木板床')).toThrow('行囊裡沒有')
    addItem(state.inventory, '木板床', 1)
    addItem(state.inventory, '噴水池', 1)
    expect(() => placeFurniture(state, ground, floor.x, floor.y, '噴水池')).toThrow('只能放在院子')
    placeFurniture(state, ground, floor.x, floor.y, '木板床')
    expect(state.inventory.find((i) => i.name === '木板床')).toBeUndefined()
    expect(hasBed(home)).toBe(true)
    expect(() => placeFurniture(state, ground, floor.x, floor.y, '噴水池')).toThrow('已經有家具')
    const yard = find(ground, (c) => c.kind === 'yard')
    placeFurniture(state, ground, yard.x, yard.y, '噴水池')
    expect(comfortOf(home)).toBe(1 + 3)
    expect(furnitureIn(home).map((f) => f.name).sort()).toEqual(['噴水池', '木板床'].sort())
    takeFurniture(state, ground, floor.x, floor.y)
    expect(hasBed(home)).toBe(false)
    expect(state.inventory.find((i) => i.name === '木板床')?.qty).toBe(1)
    // 在別人的地方不能擺
    expect(() => placeFurniture(state, getArea(state, home.lot.area), home.lot.street.x, home.lot.street.y, '木板床')).toThrow('自己的房子')
  })

  it('renames the house and its floors', () => {
    const state = game()
    const home = bought(state)
    renameHome(state, home.id, '新家')
    expect(home.name).toBe('新家')
    expect(Object.values(home.areas).every((a) => a.name.startsWith('新家・'))).toBe(true)
  })
})

describe('resting at home', () => {
  it('needs a bed, is free, and leaves you well rested in a comfortable house', () => {
    const state = game()
    const home = bought(state)
    const ground = groundOf(home)
    const spot = find(ground, (c) => c.kind === 'floor')
    standAt(state, ground, spot.x, spot.y)
    expect(longRestBlocked(state, 'home')).toBe('家裡還沒有床')
    addItem(state.inventory, '四柱大床', 1)
    placeFurniture(state, ground, spot.x, spot.y, '四柱大床')
    expect(longRestBlocked(state, 'home')).toBeNull()
    const money = state.money_cc
    const r = longRest(state, 'home')
    valid(r)
    expect(state.money_cc).toBe(money)
    expect(state.party[0]!.status).not.toContain('well_rested')

    // 舒適度夠：睡得香甜
    const yard = find(ground, (c) => c.kind === 'yard')
    addItem(state.inventory, '噴水池', 1)
    placeFurniture(state, ground, yard.x, yard.y, '噴水池')
    expect(comfortOf(home)).toBeGreaterThanOrEqual(homeRules.comfort_tiers[0]!.at)
    state.lastLongRest = undefined
    longRest(state, 'home')
    expect(state.party[0]!.status).toContain('well_rested')
  })
})

describe('workbenches', () => {
  it('give the high tool tier for their craft inside the house', () => {
    const state = game()
    const home = bought(state)
    const ground = groundOf(home)
    const yard = find(ground, (c) => c.kind === 'yard')
    addItem(state.inventory, '鍛造爐', 1)
    placeFurniture(state, ground, yard.x, yard.y, '鍛造爐')
    expect(workbenchFor(home, 'smithing')).toBe('鍛造爐')
    standAt(state, ground, yard.x, yard.y)
    expect(toolAccess(state, 'smithing')).toMatchObject({ tier: 3, source: '家裡的鍛造爐' })
    expect(toolAccess(state, 'tailoring').tier).toBeLessThan(3)
    standAt(state, getArea(state, home.lot.area), home.lot.street.x, home.lot.street.y)
    expect(toolAccess(state, 'smithing').tier).toBeLessThan(3)
  })
})

describe('companions staying home', () => {
  it('keeps bond, contract and affinity, frees the party slot, and comes back', () => {
    const state = game()
    const home = bought(state)
    const ground = groundOf(home)
    const rec = withRng(state, (rng) => generateNpc(state, rng, { level: 3, kind: 'adventurer', location: state.location }))
    const m = joinParty(state, rec, 'voluntary')
    setAffinity(state, m.id, 45)
    expect(() => stayHome(state, getArea(state, home.lot.area), m.id)).toThrow('自己的房子')
    const r = stayHome(state, ground, m.id)
    valid(r)
    expect(state.party.map((x) => x.id)).not.toContain(m.id)
    expect(residents(state, home.id).map((x) => x.id)).toEqual([m.id])
    expect(state.npcs![m.id]!.at?.area).toBe(ground.key)
    // 在房子的地圖上看得到，不會被當成可以雇用的人
    expect(areaOf(state, state.npcs![m.id]!)).toBe(ground.key)
    expect(hireable(state).map((r) => r.id)).not.toContain(m.id)
    expect(memberOrResident(state, ground, m.id)?.bond).toBe('voluntary')
    expect(memberOrResident(state, getArea(state, home.lot.area), m.id)).toBeUndefined()
    expect(() => stayHome(state, ground, state.party[0]!.id)).toThrow('主角')

    const back = leaveWithResident(state, ground, m.id)
    valid(back)
    const again = state.party.find((x) => x.id === m.id)!
    expect(again.bond).toBe('voluntary')
    expect(state.relationships![m.id]?.affinity ?? again.affinity).toBe(45)
    expect(state.npcs![m.id]!.staying).toBeUndefined()
    expect(residents(state, home.id)).toEqual([])
  })
})

describe('save schema 3', () => {
  it('adds an empty house list to older saves', () => {
    const state = game()
    delete state.homes
    state.schema = 2
    migrate(state)
    expect(state.homes).toEqual({})
    expect(state.schema).toBe(SAVE_SCHEMA)
  })
})
