// 不在隊上的夥伴與騰出位子（說明見 docs/COMPANIONS.md 第 2.7 節）：
// - 夥伴可以留在自己的房子（homes.ts）或寄放在酒館：不算離隊，羈絆、契約、親密度都保留，不佔隊伍人數，會一直等主角回來帶。
// - 寄放在酒館不用錢；奴隸只能留在房子（酒館沒人看管）。
// - 在有房子的城鎮可以直接把隊員送回家（不必走進房子）。
// - 事件或 AI 讓人入隊時隊伍滿了：記成「等你決定」的入隊（state.pendingJoins），騰出位子後再讓他們加入，或放棄。
//   小隊整隊入隊或整隊不入隊，不會只進來一部分。

import { locationById } from './data'
import { settlementArea, tavernSpot } from './grid'
import { settleAt } from './cohabit'
import { homeById, homeReport, parkMember, stayAt, stayRefusal, unparkMember } from './homes'
import { npcRecord } from './npcs'
import { followRoom, joinParty, leaderOf, partyRoom, pcOf, isBound } from './party'
import { commitReport } from './state'
import { inActiveSquad, squadIds } from './squads'
import { contractOf } from './tattoos'
import { formatMoney } from './money'
import type { Character, GameState, GameTime, Home, NpcRecord, PendingJoin, Report } from './types'

// ---- 不在隊上的夥伴 ----

export type AwayPlace = { kind: 'home'; home: Home; location: string } | { kind: 'tavern'; location: string }

export function tavernKey(location: string): string {
  return `tavern:${location}`
}

/** 這個人在哪裡等主角（留守或寄放）；沒有時為 undefined */
export function awayPlace(state: GameState, rec: Pick<NpcRecord, 'staying'>): AwayPlace | undefined {
  if (!rec.staying) return undefined
  if (rec.staying.startsWith('tavern:')) return { kind: 'tavern', location: rec.staying.slice('tavern:'.length) }
  // 主人的家不存進 state.homes（主人留在家裡的隊員，見 masterRoster.ts）
  const home = homeById(state, rec.staying)
  return home ? { kind: 'home', home, location: home.location } : undefined
}

export function awayLabel(p: AwayPlace): string {
  const town = locationById(p.location).name
  if (p.kind === 'tavern') return `${town}的酒館`
  return p.home.name.includes(town) ? homeLabel(p.home) : `${town}「${homeLabel(p.home)}」`
}

export interface AwayCompanion {
  id: string
  name: string
  character: Character
  place: AwayPlace
  since?: GameTime
  /** 待了幾天 */
  days: number
  /** 主人留下的隊員（被主人帶著時，masterRoster.ts）：主人的 id；要向主人提議才能帶回 */
  master?: string
}

function hoursBetween(a: GameTime, b: GameTime): number {
  return (b.day - a.day) * 24 + (b.hour ?? 0) - (a.hour ?? 0) + ((b.minute ?? 0) - (a.minute ?? 0)) / 60
}

/** 所有留在房子或寄放在酒館的夥伴（待得久的在前） */
export function awayCompanions(state: GameState): AwayCompanion[] {
  const out: AwayCompanion[] = []
  for (const rec of Object.values(state.npcs ?? {})) {
    const place = rec.character ? awayPlace(state, rec) : undefined
    if (!place) continue
    const days = rec.stayingSince ? Math.max(0, Math.floor(hoursBetween(rec.stayingSince, state.time) / 24)) : 0
    out.push({ id: rec.id, name: rec.character!.name, character: rec.character!, place, ...(rec.stayingSince ? { since: rec.stayingSince } : {}), days, ...(rec.character!.group ? { master: rec.character!.group } : {}) })
  }
  return out.sort((a, b) => b.days - a.days)
}

/** 寄放在這座城鎮酒館的夥伴（主人留在這裡的隊員不算，見 masterRoster.ts） */
export function lodgersHere(state: GameState): Character[] {
  const key = tavernKey(state.location)
  return Object.values(state.npcs ?? {}).filter((r) => r.staying === key && r.character && !r.character.group).map((r) => r.character!)
}

// ---- 騰出位子：送回房子、寄放酒館 ----

/** 這座城鎮裡自己的房子（主人的家不算） */
export function homesHere(state: GameState): Home[] {
  if (locationById(state.location).type === 'dungeon') return []
  return Object.values(state.homes ?? {}).filter((h) => h.location === state.location && !h.master)
}

/** 房子的名字加上所在的街區（同一座城有兩棟同名的房子時分得出來） */
export function homeLabel(home: Home): string {
  const block = settlementArea(home.lot.area)?.name.split('・').at(-1)
  return block ? `${home.name}（${block}）` : home.name
}

/** 不能寄放在酒館的原因（主角、任務同行、跟著的隊伍、奴隸） */
export function lodgeRefusal(state: GameState, m: Character): string | undefined {
  const r = stayRefusal(m, state)
  if (r) return r
  if (m.bond === 'slave') return '奴隸只能留在你的房子（酒館沒人看管）'
  if (!tavernSpot(state.location)) return '這裡沒有酒館'
  return undefined
}

/** 不能送回房子的原因 */
export function sendHomeRefusal(state: GameState, m: Character): string | undefined {
  // 同居的人：只能送回他住的那一棟（回家住下）
  const mate = state.npcs?.[m.id]?.cohabit
  if (mate) return homesHere(state).some((h) => h.id === mate.home) ? undefined : `${m.name}住的房子不在這座城`
  return stayRefusal(m, state) ?? (homesHere(state).length ? undefined : '這座城鎮沒有你的房子')
}

/** 在有房子的城鎮把隊員送回家留守（不必走進房子） */
export function sendHome(state: GameState, homeId: string, memberId: string): Report {
  const home = homesHere(state).find((h) => h.id === homeId)
  if (!home) throw new Error('這座城鎮沒有這棟房子')
  const m = state.party.find((x) => x.id === memberId)
  const mate = state.npcs?.[memberId]?.cohabit
  if (mate) {
    if (mate.home !== home.id) throw new Error(`${m?.name ?? '這個人'}住在別棟房子`)
    return settleAt(state, home, memberId, m ? `${m.name}先回「${home.name}」住下。` : undefined)
  }
  return stayAt(state, home, memberId, m ? `${m.name}先回「${home.name}」看家。` : undefined)
}

/** 把隊員寄放在這座城鎮的酒館（不算離隊、不收錢），回來時再帶上 */
export function lodgeAtTavern(state: GameState, memberId: string): Report {
  const m = state.party.find((x) => x.id === memberId)
  if (!m) throw new Error('隊伍中沒有這位角色')
  const refusal = lodgeRefusal(state, m)
  if (refusal) throw new Error(`${m.name}不能寄放：${refusal}`)
  const at = tavernSpot(state.location)!
  parkMember(state, m, state.location, tavernKey(state.location), at)
  const town = locationById(state.location).name
  const report = homeReport(state, 'social', 0.2, `${town}的酒館`)
  report.changes.companions = [{ npc: m.id, name: m.name, change: 'left', reason: '寄放在酒館' }]
  report.outcome = { result: 'neutral', summary: `${m.name}在${town}的酒館等你回來。`, tags: ['寄放'] }
  return commitReport(state, report)
}

/** 帶上寄放在這座城鎮酒館的夥伴 */
export function takeLodger(state: GameState, id: string): Report {
  const rec = state.npcs?.[id]
  if (!rec || rec.staying !== tavernKey(state.location)) throw new Error(`${rec?.name ?? '這個人'}沒有寄放在這裡`)
  // 主人留在這裡的隊員（masterRoster.ts）：要向主人提議帶上
  if (rec.character?.group) throw new Error(`${rec.name}是主人留在這裡的隊員，要向主人提議帶上`)
  const stowed: string[] = []
  const m = unparkMember(state, id, stowed)
  const town = locationById(state.location).name
  const report = homeReport(state, 'social', 0.2, `${town}的酒館`)
  if (stowed.length) report.stowed = stowed
  report.changes.companions = [{ npc: m.id, name: m.name, change: 'joined', ...(m.bond ? { bond: m.bond } : {}), reason: '從酒館出發' }]
  report.outcome = { result: 'neutral', summary: `${m.name}從${town}的酒館回到隊伍。`, tags: ['歸隊'] }
  return commitReport(state, report)
}

// ---- 等你決定的入隊 ----

/** 這筆入隊要幾個位子 */
export function pendingNeed(state: GameState, p: PendingJoin): number {
  return pendingPeople(state, p).length
}

/** 這筆入隊現在還會來的人（死掉、已經在隊伍裡的不算） */
export function pendingPeople(state: GameState, p: PendingJoin): NpcRecord[] {
  return p.npcs.map((id) => npcRecord(state, id)).filter((r): r is NpcRecord => !!r && !r.dead && !state.party.some((m) => m.id === r.id))
}

/** 這筆入隊的空位（join：主角的隊伍；follow：跟著別人時放寬的上限） */
export function pendingRoom(state: GameState, p: PendingJoin): number {
  return p.kind === 'follow' ? followRoom(state) : partyRoom(state)
}

/** 小隊的人自願或受雇入隊：整隊一起來（本人在前） */
export function joinGroup(state: GameState, rec: NpcRecord, mode: PendingJoin['mode']): { people: NpcRecord[]; squad?: string } {
  const sq = mode === 'voluntary' || mode === 'hired' ? inActiveSquad(state, rec.id) : undefined
  if (!sq) return { people: [rec] }
  const mates = squadIds(sq).filter((id) => id !== rec.id && !state.party.some((m) => m.id === id))
    .map((id) => npcRecord(state, id)).filter((r): r is NpcRecord => !!r && !r.dead && !r.staying)
  return { people: [rec, ...mates], squad: sq.leader }
}

/** 記下一筆等你決定的入隊（同一個人已經在等時不重複） */
export function queueJoin(state: GameState, p: Omit<PendingJoin, 'id' | 'time'>): PendingJoin | undefined {
  const list = (state.pendingJoins ??= [])
  if (list.some((x) => x.npcs[0] === p.npcs[0])) return undefined
  const full: PendingJoin = { ...p, id: `pj-${p.npcs[0]}-${state.time.day}-${state.time.hour ?? 0}`, time: { ...state.time } }
  list.push(full)
  return full
}

function dropPending(state: GameState, id: string) {
  state.pendingJoins = (state.pendingJoins ?? []).filter((x) => x.id !== id)
  if (!state.pendingJoins.length) delete state.pendingJoins
}

/** 騰出位子後讓他們加入 */
export function acceptPendingJoin(state: GameState, id: string): Report {
  const p = state.pendingJoins?.find((x) => x.id === id)
  if (!p) throw new Error('這筆入隊已經不在了')
  const people = pendingPeople(state, p)
  const report = homeReport(state, 'social', 0.2, locationById(state.location).name)
  if (!people.length) {
    dropPending(state, id)
    report.outcome = { result: 'neutral', summary: '要加入的人已經不在了。' }
    return commitReport(state, report)
  }
  const room = pendingRoom(state, p)
  if (room < people.length) throw new Error(`還要騰出 ${people.length - room} 個位子`)
  const [first, ...rest] = people
  if (p.kind === 'follow') {
    if (isBound(state)) throw new Error('身為奴隸，跟不了別人的隊伍')
    if (leaderOf(state)) throw new Error('你已經跟著別人的隊伍了')
    joinParty(state, first!, 'leader', report, { group: first!.id })
    for (const m of rest) joinParty(state, m, 'ally', report, { group: first!.id })
    if (p.pay_cc) report.changes.money_cc = p.pay_cc
    report.outcome = { result: 'success', summary: `加入了${first!.name}的隊伍${p.pay_cc ? `，收下 ${formatMoney(p.pay_cc)}` : ''}。`, tags: ['入隊'] }
  } else {
    const mode = p.mode ?? 'voluntary'
    if (mode === 'slave' && contractOf(pcOf(state))) throw new Error('身為奴隸，無法擁有奴隸')
    const joined = joinParty(state, first!, mode, report, { ...(p.contract ? { contract: p.contract } : {}), reason: '事件' })
    if (p.squad) joined.squad = p.squad
    for (const m of rest) {
      const x = joinParty(state, m, mode, report, { reason: `跟著${first!.name}入隊` })
      if (p.squad) x.squad = p.squad
    }
    report.outcome = { result: 'success', summary: `${people.map((r) => r.name).join('、')}加入了隊伍。`, tags: ['入隊'] }
  }
  dropPending(state, id)
  return commitReport(state, report)
}

/** 放棄這筆入隊 */
export function declinePendingJoin(state: GameState, id: string): Report {
  const p = state.pendingJoins?.find((x) => x.id === id)
  if (!p) throw new Error('這筆入隊已經不在了')
  const names = pendingPeople(state, p).map((r) => r.name).join('、') || '對方'
  dropPending(state, id)
  const report = homeReport(state, 'social', 0, locationById(state.location).name)
  report.outcome = { result: 'neutral', summary: p.kind === 'follow' ? `沒有跟著${names}的隊伍走。` : `隊伍沒有空位，${names}沒有加入。` }
  return commitReport(state, report)
}
