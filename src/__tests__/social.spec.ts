import { describe, expect, it } from 'vitest'
import { startCombat } from '@/engine/combat'
import { enterLocation } from '@/engine/grid'
import {
  addMemory, editMemory, editRelationship, formatContext, queryForReport, selectContext, setAffinity,
} from '@/engine/social'
import { migrate, newGame } from '@/engine/state'
import { buyRations, recruit } from '@/engine/town'
import { arriveAt } from './helpers/travel'
import type { GameState } from '@/engine/types'
import { buildPrompt } from '@/narrator/prompt'
import { fightToEnd } from './helpers/fight'

function game(seed = 1): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'barbarian', seed })
  enterLocation(state)
  return state
}

describe('relationships', () => {
  it('creates an entry with appearance and existing relations when meeting an NPC', () => {
    const state = game()
    recruit(state, 'npc_lina')
    const lina = state.relationships!.npc_lina!
    expect(lina.appearance).toContain('貓耳')
    expect(lina.toOthers.npc_selene).toContain('甜點')
    expect(lina.firstMet?.location).toBe('soriel')
    expect(lina.toPlayer).toContain('冒險夥伴')
  })

  it('keeps the party member affinity in sync with the relationship entry', () => {
    const state = game(3)
    recruit(state, 'npc_lina')
    state.location = 'snake_creek'
    for (let i = 0; i < 5; i++) {
      for (const m of state.party) m.hp = m.maxHp
      startCombat(state, [['giant_rat', 1]])
      fightToEnd(state)
    }
    const lina = state.party.find((m) => m.id === 'npc_lina')!
    expect(lina.affinity).toBeGreaterThan(0)
    expect(state.relationships!.npc_lina!.affinity).toBe(lina.affinity)
    setAffinity(state, 'npc_lina', 500)
    expect(lina.affinity).toBe(100)
  })

  it('only lets the player edit the text fields', () => {
    const state = game()
    recruit(state, 'npc_lina')
    editRelationship(state, 'npc_lina', { toPlayer: '信任的同伴', toOthers: { npc_selene: '', npc_kai: '聽說過' } })
    const lina = state.relationships!.npc_lina!
    expect(lina.toPlayer).toBe('信任的同伴')
    expect(lina.toOthers).toEqual({ npc_kai: '聽說過' })
  })

  it('edits the personality everywhere the AI reads it; blank keeps the old one', async () => {
    const { npcRecord } = await import('@/engine/npcs')
    const state = game()
    recruit(state, 'npc_lina')
    editRelationship(state, 'npc_lina', { personality: '  嘴硬心軟，喜歡逞強。 ' })
    expect(state.relationships!.npc_lina!.personality).toBe('嘴硬心軟，喜歡逞強。')
    expect(state.party.find((m) => m.id === 'npc_lina')!.personality).toBe('嘴硬心軟，喜歡逞強。')
    expect(npcRecord(state, 'npc_lina')!.personality).toBe('嘴硬心軟，喜歡逞強。')
    editRelationship(state, 'npc_lina', { personality: '   ' })
    expect(state.relationships!.npc_lina!.personality).toBe('嘴硬心軟，喜歡逞強。')
    expect(formatContext(state, { relationships: [state.relationships!.npc_lina!], memories: [] } as never)).toContain('性格：嘴硬心軟，喜歡逞強。')
  })
})

describe('memories', () => {
  it('records important reports with time, location and participants', () => {
    const state = game(2)
    recruit(state, 'npc_lina')
    buyRations(state, 2)
    arriveAt(state, 'snake_creek')
    const kinds = state.memories!.map((m) => state.reports.find((r) => r.report_id === m.report)!.kind)
    expect(kinds).toEqual(['social', 'travel'])
    const trip = state.memories![1]!
    expect(trip.location).toBe('snake_creek')
    expect(trip.participants).toEqual(['pc', 'npc_lina'])
    expect(trip.time.day).toBe(1)
  })

  it('selects memories by shared participants and location, ranks pinned ones first, and skips the current report', () => {
    const state = game(4)
    recruit(state, 'npc_lina')
    const recruitReport = state.reports.at(-1)!
    addMemory(state, { time: { day: 1, hour: 9 }, location: 'soriel', participants: ['pc', 'npc_lina'], summary: '莉娜說出怕水的原因', importance: 3 })
    addMemory(state, { time: { day: 1, hour: 10 }, location: 'rivervale', participants: ['pc'], summary: '獨自在河谷鎮喝酒', importance: 1 })
    addMemory(state, { time: { day: 1, hour: 11 }, location: 'albena', participants: ['pc'], summary: '在阿爾貝納被扒了錢包', importance: 1 })
    const pinned = state.memories!.at(-1)!
    editMemory(state, pinned.id, { pinned: true })

    const ctx = selectContext(state, { participants: ['pc', 'npc_lina'], location: 'rivervale', excludeReport: recruitReport.report_id })
    const summaries = ctx.memories.map((m) => m.summary)
    expect(summaries).toContain('莉娜說出怕水的原因')
    expect(summaries).toContain('獨自在河谷鎮喝酒')
    expect(summaries).toContain('在阿爾貝納被扒了錢包')
    expect(ctx.memories.some((m) => m.report === recruitReport.report_id)).toBe(false)
    expect(ctx.relationships.map((r) => r.id)).toEqual(['npc_lina'])

    const unrelated = selectContext(state, { participants: ['pc'], location: 'dawnlight' })
    expect(unrelated.memories.map((m) => m.summary)).toEqual(['在阿爾貝納被扒了錢包'])
  })

  it('formats the context for the AI and puts it into the narration prompt', () => {
    const state = game(5)
    recruit(state, 'npc_lina')
    state.location = 'snake_creek'
    startCombat(state, [['giant_rat', 1]])
    const report = fightToEnd(state)
    const text = formatContext(state, selectContext(state, queryForReport(state, report)))
    expect(text).toContain('<relationships>')
    expect(text).toContain('莉娜（女性）｜親密度')
    expect(text).toContain('與他人：瑟琳：')
    expect(text).toContain('外貌：')
    expect(text).toContain('<memories>')
    expect(text).toContain('艾倫、莉娜')
    const prompt = buildPrompt(report, [], { playerName: '艾倫', language: 'zh-Hant', context: text })
    expect(prompt.user).toContain('<relationships>')
    expect(prompt.system).toContain('<memories>')
  })
})

describe('migration', () => {
  it('builds relationships from party members and memories from past reports', () => {
    const state = game(6)
    recruit(state, 'npc_lina')
    arriveAt(state, 'rivervale')
    const old = JSON.parse(JSON.stringify(state)) as GameState
    old.party.find((m) => m.id === 'npc_lina')!.affinity = 33
    delete old.relationships
    delete old.memories
    migrate(old)
    expect(old.relationships!.npc_lina!.affinity).toBe(33)
    expect(old.relationships!.npc_lina!.appearance).not.toBe('')
    expect(old.memories!.length).toBe(2)
  })
})
