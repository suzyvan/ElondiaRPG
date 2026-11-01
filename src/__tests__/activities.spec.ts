import { describe, expect, it } from 'vitest'
import { activityPeriod, npcActivity, noteBystanders } from '@/engine/activities'
import { landmarkTypes, npcActivities } from '@/engine/data'
import { CELL_NAME, currentArea, enterLocation, standOn } from '@/engine/grid'
import { generateNpc } from '@/engine/npcs'
import { peopleHere } from '@/engine/population'
import { addHours, newGame, withRng } from '@/engine/state'
import type { GameState, Report } from '@/engine/types'
import { buildPrompt } from '@/narrator/prompt'

// 這裡的人在做什麼：不用 AI 的活動表（docs/NPC_SYSTEM.md 7.1 節）

function game(seed = 1): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed })
  enterLocation(state)
  return state
}

function report(state: GameState, kind: Report['kind'] = 'action'): Report {
  return {
    schema_version: '0.1', report_id: `r-test-${state.nextReportNo++}`, kind,
    time: { start: { ...state.time }, end: addHours(state.time, 1) },
    location: { at: state.location }, party: [{ id: 'pc', name: '艾倫' }], outcome: { result: 'success', summary: '事件' }, changes: {},
  }
}

/** 站在酒館、身邊有一個人 */
function tavernWithSomeone(seed = 1) {
  const state = game(seed)
  standOn(state, 'tavern')
  const rec = withRng(state, (rng) => generateNpc(state, rng, { spot: 'tavern' }))
  const p = peopleHere(state).find((x) => x.rec.id === rec.id)!
  return { state, rec, p }
}

describe('npc activity table', () => {
  it('only uses known places, areas, periods and fields', () => {
    const places = new Set([...Object.keys(CELL_NAME), 'landmark', ...Object.keys(landmarkTypes).map((t) => `landmark:${t}`)])
    const fields = new Set(['at', 'area', 'kind', 'staff', 'tags', 'occupation', 'personality', 'when', 'hostile', 'weight', 'list'])
    for (const r of npcActivities.rules) {
      expect(r.list.length).toBeGreaterThan(0)
      for (const k of Object.keys(r)) expect(fields, k).toContain(k)
      for (const a of r.at ?? []) expect(places, a).toContain(a)
      for (const a of r.area ?? []) expect(['settlement', 'wild', 'dungeon', 'road', 'side', 'home', 'special']).toContain(a)
      for (const w of r.when ?? []) expect(Object.keys(npcActivities.periods)).toContain(w)
    }
  })

  it('maps hours to periods, wrapping the night past midnight', () => {
    expect(activityPeriod(6)).toBe('dawn')
    expect(activityPeriod(12)).toBe('day')
    expect(activityPeriod(18)).toBe('evening')
    expect(activityPeriod(23)).toBe('night')
    expect(activityPeriod(2)).toBe('night')
  })

  it('picks a fixed line for the time slot, from the rules that match the place', () => {
    const { state, p } = tavernWithSomeone()
    state.time.hour = 20
    const text = npcActivity(state, p)
    expect(text).toBeTruthy()
    expect(npcActivity(state, p)).toBe(text)
    // 酒館的規則或不限地點的規則（沒有別處的格子才有的活動）
    const allowed = npcActivities.rules.filter((r) => !r.at || r.at.includes('tavern')).flatMap((r) => r.list)
    expect(allowed).toContain(text)
    // 換時段可能換一件事，但永遠是一句
    state.time.hour = 10
    expect(npcActivity(state, p)).toBeTruthy()
  })

  it('shows hostile people only with hostile lines', () => {
    const { state, rec, p } = tavernWithSomeone(2)
    rec.hostile = true
    const hostileLines = npcActivities.rules.filter((r) => r.hostile).flatMap((r) => r.list)
    expect(hostileLines).toContain(npcActivity(state, p))
  })

  it('keeps street lines in towns: no buying dinner at a stall in a dungeon or the outskirts', () => {
    const state = game(6)
    const town = currentArea(state)
    const rec = withRng(state, (rng) => generateNpc(state, rng, { spot: 'tavern' }))
    rec.tags = [...(rec.tags ?? []), 'traveler']
    const i = town.cells.findIndex((c) => c.kind === 'floor')
    const p = { ...peopleHere(state).find((x) => x.rec.id === rec.id)!, x: i % town.width, y: Math.floor(i / town.width) }
    // 街上的活動（站在路上的規則）與只寫了城鎮的規則
    const townOnly = new Set(npcActivities.rules.filter((r) => r.at?.includes('floor') || (r.area?.length === 1 && r.area[0] === 'settlement')).flatMap((r) => r.list))
    for (const kind of ['dungeon', 'wild', 'road'] as const) {
      const area = { ...town, key: `test/${kind}`, kind }
      for (let d = 0; d < 6; d++) {
        for (let h = 0; h < 24; h += 2) {
          state.time.day = 1 + d
          state.time.hour = h
          const text = npcActivity(state, p, area)
          expect(text, `${kind} ${h}h`).toBeTruthy()
          expect(townOnly.has(text), `${kind} ${h}h：${text}`).toBe(false)
        }
      }
    }
    // 城裡照舊有街上的活動
    const seen = new Set<string>()
    for (let d = 0; d < 6; d++) for (let h = 0; h < 24; h += 2) {
      state.time.day = 1 + d
      state.time.hour = h
      seen.add(npcActivity(state, p, town))
    }
    expect([...seen].some((t) => townOnly.has(t))).toBe(true)
  })

  it('fills {place} with the name of the landmark or cell', () => {
    const state = game(3)
    const area = currentArea(state)
    const rec = withRng(state, (rng) => generateNpc(state, rng, { spot: 'tavern' }))
    const p = { ...peopleHere(state).find((x) => x.rec.id === rec.id)!, x: 0, y: 0 }
    // 不管挑到哪一條，都不會留下沒換掉的 {place}
    for (let h = 0; h < 24; h += 2) {
      state.time.hour = h
      expect(npcActivity(state, p, area)).not.toContain('{place}')
    }
  })
})

describe('bystanders', () => {
  it('notes the people beside the protagonist who are not part of the event', () => {
    const { state, rec } = tavernWithSomeone(4)
    const r = report(state)
    noteBystanders(state, r)
    const b = r.bystanders?.find((x) => x.id === rec.id)
    expect(b?.name).toBe(rec.name)
    expect(b?.doing).toBeTruthy()
    // 已經記過的不重算；行動的對象不算旁人
    const again = report(state)
    again.others = [{ id: rec.id, name: rec.name }]
    noteBystanders(state, again)
    expect(again.bystanders?.some((x) => x.id === rec.id) ?? false).toBe(false)
    // 戰鬥、交易不附
    const fight = report(state, 'combat')
    noteBystanders(state, fight)
    expect(fight.bystanders).toBeUndefined()
  })

  it('sends them to the writer as a separate block, not inside the report JSON', () => {
    const { state } = tavernWithSomeone(5)
    const r = report(state)
    r.bystanders = [{ id: 'gen_1', name: '布倫', role: '戰士', doing: '在角落擦拭武器' }]
    const prompt = buildPrompt(r, [], { playerName: '艾倫', language: 'zh-Hant' })
    expect(prompt.user).toContain('<bystanders>\n- 布倫（戰士）：在角落擦拭武器\n</bystanders>')
    expect(prompt.user).toContain('不要讓他們加入事件或搶戲')
    const json = /<report>\n([\s\S]*?)\n<\/report>/.exec(prompt.user)![1]!
    expect(JSON.parse(json).bystanders).toBeUndefined()
    // 沒有旁人時不帶這一段與說明
    const plain = buildPrompt(report(state), [], { playerName: '艾倫', language: 'zh-Hant' })
    expect(plain.user).not.toContain('bystanders')
  })
})
