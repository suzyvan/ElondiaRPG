import { describe, expect, it } from 'vitest'
import { itemDef } from '@/engine/data'
import { baseFits, baseSlotName, gearBonuses, gearRules, generateLoadout, SLOTS } from '@/engine/gear'
import { equipItem } from '@/engine/inventory'
import { Rng } from '@/engine/rng'
import { addItem, newGame } from '@/engine/state'

describe('piercing and leg accessory slots', () => {
  it('has two piercing slots and one leg slot, each with two kinds of bases', () => {
    expect(SLOTS).toEqual(expect.arrayContaining(['piercing_1', 'piercing_2', 'leg_accessory']))
    expect(baseSlotName('piercing')).toBe('穿孔飾品')
    expect(baseSlotName('leg_accessory')).toBe('腿部飾品')
    const of = (slot: string) => Object.values(gearRules.bases).filter((b) => b.slot === slot).map((b) => b.name)
    // 穿孔：耳環、臍環；腿部：腳鍊、腿環
    expect(of('piercing').some((n) => n.includes('耳'))).toBe(true)
    expect(of('piercing').some((n) => n.includes('臍'))).toBe(true)
    expect(of('leg_accessory').some((n) => n.includes('腳鍊'))).toBe(true)
    expect(of('leg_accessory').some((n) => n.includes('腿環'))).toBe(true)
    expect(baseFits('piercing', 'piercing_2')).toBe(true)
    expect(baseFits('piercing', 'ring_1')).toBe(false)
    // 每種底材都有七個材料等級（第 6、7 級有歷史、歡愉兩套）的制式品，第四級以下在珠寶店賣（地下城專屬的底材沒有制式品）
    for (const [id, b] of Object.entries(gearRules.bases).filter(([, x]) => !x.restraint && !x.outfit && !x.exclusive && (x.slot === 'piercing' || x.slot === 'leg_accessory'))) {
      const items = ['銅製', '銀製', '金製', '秘銀', '星辰石', '時晶', '龍瞳石', '蜜晶', '魅瞳石'].map((m) => itemDef(`${m}${b.name}`))
      expect(items.every((i) => i?.gear?.base === id), b.name).toBe(true)
      expect(items[0]!.tags).toContain('jeweler')
    }
  })

  it('wears two piercings and a leg accessory, and their bonuses add up', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1 })
    for (const n of ['金製鷹眼耳環', '銅製靜心耳墜', '秘銀疾風腳鍊']) addItem(state.inventory, n, 1)
    const before = gearBonuses(state.party[0]!)
    equipItem(state, '金製鷹眼耳環', 'pc')
    equipItem(state, '銅製靜心耳墜', 'pc')
    equipItem(state, '秘銀疾風腳鍊', 'pc')
    const gear = state.party[0]!.gear!
    expect(gear.piercing_1?.name).toBe('金製鷹眼耳環')
    expect(gear.piercing_2?.name).toBe('銅製靜心耳墜')
    expect(gear.leg_accessory?.name).toBe('秘銀疾風腳鍊')
    const after = gearBonuses(state.party[0]!)
    expect((after.mods.hit ?? 0) - (before.mods.hit ?? 0)).toBe(1)
    expect((after.mods.evade ?? 0) - (before.mods.evade ?? 0)).toBe(1)
    expect(after.resist.psychic).toBeLessThan(0)
  })

  it('shows up in NPC loadouts', () => {
    const rng = new Rng(4)
    let piercing = 0
    let leg = 0
    for (let i = 0; i < 200; i++) {
      const g = generateLoadout('rogue', 12, rng)
      if (g.piercing_1 || g.piercing_2) piercing++
      if (g.leg_accessory) leg++
    }
    expect(piercing).toBeGreaterThan(0)
    expect(leg).toBeGreaterThan(0)
  })
})
