import { describe, expect, it } from 'vitest'
import { examOffer, examQuest, playerRank } from '@/engine/guild'
import { enterLocation, standOn } from '@/engine/grid'
import { newGame } from '@/engine/state'
import { abandonQuest, acceptQuest, guildQuests, turnInQuest } from '@/engine/town'
import type { GameState } from '@/engine/types'
import { arriveAt } from './helpers/travel'

function ready(): GameState {
  const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 4, birthplace: 'soriel' })
  enterLocation(state)
  state.guild!.merit = 6
  state.party[0]!.level = 3
  return state
}

/** 到某座城的公會看委託板（會發這裡的考核） */
function visitGuild(state: GameState, town: string) {
  if (state.location !== town) arriveAt(state, town)
  standOn(state, 'guild')
  return guildQuests(state)
}

describe('晉升考核：各城鎮的公會各發一個，挑一個接，在哪裡都能交付', () => {
  it('posts one exam per town, each aimed near its own town', () => {
    const state = ready()
    const a = visitGuild(state, 'soriel').find((q) => q.flags?.exam)!
    const b = visitGuild(state, 'rivervale').find((q) => q.flags?.exam)!
    expect(a.giver).toBe('soriel')
    expect(b.giver).toBe('rivervale')
    expect(a.id).not.toBe(b.id)
    // 回到同一座城不會再發一個
    expect(visitGuild(state, 'rivervale').filter((q) => q.flags?.exam).map((q) => q.id)).toEqual([b.id])
    expect(examOffer(state)?.id).toBe(b.id)
    // 還沒接：不算「接下的考核」
    expect(examQuest(state)).toBeUndefined()
  })

  it('takes only one at a time, can switch after dropping it, and turns in at any guild', () => {
    const state = ready()
    const a = visitGuild(state, 'soriel').find((q) => q.flags?.exam)!
    acceptQuest(state, a.id)
    const b = visitGuild(state, 'rivervale').find((q) => q.flags?.exam && q.id !== a.id)!
    expect(() => acceptQuest(state, b.id)).toThrow('先放棄')
    // 在別的公會也看得到接下的考核
    expect(guildQuests(state).some((q) => q.id === a.id)).toBe(true)

    abandonQuest(state, a.id)
    acceptQuest(state, b.id)
    expect(examQuest(state)?.id).toBe(b.id)
    b.progress = b.goal
    b.status = 'ready'
    // 在發考核以外的城鎮交付
    visitGuild(state, 'soriel')
    expect(guildQuests(state).some((q) => q.id === b.id)).toBe(true)
    turnInQuest(state, b.id)
    expect(playerRank(state)).toBe('E')
    // 升階之後，各地還沒接的舊考核撤下
    expect(state.quests.some((q) => q.flags?.exam && q.status === 'available' && q.rank === 'E')).toBe(false)
  })
})
