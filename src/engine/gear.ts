// 裝備：16 個欄位、底材 × 材料、稀有度與附魔（data/rules/gear.json）。
//
// - 一件裝備的數值由組成（GearSpec）推算：底材決定欄位、武器或防具類型與固定數值，材料的 bonus 依 scale 成長，
//   附魔在稀有度的點數內加減。制式裝備（items.json）、打造與事件生成的裝備（customItems）都用同一套公式。
// - 穿在身上的裝備自帶組成（EquippedGear），計算數值不需要存檔。
// - 角色的 weapon / armor 由主手與上身的裝備決定（syncGear），戰鬥沿用原本的武器與防具計算；
//   其餘欄位與材料、附魔的加成合計成 mods / resist / offense（gearBonuses）。

import gearJson from '@data/rules/gear.json'
import {
  armorDef, attrName, className, raceName, damageTypeName, damageTypes, DUNGEON_LAYER_IDS, dungeonEncounters, enemies, equipment, geography, itemDef, itemRules, lewdRules, weaponDef, wildEncounters, mulResist,
  type AffinityMap, type AttrId, type BindKind, type EncounterGroup, type LockGrade, type Mods, type WeaponDef,
} from './data'
import { itemKey, itemLabel, sameShape } from './itemKey'
import { bindTip } from './bindRulesMods'
import { describeEffects } from './perks'
import { Rng } from './rng'
import type { Character, EquippedGear, GameState, GearSlot, GearSpec, LewdStat } from './types'

type Scale = 'full' | 'half' | 'up' | 'third' | 'third_up' | 'quarter' | 'quarter_up' | 'res'
export type MaterialKind = 'metal' | 'leather' | 'cloth' | 'wood' | 'jewel'

export interface MaterialDef {
  kind: MaterialKind
  name: string
  tier: number
  bonus: number
  rarity: string
  level: number
  price: number
  armor?: Mods
  resist?: AffinityMap
  desc?: string
  /** 材料的系列（第 6、7 級有 history 歷史、pleasure 歡愉兩套）：同一級有好幾種時，隨機裝備優先用地點的 material_series 那一套，沒有指定時用排在前面的 */
  series?: string
}

/** 底材放的位置：一個欄位，或一組欄位（ring 兩個戒指、piercing 兩個穿孔飾品，見 gear.json 的 slot_groups） */
export type BaseSlot = GearSlot | 'ring' | 'piercing'

export type VacuumSide = 'top' | 'bottom'
export const VACUUM_SIDES: VacuumSide[] = ['top', 'bottom']

export interface BaseDef {
  slot: BaseSlot
  /** 打造時的類型（刀劍、鎚斧、盾……）；沒寫時依欄位與材料推（baseType） */
  type?: string
  name: string
  kind: MaterialKind
  weapon?: string
  armor?: string
  two_handed?: boolean
  price: number
  stats?: Mods
  threat?: number
  scale?: Partial<Record<keyof Mods, Scale>>
  resist_scale?: Record<string, Scale>
  desc?: string
  /** 束縛用的底材（主人強制裝備的項圈、鐐銬）：沒有加成，不能打造，不會出現在寶箱、掉落、建角與 AI 生成的裝備裡 */
  restraint?: boolean
  /** 地下城專屬的底材（例如歷史裂縫的錯時刃）：只靠層主掉落取得，不能打造，不會出現在寶箱、商店、建角與 AI 生成的裝備裡（docs/ITEMS.md 第 4.5 節） */
  exclusive?: boolean
  /** 玩家在世界裡上傳的圖示（data URL，見 itemIcons.ts）；沒有時用內建的底材圖 */
  icon?: string
  /** 服裝（regular 常規、anime 二次元、adult 成人向）：不出現在寶箱與掉落的隨機裝備；裁縫店每天另外上架 */
  outfit?: OutfitKind
  /** 成人向的底材：內容編輯器的篩選用 */
  adult?: boolean
  /** 蟲寵（苗床生下、留下來的幼體）：只有修了獸蟲派的人能帶著，也能放在額外飾品欄（docs/FAMILY.md 第 13 節） */
  pet?: boolean
  /** 種族限定的底材（例如人馬族的蹄鐵、馬衣）：只有這些種族能穿 */
  races?: string[]
  /**
   * 種族版本：限定穿著（任務點、地標場景與身分的 wear）寫的是這個底材（或它的物品）時，穿這件也算。
   * 例如人馬族的「乳牛花紋馬衣」當作「乳牛比基尼下著」（worldgen/scripts/elondia/park_outfits49.py）
   */
  wear_as?: string
  /** 曝露度 0～3（慾望指標的曝露名聲用）；沒寫時依服裝種類（lewd.json 的 gear.outfit） */
  exposure?: number
  /** 真空會走光的一側（曝露度 0 也算，例如裙子、薄襯衫）：底下沒穿內衣（top）或內褲（bottom）時那一側曝露度 +1。曝露度 1 以上的不用寫 */
  vacuum?: VacuumSide[]
  /** 上衣類（襯衫、水手服……，只放上身）：沒穿下身時不算遮住下身，下身看內褲（docs/LEWD_STATS.md 第 3 節） */
  top_only?: boolean
  /** 雙面效應（lewd.json 的 two_face）：拘束的程度 1～3 與種類；平常是檢定減值，修了流派、鎖上時戰鬥中反轉成增益 */
  bind?: number
  bind_kind?: BindKind
}

export type OutfitKind = 'regular' | 'anime' | 'adult'
export const OUTFIT_KINDS: Record<OutfitKind, string> = { regular: '常規服裝', anime: '二次元服裝', adult: '成人向服裝' }

const LEWD_STAT_IDS: LewdStat[] = ['lewdness', 'sensitivity', 'endurance', 'submission']

/**
 * 拘束具放在額外飾品欄：好處不算（附魔、材料特性、屬性與檢定的加值），
 * 扣分、慾望指標（底材的預設與物品寫的）、拘束與雙面效應照算（docs/ITEMS.md 第 2 節）
 */
export function bonusesOff(slot: string, spec: GearSpec): boolean {
  return isExtraSlot(slot as GearSlot) && !!gearRules.bases[spec.base]?.restraint
}
/** 只留負的（扣分） */
export function onlyNegative<T extends object>(m: T | undefined): T {
  return Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => typeof v === 'number' && v < 0)) as T
}

/** 一件裝備的慾望指標加值：底材的預設（成人向服裝、束縛用的底材）加上物品寫的（含打造時加的），每項 ±item_cap；放在哪一格都照算 */
export function gearLewdOf(spec: GearSpec): Partial<Record<LewdStat, number>> {
  const base = gearRules.bases[spec.base]
  const out: Partial<Record<LewdStat, number>> = {}
  const add = (b?: Partial<Record<LewdStat, number>>) => {
    for (const k of LEWD_STAT_IDS) if (b?.[k]) out[k] = (out[k] ?? 0) + b[k]!
  }
  if (base?.outfit) add(lewdRules.gear.outfit[base.outfit]?.lewd)
  if (base?.restraint) add(lewdRules.gear.restraint.lewd)
  add(spec.lewd)
  const cap = lewdRules.gear.item_cap
  for (const k of LEWD_STAT_IDS) if (out[k] !== undefined) out[k] = Math.max(-cap, Math.min(cap, out[k]!))
  return out
}

/** 這個底材存在（自訂內容可能刪掉了） */
export function baseShown(id: string): boolean {
  return !!gearRules.bases[id]
}

// ---- 打造時的分類：部位 → 類型 → 底材（docs/CRAFTING.md） ----

export const MATERIAL_KIND_NAME: Record<MaterialKind, string> = { metal: '金屬', leather: '皮革', cloth: '布', wood: '木', jewel: '寶石' }

/** 部位的順序（照裝備欄由上到下；戒指、穿孔飾品是一組欄位） */
export const CRAFT_SLOT_ORDER: BaseSlot[] = ['main_hand', 'off_hand', 'head', 'body', 'wrists', 'belt', 'legs', 'feet', 'accessory', 'ring', 'piercing', 'leg_accessory', 'underwear_top', 'underwear_bottom'] as BaseSlot[]

/** 類型的順序（沒列到的排在最後） */
export const BASE_TYPE_ORDER = [
  '刀劍', '鎚斧', '長柄', '弓弩', '法杖', '鞭', '其他武器', '盾', '副手武器', '法器', '其他副手',
  '金屬護甲', '皮革護甲', '布護甲', '木護甲', '布衣物', '皮革衣物', '金屬衣物', '木衣物', '飾品', '寶石衣物', '成人向服裝', '拘束具',
]

/** 底材的類型：寫了 type 就用它；否則主手、副手是「其他」，拘束具一類，成人向服裝一類，有護甲數值的是護甲，寶石是飾品，其他照材料是衣物 */
export function baseType(id: string): string {
  const b = gearRules.bases[id]
  if (!b) return '其他'
  return b.type || defaultBaseType(b)
}

/** 沒寫 type 時的類型（世界編輯器的提示也用） */
export function defaultBaseType(b: Pick<BaseDef, 'slot' | 'adult' | 'outfit' | 'armor' | 'stats' | 'kind'> & Partial<Pick<BaseDef, 'restraint'>> & { armorDef?: unknown }): string {
  if (b.slot === 'main_hand') return '其他武器'
  if (b.slot === 'off_hand') return '其他副手'
  if (b.restraint) return '拘束具'
  if (b.adult || b.outfit === 'adult') return '成人向服裝'
  if (b.armor || b.armorDef || b.stats?.dr) return `${MATERIAL_KIND_NAME[b.kind]}護甲`
  if (b.kind === 'jewel') return '飾品'
  return `${MATERIAL_KIND_NAME[b.kind]}衣物`
}

/** 依 BASE_TYPE_ORDER 排類型 */
export function sortBaseTypes(types: Iterable<string>): string[] {
  const order = (t: string) => {
    const i = BASE_TYPE_ORDER.indexOf(t)
    return i < 0 ? BASE_TYPE_ORDER.length : i
  }
  return [...new Set(types)].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
}

/** 可以打造、隨機生成的底材（不含束縛用的、地下城專屬的） */
export function ordinaryBases(): string[] {
  return Object.entries(gearRules.bases).filter(([id, b]) => !b.restraint && !b.exclusive && baseShown(id)).map(([id]) => id)
}

/** 寶箱與掉落的隨機裝備用的底材（再去掉服裝） */
export function randomBases(): string[] {
  return ordinaryBases().filter((id) => !gearRules.bases[id]!.outfit)
}

export interface ClassGearTemplate {
  start: Partial<Record<GearSlot, string>>
  main: string[]
  off: string[]
  body: string[]
  pieces: MaterialKind
  /** 存檔規則「職業武器限制」打開時，主手能拿的武器類型（底材的 type）；空陣列＝只能空手，沒寫＝不限（docs/ITEMS.md 第 2.2 節） */
  weapons?: string[]
}

/** 種族的裝備模板（gear.json 的 races） */
export interface RaceGear {
  /** 封住的欄位（不能放任何東西） */
  blocked: GearSlot[]
  /** 這些欄位只能放限定這個種族的底材（人馬族的下身、鞋子、後蹄、腿部飾品）；這些位置的一般底材，也不能塞進額外飾品欄 */
  restricted?: GearSlot[]
  /** 改名的欄位：name 是顯示的名字，as 是改收哪一種位置的底材（人馬族的內褲那一格是「後蹄」，收鞋子類的） */
  relabel?: Partial<Record<GearSlot, { name: string; as: BaseSlot }>>
}

export const gearRules = gearJson as unknown as {
  slots: Record<GearSlot, string>
  slot_groups: Record<string, GearSlot[]>
  rarities: Record<string, { name: string; enchant_points: number }>
  enchant_costs: Record<string, number>
  materials: Record<string, MaterialDef>
  bases: Record<string, BaseDef>
  classes: Record<string, ClassGearTemplate>
  races: Record<string, RaceGear>
  /** 依體型預設穿上的內衣、內褲（底材 id） */
  underwear_defaults: Record<'masc' | 'fem' | 'andro', Partial<Record<GearSlot, string>>>
  drops: {
    adventurer: { chance: number; max: number }
    armed: { chance: number; per_level: number; max_chance: number }
    bump: number
  }
  chests: Record<string, {
    money: [number, number]; gear: number; gear_extra?: number
    items: [string, number][]; forge: [number, number][]
  }>
  /** 高等地下城寶箱的打造材料：寶箱等級到 min_level 時取代那一層的 forge（R12） */
  chest_forge_high?: { bands: ({ min_level: number } & Partial<Record<string, [number, number][]>>)[] }
  craft: {
    hours: number; attr: AttrId; fee: number[]; dc: number[]
    units: Record<string, number>; lost_on_fail: number
    /** 一次打造幾件（打造材料、費用、時間、經驗乘件數，只擲一次） */
    max_count?: number
    aux: { max_kinds: number; max_qty: number; chance_per_value: number; max_chance: number; elements: Record<string, string[]> }
  }
  creation: { default_budget: number; max_budget: number; max_tier: number }
  attrs: { max_change: number; cap: number }
  loadout: {
    top: number; below: number; lower: number; legendary: number
    pieces_base: number; pieces_per_level: number
    jewelry_base: number; jewelry_per_level: number; jewelry_max: number
  }
}

export const SLOTS = Object.keys(gearRules.slots) as GearSlot[]
const PIECE_SLOTS: GearSlot[] = ['head', 'legs', 'wrists', 'feet', 'belt']
const JEWELRY: { slot: GearSlot; group: 'accessory' | 'ring' | 'piercing' | 'leg_accessory' }[] = [
  { slot: 'accessory', group: 'accessory' }, { slot: 'ring_1', group: 'ring' }, { slot: 'ring_2', group: 'ring' },
  { slot: 'piercing_1', group: 'piercing' }, { slot: 'piercing_2', group: 'piercing' }, { slot: 'leg_accessory', group: 'leg_accessory' },
]

/** 底材位置的名稱（一組欄位用第一個欄位的名稱，例如「戒指」「穿孔飾品」） */
export function baseSlotName(slot: BaseSlot): string {
  const group = gearRules.slot_groups[slot]
  return gearRules.slots[(group?.[0] ?? slot) as GearSlot] ?? slot
}

/** 額外飾品欄（docs/ITEMS.md 第 2 節）：首飾、戒指、穿孔飾品、腿部飾品，以及任何部位的拘束具都能放；最多 8 格，用幾格照存檔規則 extraSlots */
export const EXTRA_SLOTS: GearSlot[] = ['extra_1', 'extra_2', 'extra_3', 'extra_4', 'extra_5', 'extra_6', 'extra_7', 'extra_8']
/** 這個存檔開放幾格額外飾品欄（存檔規則 extraSlots；讀檔、開新遊戲、改規則時由 inventory.ts 的 enforceExtraSlots 設定） */
let extraCount = 2
export function setExtraSlotCount(n: number) {
  extraCount = Math.max(0, Math.min(EXTRA_SLOTS.length, Math.round(n)))
}
/** 目前開放的額外飾品欄 */
export function activeExtraSlots(): GearSlot[] {
  return EXTRA_SLOTS.slice(0, extraCount)
}
/** 這一格現在能不能用：額外飾品欄超過存檔規則的格數就不能用 */
export const slotOpen = (slot: GearSlot) => !isExtraSlot(slot) || activeExtraSlots().includes(slot)
/** 第一格額外飾品欄（NPC 的隨機裝備只放這一格） */
export const EXTRA_SLOT: GearSlot = 'extra_1'
export const isExtraSlot = (slot: GearSlot) => EXTRA_SLOTS.includes(slot)
const EXTRA_BASE_SLOTS: BaseSlot[] = ['accessory', 'ring', 'piercing', 'leg_accessory']

/** 這種底材能不能放進額外飾品欄 */
export function fitsExtra(base: Pick<BaseDef, 'slot' | 'restraint' | 'bind' | 'pet'> | undefined): boolean {
  return !!base && (EXTRA_BASE_SLOTS.includes(base.slot) || !!base.restraint || !!base.bind || !!base.pet)
}

/** 這種底材能不能放進這個欄位（額外飾品欄要傳底材，才看得出是不是拘束具） */
export function baseFits(baseSlot: BaseSlot, slot: GearSlot, base?: Pick<BaseDef, 'slot' | 'restraint' | 'bind'>): boolean {
  if (isExtraSlot(slot)) return fitsExtra(base ?? { slot: baseSlot })
  return baseSlot === slot || !!gearRules.slot_groups[baseSlot]?.includes(slot)
}

/** 底材可以選的位置（欄位，一組欄位用組名）與名稱：底材編輯器用 */
export function baseSlots(): Record<BaseSlot, string> {
  const grouped = new Set(Object.values(gearRules.slot_groups).flat())
  const out: Partial<Record<BaseSlot, string>> = {}
  for (const s of SLOTS) if (!grouped.has(s)) out[s] = gearRules.slots[s]
  for (const [g, list] of Object.entries(gearRules.slot_groups)) out[g as BaseSlot] = gearRules.slots[list[0]!]
  return out as Record<BaseSlot, string>
}

export function slotName(slot: GearSlot): string {
  return gearRules.slots[slot]
}

export function rarityName(r: string): string {
  return gearRules.rarities[r]?.name ?? r
}

/** 底材抗性（scale 的 res）的上限，和附魔的抗性上限一樣 */
export const RES_CAP = 0.5

function scaled(s: Scale, bonus: number): number {
  switch (s) {
    case 'full': return bonus
    case 'half': return Math.floor(bonus / 2)
    case 'up': return Math.ceil(bonus / 2)
    case 'third': return Math.floor(bonus / 3)
    case 'third_up': return Math.ceil(bonus / 3)
    case 'quarter': return Math.floor(bonus / 4)
    case 'quarter_up': return Math.ceil(bonus / 4)
    // 和附魔一樣最多 -0.5（第 5 級以上的寶石不再更高）
    case 'res': return -Math.min(RES_CAP, Math.round(0.15 * bonus * 100) / 100)
  }
}

export interface GearStats {
  slot: BaseSlot
  base: BaseDef
  material: MaterialDef
  rarity: string
  weapon?: string
  armor?: string
  two_handed: boolean
  mods: Mods
  resist: AffinityMap
  offense: AffinityMap
  threat: number
}

function addMods(into: Mods, from?: Mods) {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (!v) continue
    into[k as keyof Mods] = Math.round(((into[k as keyof Mods] ?? 0) + v) * 100) / 100
  }
}

function addMap(into: AffinityMap, from?: AffinityMap) {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (!v) continue
    into[k] = Math.round(((into[k] ?? 0) + v) * 100) / 100
  }
}

/** 底材與材料都還在（自訂內容可能刪掉了自建的底材或材料） */
export function gearKnown(spec: Pick<GearSpec, 'base' | 'material'> | undefined): spec is GearSpec {
  return !!spec && !!gearRules.bases[spec.base] && !!gearRules.materials[spec.material]
}

/** 一件裝備的數值（底材或材料不存在時丟錯；可能遇到失效裝備的地方先用 gearKnown 檢查） */
export function gearStats(spec: GearSpec): GearStats {
  const base = gearRules.bases[spec.base]
  const material = gearRules.materials[spec.material]
  if (!base) throw new Error(`unknown gear base: ${spec.base}`)
  if (!material) throw new Error(`unknown gear material: ${spec.material}`)
  const mods: Mods = {}
  const resist: AffinityMap = {}
  const offense: AffinityMap = {}
  addMods(mods, base.stats)
  for (const [k, s] of Object.entries(base.scale ?? {})) addMods(mods, { [k]: scaled(s as Scale, material.bonus) })
  for (const [k, s] of Object.entries(base.resist_scale ?? {})) mulResist(resist, { [k]: scaled(s, material.bonus) })
  // 材料本身的特性：防具才有（秘銀較輕、精金更硬）；材料的抗性（龍皮抗火）防具與飾品都有
  if (!base.weapon) {
    addMods(mods, material.armor)
    mulResist(resist, material.resist)
  }
  addMods(mods, spec.enchants?.mods)
  mulResist(resist, spec.enchants?.resist)
  addMap(offense, spec.enchants?.offense)
  const threat = (base.threat ?? 0) + (spec.enchants?.mods?.threat ?? 0)
  delete mods.threat
  return {
    slot: base.slot, base, material, rarity: spec.rarity ?? material.rarity,
    ...(base.weapon ? { weapon: base.weapon } : {}), ...(base.armor ? { armor: base.armor } : {}),
    two_handed: !!base.two_handed, mods, resist, offense, threat,
  }
}

/**
 * 制式名稱：材料＋底材（例如「秘銀長劍」）。皮製品避免重複：第一級的皮革只用底材名（皮甲、皮靴），
 * 其他皮料省掉底材開頭的「皮」（硬皮甲、龍皮靴）。
 */
export function gearName(spec: Pick<GearSpec, 'base' | 'material'>): string {
  const m = gearRules.materials[spec.material]
  const b = gearRules.bases[spec.base]?.name ?? spec.base
  if (!m) return b
  if (m.kind === 'leather' && b.startsWith('皮')) return m.tier === 1 ? b : `${m.name}${m.name.endsWith('皮') ? b.slice(1) : b}`
  return `${m.name}${b}`
}

/** 依組成估價：底材價格 × 材料倍率 × 附魔（每點 +50%） */
export function gearPrice(spec: GearSpec): number {
  const base = gearRules.bases[spec.base]
  const material = gearRules.materials[spec.material]
  if (!base || !material) return 0
  const points = enchantPoints(spec.enchants)
  return Math.round(base.price * material.price * (1 + 0.5 * points))
}

/** 收購價的上限是成本的幾倍（成本見 gearCost） */
export const SELL_COST_CAP = 10

/** 一份打造材料最便宜的價格（items.json 有 forge 的物品）；沒有物品做得成這種材料時是 undefined */
/** 這種打造材料最便宜的一份（目錄價）：裝備的成本、委託時工匠代備的材料費 */
export function forgeUnitPrice(material: string): number | undefined {
  let best: number | undefined
  for (const i of itemRules.items) {
    if (!i.forge?.materials.includes(material) || !i.price_cc) continue
    if (best === undefined || i.price_cc < best) best = i.price_cc
  }
  return best
}

/**
 * 一件裝備的成本：照委託打造算，工錢（底材價格 × craft.fee）＋打造材料（份數 × 最便宜的打造材料）。
 * 第一級材料便宜，只算工錢（委託時工匠代備的材料費忽略不計）。底材或材料不在目錄時回傳 undefined（不封頂）。
 */
export function gearCost(spec: Pick<GearSpec, 'base' | 'material'>): number | undefined {
  const base = gearRules.bases[spec.base]
  const material = gearRules.materials[spec.material]
  if (!base || !material) return undefined
  const craft = (gearRules as unknown as { craft: { fee: number[]; units: Record<string, number> } }).craft
  const fee = base.price * (craft.fee[material.tier - 1] ?? material.tier)
  if (material.tier <= 1) return fee
  const units = base.two_handed ? craft.units.two_handed ?? 3 : craft.units[base.slot] ?? 1
  return fee + units * (forgeUnitPrice(spec.material) ?? 0)
}

/** 賣出的價值上限（成本 × SELL_COST_CAP）；不是裝備或算不出成本時回傳 undefined */
export function gearSellCap(spec: Pick<GearSpec, 'base' | 'material'> | undefined): number | undefined {
  const cost = spec ? gearCost(spec) : undefined
  return cost === undefined ? undefined : cost * SELL_COST_CAP
}

/** 附魔用掉的點數（gear.json 的 enchant_costs） */
export function enchantPoints(e?: GearSpec['enchants']): number {
  if (!e) return 0
  const c = gearRules.enchant_costs
  let n = 0
  for (const [k, v] of Object.entries(e.mods ?? {})) n += k === 'threat' ? Math.abs(v ?? 0) / 0.1 * c.threat! : Math.abs(v ?? 0) * (c[k] ?? 1)
  for (const v of Object.values(e.resist ?? {})) n += Math.abs(v ?? 0) / 0.25 * c.resist!
  for (const v of Object.values(e.offense ?? {})) n += Math.abs(v ?? 0) / 0.25 * c.offense!
  return Math.round(n * 100) / 100
}

/** 物品名稱 → 裝備組成（目錄或打造、事件生成的物品） */
export function gearSpecOf(state: Pick<GameState, 'customItems'> | undefined, name: string): GearSpec | undefined {
  return itemDef(name)?.gear ?? state?.customItems?.[name]?.gear
}

/** 這件裝備可以放的欄位 */
export function slotsFor(spec: GearSpec, race?: string): GearSlot[] {
  if (!gearKnown(spec)) return []
  return baseSlotsFor(spec.base, race)
}

/**
 * 這種底材能放的欄位。給了種族時照種族的模板（gear.json 的 races）：種族限定的底材別的種族不能穿、
 * 封住的欄位不放、限定的欄位（restricted）只放自己種族的底材、改名的欄位（relabel）改收另一種位置的底材
 */
export function baseSlotsFor(baseId: string, race?: string): GearSlot[] {
  const base = gearRules.bases[baseId]
  if (!base) return []
  const slot = base.slot
  let own = [...(gearRules.slot_groups[slot] ?? [slot as GearSlot])]
  // 原本的部位排前面：原本的部位有空時先放那裡，都滿了才放額外飾品欄
  const extra = fitsExtra(base) ? activeExtraSlots() : []
  if (race === undefined) return [...own, ...extra]
  if (base.races?.length && !base.races.includes(race)) return []
  const rule = gearRules.races[race]
  const relabel = rule?.relabel ?? {}
  const native = own
  own = own.filter((s) => !relabel[s])
  for (const [s, r] of Object.entries(relabel) as [GearSlot, { as: BaseSlot }][]) if (r.as === slot) own.push(s)
  const restricted = new Set(rule?.restricted ?? [])
  const mine = !!base.races?.includes(race)
  // 原本的位置都是限定或改掉的欄位（一般的鞋子、腳鍊、內褲）：這個種族完全不能穿，額外飾品欄也不行
  if (!mine && native.every((s) => restricted.has(s) || relabel[s])) return []
  const blocked = rule?.blocked ?? []
  return [...own, ...extra].filter((s) => !blocked.includes(s) && (mine || !restricted.has(s)))
}

/** 欄位在這個種族身上的名字（人馬族的內褲那一格叫「後蹄」） */
export function slotNameFor(slot: GearSlot, race?: string): string {
  return (race && gearRules.races[race]?.relabel?.[slot]?.name) || gearRules.slots[slot]
}

/** 這個種族穿不了這種底材的原因（人馬族穿不了一般的鞋子、內褲）；穿得了時是 undefined */
export function raceUnfitReason(baseId: string, race?: string): string | undefined {
  const base = gearRules.bases[baseId]
  if (!base || !race || baseSlotsFor(baseId, race).length) return undefined
  const rn = raceName(race)
  if (base.races?.length && !base.races.includes(race)) return `只有${base.races.map(raceName).join('、')}能穿${base.name}`
  const rule = gearRules.races[race]
  const slot = (gearRules.slot_groups[base.slot]?.[0] ?? base.slot) as GearSlot
  const what = gearRules.slots[slot] ?? base.slot
  const relabel = rule?.relabel?.[slot]
  if (relabel) return `${rn}沒有穿${what}的地方（那一格是${relabel.name}，只能穿${rn}的${raceWearNames(race, relabel.as as GearSlot).join('、') || relabel.name}）`
  if (rule?.restricted?.includes(slot)) {
    const own = raceWearNames(race, slot)
    return `${rn}穿不了一般的${what}${own.length ? `，只能穿${rn}的${own.join('、')}` : ''}`
  }
  return `${rn}穿不了${base.name}`
}

/** 這個種族在這個部位專用的底材名稱（一般的，不含拘束具與專屬底材） */
function raceWearNames(race: string, slot: GearSlot): string[] {
  return Object.values(gearRules.bases).filter((b) => b.races?.includes(race) && b.slot === slot && !b.restraint && !b.exclusive).map((b) => b.name)
}

/** 這個種族在這個欄位用的種族限定底材（NPC 的配備、服裝把一般的底材換成它）：同材料類型優先，再來是比較輕的 */
export function raceBaseFor(race: string | undefined, slot: GearSlot, kind?: MaterialKind): string | undefined {
  if (!race || !gearRules.races[race]?.restricted?.includes(slot)) return undefined
  const ids = Object.entries(gearRules.bases).filter(([id, b]) => b.races?.includes(race) && !b.restraint && !b.exclusive && baseSlotsFor(id, race).includes(slot)).map(([id]) => id)
  const weight = (id: string) => ARMOR_WEIGHT[gearRules.bases[id]!.kind] ?? 0
  return ids.find((id) => gearRules.bases[id]!.kind === kind) ?? ids.filter((id) => !kind || weight(id) <= (ARMOR_WEIGHT[kind] ?? 2)).sort((a, b) => weight(b) - weight(a))[0]
}

// ---- 角色身上的裝備 ----

/** 主手與上身決定角色的武器與防具類型；主手空著時用職業的徒手（武僧拳腳）或徒手 */
export function syncGear(c: Character, classWeapon?: string) {
  const main = c.gear?.main_hand
  const body = c.gear?.body
  const natural = classWeapon && equipment.weapons[classWeapon]?.natural ? classWeapon
    : equipment.weapons[c.weapon]?.natural ? c.weapon : 'unarmed'
  // 失效的裝備（底材或材料被刪掉）：當成沒有裝備
  c.weapon = main && gearKnown(main.spec) ? gearStats(main.spec).weapon ?? natural : natural
  c.armor = body && gearKnown(body.spec) ? gearStats(body.spec).armor ?? 'none' : 'none'
}

/** 身上所有裝備的加成合計（主手武器的骰子與上身防具的迴避、減傷另外由武器與防具類型計算） */
export function gearBonuses(c: Pick<Character, 'gear'>): { mods: Mods; resist: AffinityMap; offense: AffinityMap; threat: number } {
  const mods: Mods = {}
  const resist: AffinityMap = {}
  const offense: AffinityMap = {}
  let threat = 0
  for (const [slot, g] of Object.entries(c.gear ?? {})) {
    if (!g || !gearKnown(g.spec)) continue
    const s = gearStats(g.spec)
    // 額外飾品欄的拘束具：好處不算（抗性是負的才是好處）
    const off = bonusesOff(slot, g.spec)
    addMods(mods, off ? onlyNegative(s.mods) : s.mods)
    mulResist(resist, off ? Object.fromEntries(Object.entries(s.resist).filter(([, v]) => (v ?? 0) > 0)) : s.resist)
    addMap(offense, off ? onlyNegative(s.offense) : s.offense)
    threat += s.threat
  }
  return { mods, resist, offense, threat: Math.round(threat * 100) / 100 }
}

/** 限定穿著的一項怎麼稱呼（底材 id 換成底材的名稱） */
export function wearName(w: string): string {
  const base = gearRules.bases[w] ? w : itemDef(w)?.gear?.base
  const alts = base ? wearVariants(base) : []
  const name = gearRules.bases[w]?.name ?? w
  return alts.length ? `${name}（${alts.map(([, b]) => `${raceNames(b.races)}穿${b.name}`).join('、')}）` : name
}

/** 當作這個底材的種族版本（wear_as） */
export function wearVariants(base: string): [string, BaseDef][] {
  return Object.entries(gearRules.bases).filter(([, b]) => b.wear_as === base)
}
const raceNames = (races: string[] | undefined) => (races ?? []).map(raceName).join('、')

/** 限定穿著（特殊任務的任務點、地標的場景）裡這個角色還沒穿上的：穿著同名的物品、或同一種底材的裝備都算 */
export function missingWear(c: Pick<Character, 'gear'>, wear: string[] | undefined): string[] {
  const worn = Object.values(c.gear ?? {}).filter(Boolean)
  return (wear ?? []).filter((w) => {
    // 寫的是物品名稱時，種族版本看那件物品的底材
    const base = gearRules.bases[w] ? w : itemDef(w)?.gear?.base
    return !worn.some((g) => g!.name === w || g!.spec.base === w || (!!base && gearRules.bases[g!.spec.base]?.wear_as === base))
  })
}

/** 內容編輯器的限定穿著選項：服裝類的底材（任何一件都算），以及有名字的服裝物品 */
export function wearChoices(): [string, string][] {
  return [
    ...Object.entries(gearRules.bases).filter(([, b]) => b.outfit).map(([id, b]): [string, string] => [id, `任何一件${b.name}`]),
    ...itemRules.items.filter((i) => i.gear && gearRules.bases[i.gear.base]?.outfit).map((i): [string, string] => [i.name, i.name]),
  ]
}

/** 限定穿著裡這個種族完全穿不了的（例如人馬族穿不了一般的鞋子、內褲）：底材 id 或物品名稱 */
export function wearUnfit(race: string | undefined, wear: string[] | undefined): string[] {
  return (wear ?? []).filter((w) => {
    const base = gearRules.bases[w] ? w : itemDef(w)?.gear?.base
    // 有這個種族穿得上的版本（wear_as）就不算
    return !!base && !baseSlotsFor(base, race).length && !wearVariants(base).some(([id]) => baseSlotsFor(id, race).length)
  })
}

/** 還沒穿上限定穿著時的說明（按鈕停用）；穿好了是 undefined */
export function wearNote(c: Pick<Character, 'gear'>, wear: string[] | undefined): string | undefined {
  const miss = missingWear(c, wear)
  return miss.length ? `要穿著${miss.map((w) => `【${wearName(w)}】`).join('')}才能進行（到隊伍的裝備換上）` : undefined
}

export function equipped(name: string, spec: GearSpec): EquippedGear {
  return { name, spec }
}

/** 材料類型裡指定等級的材料（tier 1～7）；series 給了時，同一級優先用那一套 */
function materialOf(kind: MaterialKind, tier: number, series?: string): string {
  const list = Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind)
  // 沒有剛好這一級的材料時，用最接近的（同樣接近時取低的）；同一級好幾種時，地點指定的系列優先，其他照排列順序
  const pref = (m: MaterialDef) => (series && m.series === series ? 0 : 1)
  const best = list.sort(([, a], [, b]) => Math.abs(a.tier - tier) - Math.abs(b.tier - tier) || a.tier - b.tier || pref(a) - pref(b))[0]
  if (!best) throw new Error(`沒有${kind}類的材料`)
  return best[0]
}

function piece(base: string, tier: number): EquippedGear {
  const spec: GearSpec = { base, material: materialOf(gearRules.bases[base]!.kind, tier) }
  return { name: gearName(spec), spec }
}

/** 內衣、內褲的欄位 */
export const UNDERWEAR_SLOTS: GearSlot[] = ['underwear_top', 'underwear_bottom']

/**
 * 依體型穿上預設的內衣、內褲（第一級材料，gear.json 的 underwear_defaults）：建角與 NPC 生成時用。
 * 那個欄位已經有東西、或被種族封住時不穿；不用亂數，不影響其他裝備的生成
 */
export function wearDefaultUnderwear(c: Pick<Character, 'gear' | 'race'>, body: 'masc' | 'fem' | 'andro') {
  const defaults = gearRules.underwear_defaults?.[body] ?? {}
  for (const slot of UNDERWEAR_SLOTS) {
    const base = defaults[slot]
    // 種族封住或改掉的欄位（人馬族的後蹄）不穿
    if (!base || !gearRules.bases[base] || !baseSlotsFor(base, c.race).includes(slot) || c.gear?.[slot]) continue
    ;(c.gear ??= {})[slot] = piece(base, 1)
  }
}

/** 開局的基本配備（第一級材料） */
export function startingGear(classId: string): Partial<Record<GearSlot, EquippedGear>> {
  const t = gearRules.classes[classId]
  const out: Partial<Record<GearSlot, EquippedGear>> = {}
  for (const [slot, base] of Object.entries(t?.start ?? {})) out[slot as GearSlot] = piece(base, 1)
  return out
}

// ---- 建立角色時挑裝備 ----

/** 建角時一個欄位的選擇：底材與材料等級；item 是世界裡自建的裝備（物品名稱，底材與材料照它的組成） */
export interface CreationPick { base: string; tier: number; item?: string }
export type CreationGear = Partial<Record<GearSlot, CreationPick>>

/** 世界裡自建的底材與裝備物品（applyContent 登錄）：建角時也能選 */
const customGear = { bases: new Set<string>(), items: new Set<string>() }

export function setCustomGear(bases: string[], items: string[]) {
  customGear.bases = new Set(bases)
  customGear.items = new Set(items)
}

/** 建角可以選的自建裝備：還在物品目錄、有組成、不是束縛用或主人會強制裝備的東西 */
function creationItem(name: string) {
  if (!customGear.items.has(name)) return undefined
  const def = itemDef(name)
  const g = def?.gear
  if (!def || def.category !== 'equipment' || !g || def.master_force || def.event) return undefined
  const base = gearRules.bases[g.base]
  const mat = gearRules.materials[g.material]
  if (!base || !mat || base.restraint || base.kind !== mat.kind) return undefined
  return { def, spec: g, base, mat }
}

/**
 * 自建裝備花的預算：材料等級，加上稀有度比材料本來高出的附魔點數、獨特效果 1 點、屬性加值（只算正的）。
 * 不是基本配備，第 1 級也要付錢
 */
export function creationItemCost(name: string): number {
  const x = creationItem(name)
  if (!x) return 0
  const points = (r: string | undefined) => gearRules.rarities[r ?? '']?.enchant_points ?? 0
  const extra = Math.max(0, points(x.spec.rarity ?? x.mat.rarity) - points(x.mat.rarity))
  const attrs = Object.values(x.spec.attrs ?? {}).reduce((sum: number, v) => sum + Math.max(0, v ?? 0), 0)
  return x.mat.tier + extra + (x.spec.unique ? 1 : 0) + attrs
}

export interface CreationSlot {
  slot: GearSlot
  /** 職業模板的欄位：一定有裝備，第一級材料免費；其他欄位可以空著 */
  template: boolean
  /** 可以選的底材 */
  bases: string[]
}

/**
 * 建角時各欄位可以選的底材：主手、副手、上身是職業模板（gear.json 的 classes：main、off、body 清單），
 * 職業清單是空的欄位（武僧的主手）不能選；其他欄位可以放任何能放進去的底材，但護具不能比職業的 pieces 重。
 * 種族封住的欄位不列。
 */
const ARMOR_WEIGHT: Record<string, number> = { cloth: 0, leather: 1, metal: 2 }

export function creationSlots(classId: string, race?: string, classWeapons = false): CreationSlot[] {
  const t = gearRules.classes[classId] ?? gearRules.classes.fighter!
  const blocked = new Set(race ? gearRules.races[race]?.blocked ?? [] : [])
  // 種族限定的底材與欄位（沒給種族時照底材本來的位置，種族限定的底材不列）
  const fits = (id: string, b: BaseDef, slot: GearSlot) => (race ? baseSlotsFor(id, race).includes(slot) : !b.races?.length && baseFits(b.slot, slot, b))
  const listed: Partial<Record<GearSlot, string[]>> = { main_hand: t.main, off_hand: t.off, body: t.body }
  const out: CreationSlot[] = []
  for (const slot of SLOTS) {
    if (blocked.has(slot) || !slotOpen(slot)) continue
    const fromClass = listed[slot]
    if (fromClass) {
      // 職業清單，加上世界裡自建、放得進這個欄位的底材（護甲不能比職業的護甲類型重；清單是空的欄位不加）
      const custom = fromClass.length
        ? [...customGear.bases].filter((id) => {
          const b = gearRules.bases[id]
          return !!b && !b.restraint && !b.exclusive && fits(id, b, slot) && (slot !== 'body' || !(b.kind in ARMOR_WEIGHT) || ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2))
        })
        : []
      // 上身另外可以選服裝（不能比職業的護甲類型重：比基尼鎧甲是金屬、皮革緊身衣是皮革）
      const outfits = slot === 'body' && fromClass.length
        ? Object.entries(gearRules.bases).filter(([id, b]) => b.outfit && b.slot === 'body' && fits(id, b, 'body') && ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2)).map(([id]) => id)
        : []
      // 職業武器限制打開時，主手不列職業不能拿的武器（自建的底材）
      const bases = [...new Set([...fromClass, ...custom, ...outfits])].filter((b) => baseShown(b) && fits(b, gearRules.bases[b]!, slot) && !(classWeapons && classWeaponBlock(classId, { base: b, material: '' })))
      if (bases.length) out.push({ slot, template: !!t.start[slot], bases })
      continue
    }
    // 頭、腿等護具：不能比職業的護甲類型重（布 < 皮革 < 金屬）；飾品不限
    const bases = Object.entries(gearRules.bases)
      .filter(([id, b]) => !b.restraint && !b.exclusive && baseShown(id) && fits(id, b, slot) && (!(b.kind in ARMOR_WEIGHT) || ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2)))
      .map(([id]) => id)
    if (bases.length) out.push({ slot, template: false, bases })
  }
  return out
}

/** 建角的裝備目錄裡的一項：某個欄位、某個底材做成某一級材料，與它花的預算 */
export interface CreationOption extends CreationPick {
  slot: GearSlot
  /** 世界裡自建的（底材或裝備） */
  custom?: boolean
  /** 職業的基本配備欄位（第 1 級材料免費） */
  template: boolean
  /** 花的預算：基本配備欄位是材料等級 - 1，其他欄位是材料等級 */
  cost: number
  name: string
  spec: GearSpec
}

/** 欄位的大分類（建角的裝備目錄分頁用） */
export const SLOT_CATEGORY: Record<GearSlot, 'weapon' | 'armor' | 'accessory'> = {
  main_hand: 'weapon', off_hand: 'weapon',
  head: 'armor', body: 'armor', legs: 'armor', wrists: 'armor', feet: 'armor', belt: 'armor',
  accessory: 'accessory', ring_1: 'accessory', ring_2: 'accessory', piercing_1: 'accessory', piercing_2: 'accessory', leg_accessory: 'accessory',
  underwear_top: 'accessory', underwear_bottom: 'accessory', extra_1: 'accessory', extra_2: 'accessory',
  extra_3: 'accessory', extra_4: 'accessory', extra_5: 'accessory', extra_6: 'accessory', extra_7: 'accessory', extra_8: 'accessory',
}

/** 建角時每個欄位可以選的所有裝備（底材 × 第 1～max_tier 級材料），預算都算好了 */
export function creationCatalog(classId: string, race?: string, classWeapons = false): { slot: GearSlot; template: boolean; options: CreationOption[] }[] {
  const maxTier = gearRules.creation.max_tier
  return creationSlots(classId, race, classWeapons).map((s) => ({
    slot: s.slot,
    template: s.template,
    options: [
      // 自建的裝備物品排最前面
      ...[...customGear.items].flatMap((name): CreationOption[] => {
        const x = creationItem(name)
        if (!x || !s.bases.includes(x.spec.base)) return []
        return [{ slot: s.slot, base: x.spec.base, tier: x.mat.tier, item: name, custom: true, template: s.template, cost: creationItemCost(name), name, spec: JSON.parse(JSON.stringify(x.spec)) as GearSpec }]
      }),
      ...s.bases.flatMap((base) => Array.from({ length: maxTier }, (_, i) => {
        const tier = i + 1
        const p = piece(base, tier)
        return { slot: s.slot, base, tier, template: s.template, cost: s.template ? tier - 1 : tier, name: p.name, spec: p.spec, ...(customGear.bases.has(base) ? { custom: true } : {}) }
      })),
    ],
  }))
}

/** 建角畫面預覽用：這個底材做成某一級材料的裝備 */
export function creationPiece(base: string, tier: number): EquippedGear {
  return piece(base, tier)
}

/** 選擇花的預算：模板欄位每升一級材料 1 點；其他欄位花材料等級 */
export function creationCost(classId: string, choice: CreationGear): number {
  const template = new Set(creationSlots(classId).filter((s) => s.template).map((s) => s.slot))
  let cost = 0
  for (const [slot, pick] of Object.entries(choice)) {
    if (!pick) continue
    if (pick.item) cost += creationItemCost(pick.item)
    else cost += template.has(slot as GearSlot) ? Math.max(0, pick.tier - 1) : pick.tier
  }
  return cost
}

/**
 * 依建角的選擇產生起始裝備：檢查底材在這個欄位的清單裡、材料等級在 1～max_tier、雙手武器不帶副手、
 * 花費不超過預算。模板欄位沒選時用職業的起始底材（第一級材料）。不合法時丟錯
 */
export function creationGear(classId: string, choice: CreationGear, budget: number, race?: string, classWeapons = false): Partial<Record<GearSlot, EquippedGear>> {
  const slots = creationSlots(classId, race, classWeapons)
  const t = gearRules.classes[classId] ?? gearRules.classes.fighter!
  const maxTier = gearRules.creation.max_tier
  const picks: CreationGear = {}
  for (const s of slots) {
    const pick = choice[s.slot] ?? (s.template ? { base: t.start[s.slot]!, tier: 1 } : undefined)
    if (!pick) continue
    if (pick.item) {
      const x = creationItem(pick.item)
      if (!x) throw new Error(`「${pick.item}」不能當起始裝備`)
      if (!s.bases.includes(x.spec.base)) throw new Error(`${slotName(s.slot)}不能選「${pick.item}」`)
      picks[s.slot] = { base: x.spec.base, tier: x.mat.tier, item: pick.item }
      continue
    }
    if (!s.bases.includes(pick.base)) throw new Error(`${slotName(s.slot)}不能選${gearRules.bases[pick.base]?.name ?? pick.base}`)
    const tier = Math.round(pick.tier)
    if (!(tier >= 1 && tier <= maxTier)) throw new Error(`建角時材料最多到第 ${maxTier} 級`)
    picks[s.slot] = { base: pick.base, tier }
  }
  for (const slot of Object.keys(choice)) if (!slots.some((s) => s.slot === slot) && choice[slot as GearSlot]) throw new Error(`${slotName(slot as GearSlot)}不能選`)
  if (picks.main_hand && gearRules.bases[picks.main_hand.base]?.two_handed) delete picks.off_hand
  const cost = creationCost(classId, picks)
  if (cost > budget) throw new Error(`裝備的預算不夠（要 ${cost} 點，只有 ${budget} 點）`)
  const out: Partial<Record<GearSlot, EquippedGear>> = {}
  for (const [slot, pick] of Object.entries(picks)) {
    out[slot as GearSlot] = pick!.item ? { name: pick!.item, spec: JSON.parse(JSON.stringify(creationItem(pick!.item)!.spec)) as GearSpec } : piece(pick!.base, pick!.tier)
  }
  return out
}

/** 依等級挑材料：建議等級不超過角色等級的最高一級最常見，傳說材料特別少 */
function rollTier(rng: Rng, kind: MaterialKind, level: number): number {
  const l = gearRules.loadout
  const top = Math.max(1, ...Object.values(gearRules.materials).filter((m) => m.kind === kind && m.level <= level).map((m) => m.tier))
  const r = rng.next()
  let tier = r < l.top ? top : r < l.top + l.below ? top - 1 : top - 2
  tier = Math.max(1, tier)
  // 第 5 級以上是傳說材料：大多降回第 4 級
  if (tier >= 5 && !rng.chance(l.legendary)) tier = 4
  return tier
}

const PIECE_BASES: Record<MaterialKind, Partial<Record<GearSlot, string>>> = {
  metal: { head: 'helm', legs: 'greaves', wrists: 'vambraces', feet: 'sabatons', belt: 'girdle' },
  leather: { head: 'leather_cap', legs: 'leather_leggings', wrists: 'bracers', feet: 'boots', belt: 'belt' },
  cloth: { head: 'hood', legs: 'trousers', wrists: 'wraps', feet: 'shoes', belt: 'sash' },
  wood: {},
  jewel: {},
}
const JEWELRY_BASES = {
  accessory: ['amulet_ward', 'amulet_iron', 'pendant_fire', 'pendant_cold', 'pendant_lightning', 'pendant_poison', 'pendant_shadow', 'pendant_mind'],
  ring: ['ring_precision', 'ring_guard', 'ring_fortune', 'ring_swift'],
  piercing: ['earring_hawk', 'earring_calm', 'navel_ember', 'navel_vigor'],
  leg_accessory: ['anklet_wind', 'anklet_bell', 'thigh_band', 'thigh_sheath'],
}

/** 夥伴與敵對冒險者：依職業模板與等級生成一套裝備 */
export function generateLoadout(classId: string, level: number, rng: Rng, race?: string): Partial<Record<GearSlot, EquippedGear>> {
  const t = gearRules.classes[classId] ?? gearRules.classes.fighter!
  const l = gearRules.loadout
  const blocked = new Set(race ? gearRules.races[race]?.blocked ?? [] : [])
  const out: Partial<Record<GearSlot, EquippedGear>> = {}
  const put = (slot: GearSlot, base: string | undefined) => {
    if (!base || blocked.has(slot)) return
    // 種族限定的欄位（人馬族的下身、鞋子、腿部飾品）換成種族的底材
    if (race && !baseSlotsFor(base, race).includes(slot)) base = raceBaseFor(race, slot, gearRules.bases[base]!.kind)
    if (!base) return
    out[slot] = piece(base, rollTier(rng, gearRules.bases[base]!.kind, level))
  }
  put('main_hand', t.main.length ? rng.pick(t.main) : undefined)
  const twoHanded = !!(out.main_hand && gearRules.bases[out.main_hand.spec.base]?.two_handed)
  if (!twoHanded && t.off.length) put('off_hand', t.start.off_hand ?? rng.pick(t.off))
  put('body', level >= 9 && t.body.includes('plate') ? 'plate' : t.start.body ?? rng.pick(t.body))
  const pieceChance = Math.min(0.95, l.pieces_base + l.pieces_per_level * level)
  for (const slot of PIECE_SLOTS) if (rng.chance(pieceChance)) put(slot, PIECE_BASES[t.pieces][slot])
  const jewelChance = Math.min(l.jewelry_max, l.jewelry_base + l.jewelry_per_level * level)
  for (const j of JEWELRY) if (rng.chance(jewelChance)) put(j.slot, rng.pick(JEWELRY_BASES[j.group]))
  // 額外飾品欄：和其他飾品一樣的機率，從所有飾品底材抽。用另一條亂數（不消耗 rng），其他欄位擲出來的結果和以前一樣
  const extra = new Rng((rng.state ^ 0x5bd1e995) | 0)
  if (extra.chance(jewelChance)) {
    const base = extra.pick(Object.values(JEWELRY_BASES).flat())
    if (slotOpen(EXTRA_SLOT) && !blocked.has(EXTRA_SLOT) && (!race || baseSlotsFor(base, race).includes(EXTRA_SLOT))) out[EXTRA_SLOT] = piece(base, rollTier(extra, gearRules.bases[base]!.kind, level))
  }
  return out
}

export const MOD_NAME: Record<string, string> = {
  hit: '命中', damage: '傷害', evade: '迴避', dr: '減傷', save: '豁免', crit: '幸運一擊', ap_regen: '行動點回復', threat: '仇恨',
}
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** 武器的一段說明：傷害骰、傷害類型、用哪個屬性（力量或靈巧武器）、雙手 */
export function weaponLine(w: Pick<WeaponDef, 'dice' | 'type' | 'attr'>, twoHanded?: boolean): string {
  return `${w.dice} ${damageTypeName(w.type)}（${attrName(w.attr)}${twoHanded ? '、雙手' : ''}）`
}

/** 一行說明：稀有度・欄位・武器或防具類型・加成 */
/**
 * 一件裝備的摘要。inExtra：拘束具放在額外飾品欄（bonusesOff）時只列生效的部分：
 * 附魔、材料特性、正的屬性與檢定加值、獨特效果不列，減值、慾望指標、拘束照列
 */
export function gearSummary(spec: GearSpec, inExtra = false): string {
  return gearSummaryParts(spec, inExtra).map((p) => p.text).join('・')
}

/**
 * 摘要的一段。拘束具的「限制行走 2」帶著 bind（畫面上移上去、聚焦時顯示平常的檢定減值與戰鬥中的增益）
 * 與純文字的 tip（給按鈕的 title 這類只能放文字的地方）
 */
export interface SummaryPart { text: string; tip?: string; bind?: { kind: BindKind; bind: number; lock?: LockGrade } }

/** gearSummary 拆成一段一段（畫面上用 EffectLine.vue 顯示，有細節的段落可以移上去看） */
export function gearSummaryParts(spec: GearSpec, inExtra = false): SummaryPart[] {
  if (!gearKnown(spec)) return [{ text: '（已失效：底材或材料不存在，沒有效果）' }]
  const raw = gearStats(spec)
  const s = inExtra
    ? { ...raw, mods: onlyNegative(raw.mods), resist: Object.fromEntries(Object.entries(raw.resist).filter(([, v]) => (v ?? 0) > 0)), offense: onlyNegative(raw.offense), threat: 0 }
    : raw
  const parts = [rarityName(s.rarity), baseSlotName(s.slot)]
  if (s.weapon) {
    const w = weaponDef(s.weapon)
    parts.push(weaponLine(w, s.two_handed))
  }
  if (s.armor) {
    const a = armorDef(s.armor)
    parts.push(`迴避 ${signed(a.evade)}、減傷 ${a.dr}`)
  }
  const bonus = Object.entries(s.mods).filter(([, v]) => v).map(([k, v]) => `${MOD_NAME[k] ?? k} ${signed(v!)}`)
  const res = Object.entries(s.resist).filter(([, v]) => v).map(([k, v]) => `${damageTypeName(k)} ×${Math.round((1 + v!) * 100) / 100}`)
  const off = Object.entries(s.offense).filter(([, v]) => v).map(([k, v]) => `${damageTypeName(k)}攻擊 ×${Math.round((1 + v!) * 100) / 100}`)
  const all = [...bonus, ...res, ...off, ...(s.threat ? [`仇恨 ${signed(Math.round(s.threat * 100))}%`] : [])]
  if (all.length) parts.push(all.join('、'))
  if (spec.unique && !inExtra) parts.push(`獨特：${describeEffects([spec.unique]).replace(/。$/, '')}`)
  const attrs = spec.attrs && (inExtra ? onlyNegative(spec.attrs) : spec.attrs)
  if (attrs && Object.values(attrs).some((v) => v)) parts.push(Object.entries(attrs).filter(([, v]) => v).map(([k, v]) => `${attrName(k as AttrId)} ${signed(v!)}`).join('、'))
  // 慾望指標的加減（底材的預設與物品寫的）與曝露度
  const lewd = gearLewdOf(spec)
  const lewdText = LEWD_STAT_IDS.filter((k) => lewd[k]).map((k) => `${lewdRules.stats[k].name} ${signed(lewd[k]!)}`)
  if (lewdText.length) parts.push(lewdText.join('、'))
  const base = gearRules.bases[spec.base]
  const exposure = base?.exposure ?? (base?.outfit ? lewdRules.gear.outfit[base.outfit]?.exposure ?? 0 : 0)
  if (exposure && base && lewdRules.gear.exposure_slots.includes(base.slot)) parts.push(`曝露度 ${exposure}`)
  const out: SummaryPart[] = parts.map((text) => ({ text }))
  // 雙面效應：拘束的種類與程度（細節：平常的檢定減值、戰鬥中的增益）
  if (base?.bind && base.bind_kind) {
    const bind = spec.bind ?? base.bind
    out.push({
      text: `${lewdRules.two_face.kinds[base.bind_kind]?.name ?? base.bind_kind} ${bind}${spec.lock ? `（自帶${lewdRules.locks.grades[spec.lock]?.name ?? spec.lock}）` : ''}`,
      tip: bindTip(base.bind_kind, bind, spec.lock),
      bind: { kind: base.bind_kind, bind, ...(spec.lock ? { lock: spec.lock } : {}) },
    })
  }
  return out
}

// ---- AI 打造與事件生成的裝備 ----

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export function shiftRarity(r: string, n: number): string {
  const i = Math.max(0, RARITY_ORDER.indexOf(r))
  return RARITY_ORDER[Math.max(0, Math.min(RARITY_ORDER.length - 1, i + n))]!
}

/** 稀有度可以用的附魔點數 */
export function rarityPoints(r: string): number {
  return gearRules.rarities[r]?.enchant_points ?? 0
}

const ENCHANT_MODS: Record<string, number> = { hit: 2, damage: 3, evade: 2, dr: 2, save: 2, crit: 1, ap_regen: 1 }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN)
const isAffinityKey = (k: string) => k in damageTypes.groups || damageTypes.types.some((t) => t.id === k)

/**
 * 整理附魔：mods 為整數（每項有上限），resist 以 0.25 為單位、只能減傷（負數，最多 -0.5），
 * offense 以 0.25 為單位、只能增加（最多 +0.5），threat 以 0.1 為單位（±0.3）。
 * 總點數超過 points 時從最後一項開始刪減。
 */
export function sanitizeEnchants(raw: unknown, points: number): GearSpec['enchants'] | undefined {
  if (!raw || typeof raw !== 'object' || points <= 0) return undefined
  const r = raw as Record<string, unknown>
  const entries: { group: 'mods' | 'resist' | 'offense'; key: string; value: number }[] = []
  for (const [k, v] of Object.entries((r.mods ?? {}) as Record<string, unknown>)) {
    const n = num(v)
    if (Number.isNaN(n)) continue
    if (k === 'threat') {
      const t = Math.round(Math.max(-0.3, Math.min(0.3, n)) * 10) / 10
      if (t) entries.push({ group: 'mods', key: k, value: t })
    } else if (ENCHANT_MODS[k]) {
      const m = Math.round(Math.max(0, Math.min(ENCHANT_MODS[k]!, n)))
      if (m) entries.push({ group: 'mods', key: k, value: m })
    }
  }
  for (const [k, v] of Object.entries((r.resist ?? {}) as Record<string, unknown>)) {
    const n = Math.round(Math.max(-0.5, Math.min(0, num(v) || 0)) * 4) / 4
    if (n && isAffinityKey(k)) entries.push({ group: 'resist', key: k, value: n })
  }
  for (const [k, v] of Object.entries((r.offense ?? {}) as Record<string, unknown>)) {
    const n = Math.round(Math.max(0, Math.min(0.5, num(v) || 0)) * 4) / 4
    if (n && isAffinityKey(k)) entries.push({ group: 'offense', key: k, value: n })
  }
  const build = (list: typeof entries) => {
    const e: NonNullable<GearSpec['enchants']> = {}
    for (const x of list) ((e[x.group] ??= {}) as Record<string, number>)[x.key] = x.value
    return e
  }
  // 超過點數：刪掉最後一項（一項一項刪，直到夠用）
  while (entries.length && enchantPoints(build(entries)) > points) entries.pop()
  return entries.length ? build(entries) : undefined
}

/** 依名稱或 id 找底材、材料（AI 可能寫中文名稱） */
export function findBase(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return undefined
  if (gearRules.bases[s]) return s
  return Object.entries(gearRules.bases).find(([, b]) => b.name === s)?.[0]
}

export function findMaterial(v: unknown, kind?: MaterialKind): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return undefined
  const ok = (m: MaterialDef) => !kind || m.kind === kind
  if (gearRules.materials[s] && ok(gearRules.materials[s]!)) return s
  return Object.entries(gearRules.materials).find(([, m]) => m.name === s && ok(m))?.[0]
}

export interface GearLimits {
  /** 材料的建議等級上限 */
  maxLevel: number
  /** 稀有度上限（沒有時為材料原本的稀有度） */
  maxRarity?: string
  /** 固定底材或材料（打造時由玩家選定） */
  base?: string
  material?: string
  /** 打造拘束具（底材是拘束具也收） */
  restraint?: boolean
}

/**
 * 把 AI 提出的裝備（{ base, material, rarity, enchants }）整理成合法的組成：底材與材料要同類型、
 * 材料不超過等級上限（超過時降到上限內最高的一級）、稀有度不超過上限、附魔在稀有度的點數內。
 */
export function sanitizeGearSpec(raw: unknown, limits: GearLimits): GearSpec | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const base = limits.base ?? findBase(r.base ?? r.slot)
  // 束縛用的底材不給 AI 用（打造拘束具時由打造指定底材：limits.restraint）
  if (!base || (gearRules.bases[base]!.restraint && !limits.restraint) || gearRules.bases[base]!.exclusive) return undefined
  const kind = gearRules.bases[base]!.kind
  let material = limits.material ?? findMaterial(r.material, kind) ?? materialOf(kind, 1)
  if (gearRules.materials[material]!.level > limits.maxLevel) {
    const fit = Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind && m.level <= limits.maxLevel)
    material = fit.sort((a, b) => b[1].tier - a[1].tier)[0]?.[0] ?? materialOf(kind, 1)
  }
  const natural = gearRules.materials[material]!.rarity
  const cap = limits.maxRarity ?? natural
  const want = typeof r.rarity === 'string' && RARITY_ORDER.includes(r.rarity) ? r.rarity : natural
  const rarity = RARITY_ORDER[Math.min(RARITY_ORDER.indexOf(want), Math.max(RARITY_ORDER.indexOf(cap), RARITY_ORDER.indexOf(natural)))]!
  const enchants = sanitizeEnchants(r.enchants, rarityPoints(rarity))
  return { base, material, ...(rarity !== natural ? { rarity } : {}), ...(enchants ? { enchants } : {}) }
}

/** 和目錄裡的制式品完全相同（沒有附魔、稀有度也沒變） */
function isStandard(spec: GearSpec): boolean {
  return !spec.enchants && !spec.rarity
}

function sameSpec(a?: GearSpec, b?: GearSpec): boolean {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 登錄一件打造或事件生成的裝備，回傳物品的鍵。制式品直接用目錄的名稱；
 * 其他的用 AI 取的名字（沒有時是「稀有度＋制式名稱」或「精製＋制式名稱」）接上看不見的屬性雜湊（itemKey.ts）：
 * 屬性一樣的是同一個鍵、在行囊裡疊在一起，屬性不同的名字看起來一樣、鍵不同
 */
export function registerGear(state: Pick<GameState, 'customItems'>, spec: GearSpec, name?: string, desc?: string): string {
  if (!gearKnown(spec)) throw new Error('這件裝備的底材或材料不存在')
  const standard = gearName(spec)
  const label = itemLabel(name ?? '').trim().slice(0, 20)
  // 制式品：目錄裡真的有同名、同組成的物品才直接用（底材或材料改過名、目錄物品被改掉時另外登錄）
  if (isStandard(spec) && sameSpec(itemDef(label || standard)?.gear, spec)) return label || standard
  // 預設名稱：稀有度比材料高時加上稀有度（優良鐵長劍），只是有附魔時是「精製」（精製秘銀長劍）
  const want = label || (isStandard(spec) ? standard : `${spec.rarity ? rarityName(spec.rarity) : '精製'}${standard}`)
  // 雜湊撞到屬性不同的另一件（幾乎不會）：換一個
  let key = itemKey(want, spec)
  for (let salt = 1; state.customItems?.[key] && !sameShape(state.customItems[key]!.gear, spec); salt++) key = itemKey(want, spec, salt)
  if (!state.customItems?.[key]) {
    ;(state.customItems ??= {})[key] = {
      category: 'equipment', price_cc: gearPrice(spec), gear: spec,
      ...(desc?.trim() ? { desc: desc.trim().slice(0, 80) } : {}),
    }
  }
  return key
}

const ENCHANT_POOL: Record<string, { mods?: (keyof Mods)[]; resist?: boolean; offense?: boolean }> = {
  weapon: { mods: ['hit', 'damage', 'crit'], offense: true },
  armor: { mods: ['dr', 'evade', 'save'], resist: true },
  jewel: { mods: ['save', 'crit', 'hit', 'evade', 'ap_regen'], resist: true },
  focus: { mods: ['hit', 'save', 'ap_regen'], offense: true },
}
const ELEMENTS = ['fire', 'cold', 'lightning', 'acid', 'poison', 'radiant', 'necrotic', 'force', 'psychic']

/** 規則生成的附魔（沒有 AI 時）：依欄位挑合適的加成，用掉 points 點；elements 是偏好的屬性（輔料決定） */
export function rollEnchants(base: string, points: number, rng: Rng, elements: string[] = []): GearSpec['enchants'] | undefined {
  const b = gearRules.bases[base]!
  const pool = ENCHANT_POOL[b.weapon ? 'weapon' : base === 'focus' ? 'focus' : b.kind === 'jewel' ? 'jewel' : 'armor']!
  const e: NonNullable<GearSpec['enchants']> = {}
  let left = points
  for (let guard = 0; left > 0 && guard < 20; guard++) {
    const options: (() => boolean)[] = []
    for (const k of pool.mods ?? []) {
      options.push(() => {
        const cost = gearRules.enchant_costs[k] ?? 1
        const next = ((e.mods ??= {})[k] ?? 0) + 1
        if (cost > left || next > (ENCHANT_MODS[k] ?? 1)) return false
        e.mods![k] = next
        left -= cost
        return true
      })
    }
    const element = () => (elements.length && rng.chance(0.8) ? rng.pick(elements) : rng.pick(ELEMENTS))
    const resist = () => {
      const k = element()
      const next = ((e.resist ??= {})[k] ?? 0) - 0.25
      if (next < -0.5) return false
      e.resist![k] = next
      left -= gearRules.enchant_costs.resist ?? 1
      return true
    }
    const offense = () => {
      const k = element()
      const next = ((e.offense ??= {})[k] ?? 0) + 0.25
      if (next > 0.5) return false
      e.offense![k] = next
      left -= gearRules.enchant_costs.offense ?? 1
      return true
    }
    // 有偏好的屬性（輔料）時，抗性與屬性攻擊的機會加倍
    for (let n = elements.length ? 2 : 1; n > 0; n--) {
      if (pool.resist) options.push(resist)
      if (pool.offense) options.push(offense)
    }
    rng.pick(options)()
  }
  for (const k of ['mods', 'resist', 'offense'] as const) if (e[k] && !Object.keys(e[k]!).length) delete e[k]
  return Object.keys(e).length ? e : undefined
}

// ---- 寶箱與掉落 ----

/** 依等級隨機生成一件裝備（寶箱、人形怪物的掉落）：底材平均挑，材料依等級，有機會高一級稀有度並附魔 */
export function randomGear(rng: Rng, level: number, bases = randomBases(), series?: string): GearSpec {
  const base = rng.pick(bases)
  const kind = gearRules.bases[base]!.kind
  const material = materialOf(kind, rollTier(rng, kind, level), series)
  const spec: GearSpec = { base, material }
  if (rng.chance(gearRules.drops.bump)) {
    const rarity = shiftRarity(gearRules.materials[material]!.rarity, 1)
    spec.rarity = rarity
    const enchants = rollEnchants(base, rarityPoints(rarity), rng)
    if (enchants) spec.enchants = enchants
  }
  return spec
}

/** 能做成這種材料的物品（items.json 有 forge 的），由便宜到貴 */
export function forgeItemsForMaterial(material: string): string[] {
  return itemRules.items
    .filter((i) => i.forge?.materials.includes(material))
    .sort((a, b) => a.price_cc - b.price_cc)
    .map((i) => i.name)
}

/** 某一類型、某一級的打造材料（items.json 有 forge 的物品），由便宜到貴 */
export function forgeItemsFor(kind: MaterialKind, tier: number, series?: string): string[] {
  const material = materialOf(kind, tier, series)
  return itemRules.items
    .filter((i) => i.forge?.materials.includes(material))
    .sort((a, b) => a.price_cc - b.price_cc)
    .map((i) => i.name)
}

/** 某一類型、某一級最便宜的打造材料（材料委託、說明用） */
export function forgeItemFor(kind: MaterialKind, tier: number, series?: string): string | undefined {
  return forgeItemsFor(kind, tier, series)[0]
}

/** 有怪物會掉的物品（怪物素材） */
export function monsterLootItems(): Set<string> {
  return new Set(Object.values(enemies).flatMap((e) => (e.loot ?? []).map((l) => l.item)))
}

/** 這個地點的怪物會掉的物品：地下城各層與層主，加上所在地區的野外遭遇 */
export function localLootItems(location: string): Set<string> {
  const ids = new Set<string>()
  const addGroups = (groups: EncounterGroup[] | undefined) => {
    for (const g of groups ?? []) for (const [id] of g) ids.add(id)
  }
  const d = dungeonEncounters[location]
  if (d) {
    for (const layer of DUNGEON_LAYER_IDS) addGroups(d[layer])
    addGroups([d.boss])
    addGroups(Object.values(d.bosses ?? {}))
  }
  const region = geography.locations.find((l) => l.id === location)?.region
  if (region) addGroups(wildEncounters(region))
  return new Set([...ids].flatMap((id) => (enemies[id]?.loot ?? []).map((l) => l.item)))
}

/**
 * 寶箱開得出的打造材料：那一級的通用材料（沒有怪物會掉的），加上這裡的怪物會掉的；
 * 兩者都沒有時用那一級的全部。系列照材料（materialOf）挑，其他系列的不會出現。
 */
export function chestForgeCandidates(kind: MaterialKind, tier: number, series: string | undefined, local: Set<string>, loot = monsterLootItems()): string[] {
  const all = forgeItemsFor(kind, tier, series)
  const pool = all.filter((n) => !loot.has(n) || local.has(n))
  return pool.length ? pool : all
}

export const MATERIAL_KINDS: MaterialKind[] = ['metal', 'leather', 'cloth', 'wood', 'jewel']

/** 寶箱的打造材料：高等地下城（寶箱等級到 chest_forge_high 的 min_level）用那一組，其他照那一層的 forge */
export function chestForgeTable(layer: string, level: number): [number, number][] {
  const band = (gearRules.chest_forge_high?.bands ?? []).find((b) => level >= b.min_level && Array.isArray(b[layer]))
  return (band?.[layer] as [number, number][] | undefined) ?? gearRules.chests[layer]?.forge ?? []
}

/** 材料等級的上限（第 6、7 級只從 Lv.13～20 的地下城取得；打造的工錢、DC 與工藝等級都到這一級） */
export const MAX_TIER = 7

// ---- 職業武器限制（存檔規則 classWeapons，docs/ITEMS.md 第 2.2 節） ----

/** 這件裝備是不是主手的武器（盾、法器、副手短劍不算） */
export function isMainWeapon(spec: GearSpec): boolean {
  const b = gearRules.bases[spec.base]
  return !!b?.weapon && b.slot === 'main_hand'
}

/** 職業不能拿這件武器的原因；能拿、不是主手武器、職業沒有限制時是 null */
export function classWeaponBlock(classId: string, spec: GearSpec): string | null {
  const allowed = gearRules.classes[classId]?.weapons
  if (!allowed || !isMainWeapon(spec)) return null
  const type = gearRules.bases[spec.base]?.type ?? ''
  if (allowed.includes(type)) return null
  const who = className(classId)
  return allowed.length ? `${who}只能拿${allowed.join('、')}類的武器` : `${who}不拿武器，只用拳腳`
}
