import { afterEach, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import worldbook from '../../data/worldbook/elondia.worldbook.json'
import schema from '../../schemas/report.schema.json'
import { prepareAction, resolveAction, sanitizeJudgment } from '@/engine/actions'
import { finishCombat, startCombat } from '@/engine/combat'
import { combatRules, slaveryRules } from '@/engine/data'
import { afterCombat, enterLocation, goOutskirts, standOn } from '@/engine/grid'
import { generateNpc } from '@/engine/npcs'
import { ensureRoster } from '@/engine/population'
import { answerMasterEvent, masterCandidates, startAsSlave, startMasterEvent } from '@/engine/slavery'
import { newGame, withRng } from '@/engine/state'
import type { GameState, Report } from '@/engine/types'
import { composeJudge, composeNarration, narrationTarget } from '@/narrator/compose'
import { loreItems, type Worldbook } from '@/narrator/lore'
import { defaultPromptConfig } from '@/narrator/promptConfig'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const defeatDc = combatRules.defeat_event.check.dc

afterEach(() => {
  combatRules.defeat_event.check.dc = defeatDc
})

/** 提示詞裡某一段的文字（沒有這一段時是空字串） */
const sec = (p: { sections?: { key: string; text: string }[] }, key: string) => p.sections?.find((x) => x.key === key)?.text ?? ''

function options() {
  return { config: defaultPromptConfig(), lore: loreItems(worldbook as unknown as Worldbook, {}, []), budgetChars: 20000, language: 'zh-Hant' as const }
}

/** 判定請求也帶世界書 */
function judgeOptions() {
  const o = options()
  o.config.loreInJudge = true
  return o
}

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 3, birthplace: 'soriel' })
  enterLocation(state)
  ensureRoster(state, 'soriel')
  return state
}

function act(state: GameState, input: Parameters<typeof prepareAction>[1], natural: number, judgment: unknown = null) {
  prepareAction(state, input)
  state.pendingAction!.natural = natural
  const r = resolveAction(state, judgment ? sanitizeJudgment(state, state.pendingAction!, judgment) : null)
  expect(validate(r), JSON.stringify(validate.errors)).toBe(true)
  return r
}

function slave(): GameState {
  const state = game()
  const [rec] = masterCandidates('soriel', 3)
  startAsSlave(state, { master: { type: 'candidate', rec: rec! }, mark: 'labor' })
  return state
}

function answer(state: GameState, event: string, option: number): Report {
  startMasterEvent(state, slaveryRules.master_events.events.find((e) => e.id === event)!)
  const r = answerMasterEvent(state, option)
  expect(validate(r), JSON.stringify(validate.errors)).toBe(true)
  return r
}

describe('adult scenes', () => {
  it('asks the narrator to describe a brothel visit in detail', () => {
    const state = game()
    standOn(state, 'brothel')
    state.money_cc = 100
    const r = act(state, { kind: 'patron', text: '' }, 20)
    expect(r.narration?.adult_scene).toContain('娼館')
    expect(r.narration?.length).toBe('medium')
    const prompt = composeNarration(state, r, options()).prompt
    expect(prompt.system).toContain('<adult_scene>')
    expect(prompt.user).toContain('成人場景：在娼館')
    expect(prompt.user).toContain('約 500～900 字')
    // 成人向的世界書只跟著成人場景送出
    expect(prompt.system).toContain('叙事倾向与事件触发机制')
    const plain: Report = { ...r, narration: { ...r.narration } }
    delete plain.narration!.adult_scene
    const general = composeNarration(state, plain, options()).prompt
    expect(general.system).not.toContain('<adult_scene>')
    expect(general.system).not.toContain('叙事倾向与事件触发机制')
    expect(general.user).not.toContain('成人場景')
  })

  it('marks brothel work but not other jobs', () => {
    const state = game()
    standOn(state, 'brothel')
    expect(act(state, { kind: 'work', target: '4', text: '' }, 15).narration?.adult_scene).toContain('接客')
    // 接客時可能遇到打工事件（docs/LEWD_STATS.md 第 10 節）：這裡不管它
    delete state.pendingMasterEvent
    standOn(state, 'tavern')
    expect(act(state, { kind: 'work', target: '4', text: '' }, 15).narration?.adult_scene).toBeUndefined()
  })

  it('follows the answer to the master: accepting the proposition or failing to refuse the brothel', () => {
    const yes = answer(slave(), 'proposition', 0)
    expect(yes.narration?.adult_scene).toMatch(/^陪.+共度$/)
    expect(composeNarration(null, yes, options()).prompt.system).toContain('<adult_scene>')
    // 拒絕的回應：不論成敗都沒有場景
    expect(answer(slave(), 'proposition', 2).narration?.adult_scene).toBeUndefined()
    // 哀求主人：失敗時還是被推進娼館
    const plea = answer(slave(), 'brothel_forced', 1)
    expect(plea.narration?.adult_scene === undefined).toBe(plea.outcome.result === 'success')
    expect(answer(slave(), 'brothel_forced', 0).narration?.adult_scene).toContain('娼館接客')
  })

  it('lets the AI judge flag a scene in a free response or action', () => {
    const state = slave()
    startMasterEvent(state, slaveryRules.master_events.events.find((e) => e.id === 'proposition')!)
    prepareAction(state, { kind: 'master_event', text: '紅著臉點頭' })
    const judge = composeJudge(state, state.pendingAction!, judgeOptions()).prompt
    expect(judge.system).toContain('adult_scene')
    expect(judge.system).toContain('<adult_scene>')
    expect(judge.user).toContain('依主角的回應與你的判定決定是否進入')
    const r = resolveAction(state, sanitizeJudgment(state, state.pendingAction!, { degree: 'success', attr: 'cha', dc: 12, adult_scene: '答應了主人，陪他過夜' }))
    expect(r.narration?.adult_scene).toBe('答應了主人，陪他過夜')

    // 成人向的條目只在可能進入親密場景的行動送出；自由行動照樣可以由 AI 標出場景
    expect(judge.system).toContain('叙事倾向与事件触发机制')
    const free = game()
    expect(act(free, { kind: 'free', text: '在河邊散步' }, 12, { degree: 'success', attr: 'cha', dc: 12 }).narration?.adult_scene).toBeUndefined()
    const walk = composeJudge(free, prepareAction(free, { kind: 'free', text: '散步' }), judgeOptions()).prompt.system
    expect(walk).toContain('adult_scene')
    expect(walk).not.toContain('叙事倾向与事件触发机制')
    expect(sanitizeJudgment(free, free.pendingAction!, { degree: 'success', attr: 'cha', dc: 12, adult_scene: '親密場景' }).adult_scene).toBe('親密場景')
  })

  it('sends the adult-scene styles with a judge that writes the narrative, to use only if it flags a scene', () => {
    // 玩家回報：明明成人向文風禁止「肉刃」，自由行動寫到性愛場景時還是一直出現（判定寫經過時，成人向條目整個沒送）
    const free = game()
    const p = prepareAction(free, { kind: 'free', text: '邀她回房間' })
    const judge = composeJudge(free, p, judgeOptions()).prompt
    const scene = sec(judge, 'scene')
    expect(scene).toContain('<adult_style>')
    expect(scene).toContain('NSFW 底座')
    expect(scene).toContain('沒有親密場景時不要套用')
    expect(sec(judge, 'style')).not.toContain('NSFW 底座')
    // 經過另外交給寫手時（分開寫）不必附
    const split = composeJudge(free, p, { ...judgeOptions(), splitNarrative: true }).prompt
    expect(sec(split, 'scene')).not.toContain('<adult_style>')
  })

  it('uses the adult entries for an entry the writer flagged as a sex scene, and offers them when it might become one', () => {
    const state = game()
    const r = act(state, { kind: 'free', text: '在河邊散步' }, 12, { degree: 'success', attr: 'cha', dc: 12 })
    const plain = composeNarration(state, r, options(), undefined, { flagIntimate: true }).prompt
    expect(sec(plain, 'style')).not.toContain('NSFW 底座')
    expect(sec(plain, 'scene')).toContain('<adult_style>')
    expect(sec(composeNarration(state, r, options()).prompt, 'scene')).toBe('')
    // 寫手標出過性愛場景（重新生成、續寫）：照成人向的條目寫
    const flagged = { ...r, narration: { ...r.narration, intimate_note: '兩人在河邊溫存' } } as Report
    const again = composeNarration(state, flagged, options()).prompt
    expect(again.system).toContain('NSFW 底座')
    expect(sec(again, 'scene')).not.toContain('<adult_style>')
  })

  it('describes the defeat event in detail only when the hero fails to get away', () => {
    combatRules.defeat_event.check.dc = -100
    const respond = (natural: number) => {
      const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 7 })
      goOutskirts(state)
      const rec = withRng(state, (rng) => generateNpc(state, rng, { tags: ['villain'], level: 1, location: state.location }))
      startCombat(state, [], { npcs: [rec.id] })
      for (const c of state.combat!.combatants) if (c.side === 'party') c.hp = 0
      state.combat!.status = 'defeat'
      const report = finishCombat(state)
      afterCombat(state, report)
      // 前半段停在動手前：還沒有場景
      expect(report.narration?.adult_scene).toBeUndefined()
      return act(state, { kind: 'defeat_event', target: 'opt:0', text: '' }, natural)
    }
    const caught = respond(1)
    expect(caught.check?.degree).toBe('fumble')
    expect(caught.narration?.adult_scene).toContain('手中')
    expect(composeNarration(null, caught, options()).prompt.system).toContain('<adult_scene>')
    const away = respond(20)
    expect(away.check?.degree).toBe('critical')
    expect(away.narration?.adult_scene).toBeUndefined()
  })

  it('uses the adult-scene entries and keeps the shared prefix cacheable', () => {
    const state = game()
    standOn(state, 'brothel')
    state.money_cc = 100
    const scene = act(state, { kind: 'patron', text: '' }, 20)
    const plain: Report = { ...scene, narration: { ...scene.narration, adult_scene: undefined } }
    delete plain.narration!.adult_scene
    const o = options()
    o.config.styles = [
      { id: 's1', name: '共用文風', content: '共用的文風', enabled: true, targets: ['narration', 'adult'] },
      { id: 's2', name: '成人文風', content: '成人場景專用的文風', enabled: true, targets: ['adult'], adult: true },
    ]
    expect(narrationTarget(scene)).toBe('adult')
    expect(narrationTarget(plain)).toBe('narration')
    const a = composeNarration(state, scene, o).prompt.system
    const n = composeNarration(state, plain, o).prompt.system
    expect(a).toContain('成人場景專用的文風')
    expect(n).not.toContain('成人場景專用的文風')
    // 文風相同時，一般日誌的 system 是成人場景的開頭：成人場景規則放在最後，前面可以共用快取
    o.config.styles = [o.config.styles[0]!]
    const shared = composeNarration(state, plain, o).prompt.system
    const withScene = composeNarration(state, scene, o).prompt.system
    expect(withScene.startsWith(shared)).toBe(true)
    expect(withScene.slice(shared.length)).toContain('<adult_scene>')
  })
})
