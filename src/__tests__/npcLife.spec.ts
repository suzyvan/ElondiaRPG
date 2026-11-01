import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { enterLocation } from '@/engine/grid'
import { generateNpc, npcRecord, registerNpc } from '@/engine/npcs'
import {
  AFFINITY_MIN, DUNGEON_LEVEL_SLACK, MAX_CATCH_UP, applyNewsStories, dungeonEntryLevel, levelUpChance, livingNpcs, newsOf, setFollowed, setNpcLife, tickNpcLife,
} from '@/engine/npcLife'
import { characterFor } from '@/engine/npcs'
import { geography } from '@/engine/data'
import { npcOutfit } from '@/engine/outfits'
import { ensureRelationship, formatContext, selectContext, setAffinity } from '@/engine/social'
import { newGame, withRng } from '@/engine/state'
import type { GameState, NpcRecord } from '@/engine/types'
import { buildNewsPrompt } from '@/narrator/judge'

vi.mock('@/narrator/providers', () => ({
  completeText: vi.fn(async (_p: unknown, _c: unknown, prompt: { user: string }) => {
    const items = [...prompt.user.matchAll(/id: (\S+?)[，,）)]/g)].map((m) => m[1])
    const days = [...prompt.user.matchAll(/day (\d+)：/g)].map((m) => Number(m[1]))
    return JSON.stringify({ news: items.flatMap((id) => days.map((day) => ({ id, day, story: `${id} 在第 ${day} 天的故事` }))) })
  }),
  streamNarration: vi.fn(async function* () { yield '' }),
}))

afterEach(() => setNpcLife({ on: true, days: 3 }))

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 5, birthplace: 'soriel' })
  enterLocation(state)
  state.party[0]!.level = 6
  return state
}

/** 生成一個冒險者，認識他並給他好感 */
function friend(state: GameState, affinity = AFFINITY_MIN, level = 2): NpcRecord {
  const rec = registerNpc(state, withRng(state, (rng) => generateNpc(state, rng, { level, location: state.location, class: 'fighter' })))
  ensureRelationship(state, rec)
  setAffinity(state, rec.id, affinity)
  return rec
}

function passDays(state: GameState, days: number) {
  state.time = { ...state.time, day: state.time.day + days }
  return tickNpcLife(state)
}

describe('NPC 自己的日子：誰', () => {
  it('counts friends, followed adventurers and away companions, but not commoners, strangers or the dead', () => {
    const state = game()
    const close = friend(state, AFFINITY_MIN)
    const cold = friend(state, 0)
    const ids = () => livingNpcs(state).map((r) => r.id)
    expect(ids()).toContain(close.id)
    expect(ids()).not.toContain(cold.id)
    setFollowed(state, cold.id, true)
    expect(ids()).toContain(cold.id)
    // 普通人不能關注
    ensureRelationship(state, npcRecord(state, 'npc_old_hannah')!)
    expect(() => setFollowed(state, 'npc_old_hannah', true)).toThrow('冒險者')
    close.dead = true
    expect(ids()).not.toContain(close.id)
  })
})

describe('NPC 自己的日子：擲骰', () => {
  it('rolls every X days, levels up to the hero at most, and is the same every time', () => {
    setNpcLife({ days: 1 })
    const state = game()
    const rec = friend(state, 50, 2)
    expect(tickNpcLife(state)).toEqual([])
    const twin = JSON.parse(JSON.stringify(state)) as GameState
    passDays(state, MAX_CATCH_UP)
    passDays(twin, MAX_CATCH_UP)
    const news = newsOf(state, rec.id)
    expect(news.length).toBe(6)
    expect(news.every((n) => n.text.length > 0 && n.place)).toBe(true)
    // 固定的亂數：一樣的時間擲出一樣的結果
    expect(newsOf(twin, rec.id)).toEqual(news)
    // 升級：最多到主角的等級，角色資料跟著存
    for (let i = 0; i < 6; i++) passDays(state, 5)
    const after = npcRecord(state, rec.id)!
    expect(after.character).toBeDefined()
    expect(after.level).toBeGreaterThan(2)
    expect(after.level).toBeLessThanOrEqual(state.party[0]!.level)
    expect(after.character!.level).toBe(after.level)
    expect(after.character!.pendingAbilityChoices).toBeUndefined()
  })

  it('levels up rarely, and faster the further behind the hero', () => {
    expect(levelUpChance(0, 3)).toBe(0)
    expect(levelUpChance(1, 3)).toBeCloseTo(0.05)
    expect(levelUpChance(2, 3)).toBeCloseTo(0.1)
    expect(levelUpChance(5, 3)).toBeCloseTo(0.25)
    expect(levelUpChance(9, 3)).toBeCloseTo(0.25)
    // 間隔越長越高，最多 50%
    expect(levelUpChance(2, 9)).toBeGreaterThan(levelUpChance(2, 3))
    expect(levelUpChance(9, 30)).toBe(0.5)
    expect(levelUpChance(1, 1)).toBeLessThan(levelUpChance(1, 3))
  })

  it('never levels up or re-equips fixed NPCs, but they still get news', () => {
    setNpcLife({ days: 1 })
    const state = game()
    ensureRelationship(state, npcRecord(state, 'npc_lina')!)
    setAffinity(state, 'npc_lina', 60)
    const level = npcRecord(state, 'npc_lina')!.level
    tickNpcLife(state)
    for (let i = 0; i < 8; i++) passDays(state, MAX_CATCH_UP)
    expect(npcRecord(state, 'npc_lina')!.level).toBe(level)
    expect(newsOf(state, 'npc_lina').some((n) => n.level || n.gear)).toBe(false)
    // 不換裝：不會被複製進存檔、穿著照內容的設計
    expect(state.npcs?.npc_lina?.character).toBeUndefined()
    expect(newsOf(state, 'npc_lina').length).toBeGreaterThan(0)
  })

  it('skips very long gaps instead of rolling forever, and does nothing when switched off', () => {
    setNpcLife({ days: 1 })
    const state = game()
    const rec = friend(state, 50)
    tickNpcLife(state)
    passDays(state, 100)
    expect(state.npcLife!.last).toBe(state.time.day)
    const count = newsOf(state, rec.id).length
    setNpcLife({ on: false })
    passDays(state, 10)
    expect(newsOf(state, rec.id).length).toBe(count)
  })
})

describe('NPC 自己的日子：近況與 AI', () => {
  it('shows recent news to the AI in relationships, and the news prompt carries personality and memories', () => {
    setNpcLife({ days: 1 })
    const state = game()
    const rec = friend(state, 50)
    tickNpcLife(state)
    passDays(state, 3)
    const ctx = formatContext(state, selectContext(state, { participants: [rec.id] }))
    expect(ctx).toContain('近況（上次見面之後）')
    const prompt = buildNewsPrompt(state, [{ id: rec.id, news: newsOf(state, rec.id) }])!
    expect(prompt.system).toContain('只輸出 JSON')
    expect(prompt.user).toContain(rec.personality)
    expect(prompt.user).toContain(newsOf(state, rec.id)[0]!.text)
    applyNewsStories(state, [{ id: rec.id, day: newsOf(state, rec.id)[0]!.day, story: '寫好的近況' }])
    expect(newsOf(state, rec.id)[0]!.story).toBe('寫好的近況')
  })
})

describe('NPC 自己的日子：交給 AI 寫（store）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('polishes the news of everyone who changed when it rolls', async () => {
    const { useGame } = await import('@/stores/game')
    const { useSettings } = await import('@/stores/settings')
    const settings = useSettings()
    settings.sources[0]!.configs.anthropic.apiKey = 'test'
    settings.npcLifeDays = 1
    settings.npcLifeAi = 'roll'
    // 設定要等畫面更新才套用到引擎
    await nextTick()
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const rec = friend(game.state!, 50)
    game.runAction(() => ({}))
    game.runAction((s) => { s.time.day += 2 })
    expect(newsOf(game.state!, rec.id).length).toBe(2)
    await vi.waitFor(() => expect(newsOf(game.state!, rec.id).every((n) => n.story)).toBe(true))
    expect(newsOf(game.state!, rec.id)[0]!.story).toContain(rec.id)
  })
})

describe('普通人每週換一套衣服', () => {
  it('keeps the first week as before and changes later weeks for at least some people', () => {
    const def = (id: string) => ({ id, race: 'human', gender: 'female', tags: ['noble'] } as never)
    expect(npcOutfit(def('a'), 1)).toEqual(npcOutfit(def('a')))
    expect(npcOutfit(def('a'), 3)).toEqual(npcOutfit(def('a'), 7))
    const changed = ['a', 'b', 'c', 'd', 'e'].some((id) => JSON.stringify(npcOutfit(def(id), 8)) !== JSON.stringify(npcOutfit(def(id), 1)))
    expect(changed).toBe(true)
  })
})

describe('NPC 自己的日子：夥伴的裝備與升級', () => {
  /** 留在酒館的夥伴（曾經是隊員） */
  function lodger(state: GameState, level = 3): { rec: NpcRecord; id: string } {
    const rec = registerNpc(state, withRng(state, (rng) => generateNpc(state, rng, { level, location: state.location, class: 'fighter' })))
    ensureRelationship(state, rec)
    const ch = characterFor(state, rec)
    registerNpc(state, { ...rec, character: ch, staying: `tavern:${state.location}`, stayingSince: { ...state.time } })
    return { rec, id: rec.id }
  }

  it('only swaps in better gear, never locked or unique gear, and sends the old piece back', () => {
    setNpcLife({ days: 3 })
    const state = game()
    state.party[0]!.level = 15
    const { id } = lodger(state)
    const ch = npcRecord(state, id)!.character!
    const weapon = ch.gear!.main_hand!.name
    ch.gear!.body = { ...ch.gear!.body!, name: '主人鎖上的胸甲', locked: 'master_x' }
    tickNpcLife(state)
    for (let i = 0; i < 30; i++) passDays(state, 3)
    const after = npcRecord(state, id)!.character!
    expect(after.gear!.body!.name).toBe('主人鎖上的胸甲')
    expect(after.gear!.body!.locked).toBe('master_x')
    // 換下的武器寄回行囊
    expect(after.gear!.main_hand!.name).not.toBe(weapon)
    expect(state.inventory.some((i) => i.name === weapon)).toBe(true)
  })

  it('does not swap for worse gear', () => {
    setNpcLife({ days: 3 })
    const state = game()
    const { id } = lodger(state)
    const ch = npcRecord(state, id)!.character!
    // 很好的武器（秘銀＋附魔）：等級 3 生成的不會比較好
    ch.gear!.main_hand = { ...ch.gear!.main_hand!, name: '秘銀長劍＋', spec: { ...ch.gear!.main_hand!.spec, material: 'mithril', enchants: { mods: { hit: 2, damage: 2 } } } }
    tickNpcLife(state)
    for (let i = 0; i < 30; i++) passDays(state, 3)
    expect(npcRecord(state, id)!.character!.gear!.main_hand!.name).toBe('秘銀長劍＋')
  })

  it('leaves level-up choices and attribute points to the player for former companions', () => {
    setNpcLife({ days: 9 })
    const state = game()
    state.party[0]!.level = 15
    const { id } = lodger(state, 2)
    npcRecord(state, id)!.character!.attrPoints = 2
    tickNpcLife(state)
    for (let i = 0; i < 10; i++) passDays(state, 9)
    const c = npcRecord(state, id)!.character!
    expect(c.level).toBeGreaterThan(2)
    expect(c.attrPoints).toBeGreaterThan(2)
  })
})

describe('NPC 自己的日子：去的地方', () => {
  it('skips dungeons that have not appeared, theme parks, and dungeons far above his level', () => {
    setNpcLife({ days: 1 })
    const state = game()
    const towns = geography.locations.filter((l) => l.type !== 'dungeon' && ['central', 'south'].includes(l.region) && !l.requires)
    const ids: string[] = []
    for (const t of towns) {
      const rec = registerNpc(state, withRng(state, (rng) => generateNpc(state, rng, { level: 2, location: t.id, class: 'fighter' })))
      ensureRelationship(state, rec)
      setAffinity(state, rec.id, 50)
      ids.push(rec.id)
    }
    state.party[0]!.level = 2
    tickNpcLife(state)
    const places = new Set<string>()
    for (let i = 0; i < 30; i++) {
      passDays(state, 1)
      for (const id of ids) for (const n of newsOf(state, id)) if (n.place) places.add(n.place)
    }
    const dungeons = geography.locations.filter((l) => l.type === 'dungeon')
    const visited = dungeons.filter((l) => places.has(l.name))
    expect(visited.length).toBeGreaterThan(0)
    for (const l of visited) {
      expect(l.requires).toBeUndefined()
      expect(l.park).toBeUndefined()
      expect(dungeonEntryLevel(l.id)!).toBeLessThanOrEqual(2 + DUNGEON_LEVEL_SLACK)
    }
    expect(places.has('歷史裂縫')).toBe(false)
  })

  it('does not catch up on the days it was switched off', () => {
    setNpcLife({ days: 3 })
    const state = game()
    const rec = friend(state, 50)
    tickNpcLife(state)
    setNpcLife({ on: false })
    passDays(state, 60)
    setNpcLife({ on: true })
    passDays(state, 0)
    expect(newsOf(state, rec.id)).toEqual([])
    passDays(state, 3)
    expect(newsOf(state, rec.id).length).toBe(1)
  })
})


describe('NPC 自己的日子：重逢時寫（store）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('asks the AI once per reunion, even when it fails', async () => {
    const providers = await import('@/narrator/providers')
    const complete = vi.mocked(providers.completeText)
    const { useGame } = await import('@/stores/game')
    const { useSettings } = await import('@/stores/settings')
    const settings = useSettings()
    settings.sources[0]!.configs.anthropic.apiKey = 'test'
    settings.npcLifeAi = 'reunion'
    await nextTick()
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const rec = friend(game.state!, 50)
    game.runAction(() => ({}))
    complete.mockClear()
    complete.mockRejectedValue(new Error('boom'))
    // 有近況、回到隊上（在身邊）
    game.runAction((s) => { s.npcLife!.news[rec.id] = [{ day: 1, text: '在近郊討伐魔物。' }]; s.party.push(characterFor(s, npcRecord(s, rec.id)!)) })
    for (let i = 0; i < 5; i++) {
      game.runAction(() => ({}))
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(complete).toHaveBeenCalledTimes(1)
    // 離開身邊再見面：再寫一次
    game.runAction((s) => { s.party = s.party.filter((m) => m.id !== rec.id) })
    game.runAction((s) => { s.party.push(characterFor(s, npcRecord(s, rec.id)!)) })
    await new Promise((r) => setTimeout(r, 5))
    expect(complete).toHaveBeenCalledTimes(2)
    complete.mockReset()
  })
})
