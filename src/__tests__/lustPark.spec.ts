import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { finishCombat, startCombat } from '@/engine/combat'
import { setDefeatAdult } from '@/engine/content'
import { dungeonEncounters, enemies, geography, itemDef, landmarks, lewdRules, parkPlaza, specialMaps, stories } from '@/engine/data'
import {
  afterCombat, canTravelHere, crossLink, currentArea, currentCell, descend, enterLocation, findKind, generateLayer, layerKey, moveTo, placeAt, retreat, storeArea,
} from '@/engine/grid'
import { atParkExit, inPark, leavePark, PARK_LINK, parkRules } from '@/engine/park'
import { pcOf } from '@/engine/party'
import { sanitizeSpecialMapMod } from '@/engine/specialMapMods'
import { enterSpecial } from '@/engine/specialMaps'
import { newGame, withRng } from '@/engine/state'
import { hasFlag } from '@/engine/storyFlags'
import type { GameState, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

const PLAZA = 'sm_lust_park'
// 五個園區（集章的那五個）；緋夢樂園底下的兩座遺跡另外測（highDungeons.spec.ts）
const PARKS = geography.locations.filter((l) => l.park === PLAZA && !lewdRules.park.unstamped?.includes(l.id)).map((l) => l.id)

function game(): GameState {
  const state = newGame({ name: '莉雅', race: 'human', classId: 'fighter', seed: 5, birthplace: 'bloodplume' })
  enterLocation(state)
  return state
}

/** 站上入口廣場通往這個園區的通道，走進去 */
function enterPark(state: GameState, park: string) {
  enterSpecial(state, PLAZA)
  const c = specialMaps[PLAZA]!.connections!.find((x) => x.to.area === `${PARK_LINK}${park}`)!
  placeAt(state, currentArea(state), c.at.x, c.at.y)
  crossLink(state)
}

describe('緋夢樂園：資料', () => {
  it('五個園區都是沒有周邊的 3 層地下城，從入口廣場的通道進出；入口廣場在血羽城堡的售票亭裡', () => {
    expect(PARKS).toHaveLength(5)
    expect(Object.values(landmarks).find((l) => l.interior === PLAZA)?.location).toBe('bloodplume')
    const conns = specialMaps[PLAZA]!.connections!.map((c) => c.to.area)
    for (const park of PARKS) {
      expect(conns).toContain(`${PARK_LINK}${park}`)
      const enc = dungeonEncounters[park]!
      expect(enc.outskirts).toEqual([])
      for (const layer of ['shallow', 'middle', 'deep'] as const) {
        expect(enc[layer].length, `${park} ${layer}`).toBeGreaterThan(0)
        expect(enc.bosses?.[layer]?.length, `${park} ${layer}`).toBeGreaterThan(0)
      }
      // 層級：淺層 5～7、中層 8～10、深層 11～13
      const lv = (layer: 'shallow' | 'middle' | 'deep') => enc[layer].flat().map(([id]) => enemies[id]!.level)
      expect(Math.min(...lv('shallow'))).toBeGreaterThanOrEqual(5)
      expect(Math.max(...lv('deep'))).toBeLessThanOrEqual(13)
      expect(enemies[enc.bosses!.deep![0]![0]]!.level).toBe(13)
      expect(lewdRules.park.defeats[park]).toBeDefined()
    }
    // 整理過後通道還在（內容編輯器）
    const m = sanitizeSpecialMapMod(PLAZA, JSON.parse(JSON.stringify(specialMaps[PLAZA])))
    expect(m.connections?.length).toBe(7)
    // 掉落、寶箱的物品都存在
    for (const id of Object.keys(enemies).filter((x) => x.startsWith('lp_'))) {
      for (const l of enemies[id]!.loot ?? []) expect(itemDef(l.item), `${id} ${l.item}`).toBeDefined()
    }
    for (const [name] of parkRules().chest_items) expect(itemDef(name), name).toBeDefined()
    expect(stories.find((s) => s.id === 'park_stamps')?.start.requires?.flags).toHaveLength(5)
  })
})

describe('緋夢樂園：進出', () => {
  it('從通道走進園區的淺層；出口不能旅行，回到廣場站在原本的通道上', () => {
    const state = game()
    enterPark(state, 'park_beast')
    expect(state.location).toBe('park_beast')
    expect(currentArea(state).key).toBe(layerKey('park_beast', 1))
    expect(currentCell(state).kind).toBe('exit')
    expect(state.expedition?.park?.area).toBe(`sm/${PLAZA}`)
    expect(inPark(state)).toBe(true)
    expect(atParkExit(state)).toBe(true)
    expect(canTravelHere(state)).toBe(false)
    expect(() => retreat(state)).toThrow('已經在入口了')
    leavePark(state)
    expect(state.location).toBe('bloodplume')
    expect(currentArea(state).key).toBe(`sm/${PLAZA}`)
    expect(currentCell(state).kind).toBe('link')
    expect(state.expedition).toBeUndefined()
    expect(state.special).toBeDefined()
  })

  it('深層是最後一層：最終層主；淺層、中層的層主守著階梯', () => {
    const state = game()
    enterPark(state, 'park_garden')
    const area = withRng(state, (rng) => generateLayer(state, { id: 'park_garden', name: '淫植花園', region: 'south', type: 'dungeon', park: PLAZA }, 3, rng))
    expect(findKind(area, 'boss')).not.toBeNull()
    expect(area.cells.find((c) => c.kind === 'boss')?.then).toBeUndefined()
    const shallow = currentArea(state)
    expect(shallow.cells.find((c) => c.kind === 'boss')?.then).toBe('stairs_down')
    // 打倒淺層層主後下樓
    const b = findKind(shallow, 'boss')!
    const cell = shallow.cells[b.y * shallow.width + b.x]!
    cell.kind = 'stairs_down'
    placeAt(state, shallow, b.x, b.y)
    descend(state)
    expect(currentArea(state).layer).toBe(2)
    expect(state.expedition?.deepest).toBe(2)
  })
})

describe('緋夢樂園：魅氣、戰敗、擬態寶箱、集章', () => {
  it('每走一格魅氣增加，開戰時帶著；戰後剩下的慾望記下來', () => {
    const state = game()
    enterPark(state, 'park_insect')
    const area = currentArea(state)
    const pc = pcOf(state)
    const exit = findKind(area, 'exit')!
    // 走到隔壁的空地再走回來
    const next = [[0, -1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: exit.x + dx!, y: exit.y + dy! }))
      .find((p) => ['floor', 'safe'].includes(area.cells[p.y * area.width + p.x]?.kind ?? ''))!
    moveTo(state, next.x, next.y)
    moveTo(state, exit.x, exit.y)
    expect(state.expedition!.lust![pc.id]).toBeCloseTo(parkRules().step_lust * 2)
    state.expedition!.lust![pc.id] = 0.3
    const combat = startCombat(state, [['lp_aphro_leech', 1]])
    const me = combat.combatants.find((c) => c.id === pc.id)!
    expect(me.lust).toBeGreaterThanOrEqual(Math.round(me.lustMax! * 0.3))
    me.lust = Math.round(me.lustMax! * 0.5)
    for (const c of combat.combatants) if (c.side === 'enemy') c.hp = 0
    combat.status = 'victory'
    const report = finishCombat(state)
    valid(report)
    expect(state.expedition!.lust![pc.id]).toBeCloseTo(0.5, 1)
  })

  it('園區戰敗：套用專屬戰敗、回到廣場（關掉成人向的戰敗時只回廣場）', () => {
    const state = game()
    enterPark(state, 'park_theater')
    startCombat(state, [['lp_succ_dancer', 1]])
    for (const c of state.combat!.combatants) if (c.side === 'party') c.hp = 0
    state.combat!.status = 'defeat'
    const report = finishCombat(state)
    valid(report)
    expect(report.outcome.tags).toContain('園區的戰敗')
    expect(report.narration?.adult_scene).toContain('舞台')
    expect(pcOf(state).status).toContain('aroused')
    afterCombat(state, report)
    expect(state.location).toBe('bloodplume')
    expect(currentArea(state).key).toBe(`sm/${PLAZA}`)
    expect(state.expedition).toBeUndefined()

    const s2 = game()
    setDefeatAdult('off')
    enterPark(s2, 'park_theater')
    startCombat(s2, [['lp_succ_dancer', 1]])
    for (const c of s2.combat!.combatants) if (c.side === 'party') c.hp = 0
    s2.combat!.status = 'defeat'
    const r2 = finishCombat(s2)
    expect(r2.outcome.tags).not.toContain('園區的戰敗')
    afterCombat(s2, r2)
    expect(currentArea(s2).key).toBe(`sm/${PLAZA}`)
    setDefeatAdult('all')
  })

  it('擬態寶箱：走上去變成戰鬥', () => {
    const state = game()
    enterPark(state, 'park_aquarium')
    const area = currentArea(state)
    const exit = findKind(area, 'exit')!
    const i = [exit.y * area.width + exit.x - area.width, exit.y * area.width + exit.x - 1, exit.y * area.width + exit.x + 1]
      .find((k) => area.cells[k]?.kind === 'floor' || area.cells[k]?.kind === 'safe')!
    area.cells[i] = { kind: 'chest', level: 6, mimic: 'lp_mimic_s' }
    storeArea(state, area)
    const step = moveTo(state, i % area.width, Math.floor(i / area.width))
    expect(step.combat?.combatants.some((c) => c.defId === 'lp_mimic_s')).toBe(true)
    expect(area.cells[i]!.kind).toBe('encounter')
  })

  it('打倒最終層主蓋章', () => {
    const state = game()
    enterPark(state, 'park_beast')
    const area = withRng(state, (rng) => generateLayer(state, { id: 'park_beast', name: '淫獸牧場', region: 'south', type: 'dungeon', park: PLAZA }, 3, rng))
    storeArea(state, area)
    const b = findKind(area, 'boss')!
    state.position = { area: area.key, x: b.x, y: b.y }
    startCombat(state, area.cells[b.y * area.width + b.x]!.group!, { cell: { area: area.key, x: b.x, y: b.y } })
    for (const c of state.combat!.combatants) if (c.side === 'enemy') c.hp = 0
    state.combat!.status = 'victory'
    const report = finishCombat(state)
    expect(report.outcome.tags).toContain('集章')
    expect(hasFlag(state, 'park_stamp_park_beast')).toBe(true)
    expect(state.flags['story:park_stamp_park_beast']).toBe(true)
    expect(parkPlaza('park_beast')).toBe(PLAZA)
  })
})
