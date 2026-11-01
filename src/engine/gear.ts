// 裝備：16 個欄位、底材 × 材料、稀有度與附魔（data/rules/gear.json）。
//
// - 一件裝備的數值由組成（GearSpec）推算：底材決定欄位、武器或防具類型與固定數值，材料的 bonus 依 scale 成長，
//   附魔在稀有度的點數內加減。制式裝備（items.json）、打造與事件生成的裝備（customItems）都用同一套公式。
// - 穿在身上的裝備自帶組成（EquippedGear），計算數值不需要存檔。
// - 角色的 weapon / armor 由主手與上身的裝備決定（syncGear），戰鬥沿用原本的武器與防具計算；
//   其餘欄位與材料、附魔的加成合計成 mods / resist / offense（gearBonuses）。

import gearJson from '@data/rules/gear.json'
import { armorDef, attrName, damageTypeName, damageTypes, equipment, itemDef, itemRules, lewdRules, weaponDef, mulResist, type AffinityMap, type AttrId, type BindKind, type Mods } from './data'
import { describeEffects } from './perks'
import { Rng } from './rng'
import type { Character, EquippedGear, GameState, GearSlot, GearSpec, LewdStat } from './types'

type Scale = 'full' | 'half' | 'up' | 'third' | 'third_up' | 'res'
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

export interface BaseDef {
  slot: BaseSlot
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
  /** 曝露度 0～3（慾望指標的曝露名聲用）；沒寫時依服裝種類（lewd.json 的 gear.outfit） */
  exposure?: number
  /** 雙面效應（lewd.json 的 two_face）：拘束的程度 1～3 與種類；平常是檢定減值，修了流派、鎖上時戰鬥中反轉成增益 */
  bind?: number
  bind_kind?: BindKind
}

export type OutfitKind = 'regular' | 'anime' | 'adult'
export const OUTFIT_KINDS: Record<OutfitKind, string> = { regular: '常規服裝', anime: '二次元服裝', adult: '成人向服裝' }

const LEWD_STAT_IDS: LewdStat[] = ['lewdness', 'sensitivity', 'endurance', 'submission']

/** 一件裝備的加值：底材的預設（成人向服裝、束縛用的底材）加上物品寫的，每項 ±item_cap */
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
}

export const gearRules = gearJson as unknown as {
  slots: Record<GearSlot, string>
  slot_groups: Record<string, GearSlot[]>
  rarities: Record<string, { name: string; enchant_points: number }>
  enchant_costs: Record<string, number>
  materials: Record<string, MaterialDef>
  bases: Record<string, BaseDef>
  classes: Record<string, ClassGearTemplate>
  races: Record<string, { blocked: GearSlot[] }>
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
  craft: {
    hours: number; attr: AttrId; fee: number[]; dc: number[]
    units: Record<string, number>; lost_on_fail: number
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

/** 額外飾品欄（docs/ITEMS.md 第 2 節）：首飾、戒指、穿孔飾品、腿部飾品，以及任何部位的拘束具都能放 */
export const EXTRA_SLOT: GearSlot = 'extra_1'
const EXTRA_BASE_SLOTS: BaseSlot[] = ['accessory', 'ring', 'piercing', 'leg_accessory']

/** 這種底材能不能放進額外飾品欄 */
export function fitsExtra(base: Pick<BaseDef, 'slot' | 'restraint' | 'bind'> | undefined): boolean {
  return !!base && (EXTRA_BASE_SLOTS.includes(base.slot) || !!base.restraint || !!base.bind)
}

/** 這種底材能不能放進這個欄位（額外飾品欄要傳底材，才看得出是不是拘束具） */
export function baseFits(baseSlot: BaseSlot, slot: GearSlot, base?: Pick<BaseDef, 'slot' | 'restraint' | 'bind'>): boolean {
  if (slot === EXTRA_SLOT) return fitsExtra(base ?? { slot: baseSlot })
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
function forgeUnitPrice(material: string): number | undefined {
  let best: number | undefined
  for (const i of itemRules.items) {
    if (!i.forge?.materials.includes(material) || !i.price_cc) continue
    if (best === undefined || i.price_cc < best) best = i.price_cc
  }
  return best
}

/**
 * 一件裝備的成本：照委託打造算，工錢（底材價格 × craft.fee）＋打造材料（份數 × 最便宜的打造材料）。
 * 第一級材料由工匠提供，只算工錢。底材或材料不在目錄時回傳 undefined（不封頂）。
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
export function slotsFor(spec: GearSpec): GearSlot[] {
  if (!gearKnown(spec)) return []
  const slot = gearStats(spec).slot
  const own = gearRules.slot_groups[slot] ?? [slot as GearSlot]
  // 原本的部位排前面：原本的部位有空時先放那裡，都滿了才放額外飾品欄
  return fitsExtra(gearRules.bases[spec.base]) ? [...own, EXTRA_SLOT] : own
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
  for (const g of Object.values(c.gear ?? {})) {
    if (!g || !gearKnown(g.spec)) continue
    const s = gearStats(g.spec)
    addMods(mods, s.mods)
    mulResist(resist, s.resist)
    addMap(offense, s.offense)
    threat += s.threat
  }
  return { mods, resist, offense, threat: Math.round(threat * 100) / 100 }
}

/** 限定穿著的一項怎麼稱呼（底材 id 換成底材的名稱） */
export function wearName(w: string): string {
  return gearRules.bases[w]?.name ?? w
}

/** 限定穿著（特殊任務的任務點、地標的場景）裡這個角色還沒穿上的：穿著同名的物品、或同一種底材的裝備都算 */
export function missingWear(c: Pick<Character, 'gear'>, wear: string[] | undefined): string[] {
  const worn = Object.values(c.gear ?? {}).filter(Boolean)
  return (wear ?? []).filter((w) => !worn.some((g) => g!.name === w || g!.spec.base === w))
}

/** 內容編輯器的限定穿著選項：服裝類的底材（任何一件都算），以及有名字的服裝物品 */
export function wearChoices(): [string, string][] {
  return [
    ...Object.entries(gearRules.bases).filter(([, b]) => b.outfit).map(([id, b]): [string, string] => [id, `任何一件${b.name}`]),
    ...itemRules.items.filter((i) => i.gear && gearRules.bases[i.gear.base]?.outfit).map((i): [string, string] => [i.name, i.name]),
  ]
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
  const blocked = gearRules.races[c.race]?.blocked ?? []
  const defaults = gearRules.underwear_defaults?.[body] ?? {}
  for (const slot of UNDERWEAR_SLOTS) {
    const base = defaults[slot]
    if (!base || !gearRules.bases[base] || blocked.includes(slot) || c.gear?.[slot]) continue
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

export function creationSlots(classId: string, race?: string): CreationSlot[] {
  const t = gearRules.classes[classId] ?? gearRules.classes.fighter!
  const blocked = new Set(race ? gearRules.races[race]?.blocked ?? [] : [])
  const listed: Partial<Record<GearSlot, string[]>> = { main_hand: t.main, off_hand: t.off, body: t.body }
  const out: CreationSlot[] = []
  for (const slot of SLOTS) {
    if (blocked.has(slot)) continue
    const fromClass = listed[slot]
    if (fromClass) {
      // 職業清單，加上世界裡自建、放得進這個欄位的底材（護甲不能比職業的護甲類型重；清單是空的欄位不加）
      const custom = fromClass.length
        ? [...customGear.bases].filter((id) => {
          const b = gearRules.bases[id]
          return !!b && !b.restraint && !b.exclusive && baseFits(b.slot, slot, b) && (slot !== 'body' || !(b.kind in ARMOR_WEIGHT) || ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2))
        })
        : []
      // 上身另外可以選服裝（不能比職業的護甲類型重：比基尼鎧甲是金屬、皮革緊身衣是皮革）
      const outfits = slot === 'body' && fromClass.length
        ? Object.entries(gearRules.bases).filter(([, b]) => b.outfit && b.slot === 'body' && ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2)).map(([id]) => id)
        : []
      const bases = [...new Set([...fromClass, ...custom, ...outfits])].filter((b) => baseShown(b))
      if (bases.length) out.push({ slot, template: !!t.start[slot], bases })
      continue
    }
    // 頭、腿等護具：不能比職業的護甲類型重（布 < 皮革 < 金屬）；飾品不限
    const bases = Object.entries(gearRules.bases)
      .filter(([id, b]) => !b.restraint && !b.exclusive && baseShown(id) && baseFits(b.slot, slot, b) && (!(b.kind in ARMOR_WEIGHT) || ARMOR_WEIGHT[b.kind]! <= (ARMOR_WEIGHT[t.pieces] ?? 2)))
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
  underwear_top: 'accessory', underwear_bottom: 'accessory', extra_1: 'accessory',
}

/** 建角時每個欄位可以選的所有裝備（底材 × 第 1～max_tier 級材料），預算都算好了 */
export function creationCatalog(classId: string, race?: string): { slot: GearSlot; template: boolean; options: CreationOption[] }[] {
  const maxTier = gearRules.creation.max_tier
  return creationSlots(classId, race).map((s) => ({
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
export function creationGear(classId: string, choice: CreationGear, budget: number, race?: string): Partial<Record<GearSlot, EquippedGear>> {
  const slots = creationSlots(classId, race)
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
    if (!blocked.has(EXTRA_SLOT)) out[EXTRA_SLOT] = piece(base, rollTier(extra, gearRules.bases[base]!.kind, level))
  }
  return out
}

export const MOD_NAME: Record<string, string> = {
  hit: '命中', damage: '傷害', evade: '迴避', dr: '減傷', save: '豁免', crit: '幸運一擊', ap_regen: '行動點回復',
}
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** 一行說明：稀有度・欄位・武器或防具類型・加成 */
export function gearSummary(spec: GearSpec): string {
  if (!gearKnown(spec)) return '（已失效：底材或材料不存在，沒有效果）'
  const s = gearStats(spec)
  const parts = [rarityName(s.rarity), baseSlotName(s.slot)]
  if (s.weapon) {
    const w = weaponDef(s.weapon)
    parts.push(`${w.dice} ${damageTypeName(w.type)}${s.two_handed ? '（雙手）' : ''}`)
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
  if (spec.unique) parts.push(`獨特：${describeEffects([spec.unique]).replace(/。$/, '')}`)
  if (spec.attrs) parts.push(Object.entries(spec.attrs).filter(([, v]) => v).map(([k, v]) => `${attrName(k as AttrId)} ${signed(v!)}`).join('、'))
  // 慾望指標的加減（底材的預設與物品寫的）與曝露度
  const lewd = gearLewdOf(spec)
  const lewdText = LEWD_STAT_IDS.filter((k) => lewd[k]).map((k) => `${lewdRules.stats[k].name} ${signed(lewd[k]!)}`)
  if (lewdText.length) parts.push(lewdText.join('、'))
  const base = gearRules.bases[spec.base]
  const exposure = base?.exposure ?? (base?.outfit ? lewdRules.gear.outfit[base.outfit]?.exposure ?? 0 : 0)
  if (exposure && base && lewdRules.gear.exposure_slots.includes(base.slot)) parts.push(`曝露度 ${exposure}`)
  // 雙面效應：拘束的種類與程度
  if (base?.bind && base.bind_kind) parts.push(`${lewdRules.two_face.kinds[base.bind_kind]?.name ?? base.bind_kind} ${spec.bind ?? base.bind}${spec.lock ? `（自帶${lewdRules.locks.grades[spec.lock]?.name ?? spec.lock}）` : ''}`)
  return parts.join('・')
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
}

/**
 * 把 AI 提出的裝備（{ base, material, rarity, enchants }）整理成合法的組成：底材與材料要同類型、
 * 材料不超過等級上限（超過時降到上限內最高的一級）、稀有度不超過上限、附魔在稀有度的點數內。
 */
export function sanitizeGearSpec(raw: unknown, limits: GearLimits): GearSpec | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const base = limits.base ?? findBase(r.base ?? r.slot)
  // 束縛用的底材不給 AI 用
  if (!base || gearRules.bases[base]!.restraint || gearRules.bases[base]!.exclusive) return undefined
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
 * 登錄一件打造或事件生成的裝備，回傳物品名稱。制式品直接用目錄的名稱；
 * 其他的用 AI 取的名字（沒有時是「稀有度＋制式名稱」或「精製＋制式名稱」），和現有的物品撞名時加上編號。
 */
export function registerGear(state: Pick<GameState, 'customItems'>, spec: GearSpec, name?: string, desc?: string): string {
  if (!gearKnown(spec)) throw new Error('這件裝備的底材或材料不存在')
  const standard = gearName(spec)
  // 制式品：目錄裡真的有同名、同組成的物品才直接用（底材或材料改過名、目錄物品被改掉時另外登錄）
  if (isStandard(spec) && !name && sameSpec(itemDef(standard)?.gear, spec)) return standard
  // 預設名稱：稀有度比材料高時加上稀有度（優良鐵長劍），只是有附魔時是「精製」（精製秘銀長劍）
  const want = name?.trim().slice(0, 20) || (isStandard(spec) ? standard : `${spec.rarity ? rarityName(spec.rarity) : '精製'}${standard}`)
  const taken = (n: string) => {
    if (itemDef(n)) return !sameSpec(itemDef(n)!.gear, spec) || !isStandard(spec)
    const c = state.customItems?.[n]
    return !!c && !sameSpec(c.gear, spec)
  }
  let final = want
  for (let i = 2; taken(final); i++) final = `${want}（${i}）`
  if (itemDef(final)) return final
  ;(state.customItems ??= {})[final] = {
    category: 'equipment', price_cc: gearPrice(spec), gear: spec,
    ...(desc?.trim() ? { desc: desc.trim().slice(0, 80) } : {}),
  }
  return final
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

/** 某一類型、某一級的打造材料（items.json 有 forge 的物品，挑最便宜的） */
export function forgeItemFor(kind: MaterialKind, tier: number, series?: string): string | undefined {
  const material = materialOf(kind, tier, series)
  return itemRules.items
    .filter((i) => i.forge?.materials.includes(material))
    .sort((a, b) => a.price_cc - b.price_cc)[0]?.name
}

export const MATERIAL_KINDS: MaterialKind[] = ['metal', 'leather', 'cloth', 'wood', 'jewel']

/** 材料等級的上限（第 6、7 級只從 Lv.13～20 的地下城取得；打造的工錢、DC 與工藝等級都到這一級） */
export const MAX_TIER = 7
