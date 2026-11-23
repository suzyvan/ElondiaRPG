// 替隊伍裡的人刺青、洗刺青（docs/TATTOOS.md 第 6.1 節；玩家許願：刺青店只能刺自己）
import { describe, expect, it } from 'vitest'
import { attrsOf } from '@/engine/character'
import { enterLocation, standOn } from '@/engine/grid'
import { generateNpc } from '@/engine/npcs'
import { joinParty } from '@/engine/party'
import { inkConsent, inkTattoo, tattooTargets, washTattoo } from '@/engine/tattooShop'
import { newGame, withRng } from '@/engine/state'
import { tattooAt, tattooRules } from '@/engine/tattoos'
import type { GameState } from '@/engine/types'

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 3, birthplace: 'rhineburg' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

const recruit = (state: GameState, bond: 'hired' | 'slave') =>
  joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 1, gender: 'female' })), bond)

describe('tattooing party members', () => {
  it('lists the hero, own slaves and hired or voluntary companions', () => {
    const state = game()
    const hired = recruit(state, 'hired')
    const slave = recruit(state, 'slave')
    expect(tattooTargets(state).map((m) => m.id)).toEqual([state.party[0]!.id, hired.id, slave.id])
  })

  it('asks a free companion for enough affinity; own slaves need no consent', () => {
    const state = game()
    const hired = recruit(state, 'hired')
    const slave = recruit(state, 'slave')
    const r = tattooRules.companion
    standOn(state, 'tattoo')
    hired.affinity = r.min_affinity - 1
    expect(() => inkTattoo(state, { template: 'lotus', place: 'hips' }, hired.id)).toThrow('不肯')
    hired.affinity = r.min_affinity
    const rep = inkTattoo(state, { template: 'lotus', place: 'hips' }, hired.id)
    expect(tattooAt(hired, 'hips')).toMatchObject({ name: '蓮花' })
    expect(rep.changes.tattoos?.[0]).toMatchObject({ actor: hired.id, added: true })
    expect(rep.outcome.summary).toContain(`替${hired.name}`)
    // 淫紋：親密度或淫亂要更高
    expect(inkConsent(hired, { kind: 'plain', template: 'lewd_heart' })).toContain('不肯')
    hired.affinity = r.adult_min_affinity
    expect(inkConsent(hired, { kind: 'plain', template: 'lewd_heart' })).toBeUndefined()
    // 自己的奴隸不用問
    slave.affinity = -50
    expect(inkConsent(slave, { kind: 'plain', template: 'lewd_heart' })).toBeUndefined()
    inkTattoo(state, { template: 'butterfly', place: 'back' }, slave.id)
    expect(tattooAt(slave, 'back')).toBeTruthy()

    // 洗刺青
    washTattoo(state, 'hips', hired.id)
    expect(tattooAt(hired, 'hips')).toBeUndefined()
  })

  it('changes the companion attributes with an oath mark at the carver', () => {
    const state = game()
    const hired = recruit(state, 'hired')
    standOn(state, 'carver')
    hired.affinity = tattooRules.companion.oath_min_affinity - 1
    expect(() => inkTattoo(state, { template: 'oath_berserker', place: 'back' }, hired.id)).toThrow('不肯')
    hired.affinity = tattooRules.companion.oath_min_affinity
    const str = attrsOf(hired).str
    inkTattoo(state, { kind: 'oath', name: '力誓', desc: '', place: 'back', attrs: { str: 2, cha: -2 } }, hired.id)
    expect(attrsOf(hired).str).toBe(str + 2)
  })

  it('refuses people who are not tattoo targets', () => {
    const state = game()
    standOn(state, 'tattoo')
    expect(() => inkTattoo(state, { template: 'lotus', place: 'hips' }, 'nobody')).toThrow('不能替這個人刺青')
  })
})
