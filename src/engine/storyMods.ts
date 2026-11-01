// 特殊任務的編輯：整理（儲存、匯入時）、套用到任務清單、檢查任務鏈的問題（內容頁籤「⭐ 特殊任務」）。

import { storyReach } from './storyReach'
import { parasiteDef } from './parasites'
import { LEWD_KEYS } from './lewd'
import { LOCK_GRADES, type LewdKey, type LockGrade, type MasterEventPool } from './data'
import {
  abilities, ATTR_IDS, companionRules, specialMaps, storyCounters, enemies, isCustomShopId, isLandmarkId, landmarks, shopRules, type ShopType, geography, itemDef, npcs as namedNpcs, isChoosablePerk, perkDef, slaveryRules, stories, type AttrId, type EncounterGroup, type StoryCheck, type StoryCond,
  type StoryDef, type StoryNode, type StoryOption, type StoryOutcome, type StoryPlace, type StoryStart, type StoryStartKind, type StoryWhere, DUNGEON_LAYER_IDS, DUNGEON_LAYER_NAME, MASTER_EVENT_POOLS, PARK_STAMP_PREFIX,
} from './data'
import type { RewardEffect } from './effects'
import { blockKeys, CELL_NAME, settlementArea, type CellKind } from './grid'
import { gearKnown, gearRules } from './gear'
import { RANK_ORDER } from './materialQuests'
import { sanitizeCond, sanitizeCounterDeltas, sanitizeGearSpecLoose } from './mods'
import { CONTENT_TAG_IDS } from './content'
import { cleanFlag, condMet, hasFlag } from './storyFlags'
import type { GameState } from './types'
import { travelEvents } from './road'
import { isTattooPlace, oathError, tattooTemplate } from './tattoos'
import { mapSize, storySpotProblem } from './specialMapMods'
import { MAX_JUMP_HOURS } from './timeOfDay'

export interface StoryMod extends StoryDef {
  custom?: boolean
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const snapshot = clone(stories)

export function builtinStory(id: string): StoryDef | undefined {
  const s = snapshot.find((x) => x.id === id)
  return s ? clone(s) : undefined
}

export function restoreStories() {
  stories.splice(0, stories.length, ...clone(snapshot))
}

export function applyStoryMod(id: string, m: StoryMod) {
  const { custom: _custom, ...def } = clone(m)
  void _custom
  const i = stories.findIndex((s) => s.id === id)
  if (i >= 0) stories[i] = { ...def, id }
  else stories.push({ ...def, id })
}

// ---- 整理 ----

const num = (v: unknown, lo: number, hi: number, d: number) => {
  if (v === '' || v === null || v === undefined) return d
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d))
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const flags = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(cleanFlag).filter(Boolean))]
/** id：英數與底線 */
export const cleanId = (v: unknown, d: string) => (typeof v === 'string' ? v.trim().replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) : '') || d

export const START_KINDS: Record<StoryStartKind, string> = {
  guild: '冒險者公會', npc: '固定 NPC', travel: '旅途中的事件', informant: '情報商', manual: '只由其他事件開啟',
}
export const WHERE_NAME: Record<StoryWhere, string> = {
  settlement: '在聚落裡（任何地方）', cell: '站在聚落的某種設施上', npc: '某位固定 NPC 在身邊', outskirts: '近郊的任務點（⭐）', dungeon: '地下城某一層的任務點（⭐）',
  road: '旅途上（特殊事件開頭的那段路）', side: '臨時地圖裡的任務點（⭐）', special: '特殊地圖裡的任務點（⭐）',
}
export const NODE_KINDS: Record<StoryNode['kind'], string> = { story: '劇情', check: '判定', combat: '戰鬥', choice: '選擇' }
/** 任務點可以指定的設施 */
export const STORY_CELLS: CellKind[] = ['inn', 'guild', 'tavern', 'shop', 'temple', 'gate', 'brothel', 'smithy', 'tailor', 'jeweler', 'magic', 'informant', 'tattoo', 'carver']
export const STORY_LAYERS = DUNGEON_LAYER_IDS
export const LAYER_NAME = DUNGEON_LAYER_NAME
/** 任務的效果可以用的種類 */
export const STORY_EFFECTS: Partial<Record<RewardEffect['type'], string>> = {
  money: '金錢', item: '物品', gear: '裝備', xp: '經驗值', reputation: '聲望', affinity: '親密度', memory: '記憶', ability: '學會能力', companion: '正式入隊', hp: '生命值',
  start_story: '開始特殊任務', enslave_player: '主角淪為奴隸', perk: '特質（取得的機會）', lose_perk: '失去特質', tattoo: '刺青', remove_tattoo: '洗掉刺青',
  condition: '非戰鬥狀態', parasite: '寄生物', corruption: '寄生物的侵蝕度', lewd: '慾望指標', ability_pool: '學會事件庫的技能',
  restrain: '陷阱鎖（鎖上拘束具）',
}
/** 主人事件格式（主人事件、調教、娼館；docs/CONTENT_EDITOR.md）的效果可以用的種類 */
export const MASTER_EVENT_EFFECTS: Partial<Record<RewardEffect['type'], string>> = {
  money: '金錢', item: '物品', xp: '經驗值', affinity: '親密度', memory: '記憶', condition: '非戰鬥狀態', hp: '生命值', tattoo: '刺青',
  lewd: '慾望指標', ability: '學會能力', ability_pool: '學會事件庫的技能', strict: '嚴加看管', home_extend: '延長離家期限', master_home: '帶回主人的家',
  force_equip: '強制裝備', flag: '旗標',
}
/** 可以用效果給予或拿掉的非戰鬥狀態（奴隸印記、逃亡、暫時離隊由程式管理） */
export const EFFECT_CONDITIONS = () => Object.keys(companionRules.conditions).filter((k) => !k.startsWith('$') && !['slave_mark', 'fugitive', 'away'].includes(k))

const isLoc = (id: unknown) => typeof id === 'string' && geography.locations.some((l) => l.id === id)

function check(v: unknown): StoryCheck | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as Partial<StoryCheck>
  const out: StoryCheck = { attr: ATTR_IDS.includes(c.attr as AttrId) ? c.attr! : 'int', dc: int(c.dc, 1, 40, 12) }
  // 參考好感：角色、每幾點 +1、加值上限、門檻
  const a = c.affinity
  if (a && typeof a === 'object' && str(a.npc, 60)) {
    out.affinity = {
      npc: str(a.npc, 60), per: int(a.per, 1, 100, 10), max: int(a.max, 0, 20, 5),
      ...(typeof a.min === 'number' && Number.isFinite(a.min) ? { min: int(a.min, -100, 100, 0) } : {}),
    }
  }
  return out
}

export function sanitizeEffects(v: unknown): RewardEffect[] {
  const out: RewardEffect[] = []
  for (const e of Array.isArray(v) ? v : []) {
    if (!e || typeof e !== 'object') continue
    const x = e as Record<string, unknown>
    switch (x.type) {
      case 'money': {
        const amount = int(x.amount, -1e8, 1e8, 0)
        if (amount) out.push({ type: 'money', amount })
        break
      }
      case 'item': {
        const name = str(x.name, 30)
        const qty = int(x.qty, -99, 99, 1)
        if (name && qty) out.push({ type: 'item', name, qty })
        break
      }
      case 'gear': {
        const spec = sanitizeGearSpecLoose(x.spec as never)
        if (spec) out.push({ type: 'gear', spec, ...(str(x.name, 20) ? { name: str(x.name, 20) } : {}), ...(str(x.desc, 80) ? { desc: str(x.desc, 80) } : {}) })
        break
      }
      case 'xp': {
        const amount = int(x.amount, 0, 1e6, 0)
        // target：只給這個人（主人事件寫 pc）；沒有時全隊
        if (amount) out.push({ type: 'xp', amount, ...(x.target === 'pc' ? { target: 'pc' } : {}) })
        break
      }
      case 'reputation': {
        const delta = int(x.delta, -20, 20, 0)
        if (delta && str(x.faction, 30)) out.push({ type: 'reputation', faction: str(x.faction, 30), delta })
        break
      }
      case 'affinity': {
        const delta = int(x.delta, -50, 50, 0)
        if (delta && str(x.npc, 60)) out.push({ type: 'affinity', npc: str(x.npc, 60), delta, ...(str(x.reason, 40) ? { reason: str(x.reason, 40) } : {}) })
        break
      }
      case 'memory': {
        const summary = str(x.summary, 200)
        if (summary) out.push({ type: 'memory', summary, importance: int(x.importance, 1, 3, 2) as 1 | 2 | 3 })
        break
      }
      case 'ability': {
        const ability = typeof x.ability === 'string' && abilities[x.ability] ? x.ability : undefined
        out.push({ type: 'ability', target: 'pc', ...(ability ? { ability } : { choices: int(x.choices, 1, 5, 3) }) })
        break
      }
      case 'companion': {
        if (str(x.npc, 60)) out.push({ type: 'companion', npc: str(x.npc, 60), mode: x.mode === 'hired' ? 'hired' : 'voluntary' })
        break
      }
      case 'condition': {
        if (typeof x.condition === 'string' && EFFECT_CONDITIONS().includes(x.condition)) out.push({ type: 'condition', target: 'pc', condition: x.condition, add: x.add !== false })
        break
      }
      case 'hp': {
        // 比例（最大生命值）或固定的點數（主人事件用）
        const ratio = Math.round(num(x.ratio, -0.9, 1, 0) * 100) / 100
        const amount = x.ratio === undefined ? int(x.amount, -999, 999, 0) : 0
        if (ratio) out.push({ type: 'hp', target: 'pc', ratio })
        else if (amount) out.push({ type: 'hp', target: 'pc', amount })
        break
      }
      case 'start_story': {
        const id = str(x.story, 80)
        if (id) out.push({ type: 'start_story', story: id })
        break
      }
      case 'perk': {
        // 取得特質的機會：提供的特質（清單裡的 id），可以寫說法交給 AI；direct 直接學會第一個
        const ids = [...new Set([typeof x.perk === 'string' ? x.perk : '', ...strArr(x.options)])].filter((id) => isChoosablePerk(id)).slice(0, 6)
        if (!ids.length) break
        const [first, ...rest] = ids
        out.push({ type: 'perk', perk: first!, ...(rest.length ? { options: rest } : {}), ...(x.direct ? { direct: true } : {}) })
        break
      }
      case 'lose_perk': {
        if (typeof x.perk === 'string' && x.perk) out.push({ type: 'lose_perk', perk: str(x.perk, 60) })
        break
      }
      case 'tattoo': {
        // 圖樣，或自己描述（誓約的加減不合規則就不收）
        const place = isTattooPlace(x.place) ? { place: x.place } : {}
        const by = str(x.by, 20)
        if (typeof x.template === 'string' && tattooTemplate(x.template)) {
          out.push({ type: 'tattoo', template: x.template, ...place, ...(by ? { by } : {}) })
          break
        }
        const kind = x.kind === 'oath' ? 'oath' : 'plain'
        const name = str(x.name, 20)
        if (!name) break
        const attrs = kind === 'oath' && x.attrs && typeof x.attrs === 'object'
          ? Object.fromEntries(ATTR_IDS.map((a) => [a, Math.round(Number((x.attrs as Record<string, unknown>)[a]) || 0)]).filter(([, v]) => v)) as Partial<Record<AttrId, number>>
          : undefined
        if (kind === 'oath' && oathError(attrs)) break
        out.push({ type: 'tattoo', kind, name, text: str(x.text, 160), ...(attrs ? { attrs } : {}), ...place, ...(by ? { by } : {}) })
        break
      }
      case 'parasite': {
        // 寄生物：寄生（add）、馴服（tame）、拿掉（remove）
        if (typeof x.parasite === 'string' && parasiteDef(x.parasite) && ['add', 'tame', 'remove'].includes(x.op as string)) out.push({ type: 'parasite', parasite: x.parasite, op: x.op as 'add' | 'tame' | 'remove' })
        break
      }
      case 'corruption': {
        const delta = Math.round(num(x.delta, -100, 100, 0))
        if (typeof x.parasite === 'string' && parasiteDef(x.parasite) && delta) out.push({ type: 'corruption', parasite: x.parasite, delta })
        break
      }
      case 'lewd': {
        const delta = Math.round(num(x.delta, -100, 100, 0))
        if (LEWD_KEYS.includes(x.stat as LewdKey) && delta) out.push({ type: 'lewd', stat: x.stat as LewdKey, delta, ...(typeof x.target === 'string' && x.target ? { target: x.target } : {}) })
        break
      }
      case 'ability_pool': {
        const pool = (Object.keys(MASTER_EVENT_POOLS) as MasterEventPool[]).includes(x.pool as MasterEventPool) ? x.pool as MasterEventPool : 'master'
        const fallback = sanitizeEffects(x.fallback).filter((y) => y.type !== 'ability_pool')
        out.push({ type: 'ability_pool', pool, ...(typeof x.target === 'string' && x.target ? { target: x.target } : {}), ...(fallback.length ? { fallback } : {}) })
        break
      }
      case 'strict': {
        const delta = int(x.delta, -5, 5, 0)
        if (delta) out.push({ type: 'strict', delta })
        break
      }
      case 'home_extend': {
        const hours = int(x.hours, -240, 240, 0)
        if (hours) out.push({ type: 'home_extend', hours })
        break
      }
      case 'master_home':
        out.push({ type: 'master_home' })
        break
      case 'force_equip': {
        const item = str(x.item, 30)
        out.push({ type: 'force_equip', npc: str(x.npc, 60) || 'master', ...(item ? { item } : {}) })
        break
      }
      case 'restrain': {
        const item = str(x.item, 30)
        const lock = typeof x.lock === 'string' && (LOCK_GRADES as string[]).includes(x.lock) ? x.lock as LockGrade : undefined
        if (item) out.push({ type: 'restrain', item, ...(lock && lock !== 'white' ? { lock } : {}) })
        break
      }
      case 'flag': {
        const key = str(x.key, 40)
        if (key) out.push({ type: 'flag', key, value: typeof x.value === 'number' || typeof x.value === 'string' ? x.value : x.value !== false })
        break
      }
      case 'remove_tattoo': {
        if (isTattooPlace(x.place)) out.push({ type: 'remove_tattoo', place: x.place })
        else if (x.kind === 'plain' || x.kind === 'oath') out.push({ type: 'remove_tattoo', kind: x.kind })
        break
      }
      case 'enslave_player': {
        // 主人：固定 NPC（id），或隨機生成（可以指定身分標籤）；印記是主人打算刻的模板，之後還有刻印檢定
        const contract = typeof x.contract === 'string' && slaveryRules.contracts[x.contract] ? x.contract : slaveryRules.roles.default
        const master = typeof x.master === 'string' ? str(x.master, 60) : ''
        const r = x.random && typeof x.random === 'object' ? x.random as { tag?: unknown } : {}
        const tag = typeof r.tag === 'string' && slaveryRules.master_tags.tags[r.tag] ? r.tag : undefined
        out.push(master ? { type: 'enslave_player', master, contract } : { type: 'enslave_player', random: tag ? { tag } : {}, contract })
        break
      }
    }
  }
  return out
}

/** 整理一個結果（旅途與城鎮事件也用） */
/** 任務結果的親密場景描述的長度上限 */
export const STORY_SCENE_CHARS = 300

export function sanitizeOutcome(v: unknown): StoryOutcome | undefined {
  return outcome(v)
}

function outcome(v: unknown): StoryOutcome | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Partial<StoryOutcome>
  const out: StoryOutcome = {}
  if (str(o.text, 400)) out.text = str(o.text, 400)
  if (str(o.scene, STORY_SCENE_CHARS)) out.scene = str(o.scene, STORY_SCENE_CHARS)
  const set = flags(o.set_flags)
  if (set.length) out.set_flags = set
  const clear = flags(o.clear_flags)
  if (clear.length) out.clear_flags = clear
  const counters = sanitizeCounterDeltas(o.counters)
  if (counters) out.counters = counters
  const deaths = [...new Set((Array.isArray(o.deaths) ? o.deaths : []).map((d) => str(d, 60)).filter(Boolean))]
  if (deaths.length) out.deaths = deaths
  const effects = sanitizeEffects(o.effects)
  if (effects.length) out.effects = effects
  if (str(o.join, 60)) out.join = str(o.join, 60)
  if (str(o.leave, 60)) out.leave = str(o.leave, 60)
  if (o.complete) out.complete = true
  else if (o.fail_quest) out.fail_quest = true
  if (o.retry) out.retry = true
  if (typeof o.side_map === 'string' && SIDE_MAPS().includes(o.side_map)) out.side_map = o.side_map
  if (typeof o.special_map === 'string' && specialMaps[o.special_map]) out.special_map = o.special_map
  if (isLoc(o.travel_to)) out.travel_to = o.travel_to
  const time = timeJump(o.time)
  if (time) out.time = time
  return out
}

/** 結果的時間：經過的小時（整數，最多十天）與推到夜裡或早上 */
function timeJump(v: unknown): StoryOutcome['time'] {
  if (!v || typeof v !== 'object') return undefined
  const t = v as NonNullable<StoryOutcome['time']>
  const out: NonNullable<StoryOutcome['time']> = {}
  const hours = Math.round(Number(t.hours))
  if (Number.isFinite(hours) && hours > 0) out.hours = Math.min(MAX_JUMP_HOURS, hours)
  if (t.until === 'night' || t.until === 'morning') out.until = t.until
  return out.hours || out.until ? out : undefined
}

/** 臨時地圖的種類（travel_events.json 的 side_maps） */
export const SIDE_MAPS = () => Object.keys(travelEvents.side_maps).filter((k) => !k.startsWith('$'))

function place(v: unknown): StoryPlace {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<StoryPlace>
  const where: StoryWhere = (Object.keys(WHERE_NAME) as StoryWhere[]).includes(p.where as StoryWhere) ? p.where! : 'settlement'
  const out: StoryPlace = { where }
  if (isLoc(p.location)) out.location = p.location
  // 設施、自建的商店或城鎮的特色地標（地標要在這個地點）
  if (where === 'cell') out.cell = STORY_CELLS.includes(p.cell as CellKind) || isCustomShopId(p.cell ?? '') || (isLandmarkId(p.cell ?? '') && (!out.location || landmarks[p.cell!]?.location === out.location)) ? p.cell : 'tavern'
  if (where === 'dungeon') out.layer = STORY_LAYERS.includes(p.layer as never) ? p.layer : 'outskirts'
  if (where === 'npc' && str(p.npc, 60)) out.npc = str(p.npc, 60)
  if (where === 'side' && typeof p.side_map === 'string' && SIDE_MAPS().includes(p.side_map)) out.side_map = p.side_map
  if (where === 'special') {
    // 寫錯的名稱照留：storyCheck 會報「特殊地圖不存在」（匯入時整條不收），不換成別張地圖
    if (str(p.special_map, 60)) out.special_map = str(p.special_map, 60)
    // 固定地圖的確切格子（是不是走得到的格子由 storyCheck 提醒，遊戲裡不行時改成隨機）
    const size = out.special_map && specialMaps[out.special_map]?.grid?.length ? mapSize(specialMaps[out.special_map]!) : undefined
    if (size && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x! >= 0 && p.y! >= 0 && p.x! < size[0] && p.y! < size[1]) {
      out.x = p.x
      out.y = p.y
    }
  }
  if (where === 'road' || where === 'side' || where === 'special') delete out.location
  return out
}

function group(v: unknown): EncounterGroup | undefined {
  const g = (Array.isArray(v) ? v : [])
    .filter((x) => Array.isArray(x) && typeof x[0] === 'string')
    .map(([id, n]) => [String(id), int(n, 1, 6, 1)] as [string, number])
  return g.length ? g : undefined
}

function node(v: unknown, i: number, used: Set<string>): StoryNode {
  const n = (v && typeof v === 'object' ? v : {}) as Partial<StoryNode>
  let id = cleanId(n.id, `n${i + 1}`)
  while (used.has(id)) id = `${id}_`
  used.add(id)
  const kind = (Object.keys(NODE_KINDS) as StoryNode['kind'][]).includes(n.kind as never) ? n.kind! : 'story'
  const out: StoryNode = { id, title: str(n.title, 40) || '新的任務點', text: str(n.text, 600), at: place(n.at), kind }
  const req = sanitizeCond(n.requires) as StoryCond | undefined
  if (req) out.requires = req
  const wear = [...new Set((Array.isArray(n.wear) ? n.wear : []).map((w) => str(w, 60)).filter(Boolean))].slice(0, 6)
  if (wear.length) out.wear = wear
  const allies = (n.allies ?? []).map((a) => str(a, 60)).filter(Boolean)
  if (allies.length) out.allies = [...new Set(allies)]
  if (n.urgent) out.urgent = true
  // 旅途上與臨時地圖裡的任務點不限時段（旅途不能停下來等、離開臨時地圖等於放棄）
  if ((n.hours === 'day' || n.hours === 'night') && out.at.where !== 'road' && out.at.where !== 'side') out.hours = n.hours
  if (kind === 'check') out.check = check(n.check) ?? { attr: 'int', dc: 12 }
  if (kind === 'combat') {
    const g = group(n.enemies)
    if (g) out.enemies = g
    const foes = (n.foes ?? []).map((f) => str(f, 60)).filter(Boolean)
    if (foes.length) out.foes = [...new Set(foes)]
  }
  if (kind === 'choice') {
    out.options = (n.options ?? []).slice(0, 10).map((o): StoryOption => {
      const c = check(o?.check)
      const s = outcome(o?.success)
      const f = outcome(o?.fail)
      const r = sanitizeCond(o?.requires) as StoryCond | undefined
      const tags = contentTags(o?.tags)
      return { label: str(o?.label, 30) || '選項', ...(tags ? { tags } : {}), ...(r ? { requires: r } : {}), ...(c ? { check: c } : {}), ...(s ? { success: s } : {}), ...(c && f ? { fail: f } : {}) }
    })
  } else {
    const s = outcome(n.success)
    if (s) out.success = s
    const f = kind === 'check' || kind === 'combat' ? outcome(n.fail) : undefined
    if (f) out.fail = f
  }
  return out
}

/** 內容標籤：CONTENT_TAGS 裡的，依固定順序 */
function contentTags(v: unknown): string[] | undefined {
  const tags = CONTENT_TAG_IDS.filter((t) => Array.isArray(v) && v.includes(t))
  return tags.length ? tags : undefined
}

function start(v: unknown): StoryStart {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<StoryStart>
  const kind: StoryStartKind = (Object.keys(START_KINDS) as StoryStartKind[]).includes(s.kind as StoryStartKind) ? s.kind! : 'guild'
  const out: StoryStart = { kind }
  if (isLoc(s.location) && (kind === 'guild' || kind === 'informant')) out.location = s.location
  if (kind === 'npc' && str(s.npc, 60)) out.npc = str(s.npc, 60)
  if (kind === 'npc' && typeof s.min_affinity === 'number' && Number.isFinite(s.min_affinity)) out.min_affinity = int(s.min_affinity, -100, 100, 0)
  if (kind === 'travel') {
    out.chance = Math.round(num(s.chance, 0.01, 1, 0.2) * 100) / 100
    const regions = (s.regions ?? []).filter((r) => geography.regions.some((g) => g.id === r))
    if (regions.length) out.regions = regions
  }
  if (kind === 'informant') out.price = int(s.price, 0, 1e7, 100)
  if (s.min_level) out.min_level = int(s.min_level, 1, 20, 1)
  const bodies = (['masc', 'fem', 'andro'] as const).filter((b) => Array.isArray(s.pc_body) && s.pc_body.includes(b))
  if (bodies.length && bodies.length < 3) out.pc_body = bodies
  const req = sanitizeCond(s.requires) as StoryCond | undefined
  if (req) out.requires = req
  if (str(s.text, 400)) out.text = str(s.text, 400)
  const items = [...new Set((Array.isArray(s.items) ? s.items : []).map((i) => str(i, 60)).filter(Boolean))].slice(0, 6)
  if (items.length) out.items = items
  return out
}

export function sanitizeStory(id: string, raw: Partial<StoryMod>, custom: boolean): StoryMod {
  const used = new Set<string>()
  const out: StoryMod = {
    id,
    title: str(raw.title, 30) || '新的特殊任務',
    summary: str(raw.summary, 300),
    start: start(raw.start),
    nodes: (raw.nodes ?? []).slice(0, 60).map((n, i) => node(n, i, used)),
  }
  const tags = contentTags(raw.tags)
  if (tags) out.tags = tags
  if (raw.rank && RANK_ORDER.includes(raw.rank)) out.rank = raw.rank
  // 完成時的公會功績：空白時用預設（progression.json 的 guild_merit.story）
  if (raw.merit !== undefined && raw.merit !== null && String(raw.merit) !== '') out.merit = Math.round(num(raw.merit, 0, 100, 0))
  // 期限（天）：空白或 0 是不限
  const limit = Math.round(num(raw.time_limit, 0, 365, 0))
  if (limit > 0) out.time_limit = limit
  const sf = flags(raw.start_flags)
  if (sf.length) out.start_flags = sf
  const rewards = sanitizeEffects(raw.rewards)
  if (rewards.length) out.rewards = rewards
  if (custom) out.custom = true
  return out
}

export function newStory(id: string): StoryMod {
  return {
    id, title: '新的特殊任務', summary: '', start: { kind: 'guild', location: 'soriel' }, start_flags: [`${id}_started`],
    nodes: [{ id: 'n1', title: '第一個任務點', text: '', at: { where: 'cell', location: 'soriel', cell: 'tavern' }, kind: 'story', requires: { flags: [`${id}_started`] }, success: { complete: true } }],
    custom: true,
  }
}

export function newNode(def: StoryDef): StoryNode {
  let i = def.nodes.length + 1
  while (def.nodes.some((n) => n.id === `n${i}`)) i++
  return { id: `n${i}`, title: '新的任務點', text: '', at: { where: 'settlement', ...(def.start.location ? { location: def.start.location } : {}) }, kind: 'story' }
}

// ---- 檢查任務鏈 ----

export interface FlagUse { flag: string; setBy: string[]; clearedBy: string[]; requiredBy: string[]; blockedBy: string[] }

function outcomesOf(n: StoryNode): { label: string; o: StoryOutcome }[] {
  const out: { label: string; o: StoryOutcome }[] = []
  if (n.success) out.push({ label: n.kind === 'combat' ? '勝利' : '成功', o: n.success })
  if (n.fail) out.push({ label: n.kind === 'combat' ? '落敗' : '失敗', o: n.fail })
  for (const opt of n.options ?? []) {
    if (opt.success) out.push({ label: `「${opt.label}」${opt.check ? '成功' : ''}`, o: opt.success })
    if (opt.fail) out.push({ label: `「${opt.label}」失敗`, o: opt.fail })
  }
  return out
}

/** 每個旗標：誰設定、誰清除、誰需要、誰需要它不成立 */
export function flagUsage(def: StoryDef): FlagUse[] {
  const map = new Map<string, FlagUse>()
  const get = (f: string) => {
    let u = map.get(f)
    if (!u) map.set(f, (u = { flag: f, setBy: [], clearedBy: [], requiredBy: [], blockedBy: [] }))
    return u
  }
  for (const f of def.start_flags ?? []) get(f).setBy.push('任務開始')
  for (const f of def.start.requires?.flags ?? []) get(f).requiredBy.push('接取條件')
  for (const f of def.start.requires?.flags_none ?? []) get(f).blockedBy.push('接取條件')
  for (const f of def.start.requires?.flags_any ?? []) get(f).requiredBy.push('接取條件（之一）')
  for (const n of def.nodes) {
    for (const f of n.requires?.flags ?? []) get(f).requiredBy.push(n.title)
    for (const f of n.requires?.flags_any ?? []) get(f).requiredBy.push(`${n.title}（之一）`)
    for (const f of n.requires?.flags_none ?? []) get(f).blockedBy.push(n.title)
    for (const { label, o } of outcomesOf(n)) {
      for (const f of o.set_flags ?? []) get(f).setBy.push(`${n.title}・${label}`)
      for (const f of o.clear_flags ?? []) get(f).clearedBy.push(`${n.title}・${label}`)
    }
  }
  return [...map.values()].sort((a, b) => a.flag.localeCompare(b.flag))
}

/** 這個聚落有沒有這種設施 */
/** 聚落有沒有這種設施（任何一個區塊） */
export function hasFacility(location: string, kind: CellKind): boolean {
  return blockKeys(location).some((k) => settlementArea(k)?.cells.some((c) => c.kind === kind))
}

/**
 * 任務鏈的問題（docs/CONTENT_DEPENDENCIES.md）：
 * - errors：一定會壞的（引用的東西不存在、沒有結果會完成任務、地點類型不對、設施不存在、戰鬥沒有敵人、
 *   選擇沒有選項、開頭旗標和別的任務重複、效果開始自己），擋儲存與匯入
 * - warnings：可能沒問題的（需要的旗標沒有地方設定——可能來自 AI 或別的任務；只由其他事件開啟卻沒人開啟），只提醒
 */
export interface StoryProblems { errors: string[]; warnings: string[] }

export function storyCheck(def: StoryDef, others: StoryDef[] = stories): StoryProblems {
  const err: string[] = []
  const warn: string[] = []
  const npcIds = new Set(namedNpcs.map((n) => n.id))
  const externalSets = new Set(others.filter((s) => s.id !== def.id).flatMap((s) => [...(s.start_flags ?? []), ...s.nodes.flatMap((n) => outcomesOf(n).flatMap(({ o }) => o.set_flags ?? []))]))
  const usage = flagUsage(def)
  for (const u of usage) {
    // ai: 開頭的由 AI 判定設定；park_stamp_ 開頭的由引擎在打倒園區的最終層主時設定
    if (u.requiredBy.length && !u.setBy.length && !u.flag.startsWith('ai:') && !u.flag.startsWith(PARK_STAMP_PREFIX) && !externalSets.has(u.flag)) {
      warn.push(`旗標 🚩${u.flag} 在任務裡沒有地方會設定（可能由 AI 判定或其他任務設定），否則需要它的「${u.requiredBy.join('」「')}」不會出現`)
    }
  }
  if (!def.nodes.some((n) => outcomesOf(n).some(({ o }) => o.complete))) err.push('沒有任何結果會完成任務（勾選「完成任務」）')
  if (def.start.kind === 'npc' && (!def.start.npc || !npcIds.has(def.start.npc))) err.push('開頭的固定 NPC 不存在')
  if ((def.start.kind === 'guild') && !def.start.location) err.push('沒有指定哪座城鎮的公會')
  if (def.start.kind === 'guild' && def.start.location && !hasFacility(def.start.location, 'guild')) err.push('開頭的城鎮沒有冒險者公會')
  if (def.start.kind === 'informant' && def.start.location && !hasFacility(def.start.location, 'informant')) err.push('開頭的城鎮沒有情報商')
  // 開頭的旗標和其他任務一樣（例如複製來的任務）：兩個任務會互相觸發對方的任務點
  for (const f of def.start_flags ?? []) {
    const other = others.find((s) => s.id !== def.id && (s.start_flags ?? []).includes(f))
    if (other) err.push(`開頭的旗標 🚩${f} 也是「${other.title}」的開頭旗標，兩個任務的任務點會互相觸發（請改名）`)
  }
  // 親密場景只在成人向的任務裡
  if (!(def.tags ?? []).includes('adult') && def.nodes.some((n) => outcomesOf(n).some(({ o }) => o.scene))) err.push('有結果寫了親密場景，但任務沒有標「成人向」')
  // 故事裡死去的角色要是固定 NPC
  for (const n of def.nodes) for (const { o } of outcomesOf(n)) for (const d of o.deaths ?? []) if (!npcIds.has(d)) err.push(`「${n.title}」的結果裡死去的角色 ${d} 不存在`)
  // 用到的劇情計數器要存在
  const counterIds = new Set([
    ...Object.keys(def.start.requires?.counters ?? {}),
    ...def.nodes.flatMap((n) => [...Object.keys(n.requires?.counters ?? {}), ...(n.options ?? []).flatMap((o) => Object.keys(o.requires?.counters ?? {})), ...outcomesOf(n).flatMap(({ o }) => Object.keys(o.counters ?? {}))]),
  ])
  for (const id of counterIds) if (!storyCounters[id]) err.push(`劇情計數器 ${id} 不存在（在「🔢 劇情計數器」新增）`)
  // 效果裡用到的東西要存在
  const effects = [...(def.rewards ?? []), ...def.nodes.flatMap((n) => outcomesOf(n).flatMap(({ o }) => o.effects ?? []))]
  for (const e of effects) {
    if (e.type === 'item' && e.qty > 0 && !itemDef(e.name)) err.push(`效果裡的物品「${e.name}」不存在`)
    if (e.type === 'gear' && !gearKnown(e.spec)) err.push('效果裡的裝備：底材或材料不存在')
    if ((e.type === 'affinity' || e.type === 'companion') && typeof e.npc === 'string' && e.npc !== 'keeper' && e.npc !== 'party' && !npcIds.has(e.npc)) {
      err.push(`效果裡的角色 ${e.npc} 不存在`)
    }
    if (e.type === 'start_story' && !others.some((s) => s.id === e.story)) err.push(`效果要開始的特殊任務 ${e.story} 不存在`)
    if (e.type === 'enslave_player' && typeof e.master === 'string' && !npcIds.has(e.master)) err.push(`效果裡的主人 ${e.master} 不存在`)
    if (e.type === 'perk') for (const id of [e.perk, ...(e.options ?? [])]) if (id && !perkDef(id)) err.push(`效果裡的特質 ${id} 不存在`)
    if (e.type === 'start_story' && e.story === def.id) err.push('效果要開始的是這個任務自己')
  }
  // 「某個任務（任務點）結束後幾天」：那個任務、任務點要存在
  const conds = [def.start.requires, ...def.nodes.flatMap((n) => [n.requires, ...(n.options ?? []).map((o) => o.requires)])]
  for (const a of conds.map((c) => c?.after).filter((x): x is NonNullable<StoryCond['after']> => !!x)) {
    const target = a.story === def.id ? def : others.find((x) => x.id === a.story)
    if (!target) err.push(`條件「${a.story} 結束後 ${a.days} 天」的特殊任務不存在`)
    else if (a.node && !target.nodes.some((n) => n.id === a.node)) err.push(`條件「${target.title}的 ${a.node} 結束後 ${a.days} 天」的任務點不存在`)
  }
  for (const name of def.start.items ?? []) if (!itemDef(name)) err.push(`接下任務時拿到的物品「${name}」不存在`)
  for (const n of def.nodes) for (const w of n.wear ?? []) {
    if (!itemDef(w) && !gearRules.bases[w]) err.push(`任務點「${n.title}」限定的穿著「${w}」不是物品，也不是裝備底材`)
    else if (itemDef(w) && !itemDef(w)!.gear) err.push(`任務點「${n.title}」限定的穿著「${w}」不是裝備`)
  }
  if (def.start.kind === 'manual') {
    const starters = others.filter((s) => s.id !== def.id && [...(s.rewards ?? []), ...s.nodes.flatMap((n) => outcomesOf(n).flatMap(({ o }) => o.effects ?? []))]
      .some((e) => e.type === 'start_story' && e.story === def.id))
    if (!starters.length) warn.push('開頭是「只由其他事件開啟」，但沒有任何任務用「開始特殊任務」效果開啟它')
  }
  for (const n of def.nodes) {
    const t = `任務點「${n.title}」`
    if (n.at.where !== 'npc' && n.at.where !== 'road' && n.at.where !== 'side' && n.at.where !== 'special' && !n.at.location) err.push(`${t}沒有指定地點`)
    if (n.at.where === 'special' && (!n.at.special_map || !specialMaps[n.at.special_map])) err.push(`${t}的特殊地圖不存在`)
    else if (n.at.where === 'special' && n.at.x !== undefined && n.at.y !== undefined) {
      const why = storySpotProblem(n.at.special_map!, n.at.x, n.at.y)
      if (why) warn.push(`${t}指定的格子（${n.at.x}, ${n.at.y}）：${why}，遊戲裡會隨機放在一格空地`)
    }
    if (n.at.where === 'npc' && (!n.at.npc || !npcIds.has(n.at.npc))) err.push(`${t}的固定 NPC 不存在`)
    if (n.at.where === 'outskirts' && n.at.location && geography.locations.find((l) => l.id === n.at.location)?.type === 'dungeon') err.push(`${t}：地下城沒有近郊，請改成「地下城某一層」`)
    if (n.at.where === 'dungeon' && n.at.location && geography.locations.find((l) => l.id === n.at.location)?.type !== 'dungeon') err.push(`${t}：選的地點不是地下城`)
    if ((n.at.where === 'settlement' || n.at.where === 'cell') && n.at.location && geography.locations.find((l) => l.id === n.at.location)?.type === 'dungeon') err.push(`${t}：選的地點不是聚落`)
    if (n.kind === 'combat' && !n.enemies?.length && !n.foes?.length) err.push(`${t}是戰鬥，但沒有敵人`)
    for (const [id] of n.enemies ?? []) if (!enemies[id]) err.push(`${t}的怪物 ${id} 不存在`)
    for (const id of n.foes ?? []) if (!npcIds.has(id)) err.push(`${t}的敵對角色 ${id} 不存在`)
    for (const id of n.allies ?? []) if (!npcIds.has(id)) err.push(`${t}的友方角色 ${id} 不存在`)
    for (const id of n.allies ?? []) if (n.foes?.includes(id)) err.push(`${t}：${id} 同時是友方與敵對角色`)
    if (n.kind === 'choice' && !n.options?.length) err.push(`${t}是選擇，但沒有選項`)
    // 每個選項都帶了任務本身沒有的內容標籤：玩家在設定關掉那些標籤時，這個任務點沒有選項可選
    if (n.kind === 'choice' && n.options?.length && n.options.every((o) => (o.tags ?? []).some((tag) => !def.tags?.includes(tag)))) {
      warn.push(`${t}的每個選項都有內容標籤，設定關掉這些標籤時沒有選項可選（請留一個沒有標籤的選項）`)
    }
    // 參考好感、好感條件的角色要存在
    for (const id of Object.keys(n.requires?.affinity ?? {})) if (!npcIds.has(id)) err.push(`${t}的好感條件：角色 ${id} 不存在`)
    if (n.check?.affinity && !npcIds.has(n.check.affinity.npc)) err.push(`${t}的檢定參考的角色 ${n.check.affinity.npc} 不存在`)
    for (const o of n.options ?? []) {
      for (const id of Object.keys(o.requires?.affinity ?? {})) if (!npcIds.has(id)) err.push(`${t}的選項「${o.label}」的好感條件：角色 ${id} 不存在`)
      if (o.check?.affinity && !npcIds.has(o.check.affinity.npc)) err.push(`${t}的選項「${o.label}」參考的角色 ${o.check.affinity.npc} 不存在`)
    }
    for (const { o } of outcomesOf(n)) {
      if (o.join && !npcIds.has(o.join)) err.push(`${t}要同行的角色 ${o.join} 不存在`)
      if (o.leave && !npcIds.has(o.leave)) err.push(`${t}要離開的角色 ${o.leave} 不存在`)
      if (o.join && o.complete) warn.push(`${t}的結果同時「同行」和「完成任務」：任務完成時同行的角色會馬上離開（要讓角色留在隊上，請改用「正式入隊」效果）`)
    }
    if (n.at.where === 'cell' && n.at.cell && !(n.at.cell in CELL_NAME) && !shopRules.types[n.at.cell as ShopType] && !landmarks[n.at.cell]) err.push(`${t}的設施不存在`)
    else if (n.at.where === 'cell' && n.at.cell && n.at.location && !hasFacility(n.at.location, n.at.cell as CellKind)) {
      err.push(`${t}：${geography.locations.find((l) => l.id === n.at.location)?.name ?? n.at.location}沒有${CELL_NAME[n.at.cell as CellKind] ?? n.at.cell}`)
    }
  }
  // 可達性（storyReach.ts）：到不了的任務點、走不到完成、選了會卡住的結果（寬鬆的估計，只提醒）
  const reach = storyReach(def)
  const title = (id: string) => def.nodes.find((n) => n.id === id)?.title ?? id
  for (const id of reach.unreachable) warn.push(`任務點「${title(id)}」不會解鎖：需要的旗標在這個任務裡怎麼走都設定不到`)
  if (!reach.canComplete && def.nodes.some((n) => outcomesOf(n).some(({ o }) => o.complete))) warn.push('沒有任何一條路走得到「完成任務」：會完成任務的任務點都不會解鎖')
  for (const x of reach.stuck) warn.push(`任務點「${title(x.node)}」${x.label.startsWith('「') ? `選${x.label}` : `的結果「${x.label}」`}之後，可能沒有任務點可以進行（任務沒完成也沒失敗，只能放棄）`)
  return { errors: err, warnings: warn }
}

/** 所有問題（錯誤在前） */
export function storyIssues(def: StoryDef, others: StoryDef[] = stories): string[] {
  const c = storyCheck(def, others)
  return [...c.errors, ...c.warnings]
}

/**
 * 目前的存檔正在進行這個任務時，這次修改會不會弄壞它的進度（擋儲存）：
 * - 完成過的任務點 id 被改掉或刪掉
 * - 修改前還有解鎖、沒完成的任務點，修改後一個都沒有，而且其他進行中任務解鎖的任務點也沒有結果會設定（或清除）它們缺的旗標
 * 回傳原因；沒有問題（或存檔沒在進行這個任務）時是空陣列。
 */
export function progressBreaks(state: GameState, before: StoryDef | undefined, after: StoryDef): string[] {
  const p = state.stories?.[after.id]
  if (!p || p.status !== 'active') return []
  const out: string[] = []
  for (const id of p.done) {
    if (after.nodes.some((n) => n.id === id)) continue
    const title = before?.nodes.find((n) => n.id === id)?.title
    out.push(`完成過的任務點${title ? `「${title}」` : ''}（id ${id}）被改名或刪除了：這個存檔記錄的進度會對不上`)
  }
  const open = (d: StoryDef) => d.nodes.filter((n) => !p.done.includes(n.id) && condMet(state, n.requires))
  if (before && open(before).length && !open(after).length) {
    const sets = new Set<string>()
    const clears = new Set<string>()
    for (const q of Object.values(state.stories ?? {})) {
      if (q.status !== 'active' || q.id === after.id) continue
      const d = stories.find((s) => s.id === q.id)
      for (const n of d?.nodes ?? []) {
        if (q.done.includes(n.id) || !condMet(state, n.requires)) continue
        for (const { o } of outcomesOf(n)) {
          for (const f of o.set_flags ?? []) sets.add(f)
          for (const f of o.clear_flags ?? []) clears.add(f)
        }
      }
    }
    const later = after.nodes.some((n) => !p.done.includes(n.id)
      && (n.requires?.flags ?? []).every((f) => hasFlag(state, f) || sets.has(f) || f.startsWith('ai:'))
      && (n.requires?.flags_none ?? []).every((f) => !hasFlag(state, f) || clears.has(f)))
    if (!later) out.push('修改後，這個存檔的任務沒有任何能進行的任務點，其他進行中的任務也不會設定它們需要的旗標：任務會卡住')
  }
  return out
}

/** 複製成新任務：開頭旗標換成新任務自己的（不然兩個任務會互相觸發），其他內容照抄 */
export function copyStory(src: StoryDef, id: string, title = `${src.title}（複製）`): StoryMod {
  const map = new Map<string, string>()
  for (const f of src.start_flags ?? []) {
    map.set(f, (f.startsWith(src.id) ? `${id}${f.slice(src.id.length)}` : `${id}_${f}`).slice(0, 40))
  }
  const ren = (list?: string[]) => list?.map((f) => map.get(f) ?? f)
  const cond = (c?: StoryCond) => c && { ...c, ...(c.flags ? { flags: ren(c.flags) } : {}), ...(c.flags_none ? { flags_none: ren(c.flags_none) } : {}), ...(c.flags_any ? { flags_any: ren(c.flags_any) } : {}) }
  const outcome = (o?: StoryOutcome) => o && { ...o, ...(o.set_flags ? { set_flags: ren(o.set_flags) } : {}), ...(o.clear_flags ? { clear_flags: ren(o.clear_flags) } : {}) }
  const copy = clone(src) as StoryMod
  copy.id = id
  copy.title = title.slice(0, 30)
  copy.custom = true
  if (copy.start_flags) copy.start_flags = ren(copy.start_flags)
  if (copy.start.requires) copy.start.requires = cond(copy.start.requires)
  copy.nodes = copy.nodes.map((n) => ({
    ...n,
    ...(n.requires ? { requires: cond(n.requires) } : {}),
    ...(n.success ? { success: outcome(n.success) } : {}),
    ...(n.fail ? { fail: outcome(n.fail) } : {}),
    ...(n.options ? { options: n.options.map((o) => ({ ...o, ...(o.success ? { success: outcome(o.success) } : {}), ...(o.fail ? { fail: outcome(o.fail) } : {}) })) } : {}),
  }))
  return copy
}
