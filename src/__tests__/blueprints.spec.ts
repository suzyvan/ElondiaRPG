import { describe, expect, it } from 'vitest'
import { blueprintPrice, blueprintRules, grantBlueprint, hasBlueprint, randomBlueprint } from '@/engine/blueprints'
import { craftPlan } from '@/engine/craft'
import { gearRules } from '@/engine/gear'
import { enterLocation, standOn } from '@/engine/grid'
import { Rng } from '@/engine/rng'
import { addItem, newGame } from '@/engine/state'
import { buyDeal, shopState } from '@/engine/trade'

function game() {
  const s = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
  enterLocation(s)
  delete s.party[0]!.crafts
  s.money_cc = 50000
  return s
}

describe('圖紙（R21 K6）', () => {
  it('prices a blueprint at 1.5 × the base, at least 50', () => {
    expect(blueprintPrice('longsword')).toBe(360)
    expect(blueprintPrice('dagger')).toBe(90)
    expect(blueprintPrice('boots')).toBe(60)
    expect(blueprintPrice('wraps')).toBe(50)
  })

  it('adds 5 to the DC of making it yourself without one, not of a commission', () => {
    const s = game()
    addItem(s.inventory, '隨身鍛造工具', 1)
    addItem(s.inventory, '鐵礦石', 3)
    const pc = s.party[0]!
    const without = craftPlan(s, 'longsword', 'iron', [], pc)
    expect(without.blueprint).toBe(false)
    expect(without.dc).toBe(gearRules.craft.dc[0]! + blueprintRules().dc_without)
    expect(grantBlueprint(s, 'longsword')).toBe(true)
    expect(grantBlueprint(s, 'longsword')).toBe(false)
    const withIt = craftPlan(s, 'longsword', 'iron', [], pc)
    expect(withIt.blueprint).toBe(true)
    expect(withIt.dc).toBe(gearRules.craft.dc[0]!)
    standOn(s, 'smithy')
    expect(craftPlan(s, 'dagger', 'iron').dc).toBe(gearRules.craft.dc[0]!)
  })

  it('is sold by the shop that crafts the base, one by one, and never again once owned', () => {
    const s = game()
    standOn(s, 'smithy')
    const deals = shopState(s, 'smithy').deals.filter((d) => d.id.startsWith('blueprint:'))
    expect(deals.length).toBeGreaterThanOrEqual(blueprintRules().shop[0])
    expect(deals.length).toBeLessThanOrEqual(blueprintRules().shop[1])
    for (const d of deals) expect(['metal', 'wood']).toContain(gearRules.bases[d.id.slice(10)]!.kind)
    const d = deals[0]!
    const base = d.id.slice(10)
    const money = s.money_cc
    buyDeal(s, 'smithy', d.id)
    expect(hasBlueprint(s, base)).toBe(true)
    expect(s.money_cc).toBeLessThan(money)
    // 已經有的不會再抽到
    const rng = new Rng(1)
    for (let i = 0; i < 50; i++) expect(randomBlueprint(s, rng)).not.toBe(base)
  })

  it('takes a blueprint off today’s shelf once you get it somewhere else', () => {
    const s = game()
    standOn(s, 'smithy')
    const d = shopState(s, 'smithy').deals.find((x) => x.id.startsWith('blueprint:'))!
    const base = d.id.slice(10)
    // 敵人身上搜到、別間店買到、任務給的
    grantBlueprint(s, base)
    expect(shopState(s, 'smithy').deals.find((x) => x.id === d.id)!.stock).toBe(0)
    expect(() => buyDeal(s, 'smithy', d.id)).toThrow('已經沒有了')
  })
})
