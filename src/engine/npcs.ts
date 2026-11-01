// NPC 登錄與生成。
//
// 遊戲中登場的 NPC 都放在 GameState.npcs：data/world/npcs.json 的具名角色第一次離隊時複製進來，
// 酒館候選人、其他隊伍、奴隸市場的角色則由程式生成（名字、外貌、性格可再交給 AI 潤飾）。
// NPC 不在隊伍時，角色資料（等級、經驗、能力）保存在 NpcRecord.character，再次入隊時沿用。

import { npcPerksOf, perksOf } from './perks'
import { createNpc, lifeTier } from './character'
import {
  attributeRules, className, combatClasses, NONCOMBAT_CLASS, companionRules, GENDER_IDS, isCustomShopId, locationById, npcPool, namedNpcById, npcs as namedNpcs, npcTags, perkDef, slaveryRules, tagDef,
  type Haunt, type NpcKind, type NpcStage,
} from './data'
import { Rng } from './rng'
import { rollLook } from './traits'
import { condMet } from './storyFlags'
import { isNight } from './light'
import type { Character, GameState, NpcRecord } from './types'

export interface NpcSpec {
  id?: string
  name?: string
  gender?: string
  race?: string
  class?: string
  level?: number
  personality?: string
  appearance?: string
  faction?: string
  background?: string
  location?: string
  /** 普通人沒有職業（class 為空字串），改用 occupation 描述 */
  kind?: NpcKind
  tags?: string[]
  occupation?: string
  haunts?: Haunt[]
  spot?: string
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function npcRecord(state: GameState, id: string): NpcRecord | undefined {
  let stored = state.npcs?.[id]
  const def = namedNpcById(id)
  if (!def) return stored
  // 依劇情旗標改變出沒：有一組成立時，複製進存檔再改（同一個角色，關係與記憶延續）
  const stage = activeStage(state, def)
  if (!stored && stage !== undefined) stored = registerNpc(state, JSON.parse(JSON.stringify(def)) as NpcRecord)
  // 固定 NPC 登場後會複製進存檔；出現的條件與出沒的地方跟著內容頁籤的設定走
  if (stored) syncPlacement(state, stored, def, stage)
  return stored ?? def
}

/** 交給 AI 與形象圖的外貌：接上固定 NPC 的成人向外貌（跟著內容頁籤的設定走，不存進存檔） */
export function appearanceOf(id: string, appearance?: string): string {
  const extra = namedNpcById(id)?.adult_appearance
  return [appearance, extra].filter(Boolean).join('')
}

/** 第一組條件成立的「依劇情旗標改變出沒」 */
export function activeStage(state: GameState, def: Pick<NpcRecord, 'stages'>): number | undefined {
  const i = (def.stages ?? []).findIndex((st) => condMet(state, st.requires) && (!st.hours || (st.hours === 'night') === isNight(state.time)))
  return i >= 0 ? i : undefined
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const IDENTITY = ['name', 'background', 'personality', 'tags'] as const

/** 階段的身分改變（名字、背景、性格、標籤）：有寫的用階段的，沒寫的用預設的；同步到人際關係與隊伍裡的角色 */
/**
 * 欄位真的變了才寫：存檔是畫面的反應式資料，每次都換成新的物件會讓讀它的畫面不停重算
 * （npcRecord 在畫面的 computed 裡也會呼叫）
 */
function put(obj: object, key: string, value: unknown) {
  const o = obj as Record<string, unknown>
  if (value === undefined) {
    if (key in o) delete o[key]
  } else if (JSON.stringify(o[key]) !== JSON.stringify(value)) {
    o[key] = clone(value)
  }
}

function syncIdentity(state: GameState, rec: NpcRecord, def: NpcRecord, st: NpcStage | undefined) {
  const staged = !!st && IDENTITY.some((k) => st[k] !== undefined)
  if (!staged && !rec.stagedIdentity) return
  for (const k of IDENTITY) put(rec, k, (staged ? st![k] : undefined) ?? def[k])
  put(rec, 'stagedIdentity', staged ? true : undefined)
  const rel = state.relationships?.[rec.id]
  if (rel) {
    put(rel, 'name', rec.name)
    if (rec.personality) put(rel, 'personality', rec.personality)
  }
  for (const c of [state.party.find((m) => m.id === rec.id), rec.character]) {
    if (!c) continue
    put(c, 'name', rec.name)
    put(c, 'background', rec.background || undefined)
  }
}

function syncPlacement(state: GameState, rec: NpcRecord, def: NpcRecord, stage: number | undefined) {
  put(rec, 'requires', def.requires)
  put(rec, 'landmark', def.landmark)
  const st = stage !== undefined ? def.stages?.[stage] : undefined
  syncIdentity(state, rec, def, st)
  if (st) {
    // 搬到新的地方
    put(rec, 'location', st.location)
    put(rec, 'fixed', st.fixed)
    put(rec, 'haunts', st.haunts?.length ? st.haunts : undefined)
    put(rec, 'stage', stage)
    return
  }
  if (rec.stage !== undefined) {
    // 條件不再成立：回到原本的設定
    put(rec, 'location', def.location)
    put(rec, 'haunts', def.haunts?.length ? def.haunts : undefined)
    delete rec.stage
  }
  put(rec, 'fixed', def.fixed)
}

export function registerNpc(state: GameState, rec: NpcRecord): NpcRecord {
  ;(state.npcs ??= {})[rec.id] = rec
  return rec
}

/** 雇傭要價 = (a + b × 等級 + c × 等級²)，再乘上浮動 */
export function askingPrice(level: number, rng?: Rng): number {
  const { a, b, c } = companionRules.tavern.asking
  const base = a + b * level + c * level * level
  const v = companionRules.tavern.asking_variance
  const factor = rng ? 1 - v + rng.next() * 2 * v : 1
  return Math.max(10, Math.round((base * factor) / 5) * 5)
}

/** 奴隸價格：依世界書的層級與種族區間（見 data/rules/slavery.json）。 */
/** lewdMult：指標與色情技能讓身價變高（lewd.ts 的 slaveValueMult） */
export function slavePrice(c: { race: string; class: string; level: number }, marketMult = 1, rng?: Rng, lewdMult = 1): number {
  const p = slaveryRules.prices_cc
  const tier = lifeTier(c.level)
  const group = p.race_group[c.race] ?? 'human'
  const table = p[String(Math.min(tier, 3)) as '1' | '2' | '3'][group]
  const range = tierLevels(Math.min(tier, 3))
  const t = range[1] > range[0] ? (Math.min(c.level, range[1]) - range[0]) / (range[1] - range[0]) : 0
  let price = table[0] + (table[1] - table[0]) * t
  if (tier > 3) price *= p.beyond_tier3_mult ** (tier - 3)
  price *= (p.race_mult[c.race] ?? 1) * (p.class_mult[c.class] ?? 1) * marketMult
  if (rng) price *= 1 - p.variance + rng.next() * 2 * p.variance
  price *= lewdMult
  return Math.max(100, Math.round(price / 10) * 10)
}

function tierLevels(tier: number): [number, number] {
  const levels: Record<number, [number, number]> = { 1: [1, 4], 2: [5, 8], 3: [9, 12] }
  return levels[tier] ?? [1, 4]
}

function weightedPick(rng: Rng, weights: Record<string, number>): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng.next() * total
  for (const [k, w] of entries) {
    r -= w
    if (r < 0) return k
  }
  return entries[entries.length - 1]![0]
}

export { weightedPick }

/** 各地區生成 NPC 的種族比例 */
function raceWeights(location: string): Record<string, number> {
  const loc = locationById(location)
  if (loc.races) return Object.fromEntries(Object.entries(loc.races).filter(([r]) => attributeRules.races[r]))
  const region = loc.region
  const base: Record<string, number> = { human: 6, catfolk: 2, dwarf: 2, demon: 1, elf: 1, yulin: 1 }
  if (region === 'south') Object.assign(base, { demon: 6, human: 3 })
  if (region === 'north') Object.assign(base, { dwarf: 6 })
  if (region === 'forest') Object.assign(base, { elf: 5 })
  if (region === 'east_sea') Object.assign(base, { yulin: 4 })
  if (region === 'west') Object.assign(base, { catfolk: 5 })
  return Object.fromEntries(Object.entries(base).filter(([r]) => attributeRules.races[r]))
}

/** 已經用過的名字：登錄過的 NPC、具名 NPC、隊伍 */
function usedNames(state: GameState): Set<string> {
  return new Set([
    ...Object.values(state.npcs ?? {}).map((n) => n.name),
    ...namedNpcs.map((n) => n.name),
    ...state.party.map((m) => m.name),
  ])
}

function newNpcId(state: GameState, prefix: string): string {
  const taken = state.npcs ?? {}
  let n = Object.keys(taken).length + 1
  while (taken[`${prefix}_${n}`]) n++
  return `${prefix}_${n}`
}

/** 生成一位 NPC 並登錄。spec 沒指定的欄位隨機決定；普通人沒有職業。 */
/** 有性別的職業稱呼依性別換成對應的（公主／王子、修女／修士……；npc_tags.json 的 gendered_occupations） */
export function occupationFor(occupation: string, gender: string | undefined): string {
  const row = npcTags.gendered_occupations?.find((r) => r.female === occupation || r.male === occupation || r.neutral === occupation)
  if (!row) return occupation
  if (gender === 'female' || gender === 'ts' || gender === 'futa') return row.female
  if (gender === 'male' || gender === 'femboy') return row.male
  return row.neutral
}

export function generateNpc(state: GameState, rng: Rng, spec: NpcSpec = {}, prefix = 'gen'): NpcRecord {
  const location = spec.location ?? state.location
  const kind: NpcKind = spec.kind ?? 'adventurer'
  const race = spec.race && attributeRules.races[spec.race] ? spec.race : weightedPick(rng, raceWeights(location))
  const cls = kind === 'commoner' ? '' : spec.class && combatClasses[spec.class] ? spec.class : rng.pick(Object.keys(combatClasses))
  const level = Math.max(1, Math.min(20, Math.round(spec.level ?? 1)))
  const gender = spec.gender && GENDER_IDS.includes(spec.gender)
    ? spec.gender
    : weightedPick(rng, Object.fromEntries(GENDER_IDS.map((g) => [g, npcPool.genders[g]!.weight])))
  const tags = spec.tags ?? []
  const outfits = kind === 'commoner'
    ? tags.map((t) => npcPool.commoner_outfits[t]).find(Boolean) ?? npcPool.commoner_outfits.default!
    : npcPool.outfits
  // 名字、外貌（多部位）、性格（多象限）：至少一項來自種族或血統，見 traits.ts
  const look = rollLook(rng, { race, gender, kind, location, used: usedNames(state), outfit: rng.pick(outfits) })
  const rec: NpcRecord = {
    id: spec.id ?? newNpcId(state, prefix),
    name: spec.name?.trim() || look.name,
    gender,
    race,
    class: cls,
    level,
    location,
    hire_cc: kind === 'commoner' ? 0 : askingPrice(level, rng),
    personality: spec.personality?.trim() || look.personality,
    appearance: spec.appearance?.trim() || look.appearance,
    ...(look.lineage ? { lineage: look.lineage } : {}),
    ...(spec.faction ? { faction: spec.faction } : {}),
    ...(spec.background ? { background: spec.background } : {}),
    kind,
    ...(tags.length ? { tags } : {}),
    ...(spec.occupation ? { occupation: occupationFor(spec.occupation, gender) } : {}),
    ...(spec.haunts?.length ? { haunts: spec.haunts } : {}),
    ...(spec.spot ? { spot: spec.spot } : {}),
    generated: true,
  }
  return registerNpc(state, rec)
}

/** 普通人或冒險者（舊資料沒寫時，有職業的算冒險者） */
export function npcKind(rec: Pick<NpcRecord, 'kind' | 'class'>): NpcKind {
  return rec.kind ?? (rec.class ? 'adventurer' : 'commoner')
}

/** 身分的簡稱：冒險者是職業，普通人是職業描述 */
export function npcTitle(rec: Pick<NpcRecord, 'kind' | 'class' | 'occupation' | 'tags'>): string {
  if (npcKind(rec) === 'adventurer') return className(rec.class)
  return rec.occupation ?? tagDef(rec.tags?.[0] ?? '')?.name ?? '平民'
}

/** 給 AI 的身分說明：類型、職業或職業描述、標籤 */
export function npcIdentity(rec: Pick<NpcRecord, 'id' | 'kind' | 'class' | 'occupation' | 'tags' | 'lineage' | 'perks' | 'race' | 'character'>): string {
  const kind = npcKind(rec) === 'adventurer' ? '冒險者' : '普通人'
  const tags = (rec.tags ?? []).map((t) => tagDef(t)).filter(Boolean).map((t) => `${t!.name}（${t!.ai_hint}）`)
  // 特質：同行過的用角色資料（可能學了新的），否則依 NPC 資料
  const perks = (rec.character ? perksOf(rec.character) : perksOf({ perks: npcPerksOf(rec), race: rec.race })).map((p) => `${p.flaw ? '缺陷' : '特質'}【${p.name}】${p.desc}`)
  return [`${kind}・${npcTitle(rec)}`, ...(rec.lineage ? [`出身：${rec.lineage}`] : []), ...tags, ...perks].join('；')
}

/** 取得 NPC 的角色資料：之前同行過就沿用，否則依等級生成。 */
export function characterFor(state: GameState, rec: NpcRecord): Character {
  if (rec.character) return JSON.parse(JSON.stringify(rec.character)) as Character
  // 普通人沒有職業：入隊時用「無法戰鬥」
  return createNpc({ ...rec, class: rec.class || NONCOMBAT_CLASS }, new Rng(hashString(rec.id)))
}

/** 找出 NPC 的 id（依名字或別名比對），供 AI 回傳的名字對應 */
export function findNpcByName(state: GameState, name: string): string | undefined {
  const n = name.trim()
  for (const r of Object.values(state.relationships ?? {})) {
    if (r.name === n || r.aliases?.includes(n)) return r.id
  }
  return state.party.find((m) => m.name === n)?.id
}

const SHOP_SPOT: Record<string, string> = {
  general: 'shop', temple: 'temple', tavern: 'tavern', smithy: 'smithy', tailor: 'tailor', jeweler: 'jeweler', magic: 'magic', informant: 'informant', wanderer: 'merchant',
}

/** NPC 平常待的設施：店主在自己的店、公會職員在公會，冒險者與知情人在酒館。 */
export function npcSpot(rec: NpcRecord): string | undefined {
  if (rec.spot) return rec.spot
  // 擔任店主的固定 NPC：在自己的店
  if (rec.keeper) return SHOP_SPOT[rec.keeper] ?? (isCustomShopId(rec.keeper) ? rec.keeper : 'shop')
  // 生成的店主：keeper_<地點>_<店種>（自建的店種是 shop_xxx）
  const keeper = /^keeper_.+?_(shop_[a-z0-9]+|[a-z]+)$/.exec(rec.id)
  if (keeper) return SHOP_SPOT[keeper[1]!] ?? (isCustomShopId(keeper[1]!) ? keeper[1] : 'shop')
  if (rec.id.startsWith('clerk_')) return 'guild'
  if (/^(tav|pty|gen|inf)_/.test(rec.id) || namedNpcs.some((n) => n.id === rec.id)) return 'tavern'
  return undefined
}
