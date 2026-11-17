// 委託打造：在鐵匠鋪（金屬、木材）、裁縫店（皮革、布料）、珠寶店（寶石）選底材與材料，交給工匠打造（data/rules/gear.json 的 craft）。
// 走主動行動 craft（target = "底材:材料"）：玩家可以描述想要的樣子，AI 決定成功程度，
// 也可以用 gear 效果替成品取名、寫描述、挑附魔（程式依成功程度夾住稀有度與附魔點數）。
// AI 關閉時依規則：成功以上隨機附魔。

import { blueprintRules, hasBlueprint } from './blueprints'
import { craftRules as craftSkillRules, isCustomShopId, itemDef, lewdRules, locationById, shopRules, type CraftId, type Degree, type ShopType } from './data'
import {
  crafterRefusal, craftForKind, craftName, craftXpFor, gainCraftXp, keeperCraftLevel, skillOf, toolAccess, toolBlocker, toolTierFor, type ToolAccess,
} from './crafting'
import { npcRecord } from './npcs'
import { dealMoney, keeperFor, locationMult, shopKey, shopTypeForCell } from './trade'
import { applyEffects, type RewardEffect } from './effects'
import { forgeItemsForMaterial, forgeUnitPrice, gearName, gearRules, type MaterialKind, rarityName, rarityPoints, registerGear, rollEnchants, sanitizeGearSpec, shiftRarity } from './gear'
import { CELL_NAME, currentArea, currentCell, type CellKind } from './grid'
import { memberOrResident } from './homes'
import { formatMoney } from './money'
import { withRng } from './state'
import { baseLewd } from './lewd'
import { inventoryHere, pullFromHome, stockHere } from './storage'
import { workshopMult } from './rooms'
import type { Character, GameState, GearSpec, LewdStat, Report } from './types'

export interface CraftPlan {
  /** 輔料、總價值、讓稀有度再高一級的機率、屬性方向 */
  aux: AuxItem[]
  auxValue: number
  auxChance: number
  elements: string[]
  base: string
  material: string
  tier: number
  /** 需要的打造材料數量（委託與自己動手一樣；委託時不夠的由工匠代備，見 supplied） */
  units: number
  /** 會用掉的物品（選定的那種優先，其餘從便宜的開始；含當場補買的） */
  uses: { name: string; qty: number }[]
  /** 持有的打造材料數量（不含當場補買的） */
  have: number
  /** 能做成這種材料的物品：持有幾個、站的這間店今天有沒有賣（單價、存貨） */
  sources: { name: string; have: number; price?: number; stock?: number }[]
  /** 選定優先用的那一種 */
  use?: string
  /** 當場補買：向站的這間店買不夠的份數（買來直接用掉；沒做成時剩下的留在行囊） */
  buys: { name: string; qty: number; price: number }[]
  buyCost: number
  /** 委託：打造材料不夠的份數由工匠代備（照最便宜的打造材料的價格 × 聚落物價收錢）；自己動手是 0 */
  supplied: number
  /** 工匠代備一份的價格 */
  supplyUnit: number
  /** 工匠代備的材料費（supplied × supplyUnit） */
  supplyCost: number
  /** 委託時選了全部由工匠代備（行囊裡的不用） */
  supplyAll?: boolean
  /** 委託：工錢；自己動手：工坊租金（不含當場補買與代備的材料費） */
  fee: number
  dc: number
  /** 自己動手時：有沒有這個底材的圖紙（沒有時 dc 已經 +5） */
  blueprint?: boolean
  /** 做這種材料的工藝 */
  craft: CraftId
  /** 做的人的工藝等級（委託：店主；自己動手：做的人） */
  level: number
  /** 自己動手：做的人與能用的工具 */
  crafter?: string
  tool?: ToolAccess
  /** 自己動手：工坊租金 */
  rent?: number
  /** 不能打造的原因（全部列出，用「；」接起來） */
  blocked?: string
  /** 不能打造的原因，一條一條 */
  blockers: string[]
  /** 一次做幾件（打造材料、費用、時間、經驗已經乘上去） */
  count: number
}

function craftRules() {
  return gearRules.craft
}

/** 物品可以拿來打造哪些材料 */
export function forgeOf(name: string): string[] {
  return itemDef(name)?.forge?.materials ?? []
}

/** 哪種材料到哪裡打造 */
export const CRAFT_SHOP: Record<MaterialKind, CellKind> = { metal: 'smithy', wood: 'smithy', leather: 'tailor', cloth: 'tailor', jewel: 'jeweler' }

/** 成人向服裝與拘束具的委託打造（docs/LEWD_STATS.md 第 25 節）：只在這種店（成人用品店），一般的店不接 */
export const outfitCommission = () => lewdRules.outfit_commission
const isAdultOutfit = (base: string) => gearRules.bases[base]?.outfit === 'adult'
/** 打造得出來的拘束具（詛咒具這類專屬底材除外） */
export const isCraftRestraint = (base: string) => !!gearRules.bases[base]?.restraint && !gearRules.bases[base]?.exclusive
/** 成人用品店打造的：成人向服裝與拘束具（可以加慾望指標） */
export const isAdultCraft = (base: string) => isAdultOutfit(base) || isCraftRestraint(base)

/** 這個底材要到哪種店委託（成人向服裝到成人用品店，其他照材料） */
export function craftShopFor(base: string): CellKind {
  return isAdultCraft(base) ? outfitCommission().shop as CellKind : CRAFT_SHOP[gearRules.bases[base]!.kind]
}

/** 站的這間店接不接這個底材的委託 */
export function commissionHere(state: GameState, base: string): boolean {
  const cell = currentCell(state).kind
  if (isCustomShopId(cell)) return craftKindsHere(state).includes(gearRules.bases[base]!.kind)
  return craftShopFor(base) === cell
}

/** 委託成人向服裝、拘束具時可以加的慾望指標與加成（依材料等級；不是這兩類時 undefined） */
export function outfitLewdBonus(base: string, material: string): number | undefined {
  if (!isAdultCraft(base)) return undefined
  const t = outfitCommission().bonus_by_tier
  const tier = gearRules.materials[material]?.tier ?? 1
  return t[Math.min(tier, t.length) - 1]
}

/** 這裡可以打造的材料類型 */
export function craftKindsHere(state: GameState): MaterialKind[] {
  const cell = currentCell(state).kind
  // 成人用品店：只接成人向服裝與拘束具，材料照底材
  if (cell === outfitCommission().shop) return ['metal', 'wood', 'leather', 'cloth', 'jewel']
  // 自建的商店：接哪些材料類型看商店的設定
  const custom = isCustomShopId(cell) ? shopRules.types[cell] : undefined
  if (custom) return (custom.craft ?? []) as MaterialKind[]
  return (Object.keys(CRAFT_SHOP) as MaterialKind[]).filter((k) => CRAFT_SHOP[k] === cell)
}

export function canCraftHere(state: GameState): boolean {
  return craftKindsHere(state).length > 0
}

export interface AuxItem { name: string; qty: number }

/** 打造的選項：優先用哪一種打造材料、不夠時向這間店當場補買 */
export interface CraftOptions { use?: string; buy?: boolean
  /** 委託：全部由工匠代備，不用行囊裡的打造材料（只在工匠代備得了的等級） */
  supplyAll?: boolean
  /** 委託成人向服裝時加的慾望指標（docs/LEWD_STATS.md 第 25 節） */
  lewd?: LewdStat
  /** 一次做幾件（1～gear.json 的 craft.max_count） */
  count?: number }

/** 一次打造的件數上限 */
export const craftMaxCount = () => Math.max(1, gearRules.craft.max_count ?? 1)
/** 件數夾在 1～上限 */
export const craftCount = (n?: number) => Math.max(1, Math.min(craftMaxCount(), Math.round(Number(n) || 1)))

/**
 * 打造的 target：「底材:材料」，有輔料時接上「|名稱*數量」，選項接上「|!use=名稱」「|!buy」，
 * 例如 longsword:steel|火蜥鱗片*2|!use=精鋼錠|!buy。
 */
export function parseCraftTarget(target?: string): { base: string; material: string; aux: AuxItem[]; opts: CraftOptions } {
  const [head, ...segs] = (target ?? '').split('|')
  const opts: CraftOptions = {}
  for (const x of segs) {
    if (x === '!buy') opts.buy = true
    else if (x === '!supply') opts.supplyAll = true
    else if (x.startsWith('!use=') && x.length > 5) opts.use = x.slice(5)
    else if (x.startsWith('!lewd=') && outfitCommission().stats.includes(x.slice(6) as LewdStat)) opts.lewd = x.slice(6) as LewdStat
    else if (x.startsWith('!n=') && craftCount(Number(x.slice(3))) > 1) opts.count = craftCount(Number(x.slice(3)))
  }
  const rest = segs.filter((x) => !x.startsWith('!'))
  const [base, material] = (head ?? '').split(':')
  if (!base || !material || !gearRules.bases[base] || !gearRules.materials[material]) throw new Error('請選擇要打造的裝備與材料')
  if (gearRules.bases[base]!.kind !== gearRules.materials[material]!.kind) throw new Error('這種材料不能拿來做這件裝備')
  // 拘束具可以打造（詛咒具這類專屬底材不行）
  if (gearRules.bases[base]!.exclusive) throw new Error(`${gearRules.bases[base]!.name}不能打造`)
  const aux = rest.map((x) => {
    const i = x.lastIndexOf('*')
    return { name: i >= 0 ? x.slice(0, i) : x, qty: Math.max(1, Math.round(Number(i >= 0 ? x.slice(i + 1) : 1)) || 1) }
  }).filter((a) => a.name)
  return { base, material, aux, opts }
}

export function craftTarget(base: string, material: string, aux: AuxItem[] = [], opts: CraftOptions = {}): string {
  return [
    `${base}:${material}`, ...aux.filter((a) => a.qty > 0).map((a) => `${a.name}*${a.qty}`),
    ...(opts.use ? [`!use=${opts.use}`] : []), ...(opts.buy ? ['!buy'] : []), ...(opts.supplyAll ? ['!supply'] : []), ...(opts.lewd ? [`!lewd=${opts.lewd}`] : []),
    ...(craftCount(opts.count) > 1 ? [`!n=${craftCount(opts.count)}`] : []),
  ].join('|')
}

/** 站的這間店今天賣的這件物品（只讀今天已經有的清單，不會建立；打開打造面板時先建立） */
export function shopOfferHere(state: GameState, name: string): { key: string; dealId: string; price: number; stock: number } | undefined {
  const type = shopTypeForCell(currentCell(state).kind)
  if (!type) return undefined
  const key = shopKey(state, type)
  const shop = state.shops?.[key]
  if (!shop || shop.day !== state.time.day) return undefined
  const deal = shop.deals.find((d) => d.id === `item:${name}` && d.stock > 0)
  return deal ? { key, dealId: deal.id, price: dealMoney(state, key, deal), stock: deal.stock } : undefined
}

/** 輔料的屬性方向：名稱與描述裡的字（gear.json 的 craft.aux.elements） */
export function auxElements(aux: AuxItem[]): string[] {
  const text = aux.map((a) => `${a.name}${itemDef(a.name)?.desc ?? ''}`).join('')
  return Object.entries(craftRules().aux.elements).filter(([, words]) => words.some((w) => text.includes(w))).map(([k]) => k)
}

function unitsFor(base: string): number {
  const b = gearRules.bases[base]!
  const u = craftRules().units
  return b.two_handed ? u.two_handed! : u[b.slot] ?? 1
}

/**
 * 打造的花費與材料（不檢查站的位置）。沒有 crafter 是委託店主；有 crafter 是這位隊員自己動手：
 * 不付工錢，第一級材料要買（材料費），工具不夠中階時在店裡租工坊
 */
/** 委託時工匠代備的材料最高到第幾級（crafts.json 的 supply.max_tier） */
export function supplyMaxTier(): number {
  return craftSkillRules.supply?.max_tier ?? 2
}

export function craftPlan(state: GameState, base: string, material: string, aux: AuxItem[] = [], crafter?: Character, opts: CraftOptions = {}): CraftPlan {
  const r = craftRules()
  const m = gearRules.materials[material]!
  const tier = m.tier
  const craft = craftForKind(m.kind)
  // 一次做幾件：打造材料、費用、時間、經驗都乘件數
  const count = craftCount(opts.count)
  // 打造材料：委託與自己動手一樣先用行囊裡的；委託時不夠的由工匠代備（另外收材料費），自己動手可以向站的這間店補買
  const units = unitsFor(base) * count
  // 選定的那種優先，其餘從便宜的開始
  const price = (n: string) => itemDef(n)?.price_cc ?? 0
  const first = (a: string, b: string) => (a === opts.use ? -1 : b === opts.use ? 1 : 0) || price(a) - price(b)
  // 持有：行囊加上家裡的箱子（站在自己的房子裡時，storage.ts）
  const owned = inventoryHere(state).filter((i) => forgeOf(i.name).includes(material)).sort((a, b) => first(a.name, b.name))
  const have = owned.reduce((s, i) => s + i.qty, 0)
  // 委託時工匠代備得了的等級：可以選全部由工匠代備，不用行囊裡的（想留著自己用、或代備比較便宜時）
  const canSupply = !crafter && tier <= supplyMaxTier()
  const supplyAll = canSupply && !!opts.supplyAll
  const uses: { name: string; qty: number }[] = []
  let need = units
  for (const i of supplyAll ? [] : owned) {
    if (need <= 0) break
    const q = Math.min(i.qty, need)
    uses.push({ name: i.name, qty: q })
    need -= q
  }
  // 能做成這種材料的物品：持有幾個、這間店有沒有賣
  const sources = forgeItemsForMaterial(material).map((name) => {
    const offer = shopOfferHere(state, name)
    return { name, have: owned.filter((i) => i.name === name).reduce((s, i) => s + i.qty, 0), ...(offer ? { price: offer.price, stock: offer.stock } : {}) }
  })
  // 當場補買：不夠的份數向這間店買（選定的那種優先，其餘從便宜的開始）；
  // 自己動手，或委託工匠代備不了的等級（第 3 級以上，例如珠寶店的金錠）
  const buys: { name: string; qty: number; price: number }[] = []
  if ((crafter || !canSupply) && opts.buy && need > 0) {
    for (const s of sources.filter((x) => x.price !== undefined).sort((a, b) => first(a.name, b.name) || a.price! - b.price!)) {
      if (need <= 0) break
      const q = Math.min(s.stock!, need)
      buys.push({ name: s.name, qty: q, price: s.price! })
      const u = uses.find((x) => x.name === s.name)
      if (u) u.qty += q
      else uses.push({ name: s.name, qty: q })
      need -= q
    }
  }
  const bought = buys.reduce((s, b) => s + b.qty, 0)
  const buyCost = buys.reduce((s, b) => s + b.qty * b.price, 0)
  const mult = locationMult(state)
  // 委託：不夠的份數由工匠代備，照最便宜的打造材料的價格 × 聚落物價（算不出價格的材料工匠也找不到）；
  // 只代備 crafts.json supply.max_tier 級以下（市場買得到的），更高級的要自己帶，免得有錢就能做高等裝備轉賣
  const unitPrice = forgeUnitPrice(material)
  const supplyUnit = canSupply && unitPrice !== undefined ? Math.max(1, Math.round(unitPrice * mult)) : 0
  const supplied = supplyUnit && need > 0 ? need : 0
  const supplyCost = supplied * supplyUnit
  const loc = locationById(state.location)
  // 委託：店主的工藝等級決定做得了幾級的材料；自己動手：做的人的等級與工具
  const self = crafter ? selfCost(state, tier, craft) : undefined
  // 自己動手：材料自己準備，只付工坊租金；委託：工錢（底材價格 × 材料等級的倍率）
  const fee = self ? self.rent * count : Math.round(gearRules.bases[base]!.price * r.fee[tier - 1]! * mult) * count
  const shop = craftShop(state, m.kind)
  const level = crafter ? skillOf(crafter, craft).level : keeperCraftLevel(npcRecord(state, keeperId(state, shop)) ?? { id: keeperId(state, shop) }, craft, loc.type)
  // 輔料：只能是材料，數量要扣掉當作打造材料用掉的
  const a = r.aux
  const auxBlocked: string[] = []
  if (aux.length > a.max_kinds) auxBlocked.push(`輔料最多 ${a.max_kinds} 種`)
  for (const x of aux) {
    const owned = stockHere(state, x.name) - (uses.find((u) => u.name === x.name)?.qty ?? 0)
    if (itemDef(x.name)?.category !== 'material') auxBlocked.push(`${x.name}不是材料，不能當輔料`)
    else if (x.qty > a.max_qty) auxBlocked.push(`每種輔料最多 ${a.max_qty} 個`)
    else if (owned < x.qty) auxBlocked.push(`${x.name}不夠（還有 ${Math.max(0, owned)} 個）`)
  }
  const auxValue = aux.reduce((sum, x) => sum + (itemDef(x.name)?.price_cc ?? 0) * x.qty, 0)
  // 輔料照總價值算：做好幾件時要多放一些才有同樣的機率
  const plain = gearRules.bases[base]!.price * m.price * count
  const auxChance = Math.round(Math.min(a.max_chance, (auxValue / Math.max(1, plain)) * a.chance_per_value) * 100) / 100
  // 不能打造的原因全部列出來，不用改一項才發現下一項
  const blockers: string[] = []
  if (level < tier) {
    blockers.push(crafter
      ? `${crafter.name}的${craftName(craft)}只有 Lv.${level}，處理不了${m.name}（要 Lv.${tier}）`
      : `${loc.name}的工匠（${craftName(craft)} Lv.${level}）處理不了${m.name}（要 Lv.${tier}）`)
  }
  if (self && self.tool.tier < toolTierFor(tier)) blockers.push(`${m.name}${toolBlocker(craft, toolTierFor(tier), self.tool)}`)
  if (need - supplied > 0) {
    const sold = sources.reduce((s, x) => s + (x.stock ?? 0), 0)
    const hint = canSupply ? '；工匠也找不到這種材料'
      : !opts.buy && sold ? '；這間店有賣，可以當場補買' : opts.buy && sold ? `；這間店只剩 ${sold} 份`
      : !crafter ? `；工匠只代備第 ${supplyMaxTier()} 級以下的材料，第 ${tier} 級要自己帶` : ''
    blockers.push(`打造材料不夠（需要 ${units} 份能做成${m.name}的材料，持有 ${have} 份${hint}）`)
  }
  const feeName = crafter ? (self?.rent ? '工坊租金' : '費用') : '工錢'
  const extra = buyCost ? '與補買的材料' : supplyCost ? '與工匠代備的材料費' : ''
  if (state.money_cc < fee + buyCost + supplyCost) blockers.push(`錢不夠：${feeName}${extra}要 ${formatMoney(fee + buyCost + supplyCost)}`)
  blockers.push(...auxBlocked)
  return {
    base, material, tier, units, uses, have, sources, ...(opts.use ? { use: opts.use } : {}), buys, buyCost, supplied, supplyUnit, supplyCost, ...(supplyAll ? { supplyAll } : {}),
    // 自己動手打造時沒有這個底材的圖紙：DC + 5（委託店家不受影響，docs/CRAFTING.md 2.2 節）
    fee, dc: r.dc[tier - 1]! + (crafter && !hasBlueprint(state, base) ? blueprintRules().dc_without : 0), aux, auxValue, auxChance, elements: auxElements(aux),
    ...(crafter ? { blueprint: hasBlueprint(state, base) } : {}),
    craft, level,
    ...(crafter && self ? { crafter: crafter.id, tool: self.tool, rent: self.rent * count } : {}),
    blockers, ...(blockers.length ? { blocked: blockers.join('；') } : {}), count,
  }
}

/** 自己動手的花費：工具要在店裡租時付租金（打造材料另外用行囊裡的或當場補買） */
function selfCost(state: GameState, tier: number, craft: CraftId) {
  const tool = toolAccess(state, craft, toolTierFor(tier))
  const rent = tool.rentPerHour && tool.tier >= toolTierFor(tier) ? tool.rentPerHour * craftSkillRules.self.hours : 0
  return { tool, rent }
}

/** 委託打造找哪家店的店主：站在接這種材料的自建商店時是這家店，否則是內建的店 */
function craftShop(state: GameState, kind: MaterialKind): string {
  const cell = currentCell(state).kind
  if (cell === outfitCommission().shop) return cell
  return isCustomShopId(cell) && craftKindsHere(state).includes(kind) ? cell : CRAFT_SHOP[kind] === 'shop' ? 'general' : CRAFT_SHOP[kind]
}

function keeperId(state: GameState, shop: string): string {
  return keeperFor(state, shop as ShopType)
}

/**
 * 成功程度對應的稀有度：大成功 +1；成功至少優良。
 * boosted（輔料擲中）：大成功、成功再高一級；部分成功改成照成功做。
 */
export function craftRarity(material: string, degree: Degree, boosted = false): string | undefined {
  const natural = gearRules.materials[material]!.rarity
  const success = natural === 'common' ? 'uncommon' : natural
  if (degree === 'critical') return shiftRarity(natural, boosted ? 2 : 1)
  if (degree === 'success') return boosted ? shiftRarity(success, 1) : success
  if (degree === 'partial') return boosted ? success : natural
  return undefined
}

export function setupCraft(state: GameState, target?: string) {
  if (!canCraftHere(state)) throw new Error('要在鐵匠鋪、裁縫店或珠寶店委託打造')
  const { base, material, aux, opts } = parseCraftTarget(target)
  const kind = gearRules.bases[base]!.kind
  if (!commissionHere(state, base)) throw new Error(`${gearRules.bases[base]!.name}要到${CELL_NAME[craftShopFor(base)]}打造`)
  if (opts.lewd && !isAdultCraft(base)) throw new Error('只有成人向服裝與拘束具可以加慾望指標')
  const plan = craftPlan(state, base, material, aux, undefined, opts)
  if (plan.blocked) throw new Error(plan.blocked)
  const name = gearName({ base, material })
  const at = (d: Degree) => rarityName(craftRarity(material, d)!)
  const used = plan.uses.map((u) => `${u.name}×${u.qty}`).join('、')
  const auxText = aux.map((x) => `${x.name}×${x.qty}`).join('、')
  // 委託打造由店主擲：d20 + 店主的工藝等級 × 2（docs/CRAFTING.md 1.1 節）
  return {
    attr: craftSkillRules.skills[plan.craft].attr, dc: plan.dc, hours: craftRules().hours * plan.count, craftCheck: 'keeper' as const,
    situational: [{ label: `工匠的手藝（${craftName(plan.craft)} Lv.${plan.level}）`, value: plan.level * craftSkillRules.level_bonus }],
    scene: `${locationById(state.location).name}・委託打造${name}${countText(plan)}（工錢 ${formatMoney(plan.fee)}${used ? `，材料 ${used}` : ''}${boughtText(plan)}${auxText ? `，輔料 ${auxText}（${Math.round(plan.auxChance * 100)}% 機率品質再高一級）` : ''}）`,
    targetName: name,
    outcomes: {
      critical: `做出${countText(plan, '件')}${at('critical')}品質的${name}，${plan.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(material, 'critical')!)} 點`,
      success: `做出${countText(plan, '件')}${at('success')}品質的${name}，${plan.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(material, 'success')!)} 點`,
      partial: `做出${countText(plan, '件')}普通的${name}（沒有附魔）`,
      fail: `沒做成，帶來的材料損失一半，工錢${plan.supplyCost ? '與代備的材料費' : ''}照付`,
      fumble: `搞砸了，帶來的材料全部損失，工錢${plan.supplyCost ? '與代備的材料費' : ''}照付`,
    } as Partial<Record<Degree, string>>,
  }
}

/**
 * 結算打造：付工錢、用掉材料，依成功程度做出裝備。gear 是 AI 提出的成品（名稱、描述、附魔），
 * 底材與材料固定為委託的內容，稀有度與附魔點數依成功程度夾住。
 */
export function applyCraft(state: GameState, report: Report, target: string, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>): string {
  const { base, material, aux, opts } = parseCraftTarget(target)
  // 委託成人向服裝：選的慾望指標照材料等級加成
  const bonus = opts.lewd ? outfitLewdBonus(base, material) : undefined
  return finishCraft(state, report, craftPlan(state, base, material, aux, undefined, opts), degree, gear, bonus ? { [opts.lewd!]: bonus } : undefined)
}

/** 自己動手的花費名稱：材料費、工坊租金 */
export function selfFeeName(plan: Pick<CraftPlan, 'rent'>): string {
  return plan.rent ? '工坊租金' : '費用'
}

/** 「（其中當場買了 精鋼錠×2，80 白鸛）」 */
function boughtText(plan: CraftPlan): string {
  if (plan.supplied) return `，工匠代備 ${plan.supplied} 份材料（${formatMoney(plan.supplyCost)}）`
  return plan.buys.length ? `，當場買了 ${plan.buys.map((b) => `${b.name}×${b.qty}`).join('、')}（${formatMoney(plan.buyCost)}）` : ''
}

/** 件數的說明：「×3」；unit 給了時是「3 件」（一件時是空字串） */
function countText(plan: Pick<CraftPlan, 'count'>, unit?: string): string {
  if (plan.count <= 1) return ''
  return unit ? `${plan.count} ${unit}` : ` ×${plan.count}`
}

/** 當場補買（打造與配方共用）：付錢、放進行囊（接著照一般的材料用掉）、扣掉站的這間店的存貨 */
export function buyHere(state: GameState, report: Report, buys: { name: string; qty: number; price: number }[]) {
  if (!buys.length) return
  const effects: RewardEffect[] = [{ type: 'money', amount: -buys.reduce((s, b) => s + b.qty * b.price, 0) }]
  for (const b of buys) {
    effects.push({ type: 'item', name: b.name, qty: b.qty })
    const offer = shopOfferHere(state, b.name)
    const deal = offer && state.shops?.[offer.key]?.deals.find((d) => d.id === offer.dealId)
    if (deal) deal.stock = Math.max(0, deal.stock - b.qty)
  }
  applyEffects(state, report, effects)
}

function finishCraft(state: GameState, report: Report, plan: CraftPlan, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>, lewd?: GearSpec['lewd']): string {
  const { base, material, aux } = plan
  buyHere(state, report, plan.buys)
  const supply = plan.supplied ? `，工匠代備 ${plan.supplied} 份材料 ${formatMoney(plan.supplyCost)}` : ''
  const paid = plan.crafter ? `花了 ${formatMoney(plan.fee)}（${selfFeeName(plan)}）` : `付了 ${formatMoney(plan.fee)} 工錢${supply}`
  // 輔料：成功程度有做出東西時擲一次，擲中就再高一級
  const boosted = plan.auxChance > 0 && !!craftRarity(material, degree) && withRng(state, (rng) => rng.chance(plan.auxChance))
  const rarity = craftRarity(material, degree, boosted)
  // 損失的是自己帶來的材料（工匠代備的照樣付錢、用掉）：做出來全部用掉，失敗損失一半，大失敗全部
  const own = plan.uses.reduce((s, u) => s + u.qty, 0)
  const lost = rarity ? own : degree === 'fail' ? Math.ceil(own * craftRules().lost_on_fail) : own
  const effects: RewardEffect[] = plan.fee + plan.supplyCost ? [{ type: 'money', amount: -(plan.fee + plan.supplyCost) }] : []
  let left = lost
  // 同一種東西同時是打造材料與輔料時合計：行囊不夠的先從家裡的箱子補進行囊
  const take = new Map<string, number>()
  for (const u of plan.uses) {
    if (left <= 0) break
    const q = Math.min(u.qty, left)
    effects.push({ type: 'item', name: u.name, qty: -q })
    take.set(u.name, (take.get(u.name) ?? 0) + q)
    left -= q
  }
  // 輔料不論結果都會用掉
  for (const x of aux) {
    effects.push({ type: 'item', name: x.name, qty: -x.qty })
    take.set(x.name, (take.get(x.name) ?? 0) + x.qty)
  }
  for (const [name, q] of take) pullFromHome(state, name, q)
  applyEffects(state, report, effects)
  if (!rarity) return `${plan.fee || plan.supplyCost ? `${paid}，但` : ''}${degree === 'fail' ? '沒做成' : '搞砸了'}${lost ? `，損失了 ${lost} 份材料` : ''}。`
  const plainPiece = degree === 'partial' && !boosted
  // 一次做好幾件：品質一樣，附魔每件各自擲（AI 提出的成品照它做，每件都一樣）
  const made = new Map<string, number>()
  for (let i = 0; i < plan.count; i++) {
    let spec: GearSpec
    if (gear) {
      spec = sanitizeGearSpec({ ...gear.spec, rarity }, { maxLevel: 99, maxRarity: rarity, base, material, restraint: true })!
      if (plainPiece) delete spec.enchants
    } else {
      spec = { base, material, ...(rarity !== gearRules.materials[material]!.rarity ? { rarity } : {}) }
      const points = plainPiece ? 0 : rarityPoints(rarity)
      const enchants = points ? withRng(state, (rng) => rollEnchants(base, points, rng, plan.elements)) : undefined
      if (enchants) spec.enchants = enchants
    }
    if (lewd) spec.lewd = lewd
    const name = registerGear(state, spec, gear?.name, gear?.desc)
    made.set(name, (made.get(name) ?? 0) + 1)
  }
  applyEffects(state, report, [...made].map(([name, qty]) => ({ type: 'item' as const, name, qty })))
  const list = [...made].map(([name, qty]) => `【${name}】${qty > 1 ? `×${qty}` : ''}`).join('、')
  return `${plan.fee ? `${paid}，` : ''}打造出${list}。${boosted ? '輔料讓成品的品質更上一層。' : ''}`
}

// ---- 自己動手（行動 make，見 crafting.ts） ----

/** 自己動手的 target：「做的人的 id@底材:材料|輔料…|選項」 */
export function makeTarget(crafter: string, base: string, material: string, aux: AuxItem[] = [], opts: CraftOptions = {}): string {
  return `${crafter}@${craftTarget(base, material, aux, opts)}`
}

/** 打造的部分（去掉「做的人@」） */
export function craftPart(target?: string): string | undefined {
  const at = (target ?? '').indexOf('@')
  return at > 0 ? target!.slice(at + 1) : target
}

export function parseMakeTarget(state: GameState, target?: string): { crafter: Character; base: string; material: string; aux: AuxItem[]; opts: CraftOptions } {
  const at = (target ?? '').indexOf('@')
  const id = at > 0 ? target!.slice(0, at) : 'pc'
  const crafter = memberOrResident(state, currentArea(state), id)
  if (!crafter) throw new Error('隊伍中（或家裡）沒有這位角色')
  return { crafter, ...parseCraftTarget(at > 0 ? target!.slice(at + 1) : target) }
}

/**
 * 自己打造時加的慾望指標：委託的加成（依材料等級）× 做的人自己那一項的基本值 / 100（四捨五入；裝備的加值不算）。
 * 例如月影絲（委託 +8）、淫亂 50 的人做：+4
 */
export function selfLewdBonus(crafter: Pick<Character, 'lewd'>, stat: LewdStat, base: string, material: string): number {
  const full = outfitLewdBonus(base, material)
  if (!full) return 0
  // 指標 100 的人比委託多一點（self_extra_by_tier，依材料等級 +1～+2）
  const extra = outfitCommission().self_extra_by_tier ?? []
  const tier = gearRules.materials[material]?.tier ?? 1
  const top = full + (extra.length ? extra[Math.min(tier, extra.length) - 1] ?? 0 : 0)
  return Math.round(top * Math.min(100, Math.max(0, baseLewd(crafter)[stat] ?? 0)) / 100)
}

export function setupMake(state: GameState, target?: string) {
  const { crafter, base, material, aux, opts } = parseMakeTarget(state, target)
  if (opts.lewd && !isAdultCraft(base)) throw new Error('只有成人向服裝與拘束具可以加慾望指標')
  const refusal = crafterRefusal(state, crafter)
  if (refusal) throw new Error(`${crafter.name}不肯動手：${refusal}`)
  const plan = craftPlan(state, base, material, aux, crafter, opts)
  if (plan.blocked) throw new Error(plan.blocked)
  const name = gearName({ base, material })
  const skill = craftSkillRules.skills[plan.craft]
  const at = (d: Degree) => rarityName(craftRarity(material, d)!)
  const used = plan.uses.map((u) => `${u.name}×${u.qty}`).join('、')
  const auxText = aux.map((x) => `${x.name}×${x.qty}`).join('、')
  return {
    actor: crafter.id,
    attr: skill.attr, dc: plan.dc, hours: Math.max(1, Math.round(craftSkillRules.self.hours * plan.count * workshopMult(state, plan.craft))), craftCheck: 'self' as const,
    situational: [{ label: `${crafter.name}的${skill.name}（Lv.${plan.level}）`, value: plan.level * craftSkillRules.level_bonus }],
    scene: `${locationById(state.location).name}・${crafter.isPlayer ? '親手' : `由${crafter.name}`}打造${name}${countText(plan)}（${plan.tool!.source}${plan.fee ? `，${selfFeeName(plan)} ${formatMoney(plan.fee)}` : ''}${used ? `，材料 ${used}` : ''}${boughtText(plan)}${auxText ? `，輔料 ${auxText}（${Math.round(plan.auxChance * 100)}% 機率品質再高一級）` : ''}）`,
    targetName: name,
    outcomes: {
      critical: `做出${countText(plan, '件')}${at('critical')}品質的${name}，${plan.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(material, 'critical')!)} 點`,
      success: `做出${countText(plan, '件')}${at('success')}品質的${name}，${plan.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(material, 'success')!)} 點`,
      partial: `做出${countText(plan, '件')}普通的${name}（沒有附魔）`,
      fail: `沒做成，材料損失一半${plan.fee ? `，${selfFeeName(plan)}照付` : ''}`,
      fumble: `搞砸了，材料全部損失${plan.fee ? `，${selfFeeName(plan)}照付` : ''}`,
    } as Partial<Record<Degree, string>>,
  }
}

/** 結算自己動手：和委託一樣做出裝備，再給做的人工藝經驗（材料等級 × 用了幾份材料 × 成功程度的倍數：大件的經驗比小件多） */
export function applyMake(state: GameState, report: Report, target: string, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>): string {
  const { crafter, base, material, aux, opts } = parseMakeTarget(state, target)
  const plan = craftPlan(state, base, material, aux, crafter, opts)
  // 自己打造成人向服裝、拘束具：選的慾望指標照做的人自己的指標加成
  const bonus = opts.lewd ? selfLewdBonus(crafter, opts.lewd, base, material) : 0
  const text = finishCraft(state, report, plan, degree, gear, bonus ? { [opts.lewd!]: bonus } : undefined)
  const xp = craftXpFor(plan.tier, degree) * Math.max(1, plan.units)
  if (!xp) return text
  const level = gainCraftXp(crafter, plan.craft, xp)
  ;(report.changes.craft_xp ??= []).push({ actor: crafter.id, craft: plan.craft, amount: xp, ...(level ? { level } : {}) })
  return `${text}${crafter.name}的${craftName(plan.craft)}經驗 +${xp}${level ? `，升到 Lv.${level}` : ''}。`
}
