// 家僕（docs/HOMES.md 第 8 節，R31）
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { homeRules } from '@/engine/data'
import { prepareAction, resolveAction } from '@/engine/actions'
import { sendHome } from '@/engine/away'
import { buySlave, marketStock } from '@/engine/companions'
import { lewdOf } from '@/engine/lewd'
import { generateNpc } from '@/engine/npcs'
import { Rng } from '@/engine/rng'
import { ensureRelationship, setAffinity } from '@/engine/social'
import { currentArea, enterLocation, placeAt, position, type Area } from '@/engine/grid'
import { buyHome, comfortOf, leaveWithResident, lotsOf, placeFurniture } from '@/engine/homes'
import { plant } from '@/engine/garden'
import { depositItem, depositMoney, homeMoney, homeStock } from '@/engine/storage'
import { peopleHere } from '@/engine/population'
import { longRest } from '@/engine/rest'
import {
  ackStaffNotes, assignChore, choreRefusal, choreSlaves, staffInviteRefusal, workersFor, breakfastOf, candidates, fireStaff, hireStaff, homeOwed, owedDays, payWages, staffCap, staffOf, wageHere,
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

describe('園丁（H2）', () => {
  /** 院子擺菜圃、種莓果苗；一樓擺木箱 */
  function garden(state: GameState, home: Home, withChest: boolean) {
    const g = ground(home)
    const i = g.cells.findIndex((c) => c.kind === 'yard')
    const yard = { x: i % g.width, y: Math.floor(i / g.width) }
    addItem(state.inventory, '菜圃', 1)
    placeFurniture(state, g, yard.x, yard.y, '菜圃')
    addItem(state.inventory, '莓果苗', 3)
    placeAt(state, g, yard.x, yard.y)
    plant(state, g, yard.x, yard.y, '莓果苗')
    if (withChest) {
      const box = spot(g, 2)
      addItem(state.inventory, '木箱', 1)
      placeFurniture(state, g, box.x, box.y, '木箱')
      depositItem(state, g, box.x, box.y, '莓果苗')
    }
    return g.cells[i]!
  }

  it('每天把成熟的作物收進箱子，箱子裡有種子就重新播種；回家時看到', () => {
    const state = game()
    const home = moveIn(state)
    const plot = garden(state, home, true)
    hire(state, home, 'gardener')
    state.money_cc = 100000
    enterLocation(state)
    advanceTime(state, 24 * 7)
    // 莓果苗 3 天：第 3、6 天各收一輪，每輪用箱子裡的一份種子重新播種（第三輪還在長）
    expect(homeStock(home).get('野莓')).toBeGreaterThanOrEqual(4)
    expect(homeStock(home).has('莓果苗')).toBe(false)
    expect(plot.crop?.seed).toBe('莓果苗')
    expect(home.staffNotes?.some((n) => n.tag === '收成' && n.text.includes('野莓'))).toBe(true)
  })

  it('沒有箱子時留在苗圃上', () => {
    const state = game()
    const home = moveIn(state)
    const plot = garden(state, home, false)
    hire(state, home, 'gardener')
    advanceTime(state, 24 * 4)
    expect(plot.crop?.seed).toBe('莓果苗')
    expect(home.staffNotes?.some((n) => n.text.includes('箱子滿了'))).toBe(true)
  })
})

describe('管家（H3）', () => {
  /** 一樓擺保險箱、存錢 */
  function safe(state: GameState, home: Home, money: number) {
    const g = ground(home)
    const p = spot(g, 3)
    addItem(state.inventory, '保險箱', 1)
    placeFurniture(state, g, p.x, p.y, '保險箱')
    if (money) depositMoney(state, g, p.x, p.y, money)
  }

  it('上限 +1', () => {
    const state = game()
    const home = moveIn(state)
    const base = staffCap(state, home)
    hire(state, home, 'steward')
    expect(staffCap(state, home)).toBe(base + homeRules.staff.steward_bonus)
  })

  it('每天從保險箱付工錢，家僕不會辭職；錢不夠時寫進「你不在的時候」', () => {
    const state = game()
    const home = moveIn(state)
    const maid = hire(state, home, 'maid')
    const steward = hire(state, home, 'steward')
    const daily = state.npcs![maid]!.staff!.wage_cc + state.npcs![steward]!.staff!.wage_cc
    safe(state, home, daily * 10)
    enterLocation(state)
    advanceTime(state, 24 * 10)
    expect(homeOwed(state, home.id)).toBe(0)
    expect(homeMoney(home)).toBe(0)
    expect(home.staffNotes?.some((n) => n.tag === '付工錢' && n.text.includes('保險箱'))).toBe(true)
    advanceTime(state, 24 * 3)
    expect(homeOwed(state, home.id)).toBe(daily * 3)
    expect(home.staffNotes?.some((n) => n.text.includes('不夠'))).toBe(true)
    expect(staffOf(state, home.id)).toHaveLength(2)
  })

  it('提醒：快要辭職的人、可以收成的作物', () => {
    const state = game()
    const home = moveIn(state)
    const maid = hire(state, home, 'maid')
    hire(state, home, 'steward')
    const g = ground(home)
    const i = g.cells.findIndex((c) => c.kind === 'yard')
    addItem(state.inventory, '菜圃', 1)
    placeFurniture(state, g, i % g.width, Math.floor(i / g.width), '菜圃')
    addItem(state.inventory, '莓果苗', 1)
    placeAt(state, g, i % g.width, Math.floor(i / g.width))
    plant(state, g, i % g.width, Math.floor(i / g.width), '莓果苗')
    enterLocation(state)
    advanceTime(state, 24 * homeRules.staff.quit_days)
    const texts = (home.staffNotes ?? []).map((n) => n.text)
    expect(texts.some((t) => t.includes(state.npcs![maid]!.name) && t.includes('明天再不付'))).toBe(true)
    expect(texts.filter((t) => t.includes('可以收成了'))).toHaveLength(1)
  })
})

describe('請認識的人來家裡做事（H4）', () => {
  /** 在城裡主角旁邊擺一個認識的普通人 */
  function neighbour(state: GameState, affinity: number, kind: 'commoner' | 'adventurer' = 'commoner') {
    const rec = generateNpc(state, new Rng(7), { kind, location: state.location, tags: ['commoner'] }, 'cmn')
    const p = position(state)
    rec.at = { area: currentArea(state).key, x: p.x, y: p.y, until: 1e9 }
    rec.haunts = [{ location: state.location, zone: 'town', weight: 1 }] as never
    ensureRelationship(state, rec)
    setAffinity(state, rec.id, affinity)
    return rec
  }

  it('沒有房子、親密度不夠、冒險者都不行', () => {
    const state = game()
    const a = neighbour(state, 50)
    expect(staffInviteRefusal(state, a.id)).toContain('沒有你的房子')
    const lot = lotsOf(state.location).find((l) => l.district === 'house')!
    buyHome(state, lot.id)
    enterLocation(state)
    const b = neighbour(state, 10)
    expect(staffInviteRefusal(state, b.id)).toContain('親密度')
    const c = neighbour(state, 50, 'adventurer')
    expect(staffInviteRefusal(state, c.id)).toContain('普通人')
    const d = neighbour(state, 50)
    expect(staffInviteRefusal(state, d.id)).toBeUndefined()
  })

  it('成功就搬進房子當家僕；部分成功要等下次長休再問', () => {
    const state = game()
    const lot = lotsOf(state.location).find((l) => l.district === 'house')!
    buyHome(state, lot.id)
    enterLocation(state)
    const home = Object.values(state.homes!)[0]!
    const rec = neighbour(state, 60)
    prepareAction(state, { kind: 'staff_invite', target: `${rec.id}:cook`, text: '' })
    state.pendingAction!.natural = 20
    resolveAction(state, null)
    expect(state.npcs![rec.id]!.staff).toMatchObject({ home: home.id, job: 'cook' })
    expect(state.npcs![rec.id]!.at?.area).toBe(ground(home).key)

    const other = neighbour(state, 40)
    prepareAction(state, { kind: 'staff_invite', target: `${other.id}:maid`, text: '' })
    state.pendingAction!.natural = 1
    resolveAction(state, null)
    expect(state.npcs![other.id]!.staff).toBeUndefined()
    expect(staffInviteRefusal(state, other.id)).toContain('再想想')
  })
})

describe('奴隸做家務（H4）', () => {
  /** 阿爾貝納有奴隸市場：買一個奴隸、買房子、讓他留在家裡 */
  function slaveAtHome() {
    const state = newGame({ name: '莉雅', race: 'human', classId: 'bard', seed: 11, birthplace: 'albena' })
    enterLocation(state)
    state.money_cc = 10_000_000
    const l = marketStock(state, 'public')[0]!
    buySlave(state, 'public', l.npc)
    buyHome(state, lotsOf('albena')[0]!.id)
    const home = Object.values(state.homes!)[0]!
    const p = spot(ground(home), 5)
    placeAt(state, ground(home), p.x, p.y)
    sendHome(state, home.id, l.npc)
    return { state, home, id: l.npc }
  }

  it('順從夠才肯做；效果和雇來的一樣、不佔上限，每天順從 +1', () => {
    const { state, home, id } = slaveAtHome()
    const c = state.npcs![id]!.character!
    c.lewd = { ...(c.lewd ?? {}), submission: 0 }
    expect(choreRefusal(state, id)).toContain('順從')
    c.lewd.submission = homeRules.staff.slave_chore_submission
    assignChore(state, id, 'cook')
    expect(choreSlaves(state, home.id).map((r) => r.id)).toEqual([id])
    expect(workersFor(state, home.id, 'cook')).toHaveLength(1)
    expect(breakfastOf(state, home)).toBe('fed_well')
    expect(staffOf(state, home.id)).toHaveLength(0)
    expect(() => assignChore(state, id, 'steward')).toThrow('管家')
    const before = lewdOf(c).submission
    advanceTime(state, 24 * 2)
    expect(lewdOf(c).submission).toBe(before + 2 * homeRules.staff.slave_chore_daily)
    // 帶出門就不做了
    leaveWithResident(state, currentArea(state), id)
    expect(state.npcs![id]!.chore).toBeUndefined()
    expect(workersFor(state, home.id, 'cook')).toHaveLength(0)
  })
})
