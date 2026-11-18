// 房間用途（docs/HOMES.md 第 3.2 節；規則在 homes.json 的 rooms）：替房子裡隔出來的房間標上用途，家具擺對了有加成。
// - 房間不存檔：每次用牆與門圍出來的範圍算（門是兩側都是牆的地板格）。用途記在房子的 rooms，key 是「樓層 key:房間最左上角的格子」；
//   隔間不會改（擴建不動原本的樓層），所以 key 一直有效。院子不算房間。
// - 臥室（有床，舒適度 +1）、書房（書架 2 件以上，舒適度 +1；在書房長休後智力檢定 +1，湊齊「學者的書齋」時 +2）、
//   工坊（有工作台：在這間做那種工藝，工時 ×0.75）、酒窖（地下室、有熟成桶：這間的熟成時間 ×0.75）、
//   客房（有床：留在家裡的夥伴住這間每天親密度 +1，一週最多 +3）、育嬰室（有搖籃：抱抱的「家人的笑容」多持續一次長休）。
// - 一間只能有一種用途；條件不滿足時用途保留、效果不生效。

import { homeRules, itemDef } from './data'
import { currentArea, position, type Area } from './grid'
import { completeSets, ownHomeOfArea } from './homes'
import type { GameState, Home } from './types'

export const ROOM_USES = ['bedroom', 'study', 'workshop', 'cellar', 'guest', 'nursery'] as const
export type RoomUse = (typeof ROOM_USES)[number]
export const ROOM_NAME: Record<RoomUse, string> = { bedroom: '臥室', study: '書房', workshop: '工坊', cellar: '酒窖', guest: '客房', nursery: '育嬰室' }

const rules = () => homeRules.rooms

export interface Room {
  key: string
  area: Area
  cells: number[]
}

const isWall = (area: Area, i: number) => i < 0 || i >= area.cells.length || area.cells[i]!.kind === 'wall'

/** 門：兩側（左右或上下）都是牆的地板格 */
function isDoor(area: Area, i: number): boolean {
  const c = area.cells[i]
  if (!c || c.kind !== 'floor') return false
  const w = area.width
  const x = i % w
  const lr = (x > 0 && isWall(area, i - 1)) && (x < w - 1 && isWall(area, i + 1))
  const ud = isWall(area, i - w) && isWall(area, i + w)
  return lr || ud
}

/** 算進房間的格子：屋子裡的地板與樓梯（院子、牆、門不算） */
const inRoom = (area: Area, i: number) => {
  const c = area.cells[i]
  return !!c && (c.kind === 'floor' || c.kind === 'link') && c.dir !== 'out' && !isDoor(area, i)
}

/** 這一格所在的房間（不在房間裡時 undefined） */
export function roomAt(area: Area, x: number, y: number): Room | undefined {
  if (area.kind !== 'home') return undefined
  const w = area.width
  const start = y * w + x
  if (!inRoom(area, start)) return undefined
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    const i = queue.shift()!
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (seen.has(j) || !inRoom(area, j)) continue
      if (Math.abs((j % w) - (i % w)) > 1) continue
      seen.add(j)
      queue.push(j)
    }
  }
  const cells = [...seen].sort((a, b) => a - b)
  return { key: `${area.key}:${cells[0]}`, area, cells }
}

/** 房子裡所有的房間 */
export function roomsOf(home: Home): Room[] {
  const out: Room[] = []
  for (const area of Object.values(home.areas)) {
    const done = new Set<number>()
    area.cells.forEach((_, i) => {
      if (done.has(i) || !inRoom(area, i)) return
      const r = roomAt(area, i % area.width, Math.floor(i / area.width))
      if (!r) return
      for (const c of r.cells) done.add(c)
      out.push(r)
    })
  }
  return out
}

/** 房間裡的家具（物品名稱） */
export function roomFurniture(room: Room): string[] {
  return room.cells.map((i) => room.area.cells[i]!.furniture).filter((n): n is string => !!n)
}

const fn = (name: string) => itemDef(name)?.furniture

/** 這間的用途有沒有生效；沒有時寫原因 */
export function roomStatus(home: Home, room: Room): { use?: RoomUse; ok: boolean; why?: string } {
  const use = home.rooms?.[room.key]
  if (!use) return { ok: false }
  const items = roomFurniture(room)
  const has = (f: string) => items.some((n) => fn(n)?.function === f)
  let why: string | undefined
  if (use === 'bedroom' || use === 'guest') why = has('bed') ? undefined : '要擺一張床'
  else if (use === 'study') {
    const n = items.filter((x) => rules().study_items.includes(x)).length
    why = n >= rules().study_need ? undefined : `${rules().study_items.join('、')}要 ${rules().study_need} 件（現在 ${n} 件）`
  } else if (use === 'workshop') why = has('workbench') ? undefined : '要擺一座高階工作台'
  else if (use === 'cellar') why = room.area.homeFloor !== 'basement' ? '酒窖要在地下室' : has('aging') ? undefined : '要擺一個熟成桶'
  else if (use === 'nursery') why = has('crib') ? undefined : '要擺一個搖籃'
  return { use, ok: !why, ...(why ? { why } : {}) }
}

/** 生效的房間（用途、房間） */
export function activeRooms(home: Home): { use: RoomUse; room: Room }[] {
  if (!home.rooms || !Object.keys(home.rooms).length) return []
  return roomsOf(home).flatMap((room) => {
    const st = roomStatus(home, room)
    return st.ok && st.use ? [{ use: st.use, room }] : []
  })
}

/** 房間給的舒適度：每間臥室 +bedroom_comfort、每間書房 +study_comfort */
export function roomComfort(home: Home): number {
  return activeRooms(home).reduce((n, r) => n + (r.use === 'bedroom' ? rules().bedroom_comfort : r.use === 'study' ? rules().study_comfort : 0), 0)
}

/** 這一格所在的生效房間是不是這種用途 */
export function activeRoomAt(home: Home, area: Area, x: number, y: number): RoomUse | undefined {
  const room = roomAt(area, x, y)
  if (!room) return undefined
  const st = roomStatus(home, room)
  return st.ok ? st.use : undefined
}

/** 站的地方是生效的工坊、而且裡面有這種工藝的工作台：工時的倍率（不是時 1） */
export function workshopMult(state: GameState, craft: string): number {
  const area = currentArea(state)
  const home = ownHomeOfArea(state, area)
  if (!home) return 1
  const p = position(state)
  const room = roomAt(area, p.x, p.y)
  if (!room || roomStatus(home, room).use !== 'workshop' || !roomStatus(home, room).ok) return 1
  const bench = roomFurniture(room).some((n) => fn(n)?.function === 'workbench' && fn(n)?.craft === craft)
  return bench ? rules().workshop_mult : 1
}

/** 這一格的熟成桶在生效的酒窖裡：熟成時間的倍率 */
export function cellarMult(state: GameState, area: Area, x: number, y: number): number {
  const home = ownHomeOfArea(state, area)
  return home && activeRoomAt(home, area, x, y) === 'cellar' ? rules().cellar_mult : 1
}

/** 在家長休：站在生效的書房裡時，書房的狀態（湊齊學者的書齋時改成加強的那一個） */
export function studyCondition(state: GameState, home: Home): string | undefined {
  const area = currentArea(state)
  const p = position(state)
  if (activeRoomAt(home, area, p.x, p.y) !== 'study') return undefined
  return completeSets(home).includes(rules().study_set) ? rules().study_set_condition : rules().study_condition
}

/** 這棟房子有生效的育嬰室 */
export function hasNursery(home: Home): boolean {
  return activeRooms(home).some((r) => r.use === 'nursery')
}

/** 標上（或拿掉，use 為 null）站的這間房間的用途 */
export function setRoomUse(state: GameState, use: RoomUse | null) {
  const area = currentArea(state)
  const home = ownHomeOfArea(state, area)
  if (!home) throw new Error('要在自己的房子裡')
  const p = position(state)
  const room = roomAt(area, p.x, p.y)
  if (!room) throw new Error('這裡不在任何一間房間裡（院子、門口不算）')
  if (use === null) {
    if (home.rooms) delete home.rooms[room.key]
    return
  }
  if (!ROOM_USES.includes(use)) throw new Error('沒有這種用途')
  if (use === 'cellar' && area.homeFloor !== 'basement') throw new Error('酒窖要在地下室')
  ;(home.rooms ??= {})[room.key] = use
}

/** 客房：每天（staff.ts 的 staffDaily）住在生效客房的留守夥伴親密度上升，一週最多 guest_week_cap */
export function guestDaily(state: GameState, home: Home, day: number, addAffinity: (id: string, d: number) => void) {
  const guest = activeRooms(home).filter((r) => r.use === 'guest')
  if (!guest.length) return
  const week = Math.floor((day - 1) / 7)
  for (const rec of Object.values(state.npcs ?? {})) {
    if (rec.staying !== home.id || !rec.at) continue
    const room = guest.find((g) => g.room.area.key === rec.at!.area && g.room.cells.includes(rec.at!.y * g.room.area.width + rec.at!.x))
    if (!room) continue
    const b = rec.guestBond?.week === week ? rec.guestBond : { week, n: 0 }
    if (b.n >= rules().guest_week_cap) continue
    const d = Math.min(rules().guest_affinity, rules().guest_week_cap - b.n)
    addAffinity(rec.id, d)
    rec.guestBond = { week, n: b.n + d }
  }
}
