// 「這裡可以接的特殊任務」改成依開頭分類查（不逐一檢查全部任務）：結果要和逐一檢查一模一樣
import { describe, expect, it } from 'vitest'
import { geography, stories, type StoryDef } from '@/engine/data'
import { blockKeys, currentArea, currentCell, enterLocation, getArea } from '@/engine/grid'
import { guildOf } from '@/engine/guild'
import { npcRecord } from '@/engine/npcs'
import { nearbyPeople, peopleHere } from '@/engine/population'
import { newGame } from '@/engine/state'
import { canStart, npcFree, storyOffersHere } from '@/engine/story'
import type { GameState } from '@/engine/types'

/** 以前的寫法：每個任務都檢查一次 */
function bruteForce(state: GameState): StoryDef[] {
  const area = currentArea(state)
  const cell = currentCell(state)
  const near = new Set(nearbyPeople(state).map((p) => p.rec.id))
  const present = (id: string) => state.party.some((m) => m.id === id) || near.has(id)
  return stories.filter((def) => {
    if (!canStart(state, def)) return false
    const s = def.start
    if (s.kind === 'guild') return area.kind === 'settlement' && cell.kind === 'guild' && (!s.location || s.location === area.location)
    if (s.kind === 'npc') return !!s.npc && npcFree(state, s.npc) && !npcRecord(state, s.npc)!.hostile && present(s.npc)
    return false
  })
}

describe('story offers index', () => {
  it('matches checking every quest, on every walkable cell of a few towns', () => {
    let offered = 0
    let checked = 0
    let npcOffers = 0
    for (const loc of geography.locations.filter((l) => l.type !== 'dungeon').slice(0, 4)) {
      const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 7, birthplace: loc.id })
      state.party[0]!.level = 20
      guildOf(state).rank = 'A'
      enterLocation(state)
      for (const key of blockKeys(state.location)) {
        const area = getArea(state, key)
        area.cells.forEach((c, i) => {
          if (c.kind === 'wall' || c.kind === 'water' || c.kind === 'link') return
          state.position = { area: key, x: i % area.width, y: Math.floor(i / area.width) }
          const want = bruteForce(state).map((d) => d.id)
          expect(storyOffersHere(state).map((d) => d.id)).toEqual(want)
          // 畫面傳進已經算好的「這裡的人」：結果一樣
          expect(storyOffersHere(state, peopleHere(state)).map((d) => d.id)).toEqual(want)
          offered += want.length
          npcOffers += want.filter((id) => stories.find((d) => d.id === id)?.start.kind === 'npc').length
          checked++
        })
      }
    }
    // 確定真的走到了有任務可接的地方（公會、委託人身邊都有）
    expect(checked).toBeGreaterThan(100)
    expect(offered).toBeGreaterThan(npcOffers)
    expect(npcOffers).toBeGreaterThan(0)
  })

  it('notices quests added to the list without a content change', () => {
    const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 7, birthplace: 'soriel' })
    enterLocation(state)
    const key = blockKeys(state.location).find((k) => getArea(state, k).cells.some((c) => c.kind === 'guild'))!
    const area = getArea(state, key)
    const i = area.cells.findIndex((c) => c.kind === 'guild')
    state.position = { area: key, x: i % area.width, y: Math.floor(i / area.width) }
    storyOffersHere(state)
    const extra = { ...stories.find((d) => d.start.kind === 'guild')!, id: 'tmp_guild_story', rank: undefined, start: { kind: 'guild' as const } }
    stories.push(extra)
    try {
      expect(storyOffersHere(state).map((d) => d.id)).toContain('tmp_guild_story')
    } finally {
      stories.pop()
    }
    expect(storyOffersHere(state).map((d) => d.id)).not.toContain('tmp_guild_story')
  })
})
