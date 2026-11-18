// 傳送陣（docs/HOMES.md 第 4.2 節，R32 X7）
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { homeRules, itemDef } from '@/engine/data'
import { currentArea, enterLocation, placeAt, position, type Area } from '@/engine/grid'
import { buyHome, furnitureSummary, lotsOf, placeFurniture } from '@/engine/homes'
import { circleHere, circleOf, stonesNeeded, teleport, teleportRefusal, teleportTargets } from '@/engine/teleport'
import { addItem, newGame } from '@/engine/state'
import type { GameState, Home, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

const ground = (home: Home) => Object.values(home.areas).find((a) => a.homeFloor === 'ground')!

function spot(area: Area, n = 0): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'floor' && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

/** 在現在這座城買一棟房子，在一樓擺一座傳送陣 */
function homeWithCircle(state: GameState): Home {
  const before = new Set(Object.keys(state.homes ?? {}))
  buyHome(state, lotsOf(state.location).find((l) => l.district !== 'manor')!.id)
  const home = Object.values(state.homes!).find((h) => !before.has(h.id))!
  const g = ground(home)
  const p = spot(g, 3)
  addItem(state.inventory, '傳送陣', 1)
  placeAt(state, g, p.x, p.y)
  placeFurniture(state, g, p.x, p.y, '傳送陣')
  return home
}

/** 索里耶爾與阿爾貝納各一棟有傳送陣的房子，站在索里耶爾那一座上 */
function twoHomes() {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'albena' })
  enterLocation(state)
  state.money_cc = 200000
  const far = homeWithCircle(state)
  state.location = 'soriel'
  enterLocation(state)
  const near = homeWithCircle(state)
  const c = circleOf(near)!
  placeAt(state, c.area, c.x, c.y)
  return { state, near, far }
}

describe('傳送陣', () => {
  it('家具：魔法物品店（城市以上），一棟只能一座；傳送石也是', () => {
    const def = itemDef('傳送陣')!
    expect(def.price_cc).toBe(12000)
    expect(def.min_location).toBe('city')
    expect(def.furniture?.function).toBe('teleport')
    expect(def.recipe?.craft).toBe('alchemy')
    expect(furnitureSummary(def.furniture)).toContain('傳送陣')
    expect(itemDef('傳送石')?.price_cc).toBe(250)
    const { state, near } = twoHomes()
    const g = ground(near)
    const p = spot(g, 8)
    addItem(state.inventory, '傳送陣', 1)
    expect(() => placeFurniture(state, g, p.x, p.y, '傳送陣')).toThrow('一棟房子只能有一座')
  })

  it('站在上面列出別棟有傳送陣的房子；傳送石不夠不能傳', () => {
    const { state, near, far } = twoHomes()
    expect(circleHere(state)?.id).toBe(near.id)
    expect(teleportTargets(state).map((t) => t.home.id)).toEqual([far.id])
    expect(teleportRefusal(state)).toContain(homeRules.teleport.stone)
    expect(() => teleport(state, far.id)).toThrow(homeRules.teleport.stone)
  })

  it('全隊每人一顆傳送石，一小時後站在另一座城的傳送陣上，不經過城門', () => {
    const { state, far } = twoHomes()
    addItem(state.inventory, '傳送石', stonesNeeded(state) + 1)
    const hour = state.time.hour
    const r = teleport(state, far.id)
    valid(r)
    expect(r.kind).toBe('travel')
    expect(r.outcome.summary).toContain('索里耶爾的家裡傳送過來')
    expect(state.location).toBe('albena')
    expect(state.time.hour).toBe((hour! + homeRules.teleport.hours) % 24)
    const c = circleOf(far)!
    expect(currentArea(state).key).toBe(c.area.key)
    expect(position(state)).toMatchObject({ x: c.x, y: c.y })
    expect(state.inventory.find((i) => i.name === '傳送石')?.qty).toBe(1)
    // 回程也可以
    expect(teleportTargets(state).map((t) => t.home.location)).toEqual(['soriel'])
  })

  it('傳送到別的城：和走進那座城一樣記成到過、建立城裡的人（不經過城門）', () => {
    const { state, far } = twoHomes()
    addItem(state.inventory, '傳送石', stonesNeeded(state))
    state.visitedTowns = ['soriel']
    delete state.rosters?.albena
    teleport(state, far.id)
    expect(state.location).toBe('albena')
    expect(state.visitedTowns).toContain('albena')
    expect(Object.keys(state.rosters ?? {})).toContain('albena')
    // 站在傳送陣上，不是城門口
    const c = circleOf(far)!
    expect(currentArea(state).key).toBe(c.area.key)
  })

  it('被制伏的人還沒處置、目的地那一層還在施工時不能傳', () => {
    const { state, far } = twoHomes()
    addItem(state.inventory, '傳送石', 5)
    state.captives = { npcs: ['x'], area: currentArea(state).key } as never
    expect(teleportRefusal(state)).toContain('處置')
    delete state.captives
    expect(teleportRefusal(state)).toBeUndefined()
    // 遠的那一棟：傳送陣所在的那一層還在施工
    far.construction = { kind: 'floor', until: state.time.day + 3, area: circleOf(far)!.area.key }
    expect(teleportTargets(state)[0]!.blocked).toContain('施工')
  })
})
