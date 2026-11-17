// 房子的擴充（R32，docs/plan/roadmap/HOME_EXPANSION_PLAN.md）：舒適度分段、成套家具、熟成桶
import { describe, expect, it } from 'vitest'
import { companionRules, homeRules, itemDef } from '@/engine/data'
import { sanitizeItem } from '@/engine/mods'
import { enterLocation, placeAt, type Area } from '@/engine/grid'
import { buyHome, comfortOf, comfortTier, completeSets, lotsOf, placeFurniture, setProgress } from '@/engine/homes'
import { sanitizeHomeRules } from '@/engine/homeMods'
import { longRest } from '@/engine/rest'
import { addItem, newGame } from '@/engine/state'
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
