import { describe, expect, it } from 'vitest'
import { bandOf, factionBoard } from '@/engine/factionBoard'
import { enterLocation } from '@/engine/grid'
import { raiseAlert, securityRules } from '@/engine/security'
import { newGame } from '@/engine/state'

function game() {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 5, birthplace: 'rhineburg' })
  enterLocation(state)
  return state
}

describe('notebook factions tab', () => {
  it('lists the faction you are in first, with its towns and what reputation unlocks', () => {
    const state = game()
    state.reputation.rhine_empire = 12
    const board = factionBoard(state)
    const rhine = board.find((f) => f.id === 'rhine_empire')!
    expect(board[0]!.id).toBe('rhine_empire')
    expect(rhine.here).toBe(true)
    expect(rhine.met).toBe(true)
    expect(rhine.band).toEqual(bandOf(12))
    expect(rhine.towns.find((t) => t.id === 'rhineburg')).toMatchObject({ capital: true, visited: true })
    // 王城（聲望 10）與帝國軍械院（地標，聲望 10）都夠了
    expect(rhine.unlocks.some((u) => u.need === securityRules.palace_reputation && u.ok)).toBe(true)
    expect(rhine.unlocks.some((u) => u.name.includes('帝國軍械院') && u.ok)).toBe(true)
  })

  it('marks wanted factions and alerted towns, and keeps unmet factions apart', () => {
    const state = game()
    for (let i = 0; i < securityRules.alert.max; i++) raiseAlert(state, 'ironforge', 1)
    state.reputation.dwarf_clans = -11
    const board = factionBoard(state)
    const dwarf = board.find((f) => f.id === 'dwarf_clans')!
    expect(dwarf.wanted).toBe(true)
    expect(dwarf.fine).toBeGreaterThan(0)
    expect(dwarf.met).toBe(true)
    expect(dwarf.towns.find((t) => t.id === 'ironforge')!.alert).toBeGreaterThan(0)
    expect(dwarf.unlocks.every((u) => !u.ok)).toBe(true)
    const elves = board.find((f) => f.id === 'elf_court')!
    expect(elves.met).toBe(false)
    expect(board.find((f) => f.id === 'guild')!.met).toBe(true)
    // 接觸過的排在沒接觸過的前面
    expect(board.findIndex((f) => !f.met)).toBeGreaterThan(board.findIndex((f) => f.id === 'dwarf_clans'))
  })
})
