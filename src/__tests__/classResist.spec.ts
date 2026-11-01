import { describe, expect, it } from 'vitest'
import { gearAffinities } from '@/engine/character'
import { classes } from '@/engine/data'
import { newGame } from '@/engine/state'

describe('職業本身的抗性（classes.json 的 resist）', () => {
  it('武僧的卸力：物理傷害 ×0.75，換防具也還在；其他職業沒有', () => {
    expect(classes.monk!.resist).toEqual({ physical: -0.25 })
    const monk = newGame({ name: '測試者', race: 'human', classId: 'monk', seed: 1 }).party[0]!
    expect(gearAffinities(monk).resist.physical).toBeCloseTo(-0.25)
    expect(gearAffinities({ ...monk, armor: 'leather' }).resist.physical).toBeCloseTo(-0.25)
    const fighter = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 1 }).party[0]!
    expect(gearAffinities(fighter).resist.physical ?? 0).toBe(0)
  })
})
