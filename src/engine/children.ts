// 嬰兒（成人向的懷孕之後，docs/FAMILY.md 第 7 節）。
// - 嬰兒不是 NPC：存在 state.children，不進 NPC 登錄，所以不會出現在「這裡的人」、人際關係的互動、性經歷、
//   NPC 私生活、娼館、奴隸市場、拍賣會、調教、戰鬥……任何成人系統。交給 AI 時也只在一般的敘事寫一行。
// - 嬰兒永遠是嬰兒（不長大），只放兩個地方：神殿的育幼院（每天寄養費）、自己的房子（不用錢，不一定要有搖籃）。
// - 不在隊上的人生的嬰兒自動安排：主角有房子送房子（母親那座城的優先，否則照路程最近的），沒有房子送母親那座城的神殿
//   （那座城沒有神殿時送到最近有神殿的聚落）。

import { gainCondition, pcOf } from './party'
import { geography, homeRules, isSettlement, itemDef, locationName, type Location } from './data'
import { hasNursery } from './rooms'
import { familyRules } from './pregMarks'
import { formatMoney } from './money'
import { blockKeys, settlementArea } from './grid'
import { commitReport } from './state'
import { baseReport } from './town'
import { shortestPath } from './world'
import type { ChildPlace, ChildRecord, GameState, Home, Report } from './types'

interface NurseryRules { fee_cc: number; escort_cc_per_day: number }
const nursery = () => familyRules.nursery as NurseryRules

const TAG = '家人'

export function childrenOf(state: GameState): ChildRecord[] {
  return state.children ?? []
}

export function childById(state: GameState, id: string): ChildRecord | undefined {
  return childrenOf(state).find((c) => c.id === id)
}

/** 自己買的房子（主人的家不算） */
export function ownHomes(state: GameState): Home[] {
  return Object.values(state.homes ?? {}).filter((h) => !h.master)
}

/** 這座聚落有沒有神殿 */
export function hasTemple(location: string): boolean {
  const loc = findSettlement(location)
  // 和 storyMods.ts 的 hasFacility 一樣看固定地圖（不引用 storyMods：會循環引用）
  return !!loc && blockKeys(loc.id).some((k) => settlementArea(k, false)?.cells.some((c) => c.kind === 'temple'))
}

function findSettlement(id: string): Location | undefined {
  const loc = geography.locations.find((l) => l.id === id)
  return loc && isSettlement(loc) ? loc : undefined
}

/** 路程（天，取最短的那一端）；走不到時是很大的數 */
function roadDays(from: string, to: string): number {
  return shortestPath(from, to)?.days[0] ?? 1e6
}

/** 離這裡最近、有神殿的聚落（自己有神殿就是自己）；整個世界都沒有神殿時回到原地 */
export function nearestTemple(from: string): string {
  if (hasTemple(from)) return from
  let best: { id: string; days: number } | undefined
  for (const l of geography.locations) {
    if (!isSettlement(l) || !hasTemple(l.id)) continue
    const days = roadDays(from, l.id)
    if (!best || days < best.days) best = { id: l.id, days }
  }
  return best?.id ?? from
}

/** 嬰兒在哪裡的一句話 */
export function placeText(state: GameState, where: ChildPlace): string {
  if (where.kind === 'temple') return `${locationName(where.location)}的神殿育幼院`
  const home = state.homes?.[where.home]
  return home ? `自己的房子「${home.name}」（${locationName(home.location)}）` : '自己的房子'
}

/** 嬰兒所在的聚落 */
export function placeLocation(state: GameState, where: ChildPlace): string | undefined {
  return where.kind === 'temple' ? where.location : state.homes?.[where.home]?.location
}

/**
 * 不在隊上的人生的嬰兒自動送去哪裡（決定 12）：主角有房子送房子（母親那座城的優先，否則照路程最近的），
 * 沒有房子送母親那座城的神殿（沒有神殿時送到最近有神殿的聚落）
 */
export function autoPlace(state: GameState, motherLocation: string): ChildPlace {
  const homes = ownHomes(state)
  if (homes.length) {
    const here = homes.find((h) => h.location === motherLocation)
    const home = here ?? [...homes].sort((a, b) => roadDays(motherLocation, a.location) - roadDays(motherLocation, b.location))[0]!
    return { kind: 'home', home: home.id }
  }
  return templePlace(state, nearestTemple(motherLocation))
}

function templePlace(state: GameState, location: string): ChildPlace {
  return { kind: 'temple', location, since: state.time.day, paidUntil: state.time.day }
}

/** 生產之後可以選的地方：這座城的神殿、這座城自己的房子（都沒有時只能照自動安排） */
export function birthPlaceOptions(state: GameState): { id: string; label: string; place: ChildPlace }[] {
  const loc = state.location
  const out: { id: string; label: string; place: ChildPlace }[] = []
  for (const h of ownHomes(state).filter((x) => x.location === loc)) out.push({ id: h.id, label: `自己的房子「${h.name}」`, place: { kind: 'home', home: h.id } })
  if (hasTemple(loc)) out.push({ id: 'temple', label: `${locationName(loc)}的神殿育幼院（每天 ${formatMoney(nursery().fee_cc)}）`, place: templePlace(state, loc) })
  return out
}

/** 新增一個嬰兒（回傳記錄） */
export function addChild(state: GameState, child: Omit<ChildRecord, 'id'>): ChildRecord {
  const list = (state.children ??= [])
  const n = list.reduce((max, c) => Math.max(max, Number(c.id.slice(1)) || 0), 0) + 1
  const rec: ChildRecord = { id: `c${n}`, ...child }
  list.push(rec)
  return rec
}

// ---- 神殿的育幼院 ----

/** 欠了幾天的寄養費（寄養的第一天不收） */
export function owedDays(state: GameState, c: ChildRecord): number {
  return c.where.kind === 'temple' ? Math.max(0, state.time.day - c.where.paidUntil) : 0
}

export function owedFee(state: GameState, c: ChildRecord): number {
  return owedDays(state, c) * nursery().fee_cc
}

/** 寄在這座城神殿的嬰兒 */
export function childrenAtTemple(state: GameState, location: string): ChildRecord[] {
  return childrenOf(state).filter((c) => c.where.kind === 'temple' && c.where.location === location)
}

/** 這座城神殿育幼院欠的寄養費 */
export function templeDebt(state: GameState, location = state.location): number {
  return childrenAtTemple(state, location).reduce((sum, c) => sum + owedFee(state, c), 0)
}

/** 神殿的其他服務（治療、解咒、洗刺青、診察）：欠了寄養費要先繳清 */
export function nurseryRefusal(state: GameState): string | undefined {
  const debt = templeDebt(state)
  return debt > 0 ? `先繳清育幼院的寄養費（${formatMoney(debt)}），神殿才肯替你做別的事` : undefined
}

function nurseryReport(state: GameState, hours: number, scene: string): Report {
  const report = baseReport(state, 'social', hours)
  report.location.scene = scene
  report.outcome = { result: 'neutral', tags: [TAG] }
  report.narration = { pov: 'second_person', length: 'short' }
  return report
}

/** 繳寄養費：把欠的繳清，再預繳 days 天 */
export function payNursery(state: GameState, days = 0): Report {
  const kids = childrenAtTemple(state, state.location)
  if (!kids.length) throw new Error('這座神殿沒有寄養你的孩子')
  const owed = templeDebt(state)
  const prepay = Math.max(0, Math.floor(days)) * nursery().fee_cc * kids.length
  const cost = owed + prepay
  if (cost <= 0) throw new Error('沒有欠寄養費')
  if (state.money_cc < cost) throw new Error('金錢不足')
  for (const c of kids) if (c.where.kind === 'temple') c.where.paidUntil = Math.max(c.where.paidUntil, state.time.day) + Math.max(0, Math.floor(days))
  const report = nurseryReport(state, 0.2, `${locationName(state.location)}的神殿育幼院`)
  report.changes.money_cc = -cost
  report.outcome.summary = `繳了育幼院的寄養費 ${formatMoney(cost)}${prepay ? `（預繳 ${Math.floor(days)} 天）` : ''}。`
  return commitReport(state, report)
}

/** 這個嬰兒現在能不能探望：人在育幼院那座城（站在神殿裡由畫面決定），或在那棟房子裡 */
export function visitChild(state: GameState, id: string): Report {
  const c = childById(state, id)
  if (!c) throw new Error('沒有這個孩子')
  if (placeLocation(state, c.where) !== state.location) throw new Error(`${c.name}不在這座城`)
  const pc = pcOf(state)
  const report = nurseryReport(state, 0.5, placeText(state, c.where))
  // 家裡有生效的育嬰室：家人的笑容多持續一次長休（rooms.ts）
  const home = c.where.kind === 'home' ? state.homes?.[c.where.home] : undefined
  gainCondition(pc, home && hasNursery(home) ? homeRules.rooms.nursery_condition : 'family_smile', report)
  report.outcome.summary = `去看了${c.name}。${c.name}睡得很熟，小手抓著你的手指不放。`
  report.narration = { pov: 'second_person', length: 'short', focus: ['看孩子的溫馨片刻'] }
  return commitReport(state, report)
}

/** 搖籃的數量 */
function cribsIn(home: Home): number {
  let n = 0
  for (const a of Object.values(home.areas)) for (const c of a.cells) if (c.furniture && itemDef(c.furniture)?.furniture?.function === 'crib') n++
  return n
}

/** 住在這棟房子的嬰兒 */
export function childrenAtHome(state: GameState, homeId: string): ChildRecord[] {
  return childrenOf(state).filter((c) => c.where.kind === 'home' && c.where.home === homeId)
}

/** 收起搖籃時：搖籃數不能少於住在家裡的嬰兒數 */
export function cribRefusal(state: GameState, home: Home): string | undefined {
  const kids = childrenAtHome(state, home.id).length
  const cribs = cribsIn(home)
  return kids && cribs && cribs <= kids ? '搖籃上睡著孩子，先把孩子送去別的地方' : undefined
}

/**
 * 把嬰兒送到別的地方：to 是 'temple'（某座城的神殿，location）或房子的 id。
 * 同一座城不用錢；別的城由神殿派人護送，費用照路程（escort_cc_per_day × 天數）。原本在育幼院欠的寄養費一起繳清
 */
export function moveChild(state: GameState, id: string, to: { kind: 'temple'; location: string } | { kind: 'home'; home: string }): Report {
  const c = childById(state, id)
  if (!c) throw new Error('沒有這個孩子')
  const from = placeLocation(state, c.where)
  if (from !== state.location) throw new Error(`要到${c.name}所在的城裡才能安排`)
  let dest: ChildPlace
  if (to.kind === 'home') {
    const home = state.homes?.[to.home]
    if (!home || home.master) throw new Error('沒有這棟房子')
    if (c.where.kind === 'home' && c.where.home === home.id) throw new Error(`${c.name}已經在這裡了`)
    dest = { kind: 'home', home: home.id }
  } else {
    if (!hasTemple(to.location)) throw new Error(`${locationName(to.location)}沒有神殿`)
    if (c.where.kind === 'temple' && c.where.location === to.location) throw new Error(`${c.name}已經在這裡了`)
    dest = templePlace(state, to.location)
  }
  const target = placeLocation(state, dest)!
  const days = target === from ? 0 : Math.max(1, Math.ceil(roadDays(from, target)))
  const escort = days * nursery().escort_cc_per_day
  const owed = owedFee(state, c)
  const cost = escort + owed
  if (state.money_cc < cost) throw new Error(`金錢不足（要 ${formatMoney(cost)}）`)
  const report = nurseryReport(state, 0.5, placeText(state, c.where))
  if (cost) report.changes.money_cc = -cost
  const where = placeText(state, dest)
  c.where = dest
  const fees = [owed ? `繳清寄養費 ${formatMoney(owed)}` : '', escort ? `請神殿派人護送 ${formatMoney(escort)}` : ''].filter(Boolean).join('、')
  report.outcome.summary = `把${c.name}送到${where}${fees ? `（${fees}）` : ''}。`
  return commitReport(state, report)
}

/** 交給 AI 的一般敘事：主角的孩子在哪裡（成人場景的提示詞不送，見 narrator/prompt.ts） */
export function childrenNote(state: GameState): string {
  const list = childrenOf(state)
  if (!list.length) return ''
  const parent = (p: { id?: string; name: string }) => (p.id === 'pc' ? '主角' : p.name)
  const parents = (c: ChildRecord) => `母親${parent(c.mother)}、${c.father ? `父親${parent(c.father)}` : '父親不明'}`
  return `主角照顧的孩子（嬰兒）：${list.map((c) => `${c.name}（${parents(c)}；${placeText(state, c.where)}）`).join('、')}`
}

