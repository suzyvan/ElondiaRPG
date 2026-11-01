// 委託打造：在鐵匠鋪（金屬、木材）、裁縫店（皮革、布料）、珠寶店（寶石）選底材與材料，交給工匠打造（data/rules/gear.json 的 craft）。
// 走主動行動 craft（target = "底材:材料"）：玩家可以描述想要的樣子，AI 決定成功程度，
// 也可以用 gear 效果替成品取名、寫描述、挑附魔（程式依成功程度夾住稀有度與附魔點數）。
// AI 關閉時依規則：成功以上隨機附魔。

import { craftRules as craftSkillRules, isCustomShopId, itemDef, locationById, shopRules, type CraftId, type Degree, type ShopType } from './data'
import {
  crafterRefusal, craftForKind, craftName, craftXpFor, gainCraftXp, keeperCraftLevel, skillOf, toolAccess, toolBlocker, toolTierFor, type ToolAccess,
} from './crafting'
import { npcRecord } from './npcs'
import { keeperFor, locationMult } from './trade'
import { applyEffects, type RewardEffect } from './effects'
import { gearName, gearRules, type MaterialKind, rarityName, rarityPoints, registerGear, rollEnchants, sanitizeGearSpec, shiftRarity } from './gear'
import { CELL_NAME, currentArea, currentCell, type CellKind } from './grid'
import { memberOrResident } from './homes'
import { formatMoney } from './money'
import { withRng } from './state'
import type { Character, GameState, GearSpec, Report } from './types'

export interface CraftPlan {
  /** 輔料、總價值、讓稀有度再高一級的機率、屬性方向 */
  aux: AuxItem[]
  auxValue: number
  auxChance: number
  elements: string[]
  base: string
  material: string
  tier: number
  /** 需要的打造材料數量（第一級材料為 0） */
  units: number
  /** 會用掉的物品（從便宜的開始） */
  uses: { name: string; qty: number }[]
  /** 持有的打造材料數量 */
  have: number
  /** 委託：工錢；自己動手：第一級材料的材料費＋工坊租金 */
  fee: number
  dc: number
  /** 做這種材料的工藝 */
  craft: CraftId
  /** 做的人的工藝等級（委託：店主；自己動手：做的人） */
  level: number
  /** 自己動手：做的人與能用的工具 */
  crafter?: string
  tool?: ToolAccess
  /** 自己動手：第一級材料的材料費、工坊租金 */
  materialCost?: number
  rent?: number
  /** 不能打造的原因（全部列出，用「；」接起來） */
  blocked?: string
  /** 不能打造的原因，一條一條 */
  blockers: string[]
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

/** 這裡可以打造的材料類型 */
export function craftKindsHere(state: GameState): MaterialKind[] {
  const cell = currentCell(state).kind
  // 自建的商店：接哪些材料類型看商店的設定
  const custom = isCustomShopId(cell) ? shopRules.types[cell] : undefined
  if (custom) return (custom.craft ?? []) as MaterialKind[]
  return (Object.keys(CRAFT_SHOP) as MaterialKind[]).filter((k) => CRAFT_SHOP[k] === cell)
}

export function canCraftHere(state: GameState): boolean {
  return craftKindsHere(state).length > 0
}

export interface AuxItem { name: string; qty: number }

/**
 * 打造的 target：「底材:材料」，有輔料時接上「|名稱*數量」，例如 longsword:steel|火蜥鱗片*2|熔岩核心*1。
 */
export function parseCraftTarget(target?: string): { base: string; material: string; aux: AuxItem[] } {
  const [head, ...rest] = (target ?? '').split('|')
  const [base, material] = (head ?? '').split(':')
  if (!base || !material || !gearRules.bases[base] || !gearRules.materials[material]) throw new Error('請選擇要打造的裝備與材料')
  if (gearRules.bases[base]!.kind !== gearRules.materials[material]!.kind) throw new Error('這種材料不能拿來做這件裝備')
  if (gearRules.bases[base]!.restraint || gearRules.bases[base]!.exclusive) throw new Error(`${gearRules.bases[base]!.name}不能打造`)
  const aux = rest.map((x) => {
    const i = x.lastIndexOf('*')
    return { name: i >= 0 ? x.slice(0, i) : x, qty: Math.max(1, Math.round(Number(i >= 0 ? x.slice(i + 1) : 1)) || 1) }
  }).filter((a) => a.name)
  return { base, material, aux }
}

export function craftTarget(base: string, material: string, aux: AuxItem[] = []): string {
  return [`${base}:${material}`, ...aux.filter((a) => a.qty > 0).map((a) => `${a.name}*${a.qty}`)].join('|')
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
export function craftPlan(state: GameState, base: string, material: string, aux: AuxItem[] = [], crafter?: Character): CraftPlan {
  const r = craftRules()
  const m = gearRules.materials[material]!
  const tier = m.tier
  const craft = craftForKind(m.kind)
  const units = tier === 1 ? 0 : unitsFor(base)
  const owned = state.inventory
    .filter((i) => forgeOf(i.name).includes(material))
    .sort((a, b) => (itemDef(a.name)?.price_cc ?? 0) - (itemDef(b.name)?.price_cc ?? 0))
  const have = owned.reduce((s, i) => s + i.qty, 0)
  const uses: { name: string; qty: number }[] = []
  let need = units
  for (const i of owned) {
    if (need <= 0) break
    const q = Math.min(i.qty, need)
    uses.push({ name: i.name, qty: q })
    need -= q
  }
  const mult = locationMult(state)
  const loc = locationById(state.location)
  // 委託：店主的工藝等級決定做得了幾級的材料；自己動手：做的人的等級與工具
  const self = crafter ? selfCost(state, base, tier, craft, mult) : undefined
  const fee = self ? self.materialCost + self.rent : Math.round(gearRules.bases[base]!.price * r.fee[tier - 1]! * mult)
  const shop = craftShop(state, m.kind)
  const level = crafter ? skillOf(crafter, craft).level : keeperCraftLevel(npcRecord(state, keeperId(state, shop)) ?? { id: keeperId(state, shop) }, craft, loc.type)
  // 輔料：只能是材料，數量要扣掉當作打造材料用掉的
  const a = r.aux
  const auxBlocked: string[] = []
  if (aux.length > a.max_kinds) auxBlocked.push(`輔料最多 ${a.max_kinds} 種`)
  for (const x of aux) {
    const owned = (state.inventory.find((i) => i.name === x.name)?.qty ?? 0) - (uses.find((u) => u.name === x.name)?.qty ?? 0)
    if (itemDef(x.name)?.category !== 'material') auxBlocked.push(`${x.name}不是材料，不能當輔料`)
    else if (x.qty > a.max_qty) auxBlocked.push(`每種輔料最多 ${a.max_qty} 個`)
    else if (owned < x.qty) auxBlocked.push(`${x.name}不夠（還有 ${Math.max(0, owned)} 個）`)
  }
  const auxValue = aux.reduce((sum, x) => sum + (itemDef(x.name)?.price_cc ?? 0) * x.qty, 0)
  const plain = gearRules.bases[base]!.price * m.price
  const auxChance = Math.round(Math.min(a.max_chance, (auxValue / Math.max(1, plain)) * a.chance_per_value) * 100) / 100
  // 不能打造的原因全部列出來，不用改一項才發現下一項
  const blockers: string[] = []
  if (level < tier) {
    blockers.push(crafter
      ? `${crafter.name}的${craftName(craft)}只有 Lv.${level}，處理不了${m.name}（要 Lv.${tier}）`
      : `${loc.name}的工匠（${craftName(craft)} Lv.${level}）處理不了${m.name}（要 Lv.${tier}）`)
  }
  if (self && self.tool.tier < toolTierFor(tier)) blockers.push(`${m.name}${toolBlocker(craft, toolTierFor(tier), self.tool)}`)
  if (have < units) blockers.push(`打造材料不夠（需要 ${units} 份能做成${m.name}的材料，持有 ${have} 份）`)
  if (state.money_cc < fee) blockers.push(`${crafter ? '材料費與租金' : '工錢'}不夠（需要 ${formatMoney(fee)}）`)
  blockers.push(...auxBlocked)
  return {
    base, material, tier, units, uses, have, fee, dc: r.dc[tier - 1]!, aux, auxValue, auxChance, elements: auxElements(aux),
    craft, level,
    ...(crafter && self ? { crafter: crafter.id, tool: self.tool, materialCost: self.materialCost, rent: self.rent } : {}),
    blockers, ...(blockers.length ? { blocked: blockers.join('；') } : {}),
  }
}

/** 自己動手的花費：第一級材料自己買；工具要在店裡租時付租金 */
function selfCost(state: GameState, base: string, tier: number, craft: CraftId, mult: number) {
  const tool = toolAccess(state, craft, toolTierFor(tier))
  const materialCost = tier === 1 ? Math.round(gearRules.bases[base]!.price * craftSkillRules.self.tier1_cost_ratio * mult) : 0
  const rent = tool.rentPerHour && tool.tier >= toolTierFor(tier) ? tool.rentPerHour * craftSkillRules.self.hours : 0
  return { tool, materialCost, rent }
}

/** 委託打造找哪家店的店主：站在接這種材料的自建商店時是這家店，否則是內建的店 */
function craftShop(state: GameState, kind: MaterialKind): string {
  const cell = currentCell(state).kind
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
  const { base, material, aux } = parseCraftTarget(target)
  const kind = gearRules.bases[base]!.kind
  if (!craftKindsHere(state).includes(kind)) throw new Error(`${gearRules.bases[base]!.name}要到${CELL_NAME[CRAFT_SHOP[kind]]}打造`)
  const plan = craftPlan(state, base, material, aux)
  if (plan.blocked) throw new Error(plan.blocked)
  const name = gearName({ base, material })
  const at = (d: Degree) => rarityName(craftRarity(material, d)!)
  const used = plan.uses.map((u) => `${u.name}×${u.qty}`).join('、')
  const auxText = aux.map((x) => `${x.name}×${x.qty}`).join('、')
  // 工匠的手藝比需要的高：做得更好
  const skill = plan.level - plan.tier
  return {
    attr: craftRules().attr, dc: plan.dc, hours: craftRules().hours,
    situational: skill > 0 ? [{ label: `工匠的手藝（${craftName(plan.craft)} Lv.${plan.level}）`, value: skill }] : [],
    scene: `${locationById(state.location).name}・委託打造${name}（工錢 ${formatMoney(plan.fee)}${used ? `，材料 ${used}` : ''}${auxText ? `，輔料 ${auxText}（${Math.round(plan.auxChance * 100)}% 機率品質再高一級）` : ''}）`,
    targetName: name,
    outcomes: {
      critical: `做出${at('critical')}品質的${name}，附魔 ${rarityPoints(craftRarity(material, 'critical')!)} 點`,
      success: `做出${at('success')}品質的${name}，附魔 ${rarityPoints(craftRarity(material, 'success')!)} 點`,
      partial: `做出普通的${name}（沒有附魔）`,
      fail: `沒做成，材料損失一半，工錢照付`,
      fumble: '搞砸了，材料全部損失，工錢照付',
    } as Partial<Record<Degree, string>>,
  }
}

/**
 * 結算打造：付工錢、用掉材料，依成功程度做出裝備。gear 是 AI 提出的成品（名稱、描述、附魔），
 * 底材與材料固定為委託的內容，稀有度與附魔點數依成功程度夾住。
 */
export function applyCraft(state: GameState, report: Report, target: string, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>): string {
  const { base, material, aux } = parseCraftTarget(target)
  return finishCraft(state, report, craftPlan(state, base, material, aux), degree, gear)
}

function finishCraft(state: GameState, report: Report, plan: CraftPlan, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>): string {
  const { base, material, aux } = plan
  const paid = plan.crafter ? `花了 ${formatMoney(plan.fee)}（${[plan.materialCost ? '材料費' : '', plan.rent ? '工坊租金' : ''].filter(Boolean).join('、')}）` : `付了 ${formatMoney(plan.fee)} 工錢`
  // 輔料：成功程度有做出東西時擲一次，擲中就再高一級
  const boosted = plan.auxChance > 0 && !!craftRarity(material, degree) && withRng(state, (rng) => rng.chance(plan.auxChance))
  const rarity = craftRarity(material, degree, boosted)
  const lost = rarity ? plan.units : degree === 'fail' ? Math.ceil(plan.units * craftRules().lost_on_fail) : plan.units
  const effects: RewardEffect[] = plan.fee ? [{ type: 'money', amount: -plan.fee }] : []
  let left = lost
  for (const u of plan.uses) {
    if (left <= 0) break
    const q = Math.min(u.qty, left)
    effects.push({ type: 'item', name: u.name, qty: -q })
    left -= q
  }
  // 輔料不論結果都會用掉
  for (const x of aux) effects.push({ type: 'item', name: x.name, qty: -x.qty })
  applyEffects(state, report, effects)
  if (!rarity) return `${plan.fee ? `${paid}，但` : ''}${degree === 'fail' ? '沒做成' : '搞砸了'}${lost ? `，損失了 ${lost} 份材料` : ''}。`
  let spec: GearSpec
  const plainPiece = degree === 'partial' && !boosted
  if (gear) {
    spec = sanitizeGearSpec({ ...gear.spec, rarity }, { maxLevel: 99, maxRarity: rarity, base, material })!
    if (plainPiece) delete spec.enchants
  } else {
    spec = { base, material, ...(rarity !== gearRules.materials[material]!.rarity ? { rarity } : {}) }
    const points = plainPiece ? 0 : rarityPoints(rarity)
    const enchants = points ? withRng(state, (rng) => rollEnchants(base, points, rng, plan.elements)) : undefined
    if (enchants) spec.enchants = enchants
  }
  const name = registerGear(state, spec, gear?.name, gear?.desc)
  applyEffects(state, report, [{ type: 'item', name, qty: 1 }])
  return `${plan.fee ? `${paid}，` : ''}打造出【${name}】。${boosted ? '輔料讓成品的品質更上一層。' : ''}`
}

// ---- 自己動手（行動 make，見 crafting.ts） ----

/** 自己動手的 target：「做的人的 id@底材:材料|輔料…」 */
export function makeTarget(crafter: string, base: string, material: string, aux: AuxItem[] = []): string {
  return `${crafter}@${craftTarget(base, material, aux)}`
}

/** 打造的部分（去掉「做的人@」） */
export function craftPart(target?: string): string | undefined {
  const at = (target ?? '').indexOf('@')
  return at > 0 ? target!.slice(at + 1) : target
}

export function parseMakeTarget(state: GameState, target?: string): { crafter: Character; base: string; material: string; aux: AuxItem[] } {
  const at = (target ?? '').indexOf('@')
  const id = at > 0 ? target!.slice(0, at) : 'pc'
  const crafter = memberOrResident(state, currentArea(state), id)
  if (!crafter) throw new Error('隊伍中（或家裡）沒有這位角色')
  return { crafter, ...parseCraftTarget(at > 0 ? target!.slice(at + 1) : target) }
}

export function setupMake(state: GameState, target?: string) {
  const { crafter, base, material, aux } = parseMakeTarget(state, target)
  const refusal = crafterRefusal(state, crafter)
  if (refusal) throw new Error(`${crafter.name}不肯動手：${refusal}`)
  const plan = craftPlan(state, base, material, aux, crafter)
  if (plan.blocked) throw new Error(plan.blocked)
  const name = gearName({ base, material })
  const skill = craftSkillRules.skills[plan.craft]
  const at = (d: Degree) => rarityName(craftRarity(material, d)!)
  const used = plan.uses.map((u) => `${u.name}×${u.qty}`).join('、')
  const auxText = aux.map((x) => `${x.name}×${x.qty}`).join('、')
  return {
    actor: crafter.id,
    attr: skill.attr, dc: plan.dc, hours: craftSkillRules.self.hours,
    situational: [{ label: `${crafter.name}的${skill.name}（Lv.${plan.level}）`, value: plan.level * craftSkillRules.level_bonus }],
    scene: `${locationById(state.location).name}・${crafter.isPlayer ? '親手' : `由${crafter.name}`}打造${name}（${plan.tool!.source}${plan.fee ? `，花費 ${formatMoney(plan.fee)}` : ''}${used ? `，材料 ${used}` : ''}${auxText ? `，輔料 ${auxText}（${Math.round(plan.auxChance * 100)}% 機率品質再高一級）` : ''}）`,
    targetName: name,
    outcomes: {
      critical: `做出${at('critical')}品質的${name}，附魔 ${rarityPoints(craftRarity(material, 'critical')!)} 點`,
      success: `做出${at('success')}品質的${name}，附魔 ${rarityPoints(craftRarity(material, 'success')!)} 點`,
      partial: `做出普通的${name}（沒有附魔）`,
      fail: `沒做成，材料損失一半${plan.fee ? '，花費照付' : ''}`,
      fumble: `搞砸了，材料全部損失${plan.fee ? '，花費照付' : ''}`,
    } as Partial<Record<Degree, string>>,
  }
}

/** 結算自己動手：和委託一樣做出裝備，再給做的人工藝經驗 */
export function applyMake(state: GameState, report: Report, target: string, degree: Degree, gear?: Extract<RewardEffect, { type: 'gear' }>): string {
  const { crafter, base, material, aux } = parseMakeTarget(state, target)
  const plan = craftPlan(state, base, material, aux, crafter)
  const text = finishCraft(state, report, plan, degree, gear)
  const xp = craftXpFor(plan.tier, degree)
  if (!xp) return text
  const level = gainCraftXp(crafter, plan.craft, xp)
  ;(report.changes.craft_xp ??= []).push({ actor: crafter.id, craft: plan.craft, amount: xp, ...(level ? { level } : {}) })
  return `${text}${crafter.name}的${craftName(plan.craft)}經驗 +${xp}${level ? `，升到 Lv.${level}` : ''}。`
}
