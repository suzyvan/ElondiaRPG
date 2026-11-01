import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { prepareAction, resolveAction, sanitizeJudgment, type Judgment } from '@/engine/actions'
import { craftPlan, craftTarget, parseCraftTarget } from '@/engine/craft'
import { itemRules } from '@/engine/data'
import {
  enchantPoints, gearName, gearPrice, gearRules, gearSpecOf, gearStats, generateLoadout, rarityPoints, sanitizeEnchants, startingGear,
} from '@/engine/gear'
import { enterLocation, standOn } from '@/engine/grid'
import { Rng } from '@/engine/rng'
import { applyAiDeals, shopState } from '@/engine/trade'
import { newGame } from '@/engine/state'
import type { GameState, GearSpec } from '@/engine/types'

describe('gear', () => {
  it('lists every base × material of the same kind in the catalog', () => {
    const items = itemRules.items
    const names = new Set(items.filter((i) => i.gear).map((i) => i.name))
    // 束縛用的底材（主人強制裝備）與地下城專屬的底材沒有制式品；服裝只有前三級材料的制式品
    for (const [base, b] of Object.entries(gearRules.bases).filter(([, x]) => !x.restraint && !x.exclusive)) {
      for (const [material, m] of Object.entries(gearRules.materials)) {
        if (m.kind !== b.kind || (b.outfit && m.tier > 3)) continue
        const name = gearName({ base, material })
        expect(names.has(name), name).toBe(true)
        const def = items.find((i) => i.name === name)!
        expect(def.gear).toEqual({ base, material })
        expect(def.price_cc).toBe(gearPrice({ base, material }))
      }
    }
  })

  it('scales stats with the material and keeps chain cheaper than plate', () => {
    const iron = gearStats({ base: 'longsword', material: 'iron' })
    const mithril = gearStats({ base: 'longsword', material: 'mithril' })
    expect(iron.weapon).toBe('longsword')
    expect(mithril.mods.hit ?? 0).toBeGreaterThan(iron.mods.hit ?? 0)
    expect(gearPrice({ base: 'chain', material: 'iron' })).toBeLessThan(gearPrice({ base: 'plate', material: 'iron' }))
    expect(gearName({ base: 'boots', material: 'leather' })).toBe('皮靴')
    expect(gearName({ base: 'boots', material: 'dragonhide' })).toBe('龍皮靴')
    expect(gearName({ base: 'plate', material: 'adamantine' })).toBe('精金板甲')
  })

  it('counts enchant points from the cost table', () => {
    expect(enchantPoints({ mods: { hit: 1, ap_regen: 1 } })).toBe(3)
    expect(enchantPoints({ resist: { fire: -0.25 }, offense: { cold: 0.5 } })).toBe(3)
    expect(enchantPoints({ mods: { threat: -0.2 } })).toBe(2)
  })

  it('starts classes with first-tier gear', () => {
    const g = startingGear('fighter')
    expect(g.main_hand?.name).toBe('鐵長劍')
    for (const e of Object.values(g)) expect(gearRules.materials[e!.spec.material]!.tier).toBe(1)
  })

  it('generates loadouts whose materials never exceed the level', () => {
    for (const level of [1, 3, 7, 12]) {
      for (let seed = 1; seed <= 40; seed++) {
        const out = generateLoadout('fighter', level, new Rng(seed))
        expect(out.main_hand).toBeDefined()
        for (const e of Object.values(out)) expect(gearRules.materials[e!.spec.material]!.level).toBeLessThanOrEqual(level)
        if (out.main_hand && gearRules.bases[out.main_hand.spec.base]!.two_handed) expect(out.off_hand).toBeUndefined()
      }
    }
    // 高等級的冒險者穿得比較多
    const count = (level: number) => {
      let n = 0
      for (let seed = 1; seed <= 60; seed++) n += Object.keys(generateLoadout('rogue', level, new Rng(seed))).length
      return n
    }
    expect(count(10)).toBeGreaterThan(count(1))
  })
})

describe('crafting', () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
  function game(location = 'soriel'): GameState {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 5, birthplace: location })
    enterLocation(state)
    return state
  }
  function craft(state: GameState, target: string, natural: number, judgment: Judgment | null = null) {
    prepareAction(state, { kind: 'craft', target, text: '' })
    state.pendingAction!.natural = natural
    // 這幾個測試看的是材料與成品：拿掉工匠手藝的加值（另外測）
    state.pendingAction!.situational = state.pendingAction!.situational.filter((x) => !x.label.startsWith('工匠的手藝'))
    const r = resolveAction(state, judgment)
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true)
    return r
  }

  it('only works at the matching shop and needs forge materials beyond the first tier', () => {
    const state = game()
    expect(() => prepareAction(state, { kind: 'craft', target: 'longsword:iron', text: '' })).toThrow('鐵匠鋪')
    standOn(state, 'tailor')
    expect(() => prepareAction(state, { kind: 'craft', target: 'longsword:iron', text: '' })).toThrow('要到鐵匠鋪')
    standOn(state, 'smithy')
    expect(() => prepareAction(state, { kind: 'craft', target: 'longsword:leather', text: '' })).toThrow('不能')
    expect(craftPlan(state, 'longsword', 'mithril').blocked).toContain('材料不夠')
    state.money_cc = 5000
    state.inventory.push({ name: '秘銀礦石', qty: 1 }, { name: '精鋼錠', qty: 2 })
    expect(craftPlan(state, 'longsword', 'mithril').blocked).toContain('材料不夠')
    expect(craftPlan(state, 'longsword', 'steel').blocked).toBeUndefined()
    expect(craftPlan(state, 'dagger', 'iron').units).toBe(0)
  })

  it('makes an enchanted piece on success and spends fee and materials', () => {
    const state = game()
    standOn(state, 'smithy')
    state.money_cc = 5000
    state.inventory.push({ name: '精鋼錠', qty: 3 })
    const plan = craftPlan(state, 'longsword', 'steel')
    const r = craft(state, 'longsword:steel', 20)
    expect(r.check?.degree).toBe('critical')
    expect(state.money_cc).toBe(5000 - plan.fee)
    expect(state.inventory.find((i) => i.name === '精鋼錠')?.qty).toBe(1)
    const made = r.changes.items_gained!.find((i) => gearSpecOf(state, i.name))!
    const spec = gearSpecOf(state, made.name)!
    expect(spec).toMatchObject({ base: 'longsword', material: 'steel', rarity: 'uncommon' })
    expect(enchantPoints(spec.enchants)).toBeLessThanOrEqual(rarityPoints('uncommon'))
    expect(state.customItems![made.name]!.category).toBe('equipment')
  })

  it('loses half the materials on failure and uses the AI name and enchants within the cap', () => {
    const state = game()
    standOn(state, 'smithy')
    state.money_cc = 50000
    state.inventory.push({ name: '秘銀礦石', qty: 4 })
    const failed = craft(state, 'longsword:mithril', 8)
    expect(failed.check?.degree).toBe('fail')
    expect(state.inventory.find((i) => i.name === '秘銀礦石')?.qty).toBe(3)
    prepareAction(state, { kind: 'craft', target: 'longsword:mithril', text: '劍身刻著火焰紋路' })
    const j = sanitizeJudgment(state, state.pendingAction!, {
      degree: 'success', effects: [{ type: 'gear', name: '破曉', desc: '劍身有火焰紋路', enchants: { mods: { hit: 2, damage: 3 }, offense: { fire: 0.5 } } }],
    })
    const r = resolveAction(state, j)
    expect(r.changes.items_gained!.map((i) => i.name)).toContain('破曉')
    const spec = gearSpecOf(state, '破曉')!
    expect(spec.material).toBe('mithril')
    expect(spec.rarity).toBeUndefined()
    expect(enchantPoints(spec.enchants)).toBeLessThanOrEqual(2)
  })

  it('takes any material as 輔料: consumed either way, raises quality by chance, steers the element', () => {
    const state = game()
    standOn(state, 'smithy')
    state.money_cc = 50000
    state.inventory.push({ name: '精鋼錠', qty: 2 }, { name: '火蜥鱗片', qty: 3 }, { name: '乾糧', qty: 1 })
    const plan = craftPlan(state, 'longsword', 'steel', [{ name: '火蜥鱗片', qty: 2 }])
    expect(plan.blocked).toBeUndefined()
    expect(plan.auxValue).toBe(72)
    expect(plan.auxChance).toBeCloseTo(72 / 480)
    expect(plan.elements).toContain('fire')
    expect(craftPlan(state, 'longsword', 'steel', [{ name: '乾糧', qty: 1 }]).blocked).toContain('不是材料')
    expect(craftPlan(state, 'longsword', 'steel', [{ name: '火蜥鱗片', qty: 5 }]).blocked).toContain('不夠')
    // 打造材料本身不能再當輔料用掉
    expect(craftPlan(state, 'longsword', 'steel', [{ name: '精鋼錠', qty: 1 }]).blocked).toContain('不夠')
    expect(parseCraftTarget(craftTarget('longsword', 'steel', [{ name: '火蜥鱗片', qty: 2 }]))).toEqual({ base: 'longsword', material: 'steel', aux: [{ name: '火蜥鱗片', qty: 2 }] })

    // 擲中時：部分成功照成功做（附魔），用掉輔料
    const aux = gearRules.craft.aux
    const before = { ...aux }
    Object.assign(aux, { chance_per_value: 1000, max_chance: 1 })
    try {
      const r = craft(state, craftTarget('longsword', 'steel', [{ name: '火蜥鱗片', qty: 1 }]), 8)
      expect(r.check?.degree).toBe('partial')
      const made = r.changes.items_gained!.find((i) => gearSpecOf(state, i.name))!
      const spec = gearSpecOf(state, made.name)!
      expect(spec.rarity).toBe('uncommon')
      expect(spec.enchants).toBeDefined()
      expect(state.inventory.find((i) => i.name === '火蜥鱗片')?.qty).toBe(2)
      expect(r.outcome.summary).toContain('輔料')
    } finally {
      Object.assign(aux, before)
    }
    // 失敗也會用掉輔料
    state.inventory.push({ name: '精鋼錠', qty: 2 })
    craft(state, craftTarget('longsword', 'steel', [{ name: '火蜥鱗片', qty: 1 }]), 2)
    expect(state.inventory.find((i) => i.name === '火蜥鱗片')?.qty).toBe(1)
  })

  it('caps event gear from free actions by level and degree', () => {
    const state = game()
    prepareAction(state, { kind: 'free', text: '翻找遺跡' })
    const j = sanitizeJudgment(state, state.pendingAction!, {
      degree: 'success', effects: [{ type: 'gear', base: 'plate', material: 'adamantine', rarity: 'legendary', enchants: { mods: { dr: 2 } } }],
    })
    const g = j.effects.find((e) => e.type === 'gear') as { spec: GearSpec }
    expect(g.spec.material).toBe('iron')
    expect(g.spec.enchants).toBeUndefined()
    const fail = sanitizeJudgment(state, state.pendingAction!, { degree: 'fail', effects: [{ type: 'gear', base: 'dagger', material: 'iron' }] })
    expect(fail.effects).toHaveLength(0)
  })

  it('trims enchants to the rarity points', () => {
    const e = sanitizeEnchants({ mods: { hit: 9, dr: 1, ap_regen: 1 }, resist: { fire: -1, nonsense: -0.25 } }, 4)
    expect(enchantPoints(e)).toBeLessThanOrEqual(4)
    expect(e?.mods?.hit).toBe(2)
    expect(e?.resist?.nonsense).toBeUndefined()
  })
})

describe('special gear at shops', () => {
  it('prices AI gear from its composition and caps the material by level', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6 })
    enterLocation(state)
    const n = applyAiDeals(state, 'smithy', {
      deals: [{ title: '老兵的佩劍', gives: [{ type: 'money', amount: 1 }], gets: [{ type: 'gear', base: 'longsword', material: 'star_iron', name: '老兵的佩劍', rarity: 'uncommon', enchants: { mods: { hit: 1 } } }], stock: 1 }],
    })
    expect(n).toBe(1)
    const spec = gearSpecOf(state, '老兵的佩劍')!
    expect(gearRules.materials[spec.material]!.level).toBeLessThanOrEqual(3)
    const deal = shopState(state, 'smithy').deals.find((d) => d.title === '老兵的佩劍')!
    expect(deal.gives[0]!.amount).toBeGreaterThanOrEqual(gearPrice(spec) * 0.5)
  })
})
