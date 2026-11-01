import { describe, expect, it } from 'vitest'
import { act, castCircle, combatant, startCombat, unusableReason, type Combatant } from '@/engine/combat'
import { maxHpFor } from '@/engine/character'
import { abilities, abilityDef, statusDef } from '@/engine/data'
import { sanitizeAbility } from '@/engine/mods'
import { newGame } from '@/engine/state'
import { addDice, timesDice, upcastAbility, upcastLevels, upcastStatusDice, upcastText } from '@/engine/upcast'
import type { GameState } from '@/engine/types'

function caster(classId = 'wizard', level = 9): { state: GameState; pc: Combatant } {
  const state = newGame({ name: '測試者', race: 'human', classId, seed: 3 })
  const p = state.party[0]!
  p.level = level
  p.maxHp = maxHpFor(level, p.attrs)
  p.hp = p.maxHp
  startCombat(state, [['goblin', 3]])
  const combat = state.combat!
  combat.turn = combat.order.indexOf('pc')
  const pc = combatant(combat, 'pc')
  pc.ap = 30
  pc.slots = [2, 2, 2, 2, 2, 0, 0, 0, 0]
  pc.slotMax = [2, 2, 2, 2, 2, 2, 2, 2, 2]
  for (const e of combat.combatants) if (e.side === 'enemy') e.hp = e.maxHp = 5000
  return { state, pc }
}

describe('升環（upcast.ts）', () => {
  it('合併骰子：面數相同時加骰數，固定值保留', () => {
    expect(timesDice('1d6', 3)).toBe('3d6')
    expect(timesDice('1d4+1', 2)).toBe('2d4+2')
    expect(addDice('8d6', '2d6')).toBe('10d6')
    expect(addDice('10d6+40', '3d6')).toBe('13d6+40')
    expect(addDice('2d10', '1d6')).toBeNull()
  })

  it('每高一環照 upcast 加：傷害、治療、次數、射線、臨時生命', () => {
    expect(upcastAbility(abilityDef('fireball'), 2).damage![0]!.dice).toBe('10d6')
    // 至聖斬加在第二筆（神聖傷害），武器那一筆不動
    const smite = upcastAbility(abilityDef('divine_smite'), 1).damage!
    expect(smite[0]).toEqual({ weapon: true })
    expect(smite[1]!.dice).toBe('3d8')
    expect(upcastAbility(abilityDef('disintegrate'), 1).damage![0]!.dice).toBe('13d6+40')
    expect(upcastAbility(abilityDef('magic_missile'), 2).count).toBe(5)
    expect(upcastAbility(abilityDef('scorching_ray'), 1).hits).toBe(4)
    expect(upcastAbility(abilityDef('cure_wounds'), 2).heal!.dice).toBe('6d8')
    expect(upcastAbility(abilityDef('heal'), 2).heal!.flat).toBe(90)
    expect(upcastAbility(abilityDef('aid'), 3).shield!.flat).toBe(20)
    expect(upcastStatusDice(abilityDef('moonbeam'), 2)).toBe('2d10')
    // 原本的那一份不會被改到
    expect(abilityDef('fireball').damage![0]!.dice).toBe('8d6')
    // 沒有 upcast 的法術：升環沒有效果
    expect(upcastAbility(abilityDef('hold_person'), 3)).toBe(abilityDef('hold_person'))
    expect(upcastText(abilityDef('fireball'), 2)).toBe('傷害 +2d6')
    expect(upcastText(abilityDef('hold_person'))).toBe('')
  })

  it('有寫 upcast 的都是法術，骰子格式正確，說明寫了升環', () => {
    for (const a of Object.values(abilities)) {
      if (!a.upcast) continue
      expect(a.type, a.id).toBe('spell')
      expect(a.desc, a.id).toContain('升環：')
      for (const d of [a.upcast.dice, a.upcast.heal, a.upcast.status_dice]) if (d) expect(d, a.id).toMatch(/^\d+d\d+$/)
      if (a.upcast.dice) expect(a.damage?.[a.upcast.part ?? 0]?.dice, a.id).toBeTruthy()
      if (a.upcast.heal || a.upcast.heal_flat) expect(a.heal, a.id).toBeTruthy()
      if (a.upcast.status_dice) expect(a.apply?.some((x) => statusDef(x.status).dot || statusDef(x.status).pulse), a.id).toBe(true)
      // 內建的經過編輯器的整理不會變
      expect(sanitizeAbility(a.id, a, false).upcast, a.id).toEqual(a.upcast)
    }
  })

  it('指定環數施放：扣那一環，傷害照升環算；那一環沒了就不能用', () => {
    const { state, pc } = caster()
    pc.abilities.push('fireball', 'magic_missile')
    expect(castCircle(pc, abilityDef('fireball'))).toBe(3)
    expect(castCircle(pc, abilityDef('fireball'), 5)).toBe(5)
    // 比法術本身低或一樣：照舊用最低可用的
    expect(castCircle(pc, abilityDef('fireball'), 2)).toBe(3)
    act(state, { type: 'ability', ability: 'fireball', circle: 5 })
    expect(pc.slots).toEqual([2, 2, 2, 2, 1, 0, 0, 0, 0])
    const line = state.combat!.timeline.find((t) => t.actor === 'pc' && t.action.startsWith('火球術'))!
    expect(line.action).toBe('火球術（5 環・升環）')
    expect(line.roll?.save).toBe(true)
    expect(unusableReason(state.combat!, pc, 'fireball', 6)).toBe('沒有 6 環的法術環')
    expect(() => act(state, { type: 'ability', ability: 'fireball', circle: 6 })).toThrow('沒有 6 環的法術環')
  })

  it('魔法飛彈升 2 環射出 5 枚', () => {
    const { state, pc } = caster()
    pc.abilities.push('magic_missile')
    const before = state.combat!.timeline.length
    act(state, { type: 'ability', ability: 'magic_missile', circle: 3 })
    const lines = state.combat!.timeline.slice(before).filter((t) => t.actor === 'pc' && t.action.startsWith('魔法飛彈'))
    expect(lines).toHaveLength(5)
    expect(pc.slots[2]).toBe(1)
  })

  it('低環用完時自動用高環，也算升環', () => {
    const { state, pc } = caster()
    pc.abilities.push('scorching_ray')
    pc.slots = [0, 0, 0, 1, 0, 0, 0, 0, 0]
    const target = state.combat!.combatants.find((c) => c.side === 'enemy')!.id
    const before = state.combat!.timeline.length
    act(state, { type: 'ability', ability: 'scorching_ray', target })
    const lines = state.combat!.timeline.slice(before).filter((t) => t.actor === 'pc' && t.action.startsWith('灼熱射線'))
    expect(lines).toHaveLength(5)
    expect(lines[0]!.action).toBe('灼熱射線（4 環・升環）')
  })

  it('持續傷害的狀態記著升環多的骰子', () => {
    const { state, pc } = caster('druid')
    pc.abilities.push('moonbeam')
    const target = state.combat!.combatants.find((c) => c.side === 'enemy')!
    act(state, { type: 'ability', ability: 'moonbeam', target: target.id, circle: 4 })
    expect(target.statuses.find((s) => s.id === 'moonbeam')?.dice).toBe('2d10')
    expect(upcastLevels(abilityDef('moonbeam'), 4)).toBe(2)
  })

  it('自訂法術的 upcast 經過整理：不合理的欄位拿掉，技能不能有', () => {
    const spell = sanitizeAbility('x', {
      name: '測試', type: 'spell', circle: 1, target: 'enemy', resolve: 'save', classes: ['wizard'],
      damage: [{ dice: '2d6', type: 'fire' }], upcast: { dice: '1d6', heal: '1d8', count: 2, part: 3 }, desc: '',
    }, true)
    expect(spell.upcast).toEqual({ dice: '1d6' })
    const skill = sanitizeAbility('y', { name: '測試', type: 'skill', target: 'enemy', resolve: 'attack', classes: [], damage: [{ dice: '1d6' }], upcast: { dice: '1d6' }, desc: '' }, true)
    expect(skill.upcast).toBeUndefined()
  })
})
