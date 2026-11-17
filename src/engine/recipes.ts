// 配方（物品的 recipe；規則在 crafts.json 的 recipe，見 docs/CRAFTING.md 第 6 節）：
// 用工藝依配方做出藥劑、料理、家具、工具。和自己動手打造一樣：做的人擲工藝的屬性檢定加工藝等級，
// 要有對應階級的工具（配方等級決定），成功時得到工藝經驗。走主動行動 produce（target = 「做的人的 id@物品名稱*批數」，
// 當場補買時再接「|!buy」）。

import { craftRules, itemDef, itemRules, locationById, saveItems, type CraftId, type Degree, type ItemDef, type RecipeSpec } from './data'
import { crafterRefusal, craftName, craftXpFor, gainCraftXp, skillOf, toolAccess, toolBlocker, toolTierFor, type ToolAccess } from './crafting'
import { applyEffects, type RewardEffect } from './effects'
import { buyHere, shopOfferHere } from './craft'
import { currentArea } from './grid'
import { gameRule } from './gameRules'
import { memberOrResident } from './homes'
import { formatMoney } from './money'
import { locationMult } from './trade'
import { homeQtyHere, pullFromHome, stockHere } from './storage'
import { workshopMult } from './rooms'
import type { Character, GameState, Report } from './types'

/** 有配方的物品（包含自訂內容） */
export function recipeItems(craft?: CraftId): { name: string; recipe: RecipeSpec; invented?: boolean }[] {
  const list = (items: ItemDef[], invented: boolean) => items.filter((i) => i.recipe && (!craft || i.recipe.craft === craft))
    .map((i) => ({ name: i.name, recipe: i.recipe!, ...(invented ? { invented } : {}) }))
  // 這個存檔自創的配方也算
  return [...list(itemRules.items, false), ...list(saveItems(), true)]
}

export function recipeOf(name: string): RecipeSpec | undefined {
  return itemDef(name)?.recipe
}

export interface RecipePlan {
  name: string
  recipe: RecipeSpec
  batches: number
  /** 成功時做出的份數 */
  qty: number
  /** 要用掉的材料與持有數量；站的這間店有賣時的單價與存貨，當場補買幾份 */
  /** have：持有（行囊加上家裡的箱子）；home：其中家裡的箱子有幾份 */
  inputs: { name: string; need: number; have: number; home?: number; offer?: { price: number; stock: number }; buy: number }[]
  /** 當場補買（買來直接用掉；沒做成時剩下的留在行囊） */
  buys: { name: string; qty: number; price: number }[]
  buyCost: number
  /** 另外要買的東西（乘地點物價） */
  cost: number
  /** 在店裡租工坊的租金 */
  rent: number
  /** 費用合計（不論結果都照付） */
  fee: number
  dc: number
  hours: number
  /** 做的人的工藝等級 */
  level: number
  tool: ToolAccess
  /** 做不了的原因（全部列出，用「；」接起來） */
  blocked?: string
  /** 做不了的原因，一條一條 */
  blockers: string[]
}

/** 依配方做 batches 批：材料、費用、時間都乘批數。buy：不夠的材料向站的這間店當場補買 */
export function recipePlan(state: GameState, name: string, batches: number, crafter: Character, opts: { buy?: boolean } = {}): RecipePlan {
  const recipe = recipeOf(name)
  if (!recipe) throw new Error(`${name}沒有配方`)
  const rules = craftRules.recipe
  const n = Math.max(1, Math.min(rules.max_batches, Math.round(batches) || 1))
  const inputs = recipe.inputs.map((x) => {
    const need = x.qty * n
    // 持有：行囊加上家裡的箱子（站在自己的房子裡時，storage.ts）
    const have = stockHere(state, x.name)
    const home = homeQtyHere(state, x.name)
    const offer = shopOfferHere(state, x.name)
    const buy = opts.buy && offer ? Math.min(Math.max(0, need - have), offer.stock) : 0
    return { name: x.name, need, have, ...(home ? { home } : {}), ...(offer ? { offer: { price: offer.price, stock: offer.stock } } : {}), buy }
  })
  const buys = inputs.filter((x) => x.buy > 0).map((x) => ({ name: x.name, qty: x.buy, price: x.offer!.price }))
  const buyCost = buys.reduce((s, b) => s + b.qty * b.price, 0)
  // 生效的工坊裡有這種工藝的工作台：工時打折（rooms.ts）
  const hours = Math.max(1, Math.round((recipe.hours ?? 2) * n * workshopMult(state, recipe.craft)))
  const needTier = toolTierFor(recipe.level)
  const tool = toolAccess(state, recipe.craft, needTier)
  const cost = Math.round((recipe.cost_cc ?? 0) * n * locationMult(state) * gameRule(state, 'recipeCostMult'))
  const rent = tool.rentPerHour && tool.tier >= needTier ? tool.rentPerHour * hours : 0
  const level = skillOf(crafter, recipe.craft).level
  // 做不了的原因全部列出來，不用改一項才發現下一項
  const blockers: string[] = []
  if (level < recipe.level) blockers.push(`${crafter.name}的${craftName(recipe.craft)}只有 Lv.${level}（要 Lv.${recipe.level}）`)
  if (tool.tier < needTier) blockers.push(toolBlocker(recipe.craft, needTier, tool))
  for (const x of inputs) {
    if (x.have + x.buy >= x.need) continue
    const hint = !opts.buy && x.offer ? '，這間店有賣，可以當場補買' : opts.buy && x.offer ? `，這間店只剩 ${x.offer.stock}` : ''
    blockers.push(`${x.name}不夠（需要 ${x.need}，持有 ${x.have}${x.home ? `，其中家裡的箱子 ${x.home}` : ''}${hint}）`)
  }
  if (state.money_cc < cost + rent + buyCost) blockers.push(`${buyCost ? '費用加上補買的材料' : '費用'}不夠（需要 ${formatMoney(cost + rent + buyCost)}）`)
  return {
    name, recipe, batches: n, qty: (recipe.qty ?? 1) * n, inputs, buys, buyCost, cost, rent, fee: cost + rent,
    dc: rules.dc[recipe.level - 1] ?? 18, hours, level, tool, blockers, ...(blockers.length ? { blocked: blockers.join('；') } : {}),
  }
}

/** 各成功程度做出的份數 */
export function producedQty(qty: number, degree: Degree): number {
  const r = craftRules.recipe
  if (degree === 'critical') return qty + Math.max(1, Math.ceil(qty * r.critical_bonus))
  if (degree === 'success') return qty
  if (degree === 'partial') return Math.ceil(qty * r.partial_ratio)
  return 0
}

/** 各成功程度用掉的材料：有做出東西時全部用掉，失敗損失一部分，大失敗全部損失 */
export function lostQty(need: number, degree: Degree): number {
  return degree === 'fail' ? Math.ceil(need * craftRules.recipe.lost_on_fail) : need
}

// ---- 行動 produce ----

export function produceTarget(crafter: string, name: string, batches = 1, opts: { buy?: boolean } = {}): string {
  return `${crafter}@${name}*${batches}${opts.buy ? '|!buy' : ''}`
}

export function parseProduceTarget(state: GameState, target?: string): { crafter: Character; name: string; batches: number; buy: boolean } {
  const raw = target ?? ''
  const buy = raw.endsWith('|!buy')
  const t = buy ? raw.slice(0, -'|!buy'.length) : raw
  const at = t.indexOf('@')
  const star = t.lastIndexOf('*')
  const id = at > 0 ? t.slice(0, at) : 'pc'
  const name = t.slice(at + 1, star > at ? star : undefined)
  const batches = star > at ? Number(t.slice(star + 1)) || 1 : 1
  const crafter = memberOrResident(state, currentArea(state), id)
  if (!crafter) throw new Error('隊伍中（或家裡）沒有這位角色')
  if (!recipeOf(name)) throw new Error('請選擇要做的東西')
  return { crafter, name, batches, buy }
}

export function setupProduce(state: GameState, target?: string) {
  const { crafter, name, batches, buy } = parseProduceTarget(state, target)
  const refusal = crafterRefusal(state, crafter)
  if (refusal) throw new Error(`${crafter.name}不肯動手：${refusal}`)
  const plan = recipePlan(state, name, batches, crafter, { buy })
  if (plan.blocked) throw new Error(plan.blocked)
  const skill = craftRules.skills[plan.recipe.craft]
  const used = plan.inputs.map((x) => `${x.name}×${x.need}`).join('、')
  const paid = `${plan.fee ? `，花費 ${formatMoney(plan.fee)}` : ''}${plan.buys.length ? `，當場買了 ${plan.buys.map((b) => `${b.name}×${b.qty}`).join('、')}（${formatMoney(plan.buyCost)}）` : ''}`
  return {
    actor: crafter.id,
    attr: skill.attr, dc: plan.dc, hours: plan.hours, craftCheck: 'self' as const,
    situational: [{ label: `${crafter.name}的${skill.name}（Lv.${plan.level}）`, value: plan.level * craftRules.level_bonus }],
    scene: `${locationById(state.location).name}・${crafter.isPlayer ? '' : `由${crafter.name}`}依配方製作${name}×${plan.qty}（${plan.tool.source}，材料 ${used}${paid}）`,
    targetName: name,
    outcomes: {
      critical: `做出 ${producedQty(plan.qty, 'critical')} 份${name}`,
      success: `做出 ${plan.qty} 份${name}`,
      partial: `只做出 ${producedQty(plan.qty, 'partial')} 份${name}，材料全部用掉`,
      fail: `沒做成，材料損失一半${plan.fee ? '，費用照付' : ''}`,
      fumble: `搞砸了，材料全部損失${plan.fee ? '，費用照付' : ''}`,
    } as Partial<Record<Degree, string>>,
  }
}

/** 結算：付費用、用掉材料、做出成品，再給做的人工藝經驗 */
export function applyProduce(state: GameState, report: Report, target: string, degree: Degree): string {
  const { crafter, name, batches, buy } = parseProduceTarget(state, target)
  const plan = recipePlan(state, name, batches, crafter, { buy })
  // 先補買（放進行囊），再照一般的材料用掉
  buyHere(state, report, plan.buys)
  const effects: RewardEffect[] = plan.fee ? [{ type: 'money', amount: -Math.min(plan.fee, state.money_cc) }] : []
  for (const x of plan.inputs) {
    const q = Math.min(x.have + x.buy, lostQty(x.need, degree))
    // 行囊不夠的先從家裡的箱子補進行囊，再照一般的材料用掉
    if (q) pullFromHome(state, x.name, q)
    if (q) effects.push({ type: 'item', name: x.name, qty: -q })
  }
  const made = producedQty(plan.qty, degree)
  if (made) effects.push({ type: 'item', name, qty: made })
  applyEffects(state, report, effects)
  const paid = plan.fee ? `花了 ${formatMoney(plan.fee)}（${[plan.cost ? '耗材費' : '', plan.rent ? '工坊租金' : ''].filter(Boolean).join('、')}），` : ''
  let text = made ? `${paid}做出 ${made} 份${name}。` : `${paid}${degree === 'fail' ? '沒做成，損失了一半的材料' : '搞砸了，材料全部損失'}。`
  // 經驗乘批數：一次做 N 批和分開做 N 次的經驗一樣（批量製作不吃虧）
  const xp = craftXpFor(plan.recipe.level, degree) * plan.batches
  if (xp) {
    const level = gainCraftXp(crafter, plan.recipe.craft, xp)
    ;(report.changes.craft_xp ??= []).push({ actor: crafter.id, craft: plan.recipe.craft, amount: xp, ...(level ? { level } : {}) })
    text += `${crafter.name}的${craftName(plan.recipe.craft)}經驗 +${xp}${level ? `，升到 Lv.${level}` : ''}。`
  }
  return text
}
