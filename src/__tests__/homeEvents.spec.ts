// 家裡的事（R31 H6，docs/HOMES.md 第 8.1 節）
import { afterEach, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { sendHome } from '@/engine/away'
import { buySlave, marketStock } from '@/engine/companions'
import { enterLocation, placeAt, type Area } from '@/engine/grid'
import { buyHome, lotsOf, placeFurniture } from '@/engine/homes'
import { homeCandidates, homeTemplates, maybeHomeEvent, staffFor } from '@/engine/homeEvents'
import { lewdOf } from '@/engine/lewd'
import { travelEvents } from '@/engine/road'
import { longRest } from '@/engine/rest'
import { setAffinity } from '@/engine/social'
import { assignChore, breakfastOf, candidates, hireStaff, workersFor } from '@/engine/staff'
import { addItem, advanceTime, newGame } from '@/engine/state'
import { answerTownEvent, pendingTownEvent } from '@/engine/townEvents'
import { builtinEventRules, sanitizeEventRules, sanitizeTravelEvent } from '@/engine/travelEventMods'
import type { GameState, Home, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

const rules = travelEvents.home!
const saved = JSON.parse(JSON.stringify(rules.chance)) as typeof rules.chance
afterEach(() => Object.assign(rules.chance, saved))

function game(birthplace = 'soriel'): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace })
  enterLocation(state)
  state.money_cc = 10_000_000
  return state
}

const ground = (home: Home) => Object.values(home.areas).find((a) => a.homeFloor === 'ground')!

function spot(area: Area, n = 0): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'floor' && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

function moveIn(state: GameState, district?: string): Home {
  const lot = lotsOf(state.location).find((l) => !district || l.district === district)!
  buyHome(state, lot.id)
  const home = Object.values(state.homes!)[0]!
  const p = spot(ground(home), 5)
  placeAt(state, ground(home), p.x, p.y)
  return home
}

function hire(state: GameState, home: Home, job: string): string {
  const c = candidates(state, home.location).find((r) => r.staff!.job === job)!
  hireStaff(state, c.id)
  return c.id
}

/** 只留一個事件能抽：讓這件事一定發生 */
function only(state: GameState, id: string) {
  state.homeEvents = { seen: Object.fromEntries(homeTemplates().filter((t) => t.id !== id).map((t) => [t.id, state.time.day])), recent: [] }
}

describe('家裡的事的資料', () => {
  it('內建 10 件：一般 6 件、成人向 4 件；整理之後欄位不變', () => {
    const list = homeTemplates()
    expect(list).toHaveLength(10)
    expect(list.filter((t) => t.tags?.includes('adult'))).toHaveLength(4)
    for (const t of list) {
      expect(t.kind).toBe('choice')
      const { id, ...raw } = t
      expect(sanitizeTravelEvent(id, raw as never, false), id).toEqual(t)
    }
  })
})

describe('事件設定', () => {
  it('舊的事件設定沒有家裡的事：補上內建的；數值夾在範圍內', () => {
    const { home: _h, ...old } = builtinEventRules()
    const { chance, cooldown_hours, repeat_days } = builtinEventRules().home
    expect(sanitizeEventRules(old as never).home).toEqual({ chance, cooldown_hours, repeat_days })
    expect(sanitizeEventRules({ ...old, home: { chance: { step: 5, rest: -1 }, cooldown_hours: 10, repeat_days: 2 } } as never).home).toEqual({ chance: { step: 1, rest: 0 }, cooldown_hours: 10, repeat_days: 2 })
  })
})

describe('觸發', () => {
  it('沒有家僕時不會發生；有家僕時在家走動會遇到，事件裡代入那位家僕', () => {
    const state = game()
    const home = moveIn(state, 'house')
    rules.chance.step = 1
    expect(maybeHomeEvent(state, 'step')).toBe(false)
    const id = hire(state, home, 'maid')
    only(state, 'hm_letter')
    expect(maybeHomeEvent(state, 'step')).toBe(true)
    expect(state.townEvent).toEqual({ template: 'hm_letter', staff: id })
    const ev = pendingTownEvent(state)!
    expect(ev.text).toContain(state.npcs![id]!.name)
    expect(ev.text).not.toContain('{a}')
  })

  it('職位、雇來的或奴隸、親密度不符的不會抽到', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const maid = hire(state, home, 'maid')
    const byId = (id: string) => homeTemplates().find((t) => t.id === id)!
    expect(staffFor(state, home, byId('hm_new_dish'))).toEqual([])
    expect(staffFor(state, home, byId('hm_bath')).map((r) => r.id)).toEqual([maid])
    expect(staffFor(state, home, byId('hm_command'))).toEqual([])
    setAffinity(state, maid, 10)
    expect(staffFor(state, home, byId('hm_night_visit'))).toEqual([])
    setAffinity(state, maid, 50)
    expect(staffFor(state, home, byId('hm_night_visit')).map((r) => r.id)).toEqual([maid])
    // 走動時不會抽到只在長休醒來的
    expect(homeCandidates(state, home, 'step').some((t) => t.id === 'hm_night_visit')).toBe(false)
  })

  it('冷卻：遇過之後隔一段時間才會再遇到', () => {
    const state = game()
    const home = moveIn(state, 'house')
    hire(state, home, 'maid')
    rules.chance.step = 1
    only(state, 'hm_slacking')
    expect(maybeHomeEvent(state, 'step')).toBe(true)
    // 放一馬（准假的話家僕請假中，這幾天就沒有人能遇到事了）
    answerTownEvent(state, 1)
    state.homeEvents!.seen = { hm_slacking: state.time.day }
    expect(maybeHomeEvent(state, 'step')).toBe(false)
    advanceTime(state, rules.cooldown_hours)
    expect(maybeHomeEvent(state, 'step')).toBe(true)
  })

  it('在家長休醒來時：時段看入睡的時間（夜裡的侍寢）', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const g = ground(home)
    const bed = spot(g, 0)
    addItem(state.inventory, '木板床', 1)
    placeFurniture(state, g, bed.x, bed.y, '木板床')
    const maid = hire(state, home, 'maid')
    setAffinity(state, maid, 60)
    only(state, 'hm_night_visit')
    rules.chance.rest = 1
    state.time = { day: state.time.day, hour: 22, minute: 0 }
    state.lastLongRest = undefined
    longRest(state, 'home')
    expect(state.townEvent?.template).toBe('hm_night_visit')
  })
})

describe('結果', () => {
  it('准假：效果停 3 天，親密度上升', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const cook = hire(state, home, 'cook')
    const before = state.relationships![cook]!.affinity
    state.townEvent = { template: 'hm_letter', staff: cook }
    const r = answerTownEvent(state, 0)
    valid(r)
    expect(r.outcome.tags).toContain('家裡的事')
    expect(state.relationships![cook]!.affinity).toBe(before + 5)
    expect(workersFor(state, home.id, 'cook')).toEqual([])
    expect(breakfastOf(state, home)).toBeUndefined()
    advanceTime(state, 24 * 3)
    expect(workersFor(state, home.id, 'cook').map((x) => x.id)).toEqual([cook])
  })

  it('扣工錢：當作那天已經付了', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const id = hire(state, home, 'maid')
    const paid = state.npcs![id]!.staff!.paidUntil
    state.townEvent = { template: 'hm_slacking', staff: id }
    answerTownEvent(state, 2)
    expect(state.npcs![id]!.staff!.paidUntil).toBe(paid + 1)
  })

  it('打破了花瓶：一件裝飾家具收回行囊', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const g = ground(home)
    const p = spot(g, 1)
    addItem(state.inventory, '盆栽', 1)
    placeFurniture(state, g, p.x, p.y, '盆栽')
    const id = hire(state, home, 'maid')
    state.townEvent = { template: 'hm_vase', staff: id }
    answerTownEvent(state, 0)
    expect(g.cells[p.y * g.width + p.x]!.furniture).toBeUndefined()
    expect(state.inventory.find((i) => i.name === '盆栽')?.qty).toBe(1)
  })

  it('主人的命令：做家務的奴隸順從上升，進入親密場景', () => {
    const state = game('albena')
    const l = marketStock(state, 'public')[0]!
    buySlave(state, 'public', l.npc)
    const home = moveIn(state)
    sendHome(state, home.id, l.npc)
    const c = state.npcs![l.npc]!.character!
    c.lewd = { ...lewdOf(c), submission: 60 } as typeof c.lewd
    assignChore(state, l.npc, 'maid')
    state.townEvent = { template: 'hm_command', staff: l.npc }
    const r = answerTownEvent(state, 0)
    expect(lewdOf(c).submission).toBe(62)
    expect(r.narration?.adult_scene).toContain(c.name)
  })

  it('家僕不在了（辭職、解雇）：等待中的事件作廢', () => {
    const state = game()
    const home = moveIn(state, 'house')
    const id = hire(state, home, 'maid')
    state.townEvent = { template: 'hm_letter', staff: id }
    delete state.npcs![id]!.staff
    expect(pendingTownEvent(state)).toBeUndefined()
  })
})
