// 魔物娘與擴大發情（docs/MONSTERS.md 的「魔物娘」，紀錄見 docs/plan/roadmap/COMPLETED.md）
import { afterEach, describe, expect, it } from 'vitest'
import worldbook from '../../data/worldbook/elondia.worldbook.json'
import { finishCombat, startCombat } from '@/engine/combat'
import { combatRules, enemies } from '@/engine/data'
import { setDefeatAlways, setMonsterGirl } from '@/engine/content'
import { afterCombat, goOutskirts } from '@/engine/grid'
import { sanitizeEnemy } from '@/engine/mods'
import { prepareAction } from '@/engine/actions'
import { newGame } from '@/engine/state'
import type { GameState } from '@/engine/types'
import { composeJudge, composeNarration } from '@/narrator/compose'
import { loreItems, type Worldbook } from '@/narrator/lore'
import { monstersText } from '@/narrator/monsters'
import { defaultPromptConfig } from '@/narrator/promptConfig'

afterEach(() => {
  setMonsterGirl('off')
  setDefeatAlways(false)
})

const all = Object.values(enemies)
const park = (id: string) => id.startsWith('lp_')
const options = () => ({ config: defaultPromptConfig(), lore: loreItems(worldbook as unknown as Worldbook, {}, []), budgetChars: 20000, language: 'zh-Hant' as const })

function game(body?: 'masc' | 'fem'): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 7 })
  if (body) state.party[0]!.body = body
  goOutskirts(state)
  return state
}

describe('monster girl data', () => {
  it('gives every monster that can be in rut a monster girl form (theme parks aside)', () => {
    const missing = all.filter((e) => e.rut && !park(e.id) && !e.girl).map((e) => e.id)
    expect(missing).toEqual([])
    expect(all.filter((e) => e.girl).length).toBeGreaterThanOrEqual(140)
  })

  it('writes every monster girl as an adult woman', () => {
    for (const e of all.filter((x) => x.girl)) {
      expect(e.girl!.desc, e.id).toContain('成年')
      expect(`${e.girl!.name}${e.girl!.desc}`, e.id).not.toMatch(/少女|幼|蘿莉|女孩|孩子|小女|童/)
    }
  })

  it('keeps young, undead and theme park monsters out of the monster girl forms', () => {
    for (const e of all) {
      if (/幼/.test(e.name)) {
        expect(e.girl, e.id).toBeUndefined()
        expect(e.rut, e.id).toBeFalsy()
      }
      if (e.kind === 'undead') expect(e.rut || e.girl, e.id).toBeFalsy()
      if (park(e.id)) expect(e.girl, e.id).toBeUndefined()
    }
  })

  it('survives the editor sanitizer (girl form and rut only in the field)', () => {
    const goblin = sanitizeEnemy('goblin', enemies.goblin!, false)
    expect(goblin.rut).toBe('field')
    expect(goblin.girl).toEqual(enemies.goblin!.girl)
    expect(sanitizeEnemy('wolf', enemies.wolf!, false).rut).toBe(true)
    for (const e of all.filter((x) => x.girl)) {
      const out = sanitizeEnemy(e.id, e, false)
      expect([out.rut, out.girl], e.id).toEqual([e.rut, e.girl])
    }
    // 名字或外觀空白的魔物娘拿掉
    expect(sanitizeEnemy('x', { ...enemies.goblin!, girl: { name: '', desc: '一段描述' } }, true).girl).toBeUndefined()
  })
})

describe('rut only in the field', () => {
  /** 一群哥布林（只在野外發情）開戰 n 次，數擲到發情的有幾隻 */
  function ruts(opts: Parameters<typeof startCombat>[2]): number {
    const state = game()
    let n = 0
    for (let i = 0; i < 60; i++) {
      startCombat(state, [['goblin', 6]], opts)
      n += state.combat!.combatants.filter((c) => c.traits?.includes('rut')).length
      delete state.combat
    }
    return n
  }

  it('rolls rut in the wild, but not in story fights unless the story node asks for it', () => {
    expect(enemies.goblin!.rut).toBe('field')
    expect(ruts({})).toBeGreaterThan(0)
    expect(ruts({ story: { id: 'x', node: 'y' } })).toBe(0)
    expect(ruts({ story: { id: 'x', node: 'y' }, fieldRut: true })).toBeGreaterThan(0)
  })
})

describe('monster appearance in prompts', () => {
  /** 和兩隻哥布林打輸（設定一定起意，讓戰敗事件發生） */
  function lose(state: GameState) {
    combatRules.defeat_event.check.dc = -100
    startCombat(state, [['goblin', 2]])
    for (const c of state.combat!.combatants) {
      if (c.side === 'party') c.hp = 0
      else c.traits = [...(c.traits ?? []), 'rut']
    }
    state.combat!.status = 'defeat'
    const report = finishCombat(state)
    combatRules.defeat_event.check.dc = 12
    afterCombat(state, report)
    return report
  }

  it('sends the monster description, and the monster girl form when the setting applies', () => {
    const state = game('masc')
    const report = lose(state)
    expect(report.others?.some((o) => o.monster === 'goblin')).toBe(true)
    const plain = composeNarration(state, report, options()).prompt.user
    expect(plain).toContain('<monsters>')
    expect(plain).toContain(enemies.goblin!.desc!)
    expect(plain).not.toContain(enemies.goblin!.girl!.name)
    // 報告本身不帶怪物 id
    expect(plain).not.toContain('"monster"')

    setMonsterGirl('masc')
    const girl = composeNarration(state, report, options()).prompt.user
    expect(girl).toContain(`哥布林 → ${enemies.goblin!.girl!.name}`)
    expect(girl).toContain(enemies.goblin!.girl!.desc)

    // 戰敗事件的回應：判定也看得到圍上來的魔物娘
    expect(state.pendingDefeat?.foes[0]?.monster).toBe('goblin')
    prepareAction(state, { kind: 'defeat_event', target: 'opt:0', text: '' })
    expect(composeJudge(state, state.pendingAction!, options()).prompt.user).toContain(enemies.goblin!.girl!.name)
  })

  it('applies the「只在陽剛體型時」setting by the body of the protagonist of the scene', () => {
    const state = game('fem')
    const report = lose(state)
    setMonsterGirl('masc')
    expect(composeNarration(state, report, options()).prompt.user).not.toContain(enemies.goblin!.girl!.name)
    setMonsterGirl('all')
    expect(composeNarration(state, report, options()).prompt.user).toContain(enemies.goblin!.girl!.name)
  })

  it('falls back to the plain description for monsters without a monster girl form', () => {
    const text = monstersText(['skeleton', 'goblin'], true)
    expect(text).toContain(`哥布林 → ${enemies.goblin!.girl!.name}`)
    expect(enemies.skeleton!.girl).toBeUndefined()
    expect(monstersText([], true)).toBe('')
  })
})
