import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CombatView from '@/components/CombatView.vue'
import { combatant, startCombat } from '@/engine/combat'
import { maxHpFor } from '@/engine/character'
import { newGame } from '@/engine/state'
import { useGame } from '@/stores/game'

// 戰鬥畫面的「施放環數」：選了比法術高的環，按法術就用那一環施放，施放後回到自動
describe('戰鬥畫面的升環', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  function setup() {
    const game = useGame()
    const state = newGame({ name: '測試者', race: 'human', classId: 'wizard', seed: 3 })
    const p = state.party[0]!
    p.level = 9
    p.maxHp = maxHpFor(9, p.attrs)
    p.hp = p.maxHp
    p.abilities.push('fireball', 'hold_person')
    p.loadout = undefined
    startCombat(state, [['goblin', 3]])
    const combat = state.combat!
    combat.turn = combat.order.indexOf('pc')
    const pc = combatant(combat, 'pc')
    if (!pc.abilities.includes('fireball')) pc.abilities.push('fireball')
    pc.ap = 30
    pc.slots = [2, 2, 2, 2, 2, 0, 0, 0, 0]
    pc.slotMax = [2, 2, 2, 2, 2, 0, 0, 0, 0]
    for (const e of combat.combatants) if (e.side === 'enemy') e.hp = e.maxHp = 5000
    game.state = state
    return { game, pc }
  }

  it('選 5 環再按火球術：扣 5 環，按鈕寫 3→5 環，施放後回到自動', async () => {
    const { game, pc } = setup()
    const w = mount(CombatView)
    await nextTick()
    const row = w.find('.upcast')
    expect(row.exists()).toBe(true)
    const circles = row.findAll('button').map((b) => b.text())
    expect(circles[0]).toBe('自動')
    // 第 2 環以上；6 環以上沒有法術環，不列
    expect(circles.slice(1).map((t) => t.split(' ')[0])).toEqual(['2', '3', '4', '5'])
    await row.findAll('button').find((b) => b.text().startsWith('5 環'))!.trigger('click')
    const fireball = () => w.findAll('button.ability').find((b) => b.text().includes('火球術'))!
    expect(fireball().text()).toContain('3→5 環')
    expect(fireball().attributes('title')).toContain('升 2 環：傷害 +2d6')
    // 沒有升環效果的法術也照樣寫出來
    const hold = w.findAll('button.ability').find((b) => b.text().includes('定身術'))
    if (hold) expect(hold.attributes('title')).toContain('升 3 環：沒有額外效果')
    await fireball().trigger('click')
    expect(game.error).toBeNull()
    expect(pc.slots).toEqual([2, 2, 2, 2, 1, 0, 0, 0, 0])
    expect(game.state!.combat!.timeline.some((t) => t.action === '火球術（5 環・升環）')).toBe(true)
    await nextTick()
    expect(w.find('.upcast button.on').text()).toBe('自動')
    expect(fireball().text()).toContain('3 環')
    expect(fireball().text()).not.toContain('→')
  })

  it('沒選時照舊用最低可用的環', async () => {
    const { pc } = setup()
    const w = mount(CombatView)
    await nextTick()
    await w.findAll('button.ability').find((b) => b.text().includes('火球術'))!.trigger('click')
    expect(pc.slots).toEqual([2, 2, 1, 2, 2, 0, 0, 0, 0])
  })
})
