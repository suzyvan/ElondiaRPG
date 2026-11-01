// NPC 依標籤、職業描述與體型穿的服裝（gear.json 的 npc_outfits，說明見 docs/ITEMS.md 第 2 節）。
//
// - 由上往下第一條符合的規則。
// - 每個欄位從清單裡依角色 id 固定挑一件（第一級材料），不用遊戲的亂數。
// - 普通人沒有戰鬥資料：服裝只算出來給形象圖與 AI 的描述用（npcOutfit）。
// - 冒險者生成時只補空著的非護甲欄位（dressNpc），不換掉護甲與下身護具。

import { baseShown, gearName, gearRules, type MaterialKind } from './gear'
import type { NpcDef } from './data'
import { bodyOf } from './traits'
import type { Character, EquippedGear, GearSlot } from './types'

export interface OutfitRule {
  tags?: string[]
  occupations?: string[]
  body?: ('masc' | 'fem' | 'andro')[]
  slots: Partial<Record<GearSlot, string[]>>
}

/** 冒險者可以補上服裝的欄位（不碰武器、上身與下身護具） */
const ADVENTURER_SLOTS: GearSlot[] = ['head', 'wrists', 'feet', 'accessory', 'leg_accessory', 'underwear_top', 'underwear_bottom']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rules(): OutfitRule[] {
  return (gearRules as unknown as { npc_outfits?: { rules: OutfitRule[] } }).npc_outfits?.rules ?? []
}

/** 這個人符合的第一條規則 */
export function outfitRule(def: Pick<NpcDef, 'race' | 'gender' | 'tags' | 'occupation'>): OutfitRule | undefined {
  const body = bodyOf(def.race, def.gender)
  const tags = def.tags ?? []
  return rules().find((r) => {
    if (r.body?.length && !r.body.includes(body)) return false
    if (r.tags?.length && !r.tags.some((t) => tags.includes(t))) return false
    if (r.occupations?.length && !r.occupations.some((o) => def.occupation?.includes(o))) return false
    return true
  })
}

const FIRST_MATERIAL: Record<MaterialKind, string> = { cloth: 'linen', leather: 'leather', metal: 'iron', jewel: 'copper', wood: 'oak' }

/** 依規則替這個人挑的服裝（每個欄位一件，第一級材料） */
/** 第幾週（普通人每週換一套衣服；第 0 週和以前一樣，不加鹽） */
export function outfitWeek(day: number): number {
  return Math.max(0, Math.floor((day - 1) / 7))
}

/**
 * day：給了時每週換一套（普通人用；冒險者的服裝生成時就存在角色資料裡，不換）。
 * 照樣不用遊戲的亂數：同一個人同一週穿同一套
 */
export function npcOutfit(def: Pick<NpcDef, 'id' | 'race' | 'gender' | 'tags' | 'occupation'>, day?: number): Partial<Record<GearSlot, EquippedGear>> {
  const week = day === undefined ? 0 : outfitWeek(day)
  const salt = week > 0 ? `:w${week}` : ''
  const rule = outfitRule(def)
  const out: Partial<Record<GearSlot, EquippedGear>> = {}
  for (const [slot, list] of Object.entries(rule?.slots ?? {}) as [GearSlot, string[]][]) {
    const options = list.filter((b) => baseShown(b))
    if (!options.length) continue
    const base = options[hash(`${def.id}:${slot}${salt}`) % options.length]!
    const material = FIRST_MATERIAL[gearRules.bases[base]!.kind]
    if (!gearRules.materials[material]) continue
    const spec = { base, material }
    out[slot] = { name: gearName(spec), spec }
  }
  return out
}

/** 冒險者生成時：補上空著的非護甲欄位（種族封住的欄位不穿） */
export function dressNpc(c: Character, def: Pick<NpcDef, 'id' | 'race' | 'gender' | 'tags' | 'occupation'>) {
  const blocked = gearRules.races[c.race]?.blocked ?? []
  for (const [slot, g] of Object.entries(npcOutfit(def)) as [GearSlot, EquippedGear][]) {
    if (!ADVENTURER_SLOTS.includes(slot) || blocked.includes(slot) || c.gear?.[slot]) continue
    ;(c.gear ??= {})[slot] = g
  }
}
