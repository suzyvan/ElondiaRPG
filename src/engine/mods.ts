// 玩家自訂內容：新增或修改怪物、物品、裝備底材與材料（「🌍 世界」頁籤）。
//
// - 修改存成一份覆寫（ContentMods）：內建項目存整份修改後的資料，自建項目存整份資料並標上 custom。
// - applyContent 先把遊戲資料還原成內建的樣子（模組載入時的快照），再套上覆寫，所以隨時可以重新套用或恢復預設。
// - 怪物的出現地點（spawns / exclude）寫進城郊與地下城的遭遇表；物品的寶箱、採集設定寫進對應的表；
//   掉落物以怪物的 loot 為準（在物品這邊設定掉落時，改的是那隻怪物）。
// - 自建的底材或材料會自動產生「底材 × 同類材料」的制式裝備。
// 說明見 docs/CONTENT_EDITOR.md。

import { parasiteDef } from './parasites'
import mapsJson from '@data/world/maps.json'
import {
  abilities, attributeRules, ATTR_IDS, bumpContentRevision, classes, companionRules, CRAFT_IDS, craftRules, damageTypes, dungeonEncounters, enemies, equipment, GENDER_IDS, geography, itemDef, itemRules, monsterTraits,
  npcs as namedNpcs, npcTags, isChoosablePerk, perkDef, perkRules, reindexItems, statuses, storyCounters, wildEncounterTables, type ArmorDef, type AttrId, type DungeonEncounters, type EncounterGroup,
  type EnemyDef, type FurniturePlace, type FurnitureSpec, type ItemCategory, type ItemDef, type ItemUse, type Mods, type NpcDef, type WeaponDef, wildEncounters,
  stories, type RecipeSpec, type SeedSpec, type StoryCond, type AbilityDef, type AbilityTarget, type AbilityType, type ApplyDef, type DamagePart, type PerkDef,
  type Control, type LuckRoll, type StatusDef, type ConditionDef, slaveryRules, lewdRules, type ContractDef, isKeeperShop, isCustomShopId, isLandmarkId, landmarks, specialMaps, shopRules, DUNGEON_LAYER_IDS, DUNGEON_LAYER_NAME, BOSS_LAYER_IDS, type DungeonLayerId, BIND_KINDS, type BindKind, LOCK_GRADES,
} from './data'
import { baseFits, baseSlots, gearName, gearPrice, gearRules, RARITY_ORDER, setCustomGear, type BaseDef, type MaterialDef, OUTFIT_KINDS, MAX_TIER } from './gear'
import { settlementArea, ZONES } from './grid'
import { cleanFlag } from './storyFlags'
import { TOOL_KINDS } from './tools'
import { cleanPerkEffects, describeEffects, PERK_CATEGORIES, type PerkLimits } from './perks'
import { sanitizeLustPerk, schoolDef } from './schools'
import { applyStoryMod, builtinStory, restoreStories, sanitizeStory, storyCheck, type StoryMod } from './storyMods'
import { applyMarkRules, currentMarkRules, sanitizeMarkMod, sanitizeMarkRules, sanitizeTattooMod, type MarkMod, type MarkRulesMod, type TattooMod } from './tattooMods'
import { tattooRules, type TattooTemplate } from './tattoos'
import { applyLandmarkMod, landmarkSpotProblem, restoreLandmarks, sanitizeLandmarkMod, type LandmarkMod } from './landmarkMods'
import { applySpecialMapMod, restoreSpecialMaps, sanitizeSpecialMapMod, specialPreview, type SpecialMapMod } from './specialMapMods'
import { applyCounter, builtinCounter, restoreCounters, sanitizeCounter, type CounterMod } from './counterMods'
import { allMasterEvents, applyMasterEvent, builtinMasterEvent, restoreMasterEvents, sanitizeMasterEvent, type MasterEventMod } from './masterEventMods'
import { applyBindRules, restoreBindRules, sanitizeBindRules, type BindRulesMod } from './bindRulesMods'
import { applyEventRules, applyTravelEvent, builtinTravelEvent, restoreTravelEvents, sanitizeEventRules, sanitizeTravelEvent, type EventRulesMod, type TravelEventMod } from './travelEventMods'
import { applyShopMod, applyShopPlacements, canListItem, restoreShops, sanitizeShopMod, type ShopMod } from './shopMods'
import { notForSale } from './trade'
import { travelEvents } from './road'
import { sanitizeIcon, setCategoryIcons } from './itemIcons'
import type { Character, GameState, GearSlot, GearSpec } from './types'

export type ChestLayer = DungeonLayerId
export const CHEST_LAYERS: ChestLayer[] = DUNGEON_LAYER_IDS
export type GatherPlace = 'wild' | 'dungeon'

/** 怪物出現的地方：table 為遭遇表（wild:地區、dungeon:地點:層、boss:地點:層），count 為一組幾隻，weight 為放幾組（越多越常遇到） */
export interface Placement {
  table: string
  count: number
  weight?: number
  /** 層主（boss: 開頭的表）的護衛：預設沒有（層主單獨出場，平衡也是這樣算的） */
  guards?: [string, number][]
}

export interface EnemyMod extends EnemyDef {
  custom?: boolean
  /** 另外加入的出現地點 */
  spawns?: Placement[]
  /** 從內建遭遇表移除（table key） */
  exclude?: string[]
}

export interface ItemMod extends ItemDef {
  custom?: boolean
  /** 寶箱：各層出現的機率（有這個欄位時取代內建的設定） */
  chests?: Partial<Record<ChestLayer, number>>
  /** 採集：近郊、地下城的資源格（有這個欄位時取代內建的設定） */
  gather?: GatherPlace[]
}

export interface BaseMod extends BaseDef {
  custom?: boolean
  /** 武器的傷害（主手武器）：內建底材改它原本的武器類型，自建底材登錄成 w_<id> */
  weaponDef?: WeaponDef
  /** 防具的迴避與減傷（上身）：內建底材改它原本的防具類型，自建底材登錄成 a_<id> */
  armorDef?: ArmorDef
}

export interface MaterialMod extends MaterialDef {
  custom?: boolean
}

/** 固定 NPC：內建的具名角色（data/world/npcs.json）可以修改，自建的可以刪除 */
export interface NpcMod extends NpcDef {
  custom?: boolean
}

/** 能力（技能、法術、戲法）：內建的可以修改，自建的沒有被使用時可以刪除 */
export interface AbilityMod extends AbilityDef {
  custom?: boolean
}

/** 特質：內建的（包括種族特質）可以修改，自建的沒有被使用時可以刪除。custom 是內容編輯器自建的（和角色身上的自訂特質不同） */
export type PerkMod = PerkDef

/** 狀態（BUFF／DEBUFF，statuses.json）：內建的可以修改，自建的沒有被使用時可以刪除 */
export interface StatusMod extends StatusDef {
  custom?: boolean
}

/** 非戰鬥狀態（companions.json 的 conditions：用餐、喝酒、受罰、祝福……）：內建的可以修改，自建的沒有被使用時可以刪除 */
export interface ConditionMod extends ConditionDef {
  custom?: boolean
}

export interface ContentMods {
  version: 1
  enemies: Record<string, EnemyMod>
  items: Record<string, ItemMod>
  bases: Record<string, BaseMod>
  materials: Record<string, MaterialMod>
  npcs: Record<string, NpcMod>
  stories: Record<string, StoryMod>
  abilities: Record<string, AbilityMod>
  perks: Record<string, PerkMod>
  /** 舊的自訂內容沒有這一欄（讀取時補上） */
  statuses: Record<string, StatusMod>
  /** 非戰鬥狀態（舊的自訂內容沒有這一欄，讀取時補上） */
  conditions: Record<string, ConditionMod>
  /** 刺青圖樣（普通刺青、誓約印記） */
  tattoos: Record<string, TattooMod>
  /** 奴隸印記的模板 */
  marks: Record<string, MarkMod>
  /** 印記的用途與權重（只有 rules 一筆） */
  markRules: Record<string, MarkRulesMod>
  /** 商店（內建的店只能改部分欄位） */
  shops: Record<string, ShopMod>
  /** 城鎮的特色地標：內建的整份覆蓋，自建的 custom */
  landmarks: Record<string, LandmarkMod>
  specialMaps: Record<string, SpecialMapMod>
  /** 旅途事件與城鎮事件（整份）；eventRules 只有一筆 rules：路段機率、種類權重、城鎮事件的機率與冷卻 */
  travelEvents: Record<string, TravelEventMod>
  eventRules: Record<string, EventRulesMod>
  /** 雙面效應的設定（只有 rules 一筆；舊的自訂內容沒有這一欄） */
  bindRules?: Record<string, BindRulesMod>
  /** 主人事件格式的事件（主人的突發事件、調教、娼館；舊的自訂內容沒有這一欄） */
  masterEvents?: Record<string, MasterEventMod>
  /** 類別的圖示（依類別 id；舊的自訂內容沒有這一欄） */
  categoryIcons: Record<string, CategoryIconMod>
  /** 劇情計數器（舊的自訂內容沒有這一欄） */
  counters: Record<string, CounterMod>
}

/** 類別的圖示：玩家上傳的圖（data URL），沒有的類別用內建的圖 */
export interface CategoryIconMod {
  icon: string
}

export function emptyMods(): ContentMods {
  return { version: 1, enemies: {}, items: {}, bases: {}, materials: {}, npcs: {}, stories: {}, abilities: {}, perks: {}, statuses: {}, conditions: {}, tattoos: {}, marks: {}, markRules: {}, shops: {}, landmarks: {}, specialMaps: {}, travelEvents: {}, eventRules: {}, bindRules: {}, masterEvents: {}, categoryIcons: {}, counters: {} }
}

// ---- 內建資料的快照（模組載入時） ----

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const maps = mapsJson as unknown as { generation: { wild: { resource_items: string[] }; dungeon: { resource_items: string[] } } }

const snapshot = {
  enemies: clone(enemies),
  dungeon: clone(dungeonEncounters),
  wild: clone(wildEncounterTables),
  items: clone(itemRules.items),
  bases: clone(gearRules.bases),
  materials: clone(gearRules.materials),
  chests: clone(gearRules.chests),
  weapons: clone(equipment.weapons),
  armors: clone(equipment.armors),
  gather: { wild: [...maps.generation.wild.resource_items], dungeon: [...maps.generation.dungeon.resource_items] },
  npcs: clone(namedNpcs),
  abilities: clone(abilities),
  perks: clone(perkRules.perks),
  statuses: clone(statuses),
  conditions: clone(companionRules.conditions),
  tattoos: clone(tattooRules.templates),
  marks: clone(slaveryRules.contracts),
  markRules: clone(currentMarkRules()),
}

export function builtinTattoo(id: string): TattooTemplate | undefined {
  return snapshot.tattoos[id] ? clone(snapshot.tattoos[id]!) : undefined
}

export function builtinMark(id: string): ContractDef | undefined {
  return snapshot.marks[id] ? clone(snapshot.marks[id]!) : undefined
}

/** 內建的印記設定 */
export function builtinMarkRules(): MarkRulesMod {
  return clone(snapshot.markRules)
}

export function builtinStatus(id: string): StatusDef | undefined {
  return snapshot.statuses[id] ? clone(snapshot.statuses[id]!) : undefined
}

export function builtinCondition(id: string): ConditionDef | undefined {
  return !id.startsWith('$') && snapshot.conditions[id] ? clone(snapshot.conditions[id]!) : undefined
}

/** 目前的非戰鬥狀態的 id（內建與自建，不含 $comment） */
export function conditionIds(): string[] {
  return Object.keys(companionRules.conditions).filter((k) => !k.startsWith('$'))
}

/** 由程式加上與解除的非戰鬥狀態（奴隸印記、逃亡、暫時離隊）：解除時機、同組與疊加不能改 */
export const SYSTEM_CONDITIONS = ['slave_mark', 'fugitive', 'away']

export function builtinPerk(id: string): PerkDef | undefined {
  const p = snapshot.perks.find((x) => x.id === id)
  return p ? clone(p) : undefined
}

export function builtinAbility(id: string): AbilityDef | undefined {
  return snapshot.abilities[id] ? clone(snapshot.abilities[id]!) : undefined
}

export function builtinNpc(id: string): NpcDef | undefined {
  const n = snapshot.npcs.find((x) => x.id === id)
  return n ? clone(n) : undefined
}

export function builtinEnemy(id: string): EnemyDef | undefined {
  return snapshot.enemies[id] ? clone(snapshot.enemies[id]!) : undefined
}
export function builtinItem(name: string): ItemDef | undefined {
  const i = snapshot.items.find((x) => x.name === name)
  return i ? clone(i) : undefined
}
export function builtinBase(id: string): BaseDef | undefined {
  return snapshot.bases[id] ? clone(snapshot.bases[id]!) : undefined
}
export function builtinMaterial(id: string): MaterialDef | undefined {
  return snapshot.materials[id] ? clone(snapshot.materials[id]!) : undefined
}

function replaceRecord<T>(target: Record<string, T>, source: Record<string, T>) {
  for (const k of Object.keys(target)) delete target[k]
  for (const [k, v] of Object.entries(source)) target[k] = clone(v)
}

/** 把遊戲資料還原成內建的樣子 */
function restore() {
  bumpContentRevision()
  replaceRecord(enemies, snapshot.enemies)
  replaceRecord(dungeonEncounters as Record<string, DungeonEncounters>, snapshot.dungeon)
  replaceRecord(wildEncounterTables as Record<string, unknown>, snapshot.wild as Record<string, unknown>)
  itemRules.items.splice(0, itemRules.items.length, ...clone(snapshot.items))
  replaceRecord(gearRules.bases, snapshot.bases)
  replaceRecord(gearRules.materials, snapshot.materials)
  replaceRecord(gearRules.chests as Record<string, unknown>, snapshot.chests as Record<string, unknown>)
  replaceRecord(equipment.weapons, snapshot.weapons)
  replaceRecord(equipment.armors, snapshot.armors)
  maps.generation.wild.resource_items.splice(0, Infinity, ...snapshot.gather.wild)
  maps.generation.dungeon.resource_items.splice(0, Infinity, ...snapshot.gather.dungeon)
  namedNpcs.splice(0, namedNpcs.length, ...clone(snapshot.npcs))
  replaceRecord(statuses, snapshot.statuses)
  replaceRecord(companionRules.conditions, snapshot.conditions)
  replaceRecord(tattooRules.templates, snapshot.tattoos)
  replaceRecord(slaveryRules.contracts, snapshot.marks)
  applyMarkRules(clone(snapshot.markRules))
  restoreShops()
  restoreLandmarks()
  restoreSpecialMaps()
  restoreTravelEvents()
  restoreBindRules()
  restoreMasterEvents()
  restoreCounters()
  setCategoryIcons({})
  setCustomGear([], [])
  replaceRecord(abilities, snapshot.abilities)
  perkRules.perks.splice(0, perkRules.perks.length, ...clone(snapshot.perks))
  restoreStories()
}

// ---- 遭遇表 ----

const LAYER_NAME = DUNGEON_LAYER_NAME
const BOSS_LAYERS = BOSS_LAYER_IDS

/** 可以放怪物的遭遇表 */
export function tableOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  for (const r of geography.regions) out.push({ key: `wild:${r.id}`, label: `城郊・${r.name}` })
  for (const loc of geography.locations.filter((l) => l.type === 'dungeon' && dungeonEncounters[l.id])) {
    // 底層只有寫了底層的地下城才有
    const has = (layer: ChestLayer) => layer !== 'abyss' || !!dungeonEncounters[loc.id]!.abyss?.length
    for (const layer of CHEST_LAYERS.filter(has)) out.push({ key: `dungeon:${loc.id}:${layer}`, label: `${loc.name}・${LAYER_NAME[layer]}` })
    for (const layer of BOSS_LAYERS.filter(has)) out.push({ key: `boss:${loc.id}:${layer}`, label: `${loc.name}・${LAYER_NAME[layer]}層主（取代原本的層主）` })
  }
  return out
}

export function tableLabel(key: string): string {
  return tableOptions().find((t) => t.key === key)?.label ?? key
}

/** 遭遇表本身（boss 以外） */
function tableGroups(key: string): EncounterGroup[] | undefined {
  const [kind, a, b] = key.split(':')
  if (kind === 'wild') {
    const t = wildEncounterTables[a!]
    return Array.isArray(t) ? t : undefined
  }
  if (kind === 'dungeon') return dungeonEncounters[a!]?.[b as ChestLayer]
  return undefined
}

/** 這隻怪物目前出現在哪些遭遇表（套用覆寫後） */
export function placementsOf(id: string): { key: string; label: string; groups: number }[] {
  const out: { key: string; label: string; groups: number }[] = []
  for (const t of tableOptions()) {
    if (t.key.startsWith('boss:')) {
      const [, loc, layer] = t.key.split(':')
      const g = dungeonEncounters[loc!]?.bosses?.[layer as 'shallow']
      if (g?.[0]?.[0] === id) out.push({ key: t.key, label: t.label.replace('（取代原本的層主）', ''), groups: 1 })
      continue
    }
    const n = (tableGroups(t.key) ?? []).filter((g) => g.some(([e]) => e === id)).length
    if (n) out.push({ key: t.key, label: t.label, groups: n })
  }
  return out
}

/** 內建遭遇表裡有這隻怪物的地方（不含層主），給「從遭遇表移除」用 */
export function builtinPlacementsOf(id: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  for (const t of tableOptions()) {
    const [kind, a, b] = t.key.split(':')
    const groups = kind === 'wild' ? snapshot.wild[a!] : kind === 'dungeon' ? snapshot.dungeon[a!]?.[b as ChestLayer] : undefined
    if (Array.isArray(groups) && groups.some((g) => g.some(([e]) => e === id))) out.push(t)
  }
  return out
}

function applyPlacements(id: string, m: EnemyMod) {
  for (const key of m.exclude ?? []) {
    const groups = tableGroups(key)
    if (!groups) continue
    const kept = groups.filter((g) => !g.some(([e]) => e === id))
    // 遭遇表不能變成空的
    if (kept.length) groups.splice(0, groups.length, ...kept)
  }
  for (const p of m.spawns ?? []) {
    const count = Math.max(1, Math.min(6, Math.round(p.count) || 1))
    if (p.table.startsWith('boss:')) {
      const [, loc, layer] = p.table.split(':')
      const d = dungeonEncounters[loc!]
      if (!d) continue
      const group: [string, number][] = [[id, count], ...(p.guards ?? []).filter(([g]) => !!enemies[g])]
      ;(d.bosses ??= {})[layer as 'shallow'] = group
      if (layer === 'deep') d.boss = clone(group)
      continue
    }
    const groups = tableGroups(p.table)
    if (!groups) continue
    for (let i = 0; i < Math.max(1, Math.min(5, Math.round(p.weight ?? 1))); i++) groups.push([[id, count]])
  }
}

// ---- 物品的來源 ----

/** 這個物品目前從哪裡來（套用覆寫後） */
export function itemSources(name: string) {
  const drops = Object.values(enemies)
    .flatMap((e) => (e.loot ?? []).filter((l) => l.item === name).map((l) => ({ enemy: e.id, chance: l.chance, qty: l.qty ?? 1 })))
  const chests: Partial<Record<ChestLayer, number>> = {}
  for (const layer of CHEST_LAYERS) {
    const hit = gearRules.chests[layer]?.items.find(([n]) => n === name)
    if (hit) chests[layer] = hit[1]
  }
  const gather: GatherPlace[] = (['wild', 'dungeon'] as const).filter((g) => maps.generation[g].resource_items.includes(name))
  return { drops, chests, gather }
}

// ---- 篩選用的索引（內容頁籤） ----

/** 每隻怪物出現的地方：wild:地區（城郊）、dungeon:地點（任何一層或層主） */
export function enemyPlaceIndex(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (id: string, key: string) => {
    let set = out.get(id)
    if (!set) out.set(id, (set = new Set()))
    set.add(key)
  }
  for (const r of geography.regions) for (const g of wildEncounters(r.id)) for (const [id] of g) add(id, `wild:${r.id}`)
  for (const [loc, t] of Object.entries(dungeonEncounters)) {
    for (const layer of CHEST_LAYERS) for (const g of t[layer] ?? []) for (const [id] of g) add(id, `dungeon:${loc}`)
    const bosses: (EncounterGroup | undefined)[] = [t.boss, ...Object.values(t.bosses ?? {})]
    for (const g of bosses) for (const [id] of g ?? []) add(id, `dungeon:${loc}`)
  }
  return out
}

/** 篩選怪物的出現地點：城郊各地區、各座地下城 */
export function enemyPlaceOptions(): { key: string; label: string }[] {
  return [
    ...geography.regions.map((r) => ({ key: `wild:${r.id}`, label: `城郊・${r.name}` })),
    ...geography.locations.filter((l) => l.type === 'dungeon' && dungeonEncounters[l.id]).map((l) => ({ key: `dungeon:${l.id}`, label: `地下城・${l.name}` })),
  ]
}

/** 物品的取得方式 */
export const ITEM_SOURCE_NAME: Record<string, string> = {
  'shop:general': '雜貨店', 'shop:temple': '神殿', 'shop:tavern': '酒館', 'shop:smith': '鐵匠鋪', 'shop:tailor': '裁縫店',
  'shop:jeweler': '珠寶店', 'shop:magic': '魔法物品店', 'shop:info': '情報商',
  chest: '寶箱', 'gather:wild': '近郊採集', 'gather:dungeon': '地下城採集', drop: '怪物掉落', event: '事件獎勵', forge: '打造材料', none: '沒有取得方式',
}

/** 每個物品的取得方式（ITEM_SOURCE_NAME 的 key） */
export function itemSourceIndex(): Map<string, Set<string>> {
  const drops = new Set(Object.values(enemies).flatMap((e) => (e.loot ?? []).map((l) => l.item)))
  const chests = new Set(CHEST_LAYERS.flatMap((l) => (gearRules.chests[l]?.items ?? []).map(([n]) => n)))
  const out = new Map<string, Set<string>>()
  for (const i of itemRules.items) {
    const set = new Set<string>(i.tags.map((t) => `shop:${t}`))
    if (chests.has(i.name)) set.add('chest')
    for (const g of ['wild', 'dungeon'] as const) if (maps.generation[g].resource_items.includes(i.name)) set.add(`gather:${g}`)
    if (drops.has(i.name)) set.add('drop')
    if (i.event) set.add('event')
    if (i.forge?.materials.length) set.add('forge')
    if (!set.size) set.add('none')
    out.set(i.name, set)
  }
  return out
}

// ---- 套用 ----

const strip = <T extends object>(v: T, keys: string[]): T => {
  const c = clone(v) as Record<string, unknown>
  for (const k of keys) delete c[k]
  return c as T
}

const LOC_BY_TIER: Record<number, string> = { 3: 'city', 4: 'capital' }
/** 裝備在哪種店賣：金屬與木材是鐵匠鋪，皮革與布料是裁縫店，寶石是珠寶店 */
export const GEAR_SHOP: Record<string, string> = { metal: 'smith', wood: 'smith', leather: 'tailor', cloth: 'tailor', jewel: 'jeweler' }

/** 自建的底材或材料：產生「底材 × 同類材料」的制式裝備（已有同名物品時略過） */
/** 自建的底材或材料自動產生的制式裝備（名稱與組成）；底材與材料要先登錄到 gearRules */
function generatedGear(mods: Pick<ContentMods, 'bases' | 'materials'>): [string, GearSpec][] {
  const out: [string, GearSpec][] = []
  for (const [bid, b] of Object.entries(gearRules.bases)) {
    for (const [mid, m] of Object.entries(gearRules.materials)) {
      if (b.restraint || m.kind !== b.kind || (!mods.bases[bid]?.custom && !mods.materials[mid]?.custom)) continue
      const spec: GearSpec = { base: bid, material: mid }
      out.push([gearName(spec), spec])
    }
  }
  return out
}

function generateCatalog(mods: ContentMods) {
  const names = new Set(itemRules.items.map((i) => i.name))
  for (const [name, spec] of generatedGear(mods)) {
    if (names.has(name)) continue
    names.add(name)
    const b = gearRules.bases[spec.base]!
    const m = gearRules.materials[spec.material]!
    itemRules.items.push({
      name, category: 'equipment', price_cc: gearPrice(spec), tags: m.tier <= 4 ? [GEAR_SHOP[m.kind]!] : [], gear: spec,
      ...(LOC_BY_TIER[m.tier] ? { min_location: LOC_BY_TIER[m.tier] } : {}),
      ...(b.desc || m.desc ? { desc: `${b.desc ?? ''}${m.desc ?? ''}` } : {}),
    })
  }
}

/** 內建制式裝備的價格跟著修改過的底材或材料重新計算 */
function repriceCatalog(mods: ContentMods) {
  for (const i of itemRules.items) {
    if (!i.gear || mods.items[i.name]) continue
    if (mods.bases[i.gear.base] || mods.materials[i.gear.material]) i.price_cc = gearPrice(i.gear)
  }
}

/** 把覆寫套用到遊戲資料（先還原成內建的樣子）。壞掉的項目略過，回傳略過的原因 */
export function applyContent(mods: ContentMods): string[] {
  restore()
  const problems: string[] = []
  const tryEach = <T>(label: string, list: Record<string, T>, fn: (key: string, v: T) => void) => {
    for (const [k, v] of Object.entries(list)) {
      try {
        fn(k, v)
      } catch (e) {
        problems.push(`${label}「${k}」：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  // 狀態最先：能力、物品、其他狀態的命中附加都會用到
  tryEach('狀態', mods.statuses ?? {}, (id, m) => {
    statuses[id] = strip(m, ['custom'])
  })
  // 非戰鬥狀態（用餐、喝酒……）：物品、事件、休息會用到。自建的彼此可以互相引用（再獲得一次變成、獲得時拿掉）
  const knownConditions = new Set([...conditionIds(), ...Object.keys(mods.conditions ?? {})])
  tryEach('非戰鬥狀態', mods.conditions ?? {}, (id, m) => {
    companionRules.conditions[id] = strip(sanitizeCondition(id, m, !!m.custom || !builtinCondition(id), knownConditions), ['custom'])
  })
  // 刺青與奴隸印記：事件、特殊任務會用到
  tryEach('刺青圖樣', mods.tattoos ?? {}, (id, m) => {
    tattooRules.templates[id] = strip(m, ['custom'])
  })
  tryEach('奴隸印記', mods.marks ?? {}, (id, m) => {
    slaveryRules.contracts[id] = strip(m, ['custom'])
  })
  tryEach('印記設定', mods.markRules ?? {}, (_id, m) => applyMarkRules(sanitizeMarkRules(m, new Set(Object.keys(slaveryRules.contracts)), builtinMarkRules())))
  tryEach('地標', mods.landmarks ?? {}, (id, m) => {
    const l = sanitizeLandmarkMod(id, m)
    applyLandmarkMod(id, l)
    // 擺不上去的照樣套用（引用它的 NPC、任務才不會失效），但要讓作者知道
    const why = landmarkSpotProblem(id, l.at)
    if (why) problems.push(`地標「${l.name}」的位置（${l.at.x}, ${l.at.y}）${why}，地圖上不會出現`)
  })
  tryEach('商店', mods.shops ?? {}, (id, m) => applyShopMod(id, m))
  // 商店的位置：移動內建的店、擺自建的店（擺不上去的略過）
  tryEach('商店的位置', { all: mods.shops ?? {} }, (_id, all) => {
    for (const r of applyShopPlacements(all)) problems.push(`商店「${(shopRules.types as Record<string, { name: string } | undefined>)[r.shop]?.name ?? r.shop}」的位置（${r.at.area} ${r.at.x}, ${r.at.y}）：${r.reason}`)
  })
  // 特殊地圖（商店之後：可以擺自建的店）：固定 NPC、特殊任務會用到；互相接的通道要先知道所有自建的地圖
  const knownMaps = { ...specialMaps, ...(mods.specialMaps ?? {}) }
  // 遭遇表與資源：物品、怪物在後面才套用，這一包裡的先算存在
  const refs = { enemy: (x: string) => !!enemies[x] || !!mods.enemies[x], item: (n: string) => !!itemDef(n) || !!mods.items[n] }
  tryEach('特殊地圖', mods.specialMaps ?? {}, (id, m) => applySpecialMapMod(id, sanitizeSpecialMapMod(id, m, knownMaps, undefined, refs)))
  // 能力先套用：怪物、固定 NPC、職業都會用到
  tryEach('能力', mods.abilities, (id, m) => {
    abilities[id] = { ...strip(m, ['custom']), id }
  })
  // 特質在能力之後、固定 NPC 之前（物品的書籍、固定 NPC 的特質清單會用到）
  tryEach('特質', mods.perks, (id, m) => registerPerk(id, m))
  tryEach('材料', mods.materials, (id, m) => {
    gearRules.materials[id] = strip(m, ['custom'])
  })
  tryEach('底材', mods.bases, (id, b) => {
    const base = strip(b, ['custom', 'weaponDef', 'armorDef'])
    // 內建底材直接改它的武器或防具類型（職業、NPC 用到同一種類型的也一起改）；自建底材另外登錄一種
    if (b.weaponDef) {
      const wid = snapshot.bases[id]?.weapon ?? `w_${id}`
      equipment.weapons[wid] = { ...(snapshot.weapons[wid] ?? {}), ...clone(b.weaponDef) }
      base.weapon = wid
    }
    if (b.armorDef) {
      const aid = snapshot.bases[id]?.armor ?? `a_${id}`
      equipment.armors[aid] = { ...(snapshot.armors[aid] ?? {}), ...clone(b.armorDef) }
      base.armor = aid
    }
    gearRules.bases[id] = base
  })
  generateCatalog(mods)
  repriceCatalog(mods)
  tryEach('物品', mods.items, (name, m) => {
    const def = strip(m, ['custom', 'chests', 'gather'])
    def.name = name
    // 底材或材料被刪掉的裝備：拿掉組成（變成一般物品）
    if (def.gear && (gearRules.bases[def.gear.base]?.kind === undefined || gearRules.bases[def.gear.base]!.kind !== gearRules.materials[def.gear.material]?.kind)) delete def.gear
    // 被刪掉的材料：拿掉打造的連結
    if (def.forge) {
      const forge = def.forge.materials.filter((x) => !!gearRules.materials[x])
      if (forge.length) def.forge = { materials: forge }
      else delete def.forge
    }
    const i = itemRules.items.findIndex((x) => x.name === name)
    if (i >= 0) itemRules.items[i] = def
    else itemRules.items.push(def)
    if (m.chests) {
      for (const layer of CHEST_LAYERS) {
        const t = gearRules.chests[layer]
        if (!t) continue
        t.items = t.items.filter(([n]) => n !== name)
        const p = m.chests[layer]
        if (p) t.items.push([name, p])
      }
    }
    if (m.gather) {
      for (const g of ['wild', 'dungeon'] as const) {
        const list = maps.generation[g].resource_items
        const has = list.includes(name)
        if (m.gather.includes(g) && !has) list.push(name)
        if (!m.gather.includes(g) && has) list.splice(list.indexOf(name), 1)
      }
    }
  })
  reindexItems()
  tryEach('怪物', mods.enemies, (id, m) => {
    enemies[id] = { ...strip(m, ['custom', 'spawns', 'exclude']), id }
  })
  tryEach('怪物的出現地點', mods.enemies, (id, m) => applyPlacements(id, m))
  // 劇情計數器（固定 NPC、任務與事件的條件會用到）
  tryEach('劇情計數器', mods.counters ?? {}, (id, m) => applyCounter(id, sanitizeCounter(m, !!m.custom)))
  tryEach('固定 NPC', mods.npcs, (id, m) => {
    const def = { ...strip(m, ['custom']), id }
    const i = namedNpcs.findIndex((n) => n.id === id)
    if (i >= 0) namedNpcs[i] = def
    else namedNpcs.push(def)
  })
  tryEach('特殊任務', mods.stories, (id, m) => applyStoryMod(id, m))
  // 旅途與城鎮事件（物品、特殊地圖、商店都套用之後：結果與設施會用到）
  tryEach('事件', mods.travelEvents ?? {}, (id, m) => applyTravelEvent(id, sanitizeTravelEvent(id, m, !!m.custom)))
  tryEach('事件設定', mods.eventRules ?? {}, (_id, m) => applyEventRules(sanitizeEventRules(m)))
  tryEach('雙面效應設定', mods.bindRules ?? {}, (_id, m) => applyBindRules(sanitizeBindRules(m)))
  tryEach('主奴與娼館的事件', mods.masterEvents ?? {}, (id, m) => applyMasterEvent(id, sanitizeMasterEvent(id, m, !!m.custom)))
  setCategoryIcons(Object.fromEntries(Object.entries(mods.categoryIcons ?? {}).map(([k, v]) => [k, v.icon])))
  // 自建的底材與裝備：建角時也能選
  setCustomGear(
    Object.entries(mods.bases).filter(([id, b]) => b.custom && gearRules.bases[id]).map(([id]) => id),
    Object.entries(mods.items).filter(([n, m]) => m.custom && itemDef(n)?.gear).map(([n]) => n),
  )
  // 套用完再加一次：套用途中有快取被重算的話，套用後一定重算
  bumpContentRevision()
  return problems
}

/**
 * 匯入的內容：有錯誤（storyCheck 的 errors）的特殊任務不收，從 mods 拿掉（only 給時只檢查這些 id）。
 * 拿掉一個任務可能讓別的任務變成有錯誤（例如開始它的效果），所以反覆檢查到沒有為止。
 * 會套用 mods（呼叫的人之後要重新套用目前的內容）。回傳說明。
 */
export function dropBrokenStories(mods: ContentMods, only?: Set<string>): string[] {
  const out: string[] = []
  for (let round = 0; round < 10; round++) {
    applyContent(mods)
    const bad = Object.keys(mods.stories)
      .filter((id) => !only || only.has(id))
      .map((id) => ({ id, def: stories.find((s) => s.id === id) }))
      .map(({ id, def }) => ({ id, title: def?.title ?? id, errors: def ? storyCheck(def).errors : [] }))
      .filter((b) => b.errors.length)
    if (!bad.length) break
    for (const b of bad) {
      out.push(`特殊任務「${b.title}」有錯誤，沒有匯入：${b.errors.join('；')}`)
      delete mods.stories[b.id]
    }
  }
  return out
}

// ---- 整理（儲存與匯入時） ----

const num = (v: unknown, lo: number, hi: number, d: number) => {
  // 空白的欄位用預設值（不要變成 0 再被夾到最小值）
  if (v === '' || v === null || v === undefined) return d
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d))
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const DICE = /^\d{0,2}d\d{1,3}([+-]\d{1,3})?$/
const dice = (v: unknown, d: string) => {
  const s = str(v, 12).replace(/\s+/g, '')
  return DICE.test(s) ? s : d
}
/** 怪物的攻擊骰：{x}d{y}+{z}（z 可以省略） */
export interface DiceParts { count: number; sides: number; bonus: number }
export function parseDice(v: string): DiceParts {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(v.replace(/\s+/g, ''))
  return m ? { count: Number(m[1]), sides: Number(m[2]), bonus: Number(m[3] ?? 0) } : { count: 1, sides: 6, bonus: 0 }
}
export function formatDice(d: DiceParts): string {
  const count = Math.max(1, Math.min(20, Math.round(d.count) || 1))
  const sides = Math.max(2, Math.min(100, Math.round(d.sides) || 6))
  const bonus = Math.max(0, Math.min(99, Math.round(d.bonus) || 0))
  return `${count}d${sides}${bonus ? `+${bonus}` : ''}`
}
const DAMAGE_IDS = () => damageTypes.types.map((t) => t.id)
const AFFINITY_KEYS = () => [...DAMAGE_IDS(), ...Object.keys(damageTypes.groups), 'all']
const MOD_KEYS: (keyof Mods)[] = ['hit', 'evade', 'save', 'damage', 'dr', 'ap_regen', 'crit', 'threat']

/** 抗性或攻擊加成：每項 -1～hi（裝備、特質用 2；怪物的攻擊加成到 7，也就是 ×8，見 docs/MONSTERS.md 層主的輸出） */
function affinity(v: unknown, hi = 2): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v)) {
    if (!AFFINITY_KEYS().includes(k)) continue
    const n = Math.round(num(x, -1, hi, 0) * 100) / 100
    if (n) out[k] = n
  }
  return Object.keys(out).length ? out : undefined
}

function mods(v: unknown, lo = -10, hi = 10): Mods | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Mods = {}
  for (const k of MOD_KEYS) {
    const x = (v as Record<string, unknown>)[k]
    if (x === undefined || x === '') continue
    const n = k === 'threat' ? Math.round(num(x, -1, 2, 0) * 100) / 100 : int(x, lo, hi, 0)
    if (n) out[k] = n
  }
  return Object.keys(out).length ? out : undefined
}

export const ENEMY_KINDS: Record<string, string> = {
  beast: '野獸', humanoid: '人形', undead: '不死', spirit: '靈體', construct: '構裝', plant: '植物', demon: '魔族', elemental: '元素', fey: '妖精',
}

/** knownEnemy：層主護衛的怪物算不算存在（匯入時同一包裡的新怪物也算） */
export function sanitizeEnemy(id: string, raw: Partial<EnemyMod>, custom: boolean, knownEnemy: (id: string) => boolean = (x) => !!enemies[x]): EnemyMod {
  const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, int(raw.attrs?.[a], 1, 30, 10)])) as EnemyDef['attrs']
  const w = raw.weapon ?? { dice: '1d6', type: 'slashing', attr: 'str' as AttrId }
  const loot = (raw.loot ?? [])
    .map((l) => ({ item: str(l.item, 30), chance: Math.round(num(l.chance, 0, 1, 0.5) * 100) / 100, qty: int(l.qty, 1, 20, 1) }))
    .filter((l) => l.item && l.chance > 0)
    .map(({ qty, ...l }) => (qty > 1 ? { ...l, qty } : l))
  const money = raw.money_cc && raw.money_cc.length === 2 ? [int(raw.money_cc[0], 0, 1e6, 0), int(raw.money_cc[1], 0, 1e6, 0)] as [number, number] : undefined
  const spawns = (raw.spawns ?? [])
    .filter((p) => p && typeof p.table === 'string' && tableOptions().some((t) => t.key === p.table))
    .map((p) => {
      const out: Placement = { table: p.table, count: int(p.count, 1, 6, 1), ...(int(p.weight, 1, 5, 1) > 1 ? { weight: int(p.weight, 1, 5, 1) } : {}) }
      if (p.table.startsWith('boss:')) {
        delete out.weight
        const guards = (Array.isArray(p.guards) ? p.guards : [])
          .filter((g): g is [string, number] => Array.isArray(g) && typeof g[0] === 'string' && g[0] !== id && knownEnemy(g[0]))
          .slice(0, 2)
          .map(([g, n]) => [g, int(n, 1, 4, 1)] as [string, number])
        if (guards.length) out.guards = guards
      }
      return out
    })
  const out: EnemyMod = {
    id,
    name: str(raw.name, 20) || '未命名的怪物',
    level: int(raw.level, 1, 30, 1),
    attrs,
    hp: int(raw.hp, 1, 9999, 10),
    ap: int(raw.ap, 1, 12, 3),
    weapon: { dice: formatDice(parseDice(String(w.dice ?? ''))), type: DAMAGE_IDS().includes(w.type) ? w.type : 'slashing', attr: ATTR_IDS.includes(w.attr) ? w.attr : 'str' },
    evade: int(raw.evade, -10, 20, 0),
    dr: int(raw.dr, 0, 30, 0),
    xp: int(raw.xp, 0, 99999, 25),
  }
  const res = affinity(raw.resist)
  if (res) out.resist = res
  const off = affinity(raw.offense, 7)
  if (off) out.offense = off
  // 怪物沒有法術環：只能用技能與戲法
  const abil = (raw.abilities ?? []).filter((a) => !!abilities[a] && abilities[a]!.type !== 'spell')
  if (abil.length) out.abilities = [...new Set(abil)]
  // 生命低於 X% 才能用的技能：只留還在技能清單上的
  const gates = Object.entries(raw.ability_hp_below ?? {})
    .filter(([a]) => out.abilities?.includes(a))
    .map(([a, v]) => [a, int(v, 1, 99, 50)] as const)
  if (gates.length) out.ability_hp_below = Object.fromEntries(gates)
  if (money && (money[0] || money[1])) out.money_cc = [Math.min(...money), Math.max(...money)]
  if (loot.length) out.loot = loot
  if (raw.kind && ENEMY_KINDS[raw.kind]) out.kind = raw.kind
  if (raw.armed) out.armed = true
  if (raw.rut) out.rut = raw.rut === 'field' ? 'field' : true
  const girlName = str(raw.girl?.name, 20)
  const girlDesc = str(raw.girl?.desc, 300)
  if (girlName && girlDesc) out.girl = { name: girlName, desc: girlDesc }
  const traits = (raw.traits ?? []).filter((t) => !!monsterTraits.traits[t])
  if (traits.length) out.traits = traits
  if (str(raw.desc, 200)) out.desc = str(raw.desc, 200)
  const icon = sanitizeIcon(raw.icon)
  if (icon) out.icon = icon
  if (raw.habitats?.length) out.habitats = raw.habitats
  if (custom) out.custom = true
  if (spawns.length) out.spawns = spawns
  const exclude = (raw.exclude ?? []).filter((k) => typeof k === 'string')
  if (exclude.length) out.exclude = [...new Set(exclude)]
  return out
}

const CATEGORIES: ItemCategory[] = ['food', 'consumable', 'gear', 'material', 'scroll', 'equipment', 'info', 'furniture']
export const SHOP_TAGS = ['general', 'temple', 'tavern', 'smith', 'tailor', 'jeweler', 'magic', 'info']
const LOCATIONS = ['village', 'town', 'city', 'capital']

function sanitizeUse(u: ItemUse | undefined): ItemUse | undefined {
  if (!u || typeof u !== 'object') return undefined
  const out: ItemUse = {}
  if (u.condition && companionRules.conditions[u.condition]) out.condition = u.condition
  // 書籍：可以學的特質（清單裡的）
  const perks = (Array.isArray(u.perks) ? u.perks : []).filter((id) => typeof id === 'string' && isChoosablePerk(id)).slice(0, 6)
  if (perks.length) out.perks = perks
  // 技能書：依序學會的能力
  const abil = (Array.isArray(u.abilities) ? u.abilities : []).filter((id) => typeof id === 'string' && !!abilities[id] && !abilities[id]!.classes.includes('monster')).slice(0, 8)
  if (abil.length) out.abilities = [...new Set(abil)]
  if (u.heal && DICE.test(String(u.heal).replace(/\s+/g, ''))) out.heal = String(u.heal).replace(/\s+/g, '')
  if (u.slot) out.slot = int(u.slot, 1, 9, 1)
  const cleanse = (u.cleanse ?? []).filter((s) => !!statuses[s])
  if (cleanse.length) out.cleanse = cleanse
  if (u.status?.id && statuses[u.status.id]) out.status = { id: u.status.id, turns: int(u.status.turns, 1, 20, 3) }
  if (u.temp_hp) out.temp_hp = int(u.temp_hp, 1, 999, 10)
  if (u.ap) out.ap = int(u.ap, 1, 10, 1)
  if (u.lust) out.lust = int(u.lust, -200, 200, 0) || undefined
  if (!out.lust) delete out.lust
  if (u.revive) out.revive = Math.round(num(u.revive, 0.01, 1, 0.3) * 100) / 100
  if (u.damage?.dice && DICE.test(String(u.damage.dice).replace(/\s+/g, ''))) {
    out.damage = { dice: String(u.damage.dice).replace(/\s+/g, ''), type: DAMAGE_IDS().includes(u.damage.type) ? u.damage.type : 'fire' }
  }
  if (u.apply?.status && statuses[u.apply.status]) {
    out.apply = {
      status: u.apply.status, turns: int(u.apply.turns, 1, 20, 2),
      ...(u.apply.save && ATTR_IDS.includes(u.apply.save) ? { save: u.apply.save, dc: int(u.apply.dc, 5, 30, 12) } : {}),
    }
  }
  if (u.save?.attr && ATTR_IDS.includes(u.save.attr) && (out.damage || out.apply)) out.save = { attr: u.save.attr, dc: int(u.save.dc, 5, 30, 13) }
  if (u.escape) out.escape = true
  if ((out.damage || out.apply) && u.area === 'all') out.area = 'all'
  else if (out.damage || out.apply) out.area = 'one'
  if (u.combat_only || out.damage || out.apply || out.status || out.temp_hp || out.ap || out.lust || out.revive || out.cleanse || out.escape) {
    if (!(out.heal || out.slot) || u.combat_only) out.combat_only = true
  }
  return Object.keys(out).length ? out : undefined
}

export function sanitizeGearSpecLoose(g: GearSpec | undefined): GearSpec | undefined {
  if (!g || !gearRules.bases[g.base] || !gearRules.materials[g.material]) return undefined
  if (gearRules.bases[g.base]!.kind !== gearRules.materials[g.material]!.kind) return undefined
  const out: GearSpec = { base: g.base, material: g.material }
  if (g.rarity && RARITY_ORDER.includes(g.rarity) && g.rarity !== gearRules.materials[g.material]!.rarity) out.rarity = g.rarity
  if (g.enchants) {
    const e = { ...(mods(g.enchants.mods, -5, 5) ? { mods: mods(g.enchants.mods, -5, 5) } : {}), ...(affinity(g.enchants.resist) ? { resist: affinity(g.enchants.resist) } : {}), ...(affinity(g.enchants.offense) ? { offense: affinity(g.enchants.offense) } : {}) }
    if (Object.keys(e).length) out.enchants = e
  }
  // 獨特物品的檢定加值：一種（一組篩選條件），+1～+3
  const u = g.unique ? cleanPerkEffects([g.unique], UNIQUE_LIMITS)[0] : undefined
  if (u && 'check' in u) out.unique = { check: u.check, bonus: u.bonus }
  // 屬性的加減：每項 ±max_change
  if (g.attrs && typeof g.attrs === 'object') {
    const max = gearRules.attrs.max_change
    const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, int(g.attrs?.[a], -max, max, 0)]).filter(([, v]) => v))
    if (Object.keys(attrs).length) out.attrs = attrs
  }
  // 慾望指標的加減：每項 ±item_cap（docs/LEWD_STATS.md）
  if (g.lewd && typeof g.lewd === 'object') {
    const cap = lewdRules.gear.item_cap
    const lewd = Object.fromEntries((['lewdness', 'sensitivity', 'endurance', 'submission'] as const).map((k) => [k, int(g.lewd?.[k], -cap, cap, 0)]).filter(([, v]) => v))
    if (Object.keys(lewd).length) out.lewd = lewd
  }
  // 物品自己的拘束程度（底材是拘束具時；和底材一樣時不寫，docs/LEWD_STATS.md 第 7 節）
  const base = gearRules.bases[g.base]!
  if (base.bind && base.bind_kind && g.bind !== undefined) {
    const bind = int(g.bind, 1, 3, base.bind)
    if (bind !== base.bind) out.bind = bind
  }
  // 自帶的鎖（拘束具才有）
  if (base.bind && base.bind_kind && typeof g.lock === 'string' && (LOCK_GRADES as string[]).includes(g.lock)) out.lock = g.lock
  return out
}

/** 獨特物品的檢定加值範圍 */
export const UNIQUE_LIMITS: PerkLimits = { effects: 1, check_bonus: [1, 3], combat: [1, 1], resist: [0, 0] }

/** 物品名稱：最多 20 字，拿掉打造指令用的分隔符號（| 與 *） */
export function cleanItemName(v: unknown): string {
  return str(v, 40).replace(/[|*]/g, '').trim().slice(0, 20)
}

export function sanitizeItem(name: string, raw: Partial<ItemMod>, custom: boolean): ItemMod {
  const category = CATEGORIES.includes(raw.category as ItemCategory) ? raw.category as ItemCategory : 'material'
  const out: ItemMod = {
    name: cleanItemName(name) || '未命名的物品',
    category,
    price_cc: int(raw.price_cc, 0, 1e8, 10),
    tags: (raw.tags ?? []).filter((t) => SHOP_TAGS.includes(t)),
  }
  if (str(raw.desc, 200)) out.desc = str(raw.desc, 200)
  const icon = sanitizeIcon(raw.icon)
  if (icon) out.icon = icon
  if (raw.min_location && LOCATIONS.includes(raw.min_location) && raw.min_location !== 'village') out.min_location = raw.min_location
  const use = sanitizeUse(raw.use)
  if (use) out.use = use
  const gear = category === 'equipment' ? sanitizeGearSpecLoose(raw.gear) : undefined
  if (gear) out.gear = gear
  // 主人會強制裝備：只有裝備；身分標籤只留主人可以有的
  if (gear && raw.master_force) {
    const tags = (raw.master_force.tags ?? []).filter((t) => !!slaveryRules.master_tags.tags[t])
    out.master_force = tags.length ? { tags: [...new Set(tags)] } : {}
  }
  const forge = (raw.forge?.materials ?? []).filter((m) => !!gearRules.materials[m])
  if (forge.length) out.forge = { materials: [...new Set(forge)] }
  if (raw.event) out.event = true
  if (raw.adult) out.adult = true
  // 鎖（雙面效應）：替身上的拘束具上鎖
  if (category === 'gear' && raw.lock && (LOCK_GRADES as string[]).includes(raw.lock)) out.lock = raw.lock
  // 淫市的貨：魅氣濃度至少多少才買得到
  if (raw.charm_min) out.charm_min = int(raw.charm_min, 1, 4, 3)
  // 鑰匙：打開別人鎖上的拘束具（一次性）
  if (category === 'gear' && !out.lock && raw.key && (LOCK_GRADES as string[]).includes(raw.key)) out.key = raw.key
  // 黑市：只有獨特物品
  if (raw.black_market && gear?.unique) out.black_market = true
  if (category === 'info' && raw.intel) {
    const it = raw.intel
    const kind = (['point', 'story', 'lead'] as const).includes(it.kind) ? it.kind : 'point'
    const intel: NonNullable<ItemMod['intel']> = { kind }
    if (kind === 'point') {
      if (it.event && ['combat', 'chest', 'merchant'].includes(it.event)) intel.event = it.event
      const loc = geography.locations.find((l) => l.id === it.location)
      if (loc) {
        intel.location = loc.id
        if (loc.type === 'dungeon' && it.layer && CHEST_LAYERS.includes(it.layer)) intel.layer = it.layer
      }
      if (it.days) intel.days = int(it.days, 1, 30, 5)
    }
    if (kind === 'story' && str(it.story, 80)) intel.story = str(it.story, 80)
    out.intel = intel
  }
  if (category === 'gear' && raw.tool && TOOL_KINDS.includes(raw.tool.kind)) {
    const def = itemRules.tools[raw.tool.kind]
    out.tool = { kind: raw.tool.kind, ...(def.bonus !== undefined ? { bonus: int(raw.tool.bonus ?? def.bonus, 1, def.max ?? 10, def.bonus) } : {}) }
    // 工藝工具：哪種工藝、低階或中階（高階是房子裡的工作台，不能是隨身物品）
    if (raw.tool.kind === 'craft') {
      out.tool.craft = CRAFT_IDS.includes(raw.tool.craft as never) ? raw.tool.craft : 'smithing'
      out.tool.tier = raw.tool.tier === 2 ? 2 : 1
    }
    // 照明：燒另一種物品（油燈的燈油）
    const fuel = typeof raw.tool.fuel === 'string' ? cleanItemName(raw.tool.fuel) : ''
    if (raw.tool.kind === 'light' && fuel && fuel !== name) out.tool.fuel = fuel
  }
  // 家具：能放的地方、功能、舒適度
  if (category === 'furniture') {
    const f: Partial<FurnitureSpec> = raw.furniture ?? {}
    const places = (Array.isArray(f.places) ? f.places : []).filter((p): p is FurniturePlace => p === 'indoor' || p === 'yard' || p === 'basement')
    out.furniture = {
      places: places.length ? [...new Set(places)] : ['indoor'],
      ...(f.function === 'bed' || f.function === 'workbench' || f.function === 'garden' || f.function === 'training' ? { function: f.function } : {}),
      ...(f.function === 'workbench' ? { craft: CRAFT_IDS.includes(f.craft as never) ? f.craft : 'smithing' } : {}),
      ...(f.function === 'training' ? { training: int(f.training, 1, 3, 1) } : {}),
      ...(int(f.comfort, 0, 10, 0) ? { comfort: int(f.comfort, 0, 10, 0) } : {}),
      ...(typeof f.icon === 'string' && f.icon.trim() ? { icon: [...f.icon.trim()].slice(0, 2).join('') } : {}),
    }
  }
  // 配方：怎麼做出這件物品（裝備走打造，不用配方）；材料不能是自己，同名的合併
  if (category !== 'equipment' && raw.recipe) {
    const r: Partial<RecipeSpec> = raw.recipe
    const inputs = new Map<string, number>()
    for (const x of Array.isArray(r.inputs) ? r.inputs : []) {
      const n = cleanItemName(x?.name)
      if (n && n !== out.name && (inputs.has(n) || inputs.size < 6)) inputs.set(n, Math.min(99, (inputs.get(n) ?? 0) + int(x?.qty, 1, 99, 1)))
    }
    if (inputs.size) {
      const qty = int(r.qty, 1, 20, 1)
      const cost = int(r.cost_cc, 0, 1e7, 0)
      out.recipe = {
        craft: CRAFT_IDS.includes(r.craft as never) ? r.craft! : 'alchemy',
        level: int(r.level, 1, craftRules.max_level, 1),
        inputs: [...inputs].map(([n, q]) => ({ name: n, qty: q })),
        ...(qty > 1 ? { qty } : {}),
        ...(cost ? { cost_cc: cost } : {}),
        hours: int(r.hours, 1, 48, 2),
      }
    }
  }
  // 種子：種在苗圃上長出什麼（材料才能當種子）
  if (category === 'material' && raw.seed) {
    const sd: Partial<SeedSpec> = raw.seed
    const yields = [...new Set((Array.isArray(sd.yields) ? sd.yields : []).map(cleanItemName).filter((n) => n && n !== out.name))].slice(0, 5)
    if (yields.length) {
      const lo = int(sd.qty?.[0], 1, 20, 1)
      const hi = int(sd.qty?.[1], 1, 20, lo)
      const place: FurniturePlace = sd.place === 'basement' || sd.place === 'indoor' ? sd.place : 'yard'
      out.seed = { yields, qty: [Math.min(lo, hi), Math.max(lo, hi)], days: int(sd.days, 1, 30, 3), place }
    }
  }
  // 光源與燃料：每一份能照亮幾格
  if (category === 'gear' && raw.burns !== undefined && raw.burns !== null && String(raw.burns) !== '') {
    const b = int(raw.burns, 0, 999, 0)
    if (b) out.burns = b
  }
  if (custom) out.custom = true
  if (raw.chests) {
    const c: Partial<Record<ChestLayer, number>> = {}
    for (const l of CHEST_LAYERS) {
      const p = Math.round(num(raw.chests[l], 0, 1, 0) * 100) / 100
      if (p) c[l] = p
    }
    out.chests = c
  }
  if (raw.gather) out.gather = raw.gather.filter((g): g is GatherPlace => g === 'wild' || g === 'dungeon')
  return out
}

const SCALES = ['full', 'half', 'up', 'third', 'third_up', 'res']

export function sanitizeBase(raw: Partial<BaseMod>, custom: boolean, id?: string): BaseMod {
  const kind = (['metal', 'leather', 'cloth', 'wood', 'jewel'] as const).includes(raw.kind as 'metal') ? raw.kind! : 'metal'
  const slots = Object.keys(baseSlots())
  // 內建底材的部位不能改：先決定，武器與防具的部分才不會因為沒寫 slot 被跳過
  const builtin = !custom && id ? snapshot.bases[id] : undefined
  const slot = builtin ? builtin.slot : slots.includes(raw.slot as string) ? raw.slot! : 'main_hand'
  const out: BaseMod = { slot, name: str(raw.name, 12) || '未命名的底材', kind, price: int(raw.price, 1, 1e7, 100) }
  if (raw.two_handed && slot === 'main_hand') out.two_handed = true
  const stats = mods(raw.stats)
  if (stats) out.stats = stats
  if (raw.threat) out.threat = Math.round(num(raw.threat, -1, 1, 0) * 100) / 100
  const scale: Partial<Record<keyof Mods, BaseDef['scale'] extends Partial<Record<string, infer S>> | undefined ? S : never>> = {}
  for (const [k, v] of Object.entries(raw.scale ?? {})) if (MOD_KEYS.includes(k as keyof Mods) && SCALES.includes(v as string)) (scale as Record<string, unknown>)[k] = v
  if (Object.keys(scale).length) out.scale = scale
  const rs: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.resist_scale ?? {})) if (AFFINITY_KEYS().includes(k) && SCALES.includes(v)) rs[k] = v
  if (Object.keys(rs).length) out.resist_scale = rs as BaseDef['resist_scale']
  if (str(raw.desc, 120)) out.desc = str(raw.desc, 120)
  const icon = sanitizeIcon(raw.icon)
  if (icon) out.icon = icon
  // 指向別的武器、防具類型時複製原版的數值（不是目前世界改過的），名稱用底材的；
  // 內建底材只能指向自己原本的類型（改它的數值用 weaponDef、armorDef）：指向別的會讓所有用到這種類型的職業與 NPC 一起變
  const ref = <T>(id: string | undefined, own: string | undefined, table: Record<string, T>) => (id && (!builtin || id === own) ? table[id] : undefined)
  if (slot === 'main_hand') {
    const copied = ref(raw.weapon, builtin?.weapon, snapshot.weapons)
    const w = raw.weaponDef ?? copied
    if (w) {
      out.weaponDef = {
        name: (raw.weaponDef && str(w.name, 12)) || out.name, dice: dice(w.dice, '1d6'), type: DAMAGE_IDS().includes(w.type) ? w.type : 'slashing',
        attr: ATTR_IDS.includes(w.attr) ? w.attr : 'str', ...(w.scale ? { scale: w.scale } : {}), ...(w.threat ? { threat: w.threat } : {}),
      }
    }
  }
  if (slot === 'body') {
    const a = raw.armorDef ?? ref(raw.armor, builtin?.armor, snapshot.armors)
    if (a) {
      out.armorDef = {
        name: (raw.armorDef && str(a.name, 12)) || out.name, evade: int(a.evade, -10, 10, 0), dr: int(a.dr, 0, 20, 0),
        ...(affinity(a.resist) ? { resist: affinity(a.resist) } : {}), ...(affinity(a.offense) ? { offense: affinity(a.offense) } : {}),
        ...(a.threat ? { threat: Math.round(num(a.threat, -1, 1, 0) * 100) / 100 } : {}),
      }
    }
  }
  if (custom) out.custom = true
  // 內建底材的欄位、材料類型、雙手、是不是束縛用不能改：存檔裡的裝備、職業的起始武器與制式裝備都靠它們
  if (builtin) {
    out.slot = builtin.slot
    out.kind = builtin.kind
    if (builtin.two_handed) out.two_handed = true
    else delete out.two_handed
  }
  // 服裝的分類與成人向（成人向的服裝一定是成人向）
  if (raw.outfit && raw.outfit in OUTFIT_KINDS && out.slot !== 'main_hand' && out.slot !== 'off_hand') out.outfit = raw.outfit
  if (raw.adult || out.outfit === 'adult') out.adult = true
  // 曝露度（慾望指標的曝露名聲）：只有上身、下身與內衣有意義
  if (raw.exposure !== undefined && raw.exposure !== null && String(raw.exposure) !== '') out.exposure = int(raw.exposure, 0, 3, 0)
  // 雙面效應（docs/LEWD_STATS.md 第 7 節）：拘束的程度與種類
  if (raw.bind && raw.bind_kind && (BIND_KINDS as string[]).includes(raw.bind_kind)) {
    out.bind = int(raw.bind, 1, 3, 1)
    out.bind_kind = raw.bind_kind
  }
  // 地下城專屬的底材：內建的照原本，自建的可以勾
  if (builtin ? builtin.exclusive : raw.exclusive) out.exclusive = true
  // 束縛用（主人強制裝備的項圈、鐐銬）：沒有加成，不能是武器或上身防具
  const restraint = builtin ? !!builtin.restraint : !!raw.restraint && out.slot !== 'main_hand' && out.slot !== 'body'
  if (restraint) {
    out.restraint = true
    for (const k of ['stats', 'scale', 'resist_scale', 'threat', 'weapon', 'weaponDef', 'armor', 'armorDef', 'two_handed'] as const) delete out[k]
  }
  return out
}

export function sanitizeMaterial(raw: Partial<MaterialMod>, custom: boolean, id?: string): MaterialMod {
  const kind = (['metal', 'leather', 'cloth', 'wood', 'jewel'] as const).includes(raw.kind as 'metal') ? raw.kind! : 'metal'
  const out: MaterialMod = {
    kind, name: str(raw.name, 8) || '未命名', tier: int(raw.tier, 1, MAX_TIER, 1), bonus: int(raw.bonus, 0, 12, 0),
    rarity: RARITY_ORDER.includes(raw.rarity as string) ? raw.rarity! : 'common', level: int(raw.level, 1, 30, 1), price: Math.max(0.1, num(raw.price, 0.1, 1e5, 1)),
  }
  const armor = mods(raw.armor, -5, 5)
  if (armor) out.armor = armor
  const res = affinity(raw.resist)
  if (res) out.resist = res
  if (str(raw.desc, 120)) out.desc = str(raw.desc, 120)
  if (str(raw.series, 16)) out.series = str(raw.series, 16)
  if (custom) out.custom = true
  // 內建材料的類型與等級不能改：隨機裝備、起始裝備與 NPC 的配備依「類型 × 等級」找材料
  const builtin = !custom && id ? snapshot.materials[id] : undefined
  if (builtin) {
    out.kind = builtin.kind
    out.tier = builtin.tier
  }
  return out
}

/** 讀取保存的設定或匯入的檔案：整理每一項，壞掉的略過 */
export function normalizeMods(raw: unknown): ContentMods {
  const out = emptyMods()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Partial<ContentMods>
  // 狀態最先：能力、物品與其他狀態的命中附加會檢查狀態存不存在（自建的狀態彼此也可以互相引用）
  const statusIds = new Set([...Object.keys(statuses), ...Object.keys(r.statuses ?? {})])
  for (const [id, v] of Object.entries(r.statuses ?? {})) out.statuses[id] = sanitizeStatus(id, v, !!v.custom || !snapshot.statuses[id], statusIds)
  for (const [id, s] of Object.entries(out.statuses)) if (s.custom && !statuses[id]) statuses[id] = strip(s, ['custom'])
  // 非戰鬥狀態：任務、事件、地標的效果與物品會檢查存不存在，先登錄自建的（id 不對的略過）
  const conditionRaw = Object.entries(r.conditions ?? {}).filter(([id, v]) => !!v && typeof v === 'object' && (!!builtinCondition(id) || CONDITION_ID.test(id)))
  const knownConditions = new Set([...conditionIds(), ...conditionRaw.map(([id]) => id)])
  for (const [id, v] of conditionRaw) out.conditions[id] = sanitizeCondition(id, v, !!v.custom || !builtinCondition(id), knownConditions)
  for (const [id, c] of Object.entries(out.conditions)) if (c.custom && !companionRules.conditions[id]) companionRules.conditions[id] = strip(c, ['custom'])
  // 劇情計數器：任務與事件的檢查會看計數器存不存在，先登錄自建的
  for (const [id, v] of Object.entries(r.counters ?? {})) {
    const key = cleanCounterId(id)
    if (key && v && typeof v === 'object') out.counters[key] = sanitizeCounter(v, !!v.custom || !builtinCounter(key))
  }
  for (const [id, c] of Object.entries(out.counters)) if (c.custom && !storyCounters[id]) storyCounters[id] = strip(c, ['custom'])
  // 刺青圖樣與奴隸印記：特殊任務的效果會檢查存不存在，先登錄自建的
  for (const [id, v] of Object.entries(r.tattoos ?? {})) {
    const t = sanitizeTattooMod(v, !!v.custom || !snapshot.tattoos[id])
    if (t) out.tattoos[id] = t
  }
  for (const [id, t] of Object.entries(out.tattoos)) if (t.custom && !tattooRules.templates[id]) tattooRules.templates[id] = strip(t, ['custom'])
  for (const [id, v] of Object.entries(r.marks ?? {})) out.marks[id] = sanitizeMarkMod(v, !!v.custom || !snapshot.marks[id])
  for (const [id, m] of Object.entries(out.marks)) if (m.custom && !slaveryRules.contracts[id]) slaveryRules.contracts[id] = strip(m, ['custom'])
  if (r.markRules?.rules) out.markRules.rules = sanitizeMarkRules(r.markRules.rules, new Set([...Object.keys(snapshot.marks), ...Object.keys(out.marks)]), builtinMarkRules())
  for (const [id, v] of Object.entries(r.abilities ?? {})) out.abilities[id] = sanitizeAbility(id, v, !!v.custom || !snapshot.abilities[id])
  // 怪物、固定 NPC 與任務的整理會檢查能力存不存在：先把自建的能力登錄進去（之後 applyContent 會重新套用一次）
  for (const [id, a] of Object.entries(out.abilities)) if (a.custom && !abilities[id]) abilities[id] = { ...strip(a, ['custom']), id }
  // 物品（書籍）、固定 NPC、任務與其他特質的整理會檢查特質存不存在：先把自建的特質登錄進去
  // 排斥的對象：已載入的、或同一包裡的非種族特質（還沒登錄也算）
  const knownPerk = (x: string) => isChoosablePerk(x) || (!!r.perks?.[x] && typeof r.perks[x] === 'object' && !builtinPerk(x)?.race)
  for (const [id, v] of Object.entries(r.perks ?? {})) {
    const p = sanitizePerkMod(id, v, !!v.custom || !builtinPerk(id), knownPerk)
    if (p) out.perks[id] = p
  }
  for (const [id, p] of Object.entries(out.perks)) if (p.custom && !perkDef(id)) registerPerk(id, p)
  for (const [id, v] of Object.entries(r.materials ?? {})) out.materials[id] = sanitizeMaterial(v, !!v.custom || !snapshot.materials[id], id)
  for (const [id, v] of Object.entries(r.bases ?? {})) out.bases[id] = sanitizeBase(v, !!v.custom || !snapshot.bases[id], id)
  // 物品、固定 NPC 與任務的裝備組成會檢查底材與材料存不存在：先把自建的登錄進去（之後 applyContent 會重新套用一次）
  for (const [id, m] of Object.entries(out.materials)) if (m.custom && !gearRules.materials[id]) gearRules.materials[id] = strip(m, ['custom'])
  for (const [id, b] of Object.entries(out.bases)) if (b.custom && !gearRules.bases[id]) gearRules.bases[id] = strip(b, ['custom', 'weaponDef', 'armorDef'])
  for (const [raw, v] of Object.entries(r.items ?? {})) {
    const name = cleanItemName(raw)
    if (name) out.items[name] = sanitizeItem(name, v, !!v.custom || !snapshot.items.some((i) => i.name === name))
  }
  // 地標：固定 NPC 與特殊任務的任務點會檢查存不存在，先登錄自建的
  for (const [id, v] of Object.entries(r.landmarks ?? {})) {
    try {
      out.landmarks[id] = sanitizeLandmarkMod(id, v)
    } catch {
      // 位置或 id 不對的：略過
    }
  }
  for (const [id, l] of Object.entries(out.landmarks)) if (l.custom && !landmarks[id]) applyLandmarkMod(id, l)
  // 特殊地圖：特殊任務會檢查存不存在，先登錄自建的。遭遇表與資源可以用同一包裡的怪物與物品（還沒整理也算）
  const packageRefs = { enemy: (x: string) => !!enemies[x] || !!r.enemies?.[x], item: (n: string) => !!itemDef(n) || !!out.items[n] }
  const knownMaps = { ...specialMaps, ...(r.specialMaps ?? {}) }
  for (const [id, v] of Object.entries(r.specialMaps ?? {})) {
    try {
      out.specialMaps[id] = sanitizeSpecialMapMod(id, v, knownMaps, new Set([...Object.keys(shopRules.types), ...Object.keys(r.shops ?? {})]), packageRefs)
    } catch {
      // id 不對的：略過
    }
  }
  for (const [id, m] of Object.entries(out.specialMaps)) if (m.custom && !specialMaps[id]) applySpecialMapMod(id, m)
  // 商店的固定清單會檢查物品：自建的物品還沒登錄，一起算
  // 自建的底材或材料會自動產生裝備（applyContent 才加進目錄）：名稱先算出來
  const generated = new Set(generatedGear(out).map(([name]) => name))
  const listable = (n: string) => (out.items[n] ? !notForSale(out.items[n]!) : canListItem(n) || generated.has(n))
  for (const [id, v] of Object.entries(r.shops ?? {})) {
    try {
      out.shops[id] = sanitizeShopMod(id, v, listable)
    } catch {
      // 不存在的店（例如之後的版本拿掉了）：略過
    }
  }
  for (const [id, v] of Object.entries(r.enemies ?? {})) out.enemies[id] = sanitizeEnemy(id, v, !!v.custom || !snapshot.enemies[id], (x) => !!enemies[x] || !!r.enemies?.[x])
  for (const [id, v] of Object.entries(r.npcs ?? {})) out.npcs[id] = sanitizeNpc(id, v, !!v.custom || !builtinNpc(id))
  for (const [id, v] of Object.entries(r.stories ?? {})) out.stories[id] = sanitizeStory(id, v, !!v.custom || !builtinStory(id))
  // 城鎮事件的設施可以是同一包裡的自建商店（還沒套用）
  const newShops = Object.entries(out.shops).filter(([, s]) => s.custom).map(([id]) => id)
  for (const [id, v] of Object.entries(r.travelEvents ?? {})) {
    if (typeof id === 'string' && id.length <= 60) out.travelEvents[id] = sanitizeTravelEvent(id, v, !!v.custom || !builtinTravelEvent(id), newShops)
  }
  if (r.eventRules?.rules) out.eventRules.rules = sanitizeEventRules(r.eventRules.rules)
  if (r.bindRules?.rules) (out.bindRules ??= {}).rules = sanitizeBindRules(r.bindRules.rules)
  for (const [id, v] of Object.entries(r.masterEvents ?? {})) {
    if (typeof id === 'string' && id.length <= 60 && v && typeof v === 'object') (out.masterEvents ??= {})[id] = sanitizeMasterEvent(id, v, !!v.custom || !builtinMasterEvent(id))
  }
  for (const [k, v] of Object.entries(r.categoryIcons ?? {})) {
    const icon = sanitizeIcon(v?.icon)
    if (icon && CATEGORIES.includes(k as ItemCategory)) out.categoryIcons[k] = { icon }
  }
  return out
}

// ---- 固定 NPC ----

const GEAR_SLOTS = Object.keys(gearRules.slots) as GearSlot[]

function settlementIds(): string[] {
  return geography.locations.filter((l) => l.type !== 'dungeon').map((l) => l.id)
}

/** 劇情旗標的條件：名稱整理過、去掉重複 */
function cond(v: unknown): NpcDef['requires'] {
  if (!v || typeof v !== 'object') return undefined
  const r = v as { flags?: unknown; flags_none?: unknown; flags_any?: unknown; counters?: unknown; affinity?: unknown; parasites?: unknown; stats?: unknown; charm?: unknown; wearing?: unknown; pc_tags?: unknown; after?: unknown }
  const list = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).map(cleanFlag).filter(Boolean))]
  const flags = list(r.flags)
  const none = list(r.flags_none)
  const any = list(r.flags_any)
  // 計數器的範圍：計數器 id → { min, max }（至少要有一邊）
  const counters: Record<string, { min?: number; max?: number }> = {}
  for (const [id, x] of Object.entries(r.counters && typeof r.counters === 'object' ? r.counters : {})) {
    const key = cleanCounterId(id)
    const o = x && typeof x === 'object' ? x as { min?: unknown; max?: unknown } : {}
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : undefined)
    const min = num(o.min)
    const max = num(o.max)
    if (key && (min !== undefined || max !== undefined)) counters[key] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
  }
  const hasCount = Object.keys(counters).length > 0
  // 好感條件：角色 id → 最低值（-100～100）
  const affinity = Object.fromEntries(Object.entries(r.affinity && typeof r.affinity === 'object' ? r.affinity : {})
    .filter(([id, n]) => typeof id === 'string' && id.trim() && typeof n === 'number' && Number.isFinite(n))
    .map(([id, n]) => [id.trim().slice(0, 60), Math.max(-100, Math.min(100, Math.round(n as number)))]))
  const hasAff = Object.keys(affinity).length > 0
  // 寄生物：寄生物 id → { min, max（侵蝕度 0～100）, tamed }（只收存在的寄生物）
  const parasites: Record<string, { min?: number; max?: number; tamed?: boolean }> = {}
  for (const [id, x] of Object.entries(r.parasites && typeof r.parasites === 'object' ? r.parasites : {})) {
    if (!parasiteDef(id)) continue
    const o = x && typeof x === 'object' ? x as { min?: unknown; max?: unknown; tamed?: unknown } : {}
    const pct = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined)
    const min = pct(o.min)
    const max = pct(o.max)
    parasites[id] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(typeof o.tamed === 'boolean' ? { tamed: o.tamed } : {}) }
  }
  const hasPar = Object.keys(parasites).length > 0
  // 慾望指標：指標 → { min, max }（0～100，至少要有一邊）
  const stats: NonNullable<StoryCond['stats']> = {}
  for (const [k, x] of Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {})) {
    if (!['lewdness', 'sensitivity', 'endurance', 'submission', 'exposure'].includes(k)) continue
    const o = x && typeof x === 'object' ? x as { min?: unknown; max?: unknown } : {}
    const pct = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined)
    const min = pct(o.min)
    const max = pct(o.max)
    if (min !== undefined || max !== undefined) stats[k as keyof typeof stats] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
  }
  const hasStats = Object.keys(stats).length > 0
  // 魅氣濃度：{ min, max }（1～4，至少要有一邊）
  const co = r.charm && typeof r.charm === 'object' ? r.charm as { min?: unknown; max?: unknown } : {}
  const lv = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(4, Math.round(n))) : undefined)
  const charm = { ...(lv(co.min) !== undefined ? { min: lv(co.min) } : {}), ...(lv(co.max) !== undefined ? { max: lv(co.max) } : {}) }
  const hasCharm = Object.keys(charm).length > 0
  // 主角戴著什麼：bind、locked、adult_outfit、mark 是布林；bind_kind 是拘束的種類
  const wo = r.wearing && typeof r.wearing === 'object' ? r.wearing as Record<string, unknown> : {}
  const wearing: NonNullable<StoryCond['wearing']> = {}
  for (const k of ['bind', 'locked', 'adult_outfit', 'mark'] as const) if (typeof wo[k] === 'boolean') wearing[k] = wo[k] as boolean
  if (typeof wo.bind_kind === 'string' && (BIND_KINDS as string[]).includes(wo.bind_kind)) wearing.bind_kind = wo.bind_kind as BindKind
  const hasWear = Object.keys(wearing).length > 0
  // 主角的身分標籤（至少一個）：只收存在的標籤
  const pcTags = [...new Set((Array.isArray(r.pc_tags) ? r.pc_tags : []).filter((t): t is string => typeof t === 'string' && !!npcTags.tags[t]))]
  // 某個特殊任務（或任務點）結束後幾天（1～60 天；任務不存在由 storyCheck 提醒）
  const ao = r.after && typeof r.after === 'object' ? r.after as { story?: unknown; node?: unknown; days?: unknown } : {}
  const afterStory = typeof ao.story === 'string' ? ao.story.trim().slice(0, 60) : ''
  const afterDays = typeof ao.days === 'number' && Number.isFinite(ao.days) ? Math.max(1, Math.min(60, Math.round(ao.days))) : 1
  const after = afterStory ? { story: afterStory, ...(typeof ao.node === 'string' && ao.node.trim() ? { node: ao.node.trim().slice(0, 40) } : {}), days: afterDays } : undefined
  return flags.length || none.length || any.length || hasCount || hasAff || hasPar || hasStats || hasCharm || hasWear || pcTags.length || after
    ? { ...(flags.length ? { flags } : {}), ...(none.length ? { flags_none: none } : {}), ...(any.length ? { flags_any: any } : {}), ...(hasCount ? { counters } : {}), ...(hasAff ? { affinity } : {}), ...(hasPar ? { parasites } : {}), ...(hasStats ? { stats } : {}), ...(hasCharm ? { charm } : {}), ...(hasWear ? { wearing } : {}), ...(pcTags.length ? { pc_tags: pcTags } : {}), ...(after ? { after } : {}) }
    : undefined
}
export { cond as sanitizeCond }

/** 計數器 id：小寫英文、數字、底線，最多 40 字 */
export function cleanCounterId(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) : ''
}

/** 結果裡的計數器加減：計數器 id → 增減（-100～100，0 不收） */
export function sanitizeCounterDeltas(v: unknown): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  for (const [id, d] of Object.entries(v && typeof v === 'object' ? v : {})) {
    const key = cleanCounterId(id)
    const n = typeof d === 'number' && Number.isFinite(d) ? Math.max(-100, Math.min(100, Math.round(d))) : 0
    if (key && n) out[key] = n
  }
  return Object.keys(out).length ? out : undefined
}

function cleanHaunts(v: NpcDef['haunts']): NonNullable<NpcDef['haunts']> {
  return (v ?? [])
    .filter((h) => h && geography.locations.some((l) => l.id === h.location) && ZONES.includes(h.zone as never))
    .map((h) => ({ location: h.location, zone: h.zone, weight: Math.round(num(h.weight, 0.01, 10, 1) * 100) / 100 }))
}

/** 固定的格子：聚落的區塊或固定的特殊地圖、走得到的格子 */
function cleanFixed(v: NpcDef['fixed']): NpcDef['fixed'] {
  if (!v || typeof v.area !== 'string') return undefined
  const area = v.area.startsWith('sm/') ? specialPreview(v.area.slice(3)) : settlementArea(v.area)
  if (!area) return undefined
  const x = int(v.x, 0, area.width - 1, 0)
  const y = int(v.y, 0, area.height - 1, 0)
  const kind = area.cells[y * area.width + x]?.kind
  return kind && kind !== 'wall' && kind !== 'water' ? { area: area.key, x, y } : undefined
}

export function sanitizeNpc(id: string, raw: Partial<NpcMod>, custom: boolean): NpcMod {
  // 沒寫 kind：有戰鬥職業的是冒險者，否則是普通人（和 npcs.ts 的 npcKind 同一條規則）
  const combatClass = !!raw.class && !!classes[raw.class] && !classes[raw.class]!.noncombat
  const kind = raw.kind === 'commoner' || raw.kind === 'adventurer' ? raw.kind : combatClass ? 'adventurer' : 'commoner'
  const cls = kind === 'commoner' ? '' : raw.class && classes[raw.class] && !classes[raw.class]!.noncombat ? raw.class : 'fighter'
  const location = settlementIds().includes(raw.location ?? '') ? raw.location! : 'soriel'
  const out: NpcMod = {
    id,
    name: str(raw.name, 16) || '未命名',
    race: raw.race && attributeRules.races[raw.race] ? raw.race : 'human',
    class: cls,
    level: int(raw.level, 1, 20, 1),
    location,
    hire_cc: int(raw.hire_cc, 0, 1e7, kind === 'commoner' ? 0 : 100),
    personality: str(raw.personality, 160) || '沉默寡言。',
    kind,
  }
  if (raw.gender && GENDER_IDS.includes(raw.gender)) out.gender = raw.gender
  if (raw.unhireable && kind === 'adventurer') out.unhireable = true
  // 普通人本來就不能被攻擊，只有冒險者需要「不能偷襲」
  if (raw.no_attack && kind === 'adventurer') out.no_attack = true
  if (raw.no_steal) out.no_steal = true
  if (raw.adult) out.adult = true
  if (str(raw.appearance, 240)) out.appearance = str(raw.appearance, 240)
  if (str(raw.adult_appearance, 240)) out.adult_appearance = str(raw.adult_appearance, 240)
  if (str(raw.background, 400)) out.background = str(raw.background, 400)
  if (str(raw.faction, 30)) out.faction = str(raw.faction, 30)
  if (str(raw.occupation, 12)) out.occupation = str(raw.occupation, 12)
  if (str(raw.lineage, 30)) out.lineage = str(raw.lineage, 30)
  const tags = (raw.tags ?? []).filter((t) => !!npcTags.tags[t])
  if (tags.length) out.tags = [...new Set(tags)]
  const haunts = cleanHaunts(raw.haunts)
  if (haunts.length) out.haunts = haunts
  if (raw.relations && typeof raw.relations === 'object') {
    const rel = Object.fromEntries(Object.entries(raw.relations).map(([k, v]) => [k, str(v, 160)]).filter(([, v]) => v))
    if (Object.keys(rel).length) out.relations = rel
  }
  if (raw.attrs) {
    const a = Object.fromEntries(ATTR_IDS.map((k) => [k, raw.attrs?.[k] ? int(raw.attrs[k], 1, 30, 10) : 0]).filter(([, v]) => v))
    if (Object.keys(a).length) out.attrs = a
  }
  const abil = (raw.abilities ?? []).filter((a) => !!abilities[a])
  if (abil.length) out.abilities = [...new Set(abil)]
  // 特質：清單裡的（沒寫時依 id 固定地抽）
  if (Array.isArray(raw.perks)) out.perks = [...new Set(raw.perks.filter((p) => typeof p === 'string' && isChoosablePerk(p)))]
  // 慾望指標：寫了的才存（0～100），沒寫的依標籤與 id 擲
  if (raw.lewd && typeof raw.lewd === 'object') {
    const lewd = Object.fromEntries((['lewdness', 'sensitivity', 'endurance', 'submission'] as const)
      .filter((k) => typeof raw.lewd?.[k] === 'number' && Number.isFinite(raw.lewd[k])).map((k) => [k, int(raw.lewd?.[k], 0, 100, 0)]))
    if (Object.keys(lewd).length) out.lewd = lewd
  }
  // 娼婦光顧時會教的色情技能
  const teaches = [...new Set((Array.isArray(raw.teaches) ? raw.teaches : []).filter((id) => typeof id === 'string' && abilities[id]?.classes.includes('lewd')))].slice(0, 12)
  if (teaches.length) out.teaches = teaches
  if (raw.gear) {
    const g: NonNullable<NpcDef['gear']> = {}
    for (const slot of GEAR_SLOTS) {
      const spec = sanitizeGearSpecLoose(raw.gear[slot])
      const base = spec && gearRules.bases[spec.base]
      if (!spec || !base) continue
      // 底材要放得進這個欄位（戒指放兩個戒指欄）
      if (baseFits(base.slot, slot, base)) g[slot] = spec
    }
    if (Object.keys(g).length) out.gear = g
  }
  const fixed = cleanFixed(raw.fixed)
  if (fixed) out.fixed = fixed
  if (raw.keeper && isKeeperShop(raw.keeper)) out.keeper = raw.keeper
  // 待在所屬地點的地標
  if (typeof raw.landmark === 'string' && landmarks[raw.landmark]?.location === location) out.landmark = raw.landmark
  const req = cond(raw.requires)
  if (req) out.requires = req
  // 依劇情旗標改變出沒：沒有條件的設定沒有意義，拿掉
  const stages = (raw.stages ?? []).flatMap((st) => {
    const r = cond(st?.requires)
    if (!r) return []
    const h = cleanHaunts(st.haunts)
    const f = cleanFixed(st.fixed)
    // 身分改變：名字、背景、性格、標籤（有寫的才取代）
    const name = str(st.name, 16)
    const bg = str(st.background, 400)
    const pers = str(st.personality, 160)
    const tags = Array.isArray(st.tags) ? [...new Set(st.tags.filter((t) => !!npcTags.tags[t]))] : undefined
    return [{
      requires: r, ...(st.hours === 'day' || st.hours === 'night' ? { hours: st.hours } : {}),
      location: settlementIds().includes(st.location) ? st.location : location, ...(h.length ? { haunts: h } : {}), ...(f ? { fixed: f } : {}),
      ...(name ? { name } : {}), ...(bg ? { background: bg } : {}), ...(pers ? { personality: pers } : {}), ...(tags ? { tags } : {}),
    }]
  })
  if (stages.length) out.stages = stages
  // 小隊：隊員是其他角色的 id（不含自己，最多 3 人）；隊員存不存在、有沒有重複加入別隊，由 squads.ts 執行時判斷
  if (raw.squad && typeof raw.squad === 'object' && Array.isArray(raw.squad.members)) {
    const members = [...new Set(raw.squad.members.filter((m): m is string => typeof m === 'string' && !!m.trim() && m !== id).map((m) => m.trim()))].slice(0, 3)
    if (members.length) {
      const r = cond(raw.squad.requires)
      const together = typeof raw.squad.together === 'number' && Number.isFinite(raw.squad.together) ? Math.max(0, Math.min(1, Math.round(raw.squad.together * 100) / 100)) : 1
      out.squad = { name: str(raw.squad.name, 16) || `${out.name}的小隊`, members, ...(together < 1 ? { together } : {}), ...(r ? { requires: r } : {}) }
    }
  }
  if (custom) out.custom = true
  return out
}

// ---- 能力 ----

export const ABILITY_TYPES: Record<AbilityType, string> = { skill: '技能', spell: '法術', cantrip: '戲法' }
export const ABILITY_TARGETS: Record<AbilityTarget, string> = {
  enemy: '一名敵人', ally: '一名隊友', ally_or_downed: '一名隊友（可救起倒下的）', self: '自己',
  all_enemies: '所有敵人', all_allies: '所有隊友', random_enemies: '隨機敵人（數次）',
}
export const ABILITY_RESOLVES: Record<AbilityDef['resolve'], string> = { attack: '命中骰對迴避', save: '目標豁免', auto: '必中' }
/** 可以學這個能力的職業（monster：怪物用） */
export function abilityClasses(): string[] {
  return [...Object.keys(classes).filter((c) => !classes[c]!.noncombat), 'monster', 'lewd']
}

function damagePart(v: unknown): DamagePart | undefined {
  if (!v || typeof v !== 'object') return undefined
  const p = v as DamagePart
  const out: DamagePart = {}
  if (p.weapon) out.weapon = true
  else if (p.dice && DICE.test(String(p.dice).replace(/\s+/g, ''))) out.dice = String(p.dice).replace(/\s+/g, '')
  if (!out.weapon && !out.dice) return undefined
  if (p.type && DAMAGE_IDS().includes(p.type)) out.type = p.type
  if (p.mod) out.mod = true
  if (p.scale?.dice && DICE.test(String(p.scale.dice))) out.scale = { dice: String(p.scale.dice), per: int(p.scale.per, 1, 20, 4) }
  if (p.pierce && out.type === 'lust') out.pierce = true
  return out
}

function applyDef(v: unknown): ApplyDef | undefined {
  if (!v || typeof v !== 'object') return undefined
  const a = v as ApplyDef
  if (!a.status || !statuses[a.status]) return undefined
  const out: ApplyDef = { status: a.status, turns: int(a.turns, 1, 20, 2) }
  if (a.to && ['target', 'self', 'allies', 'enemies'].includes(a.to)) out.to = a.to
  if (a.on && ['hit', 'fail', 'always'].includes(a.on)) out.on = a.on
  if (a.save && ATTR_IDS.includes(a.save)) out.save = a.save
  if (a.if_lust) out.if_lust = Math.round(num(a.if_lust, 0.05, 1, 0.5) * 100) / 100
  if (a.if_slave) out.if_slave = true
  if (a.if_weaker) out.if_weaker = true
  if (a.value && typeof a.value === 'object') {
    const val: NonNullable<ApplyDef['value']> = {}
    if (a.value.dice && DICE.test(String(a.value.dice))) val.dice = String(a.value.dice)
    if (a.value.mod) val.mod = true
    if (a.value.level) val.level = true
    if (a.value.flat) val.flat = int(a.value.flat, -50, 50, 0)
    if (Object.keys(val).length) out.value = val
  }
  return out
}

export function sanitizeAbility(id: string, raw: Partial<AbilityMod>, custom: boolean): AbilityMod {
  const type = (Object.keys(ABILITY_TYPES) as AbilityType[]).includes(raw.type as AbilityType) ? raw.type! : 'skill'
  const target = (Object.keys(ABILITY_TARGETS) as AbilityTarget[]).includes(raw.target as AbilityTarget) ? raw.target! : 'enemy'
  const resolve = (Object.keys(ABILITY_RESOLVES) as AbilityDef['resolve'][]).includes(raw.resolve as AbilityDef['resolve']) ? raw.resolve! : 'auto'
  const allowed = abilityClasses()
  const out: AbilityMod = {
    id,
    name: str(raw.name, 16) || '新的能力',
    type,
    classes: [...new Set((raw.classes ?? []).filter((c) => allowed.includes(c)))],
    target,
    resolve,
    desc: str(raw.desc, 200),
  }
  if (type === 'skill') out.unlock = int(raw.unlock, 1, 20, 1)
  if (type === 'spell') out.circle = int(raw.circle, 1, 9, 1)
  if (raw.ap !== undefined && raw.ap !== null && String(raw.ap) !== '') out.ap = int(raw.ap, 0, 12, 2)
  if (raw.attr === 'casting' || ATTR_IDS.includes(raw.attr as AttrId)) out.attr = raw.attr
  if (target === 'random_enemies') out.count = int(raw.count, 1, 10, 3)
  if (resolve === 'save') {
    out.save = ATTR_IDS.includes(raw.save as AttrId) ? raw.save : 'dex'
    out.on_save = raw.on_save === 'none' ? 'none' : 'half'
  }
  const damage = (raw.damage ?? []).slice(0, 4).map(damagePart).filter((d): d is DamagePart => !!d)
  if (damage.length) out.damage = damage
  if (raw.mult !== undefined && raw.mult !== null && String(raw.mult) !== '' && Number(raw.mult) !== 1) out.mult = Math.round(num(raw.mult, 0.1, 5, 1) * 100) / 100
  if (raw.hits && int(raw.hits, 1, 6, 1) > 1) out.hits = int(raw.hits, 1, 6, 1)
  if (raw.hit) out.hit = int(raw.hit, -10, 10, 0)
  if (raw.adv) out.adv = true
  if (raw.crit) out.crit = int(raw.crit, 1, 5, 1)
  if (raw.heal && typeof raw.heal === 'object') {
    const h: NonNullable<AbilityDef['heal']> = {}
    if (raw.heal.dice && DICE.test(String(raw.heal.dice))) h.dice = String(raw.heal.dice)
    if (raw.heal.mod) h.mod = true
    if (raw.heal.level) h.level = true
    if (raw.heal.flat) h.flat = int(raw.heal.flat, 1, 999, 1)
    if (raw.heal.full) h.full = true
    if (Object.keys(h).length) out.heal = h
  }
  if (raw.shield && (raw.shield.flat || raw.shield.level)) {
    out.shield = { ...(raw.shield.flat ? { flat: int(raw.shield.flat, 1, 999, 5) } : {}), ...(raw.shield.level ? { level: int(raw.shield.level, 1, 10, 1) } : {}) }
  }
  const apply = (raw.apply ?? []).slice(0, 4).map(applyDef).filter((a): a is ApplyDef => !!a)
  if (apply.length) out.apply = apply
  if (raw.ap_gain) out.ap_gain = int(raw.ap_gain, 1, 10, 1)
  if (raw.ap_gain_on_hit) out.ap_gain_on_hit = int(raw.ap_gain_on_hit, 1, 10, 1)
  if (raw.uses) {
    const u: NonNullable<AbilityDef['uses']> = {}
    for (const k of ['per_turn', 'per_combat', 'per_rest'] as const) if (raw.uses[k]) u[k] = int(raw.uses[k], 1, 10, 1)
    if (Object.keys(u).length) out.uses = u
  }
  for (const k of ['concentration', 'cleanse', 'recover_slot', 'kill'] as const) if (raw[k]) out[k] = true
  // 治療、護盾、淨化、回復法術環、直接擊倒只有必中（auto）的結算會處理：其他結算方式拿掉，免得看起來有效
  if (resolve !== 'auto') for (const k of ['heal', 'shield', 'cleanse', 'recover_slot', 'kill'] as const) delete out[k]
  if (raw.lifesteal) out.lifesteal = Math.round(num(raw.lifesteal, 0.05, 1, 0.5) * 100) / 100
  if (raw.vs_slave && raw.vs_slave !== 1) out.vs_slave = Math.round(num(raw.vs_slave, 0.25, 4, 2) * 100) / 100
  if (raw.hp_limit) out.hp_limit = int(raw.hp_limit, 1, 9999, 30)
  if (raw.threat) out.threat = int(raw.threat, -50, 50, 0)
  // 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節）
  if (raw.lust_gain?.flat) out.lust_gain = { flat: int(raw.lust_gain.flat, 1, 200, 10) }
  if (raw.lust_relief) out.lust_relief = int(raw.lust_relief, 1, 200, 10)
  if (raw.lust_cost) out.lust_cost = int(raw.lust_cost, 1, 200, 10)
  if (raw.requires_lust) out.requires_lust = Math.round(num(raw.requires_lust, 0.05, 1, 0.3) * 100) / 100
  if (raw.ap_give) out.ap_give = int(raw.ap_give, 1, 5, 1)
  if (raw.exposure) out.exposure = int(raw.exposure, 1, 10, 1)
  if (raw.lust_transfer && (raw.lust_transfer.mode === 'spread' || raw.lust_transfer.mode === 'take')) {
    const t = raw.lust_transfer
    out.lust_transfer = t.mode === 'spread'
      ? { mode: 'spread', ratio: Math.round(num(t.ratio, 0.05, 1, 0.3) * 100) / 100, ...(t.shield_per ? { shield_per: int(t.shield_per, 1, 50, 5) } : {}) }
      : { mode: 'take', amount: int(t.amount, 1, 999, 20), ...(t.dump ? { dump: true } : {}) }
  }
  if (raw.gamble && typeof raw.gamble === 'object' && statuses[String(raw.gamble.status)]) {
    out.gamble = { status: String(raw.gamble.status), turns: int(raw.gamble.turns, 1, 20, 3), lust: int(raw.gamble.lust, 0, 200, 20) }
  }
  if (raw.burst && typeof raw.burst === 'object') {
    const b = raw.burst
    out.burst = {
      mult: Math.round(num(b.mult, 0.1, 3, 0.5) * 100) / 100,
      ...(b.heal ? { heal: true } : { type: DAMAGE_IDS().includes(String(b.type)) && b.type !== 'lust' ? String(b.type) : 'fire' }),
      ...(b.min_ratio ? { min_ratio: Math.round(num(b.min_ratio, 0.05, 1, 0.5) * 100) / 100 } : {}),
    }
  }
  if (custom) out.custom = true
  return out
}

// ---- 狀態（BUFF／DEBUFF） ----

export const STATUS_CONTROLS: Record<Control, string> = {
  stun: '暈眩（跳過回合、無法迴避）', silence: '沉默（無法施法與戲法）', no_cast: '無法施法', taunt: '嘲諷（只能攻擊施放者）', confuse: '困惑（隨機攻擊任何人）',
}
export const STATUS_SPECIALS: Record<NonNullable<StatusDef['special']>, string> = {
  undying: '致命傷保留 1 HP', halve_next: '下一次受到的傷害減半', reduce_next: '下一次物理傷害減去數值（由施放的能力決定）',
}
export const LUCK_ROLLS: Record<LuckRoll, string> = { attack: '攻擊', evade: '迴避', save: '豁免' }

function rolls(v: unknown): LuckRoll[] | undefined {
  const list = [...new Set((Array.isArray(v) ? v : []).filter((x): x is LuckRoll => typeof x === 'string' && x in LUCK_ROLLS))]
  return list.length ? list : undefined
}

/**
 * 整理狀態：數值夾在範圍內，未知的欄位拿掉。known：命中附加的狀態可以用的 id（預設是目前所有的狀態）。
 * 不能附加自己（會一直疊下去）。
 */
export function sanitizeStatus(id: string, raw: Partial<StatusMod>, custom: boolean, known?: Set<string>): StatusMod {
  const out: StatusMod = { name: str(raw.name, 10) || '新的狀態', kind: raw.kind === 'debuff' ? 'debuff' : 'buff' }
  const m = mods(raw.mods, -10, 10)
  if (m) out.mods = m
  const luck = str(raw.luck, 10).replace(/\s+/g, '')
  const luckOn = rolls(raw.luck_on)
  if (/^-?\d{0,2}d\d{1,3}$/.test(luck) && luckOn) {
    out.luck = luck
    out.luck_on = luckOn
  }
  const adv = rolls(raw.advantage)
  if (adv) out.advantage = adv
  const dis = rolls(raw.disadvantage)
  if (dis) out.disadvantage = dis
  if (raw.attacked_advantage) out.attacked_advantage = true
  if (raw.attacked_disadvantage) out.attacked_disadvantage = true
  const res = affinity(raw.resist)
  if (res) out.resist = res
  const off = affinity(raw.offense)
  if (off) out.offense = off
  const typed = (v: unknown) => {
    const d = v as { dice?: unknown; type?: unknown } | undefined
    if (!d || typeof d !== 'object') return undefined
    const dd = str(d.dice, 12).replace(/\s+/g, '')
    return DICE.test(dd) && DAMAGE_IDS().includes(String(d.type)) ? { dice: dd, type: String(d.type) } : undefined
  }
  const dot = typed(raw.dot)
  if (dot) out.dot = dot
  const hot = str(raw.hot, 12).replace(/\s+/g, '')
  if (DICE.test(hot)) out.hot = hot
  const pulse = typed(raw.pulse)
  if (pulse) out.pulse = { ...pulse, ...(raw.pulse?.mod ? { mod: true } : {}) }
  if (raw.on_hit && typeof raw.on_hit === 'object') {
    const ids = known ?? new Set(Object.keys(statuses))
    const hit = typed(raw.on_hit)
    const st = raw.on_hit.status && raw.on_hit.status !== id && ids.has(raw.on_hit.status) ? raw.on_hit.status : undefined
    if (st) out.on_hit = { status: st, turns: int(raw.on_hit.turns, 1, 20, 2) }
    else if (hit) out.on_hit = hit
  }
  if (raw.control && raw.control in STATUS_CONTROLS) out.control = raw.control
  if (raw.special && raw.special in STATUS_SPECIALS) out.special = raw.special
  if (raw.charges) out.charges = int(raw.charges, 1, 10, 1)
  // 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節）
  if (raw.lust_mult) out.lust_mult = Math.round(num(raw.lust_mult, -1, 3, 0) * 100) / 100
  if (raw.convert) out.convert = Math.round(num(raw.convert, 0.05, 1, 0.5) * 100) / 100
  if (raw.guard) out.guard = Math.round(num(raw.guard, 0.05, 1, 0.5) * 100) / 100
  if (raw.lust_tick) out.lust_tick = int(raw.lust_tick, 1, 100, 5)
  if (typeof raw.struggle === 'number') out.struggle = int(raw.struggle, -5, 10, 0)
  if (raw.lust_max) out.lust_max = Math.round(num(raw.lust_max, -0.9, 3, 0.5) * 100) / 100
  if (raw.lust_scale && typeof raw.lust_scale === 'object' && ['hit', 'evade', 'save', 'damage', 'dr', 'ap_regen', 'crit'].includes(String(raw.lust_scale.stat))) {
    out.lust_scale = { stat: raw.lust_scale.stat, per: int(raw.lust_scale.per, 1, 5, 1), max: int(raw.lust_scale.max, 1, 20, 5) }
  }
  for (const k of ['no_climax', 'no_cleanse', 'lust_hold', 'lust_dump', 'climax_guard'] as const) if (raw[k]) out[k] = true
  if (raw.convert_low && typeof raw.convert_low === 'object') {
    out.convert_low = { below: Math.round(num(raw.convert_low.below, 0.05, 1, 0.3) * 100) / 100, ratio: Math.round(num(raw.convert_low.ratio, 0.05, 1, 1) * 100) / 100 }
  }
  if (raw.on_release && typeof raw.on_release === 'object' && DAMAGE_IDS().includes(String(raw.on_release.type)) && raw.on_release.type !== 'lust') {
    out.on_release = { amount: int(raw.on_release.amount, 0, 200, 6), type: String(raw.on_release.type), ...(raw.on_release.level ? { level: true } : {}) }
  }
  if (custom) out.custom = true
  return out
}

/**
 * 整理非戰鬥狀態：名稱、說明、檢定加減（check_penalty，負數是加值）與作用的屬性、每場戰鬥的加減與暫時生命、
 * 長休解除、同組（rank 高的取代低的）、再獲得一次變成另一個狀態、獲得時拿掉的狀態。只能改內建的。
 */
export function sanitizeCondition(id: string, raw: Partial<ConditionMod>, custom = false, known?: Set<string>): ConditionMod {
  const base = custom ? undefined : builtinCondition(id)
  if (!custom && !base) throw new Error('沒有這個非戰鬥狀態')
  if (custom && (builtinCondition(id) || !CONDITION_ID.test(id))) throw new Error('自建狀態的 id 不對')
  const out: ConditionMod = { name: str(raw.name, 10) || base?.name || '新的狀態', desc: str(raw.desc, 160) || base?.desc || '' }
  const pen = int(raw.check_penalty, -5, 5, 0)
  if (pen) out.check_penalty = pen
  const attrs = Array.isArray(raw.check_attrs) ? ATTR_IDS.filter((a) => raw.check_attrs!.includes(a)) : []
  if (pen && attrs.length && attrs.length < ATTR_IDS.length) out.check_attrs = attrs
  const m = mods(raw.combat_mods, -5, 5)
  if (m) out.combat_mods = m
  const hp = int(raw.combat_temp_hp, 0, 50, 0)
  if (hp) out.combat_temp_hp = hp
  // 系統狀態：照內建的
  const src = base && SYSTEM_CONDITIONS.includes(id) ? base : raw
  if (src.clears === 'long_rest') out.clears = 'long_rest'
  const group = str(src.group, 16)
  if (/^[a-z][a-z0-9_]*$/.test(group)) {
    out.group = group
    out.rank = int(src.rank, 1, 9, 1)
  }
  const others = [...(known ?? conditionIds())].filter((k) => k !== id && !k.startsWith('$') && !SYSTEM_CONDITIONS.includes(k))
  if (typeof src.stacks_to === 'string' && others.includes(src.stacks_to)) out.stacks_to = src.stacks_to
  const rep = Array.isArray(src.replaces) ? others.filter((k) => src.replaces!.includes(k)) : []
  if (rep.length) out.replaces = rep
  if (custom) out.custom = true
  return out
}

/** 自建的非戰鬥狀態的 id（newModId('cond') 產生的；匯入時也只收這種） */
const CONDITION_ID = /^mod_cond_[a-z0-9]{1,24}$/

/** 新的非戰鬥狀態：下次長休時解除、所有檢定 +1 */
export function newCondition(): ConditionMod {
  return { name: '新的狀態', desc: '下次長休前所有檢定 +1。', check_penalty: -1, clears: 'long_rest', custom: true }
}

/** 哪些地方會給或拿掉這個非戰鬥狀態（編輯畫面參考用）：酒館菜單、物品與工具、特殊任務、事件、地標、奴隸生活，以及目前存檔裡有這個狀態的角色 */
export function conditionUsage(id: string, state?: GameState | null): string[] {
  const out: string[] = []
  const has = (v: unknown) => JSON.stringify(v ?? null).replace(/\s+/g, '').includes(`"condition":"${id}"`)
  for (const m of itemRules.meals.menu) if (m.condition === id) out.push(`酒館菜單「${m.name}」`)
  for (const i of itemRules.items) if (i.use?.condition === id) out.push(`物品「${i.name}」`)
  for (const t of Object.values(itemRules.tools)) if (t.condition === id) out.push(`工具「${t.name}」`)
  for (const st of stories) if (has(st)) out.push(`特殊任務「${st.title}」`)
  for (const t of travelEvents.templates) if (has(t)) out.push(`事件「${t.title}」`)
  for (const l of Object.values(landmarks)) if (has(l)) out.push(`地標「${l.name}」`)
  if (has(slaveryRules)) out.push('奴隸生活的事件')
  for (const c of state?.party ?? []) if (c.status.includes(id)) out.push(`目前存檔的「${c.name}」`)
  for (const r of Object.values(state?.npcs ?? {})) {
    if (r.character?.status?.includes(id) && !state!.party.some((c) => c.id === r.character!.id)) out.push(`目前存檔的「${r.character.name}」`)
  }
  for (const [k, c] of Object.entries(companionRules.conditions)) {
    if (k !== id && !k.startsWith('$') && (c.stacks_to === id || c.replaces?.includes(id))) out.push(`非戰鬥狀態「${c.name}」`)
  }
  return out
}

export function newStatus(kind: 'buff' | 'debuff' = 'buff'): StatusMod {
  return kind === 'buff' ? { name: '新的增益', kind, mods: { hit: 1 }, custom: true } : { name: '新的減益', kind, mods: { evade: -1 }, custom: true }
}

/**
 * 哪些地方用到這個狀態（刪除前檢查）：能力（附加的狀態）、其他狀態的命中附加、物品（使用時得到、解除、對目標施加），
 * 以及目前存檔進行中的戰鬥。
 */
export function statusUsage(id: string, state?: GameState | null): string[] {
  const out: string[] = []
  for (const a of Object.values(abilities)) if (a.apply?.some((x) => x.status === id)) out.push(`能力「${a.name}」`)
  for (const [sid, s] of Object.entries(statuses)) if (sid !== id && s.on_hit?.status === id) out.push(`狀態「${s.name}」的命中附加`)
  for (const i of itemRules.items) {
    const u = i.use
    if (u && (u.status?.id === id || u.cleanse?.includes(id) || u.apply?.status === id)) out.push(`物品「${i.name}」`)
  }
  for (const c of state?.combat?.combatants ?? []) if (c.statuses.some((x) => x.id === id)) out.push(`目前存檔的戰鬥中的「${c.name}」`)
  return out
}

export function newAbility(id: string): AbilityMod {
  return {
    id, name: '新的技能', type: 'skill', classes: ['fighter'], unlock: 1, ap: 2, attr: 'str', target: 'enemy', resolve: 'attack',
    damage: [{ weapon: true }], desc: '', custom: true,
  }
}

/**
 * 哪些地方用到這個能力（刪除前檢查）：職業的初始能力、怪物、固定 NPC（自己的與教人的）、特殊任務的獎勵、
 * 主奴與娼館的事件掛的技能，以及目前存檔裡的角色（隊伍與登場過的人）。
 */
export function abilityUsage(id: string, state?: GameState | null): string[] {
  const out: string[] = []
  for (const [cid, c] of Object.entries(classes)) if (c.start?.includes(id)) out.push(`職業「${c.name ?? cid}」的初始能力`)
  for (const e of Object.values(enemies)) if (e.abilities?.includes(id)) out.push(`怪物「${e.name}」`)
  for (const n of namedNpcs) {
    if (n.abilities?.includes(id)) out.push(`固定 NPC「${n.name}」`)
    else if (n.teaches?.includes(id)) out.push(`固定 NPC「${n.name}」教的技能`)
  }
  for (const { def } of allMasterEvents()) if (def.teaches?.includes(id)) out.push(`主奴、娼館的事件「${def.id}」`)
  for (const s of stories) {
    const effects = [...(s.rewards ?? []), ...s.nodes.flatMap((n) => [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])].flatMap((o) => o?.effects ?? []))]
    if (effects.some((e) => e.type === 'ability' && e.ability === id)) out.push(`特殊任務「${s.title}」的獎勵`)
  }
  if (state) {
    const who = [...state.party, ...Object.values(state.npcs ?? {}).map((r) => r.character).filter((c): c is Character => !!c)]
    for (const c of who) {
      if (c.abilities?.includes(id)) out.push(`目前存檔的「${c.name}」`)
      else if (c.pendingAbilityChoices?.some((set) => set.includes(id))) out.push(`目前存檔的「${c.name}」升級時的選項`)
    }
  }
  return out
}

// ---- 特質 ----

/** 可以學特質的設施 */
export const TRAIN_CELLS = ['inn', 'guild', 'tavern', 'shop', 'temple', 'smithy', 'tailor', 'jeweler', 'magic', 'informant', 'tattoo', 'carver', 'brothel'] as const

/**
 * 內容編輯器的效果範圍：比玩家自訂的寬。抗性可以是弱點（像魔族的神聖 ×1.25，用來平衡強項）；
 * 檢定與戰鬥修正還不開放負的加值（缺陷之後再做）
 */
/** 內容編輯器的數值範圍；缺陷（flaw）才能有負的檢定加值與戰鬥修正 */
export function perkEditorLimits(flaw = false): PerkLimits {
  return { effects: 6, check_bonus: flaw ? [-5, 5] : [1, 5], combat: flaw ? [-3, 3] : [1, 3], resist: [-0.75, 0.5], offense: [flaw ? -0.5 : 0, 0.5], threat: [-0.5, 0.5] }
}

function registerPerk(id: string, m: PerkMod) {
  const def = { ...strip(m, ['custom']), id }
  const i = perkRules.perks.findIndex((p) => p.id === id)
  if (i >= 0) perkRules.perks[i] = def
  else perkRules.perks.push(def)
}

/** 整理特質（內容編輯器、匯入）：數值用 cleanPerkEffects 夾在範圍內；種族只沿用內建的，自建的不能是種族特質；種族特質不能是缺陷 */
/** known：排斥的對象算不算存在（匯入時同一包裡的新特質也算），預設只認得已載入的 */
export function sanitizePerkMod(id: string, raw: Partial<PerkMod>, custom: boolean, known: (id: string) => boolean = isChoosablePerk): PerkMod | undefined {
  const race = custom ? undefined : builtinPerk(id)?.race
  const c = perkRules.custom
  const name = String(raw.name ?? '').trim().slice(0, c.name_chars)
  const flaw = !race && raw.flaw === true
  const effects = cleanPerkEffects(raw.effects, perkEditorLimits(flaw))
  const out: PerkMod = {
    id, name: name || '新的特質', desc: String(raw.desc ?? '').trim().slice(0, c.desc_chars) || (effects.length ? describeEffects(effects) : ''), effects,
  }
  if (race) out.race = race
  if (flaw) out.flaw = true
  const races = (raw.requires?.races ?? []).filter((r) => !!attributeRules.races[r])
  const cls = (raw.requires?.classes ?? []).filter((k) => !!classes[k])
  const pre = [...new Set(raw.requires?.perks ?? [])].filter((x) => x !== id && known(x))
  if (!race && (races.length || cls.length || pre.length)) out.requires = { ...(races.length ? { races } : {}), ...(cls.length ? { classes: cls } : {}), ...(pre.length ? { perks: pre } : {}) }
  const ex = [...new Set(raw.exclusive ?? [])].filter((x) => x !== id && known(x))
  if (!race && ex.length) out.exclusive = ex
  if (!race && raw.train && Array.isArray(raw.train.cells)) {
    const cells = [...new Set(raw.train.cells.filter((x) => (TRAIN_CELLS as readonly string[]).includes(x) || isCustomShopId(x) || isLandmarkId(x)))]
    if (cells.length) {
      out.train = {
        cells,
        price_cc: Math.round(num(raw.train.price_cc, 0, 1e6, 300)),
        hours: Math.round(num(raw.train.hours, 1, 72, 8)),
        attr: ATTR_IDS.includes(raw.train.attr) ? raw.train.attr : 'str',
        dc: Math.round(num(raw.train.dc, 5, 30, 12)),
      }
    }
  }
  if (!race && raw.npc) {
    const weight = Math.round(num(raw.npc.weight, 0, 10, 0))
    const tags = (raw.npc.tags ?? []).filter((t) => !!npcTags.tags[t])
    const ncls = (raw.npc.classes ?? []).filter((k) => !!classes[k])
    if (weight > 0) out.npc = { weight, ...(tags.length ? { tags } : {}), ...(ncls.length ? { classes: ncls } : {}) }
  }
  if (raw.rarity && RARITY_ORDER.includes(raw.rarity)) out.rarity = raw.rarity
  if (raw.category && PERK_CATEGORIES[raw.category]) out.category = raw.category
  // 能在野外紮營長休（種族特質也可以，例如自訂一個親近自然的種族）
  if (raw.camp === true) out.camp = true
  // 慾望流派：流派與慾望效果（表單還沒有這兩個欄位，整理時保留）
  if (!race && raw.school && schoolDef(raw.school)) out.school = raw.school
  const lust = race ? undefined : sanitizeLustPerk(raw.lust)
  if (lust) out.lust = lust
  if (custom) out.custom = true
  return out
}

export function newPerk(id: string): PerkMod {
  return { id, name: '新的特質', desc: '', effects: [{ check: { attrs: ['str'] }, bonus: 1 }], custom: true }
}

export function newNpc(id: string): NpcMod {
  return {
    id, name: '新的角色', race: 'human', class: 'fighter', level: 3, location: 'soriel', hire_cc: 200, kind: 'adventurer',
    gender: 'male', personality: '沉默寡言，但很可靠。', appearance: '', haunts: [{ location: 'soriel', zone: 'town', weight: 1 }], custom: true,
  }
}

/** 新的 id（自建項目） */
export function newModId(prefix: string): string {
  return `mod_${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`
}

/** 新怪物的預設值 */
export function newEnemy(id: string): EnemyMod {
  return {
    id, name: '新的怪物', level: 1, attrs: { str: 12, dex: 12, int: 6, fai: 10, cha: 6 }, hp: 12, ap: 3,
    weapon: { dice: '1d6', type: 'slashing', attr: 'str' }, evade: 0, dr: 0, xp: 35, kind: 'beast', custom: true,
  }
}

export function newItem(name: string): ItemMod {
  return { name, category: 'material', price_cc: 10, tags: [], custom: true }
}

export function newBase(): BaseMod {
  return { slot: 'main_hand', name: '新的武器', kind: 'metal', price: 200, weaponDef: { name: '新的武器', dice: '1d8', type: 'slashing', attr: 'str' }, scale: { damage: 'full', hit: 'half' }, custom: true }
}

export function newMaterial(): MaterialMod {
  return { kind: 'metal', name: '新材料', tier: 2, bonus: 1, rarity: 'uncommon', level: 3, price: 3, custom: true }
}

export type { GearSlot }
