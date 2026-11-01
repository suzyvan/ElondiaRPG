import { afterEach, describe, expect, it } from 'vitest'
import worldbook from '../../data/worldbook/elondia.worldbook.json'
import { pcBodyAllowed, setMascBodyContent } from '@/engine/content'
import { stories } from '@/engine/data'
import { enterLocation, getArea, placeAt } from '@/engine/grid'
import { applyContent, emptyMods, normalizeMods } from '@/engine/mods'
import { prepareAction } from '@/engine/actions'
import { newGame } from '@/engine/state'
import { activeNodes, canStart, playNode, startStory, storyPauseReason } from '@/engine/story'
import type { StoryMod } from '@/engine/storyMods'
import { baseReport } from '@/engine/town'
import type { GameState } from '@/engine/types'
import { buildActionPrompt } from '@/narrator/judge'
import { composeJudge, composeNarration } from '@/narrator/compose'
import { loreItems, type Worldbook } from '@/narrator/lore'
import { defaultPromptConfig } from '@/narrator/promptConfig'

afterEach(() => {
  setMascBodyContent(false)
  applyContent(emptyMods())
})

function game(body: 'masc' | 'fem'): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 7, birthplace: 'soriel' })
  state.party[0]!.body = body
  enterLocation(state)
  return state
}

/** 站到晨光城的怪人之塔（希爾德加德的任務點） */
function atTower(state: GameState) {
  state.location = 'dawnlight'
  placeAt(state, getArea(state, 'dawnlight/gate'), 5, 1)
}

const options = { config: defaultPromptConfig(), lore: loreItems(worldbook as unknown as Worldbook, {}, []), budgetChars: 20000, language: 'zh-Hant' as const }
const NOTE = '是陽剛的男性身體'

describe('陽剛體型也能遇到限定陰柔、中性的成人內容', () => {
  it('opens content limited to feminine and androgynous bodies only when switched on', () => {
    expect(pcBodyAllowed(undefined, 'masc')).toBe(true)
    expect(pcBodyAllowed(['fem', 'andro'], 'fem')).toBe(true)
    expect(pcBodyAllowed(['fem', 'andro'], 'masc')).toBe(false)
    setMascBodyContent(true)
    expect(pcBodyAllowed(['fem', 'andro'], 'masc')).toBe(true)
    // 只放寬陽剛：限定陽剛的內容照舊不給其他體型
    expect(pcBodyAllowed(['masc'], 'fem')).toBe(false)
  })

  it('lets a masculine hero take such a story', () => {
    const fem: StoryMod = {
      id: 'fem_only', title: '限定', summary: '', start: { kind: 'guild', location: 'soriel', pc_body: ['fem', 'andro'] }, start_flags: ['f_started'], custom: true, tags: ['adult'],
      nodes: [{ id: 'n1', title: '一', text: '', at: { where: 'cell', location: 'soriel', cell: 'guild' }, kind: 'story', requires: { flags: ['f_started'] }, success: { complete: true } }],
    }
    applyContent(normalizeMods({ ...emptyMods(), stories: { fem_only: fem } }))
    const def = stories.find((s) => s.id === 'fem_only')!
    expect(canStart(game('fem'), def)).toBe(true)
    expect(canStart(game('masc'), def)).toBe(false)
    setMascBodyContent(true)
    expect(canStart(game('masc'), def)).toBe(true)
  })

  it('tells the AI to write the masculine body in adult scenes, only when switched on', () => {
    const scene = (state: GameState) => {
      const r = baseReport(state, 'event', 1)
      r.narration = { ...r.narration, adult_scene: '兔女郎被貴賓摸遍全身' }
      return composeNarration(state, r, options).prompt.system
    }
    expect(scene(game('masc'))).not.toContain(NOTE)
    setMascBodyContent(true)
    expect(scene(game('masc'))).toContain(NOTE)
    expect(scene(game('fem'))).not.toContain(NOTE)
    // 不是成人場景時不附
    const plain = game('masc')
    expect(composeNarration(plain, baseReport(plain, 'event', 1), options).prompt.system).not.toContain(NOTE)
    // 判定順便寫經過時，接在成人場景規則後面
    const judged = game('masc')
    const p = prepareAction(judged, { kind: 'free', text: '和貴賓喝一杯' })
    expect(composeJudge(judged, p, options).prompt.system).toContain(NOTE)
    expect(buildActionPrompt(judged, p, '', { narrative: true }).system).not.toContain(NOTE)
  })

  it('pauses a limited story already under way when the setting is turned off, and resumes when it is back on', () => {
    setMascBodyContent(true)
    const state = game('masc')
    state.party[0]!.level = 13
    startStory(state, 'odd_measure')
    atTower(state)
    const nodes = () => activeNodes(state).filter((n) => n.def.id === 'odd_measure')
    expect(nodes().length).toBe(1)
    setMascBodyContent(false)
    expect(storyPauseReason(state, stories.find((s) => s.id === 'odd_measure')!)).toBe('body')
    expect(nodes()).toEqual([])
    expect(state.stories!.odd_measure!.status).toBe('active')
    expect(() => playNode(state, 'odd_measure:strip')).toThrow('沒辦法進行')
    setMascBodyContent(true)
    expect(nodes().length).toBe(1)
    // 體型改回陰柔也接著進行
    setMascBodyContent(false)
    state.party[0]!.body = 'fem'
    expect(nodes().length).toBe(1)
  })

  it('also tells the AI about the body on non-intimate steps of limited content', () => {
    setMascBodyContent(true)
    const state = game('masc')
    state.party[0]!.level = 13
    startStory(state, 'odd_measure')
    atTower(state)
    const ref = activeNodes(state).find((n) => n.def.id === 'odd_measure')!.ref
    const r = playNode(state, ref) as ReturnType<typeof baseReport>
    expect(r.narration?.adult_scene).toBeUndefined()
    expect(r.narration?.body_limited).toBe(true)
    expect(composeNarration(state, r, options).prompt.system).toContain(NOTE)
    // 報告本身不帶這個旗標
    expect(composeNarration(state, r, options).prompt.user).not.toContain('body_limited')
    // 陰柔主角不附
    const fem = game('fem')
    fem.party[0]!.level = 13
    startStory(fem, 'odd_measure')
    atTower(fem)
    const rf = playNode(fem, activeNodes(fem).find((n) => n.def.id === 'odd_measure')!.ref) as ReturnType<typeof baseReport>
    expect(composeNarration(fem, rf, options).prompt.system).not.toContain(NOTE)
  })
})
