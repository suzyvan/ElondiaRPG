// 同居（docs/HOMES.md 第 8.2 節；規則在 homes.json 的 cohabit）：讓親密度很高的人搬進自己的房子住。
// - 不是隊員、不是家僕，是家人：普通人、冒險者都可以。NPC 登錄的 cohabit 記哪棟房子、睡哪張床；at 站在床邊。
// - 主動行動 cohabit_invite（魅力）：成功搬進來；部分成功下次長休後再問；失敗這週不能再問。
// - 住在家裡：每天親密度上升（一週有上限）、房子舒適度 +1、主角在家長休後得到「家的溫暖」。
// - 冒險者可以帶出門（照一般入隊，cohabit 保留），回家時「住回家裡」；普通人不出門。
// - 親密度掉到 leave_affinity 以下就搬走；主角也可以請他搬出去（親密度下降，記一段記憶）。

import { homeRules, itemDef, locationById, tagDcMod, type Degree } from './data'
import { currentArea } from './grid'
import { homeReport, ownHomeOfArea, residents } from './homes'
import { npcKind, npcRecord, npcSpot, registerNpc } from './npcs'
import { addAffinity, assertFree, gainCondition, isBound, joinParty, partyMax, partyRoom, pcOf } from './party'
import { isUnhireable, presentHere } from './population'
import { activeRoomAt } from './rooms'
import { addMemory, setAffinity } from './social'
import { commitReport } from './state'
import { note } from './staff'
import type { GameState, Home, NpcRecord, Report } from './types'

const rules = () => homeRules.cohabit
type Spot = { area: string; x: number; y: number }
const weekOf = (day: number) => Math.floor((day - 1) / 7)
const key = (s: Spot) => `${s.area}:${s.x},${s.y}`

// ---- 誰住在家裡 ----

/** 和主角同居在這棟房子的人（包括帶出門、現在在隊上的冒險者） */
export function cohabitantsOf(state: GameState, homeId: string): NpcRecord[] {
  return Object.values(state.npcs ?? {}).filter((r) => r.cohabit?.home === homeId && !r.dead)
}

/** 這個人現在在隊伍裡 */
const inParty = (state: GameState, id: string) => state.party.some((m) => m.id === id)

/** 現在人在家裡的同居者（帶出門的不算） */
export function cohabitantsHome(state: GameState, homeId: string): NpcRecord[] {
  return cohabitantsOf(state, homeId).filter((r) => !inParty(state, r.id))
}

/** 房子裡的床 */
function bedsOf(home: Home): Spot[] {
  const out: Spot[] = []
  for (const a of Object.values(home.areas)) {
    a.cells.forEach((c, i) => { if (c.furniture && itemDef(c.furniture)?.furniture?.function === 'bed') out.push({ area: a.key, x: i % a.width, y: Math.floor(i / a.width) }) })
  }
  return out
}

/** 沒人用的床：同居的人、留守的夥伴各佔一張；客房以外的床優先（客房留給留守的夥伴） */
export function freeBed(state: GameState, home: Home): Spot | undefined {
  const beds = bedsOf(home)
  const mates = cohabitantsOf(state, home.id)
  if (beds.length - mates.length - residents(state, home.id).length < 1) return undefined
  const taken = new Set(mates.map((r) => r.cohabit!.bed).filter(Boolean).map((b) => key(b!)))
  const free = beds.filter((b) => !taken.has(key(b)))
  return free.find((b) => activeRoomAt(home, home.areas[b.area]!, b.x, b.y) !== 'guest') ?? free[0]
}

/** 站在床旁邊的一格（沒有家具、沒有別人站的地板；找不到就站在床上） */
function besideBed(state: GameState, home: Home, bed: Spot, id: string): Spot & { until: number } {
  const area = home.areas[bed.area]!
  const taken = new Set(Object.values(state.npcs ?? {}).filter((r) => r.at && r.id !== id).map((r) => key(r.at!)))
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = bed.x + dx
    const y = bed.y + dy
    if (x < 0 || y < 0 || x >= area.width || y >= area.height) continue
    const c = area.cells[y * area.width + x]!
    if (c.kind === 'floor' && !c.furniture && !taken.has(key({ area: area.key, x, y }))) return { area: area.key, x, y, until: 1e9 }
  }
  return { ...bed, until: 1e9 }
}

/** 讓同居的人站回家裡（搬進來、住回家裡、帶出門後在別處離隊時每天的推進） */
function placeHome(state: GameState, home: Home, rec: NpcRecord) {
  const c = rec.cohabit!
  if (!c.bed || !bedsOf(home).some((b) => key(b) === key(c.bed!))) {
    const bed = freeBed(state, home) ?? bedsOf(home)[0]
    if (bed) c.bed = bed
  }
  const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground') ?? Object.values(home.areas)[0]!
  rec.at = c.bed ? besideBed(state, home, c.bed, rec.id) : { area: ground.key, x: 1, y: 1, until: 1e9 }
  rec.location = home.location
}

// ---- 邀請他搬進來（主動行動 cohabit_invite，target 是 NPC id） ----

/** 搬進哪一棟：站在自己的房子裡就是這一棟，否則是這座城裡還能住人的第一棟 */
export function cohabitHome(state: GameState): Home | undefined {
  const ok = (h: Home) => !h.master && cohabitantsOf(state, h.id).length < (rules().caps[h.district] ?? 2) && !!freeBed(state, h)
  const here = ownHomeOfArea(state, currentArea(state))
  if (here) return ok(here) ? here : undefined
  return Object.values(state.homes ?? {}).find((h) => h.location === state.location && ok(h))
}

/** 這個人是店主、公會職員之類得顧店的人 */
function minds(rec: NpcRecord): boolean {
  if (rec.keeper || /^(keeper|clerk)_/.test(rec.id)) return true
  return npcKind(rec) === 'commoner' && !rec.haunts?.length && !!npcSpot(rec)
}

/** 不能請這個人搬進來的原因（沒有時可以；介面用來停用按鈕） */
export function cohabitRefusal(state: GameState, id: string): string | undefined {
  if (isBound(state)) return '被主人帶著時不能請人搬進來'
  const rec = npcRecord(state, id)
  if (!rec) return '你不認識這個人'
  if (rec.cohabit) return `${rec.name}已經和你住在一起了`
  if (inParty(state, id)) return `${rec.name}在隊伍裡（先讓他離隊，或回家後讓他住下）`
  if (rec.staff) return `${rec.name}在你家當家僕`
  if (rec.staying) return `${rec.name}留在你那裡等你`
  if (minds(rec)) return `${rec.name}得顧自己的店`
  if (state.captives?.npcs.includes(id)) return `${rec.name}被你制伏了，先處置`
  if (isUnhireable(id) || rec.tags?.includes('slave') || rec.dead || rec.hostile) return `${rec.name}不會搬進來`
  const rel = state.relationships?.[id]
  if (!rel || rel.affinity < rules().min_affinity) return `親密度要 ${rules().min_affinity} 以上`
  if (state.flags[`invite_wait:${id}`]) return `${rec.name}說要再想想，下次長休後再問`
  if (state.flags[`cohabit_no:${id}`] === weekOf(state.time.day)) return `${rec.name}這週才拒絕過你`
  if (!cohabitHome(state)) {
    const mine = Object.values(state.homes ?? {}).filter((h) => h.location === state.location && !h.master)
    if (!mine.length) return '這座城沒有你的房子'
    return mine.some((h) => cohabitantsOf(state, h.id).length < (rules().caps[h.district] ?? 2)) ? '房子裡沒有空的床' : '房子已經住滿了'
  }
  return undefined
}

export function cohabitDc(state: GameState, id: string): number {
  const rec = npcRecord(state, id)!
  const aff = state.relationships?.[id]?.affinity ?? 0
  const r = rules()
  return r.invite_dc - Math.floor(Math.max(0, aff - r.min_affinity) / Math.max(1, r.affinity_step)) + tagDcMod(rec, 'invite')
}

export function setupCohabitInvite(state: GameState, target: string | undefined) {
  const id = target ?? ''
  const why = cohabitRefusal(state, id)
  if (why) throw new Error(why)
  if (!presentHere(state, id)) throw new Error('要走到他旁邊才能開口')
  const rec = npcRecord(state, id)!
  const home = cohabitHome(state)!
  return {
    dc: cohabitDc(state, id), targetName: rec.name, situational: [], scene: locationById(state.location).name,
    outcomes: {
      critical: `搬進「${home.name}」，親密度 +3`, success: `搬進「${home.name}」`,
      partial: '要再想想（下次長休後才能再問）', fail: '還沒準備好（這週不能再問，親密度 -2）', fumble: '覺得你太急了（這週不能再問，親密度 -5）',
    } as Partial<Record<Degree, string>>,
  }
}

export function applyCohabitInvite(state: GameState, report: Report, target: string, degree: Degree): string {
  const rec = npcRecord(state, target)!
  const home = cohabitHome(state)
  if ((degree === 'critical' || degree === 'success') && home) {
    rec.cohabit = { home: home.id, since: { ...state.time }, from: rec.location }
    placeHome(state, home, rec)
    registerNpc(state, rec)
    if (degree === 'critical') addAffinity(state, report, rec.id, 3, '能和你住在一起很開心')
    return `${rec.name}答應搬進「${home.name}」和你一起住。`
  }
  if (degree === 'partial') {
    ;(report.changes.flags ??= {})[`invite_wait:${rec.id}`] = true
    return `${rec.name}有些心動，但說要再想想。`
  }
  ;(report.changes.flags ??= {})[`cohabit_no:${rec.id}`] = weekOf(state.time.day)
  addAffinity(state, report, rec.id, degree === 'fumble' ? -5 : -2, '請他搬進來被拒')
  return degree === 'fumble' ? `${rec.name}覺得你太急了，臉色有點難看。` : `${rec.name}說還沒準備好。`
}

// ---- 搬走 ----

/** 搬走：回到原本的活躍地點（人在隊上時只是不再同居） */
function moveOut(state: GameState, rec: NpcRecord) {
  const from = rec.cohabit?.from
  delete rec.cohabit
  // 幫忙做的家務（staff.ts）也不做了
  delete rec.chore
  if (inParty(state, rec.id)) return
  delete rec.at
  if (from) rec.location = from
}

function homeHere(state: GameState): Home {
  const home = ownHomeOfArea(state, currentArea(state))
  if (!home) throw new Error('要在自己的房子裡')
  return home
}

function mateHere(state: GameState, home: Home, id: string): NpcRecord {
  const rec = npcRecord(state, id)
  if (!rec?.cohabit || rec.cohabit.home !== home.id) throw new Error('這個人沒有和你住在這裡')
  return rec
}

/** 請他搬出去：親密度下降，記一段記憶 */
export function askToLeave(state: GameState, id: string): Report {
  const home = homeHere(state)
  const rec = mateHere(state, home, id)
  moveOut(state, rec)
  const report = homeReport(state, 'social', 0.5, home.name)
  addAffinity(state, report, rec.id, rules().kick_affinity, '被請出家門')
  addMemory(state, {
    time: { ...state.time }, location: home.location, scene: home.name, participants: ['pc', rec.id], importance: 2,
    summary: `${pcOf(state).name}請${rec.name}搬出「${home.name}」。`,
  })
  report.outcome = { result: 'neutral', summary: `你請${rec.name}搬出「${home.name}」。${rec.name}收拾好東西離開了。`, tags: ['同居', '搬走'] }
  return commitReport(state, report)
}

// ---- 帶出門、住回家裡（冒險者） ----

/** 冒險者可以跟著出門；普通人一直待在家裡 */
export const canGoOut = (rec: NpcRecord) => npcKind(rec) === 'adventurer'

/** 不能帶這位同居的人出門的原因 */
export function takeRefusal(state: GameState, rec: NpcRecord): string | undefined {
  if (!canGoOut(rec)) return '只有冒險者能跟著出門'
  if (inParty(state, rec.id)) return '已經在隊伍裡了'
  if (isBound(state)) return '被主人帶著時不能帶人出門'
  if (partyRoom(state) < 1) return `隊伍最多 ${partyMax(state)} 人`
  return undefined
}

/** 帶上同居的冒險者出門：照一般的自願入隊（同居照樣保留） */
export function takeCohabitant(state: GameState, id: string): Report {
  assertFree(state, '帶人出門')
  const home = homeHere(state)
  const rec = mateHere(state, home, id)
  const why = takeRefusal(state, rec)
  if (why) throw new Error(why)
  const report = homeReport(state, 'social', 0.2, home.name)
  joinParty(state, rec, 'voluntary', report, { reason: '從家裡出發' })
  report.outcome = { result: 'neutral', summary: `${rec.name}跟著你從「${home.name}」出發。`, tags: ['同居', '歸隊'] }
  return commitReport(state, report)
}

/** 同居的隊員回到家裡住下（不算離隊、不扣親密度） */
export function settleCohabitant(state: GameState, id: string): Report {
  return settleAt(state, homeHere(state), id)
}

/** 同居的隊員回到這棟房子住下（站在房子裡，或在同一座城送回家，見 away.ts） */
export function settleAt(state: GameState, home: Home, id: string, summary?: string): Report {
  const rec = mateHere(state, home, id)
  const m = state.party.find((x) => x.id === id)
  if (!m) throw new Error(`${rec.name}不在隊伍裡`)
  state.party = state.party.filter((x) => x !== m)
  rec.character = JSON.parse(JSON.stringify(m))
  rec.level = m.level
  placeHome(state, home, rec)
  const report = homeReport(state, 'social', 0.2, home.name)
  report.changes.companions = [{ npc: m.id, name: m.name, change: 'left', reason: '回家住下' }]
  report.outcome = { result: 'neutral', summary: summary ?? `${m.name}回到「${home.name}」住下。`, tags: ['同居'] }
  return commitReport(state, report)
}

/** 在這棟房子裡、可以「住回家裡」的隊員 */
export function cohabitMembersHere(state: GameState, home: Home): NpcRecord[] {
  return cohabitantsOf(state, home.id).filter((r) => inParty(state, r.id))
}

// ---- 每天、長休、給 AI ----

/** 每天（staff.ts 的 staffDaily）：在家的人親密度上升；親密度太低就搬走；房子不見了就搬回去 */
export function cohabitDaily(state: GameState, day: number) {
  const r = rules()
  for (const rec of Object.values(state.npcs ?? {})) {
    if (!rec.cohabit) continue
    const home = state.homes?.[rec.cohabit.home]
    if (!home || rec.dead) {
      moveOut(state, rec)
      continue
    }
    const rel = state.relationships?.[rec.id]
    if (!rel || rel.affinity < r.leave_affinity) {
      moveOut(state, rec)
      note(home, day, `${rec.name}和你處不來，搬出去了。`, '搬走')
      addMemory(state, {
        time: { day, hour: 8, minute: 0 }, location: home.location, scene: home.name, participants: ['pc', rec.id], importance: 1,
        summary: `${rec.name}和${pcOf(state).name}處不來，搬出了「${home.name}」。`,
      })
      continue
    }
    if (inParty(state, rec.id)) continue
    // 帶出門後在別的地方離隊：自己回家住
    if (!rec.at || !home.areas[rec.at.area]) placeHome(state, home, rec)
    const week = weekOf(day)
    const b = rec.cohabit.bond?.week === week ? rec.cohabit.bond : { week, n: 0 }
    if (b.n >= r.week_cap) continue
    const d = Math.min(r.daily_affinity, r.week_cap - b.n)
    setAffinity(state, rec.id, rel.affinity + d)
    rec.cohabit.bond = { week, n: b.n + d }
  }
}

/** 有人住在家裡時的舒適度（有人氣） */
export function cohabitComfort(state: GameState, home: Home): number {
  return cohabitantsHome(state, home.id).length ? rules().comfort : 0
}

/** 在家長休：有同居的人在家時，主角得到「家的溫暖」；回傳說明（沒有時空字串） */
export function cohabitRest(state: GameState, home: Home, report: Report): string {
  const mates = cohabitantsHome(state, home.id)
  if (!mates.length) return ''
  const got = gainCondition(pcOf(state), rules().condition, report)
  return `和${mates.map((r) => r.name).join('、')}在同一個屋簷下醒來${got ? '，心裡很踏實' : ''}。`
}

/** 給 AI 的場景：和你住在一起的人 */
export function cohabitScene(state: GameState, home: Home): string {
  const list = cohabitantsOf(state, home.id).map((r) => {
    const rel = state.relationships?.[r.id]?.toPlayer
    return `${r.name}${rel ? `（${rel.slice(0, 30)}）` : ''}${inParty(state, r.id) ? '［跟著你出門］' : ''}`
  })
  return list.length ? `和你住在一起的人：${list.join('、')}` : ''
}
