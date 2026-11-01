import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { prepareAction, resolveAction, type Judgment } from '@/engine/actions'
import { craftRules, itemDef, itemRules } from '@/engine/data'
import { enterLocation } from '@/engine/grid'
import { capsText, diceAvg, diceForAvg, forgetInvention, inventedIn, renameInvention, inventCaps, inventPlan, inventTarget, sanitizeDesign, type InventRequest } from '@/engine/invention'
import { recipeItems, recipePlan } from '@/engine/recipes'
import { buildActionPrompt } from '@/narrator/judge'
import { addItem, migrate, newGame } from '@/engine/state'
import { locationMult } from '@/engine/trade'
import type { GameState, Report } from '@/engine/types'

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
const valid = (r: Report) => expect(validate(r), JSON.stringify(validate.errors)).toBe(true)

function game(): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: 'soriel' })
  enterLocation(state)
  state.money_cc = 100000
  state.inventory = []
  return state
}
const pc = (state: GameState) => state.party[0]!
const qty = (state: GameState, name: string) => state.inventory.find((i) => i.name === name)?.qty ?? 0
const potion: InventRequest = { craft: 'alchemy', level: 1, category: 'consumable', inputs: [{ name: '藥草', qty: 2 }] }

describe('invention caps', () => {
  it('follow the built-in recipes of the same craft one level up', () => {
    const caps = inventCaps('alchemy', 1, 'consumable')!
    expect(caps.top).toBe(2)
    expect(caps.heal).toEqual({ avg: 7, dice: '2d4+2' })
    expect(caps.slot).toBe(1)
    expect(caps.cleanse).toEqual(['poisoned'])
    expect(caps.statuses).toEqual({ potion_poison_ward: 5 })
    expect(caps.damage?.avg).toBe(7)
    expect(Object.keys(caps.applies).sort()).toEqual(['burning', 'chilled'])
    expect(caps.areaAll).toBe(false)
    expect(caps.revive).toBeUndefined()
    // 價格照同級（含以下）最貴的現成配方
    expect(caps.price).toBe(itemDef('微弱治療藥劑')!.price_cc)
    // 第 4 級可以參考到第 5 級：復甦
    expect(inventCaps('alchemy', 4, 'consumable')!.revive).toBe(0.3)
    expect(inventCaps('alchemy', 5, 'consumable')!.top).toBe(6)
    expect(inventCaps('alchemy', craftRules.max_level, 'consumable')!.top).toBe(craftRules.max_level)
    expect(capsText(caps).join('\n')).toContain('2d4+2')
  })

  it('depend on the roll: stronger on a critical, same level on a success, weaker on a partial', () => {
    const crit = inventCaps('alchemy', 3, 'consumable', 'critical')!
    const ok = inventCaps('alchemy', 3, 'consumable', 'success')!
    const weak = inventCaps('alchemy', 3, 'consumable', 'partial')!
    expect([crit.top, ok.top, weak.top]).toEqual([4, 3, 3])
    expect(crit.heal!.avg).toBeGreaterThanOrEqual(ok.heal!.avg)
    expect(weak.heal!.avg).toBeLessThan(ok.heal!.avg)
    expect(weak.heal!.avg).toBeGreaterThanOrEqual(ok.heal!.avg * 0.6)
    expect(crit.ap).toBe(2)
    expect(ok.ap).toBeUndefined()
    expect(weak.statuses.potion_fire_ward).toBeLessThan(ok.statuses.potion_fire_ward!)
    expect(weak.saveDc).toBe(ok.saveDc! - 2)
    // 料理：成功到同級最好的，部分成功再降一階
    expect(inventCaps('cooking', 2, 'food', 'success')!.conditions.at(-1)).toBe('fed_well')
    expect(inventCaps('cooking', 2, 'food', 'partial')!.conditions.at(-1)).toBe('fed_light')
    expect(diceForAvg(14)).toBe('6d4')
    expect(diceForAvg(5.25)).toBe('2d4')
  })

  it('lets cooking reach one meal rank higher and furniture use every craft', () => {
    expect(inventCaps('cooking', 1, 'food')!.conditions.at(-1)).toBe('fed_well')
    expect(inventCaps('cooking', 4, 'food')!.conditions.at(-1)).toBe('fed_legend')
    const furn = inventCaps('leatherwork', 1, 'furniture')!
    expect(furn.comfort).toBe(2)
    expect(furn.bed).toBe(true)
    expect(inventCaps('alchemy', 1, 'furniture')).toBeUndefined()
    expect(inventCaps('cooking', 1, 'consumable')).toBeUndefined()
  })
})

describe('AI designs', () => {
  it('are clamped into the caps', () => {
    const caps = inventCaps('alchemy', 1, 'consumable')!
    const d = sanitizeDesign({
      name: '龍血|萬能藥*', desc: '喝了就好', qty: 9,
      use: { heal: '10d10', slot: 3, cleanse: ['poisoned', 'burning'], status: { id: 'potion_fire_ward', turns: 9 } },
    }, caps)!
    expect(d.name).toBe('龍血萬能藥')
    expect(d.qty).toBe(1)
    // 回復降到上限，法術環降到 1，效果最多兩種（解除排在後面被拿掉），不能用的狀態拿掉
    expect(d.use).toEqual({ heal: '2d4+2', slot: 1 })
    const bomb = sanitizeDesign({ name: '雷鳴瓶', use: { damage: { dice: '8d6', type: 'thunder' }, apply: { status: 'chilled', turns: 5, save: 'dex', dc: 20 }, area: 'all' } }, caps)!
    expect(bomb.use).toEqual({ damage: { dice: '2d6', type: 'thunder' }, apply: { status: 'chilled', turns: 2, save: 'dex', dc: 12 }, area: 'one', combat_only: true })
    expect(sanitizeDesign({ name: '白開水', use: {} }, caps)).toBeUndefined()
    expect(diceAvg('3d6+1')).toBe(11.5)
  })

  it('pick the best allowed meal and clamp furniture comfort', () => {
    expect(sanitizeDesign({ name: '神仙湯', qty: 9, use: { condition: 'fed_legend' } }, inventCaps('cooking', 2, 'food')!)).toEqual({ name: '神仙湯', qty: 3, use: { condition: 'fed_fine' } })
    const chair = sanitizeDesign({ name: '搖椅', furniture: { comfort: 9, places: ['indoor', 'roof'], icon: '🪑🪑🪑' } }, inventCaps('woodworking', 1, 'furniture')!)
    expect(chair).toEqual({ name: '搖椅', qty: 1, furniture: { places: ['indoor'], comfort: 2, icon: '🪑🪑' } })
  })
})

describe('inventing', () => {
  it('charges the missing material value and needs the right level and tools', () => {
    const state = game()
    expect(inventPlan(state, potion, pc(state)).blocked).toContain('低階')
    addItem(state.inventory, '煉金工具組', 1)
    expect(inventPlan(state, potion, pc(state)).blocked).toContain('藥草不夠')
    addItem(state.inventory, '藥草', 2)
    const plan = inventPlan(state, potion, pc(state))
    expect(plan.blocked).toBeUndefined()
    expect(plan.inputValue).toBe(24)
    expect(plan.cost).toBe(Math.round((340 * itemRules.sell_ratio - 24) * locationMult(state)))
    expect(plan.dc).toBe(craftRules.recipe.dc[0]! + craftRules.invention.dc_bonus)
    expect(inventPlan(state, { ...potion, level: 2 }, pc(state)).blocked).toContain('Lv.1')
    expect(inventPlan(state, { ...potion, category: 'food' }, pc(state)).blocked).toContain('不能做料理')
  })

  it('copies a same-level recipe without AI and saves it as a new recipe in this save only', () => {
    const state = game()
    addItem(state.inventory, '煉金工具組', 1)
    addItem(state.inventory, '藥草', 2)
    prepareAction(state, { kind: 'invent', target: inventTarget('pc', potion), text: '' })
    state.pendingAction!.natural = 20
    const r = resolveAction(state, null)
    valid(r)
    const name = Object.keys(state.inventions!)[0]!
    expect(name.startsWith('特製')).toBe(true)
    expect(qty(state, name)).toBe(2)
    expect(qty(state, '藥草')).toBe(0)
    expect(itemDef(name)?.recipe).toMatchObject({ craft: 'alchemy', level: 1, inputs: [{ name: '藥草', qty: 2 }] })
    expect(recipeItems('alchemy').find((x) => x.name === name)?.invented).toBe(true)
    // 之後照配方再做：材料價值不夠的部分是花費，不能拿來賺錢
    addItem(state.inventory, '藥草', 2)
    const again = recipePlan(state, name, 1, pc(state))
    expect(again.blocked).toBeUndefined()
    expect(24 + (itemDef(name)!.recipe!.cost_cc ?? 0)).toBeGreaterThanOrEqual(itemDef(name)!.price_cc * itemRules.sell_ratio)
    expect(r.changes.craft_xp?.[0]).toMatchObject({ craft: 'alchemy', amount: 3 })

    // 讀回這個存檔還在；開新遊戲就沒有了
    const saved = JSON.parse(JSON.stringify(state)) as GameState
    game()
    expect(itemDef(name)).toBeUndefined()
    migrate(saved)
    expect(itemDef(name)?.use).toBeDefined()
    forgetInvention(saved, name)
    expect(recipeItems().some((x) => x.name === name)).toBe(false)
    expect(itemDef(name)).toBeDefined()
  })

  it('uses the AI design, clamped, and adds supplies for every portion', () => {
    const state = game()
    addItem(state.inventory, '炊具組', 1)
    addItem(state.inventory, '野莓', 1)
    const req: InventRequest = { craft: 'cooking', level: 1, category: 'food', inputs: [{ name: '野莓', qty: 1 }] }
    prepareAction(state, { kind: 'invent', target: inventTarget('pc', req), text: '烤一盤莓果塔' })
    const money = state.money_cc
    const judgment: Judgment = {
      attr: 'dex', dc: state.pendingAction!.base_dc, degree: 'success', effects: [], relationship_updates: [],
      invention: { name: '野莓塔', desc: '酥脆的塔皮', qty: 3, use: { condition: 'fed_feast' } },
    }
    const r = resolveAction(state, judgment)
    valid(r)
    const def = itemDef('野莓塔')!
    // 成功：和同級的現成配方相當（烹飪 Lv.1 最好是果腹）
    expect(def.use).toEqual({ condition: 'fed_light' })
    expect(def.recipe?.qty).toBe(3)
    expect(qty(state, '野莓塔')).toBe(3)
    // 三份的價值要由材料加花費撐起來
    const gap = Math.ceil(def.price_cc * itemRules.sell_ratio * 3) - itemDef('野莓')!.price_cc
    expect(gap).toBeGreaterThan(0)
    expect(def.recipe?.cost_cc).toBe(gap)
    expect(state.money_cc).toBe(money - Math.round(gap * locationMult(state)))
  })

  it('loses materials on a failure and records nothing', () => {
    const state = game()
    addItem(state.inventory, '煉金工具組', 1)
    addItem(state.inventory, '藥草', 4)
    pc(state).attrs.int = 6
    prepareAction(state, { kind: 'invent', target: inventTarget('pc', { ...potion, inputs: [{ name: '藥草', qty: 4 }] }), text: '' })
    state.pendingAction!.natural = 2
    const r = resolveAction(state, null)
    valid(r)
    expect(['fail', 'fumble']).toContain(r.check?.degree)
    expect(state.inventions ?? {}).toEqual({})
    expect(qty(state, '藥草')).toBeLessThan(4)
  })

  it('tells the AI the design format and the caps', () => {
    const state = game()
    addItem(state.inventory, '煉金工具組', 1)
    addItem(state.inventory, '藥草', 2)
    const p = prepareAction(state, { kind: 'invent', target: inventTarget('pc', potion), text: '一瓶回魔又解毒的藥' })
    const prompt = buildActionPrompt(state, p, '')
    const all = `${prompt.system}\n${prompt.user}`
    expect(all).toContain('<invention>')
    expect(all).toContain('"invention"')
    expect(all).toContain('2d4+2')
    expect(all).toContain('potion_poison_ward')
  })

  it('copies a recipe one level up on a critical and weakens the copy on a partial', () => {
    const run = (natural: number, int: number) => {
      const state = game()
      addItem(state.inventory, '煉金工具組', 1)
      addItem(state.inventory, '藥草', 2)
      pc(state).attrs.int = int
      prepareAction(state, { kind: 'invent', target: inventTarget('pc', potion), text: '' })
      state.pendingAction!.natural = natural
      const r = resolveAction(state, null)
      return { degree: r.check!.degree, def: Object.values(state.inventions ?? {})[0] }
    }
    const crit = run(20, 10)
    expect(crit.degree).toBe('critical')
    const ref = itemDef(crit.def!.name.replace('特製', ''))!
    expect(ref.recipe!.level).toBe(2)
    // 部分成功：DC 12 差一點（總值 10）
    const weak = run(7, 10)
    expect(weak.degree).toBe('partial')
    const caps = inventCaps('alchemy', 1, 'consumable', 'partial')!
    const u = weak.def!.use!
    if (u.heal) expect(diceAvg(u.heal)).toBeLessThanOrEqual(caps.heal!.avg)
    if (u.damage) expect(diceAvg(u.damage.dice)).toBeLessThanOrEqual(caps.damage!.avg)
    if (u.apply) expect(u.apply.turns).toBeLessThanOrEqual(caps.applies[u.apply.status]!)
  })

  it('lets the player rename an invention after it is made', () => {
    const state = game()
    addItem(state.inventory, '炊具組', 1)
    addItem(state.inventory, '野莓', 2)
    const req: InventRequest = { craft: 'cooking', level: 1, category: 'food', inputs: [{ name: '野莓', qty: 1 }] }
    prepareAction(state, { kind: 'invent', target: inventTarget('pc', req), text: '把野莓壓成泥，包進麵皮烤到焦脆' })
    const r = resolveAction(state, { attr: 'dex', dc: state.pendingAction!.base_dc, degree: 'success', effects: [], relationship_updates: [], invention: { name: '莓果焦餅', qty: 1, use: { condition: 'fed_light' } } })
    expect(inventedIn(state, r)).toBe('莓果焦餅')
    // 用這個做別的自創配方
    state.inventions!['莓果焦餅禮盒'] = { ...state.inventions!['莓果焦餅']!, name: '莓果焦餅禮盒', recipe: { craft: 'cooking', level: 1, inputs: [{ name: '莓果焦餅', qty: 2 }] } }
    expect(() => renameInvention(state, '莓果焦餅', '乾糧')).toThrow('已經有')
    expect(() => renameInvention(state, '莓果焦餅', '  ')).toThrow('空的')
    expect(renameInvention(state, '莓果焦餅', '外婆的莓果餅|*')).toBe('外婆的莓果餅')
    expect(itemDef('莓果焦餅')).toBeUndefined()
    expect(itemDef('外婆的莓果餅')?.use).toEqual({ condition: 'fed_light' })
    expect(qty(state, '外婆的莓果餅')).toBe(1)
    expect(state.inventions!['莓果焦餅禮盒']!.recipe!.inputs[0]!.name).toBe('外婆的莓果餅')
    expect(recipeItems().some((x) => x.name === '外婆的莓果餅')).toBe(true)
    // 日誌上的按鈕：改過名之後就不再出現
    expect(inventedIn(state, r)).toBeUndefined()
    expect(() => renameInvention(state, '乾糧', '新乾糧')).toThrow('不是自創')
  })
})
