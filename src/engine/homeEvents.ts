// 家裡的事（scope: home，見 docs/HOMES.md 第 8.1 節）：有家僕（或做家務的奴隸）時，在自己的房子裡走動、在家長休醒來時依機率遇到一件事。
// - 模板和城鎮事件共用格式（travel_events.json 的 templates），多了 staff（職位）、staff_affinity（親密度範圍）、staff_bond（雇來的／奴隸）。
// - 事件裡的「他」是符合條件的一位家僕（依事件與日子固定挑）：文字 {a} 換成名字、效果的 $a 換成他的 id。
// - 冷卻、同一事件多久不重複照 travel_events.json 的 home；分類的權重照城鎮事件（最近出現過的種類降低權重）。
// - 等待回應時放在 state.townEvent（和城鎮事件同一個事件視窗，townEvents.ts 的 pendingTownEvent、answerTownEvent）。

import { pcBodyAllowed, tagsAllowed } from './content'
import { currentArea } from './grid'
import { ownHomeOfArea } from './homes'
import { characterBody } from './look'
import { hashString } from './npcs'
import { pcOf } from './party'
import { travelEvents, type RoadTemplate } from './road'
import { choreSlaves, onLeave, staffOf } from './staff'
import { withRng } from './state'
import { condMet } from './storyFlags'
import { dayPartOk } from './timeOfDay'
import type { GameState, GameTime, Home, NpcRecord } from './types'

export type HomeMoment = 'step' | 'rest'

const hoursOf = (t: GameTime) => t.day * 24 + (t.hour ?? 0) + (t.minute ?? 0) / 60

export function homeTemplates(): RoadTemplate[] {
  return travelEvents.templates.filter((t) => t.scope === 'home')
}

/** 這棟房子裡能當事件主角的人：雇來的家僕與做家務的奴隸（請假中的不算） */
function householdOf(state: GameState, home: Home): { rec: NpcRecord; bond: 'hired' | 'slave' }[] {
  return [
    ...staffOf(state, home.id).map((rec) => ({ rec, bond: 'hired' as const })),
    ...choreSlaves(state, home.id).map((rec) => ({ rec, bond: 'slave' as const })),
  ].filter((x) => !onLeave(state, x.rec))
}

/** 符合這個事件條件的家僕 */
export function staffFor(state: GameState, home: Home, t: RoadTemplate): NpcRecord[] {
  return householdOf(state, home).filter(({ rec, bond }) => {
    const job = rec.staff?.job ?? rec.chore
    if (t.staff?.length && (!job || !t.staff.includes(job))) return false
    if (t.staff_bond && t.staff_bond !== bond) return false
    if (t.staff_affinity) {
      const a = state.relationships?.[rec.id]?.affinity ?? 0
      if (a < t.staff_affinity[0] || a > t.staff_affinity[1]) return false
    }
    return true
  }).map((x) => x.rec)
}

/** 這個時候能出現的家裡的事（at：看時段用的時間，長休時是入睡的時間） */
export function homeCandidates(state: GameState, home: Home, moment: HomeMoment, at: GameTime = state.time): RoadTemplate[] {
  const day = state.time.day
  const seen = state.homeEvents?.seen ?? {}
  const repeat = travelEvents.home?.repeat_days ?? 6
  const body = characterBody(pcOf(state))
  return homeTemplates().filter((t) =>
    (!t.moments?.length || t.moments.includes(moment))
    && tagsAllowed(t.tags)
    && pcBodyAllowed(t.pc_body, body)
    && condMet(state, t.requires)
    && dayPartOk(at, t.hours)
    && (seen[t.id] === undefined || day - seen[t.id]! >= (t.cooldown_days ?? repeat))
    && staffFor(state, home, t).length > 0)
}

function weightOf(state: GameState, t: RoadTemplate): number {
  const recent = state.homeEvents?.recent ?? []
  const times = t.category ? recent.filter((c) => c === t.category).length : 0
  return Math.pow(travelEvents.town?.recent_penalty ?? 0.4, times)
}

/**
 * 在自己的房子裡走動（store 的 afterMove，經過 townEvents.ts 的 maybeTownEvent）或在家長休醒來（rest.ts）時：
 * 冷卻過了、機率中了，就遇到一件家裡的事，等玩家回應（state.townEvent）。回傳有沒有遇到。
 */
export function maybeHomeEvent(state: GameState, moment: HomeMoment, at: GameTime = state.time): boolean {
  const rules = travelEvents.home
  if (!rules || state.townEvent || state.combat || state.pendingAction || state.road) return false
  const home = ownHomeOfArea(state, currentArea(state))
  if (!home) return false
  const now = hoursOf(state.time)
  const last = state.homeEvents?.last
  if (last !== undefined && now - last < rules.cooldown_hours) return false
  const list = homeCandidates(state, home, moment, at)
  if (!list.length) return false
  const t = withRng(state, (rng) => {
    if (!rng.chance(rules.chance[moment] ?? 0)) return undefined
    const weights = list.map((x) => weightOf(state, x))
    let r = rng.next() * weights.reduce((a, b) => a + b, 0)
    for (let i = 0; i < list.length; i++) if ((r -= weights[i]!) < 0) return list[i]!
    return list.at(-1)!
  })
  if (!t) return false
  const people = staffFor(state, home, t)
  const who = people[hashString(`${t.id}@${state.time.day}`) % people.length]!
  const log = (state.homeEvents ??= { seen: {}, recent: [] })
  log.last = now
  log.seen[t.id] = state.time.day
  if (t.category) {
    log.recent.push(t.category)
    const size = travelEvents.town?.recent_size ?? 4
    if (log.recent.length > size) log.recent.splice(0, log.recent.length - size)
  }
  state.townEvent = { template: t.id, staff: who.id }
  return true
}

/** 把家僕（{a}、$a）代進事件 */
export function castStaff(t: RoadTemplate, who: { id: string; name: string }): RoadTemplate {
  return JSON.parse(JSON.stringify(t), (_k, v: unknown) => {
    if (typeof v !== 'string') return v
    if (v === '$a') return who.id
    return v.replaceAll('{a}', who.name)
  }) as RoadTemplate
}
