// NPC 名單與每日位置（見 docs/NPC_SYSTEM.md）。
//
// - 每個聚落第一次進入時建立一份名單：冒險者與普通人約各半（data/rules/npc_population.json）。
//   名單用「存檔種子＋地點」的固定亂數生成，不影響遊戲的亂數。
// - NPC 有標籤與活躍地點（地點＋地區＋權重）。每天在哪裡由「NPC id＋日期」的固定亂數決定，
//   不需要另外存檔，重新整理也不會變。
// - 店主、公會職員等職員沒有活躍地點，固定待在自己的設施；舊資料（沒有活躍地點）沿用同樣的規則。

import { combatClasses, geography, landmarkDef, landmarkTypes, locationById, npcs as namedNpcs, npcTags, population, tagsExclusive, type Haunt, type Location, type NpcKind } from './data'
import {
  currentArea, DUNGEON_LAYERS, findKind, layerKey, outskirtsKey, position, settlementBlocks, zonesOf, type Area, type CellKind, type Zone,
} from './grid'
import { generateNpc, hashString, npcKind, npcRecord, npcSpot, registerNpc, weightedPick } from './npcs'
import { Rng } from './rng'
import { condMet } from './storyFlags'
import { allyPlacement } from './story'
import { followsLeader, inActiveSquad } from './squads'
import type { GameState, NpcRecord, Roster } from './types'
import { contractOf } from './tattoos'

// ---- 生成 ----

/**
 * 抽標籤：普通人抽一個主要標籤；冒險者每個標籤各自擲機率（乘上職業的倍率 class_mult，例如聖騎士很少是惡人）；
 * 最後可能再疊加「旅人」等額外標籤
 */
export function pickTags(rng: Rng, kind: NpcKind, loc: Location, cls?: string): string[] {
  const usable = Object.entries(npcTags.tags)
    .filter(([, t]) => t.kinds.includes(kind) && (!t.location_types || t.location_types.includes(loc.type)))
    .filter(([, t]) => !t.requires_zone || zonesOf(loc).includes(t.requires_zone as Zone))
  const tags: string[] = []
  if (kind === 'commoner') {
    const weights = Object.fromEntries(usable.map(([id, t]) => [id, t.commoner_weight ?? 0]))
    tags.push(weightedPick(rng, weights))
  } else {
    // 互斥的標籤（好人與惡人）不會同時擁有
    for (const [id, t] of usable) {
      const chance = Math.min(1, (t.adventurer_chance ?? 0) * (cls ? t.class_mult?.[cls] ?? 1 : 1))
      if (chance && rng.next() < chance && !tags.some((x) => tagsExclusive(x, id))) tags.push(id)
    }
  }
  for (const [id, t] of usable) {
    if (tags.length && !tags.includes(id) && t.extra_chance && rng.next() < t.extra_chance && !tags.some((x) => tagsExclusive(x, id))) tags.push(id)
  }
  return tags
}

/** 沿道路相連的地點（一步） */
function neighbors(locId: string): string[] {
  return geography.routes.flatMap((r) => (r.a === locId ? [r.b] : r.b === locId ? [r.a] : []))
}

function isSettlement(locId: string): boolean {
  return locationById(locId).type !== 'dungeon'
}

/** 活躍地點：所屬地點的各地區，加上相鄰的聚落；冒險者再加上附近的地下城 */
export function buildHaunts(rng: Rng, kind: NpcKind, tags: string[], loc: Location): Haunt[] {
  const kindDef = npcTags.kinds[kind]
  const weights: Record<string, number> = { ...kindDef.zone_weights }
  for (const t of tags) Object.assign(weights, npcTags.tags[t]?.zone_weights ?? {})

  const available = zonesOf(loc)
  const home: Record<string, number> = {}
  for (const [zone, w] of Object.entries(weights)) {
    if (zone === 'dungeon' || w <= 0) continue
    const z = available.includes(zone as Zone) ? zone : 'town'
    home[z] = (home[z] ?? 0) + w
  }
  const haunts: Haunt[] = Object.entries(home).map(([zone, weight]) => ({ location: loc.id, zone, weight: round(weight) }))

  // 相鄰的聚落：旅人等標籤會多去幾個地方（兩步以內），其他人只有低機率出現在一個鄰近的聚落
  const near = neighbors(loc.id).filter(isSettlement)
  const twoSteps = [...new Set([...near, ...near.flatMap(neighbors)])].filter((id) => id !== loc.id && isSettlement(id))
  const extra = tags.reduce((n, t) => {
    const r = npcTags.tags[t]?.haunt_extra
    return Math.max(n, r ? rng.int(r[0], r[1]) : 0)
  }, 0)
  if (extra > 0 && twoSteps.length) {
    const range = tags.map((t) => npcTags.tags[t]?.haunt_extra_weight).find(Boolean) ?? [0.3, 0.6]
    const pool = [...twoSteps]
    for (let i = 0; i < extra && pool.length; i++) {
      const id = pool.splice(rng.int(0, pool.length - 1), 1)[0]!
      haunts.push({ location: id, zone: 'town', weight: round(range[0] + rng.next() * (range[1] - range[0])) })
    }
  } else if (near.length) {
    haunts.push({ location: rng.pick(near), zone: 'town', weight: npcTags.neighbor_weight })
  }

  const dungeonWeight = weights.dungeon ?? 0
  // 劇情條件成立才出現的地下城（requires）不算：還沒開放就有冒險者在裡面出沒會說不通
  const dungeons = neighbors(loc.id).filter((id) => !isSettlement(id) && !locationById(id).requires)
  if (kind === 'adventurer' && dungeonWeight > 0 && dungeons.length) {
    const [lo, hi] = kindDef.dungeon_haunts ?? [1, 1]
    const pool = [...dungeons]
    for (let i = rng.int(lo, hi); i > 0 && pool.length; i--) {
      const id = pool.splice(rng.int(0, pool.length - 1), 1)[0]!
      haunts.push({ location: id, zone: 'dungeon', weight: dungeonWeight })
    }
  }
  return haunts
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** 生成一位名單上的居民 */
export function generateResident(state: GameState, rng: Rng, loc: Location, kind: NpcKind, prefix?: string): NpcRecord {
  // 冒險者先決定職業，標籤的機率依職業調整
  const cls = kind === 'adventurer' ? rng.pick(Object.keys(combatClasses)) : undefined
  const tags = pickTags(rng, kind, loc, cls)
  const occupations = tags.flatMap((t) => npcTags.tags[t]?.occupations ?? [])
  let level: number
  if (kind === 'adventurer') {
    const [lo, hi] = population.adventurer_level[loc.type] ?? [1, 5]
    level = Math.min(rng.int(lo, hi), rng.int(lo, hi))
  } else {
    const [lo, hi] = npcTags.kinds.commoner.level ?? [1, 3]
    level = rng.int(lo, hi)
  }
  const haunts = buildHaunts(rng, kind, tags, loc)
  // 地點自己的職業（渡口的水手……）：只在有設定的地點多擲一次骰
  const local = kind === 'commoner' ? population.local_occupations?.[loc.id] : undefined
  const occupation = kind !== 'commoner' ? undefined : local?.list.length && rng.next() < local.chance ? rng.pick(local.list) : occupations.length ? rng.pick(occupations) : undefined
  return generateNpc(state, rng, {
    kind,
    ...(cls ? { class: cls } : {}),
    tags,
    level,
    location: loc.id,
    haunts,
    ...(kind === 'commoner' && occupation ? { occupation } : {}),
    ...(loc.faction && kind === 'commoner' ? { faction: loc.faction } : {}),
  }, prefix ?? (kind === 'adventurer' ? 'adv' : 'cmn'))
}

/** 地點的名單人數：地點類型的人數，個別地點可以另外指定（npc_population.json 的 roster_by_location） */
export function rosterSize(loc: Location): { adventurer: number; commoner: number } | undefined {
  return population.roster_by_location?.[loc.id] ?? population.roster[loc.type]
}

/** 不佔名單名額的固定 NPC：不受雇用的（統治者、機構首長……）與成人向角色 */
export function outsideQuota(id: string): boolean {
  return isUnhireable(id) || !!namedNpcs.find((n) => n.id === id)?.adult
}

function takesSlot(rec: NpcRecord, kind: NpcKind): boolean {
  return npcKind(rec) === kind && !outsideQuota(rec.id)
}

/** 建立地點的名單（已經有就直接回傳）；地下城沒有名單 */
export function ensureRoster(state: GameState, locId: string): Roster | undefined {
  const loc = locationById(locId)
  const size = rosterSize(loc)
  if (!size) return undefined
  ensureMadam(state, loc)
  const rosters = (state.rosters ??= {})
  if (rosters[locId]) return rosters[locId]
  // 具名 NPC：所屬地點是這裡的算進冒險者或普通人的名額（不受雇用的統治者、機構首長不佔名額）
  const named = namedNpcs.filter((n) => n.location === locId)
  const rng = new Rng(hashString(`${state.seed}:roster:${locId}`))
  const members = named.map((n) => n.id)
  const namedCount = (k: NpcKind) => named.filter((n) => takesSlot(n as NpcRecord, k)).length
  for (let i = namedCount('adventurer'); i < size.adventurer; i++) members.push(generateResident(state, rng, loc, 'adventurer').id)
  for (let i = namedCount('commoner'); i < size.commoner; i++) members.push(generateResident(state, rng, loc, 'commoner').id)
  // 有娼館的城鎮：至少有幾位娼妓
  if (zonesOf(loc).includes('brothel')) {
    const have = members.filter((id) => npcRecord(state, id)?.tags?.includes('prostitute')).length
    for (let i = have; i < population.brothel_workers; i++) members.push(generateWorker(state, rng, loc).id)
  }
  rosters[locId] = { members, day: state.time.day }
  return rosters[locId]
}

/** 娼妓：普通人，主要待在娼館 */
function generateWorker(state: GameState, rng: Rng, loc: Location): NpcRecord {
  const tags = ['prostitute']
  const [lo, hi] = npcTags.kinds.commoner.level ?? [1, 3]
  return generateNpc(state, rng, {
    kind: 'commoner', tags, level: rng.int(lo, hi), location: loc.id,
    haunts: buildHaunts(rng, 'commoner', tags, loc),
    occupation: rng.pick(npcTags.tags.prostitute?.occupations ?? ['娼妓']),
    ...(loc.faction ? { faction: loc.faction } : {}),
  }, 'cmn')
}

/** 娼館的老鴇：店主（商人）兼娼妓，固定待在娼館 */
export function madamId(locId: string): string {
  return `keeper_${locId}_brothel`
}

function ensureMadam(state: GameState, loc: Location) {
  if (!zonesOf(loc).includes('brothel') || npcRecord(state, madamId(loc.id))) return
  const rng = new Rng(hashString(`${state.seed}:madam:${loc.id}`))
  generateNpc(state, rng, {
    id: madamId(loc.id), kind: 'commoner', tags: ['prostitute', 'merchant'], occupation: '老鴇', level: rng.int(2, 5),
    location: loc.id, spot: 'brothel', ...(loc.faction ? { faction: loc.faction } : {}),
  })
}

// ---- 每天在哪裡 ----

/** 劇情旗標不符合時不出現（固定 NPC 的 requires） */
export function visibleNpc(state: GameState, rec: Pick<NpcRecord, 'id' | 'requires'>): boolean {
  return condMet(state, rec.requires)
}

/** NPC 今天在哪裡（依活躍地點的權重，用 NPC id＋日期的固定亂數）；沒有活躍地點時為 undefined */
export function whereToday(rec: Pick<NpcRecord, 'id' | 'haunts'>, day: number): Haunt | undefined {
  const haunts = rec.haunts ?? []
  if (!haunts.length) return undefined
  const rng = new Rng(hashString(`${rec.id}@${day}`))
  const i = Number(weightedPick(rng, Object.fromEntries(haunts.map((h, idx) => [String(idx), h.weight]))))
  return haunts[i]
}

/** 所有登錄過的 NPC（遊戲中的紀錄優先，加上還沒登場的具名 NPC） */
export function allNpcs(state: GameState): NpcRecord[] {
  const seen = new Set<string>()
  const out: NpcRecord[] = []
  for (const rec of [...Object.values(state.npcs ?? {}), ...namedNpcs.map((n) => npcRecord(state, n.id)!)]) {
    if (seen.has(rec.id)) continue
    seen.add(rec.id)
    out.push(rec)
  }
  return out
}

/** 地下城的活躍地點：今天在第幾層（周邊到深層；底層是 A 級的地方，不會遇到一般冒險者） */
function layerOf(rec: Pick<NpcRecord, 'id'>, day: number): number {
  return hashString(`${rec.id}@${day}:layer`) % Math.min(4, DUNGEON_LAYERS.length)
}

function pickBlock(rec: Pick<NpcRecord, 'id'>, day: number, keys: string[]): string | undefined {
  if (!keys.length) return undefined
  return keys[hashString(`${rec.id}@${day}:block`) % keys.length]
}

/** NPC 今天在哪個區域（區域 key）；不在任何地圖上時為 undefined */
export function areaOf(state: GameState, rec: NpcRecord, day = state.time.day): string | undefined {
  if (rec.dead) return undefined
  // 特殊任務在場的友方：站在任務點旁邊（不看自己的出現條件）
  const ally = allyPlacement(state, rec.id)
  if (ally) return ally.area
  if (!visibleNpc(state, rec)) return undefined
  if (rec.at && day <= rec.at.until) return rec.at.area
  // 小隊的隊員：今天跟著隊長
  const lead = followsLeader(state, rec, day)
  if (lead) return areaOf(state, lead, day)
  // 固定 NPC：站在指定的格子
  const fixed = fixedCell(rec)
  if (fixed) return fixed.area
  const today = whereToday(rec, day)
  if (today) {
    const loc = locationById(today.location)
    if (today.zone === 'outskirts') return loc.type === 'dungeon' ? undefined : outskirtsKey(loc.id)
    if (today.zone === 'dungeon') return loc.type === 'dungeon' ? layerKey(loc.id, layerOf(rec, day)) : undefined
    const blocks = settlementBlocks(loc)
    const keys = today.zone === 'temple' || today.zone === 'brothel'
      ? blocks.filter((b) => b.kinds.has(today.zone as CellKind)).map((b) => b.key)
      : blocks.filter((b) => b.zone === today.zone).map((b) => b.key)
    return pickBlock(rec, day, keys.length ? keys : blocks.filter((b) => b.zone === 'town').map((b) => b.key))
  }
  // 沒有活躍地點：職員在自己的設施所在的區塊；其他人（舊資料、入住旅館時認識的人……）要認識才找得到
  const loc = locationById(rec.location)
  const blocks = settlementBlocks(loc)
  const spot = npcSpot(rec)
  if (spot) return blocks.find((b) => b.kinds.has(spot as CellKind))?.key
  if (!state.relationships?.[rec.id]) return undefined
  return pickBlock(rec, day, blocks.filter((b) => b.zone === 'town').map((b) => b.key))
}

/** 地標的格子：依地標的類型（landmarks.json 的 types）決定生成的人站在這裡的權重，取各類型裡最高的 */
function landmarkWeight(kind: string, who: NpcKind, tags: string[]): number {
  const l = landmarkDef(kind)
  if (!l) return 0
  let w = 0
  for (const t of l.types) {
    const npc = landmarkTypes[t]?.npc
    if (!npc) continue
    w = Math.max(w, npc[who] ?? 0, ...tags.map((g) => npc.tags?.[g] ?? 0))
  }
  return w
}

/** 固定站的格子：待在地標的人站在地標上（依劇情旗標搬走時看那一組的設定） */
export function fixedCell(rec: NpcRecord): { area: string; x: number; y: number } | undefined {
  if (rec.landmark && rec.stage === undefined) {
    const l = landmarkDef(rec.landmark)
    if (l) return l.at
  }
  return rec.fixed
}

// 隨機的人在格子上的分佈：冒險者常在酒館與公會，普通人多在街上；神官在神殿
const CELL_WEIGHTS: Record<NpcKind, Partial<Record<CellKind, number>>> = {
  adventurer: { tavern: 6, guild: 4, inn: 2, floor: 1, shop: 1, temple: 0.5, resource: 1, quest: 1, safe: 2 },
  commoner: { floor: 3, shop: 2, tavern: 1, inn: 1, temple: 1, resource: 1, quest: 1 },
}
const TAG_CELLS: Record<string, Partial<Record<CellKind, number>>> = {
  priest: { temple: 8 },
  bishop: { temple: 10 },
  merchant: { shop: 4 },
  prostitute: { brothel: 10 },
}

/** NPC 在區域裡的格子：職員在自己的設施，暫時待著的人在指定的格子，其他人依日期與時段（每 6 小時）分佈 */
export function npcCell(state: GameState, rec: NpcRecord, area: Area): { x: number; y: number } | null {
  const ally = allyPlacement(state, rec.id)
  if (ally?.area === area.key) return { x: ally.x, y: ally.y }
  if (rec.at && rec.at.area === area.key && state.time.day <= rec.at.until) return { x: rec.at.x, y: rec.at.y }
  // 小隊的隊員：站在隊長旁邊
  const lead = followsLeader(state, rec)
  if (lead) {
    const at = npcCell(state, lead, area)
    return at ? besideCell(area, at, rec.id) : null
  }
  const fixed = fixedCell(rec)
  if (fixed?.area === area.key && fixed.x < area.width && fixed.y < area.height) return { x: fixed.x, y: fixed.y }
  const spot = !rec.haunts?.length ? npcSpot(rec) : undefined
  if (spot) return findKind(area, spot as CellKind)
  const weights: Partial<Record<CellKind, number>> = { ...CELL_WEIGHTS[npcKind(rec)] }
  for (const t of rec.tags ?? []) Object.assign(weights, TAG_CELLS[t] ?? {})
  const slot = Math.floor((state.time.hour ?? 0) / 6)
  const rng = new Rng(hashString(`${rec.id}@${state.time.day}#${slot}@${area.key}`))
  const options = Object.fromEntries(
    area.cells.map((c, i) => [String(i), weights[c.kind] ?? landmarkWeight(c.kind, npcKind(rec), rec.tags ?? [])] as const).filter(([, w]) => w > 0),
  )
  if (!Object.keys(options).length) return null
  const i = Number(weightedPick(rng, options))
  return { x: i % area.width, y: Math.floor(i / area.width) }
}

const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const

/** 隊長旁邊走得到的一格（依隊員 id 固定挑；四周都走不到時和隊長同一格） */
function besideCell(area: Area, at: { x: number; y: number }, id: string): { x: number; y: number } {
  const open = AROUND.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < area.width && p.y < area.height && !['wall', 'water', 'manor'].includes(area.cells[p.y * area.width + p.x]!.kind))
  return open.length ? open[hashString(`${id}:beside`) % open.length]! : at
}

export interface PresentNpc {
  rec: NpcRecord
  kind: NpcKind
  /** 職員：店主、公會職員等，固定待在自己的設施 */
  staff: boolean
  x: number
  y: number
  /** 和主角的距離（格；斜角也算一格） */
  dist: number
}

/** 這個區域裡的人（不含隊友），依距離排序；距離 1 以內的人才能互動 */
export function peopleHere(state: GameState): PresentNpc[] {
  const inParty = new Set(state.party.map((m) => m.id))
  const area = currentArea(state)
  const p = position(state)
  const out: PresentNpc[] = []
  for (const rec of allNpcs(state)) {
    if (inParty.has(rec.id) || areaOf(state, rec) !== area.key) continue
    const cell = npcCell(state, rec, area)
    if (!cell) continue
    const staff = !rec.haunts?.length && !!npcSpot(rec)
    out.push({ rec, kind: npcKind(rec), staff, ...cell, dist: Math.max(Math.abs(cell.x - p.x), Math.abs(cell.y - p.y)) })
  }
  return out.sort((a, b) => a.dist - b.dist || Number(b.staff) - Number(a.staff) || a.rec.name.localeCompare(b.rec.name))
}

/** 身邊的人：同一格或相鄰的格子 */
export function nearbyPeople(state: GameState): PresentNpc[] {
  return peopleHere(state).filter((p) => p.dist <= 1)
}

/** 角色現在是否在主角身邊：隊友永遠在；其他人要在同一個區域、同一格或相鄰的格子 */
export function presentHere(state: GameState, id: string): boolean {
  if (state.party.some((m) => m.id === id)) return true
  // 被制伏、倒在地上等你處置的人：一直在你手上
  if (state.captives?.npcs.includes(id) && state.captives.area === currentArea(state).key) return true
  return nearbyPeople(state).some((p) => p.rec.id === id)
}

/** 區域 key 是聚落裡的區塊（不是近郊、地下城、房子） */
function inTownArea(key: string): boolean {
  const [loc, block] = key.split('/')
  return !!loc && !!block && geography.locations.some((l) => l.id === loc && l.type !== 'dungeon') && block !== 'outskirts'
}

/** 今天在這座城裡（任何區塊）、可以雇用的冒險者 */
export function adventurersInTown(state: GameState): NpcRecord[] {
  const inParty = new Set(state.party.map((m) => m.id))
  ensureRoster(state, state.location)
  return allNpcs(state).filter((rec) => {
    // 留在你家看家的夥伴不算
    if (inParty.has(rec.id) || npcKind(rec) !== 'adventurer' || rec.hostile || rec.staying) return false
    if (rec.dead || !visibleNpc(state, rec)) return false
    // 暫時待在城裡某一格的人（例如剛離隊、在酒館待幾天）
    if (rec.at && state.time.day <= rec.at.until && inTownArea(rec.at.area)) return rec.at.area.split('/')[0] === state.location
    const fixed = fixedCell(rec)
    if (fixed) return fixed.area.split('/')[0] === state.location
    const today = whereToday(rec, state.time.day)
    if (today) return today.location === state.location && today.zone !== 'outskirts' && today.zone !== 'dungeon'
    // 舊資料：離隊後回到酒館的人
    return rec.location === state.location && npcSpot(rec) === 'tavern' && !/^(slv|pty|mst)_/.test(rec.id)
  })
}

/** 今天在城裡、或就在身邊（野外、地下城）的冒險者都可以雇用 */
export function hireable(state: GameState): NpcRecord[] {
  const list = adventurersInTown(state)
  for (const p of nearbyPeople(state)) {
    if (p.kind === 'adventurer' && !p.staff && !p.rec.hostile && !p.rec.staying && !isHostile(state, p.rec) && !list.includes(p.rec)) list.push(p.rec)
  }
  // 不受雇用的固定 NPC（統治者……）不列入；小隊不拆開雇用（只能整隊邀請）
  return list.filter((r) => !isUnhireable(r.id) && !inActiveSquad(state, r.id))
}

/** 這位固定 NPC 不能偷襲、不能偷竊（看內容頁籤的設定） */
export function isGuarded(id: string, kind: 'attack' | 'steal'): boolean {
  const def = namedNpcs.find((n) => n.id === id)
  return !!(kind === 'attack' ? def?.no_attack : def?.no_steal)
}

/** 這位固定 NPC 不受雇用 */
export function isUnhireable(id: string): boolean {
  return !!namedNpcs.find((n) => n.id === id)?.unhireable
}

/**
 * 敵對：被攻擊過、或在野外與地下城遇到「惡人」或關係很差的冒險者。
 * 在城裡，惡人與關係差的人不會動手（只有被攻擊過的人保持敵對）。
 */
export function isHostile(state: GameState, rec: NpcRecord, areaKind = currentArea(state).kind): boolean {
  if (rec.hostile) return true
  if (areaKind === 'settlement' || npcKind(rec) !== 'adventurer') return false
  // 好人：被攻擊過才會動手
  if (rec.tags?.some((t) => npcTags.tags[t]?.never_hostile)) return false
  const affinity = state.relationships?.[rec.id]?.affinity
  return !!rec.tags?.includes('villain') || (affinity !== undefined && affinity <= population.hostility.affinity)
}

// ---- 名單變動 ----

/** 每 period_days 天，每份名單有機率發生一件事：有人搬來、冒險者搬家、旅人離開（見 npc_population.json） */
export function refreshRosters(state: GameState) {
  const t = population.turnover
  const today = state.time.day
  for (const [locId, roster] of Object.entries(state.rosters ?? {})) {
    const since = roster.updated ?? roster.day
    const periods = Math.floor((today - since) / t.period_days)
    // 很久沒回來時，最多補算最近 10 次
    for (let i = Math.max(1, periods - 9); i <= periods; i++) {
      const rng = new Rng(hashString(`${state.seed}:turnover:${locId}:${since + i * t.period_days}`))
      if (rng.next() < t.chance) rosterEvent(state, locId, roster, rng)
    }
    if (periods > 0) roster.updated = since + periods * t.period_days
  }
}

function rosterEvent(state: GameState, locId: string, roster: Roster, rng: Rng) {
  const loc = locationById(locId)
  const size = rosterSize(loc)
  if (!size) return
  const inParty = new Set(state.party.map((m) => m.id))
  const members = roster.members.map((id) => npcRecord(state, id)).filter((r): r is NpcRecord => !!r && !r.dead)
  roster.members = members.map((r) => r.id)
  const count = (k: NpcKind) => members.filter((r) => takesSlot(r, k)).length
  // 未滿額：有人搬來
  for (const kind of ['adventurer', 'commoner'] as NpcKind[]) {
    if (count(kind) < size[kind]) {
      roster.members.push(generateResident(state, rng, loc, kind).id)
      return
    }
  }
  const movable = members.filter((r) => r.generated && !inParty.has(r.id))
  if (!movable.length) return
  const who = rng.pick(movable)
  roster.members = roster.members.filter((id) => id !== who.id)
  const elsewhere = (who.haunts ?? []).filter((h) => h.location !== locId && h.zone !== 'dungeon' && isSettlement(h.location))
  if (npcKind(who) === 'adventurer' && elsewhere.length) {
    // 搬到另一個活躍地點：加入那裡的名單，活躍地點改以新家為中心
    const to = locationById(rng.pick(elsewhere).location)
    who.location = to.id
    who.haunts = buildHaunts(rng, 'adventurer', who.tags ?? [], to)
    state.rosters![to.id]?.members.push(who.id)
  } else if (state.relationships?.[who.id]) {
    // 認識的人離開這一帶：到兩步以內的另一座聚落生活
    const near = [...new Set(neighbors(locId).flatMap((n) => [n, ...neighbors(n)]))].filter((id) => id !== locId && isSettlement(id))
    if (near.length) {
      const to = locationById(rng.pick(near))
      who.location = to.id
      who.haunts = buildHaunts(rng, npcKind(who), who.tags ?? [], to)
    }
  } else {
    // 不認識的人就這樣離開了
    delete state.npcs![who.id]
  }
}

// ---- 野外與地下城遇到的人 ----

/** 可以放人的格子（距離起點 min 格以上、不是遭遇或陷阱） */
function openCells(area: Area, from: { x: number; y: number } | null, min: number): number[] {
  const OK = new Set<CellKind>(['floor', 'resource', 'quest', 'safe'])
  return area.cells
    .map((c, i) => (OK.has(c.kind) ? i : -1))
    .filter((i) => i >= 0 && (!from || Math.max(Math.abs((i % area.width) - from.x), Math.abs(Math.floor(i / area.width) - from.y)) >= min))
}

/**
 * 進入近郊（每天一次）或地下城的一層時，可能遇到人：認識的人（重逢），或新面孔；
 * 地下城遇到的一定是冒險者，可能是一支隊伍，也可能是惡人。用固定亂數，不影響遊戲的亂數。
 */
export function spawnVisitors(state: GameState, area: Area, from: { x: number; y: number } | null) {
  if (area.kind === 'settlement' || area.kind === 'home') return
  const day = state.time.day
  const dungeon = area.kind === 'dungeon'
  const cfg = dungeon ? population.visitors.dungeon : population.visitors.outskirts
  const rng = new Rng(hashString(`${state.seed}:visit:${area.key}:${day}`))
  if (rng.next() >= cfg.chance) return
  const cells = openCells(area, from, 3)
  if (!cells.length) return
  const place = (rec: NpcRecord, i: number) => {
    rec.at = { area: area.key, x: i % area.width, y: Math.floor(i / area.width), until: day }
  }
  const spot = rng.pick(cells)

  // 重逢：認識的人，活躍地點包含這裡
  if (rng.next() < cfg.reunion_chance) {
    const inParty = new Set(state.party.map((m) => m.id))
    const known = allNpcs(state).filter((r) => !r.dead && !inParty.has(r.id) && state.relationships?.[r.id]
      && (!dungeon || npcKind(r) === 'adventurer') && (r.haunts ?? []).some((h) => h.location === area.location))
    if (known.length) {
      place(rng.pick(known), spot)
      return
    }
  }

  const home = locationById(isSettlement(area.location) ? area.location : neighbors(area.location).find(isSettlement) ?? area.location)
  if (!isSettlement(home.id)) return
  const kind: NpcKind = dungeon || rng.next() < population.visitors.outskirts.adventurer ? 'adventurer' : 'commoner'
  const d = population.visitors.dungeon
  const size = dungeon && rng.next() < d.party_chance ? rng.int(d.party_size[0], d.party_size[1]) : 1
  const villain = dungeon && rng.next() < d.villain_chance
  const group = size > 1 ? `grp_${hashString(`${area.key}:${day}`)}` : undefined
  const near = [spot, ...cells.filter((i) => i !== spot && Math.abs((i % area.width) - (spot % area.width)) <= 1 && Math.abs(Math.floor(i / area.width) - Math.floor(spot / area.width)) <= 1)]
  for (let n = 0; n < size; n++) {
    const rec = generateResident(state, rng, home, kind, 'vis')
    if (villain && !rec.tags?.includes('villain')) rec.tags = [...(rec.tags ?? []).filter((t) => !tagsExclusive(t, 'villain')), 'villain']
    if (group) rec.group = group
    place(rec, near[n % near.length]!)
  }
}

/** 和主角沒有任何關聯、也不在名單上的生成 NPC：移除，避免存檔越來越大 */
export function pruneNpcs(state: GameState) {
  const keep = new Set<string>([
    ...state.party.map((m) => m.id),
    ...Object.keys(state.relationships ?? {}),
    ...Object.values(state.rosters ?? {}).flatMap((r) => r.members),
    ...(state.memories ?? []).flatMap((m) => m.participants),
    ...Object.values(state.markets ?? {}).flatMap((m) => m.stock.map((x) => x.npc)),
    ...(state.partyOffers ?? []).flatMap((o) => [o.leader, ...o.members]),
    ...state.party.flatMap((m) => (contractOf(m) ? [contractOf(m)!.master] : [])),
  ])
  for (const [id, rec] of Object.entries(state.npcs ?? {})) {
    if (rec.generated && /^(tav|slv|pty|vis)_/.test(id) && !keep.has(id) && !(rec.at && rec.at.until >= state.time.day)) delete state.npcs![id]
  }
}

// ---- AI 潤飾 ----

/** AI 潤飾的文字（名字、外貌、性格、背景，普通人還有職業描述）；數值不變 */
export interface NpcFlavor { id: string; name?: string; appearance?: string; personality?: string; background?: string; occupation?: string }

/** 名單上還沒潤飾過的人：生成的、還不認識的（名單變動搬來的新居民也算，到這裡時再潤飾一次） */
export function unflavored(state: GameState, locId: string): NpcRecord[] {
  const roster = state.rosters?.[locId]
  if (!roster) return []
  return roster.members
    .map((id) => state.npcs?.[id])
    .filter((r): r is NpcRecord => !!r?.generated && !r.flavored && !state.relationships?.[r.id])
}

/**
 * 套用 AI 潤飾的文字。sent：送給 AI 的人（buildRosterPrompt 當時的 unflavored）；
 * 等 AI 回應的這段時間名單可能變了，只標記真的送出去的人，新搬來的人留到下次。
 */
export function applyRosterFlavor(state: GameState, locId: string, flavors: NpcFlavor[], sent?: string[]) {
  const roster = state.rosters?.[locId]
  if (!roster) return
  const list = unflavored(state, locId).filter((r) => !sent || sent.includes(r.id))
  const ids = new Set(list.map((r) => r.id))
  const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')
  const usedNames = new Set([...Object.values(state.npcs ?? {}).map((n) => n.name), ...namedNpcs.map((n) => n.name), ...state.party.map((m) => m.name)])
  for (const f of flavors) {
    const rec = state.npcs?.[f.id]
    if (!rec || !ids.has(f.id)) continue
    const name = clip(f.name, 12)
    if (name && !usedNames.has(name)) {
      usedNames.add(name)
      rec.name = name
    }
    rec.appearance = clip(f.appearance, 160) || rec.appearance
    rec.personality = clip(f.personality, 120) || rec.personality
    const bg = clip(f.background, 160)
    if (bg) rec.background = bg
    const occupation = clip(f.occupation, 12)
    if (occupation && npcKind(rec) === 'commoner') rec.occupation = occupation
  }
  // 交給 AI 的人都算潤飾過（AI 漏掉的人保留原本的文字，不再重問）
  for (const rec of list) rec.flavored = true
}
