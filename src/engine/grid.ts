// 走格子系統。
//
// 每個地點由區塊組成，區塊由格子組成：
// - 城市與城鎮的區塊是固定地圖（data/world/maps.json），可在區塊間通行，城門可出城或啟程旅行。
// - 城鎮近郊（荒野）與冒險區域（周邊 → 淺層 → 中層 → 深層）是隨機生成的格子，存在 GameState.areas，
//   有戰爭迷霧；離開後重新進入會重新生成（近郊每天換一次）。
// 走進格子會觸發內容：遭遇（戰鬥）、陷阱（檢定）、資源（採集）等；設施與樓梯等需要在格子上選擇動作。

import { checkBonus, checkModifiers, modifierNote } from './perks'
import { condMet } from './storyFlags'
import { sceneShown } from './landmarks'
import mapsJson from '@data/world/maps.json'
import { attrOf, mod, proficiency, snapshot } from './character'
import { startCombat, type CombatState } from './combat'
import {
  attrName, contentRevision, dungeonEncounters, enemies, geography, itemDef, locationById, regionById, shopRules, wildEncounters, landmarkDef, landmarks, dungeonDepth, dungeonFirstLayer, parkPlaza, type BossLayerId, type LandmarkDef,
  type DungeonLayerId, type EncounterGroup, type Location, type ShopType, specialKey, specialMapLegend, specialMapOfKey, specialMaps, type SpecialMapDef,
} from './data'
import { endpointsIn, onAreaChange, overlayConnections, specialArea, specialDefeat } from './specialMaps'
import { forgeItemFor, gearRules, MATERIAL_KINDS, randomGear, registerGear } from './gear'
import { isMaterialQuest, questTargets } from './materialQuests'
import { blockingNode, ensureStoryMarkers, sideNodesOpen, storyNeedsLandmark } from './story'
import { applyPendingMove, leaveSide, roadMove } from './road'
import { ensureIntelPoints, finishIntel } from './intel'
import { formatMoney } from './money'
import { spawnVisitors } from './population'
import { gateCheck, persuadePalaceGuard as persuadeGuard, zoneEntryBlock } from './security'
import { assertMasterAllows } from './slavery'
import { assertMayLeaveHouse, atMasterHome, touchMasterHome } from './masterHome'
import { roll, withBonus, type Rng } from './rng'
import { maybeDungeonEvent } from './dungeonEvents'
import { enterPark, mimicFor, parkOfLink, parkRules, parkTrap, returnToPlaza, stepParkLust } from './park'
import { attemptRetreat, reachLayer, startExpedition } from './expedition'
import { homeById, overlayLots } from './homes'
import { burnStep, inDarkness, layerLighting, lightingRules, sightIn, type Lighting } from './light'
import { bestTool } from './tools'
import { addHours, advanceTime, commitReport, newReportId, player, withRng } from './state'
import type { Character, GameState, GameTime, Quest, Report } from './types'
import { gameRule, rewardMoney } from './gameRules'

export type CellKind =
  | 'floor' | 'wall' | 'water'
  | 'inn' | 'guild' | 'tavern' | 'shop' | 'temple' | 'gate' | 'link' | 'brothel'
  | 'smithy' | 'tailor' | 'jeweler' | 'magic' | 'informant' | 'tattoo' | 'carver'
  | 'encounter' | 'elite' | 'boss' | 'trap' | 'resource' | 'safe' | 'chest'
  | 'stairs_down' | 'stairs_up' | 'exit' | 'quest'
  | 'road' | 'waypoint' | 'arrive' | 'event' | 'merchant'
  | 'lot' | 'yard' | 'manor'
  /** 自建的商店：格子的種類就是商店的 id（shop_ 開頭） */
  | `shop_${string}`
  /** 城鎮的特色地標：格子的種類就是地標的 id（lm_ 開頭） */
  | `lm_${string}`

export interface Cell {
  kind: CellKind
  /** 已清除的遭遇、已觸發的陷阱、已採集的資源、已使用的安全房 */
  done?: boolean
  group?: EncounterGroup
  item?: string
  questId?: string
  /** 特殊任務的任務點：任務 id:任務點 id */
  storyNode?: string
  /** 通道：通往的區域與座標 */
  link?: { area: string; x: number; y: number }
  /** 寶箱：這一層怪物的最高等級（決定內容） */
  level?: number
  /** 園區的擬態寶箱：打開時變成和這隻怪物的戰鬥 */
  mimic?: string
  /** 上鎖的寶箱：開鎖的 DC（打開之後拿掉） */
  lock?: number
  /** 打倒守在這裡的層主後，格子變成這種設施（淺層、中層的層主守著往下的階梯） */
  then?: CellKind
  /** 特殊地圖的 BOSS 格：地圖上與戰鬥場景顯示的名字 */
  name?: string
  /** 旅途的一格：第幾段路、走這一格花幾小時 */
  road?: { leg: number; hours: number; paid?: boolean }
  /** 旅途的事件（出發時就擲好） */
  event?: RoadEvent
  /** 途經或抵達的地點 */
  town?: string
  /** 情報的事件點（冒險筆記的情報 id） */
  intel?: string
  /** 待售的空地（lot）的 id；買下之後是房子的門（link），記房子的 id */
  lot?: string
  home?: string
  /** 房子裡的通道：樓梯往上、往下，或出門 */
  dir?: 'up' | 'down' | 'out'
  /** 房子裡擺的家具（物品名稱） */
  furniture?: string
  /** 苗圃上種的東西：種子與播種的時間（見 garden.ts） */
  crop?: { seed: string; planted: GameTime }
}

/** 旅途格子上的事件：auto 原本的旅途事件、normal 普通事件、advanced 高階事件、special 特殊任務的開頭、master 主人的事件 */
export interface RoadEvent {
  tier: 'auto' | 'normal' | 'advanced' | 'special' | 'master'
  /** auto：原本的旅途事件（travel.ts 的 EVENTS） */
  hazard?: { mode: string; index: number }
  /** normal / advanced：travel_events.json 的範本 */
  template?: string
  /** special：特殊任務的 id */
  story?: string
  /** 出發時擲好的自然骰 */
  roll?: number
}

export interface Area {
  key: string
  location: string
  name: string
  /** road：旅途（單行道）；side：旅途或事件帶進去的臨時地圖（洞窟、遺跡、驛站）；home：玩家的房子；special：特殊地圖 */
  kind: 'settlement' | 'wild' | 'dungeon' | 'road' | 'side' | 'home' | 'special'
  /** 特殊地圖的 id（special_maps.json） */
  special?: string
  /** 特殊地圖生成時的版本（地圖的定義改過時重新生成） */
  version?: string
  /** 臨時地圖的範本（travel_events.json 的 side_maps） */
  template?: string
  /** 聚落區塊所屬的地區（貴族區、王城）；沒有時為一般區域 */
  zone?: Zone
  /** 冒險區域的層數（0 = 周邊） */
  layer?: number
  width: number
  height: number
  cells: Cell[]
  /** 已探索的格子索引；城鎮固定地圖全部可見，不需要記錄 */
  revealed?: number[]
  /** 生成的日期（近郊每天重新生成） */
  day?: number
  /** 光線（見 light.ts）；沒有時依區域種類推算 */
  lighting?: Lighting
  /** 房子的哪一層：basement 地下室、ground 一樓（含院子）、upper 樓上 */
  homeFloor?: 'basement' | 'ground' | 'upper'
}

export interface Position {
  area: string
  x: number
  y: number
  /** 上一格，戰鬥撤退時退回這裡 */
  prev?: { x: number; y: number }
}

export interface BlockDef { id: string; name: string; grid: string[]; links?: Record<string, string>; zone?: Zone }

/** 地區：決定 NPC 出現在哪裡（見 docs/NPC_SYSTEM.md 第 5 節） */
export type Zone = 'town' | 'noble' | 'palace' | 'temple' | 'brothel' | 'outskirts' | 'dungeon'
export const ZONES: Zone[] = ['town', 'noble', 'palace', 'temple', 'brothel', 'outskirts', 'dungeon']
interface LayerGen {
  id: DungeonLayerId
  name: string
  encounters: [number, number]
  traps: [number, number]
  resources: [number, number]
  /** 寶箱數量 */
  chests?: [number, number]
  elites?: number
  boss?: boolean
  /** 層主守著往下的階梯（打倒後變成階梯） */
  guard?: boolean
  trap_dc: number
  trap_damage: string
  /** 寶箱上鎖的機率與開鎖的 DC */
  chest_lock?: [number, number]
}
const maps = mapsJson as unknown as {
  legend: Record<string, { kind: CellKind; name: string }>
  maps: Record<string, { blocks: BlockDef[] }>
  palace_names: Record<string, string>
  templates: Record<string, { blocks: BlockDef[] }>
  template_by_type: Record<string, string>
  generation: {
    step_minutes: { settlement: number; wild: number; dungeon: number }
    wild: { size: [number, number]; obstacles: number; encounters: [number, number]; resources: [number, number]; resource_items: string[] }
    dungeon: { size: [number, number]; carve_steps: number; layers: LayerGen[]; resource_items: string[] }
  }
}

export const CELL_NAME: Record<CellKind, string> = {
  floor: '道路', wall: '牆', water: '水道',
  inn: '旅店', guild: '冒險者公會', tavern: '酒館', shop: '雜貨店', temple: '神殿', gate: '城門', link: '通道', brothel: '娼館',
  smithy: '鐵匠鋪', tailor: '裁縫店', jeweler: '珠寶店', magic: '魔法物品店', informant: '情報商', tattoo: '刺青店', carver: '刻印師',
  encounter: '遭遇', elite: '強敵', boss: '層主', trap: '陷阱', resource: '資源', safe: '安全房', chest: '寶箱',
  stairs_down: '往下一層', stairs_up: '往上一層', exit: '出口', quest: '委託地點',
  road: '路', waypoint: '途經', arrive: '目的地', event: '事件', merchant: '流浪商人',
  lot: '待售的房子', yard: '院子', manor: '民宅',
}

/** 地圖與場所標題用的圖示：每一種設施都要有 */
export const CELL_ICON: Partial<Record<CellKind, string>> = {
  inn: '🛏️', guild: '🏛️', tavern: '🍺', shop: '🛒', temple: '⛪', gate: '🚪', link: '➡️', brothel: '🏮',
  smithy: '⚒️', tailor: '🧵', jeweler: '💍', magic: '🔮', informant: '🕵️', tattoo: '🖋️', carver: '🔏',
  encounter: '⚔️', elite: '💀', boss: '👑', resource: '🌿', safe: '🔥', chest: '🎁',
  stairs_down: '⬇️', stairs_up: '⬆️', exit: '🚪', quest: '❗', water: '〰️',
  waypoint: '🏘️', arrive: '🏁', event: '❔', merchant: '🧳',
  lot: '🪧', manor: '🏚️',
}
// 地標的圖示（內容編輯器改了會重設）
for (const l of Object.values(landmarks)) CELL_ICON[l.id as CellKind] = l.emoji

/** 格子的名稱 */
export function cellName(kind: CellKind): string {
  return CELL_NAME[kind] ?? shopRules.types[kind as ShopType]?.name ?? landmarkDef(kind)?.name ?? ''
}

// ---- 世界設定擺的商店 ----
// 內容編輯器可以移動內建商店的位置、擺自建的商店：套用內容時算好每個區塊要改的格子，建立聚落區塊時疊上去

/** 區塊 key → 格子的 index → 改成的種類 */
let cellOverrides: Record<string, Record<number, CellKind>> = {}

export function setCellOverrides(map: Record<string, Record<number, CellKind>>) {
  cellOverrides = map
  invalidateBlocks()
}
/** 地標改了位置或增減時：清掉各區塊設施與基底地圖的快取 */
export function invalidateBlocks() {
  blockKinds.clear()
  baseBlocks.clear()
}
/** 各聚落區塊有哪些設施（settlementBlocks 用；換位置時清掉） */
const blockKinds = new Map<string, Set<CellKind>>()

// 民宅：不是主人的家時不能進入（是主人的家時疊成通往屋內的通道）
const WALKABLE_BLOCKERS: CellKind[] = ['wall', 'water', 'manor']
export const DUNGEON_LAYERS = maps.generation.dungeon.layers

// ---- 區域 ----

export function blocksFor(loc: Location): BlockDef[] {
  const custom = maps.maps[loc.id]
  if (custom) return custom.blocks
  const template = maps.templates[maps.template_by_type[loc.type] ?? 'town'] ?? maps.templates.town!
  return template.blocks
}

export function settlementKey(locationId: string, blockId: string) {
  return `${locationId}/${blockId}`
}

function palaceName(loc: Location): string {
  return (loc.faction && maps.palace_names[loc.faction]) || '王城'
}

/** 一個地點有哪些地區（依地圖的區塊與設施） */
export function zonesOf(loc: Location): Zone[] {
  const zones = new Set<Zone>(['town', 'outskirts'])
  for (const b of blocksFor(loc)) {
    if (b.zone) zones.add(b.zone)
    if (b.grid.some((row) => row.includes('C'))) zones.add('temple')
    if (b.grid.some((row) => row.includes('B'))) zones.add('brothel')
  }
  return [...zones]
}

/** 聚落的各區塊：區域 key、地區、有哪些設施 */
export function settlementBlocks(loc: Location): { key: string; zone: Zone; kinds: Set<CellKind> }[] {
  if (loc.type === 'dungeon') return []
  return blocksFor(loc).map((b) => ({
    key: settlementKey(loc.id, b.id),
    zone: b.zone ?? 'town',
    // 包含世界設定移動或擺上的商店
    kinds: kindsOfBlock(loc, b),
  }))
}

function kindsOfBlock(loc: Location, b: BlockDef): Set<CellKind> {
  const key = settlementKey(loc.id, b.id)
  let kinds = blockKinds.get(key)
  if (!kinds) blockKinds.set(key, (kinds = new Set(buildBlock(loc, b).cells.map((c) => c.kind))))
  return kinds
}

/** 主角現在所在的地區：站在神殿格上是神殿，其餘依區域 */
export function currentZone(state: GameState): Zone {
  const area = currentArea(state)
  if (area.kind === 'dungeon') return 'dungeon'
  if (area.kind === 'wild' || area.kind === 'road' || area.kind === 'side' || area.kind === 'special') return 'outskirts'
  if (currentCell(state).kind === 'temple') return 'temple'
  if (currentCell(state).kind === 'brothel') return 'brothel'
  return area.zone ?? 'town'
}

export function outskirtsKey(locationId: string) {
  return `${locationId}/outskirts`
}

export function layerKey(locationId: string, layer: number) {
  return `${locationId}/L${layer}`
}

/**
 * 聚落區塊的基底地圖：只依遊戲資料（地圖、世界設定擺的商店與地標），不依存檔，建一次就記住。
 * 房子、通道、隱藏的地標每次另外疊上去（都是換掉整格），所以每次給一份新的格子陣列，快取不會被改到。
 * 內容改了（contentRevision）或地標、商店換位置（invalidateBlocks）時重建。
 */
const baseBlocks = new Map<string, Area>()
let baseBlocksRev = -1
function baseBlock(loc: Location, block: BlockDef): Area {
  if (baseBlocksRev !== contentRevision()) {
    baseBlocks.clear()
    baseBlocksRev = contentRevision()
  }
  const key = settlementKey(loc.id, block.id)
  let base = baseBlocks.get(key)
  if (!base) baseBlocks.set(key, (base = buildBlock(loc, block)))
  return { ...base, cells: base.cells.slice() }
}

/** 固定地圖的區塊（由資料建立，不存檔）；overlay 為 false 時不疊世界設定擺的商店 */
function buildBlock(loc: Location, block: BlockDef, overlay = true): Area {
  const width = block.grid[0]!.length
  const height = block.grid.length
  const cells: Cell[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = block.grid[y]![x] ?? '#'
      if (/[1-9]/.test(ch)) {
        const target = block.links?.[ch]
        const targetBlock = blocksFor(loc).find((b) => b.id === target)
        const pos = targetBlock ? findChar(targetBlock, ch) : null
        cells.push(pos && target ? { kind: 'link', link: { area: settlementKey(loc.id, target), ...pos } } : { kind: 'wall' })
      } else {
        cells.push({ kind: maps.legend[ch]?.kind ?? 'wall' })
      }
    }
  }
  const key = settlementKey(loc.id, block.id)
  const over = overlay ? cellOverrides[key] : undefined
  for (const [i, kind] of Object.entries(over ?? {})) if (cells[Number(i)]) cells[Number(i)] = { kind }
  // 城鎮的特色地標：擺在道路上（被別的東西佔住時不顯示）
  for (const l of Object.values(landmarks)) {
    if (l.at.area !== key || l.at.x >= width || l.at.y >= height) continue
    const i = l.at.y * width + l.at.x
    if (cells[i]?.kind === 'floor') cells[i] = { kind: l.id as CellKind }
  }
  return {
    key: settlementKey(loc.id, block.id),
    location: loc.id,
    name: block.name.split('{town}').join(loc.name).split('{palace}').join(palaceName(loc)),
    kind: 'settlement',
    ...(block.zone && block.zone !== 'town' ? { zone: block.zone } : {}),
    width, height, cells,
  }
}

function findChar(block: BlockDef, ch: string): { x: number; y: number } | null {
  for (let y = 0; y < block.grid.length; y++) {
    const x = block.grid[y]!.indexOf(ch)
    if (x >= 0) return { x, y }
  }
  return null
}

/** 取得區域：固定地圖即時建立，隨機區域從存檔讀取。 */
export function getArea(state: GameState, key: string): Area {
  // 特殊地圖：存在存檔裡（定義改過時重新生成），每次都依旗標套上通道
  if (key.startsWith('sm/')) return overlayConnections(state, specialArea(state, key.slice(3)))
  const stored = state.areas?.[key]
  if (stored) return stored
  // 玩家的房子：存在房子的資料裡
  if (key.startsWith('home/')) {
    const area = homeById(state, key.split('/')[1]!)?.areas[key]
    if (!area) throw new Error(`unknown area: ${key}`)
    return area
  }
  const [locationId, blockId] = key.split('/') as [string, string]
  const loc = locationById(locationId)
  const block = blocksFor(loc).find((b) => b.id === blockId)
  if (!block) throw new Error(`unknown area: ${key}`)
  // 待售的空地與買下的房子（依存檔，疊在固定地圖上）；特殊地圖的通道（依旗標）
  return hideLandmarks(state, overlayConnections(state, overlayLots(state, baseBlock(loc, block))))
}

/**
 * 地標還沒出現：開放條件勾了「條件成立前不顯示」，劇情旗標又不符合；
 * 只有場景的地標（沒有參訪、探索、打工），一個場景都不出現時也不出現（內容篩選關掉、體型不符、一定在場的人死了）；
 * 沒勾「條件成立前不顯示」的（例如打工線的委託人所在），還有接得到或進行中的特殊任務要用到時照常出現，任務點才走得到
 */
export function landmarkHidden(state: GameState, l: LandmarkDef): boolean {
  const o = l.open
  if (o?.hidden && !condMet(state, { ...(o.flags ? { flags: o.flags } : {}), ...(o.flags_none ? { flags_none: o.flags_none } : {}) })) return true
  if (!l.scenes?.length || l.visit || l.explore || l.work || l.scenes.some((sc) => sceneShown(state, sc))) return false
  // 沒勾的（打工線的委託人所在、完成之後才有場景的地標）：還有接得到或進行中的任務要用到時留著，任務點才走得到
  return !!o?.hidden || !storyNeedsLandmark(state, l.id)
}

/** 還沒出現的地標還原成道路 */
function hideLandmarks(state: GameState, area: Area): Area {
  for (const l of Object.values(landmarks)) {
    if (l.at.area !== area.key || !landmarkHidden(state, l)) continue
    const i = l.at.y * area.width + l.at.x
    if (area.cells[i]?.kind === l.id) area.cells[i] = { kind: 'floor' }
  }
  return area
}

export function cellAt(area: Area, x: number, y: number): Cell | undefined {
  if (x < 0 || y < 0 || x >= area.width || y >= area.height) return undefined
  return area.cells[y * area.width + x]
}

export function findKind(area: Area, kind: CellKind): { x: number; y: number } | null {
  const i = area.cells.findIndex((c) => c.kind === kind)
  return i < 0 ? null : { x: i % area.width, y: Math.floor(i / area.width) }
}

export function currentArea(state: GameState): Area {
  return getArea(state, position(state).area)
}

export function position(state: GameState): Position {
  if (!state.position) enterLocation(state)
  return state.position!
}

export function currentCell(state: GameState): Cell {
  const p = position(state)
  return cellAt(currentArea(state), p.x, p.y) ?? { kind: 'floor' }
}

export function isRevealed(area: Area, x: number, y: number): boolean {
  // 聚落與旅途整張看得到（旅途的事件出發時就擲好了）；安全的室內（地標的內部）也是
  return area.kind === 'settlement' || area.kind === 'home' || area.kind === 'road' || isRoom(area) || (area.revealed?.includes(y * area.width + x) ?? false)
}

/** 安全的室內（特殊地圖勾了 peaceful，例如地標的內部）：一進去就看得到整間 */
function isRoom(area: Area): boolean {
  return area.kind === 'special' && !!specialMaps[area.special ?? '']?.peaceful
}

export function reveal(area: Area, x: number, y: number, radius = 1) {
  if (area.kind === 'settlement' || area.kind === 'home' || isRoom(area)) return
  const set = new Set(area.revealed ?? [])
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (cellAt(area, x + dx, y + dy)) set.add((y + dy) * area.width + (x + dx))
    }
  }
  area.revealed = [...set]
}

/** 拿掉生成的區域（離開地點、出發旅行）；特殊地圖保留在存檔裡 */
export function clearAreas(state: GameState) {
  state.areas = Object.fromEntries(Object.entries(state.areas ?? {}).filter(([k]) => k.startsWith('sm/')))
}

export function storeArea(state: GameState, area: Area) {
  state.areas ??= {}
  state.areas[area.key] = area
}

/** 聚落的固定區塊（不需要存檔；不是聚落區塊時為 undefined） */
export function settlementArea(key: string, overlay = true): Area | undefined {
  const [locationId, blockId] = key.split('/') as [string, string]
  const loc = geography.locations.find((l) => l.id === locationId)
  if (!loc || loc.type === 'dungeon') return undefined
  const block = blocksFor(loc).find((b) => b.id === blockId)
  return block ? buildBlock(loc, block, overlay) : undefined
}

/** 這座聚落的酒館格子（寄放夥伴、離隊的人等在這裡）；沒有酒館或不是聚落時為 undefined */
export function tavernSpot(locationId: string): { area: string; x: number; y: number } | undefined {
  const loc = geography.locations.find((l) => l.id === locationId)
  if (!loc || loc.type === 'dungeon') return undefined
  for (const b of settlementBlocks(loc)) {
    if (!b.kinds.has('tavern')) continue
    const area = settlementArea(b.key)
    const at = area && findKind(area, 'tavern')
    if (at) return { area: b.key, ...at }
  }
  return undefined
}

/** 聚落所有區塊的 key */
export function blockKeys(locationId: string): string[] {
  return blocksFor(locationById(locationId)).map((b) => settlementKey(locationId, b.id))
}

/** 站到聚落裡第一個指定種類的設施上（測試與事件用） */
export function standOn(state: GameState, kind: CellKind): boolean {
  const keys = locationById(state.location).type === 'dungeon' ? [currentArea(state).key] : blockKeys(state.location)
  for (const key of keys) {
    const area = getArea(state, key)
    const i = area.cells.findIndex((c) => c.kind === kind)
    if (i >= 0) {
      placeAt(state, area, i % area.width, Math.floor(i / area.width))
      return true
    }
  }
  return false
}

export function placeAt(state: GameState, area: Area, x: number, y: number) {
  state.position = { area: area.key, x, y }
  reveal(area, x, y, sight(state, area))
  noteSpot(state, area, cellAt(area, x, y))
}

// ---- 走過的地方（交給 AI 的前後銜接，見 narrator/continuity.ts） ----

const SPOT_KINDS = new Set<string>(['inn', 'guild', 'tavern', 'shop', 'temple', 'gate', 'brothel', 'smithy', 'tailor', 'jeweler', 'magic', 'informant', 'tattoo', 'carver', 'lot', 'manor', 'merchant'])
const TRAIL_MAX = 12

/** 站的地方叫什麼：區域名稱，站在設施或地標上時加上它的名字 */
export function spotName(area: Area, cell?: Cell): string {
  const kind = cell?.kind
  const named = kind && (SPOT_KINDS.has(kind) || shopRules.types[kind as ShopType]?.custom || landmarkDef(kind)) ? cellName(kind) : ''
  return named ? `${area.name}・${named}` : area.name
}

/** 換了地方時記一筆（只留最近幾筆） */
function noteSpot(state: GameState, area: Area, cell?: Cell) {
  if (area.kind === 'road') return
  const spot = spotName(area, cell)
  const trail = (state.trail ??= [])
  if (trail.at(-1)?.spot === spot) return
  trail.push({ time: { ...state.time }, location: area.location, spot })
  if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX)
}

/** 寶箱有沒有上鎖（依這一層的 chest_lock） */
function chestLock(rng: Rng, spec: LayerGen): { lock?: number } {
  return spec.chest_lock && rng.chance(spec.chest_lock[0]) ? { lock: spec.chest_lock[1] } : {}
}

/** 看得到幾格：地下城與臨時地圖帶著照明類的工具看得更遠 */
export function sight(state: GameState, area: Area): number {
  return sightIn(state, area)
}

/** 抵達地點（旅行後或開新遊戲）：城鎮站在城門，冒險區域站在周邊的入口。 */
export function enterLocation(state: GameState) {
  const loc = locationById(state.location)
  // 隨機區域在離開後作廢，下次進入重新生成（特殊地圖保留）
  clearAreas(state)
  if (loc.type === 'dungeon') {
    // 進入地下城：開始一趟新的探索
    startExpedition(state, loc.id)
    const first = dungeonFirstLayer(loc.id)
    const area = withRng(state, (rng) => generateLayer(state, loc, first, rng))
    storeArea(state, area)
    reachLayer(state, first)
    const entry = findKind(area, 'exit')!
    spawnVisitors(state, area, entry)
    placeAt(state, area, entry.x, entry.y)
    return
  }
  delete state.expedition
  const blocks = blocksFor(loc)
  const gateBlock = blocks.find((b) => b.grid.some((row) => row.includes('E'))) ?? blocks[0]!
  const area = buildBlock(loc, gateBlock)
  const gate = findKind(area, 'gate') ?? { x: 1, y: 1 }
  placeAt(state, area, gate.x, gate.y)
}

// ---- 隨機生成 ----

function randomCells(rng: Rng, area: Area, count: number, exclude: Set<number>): number[] {
  const free = area.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.kind === 'floor' && !exclude.has(i))
    .map(({ i }) => i)
  const picked: number[] = []
  while (picked.length < count && free.length > 0) picked.push(free.splice(rng.int(0, free.length - 1), 1)[0]!)
  return picked
}

function between(rng: Rng, [lo, hi]: [number, number]) {
  return rng.int(lo, hi)
}

/** 城鎮近郊：開闊的荒野，散落遭遇與資源，下方中央是回城的城門。 */
export function generateOutskirts(state: GameState, loc: Location, rng: Rng): Area {
  const g = maps.generation.wild
  const [width, height] = g.size
  const cells: Cell[] = Array.from({ length: width * height }, () => ({ kind: rng.chance(g.obstacles) ? 'wall' : 'floor' }) as Cell)
  const area: Area = {
    key: outskirtsKey(loc.id), location: loc.id, name: `${loc.name}近郊`, kind: 'wild',
    width, height, cells, revealed: [], day: state.time.day,
  }
  const gateIndex = (height - 1) * width + Math.floor(width / 2)
  cells[gateIndex] = { kind: 'exit' }
  // 從城門往上開一條路到地圖中央，避免城門被隨機障礙物圍住、整張圖只剩幾格能走
  for (let y = height - 2; y >= Math.floor(height / 2); y--) cells[y * width + Math.floor(width / 2)] = { kind: 'floor' }
  ensureConnected(area, gateIndex)
  const used = new Set([gateIndex, gateIndex - width])
  const table = wildEncounters(loc.region)
  for (const i of randomCells(rng, area, between(rng, g.encounters), used)) {
    cells[i] = { kind: 'encounter', group: rng.pick(table) }
    used.add(i)
  }
  for (const i of randomCells(rng, area, between(rng, g.resources), used)) {
    cells[i] = { kind: 'resource', item: rng.pick(g.resource_items) }
    used.add(i)
  }
  ensureQuestMarkers(state, area, rng)
  ensureQuestTargets(state, area, rng, table)
  ensureStoryMarkers(state, area, rng)
  ensureIntelPoints(state, area, rng)
  return area
}

/**
 * 帶著材料或掉落委託進入這一區時，確保有足量的採集點與戰鬥點：
 * 已有的（還沒採、還沒打的）先算進去，不夠時把空地改成採集點或遭遇（遭遇用遭遇表裡有這隻怪物的一組）。
 */
export function ensureQuestTargets(state: GameState, area: Area, rng: Rng, table: EncounterGroup[]) {
  const layer = area.kind === 'dungeon' ? DUNGEON_LAYERS[area.layer ?? 0]?.id : undefined
  if (area.kind === 'settlement' || area.kind === 'home') return
  const exit = area.cells.findIndex((c) => c.kind === 'exit' || c.kind === 'stairs_up')
  const keep = new Set([exit, exit - area.width])
  for (const t of questTargets(state, area.location, layer)) {
    const has = area.cells.filter((c) => !c.done && (t.item
      ? c.kind === 'resource' && c.item === t.item
      : (c.kind === 'encounter' || c.kind === 'elite') && c.group?.some(([id]) => id === t.monster))).length
    const group = table.find((g) => g.some(([id]) => id === t.monster)) ?? [[t.monster!, 1]] as EncounterGroup
    for (const i of randomCells(rng, area, Math.max(0, t.cells - has), keep)) {
      area.cells[i] = t.item ? { kind: 'resource', item: t.item } : { kind: 'encounter', group }
    }
  }
}

/** 要站在 ❗ 上執行的近郊委託（城鎮委託範本的近郊委託）。材料委託也在近郊，但是靠採集點與戰鬥點（ensureQuestTargets），沒有 ❗ */
function hasQuestMarker(q: Pick<Quest, 'area' | 'kind' | 'status'>): boolean {
  return q.area === 'outskirts' && q.status === 'accepted' && !isMaterialQuest(q)
}

/** 在近郊標出已接取的近郊委託地點（接委託時近郊已經生成過也會補上）。 */
function ensureQuestMarkers(state: GameState, area: Area, rng: Rng) {
  // 舊版會替材料委託放 ❗，站上去按「執行委託」會出現「找不到這個委託」：順便拿掉
  const material = new Set(state.quests.filter(isMaterialQuest).map((q) => q.id))
  area.cells.forEach((c, i) => {
    if (c.kind === 'quest' && !c.storyNode && c.questId && material.has(c.questId)) area.cells[i] = { kind: 'floor' }
  })
  const marked = new Set(area.cells.map((c) => c.questId).filter(Boolean))
  for (const q of state.quests) {
    if (q.giver !== area.location || !hasQuestMarker(q) || marked.has(q.id)) continue
    const [i] = randomCells(rng, area, 1, new Set([area.cells.findIndex((c) => c.kind === 'exit')]))
    if (i === undefined) return
    area.cells[i] = { kind: 'quest', questId: q.id }
  }
}

/** 已完成（或不再進行中）的委託，把近郊的委託地點標記拿掉。 */
export function clearQuestMarkers(state: GameState) {
  const active = new Set(state.quests.filter(hasQuestMarker).map((q) => q.id))
  for (const area of Object.values(state.areas ?? {})) {
    area.cells.forEach((c, i) => {
      // 特殊任務的任務點由 story.ts 管理
      if (c.kind === 'quest' && !c.storyNode && (!c.questId || !active.has(c.questId))) area.cells[i] = { kind: 'floor' }
    })
  }
}

/** 城內委託要站在指定設施上，近郊委託要站在委託地點上。 */
export function questRunnableHere(state: GameState, quest: { id: string; area: string; giver: string; spot?: string }): boolean {
  if (quest.giver !== state.location) return false
  const area = currentArea(state)
  const cell = currentCell(state)
  if (quest.area === 'town') return area.kind === 'settlement' && cell.kind === (quest.spot ?? 'guild')
  if (quest.area === 'outskirts') return area.kind === 'wild' && cell.kind === 'quest' && cell.questId === quest.id
  return false
}

/** 冒險區域的一層：從入口隨機挖出通道，最遠處放下行階梯（深層放層主），入口旁是安全房。 */
export function generateLayer(state: GameState, loc: Location, layer: number, rng: Rng): Area {
  const g = maps.generation.dungeon
  const spec = g.layers[layer]!
  const [width, height] = g.size
  const cells: Cell[] = Array.from({ length: width * height }, () => ({ kind: 'wall' }) as Cell)
  const area: Area = {
    key: layerKey(loc.id, layer), location: loc.id, name: `${loc.name}・${spec.name}`, kind: 'dungeon', layer,
    width, height, cells, revealed: [], lighting: layerLighting(loc.id, layer),
  }
  // 隨機漫步挖出通道
  let x = Math.floor(width / 2)
  let y = height - 1
  const start = y * width + x
  cells[start] = { kind: 'floor' }
  for (let step = 0; step < g.carve_steps; step++) {
    const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, -1], [0, -1], [0, 1]] as const)
    const nx = Math.max(0, Math.min(width - 1, x + dx))
    const ny = Math.max(0, Math.min(height - 1, y + dy))
    x = nx
    y = ny
    cells[y * width + x] = { kind: 'floor' }
  }
  cells[start] = { kind: layer === dungeonFirstLayer(loc.id) ? 'exit' : 'stairs_up' }
  const used = new Set([start])
  // 入口旁的安全房
  const nearStart = [start - width, start - 1, start + 1].find((i) => cells[i]?.kind === 'floor')
  if (nearStart !== undefined) {
    cells[nearStart] = { kind: 'safe' }
    used.add(nearStart)
  }
  // 最遠的格子放階梯或層主
  const far = farthest(area, start)
  // 最深的一層（有底層時是底層，否則是深層）：最終層主；其他層：層主守著往下的階梯（沒有層主資料時直接是階梯）
  const enc = dungeonEncounters[loc.id]
  const last = layer >= dungeonDepth(loc.id) - 1
  const bossGroup = enc?.bosses?.[spec.id as BossLayerId] ?? (spec.id === 'deep' ? enc?.boss : undefined)
  cells[far] = last
    ? { kind: 'boss', group: bossGroup ?? [] }
    : spec.guard && bossGroup?.length
      ? { kind: 'boss', group: bossGroup, then: 'stairs_down' }
      : { kind: 'stairs_down' }
  used.add(far)

  const table = dungeonEncounters[loc.id]?.[spec.id] ?? wildEncounters(loc.region)
  for (const i of randomCells(rng, area, between(rng, spec.encounters), used)) {
    cells[i] = { kind: 'encounter', group: rng.pick(table) }
    used.add(i)
  }
  for (const i of randomCells(rng, area, spec.elites ?? 0, used)) {
    // 強敵：本層最強的一組，再多一隻
    const strongest = [...table].sort((a, b) => b.reduce((s, [, n]) => s + n, 0) - a.reduce((s, [, n]) => s + n, 0))[0] ?? []
    const group = strongest.map(([id, n], idx) => [id, idx === 0 ? n + 1 : n] as [string, number])
    cells[i] = { kind: 'elite', group }
    used.add(i)
  }
  for (const i of randomCells(rng, area, between(rng, spec.traps), used)) {
    cells[i] = { kind: 'trap' }
    used.add(i)
  }
  for (const i of randomCells(rng, area, between(rng, spec.resources), used)) {
    cells[i] = { kind: 'resource', item: rng.pick(g.resource_items) }
    used.add(i)
  }
  // 寶箱：內容依這一層怪物的最高等級
  const level = Math.max(1, ...table.flat().map(([id]) => enemies[id]?.level ?? 1))
  const mimic = parkPlaza(loc.id) ? mimicFor(area) : undefined
  for (const i of randomCells(rng, area, spec.chests ? between(rng, spec.chests) : 0, used)) {
    // 園區：有機會是擬態寶箱
    cells[i] = mimic && enemies[mimic] && rng.chance(parkRules().mimic_chance) ? { kind: 'chest', level, mimic } : { kind: 'chest', level, ...chestLock(rng, spec) }
    used.add(i)
  }
  ensureQuestTargets(state, area, rng, table)
  ensureStoryMarkers(state, area, rng)
  ensureIntelPoints(state, area, rng)
  return area
}

// ---- 臨時地圖（旅途事件帶進去的洞窟、遺跡、驛站） ----

export interface SideMapDef {
  name: string
  size?: [number, number]
  carve_steps?: number
  encounters?: [number, number]
  elites?: number
  traps?: [number, number]
  resources?: [number, number]
  chests?: [number, number]
  /** 寶箱與陷阱比照地下城的哪一層 */
  chest_layer?: DungeonLayerId
  /** 固定的地圖（驛站）：每個字元依 legend 對應格子種類 */
  grid?: string[]
  legend?: Record<string, CellKind>
  /** 可能遇到冒險者 */
  visitors?: boolean
  /** 光線（沒寫時固定地圖有光、其他黑暗） */
  lighting?: Lighting
}

/**
 * 生成臨時地圖：固定地圖照著畫；洞窟、遺跡從出口隨機挖出通道，放遭遇（用 table，強一點）、陷阱、資源與寶箱。
 * location 是這張地圖算在哪個地點（地名、地區、店家）。
 */
export function generateSide(state: GameState, key: string, template: string, def: SideMapDef, location: string, table: EncounterGroup[], rng: Rng): Area {
  if (def.grid) {
    const width = def.grid[0]!.length
    const cells = def.grid.join('').split('').map((ch) => ({ kind: def.legend?.[ch] ?? 'floor' }) as Cell)
    return { key, location, name: def.name, kind: 'side', template, width, height: def.grid.length, cells, revealed: [], lighting: def.lighting ?? 'lit' }
  }
  const [width, height] = def.size ?? [7, 7]
  const layer = Math.max(0, DUNGEON_LAYERS.findIndex((l) => l.id === (def.chest_layer ?? 'outskirts')))
  const cells: Cell[] = Array.from({ length: width * height }, () => ({ kind: 'wall' }) as Cell)
  const area: Area = { key, location, name: def.name, kind: 'side', template, layer, width, height, cells, revealed: [], lighting: def.lighting ?? 'dark' }
  let x = Math.floor(width / 2)
  let y = height - 1
  const start = y * width + x
  cells[start] = { kind: 'floor' }
  for (let step = 0; step < (def.carve_steps ?? 25); step++) {
    const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, -1], [0, -1], [0, 1]] as const)
    x = Math.max(0, Math.min(width - 1, x + dx))
    y = Math.max(0, Math.min(height - 1, y + dy))
    cells[y * width + x] = { kind: 'floor' }
  }
  cells[start] = { kind: 'exit' }
  const used = new Set([start])
  const strongest = [...table].sort((a, b) => b.reduce((s, [, n]) => s + n, 0) - a.reduce((s, [, n]) => s + n, 0))[0] ?? []
  for (const i of randomCells(rng, area, between(rng, def.encounters ?? [1, 2]), used)) {
    cells[i] = { kind: 'encounter', group: rng.pick(table) }
    used.add(i)
  }
  for (const i of randomCells(rng, area, def.elites ?? 0, used)) {
    cells[i] = { kind: 'elite', group: strongest.map(([id, n], idx) => [id, idx === 0 ? n + 1 : n] as [string, number]) }
    used.add(i)
  }
  for (const i of randomCells(rng, area, between(rng, def.traps ?? [0, 0]), used)) {
    cells[i] = { kind: 'trap' }
    used.add(i)
  }
  for (const i of randomCells(rng, area, between(rng, def.resources ?? [0, 0]), used)) {
    cells[i] = { kind: 'resource', item: rng.pick(maps.generation.dungeon.resource_items) }
    used.add(i)
  }
  const level = Math.max(1, ...table.flat().map(([id]) => enemies[id]?.level ?? 1)) + 1
  for (const i of randomCells(rng, area, between(rng, def.chests ?? [1, 1]), used)) {
    cells[i] = { kind: 'chest', level, ...chestLock(rng, DUNGEON_LAYERS[layer]!) }
    used.add(i)
  }
  return area
}

// ---- 特殊地圖（special_maps.json，docs/SPECIAL_MAPS.md） ----

/**
 * 地圖定義的版本：版面與內容的設定改過時，存檔裡的地圖重新生成。
 * 站在特殊地圖裡時每次取得區域都要比一次，整份定義轉成文字很花時間：同一份定義在內容沒改過（contentRevision）時記住結果
 */
let versionCache: { rev: number; map: WeakMap<SpecialMapDef, string> } | undefined
export function specialVersion(def: SpecialMapDef): string {
  if (versionCache?.rev !== contentRevision()) versionCache = { rev: contentRevision(), map: new WeakMap() }
  const known = versionCache.map.get(def)
  if (known !== undefined) return known
  const v = computeSpecialVersion(def)
  versionCache.map.set(def, v)
  return v
}

function computeSpecialVersion(def: SpecialMapDef): string {
  const { name: _n, desc: _d, location: _l, connections: _c, entry: _e, refresh: _r, ...layout } = def
  const text = JSON.stringify(layout)
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 特殊地圖的遭遇表：自己寫的，或所屬地點的（地下城用 layer 那一層，其他用地區的城郊遭遇表） */
export function specialTable(def: SpecialMapDef): EncounterGroup[] {
  const valid = (g: EncounterGroup) => g.length > 0 && g.every(([id]) => !!enemies[id])
  const own = (def.table ?? []).filter(valid)
  if (own.length) return own
  const loc = locationById(def.location)
  const layer = def.layer ?? 'shallow'
  return ((loc.type === 'dungeon' ? dungeonEncounters[loc.id]?.[layer] : undefined) ?? wildEncounters(loc.region)).filter(valid)
}

/** 生成特殊地圖：固定地圖照著畫（M、X、R、C、T 是固定位置的內容），隨機地圖從出口挖出通道；再隨機撒上額外的內容 */
export function generateSpecial(state: GameState, def: SpecialMapDef, rng: Rng): Area {
  const legend = { ...specialMapLegend, ...(def.legend ?? {}) }
  const layer = Math.max(0, DUNGEON_LAYERS.findIndex((l) => l.id === (def.layer ?? 'shallow')))
  const spec = DUNGEON_LAYERS[layer]!
  const table = specialTable(def)
  const strongest = [...table].sort((a, b) => b.reduce((s, [, n]) => s + n, 0) - a.reduce((s, [, n]) => s + n, 0))[0] ?? []
  const level = Math.max(1, ...table.flat().map(([id]) => (typeof id === 'string' ? enemies[id]?.level ?? 1 : 1)))
  const items = def.resource_items?.length ? def.resource_items : maps.generation.dungeon.resource_items
  const elite = (): Cell => (strongest.length ? { kind: 'elite', group: strongest.map(([id, n], i) => [id, i === 0 ? n + 1 : n] as [string, number]) } : { kind: 'floor' })
  const content = (kind: string, x = -1, y = -1): Cell => {
    switch (kind) {
      case 'encounter': return table.length ? { kind: 'encounter', group: rng.pick(table) } : { kind: 'floor' }
      case 'elite': return elite()
      case 'boss': {
        // BOSS 格：照設定的怪物；沒設定（或怪物都被刪了）時照強敵的規則
        const b = def.bosses?.find((x2) => x2.x === x && x2.y === y)
        const group = b?.group.filter(([id]) => !!enemies[id]) ?? []
        if (!group.length) {
          const e = elite()
          return e.group ? { ...e, kind: 'boss', name: b?.name || 'BOSS' } : e
        }
        return { kind: 'boss', group, name: b?.name || 'BOSS' }
      }
      case 'resource': return { kind: 'resource', item: rng.pick(items) }
      case 'chest': return { kind: 'chest', level, ...chestLock(rng, spec) }
      default: return { kind: kind as CellKind }
    }
  }
  let width: number
  let height: number
  let cells: Cell[]
  if (def.grid?.length) {
    width = Math.max(...def.grid.map((r) => r.length))
    height = def.grid.length
    cells = def.grid.flatMap((row, y) => Array.from({ length: width }, (_, x) => content(legend[row[x] ?? '#'] ?? 'wall', x, y)))
  } else {
    ;[width, height] = def.size ?? [9, 7]
    cells = Array.from({ length: width * height }, () => ({ kind: 'wall' }) as Cell)
    let x = Math.floor(width / 2)
    let y = height - 1
    const start = y * width + x
    cells[start] = { kind: 'floor' }
    for (let step = 0; step < (def.carve_steps ?? width * height); step++) {
      const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, -1], [0, -1], [0, 1]] as const)
      x = Math.max(0, Math.min(width - 1, x + dx))
      y = Math.max(0, Math.min(height - 1, y + dy))
      cells[y * width + x] = { kind: 'floor' }
    }
    cells[start] = { kind: 'exit' }
  }
  const area: Area = {
    key: specialKey(def.id), location: def.location, name: def.name, kind: 'special', special: def.id, layer,
    width, height, cells, revealed: [], lighting: def.lighting ?? 'dark', version: specialVersion(def),
  }
  // 商店：店種的格子（自建商店的格子就是它的 id）
  for (const s of def.shops ?? []) {
    const kind = (shopRules.types[s.shop as ShopType]?.custom ? s.shop : shopRules.types[s.shop as ShopType]?.cell) as CellKind | undefined
    if (kind && s.x < width && s.y < height) cells[s.y * width + s.x] = { kind }
  }
  // 通道（自己的與別張地圖接過來的）、入口與商店的格子不放隨機內容
  const used = new Set<number>([
    ...(def.shops ?? []).map((s) => s.y * width + s.x),
    ...endpointsIn(area.key).map((e) => e.y * width + e.x),
    ...(def.entry ? [def.entry.y * width + def.entry.x] : []),
    ...cells.map((c, i) => (c.kind === 'exit' ? i : -1)).filter((i) => i >= 0),
  ])
  const scatter = (count: number, kind: string) => {
    for (const i of randomCells(rng, area, count, used)) {
      cells[i] = content(kind)
      used.add(i)
    }
  }
  scatter(def.encounters ? between(rng, def.encounters) : 0, 'encounter')
  scatter(def.elites ?? 0, 'elite')
  scatter(def.traps ? between(rng, def.traps) : 0, 'trap')
  scatter(def.resources ? between(rng, def.resources) : 0, 'resource')
  scatter(def.chests ? between(rng, def.chests) : 0, 'chest')
  ensureStoryMarkers(state, area, rng)
  return area
}

function neighborsOf(area: Area, i: number): number[] {
  const x = i % area.width
  const y = Math.floor(i / area.width)
  return [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [x + dx!, y + dy!] as const)
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < area.width && ny < area.height)
    .map(([nx, ny]) => ny * area.width + nx)
}

function walkable(c: Cell | undefined) {
  return !!c && !WALKABLE_BLOCKERS.includes(c.kind)
}

/** 從起點出發無法到達的空地改成障礙物，確保整張圖連通。 */
function ensureConnected(area: Area, from: number) {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    for (const n of neighborsOf(area, queue.shift()!)) {
      if (!seen.has(n) && walkable(area.cells[n])) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  area.cells.forEach((c, i) => {
    if (walkable(c) && !seen.has(i)) area.cells[i] = { kind: 'wall' }
  })
}

function farthest(area: Area, from: number): number {
  const dist = new Map([[from, 0]])
  const queue = [from]
  let best = from
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of neighborsOf(area, cur)) {
      if (!dist.has(n) && walkable(area.cells[n])) {
        dist.set(n, dist.get(cur)! + 1)
        if (dist.get(n)! > dist.get(best)!) best = n
        queue.push(n)
      }
    }
  }
  return best
}

// ---- 移動 ----

export type StepResult = { report?: Report; combat?: CombatState }

/** 走一格花的時間（分鐘）分三種地方：城鎮（含房子）、近郊、冒險區域（含特殊地圖）。 */
export type StepPlace = keyof typeof maps.generation.step_minutes

// 每走一格的分鐘數：預設 maps.json 的 step_minutes，設定的「遊戲規則」可以改（引擎不讀設定，由畫面呼叫）
let stepOverride: Partial<Record<StepPlace, number>> = {}

/** 設定走一格的分鐘數（0～60；空的或不是數字的用預設） */
export function setStepMinutes(m: Partial<Record<StepPlace, number | string | null>> | undefined) {
  stepOverride = {}
  for (const k of Object.keys(maps.generation.step_minutes) as StepPlace[]) {
    const raw = m?.[k]
    const v = raw === '' || raw === null || raw === undefined ? NaN : Number(raw)
    if (Number.isFinite(v)) stepOverride[k] = Math.max(0, Math.min(60, Math.round(v)))
  }
}

/** 各種地方走一格的分鐘數（套用設定之後） */
export function stepMinutesFor(place: StepPlace): number {
  return stepOverride[place] ?? maps.generation.step_minutes[place]
}

function stepMinutes(area: Area): number {
  return stepMinutesFor(area.kind === 'settlement' || area.kind === 'home' ? 'settlement' : area.kind === 'wild' ? 'wild' : 'dungeon')
}

/** 往上下左右移動一格，觸發走進格子的內容。 */
export function move(state: GameState, dx: number, dy: number): StepResult {
  if (state.combat) throw new Error('戰鬥進行中')
  assertNoStandoff(state)
  if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Error('一次只能移動一格')
  if (state.townEvent) throw new Error('先決定怎麼應付眼前的事')
  const p = position(state)
  const area = currentArea(state)
  // 旅途：單行道，一格一天
  if (area.kind === 'road') return roadMove(state, dx, dy)
  const nx = p.x + dx
  const ny = p.y + dy
  const cell = cellAt(area, nx, ny)
  if (!walkable(cell)) throw new Error('那裡過不去')
  advanceTime(state, stepMinutes(area) / 60)
  state.position = { area: area.key, x: nx, y: ny, prev: { x: p.x, y: p.y } }
  // 黑暗的地方：每走一格燒掉一點光源
  burnStep(state, area)
  // 園區：魅氣慢慢增加
  stepParkLust(state, area)
  reveal(area, nx, ny, sight(state, area))
  noteSpot(state, area, cell)
  return enterCell(state, area, nx, ny, cell!)
}

/**
 * 不算錯誤的「走不了」：撞牆、旅途往回走或走到底、眼前有事要先處理。回傳給玩家的簡短提示（null 表示可以走）；
 * 地圖輕輕晃一下並顯示提示，不跳出錯誤訊息
 */
export function blockedMove(state: GameState, dx: number, dy: number): string | null {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null
  // 眼前有要先處理的事（面板已經顯示了）
  try {
    assertNoStandoff(state)
  } catch (e) {
    return (e as Error).message
  }
  if (state.townEvent) return '先決定怎麼應付眼前的事'
  const area = currentArea(state)
  const p = position(state)
  if (area.kind === 'road') {
    if (dx !== 1 || dy !== 0) return '旅途只能往前走'
    if (state.roadEvent) return '先決定怎麼應付眼前的事'
    if (!area.cells[p.x + 1]) return '已經走到底了'
    return null
  }
  return walkable(cellAt(area, p.x + dx, p.y + dy)) ? null : '那邊走不過去'
}

/** 站著的出入口通往哪一區（不是出入口時 null）；只讀名字，不生成地圖 */
export function linkTargetName(state: GameState): string | null {
  const cell = currentCell(state)
  if (cell.kind !== 'link' || !cell.link) return null
  const key = cell.link.area
  const park = parkOfLink(key)
  if (park) return locationById(park).name
  try {
    return key.startsWith('sm/') ? specialMapOfKey(key)?.name ?? '別處' : getArea(state, key).name
  } catch {
    return '別處'
  }
}

/** 腳下的路口通往的區域（不是路口或找不到時是 undefined） */
function linkTarget(state: GameState): Area | undefined {
  const cell = currentCell(state)
  if (cell.kind !== 'link' || !cell.link || cell.link.area.startsWith('sm/') || parkOfLink(cell.link.area)) return undefined
  try {
    return getArea(state, cell.link.area)
  } catch {
    return undefined
  }
}

/** 腳下的路口通往的區域被衛兵擋著時的原因（貴族區、王城；畫面顯示用） */
export function linkEntryBlock(state: GameState): { reason: string; zone: string } | null {
  const target = linkTarget(state)
  const reason = target && zoneEntryBlock(state, target.zone)
  return reason ? { reason, zone: target.zone! } : null
}

/** 站在通往王城的路口時，回傳王城的名字（例如「皇宮」）；不是時丟出錯誤 */
export function palaceGateName(state: GameState): string {
  if (linkTarget(state)?.zone !== 'palace') throw new Error('這裡不是王城的大門')
  return palaceName(locationById(state.location))
}

/** 在通往王城的路口說服衛兵放行（只擲骰，不經過行動判定） */
export function persuadePalaceGuard(state: GameState): Report {
  return persuadeGuard(state, palaceGateName(state))
}

/**
 * 走過腳下的出入口，換到相連的區域（城鎮的各區、房子的門、特殊地圖的通道）。
 * 走到出入口上不會自動換區：玩家按 E 或格子資訊的按鈕才過去。不另外花時間（走上來那一步已經算了）。
 */
export function crossLink(state: GameState): StepResult {
  if (state.combat) throw new Error('戰鬥進行中')
  assertNoStandoff(state)
  if (state.townEvent) throw new Error('先決定怎麼應付眼前的事')
  const area = currentArea(state)
  const p = position(state)
  const cell = cellAt(area, p.x, p.y)
  if (cell?.kind !== 'link' || !cell.link) throw new Error('這裡沒有通往別處的路')
  // 入口廣場通往園區：從入口進那座地下城
  const park = parkOfLink(cell.link.area)
  if (park) {
    enterPark(state, park, { area: area.key, x: p.x, y: p.y })
    return {}
  }
  const target = getArea(state, cell.link.area)
  // 貴族區與王城有衛兵把守
  const blocked = zoneEntryBlock(state, target.zone)
  if (blocked) throw new Error(blocked)
  // 主人的家：走出大門前要主人同意
  if (cell.dir === 'out' && atMasterHome(state, area)) assertMayLeaveHouse(state)
  // 進出特殊地圖：記下回程與地點
  if (area.kind === 'special' || target.kind === 'special') onAreaChange(state, area, target, { x: p.x, y: p.y })
  placeAt(state, target, cell.link.x, cell.link.y)
  // 走進或走出主人的家：離家期限重新算
  touchMasterHome(state, area, target)
  return {}
}

/** 移動到指定格子（只能是相鄰格）。 */
// ---- 點地圖上的格子走過去（畫面一格一格走，路上有事就停；game.ts 的 walkTo） ----

/** 走在路上不會發生事情的格子：空地、安全房，以及處理過的（打過的遭遇、採過的、開過的、觸發過的）。沒發現的陷阱在玩家看來就是空地 */
const QUIET_DONE: CellKind[] = ['encounter', 'elite', 'boss', 'resource', 'chest', 'trap']
function quietCell(c: Cell): boolean {
  return c.kind === 'floor' || c.kind === 'safe' || c.kind === 'yard' || (c.kind === 'trap' && !c.done) || (QUIET_DONE.includes(c.kind) && !!c.done)
}
/** 找不到安靜的路時，聚落裡可以穿過設施（可能遇到城鎮事件）；遭遇、寶箱、任務點、出入口、樓梯照樣不經過 */
const NEVER_THROUGH: CellKind[] = ['encounter', 'elite', 'boss', 'resource', 'chest', 'quest', 'link', 'exit', 'stairs_down', 'stairs_up', 'event']

/**
 * 從現在的位置走到 (x, y) 的路（不含起點；終點可以是任何走得過去的格子）。只走已經揭開的格子；
 * 路上先只走安靜的格子，走不到時聚落裡才穿過設施。旅途上（一格一天）、走不到、或就在原地時回傳 null
 */
export function pathTo(state: GameState, x: number, y: number): { x: number; y: number }[] | null {
  if (state.combat) return null
  const area = currentArea(state)
  if (area.kind === 'road') return null
  const from = position(state)
  const goal = cellAt(area, x, y)
  if ((from.x === x && from.y === y) || !walkable(goal) || !isRevealed(area, x, y)) return null
  const search = (through: (c: Cell) => boolean) => {
    const key = (cx: number, cy: number) => cy * area.width + cx
    const prev = new Map<number, number>([[key(from.x, from.y), -1]])
    const queue = [key(from.x, from.y)]
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi]!
      const cx = k % area.width
      const cy = Math.floor(k / area.width)
      if (cx === x && cy === y) {
        const out: { x: number; y: number }[] = []
        for (let c = k; c !== key(from.x, from.y); c = prev.get(c)!) out.unshift({ x: c % area.width, y: Math.floor(c / area.width) })
        return out
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx
        const ny = cy + dy
        const nk = key(nx, ny)
        const c = cellAt(area, nx, ny)
        if (!c || prev.has(nk) || !walkable(c) || !isRevealed(area, nx, ny)) continue
        if (!(nx === x && ny === y) && !through(c)) continue
        prev.set(nk, k)
        queue.push(nk)
      }
    }
    return null
  }
  return search(quietCell) ?? (area.kind === 'settlement' || area.kind === 'home' ? search((c) => !NEVER_THROUGH.includes(c.kind)) : null)
}

export function moveTo(state: GameState, x: number, y: number): StepResult {
  const p = position(state)
  return move(state, x - p.x, y - p.y)
}

/**
 * 遭遇格上的怪物整組都被刪掉時的替代：這個地方現在的遭遇表。
 * 層主換成這一層現在的層主，強敵換成最強的一組再多一隻，一般遭遇隨機挑一組。找不到時回傳空的。
 */
export function substituteGroup(state: GameState, area: Area, kind: 'encounter' | 'elite' | 'boss', region?: string): EncounterGroup {
  const loc = locationById(area.location)
  const valid = (g: EncounterGroup | undefined): g is EncounterGroup => !!g?.length && g.every(([id]) => !!enemies[id])
  const layer = area.kind === 'dungeon' ? DUNGEON_LAYERS[area.layer ?? 0]?.id as DungeonLayerId : undefined
  if (kind === 'boss' && layer && layer !== 'outskirts') {
    const boss = dungeonEncounters[loc.id]?.bosses?.[layer] ?? dungeonEncounters[loc.id]?.boss
    if (valid(boss)) return boss
  }
  const table = ((layer ? dungeonEncounters[loc.id]?.[layer] : undefined) ?? wildEncounters(region ?? loc.region)).filter(valid)
  if (!table.length) return []
  if (kind === 'encounter') return withRng(state, (rng) => rng.pick(table))
  const strongest = [...table].sort((a, b) => b.reduce((s, [, n]) => s + n, 0) - a.reduce((s, [, n]) => s + n, 0))[0]!
  return strongest.map(([id, n], i) => [id, i === 0 ? n + 1 : n] as [string, number])
}

function enterCell(state: GameState, area: Area, x: number, y: number, cell: Cell): StepResult {
  const loc = locationById(area.location)
  switch (cell.kind) {
    case 'encounter':
    case 'elite':
    case 'boss': {
      if (cell.done || !cell.group?.length) return {}
      // 玩家刪掉的自建怪物：拿掉不存在的；整組都沒了就換成這裡現在的遭遇（層主、強敵照原本的強度）
      let group = cell.group.filter(([id]) => !!enemies[id])
      if (!group.length) group = substituteGroup(state, area, cell.kind)
      if (!group.length) {
        cell.done = true
        if (cell.intel) finishIntel(state, cell.intel)
        return {}
      }
      cell.group = group
      // 特殊地圖的 BOSS 格：場景帶上 BOSS 的名字
      const scene = cell.kind === 'boss' && cell.name ? `${area.name}・${cell.name}` : area.name
      return { combat: startCombat(state, group, { scene, cell: { area: area.key, x, y }, dark: inDarkness(state, area) }) }
    }
    case 'trap': {
      if (cell.done) return {}
      cell.done = true
      return { report: springTrap(state, area, loc) }
    }
    case 'resource': {
      if (cell.done || !cell.item) return {}
      cell.done = true
      const report = gather(state, area, cell.item)
      // 採集時的地下城事件（花粉、觸手植物……）：採到之後才發生
      maybeDungeonEvent(state, 'gather')
      return { report }
    }
    case 'chest': {
      if (cell.done) return {}
      // 園區的擬態寶箱：打開時跳起來，變成一格遭遇（打贏就清除）
      if (cell.mimic && enemies[cell.mimic]) {
        const group: EncounterGroup = [[cell.mimic, 1]]
        Object.assign(cell, { kind: 'encounter', group })
        delete cell.mimic
        delete cell.level
        return { combat: startCombat(state, group, { scene: `${area.name}・擬態寶箱`, cell: { area: area.key, x, y }, dark: inDarkness(state, area), surprise: 'enemy' }) }
      }
      // 上鎖的寶箱：站在上面選開鎖的方式（靈巧、力量或智力）
      if (cell.lock) return {}
      cell.done = true
      // 情報的藏寶處：結束這則情報
      if (cell.intel) finishIntel(state, cell.intel)
      // 擬態寶箱（地下城事件）：寶箱本身不打開，裡面的東西看回應
      if (!cell.intel && maybeDungeonEvent(state, 'chest')) return {}
      return { report: openChest(state, area, cell.level ?? 1) }
    }
    default:
      return {}
  }
}

function eventReport(state: GameState, area: Area, minutes: number): Report {
  const pc = player(state)
  const loc = locationById(area.location)
  const start = { ...state.time }
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'event',
    time: { start, end: addHours(start, minutes / 60) },
    location: { at: area.location, region: loc.region, scene: area.name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'neutral' },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

function springTrap(state: GameState, area: Area, loc: Location): Report {
  const spec = DUNGEON_LAYERS[area.layer ?? 0]!
  const report = eventReport(state, area, 5)
  // 隊伍中靈巧最高的人負責察覺陷阱；陷阱類的工具（探路長竿）有加值
  const scout = [...state.party].filter((m) => m.hp > 0).sort((a, b) => attrOf(b, 'dex') - attrOf(a, 'dex'))[0] ?? player(state)
  const before = state.party.map((m) => ({ ...m }))
  const tool = bestTool(state, 'trap')
  const dice = withBonus('1d20', mod(attrOf(scout, 'dex')) + proficiency(scout.level) + (tool?.bonus ?? 0) + checkBonus(scout, { context: 'trap', attr: 'dex' }))
  const r = withRng(state, (rng) => roll(rng, dice))
  // 黑暗又沒有光：更難察覺
  const dark = inDarkness(state, area)
  const dc = spec.trap_dc + (dark ? lightingRules.dark.trap_dc : 0)
  const success = r.total >= dc
  const effects: NonNullable<Report['timeline']>[number]['effects'] = []
  // 沒察覺：可能是色情陷阱（地下城事件），事件取代陷阱的傷害
  const event = !success && maybeDungeonEvent(state, 'trap')
  // 園區：沒察覺的陷阱是媚藥機關，不扣生命、魅氣大增（下一場戰鬥帶著慾望開場）
  const lewdTrap = !success && !event && parkPlaza(area.location) ? parkTrap(state, scout.id) : 0
  if (!success && !event && !lewdTrap) {
    const dmg = withRng(state, (rng) => roll(rng, spec.trap_damage).total)
    scout.hp = Math.max(1, scout.hp - dmg)
    effects.push({ type: 'damage', target: scout.id, amount: dmg })
  }
  report.kind = 'event'
  report.timeline = [{
    seq: 1, actor: scout.id, action: `靈巧檢定・察覺陷阱${tool ? `（${tool.name} +${tool.bonus}）` : ''}${dark ? '（一片漆黑）' : ''}`,
    roll: { dice, value: r.total, dc }, result: success ? 'success' : 'fail', effects,
  }]
  report.party = state.party.map((m, i) => snapshot(m, before[i], player(state)))
  report.outcome = {
    result: success ? 'success' : 'failure',
    summary: success ? `${scout.name}及時察覺${area.name}的陷阱。` : event ? `${scout.name}沒有察覺${area.name}的陷阱——機關對準的是你。`
      : lewdTrap ? `${scout.name}觸發了${area.name}的媚藥機關，甜膩的霧噴了一身（魅氣 +${Math.round(lewdTrap * 100)}%）。` : `${scout.name}觸發了${area.name}的陷阱。`,
    tags: ['陷阱', ...(dark ? ['黑暗'] : [])],
  }
  report.lore_keys!.push(loc.name)
  return commitReport(state, report)
}

/** 一個採集點採到幾份：存檔規則的採集量，小數的部分是機率 */
export function gatherQty(state: GameState): number {
  const mult = gameRule(state, 'gatherMult')
  const base = Math.floor(mult)
  const extra = mult - base
  return Math.max(1, base + (extra > 0 && withRng(state, (rng) => rng.chance(extra)) ? 1 : 0))
}

function gather(state: GameState, area: Area, item: string): Report {
  const report = eventReport(state, area, 10)
  report.kind = 'action'
  if (item === '古錢') {
    const money = rewardMoney(state, withRng(state, (rng) => rng.int(10, 60)))
    report.changes.money_cc = money
    report.outcome = { result: 'success', summary: `在${area.name}找到一些古錢。`, tags: ['採集'] }
  } else {
    const qty = gatherQty(state)
    report.changes.items_gained = [{ name: item, qty, owner: 'pc' }]
    report.outcome = { result: 'success', summary: `在${area.name}採集到${item}${qty > 1 ? ` ×${qty}` : ''}。`, tags: ['採集'] }
  }
  return commitReport(state, report)
}

/** 打開上鎖寶箱的方式：靈巧開鎖（開鎖類的工具有加值）、力量硬撬、智力研究機關 */
export type LockMethod = 'dex' | 'str' | 'int'
export const LOCK_METHODS: Record<LockMethod, { name: string; success: string; fail: string }> = {
  dex: { name: '開鎖', success: '撬開了鎖', fail: '對著鎖頭搗鼓了一陣，還是打不開' },
  str: { name: '硬撬', success: '把鎖硬生生扳斷了', fail: '使盡了力氣，寶箱還是紋風不動' },
  int: { name: '研究機關', success: '看穿了鎖的機關，輕輕一按就開了', fail: '研究了半天，還是看不出機關的門道' },
}

/** 這種方式由誰來做：隊伍中這項屬性最高、還站得起來的人 */
export function lockPicker(state: GameState, method: LockMethod): Character {
  return [...state.party].filter((m) => m.hp > 0).sort((a, b) => attrOf(b, method) - attrOf(a, method))[0] ?? player(state)
}

/**
 * 上鎖的寶箱：用選的方式檢定（DC 是寶箱的鎖）。
 * 成功就打開；失敗時寶箱還在，可以再試或換一種方式（每次 10 分鐘）。
 */
function pickLockAt(state: GameState, area: Area, cell: Cell, method: LockMethod): Report {
  const loc = locationById(area.location)
  const report = eventReport(state, area, 10)
  const how = LOCK_METHODS[method]
  const picker = lockPicker(state, method)
  const tool = method === 'dex' ? bestTool(state, 'lockpick') : undefined
  const dc = cell.lock!
  const extra = checkModifiers(picker, { context: 'lock', attr: method })
  const dice = withBonus('1d20', mod(attrOf(picker, method)) + proficiency(picker.level) + (tool?.bonus ?? 0) + extra.reduce((s, x) => s + x.value, 0))
  const r = withRng(state, (rng) => roll(rng, dice))
  const natural = r.rolls[0] ?? 10
  const success = natural === 20 || (natural !== 1 && r.total >= dc)
  const entry = {
    seq: 1, actor: picker.id, action: `${attrName(method)}檢定・${how.name}${tool ? `（${tool.name} +${tool.bonus}）` : ''}${modifierNote(extra)}`,
    roll: { dice, value: r.total, dc }, result: success ? 'success' as const : 'fail' as const,
  }
  if (!success) {
    report.timeline = [entry]
    report.outcome = {
      result: 'failure',
      summary: `${picker.name}${how.fail}。可以再試一次，或換一種方式。`,
      tags: ['寶箱', '上鎖'],
    }
    report.lore_keys!.push(loc.name)
    return commitReport(state, report)
  }
  delete cell.lock
  cell.done = true
  if (cell.intel) finishIntel(state, cell.intel)
  advanceTime(state, 10 / 60)
  const opened = openChest(state, area, cell.level ?? 1)
  opened.timeline = [entry, ...(opened.timeline ?? [])]
  opened.outcome.summary = `${picker.name}${how.success}。${opened.outcome.summary ?? ''}`
  opened.outcome.tags = [...(opened.outcome.tags ?? []), '上鎖']
  return opened
}

/** 站在上鎖的寶箱上：選一種方式試著打開 */
export function pickLock(state: GameState, method: LockMethod = 'dex'): Report {
  if (state.combat) throw new Error('戰鬥中不能這麼做')
  assertNoStandoff(state)
  if (!LOCK_METHODS[method]) throw new Error('沒有這種開法')
  const area = currentArea(state)
  const cell = currentCell(state)
  if (cell.kind !== 'chest' || cell.done || !cell.lock) throw new Error('這裡沒有上鎖的寶箱')
  return pickLockAt(state, area, cell, method)
}

/** 打開寶箱：錢、消耗品、裝備與打造材料（gear.json 的 chests） */
function openChest(state: GameState, area: Area, level: number): Report {
  const report = eventReport(state, area, 5)
  report.kind = 'event'
  const layer = DUNGEON_LAYERS[area.layer ?? 0]!.id
  const t = gearRules.chests[layer] ?? gearRules.chests.outskirts!
  const items: { name: string; qty: number; owner: 'pc' }[] = []
  const add = (name: string) => {
    const x = items.find((i) => i.name === name)
    if (x) x.qty++
    else items.push({ name, qty: 1, owner: 'pc' })
  }
  const extra = parkPlaza(area.location) ? parkRules().chest_items : []
  // 地點指定的材料系列（緋夢樂園底下的遺跡開歡愉系列）
  const series = geography.locations.find((l) => l.id === area.location)?.material_series
  const money = withRng(state, (rng) => {
    for (const [name, p] of [...t.items, ...extra]) if (itemDef(name) && rng.chance(p)) add(name)
    if (rng.chance(t.gear)) add(registerGear(state, randomGear(rng, level, undefined, series)))
    if (t.gear_extra && rng.chance(t.gear_extra)) add(registerGear(state, randomGear(rng, level, undefined, series)))
    for (const [tier, p] of t.forge) {
      if (!rng.chance(p)) continue
      const name = forgeItemFor(rng.pick(MATERIAL_KINDS), tier, series)
      if (name) add(name)
    }
    return rng.int(t.money[0], t.money[1]) * level
  })
  report.changes.money_cc = rewardMoney(state, money)
  if (items.length) report.changes.items_gained = items
  report.outcome = {
    result: 'success',
    summary: `在${area.name}打開一個寶箱：${[formatMoney(money), ...items.map((i) => (i.qty > 1 ? `${i.name}×${i.qty}` : i.name))].join('、')}。`,
    tags: ['寶箱'],
  }
  return commitReport(state, report)
}

// ---- 格子上的動作 ----

/** 和敵對的人對峙時，不能離開 */
export function assertNoStandoff(state: GameState) {
  if (state.standoff) throw new Error('先處理眼前的對峙')
  if (state.pendingMark) throw new Error('先完成契約印記的刻印')
  if (state.pendingMasterEvent) throw new Error('先回應主人的要求')
  if (state.dungeonEvent || state.parasiteEvent) throw new Error('先應付眼前的處境')
  if (state.pendingDefeat) throw new Error('先應付眼前的處境')
  if (state.captives?.npcs.length) throw new Error('先決定怎麼處置被制伏的人')
  if (state.pendingJoins?.length) throw new Error('先決定要不要讓想入隊的人加入（騰出位子或放棄）')
  const story = blockingNode(state)
  if (story) throw new Error(`先處理特殊任務「${story.def.title}」：${story.node.title}`)
}

/** 城門盤查：沒過時回傳盤查的紀錄（沒有擲骰時直接說明原因） */
function passGate(state: GameState): Report | undefined {
  const g = gateCheck(state)
  if (g.ok) return undefined
  if (g.report) return g.report
  throw new Error(g.reason)
}

/** 從城門前往近郊（每天重新生成一次）。被衛兵攔下時回傳盤查的紀錄，不會出城。 */
export function goOutskirts(state: GameState): Report | undefined {
  if (currentCell(state).kind !== 'gate') throw new Error('要在城門才能出城')
  assertNoStandoff(state)
  assertMasterAllows(state)
  const blocked = passGate(state)
  if (blocked) return blocked
  placeOutside(state)
  return undefined
}

/** 直接站到近郊的出口（不經過城門盤查，例如被擋在城外） */
export function placeOutside(state: GameState) {
  const loc = locationById(state.location)
  let area = state.areas?.[outskirtsKey(loc.id)]
  if (!area || area.day !== state.time.day) {
    area = withRng(state, (rng) => generateOutskirts(state, loc, rng))
    storeArea(state, area)
    spawnVisitors(state, area, findKind(area, 'exit'))
  } else {
    const existing = area
    withRng(state, (rng) => {
      ensureQuestMarkers(state, existing, rng)
      ensureQuestTargets(state, existing, rng, wildEncounters(loc.region))
      ensureStoryMarkers(state, existing, rng)
      ensureIntelPoints(state, existing, rng)
    })
  }
  const exit = findKind(area, 'exit')!
  placeAt(state, area, exit.x, exit.y)
}

/** 從近郊的出口回到城門。被衛兵攔下時回傳盤查的紀錄，不會進城。 */
export function returnToTown(state: GameState): Report | undefined {
  if (currentArea(state).kind !== 'wild' || currentCell(state).kind !== 'exit') throw new Error('要在近郊的出口才能回城')
  assertNoStandoff(state)
  const blocked = passGate(state)
  if (blocked) return blocked
  enterTownGate(state)
  return undefined
}

function enterTownGate(state: GameState) {
  const loc = locationById(state.location)
  const blocks = blocksFor(loc)
  const gateBlock = blocks.find((b) => b.grid.some((row) => row.includes('E'))) ?? blocks[0]!
  const area = buildBlock(loc, gateBlock)
  const gate = findKind(area, 'gate')!
  placeAt(state, area, gate.x, gate.y)
}

/** 走下行階梯：生成下一層並站在它的上行階梯。 */
export function descend(state: GameState) {
  assertNoStandoff(state)
  const area = currentArea(state)
  if (currentCell(state).kind !== 'stairs_down' || area.layer === undefined) throw new Error('這裡沒有往下的階梯')
  const loc = locationById(area.location)
  const next = area.layer + 1
  let target = state.areas?.[layerKey(loc.id, next)]
  if (!target) {
    target = withRng(state, (rng) => generateLayer(state, loc, next, rng))
    storeArea(state, target)
    spawnVisitors(state, target, findKind(target, 'stairs_up'))
  }
  const up = findKind(target, 'stairs_up')!
  placeAt(state, target, up.x, up.y)
  reachLayer(state, next)
}

/** 走上行階梯回到上一層的下行階梯。 */
export function ascend(state: GameState) {
  assertNoStandoff(state)
  const area = currentArea(state)
  if (currentCell(state).kind !== 'stairs_up' || !area.layer) throw new Error('這裡沒有往上的階梯')
  const prev = getArea(state, layerKey(area.location, area.layer - 1))
  const down = findKind(prev, 'stairs_down')!
  placeAt(state, prev, down.x, down.y)
}

/** 戰鬥結束後：獲勝清除格子；撤退退回上一格；戰敗被送回城鎮或地下城入口外。 */
export function afterCombat(state: GameState, report: Report) {
  clearQuestMarkers(state)
  const result = report.outcome.result
  const p = state.position
  // 緊急撤退被追上：打贏就撤出地下城
  const retreating = state.retreating
  delete state.retreating
  if (retreating && result === 'victory' && p) {
    applyPendingMove(state)
    placeAtEntrance(state)
    return
  }
  if (!p) return
  const area = state.areas?.[p.area]
  if (result === 'victory' && area) {
    const key = Object.keys(report.changes.flags ?? {}).find((k) => k.startsWith('cleared:'))
    if (key) {
      const [, areaKey, coords] = key.split(':')
      const [cx, cy] = coords!.split(',').map(Number)
      const target = state.areas?.[areaKey!]
      const cell = target && cellAt(target, cx!, cy!)
      if (cell) cell.done = true
      // 守著階梯的層主倒下：格子變成往下的階梯
      if (cell?.then) {
        cell.kind = cell.then
        delete cell.then
        delete cell.done
      }
      delete state.flags[key]
    }
  } else if (result === 'fled' && p.prev) {
    state.position = { area: p.area, x: p.prev.x, y: p.prev.y }
  } else if (result === 'defeat' && !state.pendingDefeat) {
    // 成人向的戰敗事件等玩家回應之後才離開（defeat.ts）
    afterDefeat(state)
  }
  // 特殊任務的戰鬥結果要求的移動（進入臨時地圖、改道）
  applyPendingMove(state)
}

/** 戰敗之後：地下城回到入口（重新生成），近郊回到城門，城裡留在原地 */
export function afterDefeat(state: GameState) {
  const p = state.position
  if (!p) return
  const area = state.areas?.[p.area]
  const loc = locationById(state.location)
  if (area?.kind === 'side') {
    if (state.side?.story && sideNodesOpen(state, state.side.story)) {
      // 特殊任務的臨時地圖：被拖回地圖入口，任務還在（任務點沒寫失敗結果時可以再挑戰）
      const exit = findKind(area, 'exit') ?? { x: 0, y: 0 }
      placeAt(state, area, exit.x, exit.y)
    } else {
      // 臨時地圖裡倒下：被帶回原本的地方（旅途或地圖上）
      leaveSide(state)
    }
  } else if (area?.kind === 'special') {
    // 特殊地圖裡倒下：被送回所屬地點
    specialDefeat(state)
  } else if (area?.kind === 'road') {
    // 旅途上倒下：留在原地，醒來繼續趕路
  } else if (loc.type === 'dungeon' && parkPlaza(loc.id)) {
    // 園區：被送回入口廣場
    returnToPlaza(state)
  } else if (loc.type === 'dungeon') {
    // 被救出地下城：這趟探索結束（撿到的東西在戰報裡已經依規則失去），重新進入
    enterLocation(state)
  } else if (area?.kind === 'wild') {
    enterTownGate(state)
  }
}

/** 回到地下城周邊的入口（撤退成功） */
function placeAtEntrance(state: GameState) {
  const area = getArea(state, layerKey(state.location, dungeonFirstLayer(state.location)))
  const exit = findKind(area, 'exit')!
  placeAt(state, area, exit.x, exit.y)
}

/**
 * 緊急撤退：在地下城任何地方撤回周邊的入口。站在安全房不用檢定；
 * 否則檢定，失敗被追上打一場（打贏就撤出，見 afterCombat）
 */
export function retreat(state: GameState): StepResult {
  if (state.combat) throw new Error('戰鬥進行中')
  assertNoStandoff(state)
  const area = currentArea(state)
  if (area.kind !== 'dungeon') throw new Error('只有在地下城裡才能撤退')
  if ((area.layer ?? 0) === dungeonFirstLayer(area.location) && currentCell(state).kind === 'exit') throw new Error('已經在入口了')
  const r = attemptRetreat(state, area, currentCell(state).kind === 'safe')
  if (r.escaped) {
    placeAtEntrance(state)
    return { report: r.report }
  }
  if (!r.pursuit) {
    // 這一層沒有遭遇表：甩掉了
    placeAtEntrance(state)
    return { report: r.report }
  }
  state.retreating = true
  return { report: r.report, combat: startCombat(state, r.pursuit.group, { scene: r.pursuit.scene, surprise: 'enemy', dark: inDarkness(state, area) }) }
}

/** 可以啟程旅行的位置：城門或冒險區域周邊的出口。 */
export function canTravelHere(state: GameState): boolean {
  const area = currentArea(state)
  const cell = currentCell(state)
  return (area.kind === 'settlement' && cell.kind === 'gate') || (area.kind === 'dungeon' && cell.kind === 'exit' && !parkPlaza(area.location))
}
