// 劇情旗標：特殊任務、固定 NPC、旅途與情報事件共用（見 docs/STORY_QUESTS.md）。
//
// 作者寫的旗標名稱（例如 met_elder）存在 GameState.flags 的 story:<名稱>，和程式自己用的旗標分開。
// 名稱以 ai: 開頭時直接讀 AI 判定寫下的旗標（例如 ai:答應幫忙），讓劇情可以接上 AI 的判定。

import { charmLevel } from './charm'
import { locationById, PARK_STAMP_PREFIX, storyCounters, TRAP_LOCK, type StoryCond } from './data'
import { gearRules } from './gear'
import { currentRegion, exposureAt, lewdOf } from './lewd'
import { PARASITE_LOCK } from './parasites'
import { bindsOf } from './schools'
import { contractOf } from './tattoos'
import type { GameState, GameTime } from './types'

export const STORY_PREFIX = 'story:'

export function flagKey(name: string): string {
  return name.startsWith('ai:') ? name : `${STORY_PREFIX}${name}`
}

export function hasFlag(state: GameState, name: string): boolean {
  // 舊存檔的集章旗標沒有 story: 前綴（0.4.3 之前引擎直接寫 park_stamp_<園區>），照樣算
  const v = state.flags[flagKey(name)] ?? (name.startsWith(PARK_STAMP_PREFIX) ? state.flags[name] : undefined)
  return v !== undefined && v !== false && v !== 0 && v !== ''
}

export function setFlag(state: GameState, name: string, value: unknown = true) {
  state.flags[flagKey(name)] = value
}

export function clearFlag(state: GameState, name: string) {
  delete state.flags[flagKey(name)]
}

/** 條件成立：flags 全部有、flags_none 全部沒有、flags_any 至少一個有、計數器在範圍內、affinity 的每位角色好感都夠（沒有條件時成立） */
export function condMet(state: GameState, cond: StoryCond | undefined): boolean {
  if (!cond) return true
  return (cond.flags ?? []).every((f) => hasFlag(state, f)) && (cond.flags_none ?? []).every((f) => !hasFlag(state, f))
    && (!cond.flags_any?.length || cond.flags_any.some((f) => hasFlag(state, f)))
    && Object.entries(cond.counters ?? {}).every(([id, r]) => {
      const v = counterValue(state, id)
      return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max)
    })
    && Object.entries(cond.affinity ?? {}).every(([id, min]) => (state.relationships?.[id]?.affinity ?? 0) >= min)
    && Object.entries(cond.parasites ?? {}).every(([id, r]) => {
      // 主角身上要有這個寄生物、而且沒有沉睡；侵蝕度在範圍內、馴服與否相符
      const p = state.party.find((m) => m.isPlayer)?.parasites?.find((x) => x.id === id)
      if (!p || p.dormant) return false
      if (r.tamed !== undefined && !!p.tamed !== r.tamed) return false
      return (r.min === undefined || p.corruption >= r.min) && (r.max === undefined || p.corruption <= r.max)
    })
    && statsMet(state, cond.stats)
    && (!cond.charm || inRange(charmLevel(state.location), cond.charm))
    && wearingMet(state, cond.wearing)
    && (!cond.pc_tags?.length || !!state.party.find((m) => m.isPlayer)?.tags?.some((t) => cond.pc_tags!.includes(t)))
    && afterMet(state, cond.after)
}

const minutesOf = (t: GameTime) => ((t.day - 1) * 24 + (t.hour ?? 0)) * 60 + (t.minute ?? 0)

/** 「某個特殊任務（或任務點）結束後幾天」從什麼時候起成立；那個任務（任務點）還沒結束時 undefined */
export function afterFrom(state: GameState, after: NonNullable<StoryCond['after']>): GameTime | undefined {
  const p = state.stories?.[after.story]
  if (!p) return undefined
  let ended: GameTime | undefined
  if (after.node) {
    if (!p.done.includes(after.node)) return undefined
    ended = [...p.log].reverse().find((e) => e.node === after.node)?.time ?? p.ended
  } else ended = p.ended
  if (!ended) return undefined
  const at = minutesOf(ended) + after.days * 24 * 60
  return { day: Math.floor(at / 1440) + 1, hour: Math.floor((at % 1440) / 60), minute: at % 60 }
}

function afterMet(state: GameState, after: StoryCond['after']): boolean {
  if (!after) return true
  const from = afterFrom(state, after)
  return !!from && minutesOf(state.time) >= minutesOf(from)
}

const inRange = (v: number, r: { min?: number; max?: number }) => (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max)

/** 主角身上戴著什麼（docs/LEWD_STATS.md 第 27 節）：寫了的每一項都要相符 */
function wearingMet(state: GameState, w: StoryCond['wearing']): boolean {
  if (!w) return true
  const pc = state.party.find((m) => m.isPlayer)
  if (!pc) return false
  const binds = bindsOf(pc)
  const gear = Object.values(pc.gear ?? {})
  const facts = {
    bind: binds.length > 0,
    // 別人鎖上的：主人鎖上的（契約還在時）、陷阱鎖住的；寄生裝備不算
    locked: gear.some((g) => g?.locked && !g.locked.startsWith(PARASITE_LOCK) && (g.locked.startsWith(TRAP_LOCK) || !!contractOf(pc))),
    adult_outfit: gear.some((g) => g && gearRules.bases[g.spec.base]?.outfit === 'adult'),
    mark: pc.status.includes('slave_mark'),
  }
  if (w.bind_kind && !binds.some((b) => b.kind === w.bind_kind)) return false
  return (Object.keys(facts) as (keyof typeof facts)[]).every((k) => w[k] === undefined || w[k] === facts[k])
}

/** 慾望指標的條件：主角的有效值（曝露名聲看目前的地區）在範圍內 */
function statsMet(state: GameState, stats: StoryCond['stats']): boolean {
  if (!stats || !Object.keys(stats).length) return true
  const pc = state.party.find((m) => m.isPlayer)
  if (!pc) return false
  const v = lewdOf(pc)
  return Object.entries(stats).every(([k, r]) => {
    const x = k === 'exposure' ? exposureAt(state, pc.id, currentRegion(state)) : v[k as keyof typeof v]
    return x !== undefined && (r?.min === undefined || x >= r.min) && (r?.max === undefined || x <= r.max)
  })
}

// ---- 劇情計數器（data/rules/counters.json） ----

export const COUNTER_PREFIX = 'count:'

/** 計數器目前的值（還沒動過時是計數器的初始值） */
export function counterValue(state: GameState, id: string): number {
  const v = state.flags[`${COUNTER_PREFIX}${id}`]
  return typeof v === 'number' ? v : storyCounters[id]?.initial ?? 0
}

/** 把計數器的加減寫進報告的變更（同一份報告裡多次加減會累計），依計數器的上下限夾住；不存在的計數器略過 */
export function addCounters(state: GameState, changes: { flags?: Record<string, unknown> }, deltas: Record<string, number> | undefined) {
  for (const [id, d] of Object.entries(deltas ?? {})) {
    const def = storyCounters[id]
    if (!def || !d) continue
    const key = `${COUNTER_PREFIX}${id}`
    const pending = changes.flags?.[key]
    let v = (typeof pending === 'number' ? pending : counterValue(state, id)) + d
    if (def.min !== undefined) v = Math.max(def.min, v)
    if (def.max !== undefined) v = Math.min(def.max, v)
    ;(changes.flags ??= {})[key] = v
  }
}

/** 計數器的上下限改了：存檔裡的值夾回新的範圍（讀檔時與自訂內容改變之後；初始值沒動過的計數器本來就跟著新的初始值） */
export function clampCounters(state: GameState) {
  for (const [id, def] of Object.entries(storyCounters)) {
    const key = `${COUNTER_PREFIX}${id}`
    const v = state.flags[key]
    if (typeof v !== 'number') continue
    let c = v
    if (def.min !== undefined) c = Math.max(def.min, c)
    if (def.max !== undefined) c = Math.min(def.max, c)
    if (c !== v) state.flags[key] = c
  }
}

/** 目前成立的劇情旗標（名稱，不含前綴） */
export function storyFlags(state: GameState): string[] {
  return Object.keys(state.flags)
    .filter((k) => k.startsWith(STORY_PREFIX) && hasFlag(state, k.slice(STORY_PREFIX.length)))
    .map((k) => k.slice(STORY_PREFIX.length))
}

/** 整理旗標名稱：去掉空白與前綴，最多 40 字 */
export function cleanFlag(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name.trim().replace(/^story:/, '').replace(/\s+/g, '_').slice(0, 40)
}

/** 地點的劇情條件成立了沒有（寫了 requires 的地點，例如政治史詩開始才出現的歷史裂縫；docs/DUNGEON_DESIGN.md 第 1 節） */
export function locationOpen(state: GameState, id: string): boolean {
  return condMet(state, locationById(id)?.requires)
}

/** 給路徑規劃用的篩選（world.ts 的 shortestPath、reachable） */
export function openFor(state: GameState): (id: string) => boolean {
  return (id) => locationOpen(state, id)
}
