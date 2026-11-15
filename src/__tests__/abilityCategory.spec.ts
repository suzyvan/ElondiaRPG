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
