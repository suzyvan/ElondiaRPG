// 同居（docs/HOMES.md 第 8.2 節，R32 X6）
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { homeRules } from '@/engine/data'
import { prepareAction, resolveAction } from '@/engine/actions'
import {
  askToLeave, cohabitantsHome, cohabitantsOf, cohabitDc, cohabitRefusal, freeBed, settleCohabitant, takeCohabitant,
} from '@/engine/cohabit'
import { generateNpc } from '@/engine/npcs'
import { Rng } from '@/engine/rng'
import { ensureRelationship, setAffinity } from '@/engine/social'
import { currentArea, enterLocation, placeAt, position, type Area } from '@/engine/grid'
import { buyHome, comfortOf, lotsOf, placeFurniture } from '@/engine/homes'
import { adventurersInTown, peopleHere } from '@/engine/population'
import { longRest } from '@/engine/rest'
import { withHomeStaff } from '@/engine/staff'
import { addItem, advanceTime, newGame } from '@/engine/state'
import type { GameState, Home, NpcRecord, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

const ground = (home: Home) => Object.values(home.areas).find((a) => a.homeFloor === 'ground')!

function spot(area: Area, n = 0): { x: number; y: number } {
  const all = area.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'floor' && !c.furniture)
  const i = all[n]!.i
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

/** 買下一棟宅邸，在一樓擺 beds 張床，站進一樓 */
function moveIn(state: GameState, beds = 1): Home {
  const lot = lotsOf(state.location).find((l) => l.district === 'house')!
  buyHome(state, lot.id)
  const home = Object.values(state.homes!)[0]!
  const g = ground(home)
  for (let i = 0; i < beds; i++) {
    const p = spot(g, 2 + i * 6)
    addItem(state.inventory, '木板床', 1)
    placeAt(state, g, p.x, p.y)
    placeFurniture(state, g, p.x, p.y, '木板床')
  }
  const p = spot(g, 1)
  placeAt(state, g, p.x, p.y)
  return home
}

/** 在主角旁邊擺一個認識的人 */
function friend(state: GameState, affinity: number, kind: 'commoner' | 'adventurer' = 'commoner', seed = 7): NpcRecord {
  const rec = generateNpc(state, new Rng(seed), { kind, location: state.location, tags: [kind === 'commoner' ? 'commoner' : 'warrior'] }, kind === 'commoner' ? 'cmn' : 'adv')
  const p = position(state)
  rec.at = { area: currentArea(state).key, x: p.x, y: p.y, until: 1e9 }
  rec.haunts = [{ location: state.location, zone: 'town', weight: 1 }] as never
  ;(state.npcs ??= {})[rec.id] = rec
  ensureRelationship(state, rec)
  setAffinity(state, rec.id, affinity)
  return rec
}

function invite(state: GameState, id: string, natural: number) {
  prepareAction(state, { kind: 'cohabit_invite', target: id, text: '' })
  state.pendingAction!.natural = natural
  return resolveAction(state, null)
}

describe('誰可以搬進來', () => {
  it('親密度不夠、沒有空床、沒有房子都不行', () => {
    const state = game()
    const a = friend(state, 90)
    expect(cohabitRefusal(state, a.id)).toContain('沒有你的房子')
    moveIn(state, 0)
    expect(cohabitRefusal(state, a.id)).toContain('沒有空的床')
    const b = friend(state, 70, 'commoner', 8)
    expect(cohabitRefusal(state, b.id)).toContain(`親密度要 ${homeRules.cohabit.min_affinity}`)
  })

  it('DC 隨親密度降低', () => {
    const state = game()
    moveIn(state)
    const a = friend(state, 80)
    const low = cohabitDc(state, a.id)
    setAffinity(state, a.id, 100)
    expect(low - cohabitDc(state, a.id)).toBe(Math.floor(20 / homeRules.cohabit.affinity_step))
  })
})

describe('邀請他搬進來', () => {
  it('成功就住進房子、站在床邊；床被佔了就不能再請第二個人', () => {
    const state = game()
    const home = moveIn(state)
    const rec = friend(state, 90)
    valid(invite(state, rec.id, 20))
    expect(rec.cohabit?.home).toBe(home.id)
    expect(rec.cohabit?.bed).toBeTruthy()
    expect(rec.at?.area).toBe(ground(home).key)
    expect(Math.abs(rec.at!.x - rec.cohabit!.bed!.x) + Math.abs(rec.at!.y - rec.cohabit!.bed!.y)).toBeLessThanOrEqual(2)
    expect(peopleHere(state).some((p) => p.rec.id === rec.id)).toBe(true)
    expect(freeBed(state, home)).toBeUndefined()
    const other = friend(state, 95, 'commoner', 9)
    expect(cohabitRefusal(state, other.id)).toContain('沒有空的床')
  })

  it('失敗這週不能再問', () => {
    const state = game()
    moveIn(state, 2)
    const a = friend(state, 95)
    invite(state, a.id, 1)
    expect(a.cohabit).toBeUndefined()
    expect(cohabitRefusal(state, a.id)).toContain('這週')
    advanceTime(state, 24 * 7)
    expect(cohabitRefusal(state, a.id)).toBeUndefined()
  })

  it('人數上限照房子的種類', () => {
    const state = game()
    const home = moveIn(state, 4)
    const cap = homeRules.cohabit.caps[home.district]
    const ids: string[] = []
    for (let i = 0; i < cap; i++) {
      const r = friend(state, 100, 'commoner', 20 + i)
      invite(state, r.id, 20)
      ids.push(r.id)
    }
    expect(cohabitantsOf(state, home.id)).toHaveLength(cap)
    const extra = friend(state, 100, 'commoner', 40)
    expect(cohabitRefusal(state, extra.id)).toContain('住滿')
  })
})

describe('住在家裡', () => {
  it('每天親密度 +1，一週最多 +3；舒適度 +1；長休得到家的溫暖；AI 場景帶上他', () => {
    const state = game()
    const home = moveIn(state)
    const before = comfortOf(home, state)
    const rec = friend(state, 85)
    invite(state, rec.id, 20)
    expect(comfortOf(home, state)).toBe(before + homeRules.cohabit.comfort)
    const aff = state.relationships![rec.id]!.affinity
    advanceTime(state, 24 * 7)
    expect(state.relationships![rec.id]!.affinity - aff).toBeLessThanOrEqual(homeRules.cohabit.week_cap * 2)
    expect(state.relationships![rec.id]!.affinity).toBeGreaterThan(aff)
    expect(withHomeStaff(state, '家')).toContain(`和你住在一起的人：${rec.name}`)
    state.lastLongRest = undefined
    const r = longRest(state, 'home')
    expect(state.party[0]!.status).toContain(homeRules.cohabit.condition)
    expect(r.outcome.summary).toContain(rec.name)
  })

  it('冒險者同居後不在酒館候選；親密度掉到門檻以下就搬走，記在你不在的時候', () => {
    const state = game()
    const home = moveIn(state)
    const rec = friend(state, 90, 'adventurer')
    invite(state, rec.id, 20)
    expect(adventurersInTown(state).some((r) => r.id === rec.id)).toBe(false)
    setAffinity(state, rec.id, homeRules.cohabit.leave_affinity - 1)
    advanceTime(state, 24)
    expect(rec.cohabit).toBeUndefined()
    expect(home.staffNotes?.some((n) => n.text.includes(rec.name))).toBe(true)
  })

  it('請他搬出去：親密度下降、記憶', () => {
    const state = game()
    const home = moveIn(state)
    const rec = friend(state, 90)
    invite(state, rec.id, 20)
    const aff = state.relationships![rec.id]!.affinity
    valid(askToLeave(state, rec.id))
    expect(rec.cohabit).toBeUndefined()
    expect(rec.at).toBeUndefined()
    expect(state.relationships![rec.id]!.affinity).toBe(aff + homeRules.cohabit.kick_affinity)
    expect(state.memories?.some((m) => m.summary.includes(rec.name) && m.summary.includes('搬出'))).toBe(true)
    expect(cohabitantsOf(state, home.id)).toHaveLength(0)
  })
})

describe('帶出門、回家住下', () => {
  it('冒險者可以帶上，同居保留；回家住下不算離隊；普通人不能帶', () => {
    const state = game()
    const home = moveIn(state, 2)
    const adv = friend(state, 90, 'adventurer')
    invite(state, adv.id, 20)
    const com = friend(state, 90, 'commoner', 9)
    invite(state, com.id, 20)
    expect(() => takeCohabitant(state, com.id)).toThrow('冒險者')
    valid(takeCohabitant(state, adv.id))
    expect(state.party.some((m) => m.id === adv.id)).toBe(true)
    expect(adv.cohabit?.home).toBe(home.id)
    expect(cohabitantsHome(state, home.id).map((r) => r.id)).toEqual([com.id])
    const aff = state.relationships![adv.id]!.affinity
    valid(settleCohabitant(state, adv.id))
    expect(state.party.some((m) => m.id === adv.id)).toBe(false)
    expect(adv.character).toBeTruthy()
    expect(adv.at?.area).toBe(ground(home).key)
    expect(state.relationships![adv.id]!.affinity).toBe(aff)
    // 再帶上時用存著的角色
    valid(takeCohabitant(state, adv.id))
    expect(state.party.find((m) => m.id === adv.id)?.name).toBe(adv.name)
  })
})
