// 房屋（data/rules/homes.json，見 docs/HOMES.md）：
// - 每座聚落有幾塊待售的空地：從固定地圖上挑臨街的建築格（同一座城一直一樣），買下後變成房子的門。
// - 房子的地圖依地段生成（樓層、院子、地下室，房間用隔牆分開），買下時存進存檔。
// - 樓梯與門都是通道（link）：走上去就到另一層或回到街上。
// - 家具擺在格子上：床讓你在家長休、高階工作台讓你處理第四、五級的材料，舒適度高時睡得香甜，儲物箱收東西（storage.ts）。
// - 夥伴可以留在家裡（不算離隊）：不佔隊伍人數、不參加戰鬥，回家時可以帶上。

import { snapshot } from './character'
import { craftRules, geography, homeRules, itemDef, lewdRules, locationById, type FurniturePlace, type FurnitureSpec, type HomeDistrict } from './data'
import { blocksFor, placeAt, position, settlementKey, type Area, type Cell } from './grid'
import { npcRecord, registerNpc } from './npcs'
import { enforceClassWeapons, enforceExtraSlots } from './inventory'
import { partyMax, partyRoom } from './party'
import type { Rng } from './rng'
import { addHours, addItem, commitReport, newReportId, player, removeItem, withRng } from './state'
import { locationMult } from './trade'
import { formatMoney } from './money'
import { cribRefusal } from './children'
import { resolveMasterHome } from './homeResolver'
import { storageInUse, storedItems } from './storage'
import { staffComfort } from './staff'
import type { Character, GameState, Home, Report } from './types'

// ---- 空地 ----

export interface Lot {
  id: string
  location: string
  /** 城鎮的區塊（區域 key）與格子 */
  area: string
  x: number
  y: number
  /** 門口的街道 */
  street: { x: number; y: number }
  district: HomeDistrict
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h
}

const lotCache = new Map<string, Lot[]>()

/** 這座聚落待售的空地（從地圖挑臨街、不在外牆上的建築格；不夠時用街屋（街道格）補；王城不賣） */
export function lotsOf(locationId: string): Lot[] {
  const cached = lotCache.get(locationId)
  if (cached) return cached
  const loc = locationById(locationId)
  if (loc.type === 'dungeon') return []
  type Candidate = Lot & { order: number }
  const buildings: Candidate[] = []
  const streets: Candidate[] = []
  for (const b of blocksFor(loc)) {
    if (b.zone === 'palace') continue
    const h = b.grid.length
    const w = b.grid[0]!.length
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const ch = b.grid[y]![x]
        if (ch !== '#' && ch !== '.') continue
        const street = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((p) => b.grid[p.y]?.[p.x] === '.')
        if (!street) continue
        const district = b.zone === 'noble' ? homeRules.noble : homeRules.by_location[loc.type] ?? 'cottage'
        const id = `${loc.id}:${b.id}:${x},${y}`
        ;(ch === '#' ? buildings : streets).push({ id, location: loc.id, area: settlementKey(loc.id, b.id), x, y, street, district, order: hash(id) })
      }
    }
  }
  buildings.sort((a, b) => a.order - b.order)
  streets.sort((a, b) => a.order - b.order)
  const want = homeRules.lots[loc.type] ?? 1
  // 有貴族區的城市：其中一塊在貴族區（貴族區沒有建築格時用街屋）
  const isNoble = (c: Candidate) => c.district === homeRules.noble
  const noble = buildings.find(isNoble) ?? streets.find(isNoble)
  const picked: Candidate[] = []
  // 街屋不能蓋在別塊空地的門口，門口也不能是別塊空地
  for (const c of [...(noble ? [noble] : []), ...buildings, ...streets]) {
    if (picked.length >= want) break
    if (picked.includes(c)) continue
    if (picked.some((o) => o.area === c.area && ((o.street.x === c.x && o.street.y === c.y) || (o.x === c.street.x && o.y === c.street.y)))) continue
    picked.push(c)
  }
  const lots = picked.map(({ order: _o, ...lot }) => lot)
  lotCache.set(locationId, lots)
  return lots
}

/** 這一格是不是待售的空地（遊戲裡會被空地蓋掉：地標、商店、特殊地圖的通道都不能放在這裡） */
export function isLotCell(area: string, x: number, y: number): boolean {
  const location = area.split('/')[0]!
  if (!geography.locations.some((l) => l.id === location)) return false
  return lotsOf(location).some((l) => l.area === area && l.x === x && l.y === y)
}

// ---- 主人的家（固定設施 manor） ----

/** 每座聚落固定地圖上的「民宅」格（maps.json 的 H）：主角有主人、主人的家在這座城時就是主人的家 */
export interface Manor {
  location: string
  area: string
  x: number
  y: number
  /** 門口的街道 */
  street: { x: number; y: number }
}

const manorCache = new Map<string, Manor | null>()

export function manorOf(locationId: string): Manor | undefined {
  if (manorCache.has(locationId)) return manorCache.get(locationId) ?? undefined
  let found: Manor | null = null
  const loc = locationById(locationId)
  if (loc.type !== 'dungeon') {
    for (const b of blocksFor(loc)) {
      const y = b.grid.findIndex((row) => row.includes('H'))
      if (y < 0) continue
      const x = b.grid[y]!.indexOf('H')
      const street = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((p) => b.grid[p.y]?.[p.x] === '.')
      if (street) found = { location: loc.id, area: settlementKey(loc.id, b.id), x, y, street }
      break
    }
  }
  manorCache.set(locationId, found)
  return found ?? undefined
}

/** 依 id 找房子：自己買的（state.homes）或目前主人的家 */
export function homeById(state: GameState, id: string): Home | undefined {
  const own = state.homes?.[id]
  if (own) return own
  // 主人的家不存進 state.homes，由 masterHome.ts 依存檔即時產生（見 homeResolver.ts）
  const master = resolveMasterHome(state)
  return master?.id === id ? master : undefined
}

/** 這塊空地上的房子（買下的） */
export function homeOnLot(state: GameState, lotId: string): Home | undefined {
  return Object.values(state.homes ?? {}).find((h) => `${h.location}:${h.lot.area.split('/')[1]}:${h.lot.x},${h.lot.y}` === lotId)
}

/** 在固定地圖上疊上空地與房子的門（getArea 時） */
export function overlayLots(state: GameState, area: Area): Area {
  for (const lot of lotsOf(area.location)) {
    if (lot.area !== area.key) continue
    const i = lot.y * area.width + lot.x
    if (!homeOnLot(state, lot.id)) area.cells[i] = { kind: 'lot', lot: lot.id }
  }
  // 自己的房子與主人的家：門變成通往一樓的通道（主人的家疊在民宅格上；不是主人的家時民宅不能進入）
  const master = resolveMasterHome(state)
  for (const home of [...Object.values(state.homes ?? {}), ...(master ? [master] : [])]) {
    if (home.lot.area !== area.key) continue
    const ground = home.floors.find((k) => home.areas[k]?.homeFloor === 'ground')!
    const entry = homeExit(home)
    area.cells[home.lot.y * area.width + home.lot.x] = { kind: 'link', link: { area: ground, ...entry }, home: home.id }
  }
  return area
}

function homeExit(home: Home): { x: number; y: number } {
  const ground = home.areas[home.floors.find((k) => home.areas[k]?.homeFloor === 'ground')!]!
  const i = ground.cells.findIndex((c) => c.dir === 'out')
  return { x: i % ground.width, y: Math.floor(i / ground.width) }
}

export function lotById(state: GameState, id: string): Lot | undefined {
  return lotsOf(id.split(':')[0]!).find((l) => l.id === id)
}

/** 空地的售價（依地段，乘地點物價） */
export function lotPrice(state: GameState, lot: Lot): number {
  return Math.round(homeRules.districts[lot.district].price_cc * locationMult(state))
}

// ---- 房子的地圖 ----

const FLOOR_NAMES = ['地下室', '一樓', '二樓', '三樓', '四樓']

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** 在外牆內用隔牆把一層分成 n 間，隔牆留門；回傳門的位置 */
function partition(cells: Cell[], w: number, outer: Rect, n: number, rng: Rng, keep: Set<number>) {
  const rooms: Rect[] = [outer]
  const doors = new Set<number>(keep)
  for (let tries = 0; rooms.length < n && tries < 30; tries++) {
    rooms.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
    const r = rooms[0]!
    const vertical = r.x1 - r.x0 >= r.y1 - r.y0
    const span = vertical ? [r.x0 + 2, r.x1 - 2] : [r.y0 + 2, r.y1 - 2]
    if (span[0]! > span[1]!) break
    // 隔牆不能擋住已經有的門
    const options: number[] = []
    for (let c = span[0]!; c <= span[1]!; c++) {
      // 隔牆兩端碰到的外框格（那裡有門的話會被堵住）
      const ends = vertical ? [(r.y0 - 1) * w + c, (r.y1 + 1) * w + c] : [c * w + r.x0 - 1, c * w + r.x1 + 1]
      if (!ends.some((e) => doors.has(e))) options.push(c)
    }
    if (!options.length) break
    const c = rng.pick(options)
    const len = vertical ? r.y1 - r.y0 + 1 : r.x1 - r.x0 + 1
    const door = rng.int(0, len - 1)
    for (let k = 0; k < len; k++) {
      const i = vertical ? (r.y0 + k) * w + c : c * w + r.x0 + k
      if (k === door) doors.add(i)
      else cells[i] = { kind: 'wall' }
    }
    rooms.shift()
    if (vertical) rooms.push({ ...r, x1: c - 1 }, { ...r, x0: c + 1 })
    else rooms.push({ ...r, y1: c - 1 }, { ...r, y0: c + 1 })
  }
}

function connected(cells: Cell[], w: number, from: number): boolean {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const i = queue.shift()!
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= cells.length || seen.has(j) || cells[j]!.kind === 'wall') continue
      if (Math.abs((j % w) - (i % w)) > 1) continue
      seen.add(j)
      queue.push(j)
    }
  }
  return cells.every((c, i) => c.kind === 'wall' || seen.has(i))
}

/** 一層的地圖：外牆、隔間；ground 有院子與出口 */
function buildFloor(home: Pick<Home, 'id' | 'name' | 'location' | 'district'>, key: string, floor: 'basement' | 'ground' | 'upper', level: number, rng: Rng): Area {
  const def = homeRules.districts[home.district]
  const [w, bh] = def.size
  const yard = floor === 'ground' ? def.yard : 0
  const h = bh + (yard ? yard + 1 : 0)
  for (let attempt = 0; attempt < 20; attempt++) {
    const cells: Cell[] = Array.from({ length: w * h }, (_, i) => {
      const x = i % w
      const y = Math.floor(i / w)
      if (y < bh) return { kind: x === 0 || x === w - 1 || y === 0 || y === bh - 1 ? 'wall' : 'floor' } as Cell
      // 院子：四周圍牆
      return { kind: x === 0 || x === w - 1 || y === h - 1 ? 'wall' : 'yard' } as Cell
    })
    const mid = Math.floor(w / 2)
    const keep = new Set<number>()
    if (floor === 'ground') {
      // 屋子的大門通往院子（沒有院子時直接通往外面）
      const door = (bh - 1) * w + mid
      if (yard) {
        cells[door] = { kind: 'floor' }
        keep.add(door)
        cells[(h - 1) * w + mid] = { kind: 'link', dir: 'out', link: { area: '', x: 0, y: 0 } }
      } else {
        cells[door] = { kind: 'link', dir: 'out', link: { area: '', x: 0, y: 0 } }
        keep.add(door)
      }
    }
    const [lo, hi] = def.rooms
    partition(cells, w, { x0: 1, y0: 1, x1: w - 2, y1: bh - 2 }, floor === 'basement' ? Math.min(2, lo) : rng.int(lo, hi), rng, keep)
    const start = cells.findIndex((c) => c.kind === 'floor')
    if (start >= 0 && connected(cells, w, start)) {
      return {
        key, location: home.location, name: `${home.name}・${FLOOR_NAMES[level + 1] ?? `${level + 1} 樓`}`, kind: 'home', homeFloor: floor,
        width: w, height: h, cells, lighting: 'lit',
      }
    }
  }
  throw new Error('房子的地圖生成失敗')
}

/** 室內可以放樓梯的格子：一般地板、不靠門 */
function stairSpots(area: Area, avoid: Set<number>): number[] {
  const w = area.width
  return area.cells.map((c, i) => i).filter((i) => {
    const c = area.cells[i]!
    if (c.kind !== 'floor' || avoid.has(i)) return false
    // 四周至少兩格是地板，才不會把房間堵住
    return [i - 1, i + 1, i - w, i + w].filter((j) => area.cells[j]?.kind === 'floor').length >= 2
  })
}

/** 生成整棟房子：地下室、一樓（含院子）、樓上，用樓梯串起來 */
export function generateHome(home: Omit<Home, 'floors' | 'areas'>, rng: Rng): Pick<Home, 'floors' | 'areas'> {
  const def = homeRules.districts[home.district]
  const plan: { floor: 'basement' | 'ground' | 'upper'; level: number }[] = [
    ...(def.basement ? [{ floor: 'basement' as const, level: -1 }] : []),
    { floor: 'ground', level: 0 },
    ...Array.from({ length: def.floors - 1 }, (_, i) => ({ floor: 'upper' as const, level: i + 1 })),
  ]
  const keys = plan.map((p) => `home/${home.id}/${p.floor === 'basement' ? 'B1' : `F${p.level + 1}`}`)
  const areas = plan.map((p, i) => buildFloor(home, keys[i]!, p.floor, p.level, rng))
  // 相鄰兩層用樓梯連起來（同一個位置，上下對齊）
  const used = areas.map(() => new Set<number>())
  for (let i = 0; i + 1 < areas.length; i++) {
    const lower = areas[i]!
    const upper = areas[i + 1]!
    const both = stairSpots(lower, used[i]!).filter((k) => stairSpots(upper, used[i + 1]!).includes(k))
    const spot = both.length ? rng.pick(both) : rng.pick(stairSpots(lower, used[i]!))
    const x = spot % lower.width
    const y = Math.floor(spot / lower.width)
    if (upper.cells[spot]?.kind !== 'floor') upper.cells[spot] = { kind: 'floor' }
    lower.cells[spot] = { kind: 'link', dir: 'up', link: { area: upper.key, x, y } }
    upper.cells[spot] = { kind: 'link', dir: 'down', link: { area: lower.key, x, y } }
    used[i]!.add(spot)
    used[i + 1]!.add(spot)
  }
  return { floors: keys, areas: Object.fromEntries(areas.map((a) => [a.key, a])) }
}

// ---- 買房 ----

/** 站在待售的空地上 */
export function lotHere(state: GameState, area: Area, cell: Cell): Lot | undefined {
  return cell.kind === 'lot' && cell.lot ? lotsOf(area.location).find((l) => l.id === cell.lot) : undefined
}

export function buyHome(state: GameState, lotId: string, name?: string): Report {
  const lot = lotById(state, lotId)
  if (!lot || lot.location !== state.location) throw new Error('這裡沒有這塊空地')
  if (homeOnLot(state, lot.id)) throw new Error('這塊地已經是你的了')
  const price = lotPrice(state, lot)
  if (state.money_cc < price) throw new Error(`錢不夠（需要 ${formatMoney(price)}）`)
  const def = homeRules.districts[lot.district]
  const loc = locationById(lot.location)
  // 編號取現有最大號 +1（以前用房屋總數 +1，賣掉或拿掉一棟之後會撞號）
  const n = Math.max(0, ...Object.keys(state.homes ?? {}).map((k) => Number(/^h(\d+)/.exec(k)?.[1] ?? 0))) + 1
  const id = `h${n}-${lot.location}`
  const base: Omit<Home, 'floors' | 'areas'> = {
    id, name: name?.trim().slice(0, 16) || `${loc.name}的${def.name}`, location: lot.location, district: lot.district,
    lot: { area: lot.area, x: lot.x, y: lot.y, street: lot.street }, bought: { ...state.time }, price_cc: price,
  }
  const home: Home = { ...base, ...withRng(state, (rng) => generateHome(base, rng)) }
  // 出口通往門口的街道
  for (const a of Object.values(home.areas)) for (const c of a.cells) if (c.dir === 'out') c.link = { area: lot.area, ...lot.street }
  ;(state.homes ??= {})[id] = home
  const report = homeReport(state, 'trade', 1, `${loc.name}`)
  report.outcome = {
    result: 'success',
    summary: `買下${loc.name}的${def.name}「${home.name}」（${describeHome(home)}），付了 ${formatMoney(price)}。`,
    tags: ['買房'],
  }
  report.changes.money_cc = -price
  const done = commitReport(state, report)
  // 站在空地上買的：直接進屋
  const p = position(state)
  if (p.area === lot.area && p.x === lot.x && p.y === lot.y) {
    const exit = homeExit(home)
    placeAt(state, home.areas[home.floors.find((k) => home.areas[k]!.homeFloor === 'ground')!]!, exit.x, exit.y)
  }
  return done
}

/** 房子的規格：幾層、院子、地下室 */
export function describeHome(home: Pick<Home, 'district'>): string {
  const def = homeRules.districts[home.district]
  return [`地上 ${def.floors} 層`, def.basement ? '地下室' : '', def.yard ? '院子' : ''].filter(Boolean).join('、')
}

export function renameHome(state: GameState, id: string, name: string) {
  const home = state.homes?.[id]
  if (!home || home.master) throw new Error('沒有這棟房子')
  const n = name.trim().slice(0, 16)
  if (!n) return
  const old = home.name
  home.name = n
  for (const a of Object.values(home.areas)) a.name = a.name.replace(old, n)
}

export function homeReport(state: GameState, kind: Report['kind'], hours: number, scene: string): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  return {
    schema_version: '0.1', report_id: newReportId(state), kind,
    time: { start, end: addHours(start, hours) },
    location: { at: loc.id, region: loc.region, scene },
    party: state.party.map((m) => snapshot(m, undefined, player(state))),
    outcome: { result: 'success' },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name],
  }
}

// ---- 在房子裡 ----

/** 這個區域是哪一棟房子 */
export function homeOfArea(state: GameState, area: Pick<Area, 'key' | 'kind'>): Home | undefined {
  return area.kind === 'home' ? homeById(state, area.key.split('/')[1]!) : undefined
}

/** 主角自己的房子（不是主人的家） */
export function ownHomeOfArea(state: GameState, area: Pick<Area, 'key' | 'kind'>): Home | undefined {
  const home = homeOfArea(state, area)
  return home && !home.master ? home : undefined
}

/** 格子屬於哪一種擺放的地方 */
export function placeOf(area: Area, cell: Cell): FurniturePlace | undefined {
  if (cell.kind === 'yard') return 'yard'
  if (cell.kind !== 'floor') return undefined
  return area.homeFloor === 'basement' ? 'basement' : 'indoor'
}

export const PLACE_NAME: Record<FurniturePlace, string> = { indoor: '室內', yard: '院子', basement: '地下室' }

/** 家具的一行說明：功能、舒適度、能放的地方 */
export function furnitureSummary(f: FurnitureSpec | undefined): string {
  if (!f) return ''
  const fn = f.function === 'bed' ? '床' : f.function === 'workbench' ? `${f.craft ? craftRules.skills[f.craft].name : ''}的高階工作台`
    : f.function === 'garden' ? '苗圃' : f.function === 'training' ? `調教室（在家調教 +${f.training ?? 0}）` : f.function === 'crib' ? '搖籃'
    : f.function === 'storage' ? `儲物箱（${f.slots ?? 0} 種${f.money ? '，可以存錢' : ''}）` : ''
  return [fn, f.comfort ? `舒適 +${f.comfort}` : '', `放在${f.places.map((p) => PLACE_NAME[p]).join('、')}`].filter(Boolean).join('，')
}

/** 房子裡所有的家具 */
export function furnitureIn(home: Home): { name: string; area: string; x: number; y: number; stored?: number }[] {
  const out: { name: string; area: string; x: number; y: number; stored?: number }[] = []
  for (const a of Object.values(home.areas)) {
    a.cells.forEach((c, i) => {
      if (!c.furniture) return
      const stored = storedItems(c).length
      out.push({ name: c.furniture, area: a.key, x: i % a.width, y: Math.floor(i / a.width), ...(stored ? { stored } : {}) })
    })
  }
  return out
}

/** 舒適度：所有家具的 comfort 加總；給了 state 時加上家僕（女僕，staff.ts） */
export function comfortOf(home: Home, state?: GameState): number {
  const furniture = furnitureIn(home).reduce((n, f) => n + (itemDef(f.name)?.furniture?.comfort ?? 0), 0)
  return furniture + (state && !home.master ? staffComfort(state, home) : 0)
}

/** 調教室：房子裡調教家具的加值合計（lewd.json 的 training.room_max 為上限） */
export function trainingRoomOf(home: Home): number {
  const sum = furnitureIn(home).reduce((n, f) => {
    const spec = itemDef(f.name)?.furniture
    return n + (spec?.function === 'training' ? spec.training ?? 0 : 0)
  }, 0)
  return Math.min(lewdRules.training.room_max, sum)
}

export function hasBed(home: Home): boolean {
  return furnitureIn(home).some((f) => itemDef(f.name)?.furniture?.function === 'bed')
}

/** 房子裡這種工藝的高階工作台 */
export function workbenchFor(home: Home, craft: string): string | undefined {
  return furnitureIn(home).find((f) => {
    const spec = itemDef(f.name)?.furniture
    return spec?.function === 'workbench' && spec.craft === craft
  })?.name
}

/** 擺家具：站在空的地板或院子上，從行囊拿出來 */
export function placeFurniture(state: GameState, area: Area, x: number, y: number, name: string) {
  if (!ownHomeOfArea(state, area)) throw new Error('只能在自己的房子裡擺家具')
  const cell = area.cells[y * area.width + x]
  const spec = itemDef(name)?.furniture
  if (!cell || !spec) throw new Error('這不是家具')
  if (cell.furniture) throw new Error('這一格已經有家具了')
  const place = placeOf(area, cell)
  if (!place) throw new Error('這一格不能擺家具')
  if (!spec.places.includes(place)) throw new Error(`${name}只能放在${spec.places.map((p) => PLACE_NAME[p]).join('、')}`)
  if (!state.inventory.some((i) => i.name === name && i.qty > 0)) throw new Error(`行囊裡沒有${name}`)
  removeItem(state.inventory, name, 1)
  cell.furniture = name
}

/** 收起家具：放回行囊 */
export function takeFurniture(state: GameState, area: Area, x: number, y: number) {
  if (!ownHomeOfArea(state, area)) throw new Error('只能在自己的房子裡收家具')
  const cell = area.cells[y * area.width + x]
  if (!cell?.furniture) throw new Error('這一格沒有家具')
  if (cell.crop) throw new Error('苗圃上還種著東西，先收成或拔掉')
  if (storageInUse(cell)) throw new Error('箱子裡還有東西，先拿出來')
  if (itemDef(cell.furniture)?.furniture?.function === 'crib') {
    const refused = cribRefusal(state, ownHomeOfArea(state, area)!)
    if (refused) throw new Error(refused)
  }
  addItem(state.inventory, cell.furniture, 1)
  delete cell.furniture
}

// ---- 留守 ----

/** 留在這棟房子的夥伴 */
export function residents(state: GameState, homeId: string): Character[] {
  return Object.values(state.npcs ?? {}).filter((r) => r.staying === homeId && r.character).map((r) => r.character!)
}

/** 這個區域（房子）裡留守的夥伴 */
export function residentsHere(state: GameState, area: Pick<Area, 'key' | 'kind'>): Character[] {
  const home = homeOfArea(state, area)
  return home ? residents(state, home.id) : []
}

/** 誰可以留在家裡：主角以外、不是任務同行、不是跟著別人的隊伍 */
export function stayRefusal(m: Character): string | undefined {
  if (m.isPlayer) return '主角'
  if (m.bond === 'guest') return '任務同行的夥伴'
  if (m.bond === 'leader' || m.bond === 'ally' || m.group) return '這是你跟著的隊伍'
  return undefined
}

/** 讓隊員留在家裡（不算離隊：羈絆、契約、親密度都保留） */
export function stayHome(state: GameState, area: Area, memberId: string): Report {
  const home = ownHomeOfArea(state, area)
  if (!home) throw new Error('要在自己的房子裡')
  return stayAt(state, home, memberId)
}

/** 讓隊員留在某一棟自己的房子（在房子裡留下，或在同一座城送回家，見 away.ts） */
export function stayAt(state: GameState, home: Home, memberId: string, summary?: string): Report {
  const m = state.party.find((x) => x.id === memberId)
  if (!m) throw new Error('隊伍中沒有這位角色')
  const refusal = stayRefusal(m)
  if (refusal) throw new Error(`${m.name}不能留守：${refusal}`)
  const ground = home.areas[home.floors.find((k) => home.areas[k]?.homeFloor === 'ground')!]!
  // 站在一樓室內的某一格（不擋門）
  const spots = ground.cells.map((c, i) => i).filter((i) => ground.cells[i]!.kind === 'floor' && !ground.cells[i]!.furniture)
  const spot = spots[hash(m.id) % Math.max(1, spots.length)] ?? 0
  parkMember(state, m, home.location, home.id, { area: ground.key, x: spot % ground.width, y: Math.floor(spot / ground.width) })
  const report = homeReport(state, 'social', 0.2, home.name)
  report.changes.companions = [{ npc: m.id, name: m.name, change: 'left', reason: '留在家裡' }]
  report.outcome = { result: 'neutral', summary: summary ?? `${m.name}留在「${home.name}」看家。`, tags: ['留守'] }
  return commitReport(state, report)
}

/**
 * 隊員離開隊伍、待在某個地方等主角回來（不算離隊：羈絆、契約、親密度都保留）。
 * staying：房子的 id 或「tavern:地點」；at：站的格子（一直待著）
 */
export function parkMember(state: GameState, m: Character, location: string, staying: string, at: { area: string; x: number; y: number }) {
  state.party = state.party.filter((x) => x !== m)
  const rec = npcRecord(state, m.id)
  registerNpc(state, {
    ...(rec ?? { id: m.id, name: m.name, race: m.race, class: m.class, level: m.level, location, hire_cc: 0, personality: m.personality ?? '' }),
    level: m.level, location, character: JSON.parse(JSON.stringify(m)) as Character, staying, stayingSince: { ...state.time },
    at: { ...at, until: 1e9 },
  })
}

/**
 * 把留守或寄放的夥伴帶回隊伍（隊伍要有空位）；回傳回到隊伍的角色。
 * 存檔規則「職業武器限制」：拿著職業不能用的武器時收進行囊，說明放進 stowed（歸隊那筆日誌用）
 */
export function unparkMember(state: GameState, id: string, stowed: string[] = []): Character {
  const rec = state.npcs?.[id]
  if (!rec?.staying || !rec.character) throw new Error(`${rec?.name ?? '這個人'}沒有在等你`)
  if (partyRoom(state) < 1) throw new Error(`隊伍最多 ${partyMax(state)} 人`)
  const m = rec.character
  delete rec.character
  delete rec.staying
  delete rec.stayingSince
  delete rec.at
  state.party.push(m)
  stowed.push(...enforceClassWeapons(state, [m]), ...enforceExtraSlots(state, [m]))
  return m
}

/** 帶上留在家裡的夥伴 */
export function leaveWithResident(state: GameState, area: Area, id: string): Report {
  const home = homeOfArea(state, area)
  if (!home) throw new Error('要在自己的房子裡')
  const rec = state.npcs?.[id]
  if (!rec || rec.staying !== home.id || !rec.character) throw new Error(`${rec?.name ?? '這個人'}沒有留在這裡`)
  const stowed: string[] = []
  const m = unparkMember(state, id, stowed)
  const report = homeReport(state, 'social', 0.2, home.name)
  if (stowed.length) report.stowed = stowed
  report.changes.companions = [{ npc: m.id, name: m.name, change: 'joined', ...(m.bond ? { bond: m.bond } : {}), reason: '從家裡出發' }]
  report.outcome = { result: 'neutral', summary: `${m.name}跟著你從「${home.name}」出發。`, tags: ['歸隊'] }
  return commitReport(state, report)
}

/** 在場的隊員或留在這棟房子的夥伴（製作時找做的人用） */
export function memberOrResident(state: GameState, area: Pick<Area, 'key' | 'kind'>, id: string): Character | undefined {
  return state.party.find((m) => m.id === id) ?? residentsHere(state, area).find((m) => m.id === id)
}

