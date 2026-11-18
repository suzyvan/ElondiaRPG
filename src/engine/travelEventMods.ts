// 旅途事件、城鎮事件與地下城事件的自訂內容（docs/TRAVEL_EVENTS.md、docs/CONTENT_EDITOR.md）。
// 內建的事件可以改、不能刪；自建的事件沒有被用到的地方，隨時可以刪（等待中的事件會作廢）。
// 另外一筆「事件設定」（key 是 rules）：旅途各種路段的機率、事件種類的權重，城鎮事件與地下城事件的機率與冷卻。

import { ATTR_IDS, SKILL_IDS, STAFF_JOBS, attributeRules, geography, shopRules, type AttrId, type LocationType, type RouteMode, type StoryCheck, type StoryOutcome } from './data'
import { sanitizeCond } from './mods'
import { parasiteDef, parasiteRules } from './parasites'
import { DEFAULT_LAYER_DC } from './dungeonEvents'
import { travelEvents, type DungeonEventRules, type DungeonTrigger, type EventScope, type HomeEventRules, type RoadOption, type RoadTemplate, type TownEventRules } from './road'
import { CONTENT_TAG_IDS } from './content'
import { BODIES } from './traits'
import { sanitizeOutcome } from './storyMods'
import { TOWN_EVENT_CELLS } from './townEvents'
import { MODE_NAME } from './travel'
import type { PregnancyStage } from './types'

export interface TravelEventMod extends RoadTemplate {
  custom?: boolean
}

/** 事件設定（只有一筆） */
export interface EventRulesMod {
  chance: Partial<Record<RouteMode, number>>
  weights: { auto: number; choice: number; combat: number; advanced: number }
  town: TownEventRules
  dungeon: DungeonEventRules
  /** 家裡的事（家僕，docs/HOMES.md 第 8.1 節）；舊的自訂內容沒有這一欄，整理時補上內建的 */
  home: HomeEventRules
}
const DEFAULT_HOME: HomeEventRules = { chance: { step: 0.04, rest: 0.25 }, cooldown_hours: 20, repeat_days: 6 }

export const EVENT_LIMITS = { title_chars: 20, text_chars: 400, label_chars: 30, options: 5, cooldown_days: [0, 60], scene_chars: 200, offscreen_chars: 120 } as const
export const DUNGEON_TRIGGERS: Record<DungeonTrigger, string> = { trap: '觸發陷阱', chest: '打開寶箱', gather: '採集', rest: '安全房長休' }
/** 寄生物發作的時機（parasiteEvents.ts） */
export const PARASITE_MOMENTS: Record<NonNullable<RoadTemplate['moments']>[number], string> = { step: '走動', travel: '旅途', rest: '長休之後' }
/** 地下城事件的層：0 近郊、1 淺層 … 4 底層 */
export const EVENT_LAYERS = ['近郊', '淺層', '中層', '深層', '底層'] as const
/** 懷孕的階段（docs/FAMILY.md 第 4 節） */
export const PREG_STAGE_IDS: PregnancyStage[] = ['hidden', 'early', 'mid', 'late']
export const PREG_STAGE_NAME: Record<PregnancyStage, string> = { hidden: '未察覺', early: '初期', mid: '中期', late: '後期' }
/** 懷孕的事件：父親的條件 */
export const FATHER_FILTERS: Record<NonNullable<RoadTemplate['father']>, string> = { unknown: '父親不明', known: '知道父親是誰', in_party: '父親在隊上', not_in_party: '父親不在隊上' }
const DEFAULT_DUNGEON: DungeonEventRules = { chance: { trap: 0, chest: 0, gather: 0, rest: 0 }, cooldown_hours: 4, repeat_days: 3 }
export const ROUTE_MODES = Object.keys(MODE_NAME) as RouteMode[]
export const LOCATION_TYPE_NAME: Record<Exclude<LocationType, 'dungeon'>, string> = {
  capital: '主城', city: '城市', town: '城鎮', village: '村莊', port: '港口', outpost: '哨站', fortress: '要塞',
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const num = (v: unknown, lo: number, hi: number, d: number, digits = 2) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  const f = 10 ** digits
  return Math.round(Math.max(lo, Math.min(hi, n)) * f) / f
}

/** 內建事件與設定的快照（模組載入時） */
const snapshot = { templates: clone(travelEvents.templates), rules: rulesOf() }

function rulesOf(): EventRulesMod {
  return clone({ chance: travelEvents.chance, weights: travelEvents.weights, town: travelEvents.town, dungeon: travelEvents.dungeon ?? DEFAULT_DUNGEON, home: travelEvents.home ?? DEFAULT_HOME })
}

export function builtinTravelEvent(id: string): RoadTemplate | undefined {
  const t = snapshot.templates.find((x) => x.id === id)
  return t ? clone(t) : undefined
}

export function builtinEventRules(): EventRulesMod {
  return clone(snapshot.rules)
}

/** 城鎮事件可以指定的設施：內建的設施，加上自建的商店 */
export function townEventCells(): string[] {
  return [...TOWN_EVENT_CELLS, ...Object.entries(shopRules.types).filter(([, d]) => d.custom).map(([id]) => id)]
}

function check(v: unknown): StoryCheck | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as Partial<StoryCheck>
  return {
    attr: ATTR_IDS.includes(c.attr as AttrId) ? c.attr! : 'int', dc: Math.round(num(c.dc, 1, 40, 12)),
    // 檢定分類（說服、欺瞞……）：認得的才留，沒寫時照屬性推
    ...((SKILL_IDS as string[]).includes(c.skill as string) ? { skill: c.skill } : {}),
  }
}

/** 事件的結果：特殊任務的結果，拿掉只有任務用得到的（完成、失敗、再來一次、任務同行）。
 * 事件不能讓主角淪為奴隸（只留給特殊任務），也不能直接把隊伍送進地下城（不花時間就開始探索） */
function outcome(v: unknown): StoryOutcome | undefined {
  const o = sanitizeOutcome(v)
  if (!o) return undefined
  delete o.complete
  delete o.fail_quest
  delete o.retry
  delete o.join
  delete o.leave
  if (o.effects) {
    o.effects = o.effects.filter((e) => e.type !== 'enslave_player')
    if (!o.effects.length) delete o.effects
  }
  if (o.travel_to && geography.locations.find((l) => l.id === o.travel_to)?.type === 'dungeon') delete o.travel_to
  return Object.keys(o).length ? o : undefined
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  return [...new Set((Array.isArray(v) ? v : []).filter((x): x is T => allowed.includes(x as T)))]
}

/** 事件的種類（scope；road 是預設，不寫） */
export const EVENT_SCOPES: EventScope[] = ['road', 'town', 'dungeon', 'parasite', 'lead', 'pregnancy', 'lactation', 'brood', 'home']
const BROOD_KINDS = ['egg', 'live', 'parasite'] as const

/** 整理一個事件。城鎮事件沒有高階（不會進臨時地圖的「發現」），選擇的事件至少要有一個選項 */
/** extraCells：還沒套用、但同一包裡有的自建商店（匯入時） */
export function sanitizeTravelEvent(id: string, raw: Partial<TravelEventMod>, custom: boolean, extraCells: string[] = []): TravelEventMod {
  const L = EVENT_LIMITS
  const scope: EventScope = raw.scope && (EVENT_SCOPES as string[]).includes(raw.scope) ? raw.scope : 'road'
  // 地下城事件、線索事件、寄生物的發作與懷孕的事件只有選擇（事件發生在主角身上，主角自己決定怎麼應付）
  const kind = raw.kind === 'check' && (scope === 'road' || scope === 'town') ? 'check' : 'choice'
  const out: TravelEventMod = {
    id,
    ...(scope !== 'road' ? { scope } : {}),
    tier: scope === 'road' && raw.tier === 'advanced' ? 'advanced' : 'normal',
    kind,
    title: str(raw.title, L.title_chars) || '新的事件',
    text: str(raw.text, L.text_chars),
  }
  if (scope === 'road') {
    const modes = pick(raw.modes, ROUTE_MODES)
    if (modes.length) out.modes = modes
    const regions = pick(raw.regions, geography.regions.map((r) => r.id))
    if (regions.length) out.regions = regions
  } else if (scope === 'dungeon') {
    const triggers = pick(raw.triggers, Object.keys(DUNGEON_TRIGGERS) as DungeonTrigger[])
    if (triggers.length) out.triggers = triggers
    const dungeons = pick(raw.dungeons, geography.locations.map((l) => l.id))
    if (dungeons.length) out.dungeons = dungeons
    const regions = pick(raw.regions, geography.regions.map((r) => r.id))
    if (regions.length) out.regions = regions
    const layers = [...new Set((Array.isArray(raw.layers) ? raw.layers : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < EVENT_LAYERS.length))].sort()
    if (layers.length) out.layers = layers
    if (raw.cooldown_days !== undefined && raw.cooldown_days !== null && String(raw.cooldown_days) !== '') out.cooldown_days = Math.round(num(raw.cooldown_days, ...L.cooldown_days, 3))
  } else if (scope === 'lead') {
    // 線索事件：放在哪些地點、地區、層；登場角色幾位；沒人處理時登場角色的近況
    const dungeons = pick(raw.dungeons, geography.locations.map((l) => l.id))
    if (dungeons.length) out.dungeons = dungeons
    const regions = pick(raw.regions, geography.regions.map((r) => r.id))
    if (regions.length) out.regions = regions
    const layers = [...new Set((Array.isArray(raw.layers) ? raw.layers : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < EVENT_LAYERS.length))].sort()
    if (layers.length) out.layers = layers
    const cast = Math.round(num(raw.cast, 0, 2, 0))
    if (cast) out.cast = cast
    const off = str(raw.offscreen, L.offscreen_chars)
    if (off && cast) out.offscreen = off
  } else if (scope === 'parasite') {
    // 找不到的寄生物（被刪掉、寄生物整理失敗）照原樣留著：事件不會發生，編輯畫面標成壞掉；不要換成別的寄生物
    const pid = typeof raw.parasite === 'string' ? raw.parasite.trim().slice(0, 60) : ''
    out.parasite = pid || Object.keys(parasiteRules.parasites)[0]!
    const stages = [...new Set((Array.isArray(raw.stages) ? raw.stages : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < parasiteRules.stages.length))].sort()
    if (stages.length && stages.length < parasiteRules.stages.length) out.stages = stages
    const moments = pick(raw.moments, Object.keys(PARASITE_MOMENTS) as NonNullable<RoadTemplate['moments']>)
    if (moments.length && moments.length < Object.keys(PARASITE_MOMENTS).length) out.moments = moments
  } else if (scope === 'pregnancy') {
    // 懷孕的事件（docs/FAMILY.md 第 5 節）：察覺事件或孕期事件、誰的事、時機、懷孕的條件
    out.subject = raw.subject === 'companion' ? 'companion' : 'pc'
    if (raw.known) out.known = true
    const stages = pick(raw.preg_stages, PREG_STAGE_IDS)
    if (stages.length && stages.length < PREG_STAGE_IDS.length) out.preg_stages = stages
    const moments = pick(raw.moments, Object.keys(PARASITE_MOMENTS) as NonNullable<RoadTemplate['moments']>)
    if (moments.length && moments.length < Object.keys(PARASITE_MOMENTS).length) out.moments = moments
    if (raw.in_settlement) out.in_settlement = true
    if (raw.father && raw.father in FATHER_FILTERS) out.father = raw.father
    const races = pick(raw.father_races, Object.keys(attributeRules.races))
    if (races.length) out.father_races = races
    if (typeof raw.mixed === 'boolean') out.mixed = raw.mixed
    if (typeof raw.forced === 'boolean') out.forced = raw.forced
  } else if (scope === 'lactation') {
    // 泌乳的事件（docs/FAMILY.md 第 10.4 節）：泌乳中的主角或隊上泌乳的夥伴、時機
    out.subject = raw.subject === 'companion' ? 'companion' : 'pc'
    const moments = pick(raw.moments, Object.keys(PARASITE_MOMENTS) as NonNullable<RoadTemplate['moments']>)
    if (moments.length && moments.length < Object.keys(PARASITE_MOMENTS).length) out.moments = moments
    if (raw.in_settlement) out.in_settlement = true
  } else if (scope === 'home') {
    // 家裡的事（docs/HOMES.md 第 8.1 節）：家僕的職位、親密度範圍、雇來的或奴隸、時機（走動、長休醒來）
    const jobs = pick(raw.staff, STAFF_JOBS)
    if (jobs.length && jobs.length < STAFF_JOBS.length) out.staff = jobs
    if (Array.isArray(raw.staff_affinity) && raw.staff_affinity.length === 2) {
      const lo = Math.round(num(raw.staff_affinity[0], -100, 100, -100))
      const hi = Math.round(num(raw.staff_affinity[1], -100, 100, 100))
      if (lo > -100 || hi < 100) out.staff_affinity = [Math.min(lo, hi), Math.max(lo, hi)]
    }
    if (raw.staff_bond === 'hired' || raw.staff_bond === 'slave') out.staff_bond = raw.staff_bond
    const moments = pick(raw.moments, ['step', 'rest'] as const)
    if (moments.length === 1) out.moments = moments
    if (raw.cooldown_days !== undefined && raw.cooldown_days !== null && String(raw.cooldown_days) !== '') out.cooldown_days = Math.round(num(raw.cooldown_days, ...L.cooldown_days, 6))
  } else if (scope === 'brood') {
    // 苗床的事件（docs/FAMILY.md 第 13.3 節）：主角身上的苗床，種類、階段（支配時就產下了，不列）、時機
    const kinds = pick(raw.brood_kinds, BROOD_KINDS)
    if (kinds.length && kinds.length < BROOD_KINDS.length) out.brood_kinds = kinds
    const max = parasiteRules.stages.length - 1
    const stages = [...new Set((Array.isArray(raw.stages) ? raw.stages : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max))].sort()
    if (stages.length && stages.length < max) out.stages = stages
    const moments = pick(raw.moments, Object.keys(PARASITE_MOMENTS) as NonNullable<RoadTemplate['moments']>)
    if (moments.length && moments.length < Object.keys(PARASITE_MOMENTS).length) out.moments = moments
    if (raw.in_settlement) out.in_settlement = true
  } else {
    const cells = pick(raw.cells, [...townEventCells(), ...extraCells])
    if (cells.length) out.cells = cells
    const types = pick(raw.location_types, Object.keys(LOCATION_TYPE_NAME) as LocationType[])
    if (types.length) out.location_types = types
    const locs = pick(raw.locations, geography.locations.filter((l) => l.type !== 'dungeon').map((l) => l.id))
    if (locs.length) out.locations = locs
    if (raw.cooldown_days !== undefined && raw.cooldown_days !== null && String(raw.cooldown_days) !== '') out.cooldown_days = Math.round(num(raw.cooldown_days, ...L.cooldown_days, 7))
  }
  if (typeof raw.category === 'string' && travelEvents.town?.categories[raw.category]) out.category = raw.category
  const req = sanitizeCond(raw.requires)
  if (req) out.requires = req
  // 內容標籤、主角的體型、親密場景（成人向的事件）
  const tags = CONTENT_TAG_IDS.filter((t) => Array.isArray(raw.tags) && raw.tags.includes(t))
  if (tags.length) out.tags = tags
  const bodies = BODIES.filter((b) => Array.isArray(raw.pc_body) && raw.pc_body.includes(b))
  if (bodies.length && bodies.length < BODIES.length) out.pc_body = bodies
  const scene = str(raw.scene, L.scene_chars)
  if (scene) out.scene = scene
  // 地下城：用引子引來時的文字（編輯器沒有欄位，改內建事件時照樣留著）
  if (scope === 'dungeon' && raw.lure && typeof raw.lure === 'object') {
    const l = raw.lure as Record<string, unknown>
    const lure: NonNullable<RoadTemplate['lure']> = {}
    const title = str(l.title, L.title_chars)
    if (title) lure.title = title
    const text = str(l.text, L.text_chars)
    if (text) lure.text = text
    const rep = (Array.isArray(l.replace) ? l.replace : []).filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && !!x[0] && typeof x[1] === 'string').slice(0, 10)
    if (rep.length) lure.replace = rep.map(([a, b]) => [a.slice(0, L.text_chars), b.slice(0, L.text_chars)])
    if (Object.keys(lure).length) out.lure = lure
  }
  // 時段：城鎮、地下城、寄生物才有（旅途照天數走；線索在生成地圖時就放好了）
  if (scope !== 'road' && scope !== 'lead' && (raw.hours === 'day' || raw.hours === 'night')) out.hours = raw.hours
  if (kind === 'check') {
    out.check = check(raw.check) ?? { attr: 'int', dc: 12 }
    const s = outcome(raw.success)
    if (s) out.success = s
    const f = outcome(raw.fail)
    if (f) out.fail = f
  }
  // 選擇的事件；高階的檢定事件成功之後也接著選
  if (kind === 'choice' || out.tier === 'advanced') {
    const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, L.options).map((o): RoadOption => {
      const opt: RoadOption = { label: str(o?.label, L.label_chars) || '選項' }
      const c = check(o?.check)
      if (c) opt.check = c
      const s = outcome(o?.success)
      if (s) opt.success = s
      const f = c ? outcome(o?.fail) : undefined
      if (f) opt.fail = f
      if (out.scene && (o?.adult_scene === 'always' || (c && (o?.adult_scene === 'success' || o?.adult_scene === 'fail')))) opt.adult_scene = o.adult_scene
      // 懷孕的事件：察覺（察覺事件才有）、這次生產的 DC 減多少
      if (scope === 'pregnancy' && !out.known && (o?.reveal === 'always' || (c && o?.reveal === 'success'))) opt.reveal = o.reveal
      const req = sanitizeCond(o?.requires)
      if (req) opt.requires = req
      if (scope === 'pregnancy' && o?.birth_bonus) {
        const b = Math.round(num(o.birth_bonus, 0, 5, 0))
        if (b) opt.birth_bonus = b
      }
      return opt
    })
    if (options.length) out.options = options
    else if (kind === 'choice') out.options = [{ label: '離開', success: { text: '你沒有多管。' } }]
  }
  if (custom) out.custom = true
  return out
}

export function newTravelEvent(id: string, scope: EventScope = 'road'): TravelEventMod {
  return sanitizeTravelEvent(id, {
    scope, kind: 'choice', title: scope === 'town' ? '新的城鎮事件' : scope === 'dungeon' ? '新的地下城事件' : scope === 'parasite' ? '新的發作' : scope === 'lead' ? '新的線索事件' : scope === 'pregnancy' ? '新的懷孕事件' : scope === 'lactation' ? '新的泌乳事件' : scope === 'brood' ? '新的苗床事件' : scope === 'home' ? '新的家裡的事' : '新的旅途事件', text: '',
    ...(scope === 'dungeon' ? { triggers: ['trap'] as DungeonTrigger[] } : {}),
    ...(scope === 'parasite' ? { tags: ['adult' as const] } : {}),
    ...(scope === 'pregnancy' ? { tags: ['adult' as const, 'pregnancy' as const], subject: 'pc' as const, known: true } : {}),
    ...(scope === 'lactation' ? { tags: ['adult' as const, 'lactation' as const], subject: 'pc' as const } : {}),
    ...(scope === 'brood' ? { tags: ['adult' as const, 'monster_brood' as const] } : {}),
    options: [{ label: '答應', success: { text: '' } }, { label: '離開', success: { text: '你沒有多管。' } }],
  }, true)
}

export function sanitizeEventRules(raw: Partial<EventRulesMod>): EventRulesMod {
  const base = builtinEventRules()
  const chance = Object.fromEntries(ROUTE_MODES.map((m) => [m, num(raw.chance?.[m], 0, 1, base.chance[m] ?? 0.3)])) as EventRulesMod['chance']
  const w = raw.weights ?? base.weights
  const weights = {
    auto: num(w.auto, 0, 20, base.weights.auto, 1), choice: num(w.choice, 0, 20, base.weights.choice, 1),
    combat: num(w.combat, 0, 20, base.weights.combat, 1), advanced: num(w.advanced, 0, 20, base.weights.advanced, 1),
  }
  const t = raw.town ?? base.town
  const town: TownEventRules = {
    chance: num(t.chance, 0, 1, base.town.chance),
    cooldown_hours: num(t.cooldown_hours, 0, 168, base.town.cooldown_hours, 1),
    repeat_days: Math.round(num(t.repeat_days, 0, 60, base.town.repeat_days)),
    recent_penalty: num(t.recent_penalty, 0, 1, base.town.recent_penalty),
    recent_size: Math.round(num(t.recent_size, 0, 10, base.town.recent_size)),
    categories: base.town.categories,
  }
  const d = raw.dungeon ?? base.dungeon
  const dungeon: DungeonEventRules = {
    chance: Object.fromEntries((Object.keys(DUNGEON_TRIGGERS) as DungeonTrigger[]).map((k) => [k, num(d.chance?.[k], 0, 1, base.dungeon.chance[k])])) as DungeonEventRules['chance'],
    cooldown_hours: num(d.cooldown_hours, 0, 168, base.dungeon.cooldown_hours, 1),
    repeat_days: Math.round(num(d.repeat_days, 0, 60, base.dungeon.repeat_days)),
    dc: EVENT_LAYERS.map((_, i) => Math.round(num(d.dc?.[i], 5, 30, base.dungeon.dc?.[i] ?? DEFAULT_LAYER_DC[i]!))),
  }
  const h = raw.home ?? base.home
  const home: HomeEventRules = {
    chance: { step: num(h.chance?.step, 0, 1, base.home.chance.step), rest: num(h.chance?.rest, 0, 1, base.home.chance.rest) },
    cooldown_hours: num(h.cooldown_hours, 0, 168, base.home.cooldown_hours, 1),
    repeat_days: Math.round(num(h.repeat_days, 0, 60, base.home.repeat_days)),
  }
  return { chance, weights, town, dungeon, home }
}

/** 把事件與設定還原成內建的樣子（自建的拿掉） */
export function restoreTravelEvents() {
  travelEvents.templates.splice(0, travelEvents.templates.length, ...clone(snapshot.templates))
  const r = builtinEventRules()
  travelEvents.chance = r.chance
  travelEvents.weights = r.weights
  travelEvents.town = r.town
  travelEvents.dungeon = r.dungeon
  travelEvents.home = r.home
}

export function applyTravelEvent(id: string, m: TravelEventMod) {
  const { custom: _custom, ...def } = clone(m)
  const i = travelEvents.templates.findIndex((t) => t.id === id)
  if (i >= 0) travelEvents.templates[i] = { ...def, id }
  else travelEvents.templates.push({ ...def, id })
}

export function applyEventRules(r: EventRulesMod) {
  travelEvents.chance = clone(r.chance)
  travelEvents.weights = clone(r.weights)
  travelEvents.town = clone(r.town)
  travelEvents.dungeon = clone(r.dungeon)
  travelEvents.home = clone(r.home ?? builtinEventRules().home)
}

export function currentEventRules(): EventRulesMod {
  return rulesOf()
}

/** 事件的檢查：可能沒問題、只提醒的地方 */
export function travelEventWarnings(t: RoadTemplate): string[] {
  const out: string[] = []
  if (!t.text) out.push('沒有描述')
  if (t.scope === 'parasite' && t.parasite && !parasiteDef(t.parasite)) out.push(`找不到寄生物「${t.parasite}」：這件發作事件不會發生（選一種存在的寄生物）`)
  if (t.tier === 'advanced' && t.kind === 'check' && !t.options?.length) out.push('高階的檢定事件成功後沒有選項')
  // 用了懷孕、泌乳的效果卻沒勾內容標籤：篩選關掉的玩家照樣會遇到這件事件（效果本身不會作用）
  const effects = JSON.stringify([t.success, t.fail, t.options])
  if (effects.includes('"type":"pregnancy"') && !t.tags?.includes('pregnancy')) out.push('用了「懷孕」的效果，事件最好勾「懷孕」內容標籤')
  if (effects.includes('"type":"lactation"') && !t.tags?.includes('lactation')) out.push('用了「泌乳」的效果，事件最好勾「泌乳」內容標籤')
  if (t.scope === 'pregnancy') {
    const text = JSON.stringify([t.title, t.text, t.options])
    if (t.subject !== 'companion' && (text.includes('{a}') || text.includes('"$a"'))) out.push('寫了懷孕的夥伴（{a} 或 $a），可是這是主角的事件')
    if (!t.known && !t.options?.some((o) => o.reveal)) out.push('察覺事件沒有任何會「察覺」的選項：玩家只能等到中期自動察覺')
    if (!t.tags?.includes('pregnancy')) out.push('沒有勾「懷孕」內容標籤')
  }
  if (t.scope === 'lactation') {
    const text = JSON.stringify([t.title, t.text, t.options])
    if (t.subject !== 'companion' && (text.includes('{a}') || text.includes('"$a"'))) out.push('寫了泌乳的夥伴（{a} 或 $a），可是這是主角的事件')
    if (!t.tags?.includes('lactation')) out.push('沒有勾「泌乳」內容標籤')
  }
  if (t.scope === 'brood' && !t.tags?.includes('monster_brood')) out.push('沒有勾「怪物的苗床」內容標籤')
  if (t.scope === 'lead') {
    const text = JSON.stringify([t.title, t.text, t.options, t.offscreen])
    if ((t.cast ?? 0) < 1 && (/\{a他?\}/.test(text) || text.includes('"$a"'))) out.push('寫了登場角色甲（{a} 或 $a），可是登場角色是 0 位')
    if ((t.cast ?? 0) < 2 && (/\{b他?\}/.test(text) || text.includes('"$b"'))) out.push('寫了登場角色乙（{b} 或 $b），可是登場角色不到 2 位')
  }
  return out
}
