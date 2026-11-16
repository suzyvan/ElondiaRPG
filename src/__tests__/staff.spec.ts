// 家僕（docs/HOMES.md 第 8 節，R31）
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { homeRules } from '@/engine/data'
import { enterLocation, placeAt, type Area } from '@/engine/grid'
import { buyHome, comfortOf, lotsOf, placeFurniture } from '@/engine/homes'
import { peopleHere } from '@/engine/population'
import { longRest } from '@/engine/rest'
import {
  ackStaffNotes, breakfastOf, candidates, fireStaff, hireStaff, homeOwed, owedDays, payWages, staffCap, staffOf, wageHere,
} from '@/engine/staff'
import { addItem, advanceTime, newGame } from '@/engine/state'
import type { GameState, Home, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

/** 買下一棟宅邸（不是貴族區的豪宅），站進一樓 */
function moveIn(state: GameState): Home {
  const lot = lotsOf(state.location).find((l) => l.district === 'house')!
  buyHome(state, lot.id)
  const home = Object.values(state.homes!)[0]!
  const p = spot(ground(home), 5)
  placeAt(state, ground(home), p.x, p.y)
  return home
}

const ground = (home: Home) => Object.values(home.areas).find((a) => a.homeFloor === 'ground')!

function spot(area: Area, n = 0): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'floor' && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

/** 雇一位這個職位的應徵者 */
function hire(state: GameState, home: Home, job: string): string {
  const c = candidates(state, home.location).find((r) => r.staff!.job === job)!
  valid(hireStaff(state, c.id))
  return c.id
}

describe('應徵者', () => {
  it('同一批固定、雇下之前不寫進 NPC 登錄；過了一批就換人', () => {
    const state = game()
    const home = moveIn(state)
    const a = candidates(state, home.location)
    const jobs = new Set(a.map((r) => r.staff!.job))
    expect([...jobs].sort()).toEqual(['cook', 'gardener', 'maid', 'steward'])
    expect(a.every((r) => r.kind === 'commoner')).toBe(true)
    expect(a.some((r) => state.npcs?.[r.id])).toBe(false)
    expect(candidates(state, home.location).map((r) => r.id)).toEqual(a.map((r) => r.id))
    advanceTime(state, 24 * homeRules.staff.refresh_days)
    expect(candidates(state, home.location)[0]!.id).not.toBe(a[0]!.id)
  })
})

describe('雇用', () => {
  it('先付第一天的工錢，住進房子、出現在這裡的人；雇了就不在應徵名單', () => {
    const state = game()
    const home = moveIn(state)
    const money = state.money_cc
    const id = hire(state, home, 'maid')
    const rec = state.npcs![id]!
    expect(rec.staff).toMatchObject({ home: home.id, job: 'maid', paidUntil: state.time.day })
    expect(state.money_cc).toBe(money - wageHere(state, 'maid'))
    expect(rec.at?.area).toBe(ground(home).key)
    expect(peopleHere(state).some((p) => p.rec.id === id)).toBe(true)
    expect(candidates(state, home.location).some((r) => r.id === id)).toBe(false)
    expect(state.relationships?.[id]).toBeDefined()
  })

  it('有上限：宅邸 3 人', () => {
    const state = game()
    const home = moveIn(state)
    expect(staffCap(state, home)).toBe(homeRules.staff.caps.house)
    hire(state, home, 'maid')
    hire(state, home, 'cook')
    hire(state, home, 'gardener')
    const more = candidates(state, home.location).find((r) => r.staff!.job === 'maid' || r.staff!.job === 'cook')
    if (more) expect(() => hireStaff(state, more.id)).toThrow('家僕滿了')
  })

  it('不在自己的房子裡不能雇', () => {
    const state = game()
    const home = moveIn(state)
    const c = candidates(state, home.location)[0]!
    enterLocation(state)
    expect(() => hireStaff(state, c.id)).toThrow('自己的房子')
  })
})

describe('工錢', () => {
  it('欠著，回家時結清；錢不夠時付得了幾天就付幾天', () => {
    const state = game()
    const home = moveIn(state)
    const id = hire(state, home, 'cook')
    advanceTime(state, 24 * 3)
    const rec = state.npcs![id]!
    expect(owedDays(state, rec)).toBe(3)
    const wage = rec.staff!.wage_cc
    state.money_cc = wage * 2 + 1
    const r = payWages(state)
    valid(r)
    expect(owedDays(state, rec)).toBe(1)
    expect(state.money_cc).toBe(1)
    state.money_cc = 1000
    payWages(state)
    expect(homeOwed(state, home.id)).toBe(0)
    expect(() => payWages(state)).toThrow('沒有欠工錢')
  })

  it('欠超過 7 天就辭職：親密度下降、記一段記憶，回家時看到，看過寫進日誌', () => {
    const state = game()
    const home = moveIn(state)
    const id = hire(state, home, 'maid')
    const before = state.relationships![id]!.affinity
    enterLocation(state)
    advanceTime(state, 24 * (homeRules.staff.quit_days + 1))
    const rec = state.npcs![id]!
    expect(rec.staff).toBeUndefined()
    expect(rec.at).toBeUndefined()
    expect(rec.haunts?.length).toBeGreaterThan(0)
    expect(state.relationships![id]!.affinity).toBe(before + homeRules.staff.quit_affinity)
    expect(state.memories?.some((m) => m.participants.includes(id) && m.summary.includes('辭職'))).toBe(true)
    expect(home.staffNotes?.[0]?.text).toContain('辭職')
    const p = spot(ground(home), 5)
    placeAt(state, ground(home), p.x, p.y)
    const r = ackStaffNotes(state)
    valid(r)
    expect(r.outcome.tags).toEqual(expect.arrayContaining(['家務', '辭職']))
    expect(home.staffNotes).toBeUndefined()
  })

  it('解雇：先結清欠的工錢', () => {
    const state = game()
    const home = moveIn(state)
    const id = hire(state, home, 'gardener')
    advanceTime(state, 24 * 2)
    const owed = state.npcs![id]!.staff!.wage_cc * 2
    state.money_cc = owed - 1
    expect(() => fireStaff(state, id)).toThrow('先結清')
    state.money_cc = owed
    valid(fireStaff(state, id))
    expect(state.money_cc).toBe(0)
    expect(staffOf(state, home.id)).toEqual([])
  })
})

describe('效果', () => {
  it('女僕加舒適度，兩個不疊加', () => {
    const state = game()
    const home = moveIn(state)
    const base = comfortOf(home, state)
    hire(state, home, 'maid')
    expect(comfortOf(home, state)).toBe(base + homeRules.staff.jobs.maid.comfort!)
    const second = candidates(state, home.location).find((r) => r.staff!.job === 'maid')
    if (second) {
      hireStaff(state, second.id)
      expect(comfortOf(home, state)).toBe(base + homeRules.staff.jobs.maid.comfort!)
    }
    expect(comfortOf(home)).toBe(base)
  })

  it('廚師：在家長休後全隊吃早餐；有石砌大灶時更好', () => {
    const state = game()
    const home = moveIn(state)
    const g = ground(home)
    const bed = spot(g, 0)
    addItem(state.inventory, '木板床', 1)
    placeFurniture(state, g, bed.x, bed.y, '木板床')
    hire(state, home, 'cook')
    expect(breakfastOf(state, home)).toBe('fed_well')
    state.lastLongRest = undefined
    const r = longRest(state, 'home')
    valid(r)
    expect(state.party[0]!.status).toContain('fed_well')
    expect(r.outcome.summary).toContain('早餐')
    const stove = spot(g, 1)
    addItem(state.inventory, '石砌大灶', 1)
    placeFurniture(state, g, stove.x, stove.y, '石砌大灶')
    expect(breakfastOf(state, home)).toBe('fed_fine')
  })
})
