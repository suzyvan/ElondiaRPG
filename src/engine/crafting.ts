// 工藝（data/rules/crafts.json，見 docs/CRAFTING.md）：鍛造、木工、製革、裁縫、珠寶、煉金、烹飪七種，各自有等級與經驗。
// - 等級 N 可以處理第 N 級以下的材料；店主的等級依聚落規模。
// - 自己動手（行動 make）要有對應階級的工具：低階隨身工具組（任何地方）、中階工坊（旅店、安全房展開攜帶式工坊，或在店裡租）、
//   高階工作台（擺在自己房子裡的工作台家具，見 docs/HOMES.md）。
// - 夥伴：自願加入而且親密度夠、或奴隸才肯幫忙；雇傭的不幫忙。

import { craftRules, CRAFT_IDS, itemDef, itemRules, locationById, npcTags, type CraftId, type Degree } from './data'
import { gearRules, type MaterialKind } from './gear'
import { cellName, currentArea, currentCell } from './grid'
import { homeOfArea, residentsHere, workbenchFor } from './homes'
import { inventoryHere } from './storage'
import type { Character, CraftSkill, GameState, NpcRecord } from './types'
import { contractOf } from './tattoos'

export { CRAFT_IDS }

export function craftName(id: CraftId): string {
  return craftRules.skills[id].name
}

/** 處理這種材料的工藝 */
export function craftForKind(kind: MaterialKind | string): CraftId {
  return CRAFT_IDS.find((id) => craftRules.skills[id].kinds.includes(kind)) ?? 'smithing'
}

/** 工匠身分的開局等級 */
export const CRAFTER_START_LEVEL = 2

/**
 * 新角色、新加入的同伴的工藝（docs/CRAFTING.md 1.1 節）：全部 0 級，工匠身分那一門 Lv.2；
 * 已經有的（例如 NPC 登錄上的）照舊
 */
export function startCrafts(tags: string[] | undefined, have?: Partial<Record<CraftId, CraftSkill>>): Partial<Record<CraftId, CraftSkill>> {
  const out: Partial<Record<CraftId, CraftSkill>> = Object.fromEntries(CRAFT_IDS.map((id) => [id, { level: 0, xp: 0 }]))
  for (const t of tags ?? []) {
    const def = npcTags.tags[t]
    if (def?.group !== 'craft') continue
    for (const id of [def.craft, ...(def.also_crafts ?? [])]) if (id && CRAFT_IDS.includes(id)) out[id] = { level: CRAFTER_START_LEVEL, xp: 0 }
  }
  return { ...out, ...(have ?? {}) }
}

/** 角色的某種工藝（舊存檔裡沒有工藝資料的角色算 1 級；新角色開局就有 0 級的資料） */
export function skillOf(c: Pick<Character, 'crafts'>, id: CraftId): CraftSkill {
  return c.crafts?.[id] ?? { level: 1, xp: 0 }
}

/** 升到下一級需要的經驗（已經滿級時 undefined） */
export function xpToNext(level: number): number | undefined {
  return level >= craftRules.max_level ? undefined : craftRules.xp_to_next[level - 1]
}

/** 這次製作得到的經驗：材料等級 × 成功程度的倍數 */
export function craftXpFor(tier: number, degree: Degree): number {
  return tier * (craftRules.xp[degree] ?? 0)
}

/** 加經驗（可能升級）；回傳升到的等級（沒升級時 undefined） */
export function gainCraftXp(c: Character, id: CraftId, amount: number): number | undefined {
  if (amount <= 0) return undefined
  const s = { ...skillOf(c, id) }
  s.xp += amount
  let leveled: number | undefined
  for (let need = xpToNext(s.level); need !== undefined && s.xp >= need; need = xpToNext(s.level)) {
    s.xp -= need
    s.level += 1
    leveled = s.level
  }
  if (s.level >= craftRules.max_level) s.xp = 0
  c.crafts = { ...c.crafts, [id]: s }
  return leveled
}

// ---- 店主 ----

/** 這間店的店主（keeper_地點_店）處理的工藝 */
export function shopCrafts(shop: string): CraftId[] {
  return CRAFT_IDS.filter((id) => craftRules.skills[id].shop === shop)
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

/** 店主的工藝等級：記在 NPC 登錄上的優先，沒有時依聚落規模與店主 id 決定（同一位店主一直一樣） */
export function keeperCraftLevel(rec: Pick<NpcRecord, 'id' | 'crafts'>, id: CraftId, locationType: string): number {
  const saved = rec.crafts?.[id]?.level
  if (saved) return saved
  const [lo, hi] = craftRules.shop_levels[locationType] ?? [1, 2]
  return lo + (hash(`${rec.id}:${id}`) % (hi - lo + 1))
}

/** 開店中的店主、公會職員：不能邀請入隊 */
export function isShopStaff(rec: Pick<NpcRecord, 'id'>): boolean {
  return /^(keeper|clerk)_/.test(rec.id)
}

// ---- 誰可以動手 ----

/** 這位隊員願不願意幫忙製作（不願意時回傳原因） */
export function crafterRefusal(state: GameState, m: Character): string | undefined {
  if (m.isPlayer) return undefined
  if (m.hp <= 0) return '倒下了'
  if (m.status.includes('away')) return '暫時離隊'
  if (m.bond === 'slave') return contractOf(m)?.master === 'pc' ? undefined : '不是你的奴隸'
  if (m.bond !== 'voluntary') return m.bond === 'hired' ? '雇傭的夥伴不幫忙做工藝' : '不是你的夥伴'
  if ((m.affinity ?? 0) < craftRules.companion.min_affinity) return `親密度要 ${craftRules.companion.min_affinity} 以上`
  return undefined
}

/** 誰可以動手：隊員，在自己的房子裡時加上留守的夥伴 */
export function crafters(state: GameState): { member: Character; refusal?: string }[] {
  return [...state.party, ...residentsHere(state, currentArea(state))].map((m) => {
    const refusal = crafterRefusal(state, m)
    return { member: m, ...(refusal ? { refusal } : {}) }
  })
}

// ---- 工具 ----

/** 材料等級需要的工具階級（1 低階、2 中階、3 高階） */
export function toolTierFor(materialTier: number): number {
  return craftRules.tool_tier[materialTier - 1] ?? 3
}

export interface ToolAccess {
  /** 這裡能用的最高工具階級（0 = 沒有工具） */
  tier: number
  /** 說明（用哪件工具、在哪裡） */
  source: string
  /** 要在店裡租工坊才有這個階級：每小時的租金 */
  rentPerHour?: number
}

/** 在安全的地方（旅店、安全房）：可以展開攜帶式工坊 */
export function atSafePoint(state: GameState): boolean {
  return craftRules.safe_points.includes(currentCell(state).kind) || currentArea(state).kind === 'home'
}

/**
 * 這裡做這種工藝能用的工具。need：要做的東西需要的工具階級；
 * 自己的工具不夠 need 時，站在對應的店才改成租用店裡的工坊（自己的工具夠用就不收租金）
 */
export function toolAccess(state: GameState, id: CraftId, need = 2): ToolAccess {
  let best: ToolAccess = { tier: 0, source: '沒有工具' }
  // 工具：行囊裡的，加上在自己家裡時箱子裡的
  for (const i of inventoryHere(state)) {
    const t = itemDef(i.name)?.tool
    if (i.qty <= 0 || t?.kind !== 'craft' || t.craft !== id) continue
    // 攜帶式工坊：在旅店、安全房才展開得了，其他地方當作隨身工具用
    const tier = t.tier === 2 && !atSafePoint(state) ? 1 : (t.tier ?? 1)
    if (tier > best.tier) best = { tier, source: tier === 2 ? `展開${i.name}` : i.name }
  }
  // 在對應的店：自己的工具不夠時可以租用店裡的工坊（中階）
  if (best.tier < Math.min(need, 2) && currentCell(state).kind === craftRules.skills[id].shop) {
    best = { tier: 2, source: '租用店裡的工坊', rentPerHour: craftRules.workshop_rent.per_hour_cc }
  }
  // 自己的房子：攜帶式工坊可以展開；有這種工藝的高階工作台時是高階
  const home = homeOfArea(state, currentArea(state))
  if (home) {
    const bench = workbenchFor(home, id)
    if (bench) best = { tier: 3, source: `家裡的${bench}` }
  }
  return best
}

export function toolTierName(tier: number): string {
  return craftRules.tool_tier_names[tier - 1] ?? '沒有工具'
}

/** 可以租這種工藝工坊的店（格子名稱，例如鐵匠鋪） */
export function rentShopName(id: CraftId): string {
  return cellName(craftRules.skills[id].shop as Parameters<typeof cellName>[0])
}

/** 這種工藝的某個工具階級去哪裡取得（卡住的訊息與「?」說明用） */
export function toolWhere(id: CraftId, tier: number): string {
  const named = (t: number) => itemRules.items.find((d) => d.tool?.kind === 'craft' && d.tool.craft === id && (d.tool.tier ?? 1) === t)?.name
  const rent = `到${rentShopName(id)}租用工坊（每小時 ${craftRules.workshop_rent.per_hour_cc} 白鸛）`
  if (tier <= 1) return named(1) ? `帶著${named(1)}（任何地方都能用），或${rent}` : rent
  if (tier === 2) return named(2) ? `${rent}，或在旅店、安全房、自己的房子展開${named(2)}` : rent
  const bench = itemRules.items.find((d) => d.furniture?.function === 'workbench' && d.furniture.craft === id)?.name
  return `在自己的房子裡擺${bench ?? `${craftName(id)}的高階工作台`}`
}

/** 工具不夠時的訊息：要什麼工具、現在用的是什麼、去哪裡取得 */
export function toolBlocker(id: CraftId, need: number, tool: ToolAccess): string {
  return `要用${craftName(id)}的${toolTierName(need)}（現在：${tool.source}）：${toolWhere(id, need)}`
}
