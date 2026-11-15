import { describe, expect, it } from 'vitest'
import { prepareAction, resolveAction } from '@/engine/actions'
import { enterLocation, standOn } from '@/engine/grid'
import { generateNpc } from '@/engine/npcs'
import { trainees, trainOptions } from '@/engine/perkActions'
import { joinParty, pcOf } from '@/engine/party'
import { trainSpec } from '@/engine/perks'
import { craftLessons, learnCraft } from '@/engine/craftLessons'
import { perkDef } from '@/engine/data'
import { newGame, withRng } from '@/engine/state'
import type { GameState } from '@/engine/types'

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: 'rhineburg' })
  enterLocation(state)
  return state
}

describe('companions can train too', () => {
  it('lets a companion overcome their own flaw, paid from the party money', () => {
    const state = game()
    const m = joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 3, kind: 'adventurer', location: state.location })), 'voluntary')
    m.perks = [...(m.perks ?? []), 'flaw_coward']
    standOn(state, 'guild')
    state.money_cc = 5000
    expect(trainees(state).map((x) => x.id)).toContain(m.id)
    // 看受訓的人：主角沒有這個缺陷，夥伴有
    expect(trainOptions(state).some((o) => o.def.id === 'flaw_coward')).toBe(false)
    expect(trainOptions(state, m.id).some((o) => o.def.id === 'flaw_coward')).toBe(true)
    prepareAction(state, { kind: 'train', target: `flaw_coward@${m.id}`, text: '' })
    expect(state.pendingAction!.actor).toBe(m.id)
    state.pendingAction!.natural = 18
    resolveAction(state, null)
    expect(m.perks).not.toContain('flaw_coward')
    expect(pcOf(state).perks ?? []).not.toContain('flaw_coward')
    expect(state.money_cc).toBe(5000 - trainSpec(perkDef('flaw_coward')!).price_cc)
  })

  it('gives the chance to learn to the companion who trained', () => {
    const state = game()
    const m = joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 10, kind: 'adventurer', location: state.location })), 'voluntary')
    standOn(state, 'guild')
    state.money_cc = 1e6
    const opt = trainOptions(state, m.id).find((o) => !o.def.flaw && !o.blocked)
    expect(opt).toBeTruthy()
    prepareAction(state, { kind: 'train', target: `${opt!.def.id}@${m.id}`, text: '' })
    state.pendingAction!.natural = 18
    resolveAction(state, null)
    expect(m.perkOffers?.at(-1)?.options).toContain(opt!.def.id)
    expect(pcOf(state).perkOffers ?? []).toEqual([])
  })

  it('does not let guests or people of a followed party train', () => {
    const state = game()
    const g = joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 3, kind: 'adventurer', location: state.location })), 'guest')
    standOn(state, 'guild')
    expect(trainees(state).some((x) => x.id === g.id)).toBe(false)
    expect(() => prepareAction(state, { kind: 'train', target: `flaw_coward@${g.id}`, text: '' })).toThrow()
  })

  it('does not let guests learn a craft either (own companions still can)', () => {
    const state = game()
    const g = joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 3, kind: 'adventurer', location: state.location })), 'guest')
    const m = joinParty(state, withRng(state, (rng) => generateNpc(state, rng, { level: 3, kind: 'adventurer', location: state.location })), 'voluntary')
    standOn(state, 'tailor')
    state.money_cc = 5000
    expect(craftLessons(state, g.id)).toEqual([])
    expect(() => learnCraft(state, craftLessons(state, m.id)[0]!.craft, g.id)).toThrow('不能在這裡受訓')
    expect(craftLessons(state, m.id).length).toBeGreaterThan(0)
    learnCraft(state, craftLessons(state, m.id)[0]!.craft, m.id)
    expect(state.money_cc).toBeLessThan(5000)
  })
})
