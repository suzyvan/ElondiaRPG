import { describe, expect, it } from 'vitest'
import { enemies, itemDef, itemRules, stories } from '@/engine/data'
import { gearRules, gearSummary, sanitizeGearSpec } from '@/engine/gear'
import { enterLocation } from '@/engine/grid'
import { equipItem } from '@/engine/inventory'
import { sanitizeItem } from '@/engine/mods'
import { checkModifiers } from '@/engine/perks'
import { addItem, newGame } from '@/engine/state'
import { applyAiDeals, sellPrice, shopKey, shopState } from '@/engine/trade'
import { defenseMult, startCombat } from '@/engine/combat'

// 內建的獨特物品（寶箱、黑市）；任務的獨特裝備另外測（不進寶箱、不上黑市）
const uniques = () => itemRules.items.filter((i) => i.gear?.unique && i.black_market)
// 成人向的獨特色情裝備（寄生物、打工任務線）另外算，不在這裡的等級區間裡
// 高等地下城的層主掉的傳說獨特裝備另外算（dungeonGear）
const dropped = () => new Set(Object.values(enemies).flatMap((e) => (e.loot ?? []).map((l) => l.item)))
const questGear = () => itemRules.items.filter((i) => i.gear?.unique && !i.black_market && !i.adult && !dropped().has(i.name))
const dungeonGear = () => itemRules.items.filter((i) => i.gear?.unique && dropped().has(i.name))

/** 特殊任務給的物品名稱（完成獎勵與每個結果的效果） */
function storyItems(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (name: string, sid: string) => out.set(name, [...(out.get(name) ?? []), sid])
  for (const s of stories) {
    for (const e of s.rewards ?? []) if (e.type === 'item') add(e.name, s.id)
    for (const n of s.nodes) {
      for (const o of [n.success, n.fail, ...(n.options ?? []).flatMap((x) => [x.success, x.fail])]) {
        for (const e of o?.effects ?? []) if (e.type === 'item') add(e.name, s.id)
      }
    }
  }
  return out
}

describe('unique gear', () => {
  it('has a dozen unique items, all low to mid level, each with one check bonus', () => {
    expect(uniques().length).toBeGreaterThanOrEqual(12)
    for (const i of uniques()) {
      expect(gearRules.materials[i.gear!.material]!.tier, i.name).toBeLessThanOrEqual(3)
      expect(i.gear!.unique!.bonus).toBeGreaterThanOrEqual(1)
      expect(gearSummary(i.gear!), i.name).toContain('獨特：')
    }
  })

  it('cannot be bought: no shop lists them and AI deals cannot sell them', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'rogue', seed: 2 })
    enterLocation(state)
    const names = new Set(uniques().map((i) => i.name))
    for (const type of ['general', 'smithy', 'tailor', 'jeweler', 'magic', 'tavern'] as const) {
      expect(shopState(state, type).deals.some((d) => names.has(d.title)), type).toBe(false)
    }
    const added = applyAiDeals(state, 'general', { deals: [{ title: '好東西', gives: [{ type: 'money', amount: 999 }], gets: [{ type: 'item', name: '盜賊公會的舊手套' }], stock: 1 }] })
    expect(added).toBe(0)
  })

  it('only comes from chests or special events, never from crafting or AI gear', () => {
    const inChests = new Set(Object.values(gearRules.chests).flatMap((c) => (c.items ?? []).map(([n]) => n)))
    for (const i of uniques()) expect(inChests.has(i.name), i.name).toBe(true)
    // AI 給的裝備（打造、事件、商店特製）整理之後沒有獨特加值
    const spec = sanitizeGearSpec({ base: 'bracers', material: 'leather', unique: { check: { contexts: ['lock'] }, bonus: 3 } }, { maxLevel: 20 })!
    expect(spec.unique).toBeUndefined()
  })

  it('adds its check bonus, and several stack with each other and with perks', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'rogue', seed: 2, perks: ['light_fingers'] })
    addItem(state.inventory, '盜賊公會的舊手套', 1)
    equipItem(state, '盜賊公會的舊手套', 'pc')
    const pc = state.party[0]!
    const mods = checkModifiers(pc, { context: 'lock', attr: 'dex' })
    expect(mods).toContainEqual({ label: '獨特裝備【盜賊公會的舊手套】', value: 2 })
    expect(mods).toContainEqual({ label: '特質【妙手空空】', value: 2 })
    // 兩件都對城門盤查有效：疊加
    addItem(state.inventory, '走私客的腳鍊', 1)
    equipItem(state, '走私客的腳鍊', 'pc')
    pc.gear!.piercing_1 = { name: '測試耳環', spec: { base: 'earring_hawk', material: 'copper', unique: { check: { contexts: ['gate'] }, bonus: 1 } } }
    const gate = checkModifiers(pc, { context: 'gate', attr: 'cha' }).filter((m) => m.label.startsWith('獨特裝備'))
    expect(gate.reduce((s, m) => s + m.value, 0)).toBe(3)
    // 不適用的檢定沒有加值
    expect(checkModifiers(pc, { context: 'travel', attr: 'str' }).some((m) => m.label.startsWith('獨特裝備'))).toBe(false)
  })

  it('can be authored in the content editor, held to one check of +1 to +3', () => {
    const out = sanitizeItem('自訂獨特', { category: 'equipment', price_cc: 10, tags: [], gear: { base: 'boots', material: 'leather', unique: { check: { contexts: ['stealth', 'nope' as never] }, bonus: 9 } } }, true)
    expect(out.gear!.unique).toEqual({ check: { contexts: ['stealth'] }, bonus: 3 })
    expect(itemDef('夜行者的軟靴')!.gear!.unique).toEqual({ check: { contexts: ['stealth'] }, bonus: 2 })
  })

  it('quest gear: every piece is handed out by a special quest, stronger in later level bands', () => {
    const given = storyItems()
    const gear = questGear()
    expect(gear.length).toBe(149)
    for (const i of gear) {
      expect(given.get(i.name)?.length, i.name).toBe(1)
      const sid = given.get(i.name)![0]!
      const s = stories.find((x) => x.id === sid)!
      const level = s.start.min_level ?? 1
      const tier = gearRules.materials[i.gear!.material]!.tier
      // 材料的等級不超過任務的等級太多：Lv.5 第二級、Lv.8～11 第三級、Lv.12～15 第四級、Lv.16 以上第五級
      expect(tier, `${i.name} @ ${sid}`).toBe(level >= 16 ? 5 : level >= 12 ? 4 : level >= 8 ? 3 : 2)
      expect(gearSummary(i.gear!), i.name).toContain('獨特：')
      expect(s.tags ?? [], sid).not.toContain('adult')
    }
  })

  it('quest gear: each Lv.5 and Lv.8-11 band gives every combat class a weapon, armor and accessory', () => {
    const given = storyItems()
    const levelOf = (name: string) => stories.find((x) => x.id === given.get(name)![0])!.start.min_level ?? 1
    const classes = ['fighter', 'barbarian', 'paladin', 'ranger', 'rogue', 'monk', 'bard', 'cleric', 'druid', 'wizard'] as const
    for (const band of [[5, 5], [8, 11]]) {
      const pieces = questGear().filter((i) => { const lv = levelOf(i.name); return lv >= band[0]! && lv <= band[1]! })
      const slot = (i: (typeof pieces)[number]) => gearRules.bases[i.gear!.base]!.slot
      for (const c of classes) {
        const cls = gearRules.classes[c] as { main: string[]; body: string[] }
        const weapon = c === 'monk' ? pieces.some((i) => i.gear!.base === 'wraps') : pieces.some((i) => cls.main.includes(i.gear!.base))
        expect(weapon, `${c} weapon Lv.${band[0]}`).toBe(true)
        expect(pieces.some((i) => cls.body.includes(i.gear!.base)), `${c} armor Lv.${band[0]}`).toBe(true)
      }
      expect(pieces.filter((i) => !['main_hand', 'body', 'wrists'].includes(slot(i))).length).toBe(10)
    }
  })

  it('cannot be sold to shops', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 2 })
    enterLocation(state)
    addItem(state.inventory, '半重', 1)
    addItem(state.inventory, '鐵長劍', 1)
    expect(sellPrice(state, shopKey(state, 'smithy'), '半重')).toBeNull()
    expect(sellPrice(state, shopKey(state, 'smithy'), '鐵長劍')).toBeGreaterThan(0)
  })

  it('multiplies resistances instead of adding them, so two rings never make you immune', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 2 })
    enterLocation(state)
    const id = state.party[0]!.id
    for (const [name, slot] of [['月光之言', 'ring_1'], ['萬代之憶', 'ring_2']] as const) {
      addItem(state.inventory, name, 1)
      equipItem(state, name, id, slot)
    }
    const combat = startCombat(state, [['storm_giant', 1]])
    const pc = combat.combatants.find((c) => c.side === 'party')!
    // 兩枚全部抗性 75%：0.25 × 0.25，而不是 1 - 1.5 = 免疫
    expect(defenseMult(pc, 'lightning')).toBeCloseTo(0.0625)
    expect(defenseMult(pc, 'lightning')).toBeGreaterThan(0)
  })

  it('quest gear: the Lv.12-15 and Lv.16-18 bands also cover every class', () => {
    const given = storyItems()
    const levelOf = (name: string) => stories.find((x) => x.id === given.get(name)![0])!.start.min_level ?? 1
    const classes = ['fighter', 'barbarian', 'paladin', 'ranger', 'rogue', 'monk', 'bard', 'cleric', 'druid', 'wizard'] as const
    for (const band of [[12, 15], [16, 18]]) {
      const pieces = questGear().filter((i) => { const lv = levelOf(i.name); return lv >= band[0]! && lv <= band[1]! })
      for (const c of classes) {
        const cls = gearRules.classes[c] as { main: string[]; body: string[] }
        const weapon = c === 'monk' ? pieces.some((i) => ['wraps', 'vambraces'].includes(i.gear!.base)) : pieces.some((i) => cls.main.includes(i.gear!.base))
        expect(weapon, `${c} weapon Lv.${band[0]}`).toBe(true)
        expect(pieces.some((i) => cls.body.includes(i.gear!.base)), `${c} armor Lv.${band[0]}`).toBe(true)
      }
    }
  })

  it('dungeon gear: the high dungeon bosses fill the slots that had no legendary unique', () => {
    const gear = dungeonGear()
    const slots = new Set(gear.map((i) => gearRules.bases[i.gear!.base]!.slot))
    for (const s of ['off_hand', 'head', 'legs', 'feet', 'belt', 'wrists', 'leg_accessory']) expect(slots.has(s as never), s).toBe(true)
    // 非成人向的地下城補齊沒有的五個欄位（成人內容關閉也拿得到）
    const plain = new Set(gear.filter((i) => !i.adult).map((i) => gearRules.bases[i.gear!.base]!.slot))
    for (const s of ['off_hand', 'head', 'legs', 'feet', 'belt']) expect(plain.has(s as never), s).toBe(true)
    for (const i of gear) {
      expect(i.gear!.rarity, i.name).toBe('legendary')
      expect(gearRules.materials[i.gear!.material]!.tier, i.name).toBeGreaterThanOrEqual(6)
      expect(gearSummary(i.gear!), i.name).toContain('獨特：')
      expect(i.black_market, i.name).toBeFalsy()
    }
  })
})
