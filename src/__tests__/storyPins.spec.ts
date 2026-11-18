import { describe, expect, it } from 'vitest'
import { newGame } from '@/engine/state'
import { stories } from '@/engine/data'
import { isStoryPinned, storyCategory, storyCategoryLabel, toggleStoryPin } from '@/engine/storyPins'

describe('冒險筆記收藏特殊任務', () => {
  it('收藏、取消收藏照順序記在存檔；沒接的任務不能收藏', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 2 })
    const [a, b] = stories.filter((d) => d.start.kind === 'npc').slice(0, 2)
    expect(() => toggleStoryPin(state, a!.id)).toThrow()
    state.stories = {
      [a!.id]: { id: a!.id, status: 'active', log: [] } as never,
      [b!.id]: { id: b!.id, status: 'active', log: [] } as never,
    }
    toggleStoryPin(state, b!.id)
    toggleStoryPin(state, a!.id)
    expect(state.pinnedStories).toEqual([b!.id, a!.id])
    expect(isStoryPinned(state, a!.id)).toBe(true)
    toggleStoryPin(state, b!.id)
    expect(state.pinnedStories).toEqual([a!.id])
    toggleStoryPin(state, a!.id)
    expect(state.pinnedStories).toBeUndefined()
  })

  it('分類：角色線寫是誰的線，公會與情報商各自一類', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 2 })
    const npc = stories.find((d) => d.start.kind === 'npc' && d.start.npc)!
    expect(storyCategory(npc)).toBe('npc')
    expect(storyCategoryLabel(state, npc)).toMatch(/的線$/)
    expect(storyCategory(stories.find((d) => d.start.kind === 'guild')!)).toBe('guild')
    expect(storyCategory(stories.find((d) => d.start.kind === 'informant')!)).toBe('informant')
    expect(storyCategory(stories.find((d) => d.start.kind === 'manual')!)).toBe('other')
  })
})
