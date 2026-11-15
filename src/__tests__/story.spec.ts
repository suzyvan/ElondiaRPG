import { afterEach, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { prepareAction, resolveAction } from '@/engine/actions'
import { finishCombat } from '@/engine/combat'
import { stories } from '@/engine/data'
import { currentArea, currentCell, enterLocation, goOutskirts, standOn } from '@/engine/grid'
import { applyContent, emptyMods, normalizeMods } from '@/engine/mods'
import { npcRecord, registerNpc } from '@/engine/npcs'
import { newGame } from '@/engine/state'
import { ensureRelationship, setAffinity } from '@/engine/social'
import { abandonStory, activeNodes, nodesHere, playNode, startStory, storyMarks, storyOffersHere } from '@/engine/story'
import { hasFlag } from '@/engine/storyFlags'
import { flagUsage, newStory, sanitizeStory, storyIssues } from '@/engine/storyMods'
import type { GameState, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

afterEach(() => applyContent(emptyMods()))

function game(): GameState {
  const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 5, birthplace: 'soriel' })
  enterLocation(state)
  return state
}

/** 站到這一區的任務點（❗）上 */
function standOnMarker(state: GameState, ref: string) {
  const area = currentArea(state)
  const i = area.cells.findIndex((c) => c.storyNode === ref)
  expect(i, `marker ${ref}`).toBeGreaterThanOrEqual(0)
  state.position = { area: area.key, x: i % area.width, y: Math.floor(i / area.width) }
}

describe('special quests', () => {
  it('has a sample chain without problems', () => {
    const def = stories.find((s) => s.id === 'lost_relic')!
    expect(storyIssues(def)).toEqual([])
    expect(flagUsage(def).find((u) => u.flag === 'relic_lead')).toMatchObject({ setBy: ['到索里耶爾的酒館打聽消息・成功'], requiredBy: ['在索里耶爾近郊追查兜帽人的足跡'] })
  })

  it('is offered by the fixed NPC when she is nearby', () => {
    const state = game()
    standOn(state, 'temple')
    const p = state.position!
    registerNpc(state, { ...npcRecord(state, 'npc_selene')!, at: { area: p.area, x: p.x, y: p.y, until: state.time.day } })
    expect(storyOffersHere(state).map((s) => s.id)).toContain('lost_relic')
  })

  it('marks the people who give quests and the places with quest nodes on the map', () => {
    const state = game()
    standOn(state, 'temple')
    const p = state.position!
    registerNpc(state, { ...npcRecord(state, 'npc_selene')!, at: { area: p.area, x: p.x, y: p.y, until: state.time.day } })
    const selene = { rec: npcRecord(state, 'npc_selene')! }
    expect(storyMarks(state, [selene]).npcs.has('npc_selene')).toBe(true)
    // 接了之後：第一個任務點在酒館
    startStory(state, 'lost_relic')
    const marks = storyMarks(state, [selene])
    expect(marks.cells.has('tavern')).toBe(true)
    expect(marks.npcs.has('npc_selene')).toBe(false)
  })

  it('needs enough affinity with the fixed NPC when the start sets a threshold', () => {
    const state = game()
    standOn(state, 'temple')
    const p = state.position!
    registerNpc(state, { ...npcRecord(state, 'npc_selene')!, at: { area: p.area, x: p.x, y: p.y, until: state.time.day } })
    const def = stories.find((s) => s.id === 'lost_relic')!
    applyContent(normalizeMods({ ...emptyMods(), stories: { lost_relic: sanitizeStory('lost_relic', { ...def, start: { ...def.start, min_affinity: 30 } }, false) } }))
    expect(stories.find((s) => s.id === 'lost_relic')!.start.min_affinity).toBe(30)
    expect(storyOffersHere(state).map((s) => s.id)).not.toContain('lost_relic')
    ensureRelationship(state, npcRecord(state, 'npc_selene')!)
    setAffinity(state, 'npc_selene', 30)
    expect(storyOffersHere(state).map((s) => s.id)).toContain('lost_relic')
    // 不是 NPC 開頭時不保留
    expect(sanitizeStory('y', { ...def, start: { kind: 'guild', location: 'soriel', min_affinity: 30 } }, true).start.min_affinity).toBeUndefined()
  })

  it('plays the whole chain: story, check, combat and choice, with a quest companion', () => {
    const state = game()
    valid(startStory(state, 'lost_relic'))
    expect(hasFlag(state, 'relic_started')).toBe(true)
    expect(activeNodes(state).map((n) => n.node.id)).toEqual(['ask_tavern'])

    // 1. 劇情：酒館
    standOn(state, 'tavern')
    const [tavern] = nodesHere(state)
    const r1 = playNode(state, tavern!.ref) as Report
    valid(r1)
    expect(r1.story).toMatchObject({ id: 'lost_relic', node: 'ask_tavern' })
    expect(state.party.find((m) => m.id === 'npc_selene')?.bond).toBe('guest')
    expect(hasFlag(state, 'relic_lead')).toBe(true)

    // 2. 判定：近郊的任務點
    standOn(state, 'gate')
    goOutskirts(state)
    const ref = 'lost_relic:track'
    standOnMarker(state, ref)
    expect(nodesHere(state).map((n) => n.ref)).toEqual([ref])
    prepareAction(state, { kind: 'story', target: ref, text: '' })
    state.pendingAction!.natural = 1
    resolveAction(state, null)
    // 失敗沒有寫結果：任務點還在，可以再試
    expect(hasFlag(state, 'relic_trail')).toBe(false)
    expect(currentCell(state).storyNode).toBe(ref)
    prepareAction(state, { kind: 'story', target: ref, text: '仔細看車轍之間的腳印' })
    state.pendingAction!.natural = 20
    valid(resolveAction(state, null))
    expect(hasFlag(state, 'relic_trail')).toBe(true)
    expect(currentCell(state).storyNode).toBeUndefined()

    // 3. 戰鬥：地下城周邊的任務點
    state.location = 'whisper_crypt'
    enterLocation(state)
    standOnMarker(state, 'lost_relic:crypt_camp')
    playNode(state, 'lost_relic:crypt_camp')
    expect(state.combat?.story).toEqual({ id: 'lost_relic', node: 'crypt_camp' })
    for (const c of state.combat!.combatants) if (c.side === 'enemy') c.hp = 0
    state.combat!.status = 'victory'
    const r3 = finishCombat(state)
    valid(r3)
    expect(r3.story?.node).toBe('crypt_camp')
    expect(hasFlag(state, 'relic_found')).toBe(true)

    // 4. 選擇：神殿
    state.location = 'soriel'
    enterLocation(state)
    standOn(state, 'temple')
    const before = { level: state.party[0]!.level, xp: state.party[0]!.xp }
    const money = state.money_cc
    const r4 = playNode(state, 'lost_relic:return', 0) as Report
    valid(r4)
    expect(r4.story?.status).toBe('completed')
    expect(state.stories!.lost_relic!.status).toBe('completed')
    expect(state.money_cc).toBe(money + 150)
    // 經驗增加（可能剛好升級，經驗歸零重算）
    const after = state.party[0]!
    expect(after.level > before.level || after.xp > before.xp).toBe(true)
    expect(state.party.some((m) => m.id === 'npc_selene')).toBe(false)
    expect(state.inventory.find((i) => i.name === '治療藥劑')?.qty).toBeGreaterThanOrEqual(2)
    expect(state.stories!.lost_relic!.log.length).toBeGreaterThanOrEqual(5)
  })

  it('can be abandoned, sending the companions away', () => {
    const state = game()
    startStory(state, 'lost_relic')
    standOn(state, 'tavern')
    playNode(state, 'lost_relic:ask_tavern')
    abandonStory(state, 'lost_relic')
    expect(state.stories!.lost_relic!.status).toBe('failed')
    expect(state.party.some((m) => m.id === 'npc_selene')).toBe(false)
    expect(activeNodes(state)).toEqual([])
  })

  it('cleans up authored stories and points out broken chains', () => {
    const s = sanitizeStory('x', {
      ...newStory('x'),
      nodes: [
        { id: 'a', title: 'A', text: '', at: { where: 'cell', location: 'soriel', cell: 'nope' }, kind: 'story', requires: { flags: ['never_set'] }, success: { set_flags: ['b ok'] } },
        { id: 'a', title: 'B', text: '', at: { where: 'npc', npc: 'nobody' }, kind: 'combat' },
      ],
    } as never, true)
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'a_'])
    expect(s.nodes[0]!.at.cell).toBe('tavern')
    expect(s.nodes[0]!.success?.set_flags).toEqual(['b_ok'])
    const issues = storyIssues(s)
    expect(issues.some((i) => i.includes('never_set'))).toBe(true)
    expect(issues.some((i) => i.includes('沒有任何結果會完成任務'))).toBe(true)
    expect(issues.some((i) => i.includes('固定 NPC 不存在'))).toBe(true)
    expect(issues.some((i) => i.includes('沒有敵人'))).toBe(true)
    // 套用到任務清單
    applyContent(normalizeMods({ ...emptyMods(), stories: { x: s } }))
    expect(stories.some((d) => d.id === 'x')).toBe(true)
  })
})
