// 房屋系統回歸測試找到的問題（2026-11-18）：家裡的事卡住、同居的人做家務、處置俘虜、欠薪很久、園丁沒箱子、
// 同居的人留守、請人來幫忙的邊界、多給工錢、存取的數字檢查
import { describe, expect, it } from 'vitest'
import { homeRules, itemDef } from '@/engine/data'
import { prepareAction, resolveAction } from '@/engine/actions'
import { sendHome, sendHomeRefusal } from '@/engine/away'
import { resolveCaptive } from '@/engine/captives'
import { applyEffects } from '@/engine/effects'
import { generateNpc, npcRecord } from '@/engine/npcs'
import { joinParty } from '@/engine/party'
import { Rng } from '@/engine/rng'
import { ensureRelationship, setAffinity } from '@/engine/social'
import { currentArea, enterLocation, placeAt, position, type Area } from '@/engine/grid'
import { buyHome, homeReport, lotsOf, placeFurniture, stayAt, stayRefusal } from '@/engine/homes'
import { plant } from '@/engine/garden'
import { homeTemplates } from '@/engine/homeEvents'
import { depositItem, depositMoney, storeInHome, withdrawMoney } from '@/engine/storage'
import { cohabitantsOf, freeBed } from '@/engine/cohabit'
import {
  applyStaffInvite, assignChore, breakfastOf, candidates, choreRefusal, fireStaff, hireStaff, inviteHome, staffCap, staffInviteRefusal, staffOf, withHomeStaff, workersFor,
} from '@/engine/staff'
import { pendingTownEvent } from '@/engine/townEvents'
import { addItem, advanceTime, commitReport, newGame } from '@/engine/state'
import type { GameState, Home, NpcRecord } from '@/engine/types'

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

/** 買下一棟連棟房屋，在一樓擺 beds 張床，站進一樓 */
function moveIn(state: GameState, beds = 0): Home {
  const lot = lotsOf(state.location).find((l) => l.district === 'house')!
  buyHome(state, lot.id)
  const home = Object.values(state.homes!).at(-1)!
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

function hire(state: GameState, home: Home, job: string): NpcRecord {
  const c = candidates(state, home.location).find((r) => r.staff!.job === job)!
  hireStaff(state, c.id)
  return state.npcs![c.id]!
}

/** 主角旁邊一個認識的人 */
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

function cohabitInvite(state: GameState, id: string) {
  prepareAction(state, { kind: 'cohabit_invite', target: id, text: '' })
  state.pendingAction!.natural = 20
  resolveAction(state, null)
}

/** 一件只要有家僕就會發生的家裡的事 */
const anyHomeEvent = () => homeTemplates().find((t) => !t.staff_bond && !t.staff_affinity && !t.tags?.length)!

describe('等著回答的家裡的事，主角不在了就作廢', () => {
  it('解雇那位家僕：事件作廢，可以照常移動、長休', () => {
    const state = game()
    const home = moveIn(state)
    const maid = hire(state, home, 'maid')
    const t = homeTemplates().find((x) => !x.staff?.length || x.staff.includes('maid'))!
    state.townEvent = { template: t.id, staff: maid.id }
    expect(pendingTownEvent(state)).toBeTruthy()
    fireStaff(state, maid.id)
    expect(state.townEvent).toBeUndefined()
  })

  it('家僕死了、辭職了：下一筆日誌就作廢', () => {
    const state = game()
    const home = moveIn(state)
    const cook = hire(state, home, 'cook')
    state.townEvent = { template: anyHomeEvent().id, staff: cook.id }
    cook.dead = true
    expect(pendingTownEvent(state)).toBeUndefined()
    commitReport(state, homeReport(state, 'social', 0, home.name))
    expect(state.townEvent).toBeUndefined()
    // 欠薪辭職（跨日結算）
    const gardener = hire(state, home, 'gardener')
    state.townEvent = { template: anyHomeEvent().id, staff: gardener.id }
    state.money_cc = 0
    advanceTime(state, 24 * (homeRules.staff.quit_days + 2))
    expect(state.npcs![gardener.id]!.staff).toBeUndefined()
    expect(state.townEvent).toBeUndefined()
  })
})

describe('同居的人不當家僕，但可以幫忙做家務', () => {
  it('不能請同居的人當家僕；可以選一份家務，不用工錢、不佔名額，效果照算', () => {
    const state = game()
    const home = moveIn(state, 1)
    const rec = friend(state, 90)
    cohabitInvite(state, rec.id)
    expect(rec.cohabit?.home).toBe(home.id)
    expect(staffInviteRefusal(state, rec.id)).toContain('住在一起')
    expect(choreRefusal(state, rec.id)).toBeUndefined()
    assignChore(state, rec.id, 'cook')
    expect(workersFor(state, home.id, 'cook').map((r) => r.id)).toEqual([rec.id])
    expect(breakfastOf(state, home)).toBeTruthy()
    expect(staffOf(state, home.id)).toHaveLength(0)
    expect(withHomeStaff(state, '家')).toContain(`${rec.name}幫忙做廚師的家務`)
    expect(() => assignChore(state, rec.id, 'steward')).toThrow('管家')
    // 搬走就不做了
    setAffinity(state, rec.id, homeRules.cohabit.leave_affinity - 1)
    advanceTime(state, 24)
    expect(rec.cohabit).toBeUndefined()
    expect(rec.chore).toBeUndefined()
    expect(breakfastOf(state, home)).toBeUndefined()
  })

  it('跟著出門時不做，回家住下後接著做', () => {
    const state = game()
    const home = moveIn(state, 1)
    const rec = friend(state, 90, 'adventurer', 11)
    cohabitInvite(state, rec.id)
    assignChore(state, rec.id, 'maid')
    joinParty(state, rec, 'voluntary')
    expect(workersFor(state, home.id, 'maid')).toHaveLength(0)
    expect(choreRefusal(state, rec.id)).toContain('出門')
  })

  it('站在自己家裡請人，也要看家僕名額', () => {
    const state = game()
    const home = moveIn(state)
    for (let i = 0; i < staffCap(state, home); i++) hire(state, home, ['maid', 'cook', 'gardener'][i]!)
    expect(inviteHome(state)).toBeUndefined()
    const rec = friend(state, 60, 'commoner', 21)
    expect(staffInviteRefusal(state, rec.id)).toContain('家僕滿了')
  })

  it('判定成功卻沒有名額：不算拒絕、不扣親密度', () => {
    const state = game()
    const home = moveIn(state)
    for (let i = 0; i < staffCap(state, home); i++) hire(state, home, ['maid', 'cook', 'gardener'][i]!)
    const rec = friend(state, 60, 'commoner', 22)
    const report = homeReport(state, 'social', 0, home.name)
    const line = applyStaffInvite(state, report, `${rec.id}:maid`, 'success')
    expect(line).toContain('沒有地方安排')
    expect(report.changes.affinity ?? []).toHaveLength(0)
    expect(state.flags[`invite_wait:${rec.id}`]).toBeUndefined()
    expect(rec.staff).toBeUndefined()
  })
})

describe('處置被制伏的家僕', () => {
  for (const choice of ['release', 'enslave'] as const) {
    it(`${choice === 'release' ? '放過' : '收為奴隸'}：不再是家僕`, () => {
      const state = game()
      const home = moveIn(state)
      const maid = hire(state, home, 'maid')
      state.townEvent = { template: anyHomeEvent().id, staff: maid.id }
      state.captives = { npcs: [maid.id], area: currentArea(state).key, location: state.location, aggressor: 'party' } as never
      resolveCaptive(state, maid.id, choice)
      expect(state.npcs![maid.id]!.staff).toBeUndefined()
      expect(staffOf(state, home.id)).toHaveLength(0)
      expect(workersFor(state, home.id, 'maid')).toHaveLength(0)
      expect(state.townEvent).toBeUndefined()
    })
  }
})

describe('同居的人不能留守、寄放', () => {
  it('帶出門的同居者不能「留在家裡」，送回家就是回家住下，不多佔一張床', () => {
    const state = game()
    const home = moveIn(state, 2)
    const rec = friend(state, 90, 'adventurer', 11)
    cohabitInvite(state, rec.id)
    joinParty(state, rec, 'voluntary')
    const m = state.party.find((x) => x.id === rec.id)!
    expect(stayRefusal(m, state)).toContain('住在一起')
    expect(() => stayAt(state, home, rec.id)).toThrow('住在一起')
    expect(sendHomeRefusal(state, m)).toBeUndefined()
    sendHome(state, home.id, rec.id)
    expect(state.party.some((x) => x.id === rec.id)).toBe(false)
    expect(npcRecord(state, rec.id)!.staying).toBeUndefined()
    expect(cohabitantsOf(state, home.id)).toHaveLength(1)
    // 還有一張床給下一個人
    expect(freeBed(state, home)).toBeTruthy()
  })
})

describe('很久沒回家', () => {
  it('離家 100 天：欠滿就在那天辭職，不是第 41 天', () => {
    const state = game()
    const home = moveIn(state)
    const maid = hire(state, home, 'maid')
    const start = state.time.day
    state.money_cc = 0
    advanceTime(state, 24 * 100)
    expect(state.npcs![maid.id]!.staff).toBeUndefined()
    const note = home.staffNotes!.find((n) => n.tag === '辭職')!
    expect(note.day).toBe(start + homeRules.staff.quit_days + 1)
    expect(note.text).toContain(`被欠了 ${homeRules.staff.quit_days + 1} 天`)
  })
})

describe('園丁收成：沒有儲物箱', () => {
  it('寫家裡沒有儲物箱，不是箱子滿了', () => {
    const state = game()
    const home = moveIn(state)
    hire(state, home, 'gardener')
    const g = ground(home)
    const i = g.cells.findIndex((c) => c.kind === 'yard')
    addItem(state.inventory, '菜圃', 1)
    placeFurniture(state, g, i % g.width, Math.floor(i / g.width), '菜圃')
    addItem(state.inventory, '莓果苗', 1)
    placeAt(state, g, i % g.width, Math.floor(i / g.width))
    plant(state, g, i % g.width, Math.floor(i / g.width), '莓果苗')
    advanceTime(state, 24 * 30)
    const text = (home.staffNotes ?? []).filter((n) => n.tag === '收成').map((n) => n.text).join('')
    expect(text).toContain('家裡沒有儲物箱')
    expect(text).not.toContain('箱子滿了')
  })
})

describe('家裡的事多給工錢', () => {
  it('身上的錢不夠時付到 0 為止', () => {
    const state = game()
    const home = moveIn(state)
    const maid = hire(state, home, 'maid')
    state.money_cc = 5
    const report = homeReport(state, 'social', 0, home.name)
    applyEffects(state, report, [{ type: 'staff_wage', npc: maid.id, days: 30 }])
    commitReport(state, report)
    expect(state.money_cc).toBe(0)
  })
})

describe('存取的數字', () => {
  it('不是數字時不收', () => {
    const state = game()
    const home = moveIn(state)
    const g = ground(home)
    const p = spot(g, 9)
    addItem(state.inventory, '保險箱', 1)
    placeAt(state, g, p.x, p.y)
    placeFurniture(state, g, p.x, p.y, '保險箱')
    addItem(state.inventory, '野莓', 3)
    expect(() => depositItem(state, g, p.x, p.y, '野莓', NaN)).toThrow('要放多少')
    expect(() => depositMoney(state, g, p.x, p.y, NaN)).toThrow('要存多少')
    expect(() => withdrawMoney(state, g, p.x, p.y, NaN)).toThrow('要領多少')
    expect(state.money_cc).toBeGreaterThan(0)
    expect(storeInHome(state, home, '野莓', NaN)).toBe(true)
  })
})
