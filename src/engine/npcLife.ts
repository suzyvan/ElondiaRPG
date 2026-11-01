// NPC 自己的日子（docs/NPC_SYSTEM.md「NPC 自己的日子」）：玩家在乎的冒險者，不在隊上時也會成長。
//
// - 誰：玩家「關注」的人、留在家裡或寄放在酒館的夥伴、離隊的夥伴（角色資料存在 NpcRecord.character），
//   以及好感達到 AFFINITY_MIN 的冒險者。要有戰鬥職業；死了、敵對、被制伏、在隊上的不算。
// - 什麼時候：每 X 天（設定，預設 3）擲一次；跨過幾次就擲幾次（最多 MAX_CATCH_UP 次，再久的直接跳過）。
//   用「角色 id＋那一次的日子」的固定亂數：回退、重讀都一樣。
// - 擲什麼：這段時間去了哪裡做什麼（一定有）；升級（上限是主角的等級；固定 NPC 不升級）、換一件武器或護甲、
//   受了點傷去休養（只是近況，不影響什麼，隨時可以找他）。
// - 近況記在 state.npcLife.news（每人最多 NEWS_KEEP 則）：規則寫的短句，AI 開啟時另外潤飾成一段（story）。
//   交給 AI 的人際關係裡附上最近的近況（social.ts 的 formatContext），重逢時 AI 會知道。
// 引擎不讀設定：畫面套用設定時呼叫 setNpcLife。

import { gainXp, xpToNext } from './character'
import { classDef, geography, locationById, npcs as namedNpcs } from './data'
import { gearName, generateLoadout, syncGear } from './gear'
import { characterFor, hashString, npcRecord, registerNpc } from './npcs'
import { isNoncombatant } from './party'
import { Rng } from './rng'
import { attributeRules } from './data'
import type { Character, GameState, GearSlot, NpcLifeState, NpcNews, NpcRecord } from './types'

export type { NpcLifeState, NpcNews }

/** 好感到這裡的冒險者也算在乎的人（不用手動關注） */
export const AFFINITY_MIN = 30
/** 每人保留幾則近況 */
export const NEWS_KEEP = 6
/** 一次最多補擲幾次（離開很久再回來：太久之前的直接跳過） */
export const MAX_CATCH_UP = 10

// ---- 設定（畫面呼叫） ----

let enabled = true
let everyDays = 3

export function setNpcLife(opts: { on?: boolean; days?: number }) {
  if (opts.on !== undefined) enabled = opts.on
  if (opts.days !== undefined && Number.isFinite(opts.days)) everyDays = Math.max(1, Math.min(30, Math.round(opts.days)))
}

export function npcLifeOn(): boolean {
  return enabled
}

export function npcLifeDays(): number {
  return everyDays
}

// ---- 誰 ----

function lifeOf(state: GameState): NpcLifeState {
  return (state.npcLife ??= { last: state.time.day, news: {} })
}

export function isFollowed(state: GameState, id: string): boolean {
  return !!state.npcLife?.followed?.includes(id)
}

/** 關注／取消關注（冒險者才能關注） */
export function setFollowed(state: GameState, id: string, on: boolean) {
  const rec = npcRecord(state, id)
  if (on && (!rec || !canLive(rec))) throw new Error('只有冒險者會自己成長')
  const life = lifeOf(state)
  const list = new Set(life.followed ?? [])
  if (on) list.add(id)
  else list.delete(id)
  life.followed = [...list]
  if (!life.followed.length) delete life.followed
}

/** 有戰鬥職業的冒險者（普通人、無法戰鬥的不算） */
export function canLive(rec: NpcRecord): boolean {
  const cls = rec.character?.class ?? rec.class
  return !!cls && !isNoncombatant({ class: cls })
}

/** 現在會自己成長的人 */
export function livingNpcs(state: GameState): NpcRecord[] {
  const ids = new Set([
    ...Object.keys(state.relationships ?? {}),
    ...(state.npcLife?.followed ?? []),
    ...Object.values(state.npcs ?? {}).filter((r) => r.character).map((r) => r.id),
  ])
  const inParty = new Set(state.party.map((m) => m.id))
  const out: NpcRecord[] = []
  for (const id of ids) {
    if (inParty.has(id) || state.captives?.npcs.includes(id)) continue
    const rec = npcRecord(state, id)
    if (!rec || rec.dead || rec.hostile || !canLive(rec)) continue
    const cared = isFollowed(state, id) || !!rec.character || (state.relationships?.[id]?.affinity ?? 0) >= AFFINITY_MIN
    if (cared) out.push(rec)
  }
  return out
}

// ---- 擲骰 ----

/**
 * 時間過了：每 X 天替會自己成長的人擲一次。回傳這次新增近況的人（id）。
 * 第一次呼叫只記下今天（不補擲遊戲開始以前的日子）
 */
export function tickNpcLife(state: GameState): string[] {
  if (!enabled) return []
  const first = !state.npcLife
  const life = lifeOf(state)
  if (first) return []
  const changed = new Set<string>()
  let rolls = 0
  while (state.time.day - life.last >= everyDays) {
    if (rolls >= MAX_CATCH_UP) {
      life.last = state.time.day
      break
    }
    life.last += everyDays
    rolls++
    for (const rec of livingNpcs(state)) {
      if (rollOnce(state, rec, life.last)) changed.add(rec.id)
    }
  }
  return [...changed]
}

const ACTIVITIES = ['討伐魔物', '接了護衛委託', '探索', '找委託做', '和人組隊打獵']
const RESTS = ['受了點傷', '扭傷了腳', '連日奔波累倒了']

function isFixed(id: string): boolean {
  return namedNpcs.some((n) => n.id === id)
}

/** 存檔裡的紀錄（固定 NPC 還沒登場時先複製進存檔，不改到內容資料） */
function storedRecord(state: GameState, rec: NpcRecord): NpcRecord {
  return state.npcs?.[rec.id] ?? registerNpc(state, JSON.parse(JSON.stringify(rec)) as NpcRecord)
}

/** 去了哪裡：同一個地區的地下城或城鎮 */
function placeFor(rng: Rng, rec: NpcRecord): { name: string; dungeon: boolean } {
  const home = rec.location ? geography.locations.find((l) => l.id === rec.location) : undefined
  const region = home?.region
  const near = geography.locations.filter((l) => l.region === region)
  const dungeons = near.filter((l) => l.type === 'dungeon')
  if (dungeons.length && rng.chance(0.5)) return { name: rng.pick(dungeons).name, dungeon: true }
  const towns = near.filter((l) => l.type !== 'dungeon')
  const t = towns.length ? rng.pick(towns) : home
  return { name: t ? `${t.name}近郊` : '附近', dungeon: false }
}

/** 替一個人擲一次：寫進近況，有升級、換裝時改他的角色資料。回傳有沒有新的近況 */
export function rollOnce(state: GameState, rec0: NpcRecord, day: number): boolean {
  const rng = new Rng(hashString(`${rec0.id}:life:${day}`))
  const fixed = isFixed(rec0.id)
  const pcLevel = state.party.find((m) => m.isPlayer)?.level ?? 1
  const scale = Math.min(3, everyDays / 3)
  const place = placeFor(rng, rec0)
  const news: NpcNews = { day, text: '', place: place.name }
  const parts: string[] = [`${place.dungeon ? `去了${place.name}` : `在${place.name}`}${rng.pick(ACTIVITIES)}`]
  let c: Character | undefined
  const character = () => {
    if (c) return c
    const rec = storedRecord(state, rec0)
    rec.character ??= characterFor(state, rec)
    c = rec.character
    return c
  }
  // 升級：上限是主角的等級；固定 NPC 不升級（等級寫在資料裡，任務的戰鬥照那個設計）
  if (!fixed && (rec0.character?.level ?? rec0.level) < pcLevel && rng.chance(Math.min(0.9, 0.35 * scale))) {
    const ch = character()
    gainXp(ch, Math.max(1, xpToNext(ch.level) - ch.xp), rng)
    settleLevelUp(ch)
    storedRecord(state, rec0).level = ch.level
    news.level = ch.level
    parts.push(`升到 Lv.${ch.level}`)
  }
  // 換一件武器或護甲（照現在的等級）
  if (rng.chance(Math.min(0.6, 0.2 * scale))) {
    const ch = character()
    const loadout = generateLoadout(ch.class, ch.level, rng, ch.race)
    const slots = (['main_hand', 'body'] as GearSlot[]).filter((s) => loadout[s] && loadout[s]!.name !== ch.gear?.[s]?.name)
    if (slots.length) {
      const slot = rng.pick(slots)
      ;(ch.gear ??= {})[slot] = loadout[slot]
      syncGear(ch, classDef(ch.class).weapon)
      news.gear = gearName(loadout[slot]!.spec)
      parts.push(`換上了${news.gear}`)
    }
  }
  // 受了點傷，休養幾天（只是近況：隨時可以找他）
  if (rng.chance(Math.min(0.4, 0.12 * scale))) {
    const town = rec0.location ? locationById(rec0.location).name : '城裡'
    news.rest = town
    parts.push(`${rng.pick(RESTS)}，在${town}休養了幾天`)
  }
  news.text = `${parts.join('，')}。`
  const life = lifeOf(state)
  const list = (life.news[rec0.id] ??= [])
  list.push(news)
  if (list.length > NEWS_KEEP) list.splice(0, list.length - NEWS_KEEP)
  return true
}

/** NPC 升級時自己做的選擇：能力挑第一個、屬性點加在職業的主屬性（和生成 NPC 一樣） */
function settleLevelUp(c: Character) {
  for (const choices of c.pendingAbilityChoices ?? []) if (choices[0] && !c.abilities.includes(choices[0])) c.abilities.push(choices[0])
  delete c.pendingAbilityChoices
  const main = classDef(c.class).priority[0]
  if (main && c.attrPoints > 0) {
    c.attrs[main] = Math.min(attributeRules.score.max, c.attrs[main] + c.attrPoints)
    c.attrPoints = 0
  }
}

// ---- 近況 ----

export function newsOf(state: GameState, id: string): NpcNews[] {
  return state.npcLife?.news[id] ?? []
}

/** 給 AI 與畫面的近況文字：潤飾過的優先 */
export function newsText(n: NpcNews): string {
  return n.story ?? n.text
}

/** 寫進 AI 潤飾的近況（id → 第幾天 → 文字）；找不到的略過 */
export function applyNewsStories(state: GameState, stories: { id: string; day: number; story: string }[]) {
  for (const s of stories) {
    const n = state.npcLife?.news[s.id]?.find((x) => x.day === s.day)
    const text = typeof s.story === 'string' ? s.story.trim().slice(0, 400) : ''
    if (n && text) n.story = text
  }
}

/** 還沒潤飾的近況（AI 潤飾用）：只看這些人 */
export function unpolished(state: GameState, ids: string[]): { id: string; news: NpcNews }[] {
  return ids.flatMap((id) => newsOf(state, id).filter((n) => !n.story).map((news) => ({ id, news })))
}
