// 能力的分類（engine/abilityCategory.ts）：依效果自動判斷，category 可以指定
import { describe, expect, it } from 'vitest'
import { abilityCategory, autoAbilityCategory } from '@/engine/abilityCategory'
import { abilities, abilityDef } from '@/engine/data'
import { sanitizeAbility } from '@/engine/mods'

const cat = (id: string) => abilityCategory(abilityDef(id))

describe('ability categories', () => {
  it('sorts the built-in abilities by what they do', () => {
    expect(cat('power_strike')).toBe('attack')
    const list = Object.values(abilities)
    const byName = (n: string) => abilityCategory(list.find((a) => a.name === n)!)
    expect(byName('橫掃')).toBe('area')
    expect(byName('致盲粉塵')).toBe('control')
    expect(byName('治癒之手')).toBe('heal')
    expect(byName('堅守')).toBe('buff')
    expect(byName('寬衣')).toBe('lust')
    // 每一個都有分類
    for (const a of list) expect(['attack', 'area', 'control', 'heal', 'buff', 'lust']).toContain(abilityCategory(a))
  })

  it('lets content pick a category, and the editor keeps it', () => {
    const a = abilityDef('power_strike')
    expect(abilityCategory({ ...a, category: 'buff' })).toBe('buff')
    expect(autoAbilityCategory({ ...a, category: 'buff' })).toBe('attack')
    expect(sanitizeAbility('x', { ...a, category: 'heal' }, true).category).toBe('heal')
    expect(sanitizeAbility('x', { ...a, category: 'nope' as never }, true).category).toBeUndefined()
  })
})

describe('hiding abilities from the combat menu', () => {
  it('keeps a per-character list that only holds abilities the character knows', async () => {
    const { newGame } = await import('@/engine/state')
    const { setAbilityHidden } = await import('@/engine/town')
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 3 })
    const pc = state.party[0]!
    const id = pc.abilities[0]!
    setAbilityHidden(state, pc.id, id, true)
    setAbilityHidden(state, pc.id, 'not_known', true)
    expect(pc.hiddenAbilities).toEqual([id])
    setAbilityHidden(state, pc.id, id, false)
    expect(pc.hiddenAbilities).toBeUndefined()
  })
})

describe('abilities granted by parasites, schools and lactation', () => {
  it('lists them with their source and lets them be hidden from the combat menu', async () => {
    const { newGame } = await import('@/engine/state')
    const { setAbilityHidden } = await import('@/engine/town')
    const { grantedAbilities } = await import('@/engine/grantedAbilities')
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 3 })
    const pc = state.party[0]!
    // 魅魔的契紋到了共生（第三階段以上）給魅惑之吻、傾國一笑
    pc.parasites = [{ id: 'succubus_mark', corruption: 100 } as never]
    const g = grantedAbilities(pc)
    expect(g.map((x) => x.id)).toEqual(expect.arrayContaining(['lust_kiss', 'lust_smile']))
    expect(g.find((x) => x.id === 'lust_kiss')!.from).toBe('魅魔的契紋')
    expect(pc.abilities).not.toContain('lust_kiss')
    setAbilityHidden(state, pc.id, 'lust_kiss', true)
    expect(pc.hiddenAbilities).toEqual(['lust_kiss'])
    setAbilityHidden(state, pc.id, 'lust_kiss', false)
    expect(pc.hiddenAbilities).toBeUndefined()
  })
})

describe('combat item kinds', () => {
  it('sorts items by what they do', async () => {
    const { combatItemKind } = await import('@/engine/combat')
    expect(combatItemKind({ heal: { dice: '2d4' } } as never)).toBe('heal')
    expect(combatItemKind({ damage: { dice: '2d6', type: 'fire' } } as never)).toBe('attack')
    expect(combatItemKind({ escape: true } as never)).toBe('escape')
    expect(combatItemKind({ lust: -10 } as never)).toBe('lust')
    expect(combatItemKind({ cleanse: ['poisoned'] } as never)).toBe('buff')
    // 自己用、狀態跟慾望有關的算慾望（媚香精油、冷靜劑、精力藥）；對敵人的照舊是攻擊
    expect(combatItemKind({ status: { id: 'charm_glow', turns: 3 } } as never)).toBe('lust')
    expect(combatItemKind({ status: { id: 'calm_draught', turns: 20 } } as never)).toBe('lust')
    expect(combatItemKind({ status: { id: 'vigor_draught', turns: 20 } } as never)).toBe('lust')
    expect(combatItemKind({ status: { id: 'potion_might', turns: 3 } } as never)).toBe('buff')
  })
})
