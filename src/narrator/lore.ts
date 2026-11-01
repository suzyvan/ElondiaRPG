// 世界書：把世界書檔案的條目整理成可以調整的清單，再依報告或行動挑選要注入的條目。
// 世界書正文是簡體、遊戲資料是繁體，比對關鍵字前先把文字轉成簡體（兩種寫法都比對）。
//
// 每個條目有一種注入方式：
//   constant 常駐：每次都注入，放在 system 前段（不太變動，可以被快取）
//   keyword  關鍵字：報告或行動的文字命中關鍵字時注入，放在 user 後段
//   travel   旅行：只有旅行報告注入
//   off      停用
// 預設值依下面的常數決定；玩家可以在「提示詞」頁籤覆寫（見 src/stores/prompts.ts）。

import { Converter } from 'opencc-js/t2cn'
import type { Report } from '@/engine/types'

export interface WorldbookEntry {
  uid: number
  key: string[]
  comment: string
  content: string
  constant: boolean
  order: number
  disable?: boolean
}

export interface Worldbook {
  entries: Record<string, WorldbookEntry>
}

export type LoreMode = 'constant' | 'keyword' | 'travel' | 'off'

/** 一個可以注入的世界書條目（內建條目套用玩家的覆寫後的樣子，或玩家新增的條目） */
export interface LoreItem {
  uid: number
  comment: string
  content: string
  keys: string[]
  mode: LoreMode
  /** 注入順序：越小越前面 */
  order: number
  /** 成人向：只在成人場景（日誌帶親密場景、行動可能進入親密場景）注入 */
  adult: boolean
  builtin: boolean
  /** 內建條目被玩家改過 */
  edited?: boolean
  /** 預設值的說明（為什麼常駐、為什麼停用） */
  note?: string
}

/** 玩家對內建條目的覆寫；沒寫的欄位用預設值 */
export type LoreOverride = Partial<Pick<LoreItem, 'comment' | 'content' | 'keys' | 'mode' | 'order' | 'adult'>>

export interface LoreOptions {
  /** 這次是成人場景：注入成人向條目（敘事傾向、情色喜劇法則、相關價格參考） */
  adult: boolean
  /** 注入字數上限 */
  budgetChars: number
  playerName: string
}

// 世界觀、勢力概述、神祇：常駐
const ALWAYS = [0, 28, 44]
// 視角和文風：改由「文風」條目管理，預設停用
const STYLE = 5
// 世界書裡寫死的玩家名，注入時換成主角名
const HARDCODED_NAME = '沈頤'
// 地標相對位置：旅行報告才注入
const TRAVEL_ONLY = [46]
// 改由引擎實作或與遊戲 UI 衝突的條目：預設停用
const EXCLUDED = new Set([1, 2, 3, 4, 8, 10, 11, 29, 30, 31])
// 成人向條目：只在成人場景注入；其中 38、39 是敘事法則，成人場景時常駐
const ADULT = new Set([16, 17, 18, 38, 39, 54])
const ADULT_CONSTANT = new Set([38, 39])
// 巨龍條目沒有關鍵字，以「龍」觸發
const DRAGON = 45
/** 玩家新增的條目 uid 從這裡開始，避免和世界書檔案衝突 */
export const CUSTOM_LORE_UID = 100000

const toSimplified = Converter({ from: 'tw', to: 'cn' })

let cached: Promise<Worldbook> | null = null

export function loadWorldbook(): Promise<Worldbook> {
  cached ??= import('@data/worldbook/elondia.worldbook.json').then((m) => m.default as unknown as Worldbook)
  return cached
}

/** 內建條目的預設注入方式 */
export function defaultLoreItem(e: WorldbookEntry): LoreItem {
  const base = { uid: e.uid, comment: e.comment, content: e.content, keys: e.key.filter(Boolean), order: e.order, adult: ADULT.has(e.uid), builtin: true }
  if (e.disable) return { ...base, mode: 'off', note: '世界書檔案中已停用' }
  if (ALWAYS.includes(e.uid)) return { ...base, mode: 'constant', note: '世界觀基礎，預設常駐' }
  if (e.uid === STYLE) return { ...base, mode: 'off', note: '文風改由「文風」條目管理；需要時可以開啟' }
  if (TRAVEL_ONLY.includes(e.uid)) return { ...base, mode: 'travel', note: '只在旅行報告注入' }
  if (EXCLUDED.has(e.uid)) return { ...base, mode: 'off', note: '規則已由遊戲引擎實作，或是聊天用的格式指示' }
  if (ADULT_CONSTANT.has(e.uid)) return { ...base, mode: 'constant', note: '成人向：成人場景時常駐' }
  if (e.uid === DRAGON) return { ...base, mode: 'keyword', keys: ['龍', '龙'], note: '原本沒有關鍵字，以「龍」觸發' }
  return { ...base, mode: 'keyword' }
}

/** 套用覆寫並加上玩家新增的條目，依注入順序排序 */
export function loreItems(book: Worldbook, overrides: Record<string, LoreOverride> = {}, custom: LoreItem[] = []): LoreItem[] {
  const builtin = Object.values(book.entries)
    .filter((e) => e.content.trim())
    .map((e) => {
      const d = defaultLoreItem(e)
      const o = overrides[e.uid]
      return o && Object.keys(o).length ? { ...d, ...o, edited: true } : d
    })
  return [...builtin, ...custom.map((c) => ({ ...c, builtin: false }))].sort((a, b) => a.order - b.order || a.uid - b.uid)
}

export type LoreStatus = 'constant' | 'triggered' | 'idle' | 'off' | 'adult' | 'budget'

export const LORE_STATUS_NAME: Record<LoreStatus, string> = {
  constant: '常駐',
  triggered: '觸發',
  idle: '未觸發',
  off: '停用',
  adult: '成人（不是成人場景）',
  budget: '超出字數上限',
}

export interface LoreEntryState {
  status: LoreStatus
  /** 命中的關鍵字 */
  hit?: string
  /** 注入順序（1 起算；沒注入時沒有） */
  position?: number
}

export interface LoreSelection {
  /** 常駐條目：放在 system 前段 */
  constant: LoreItem[]
  /** 這次觸發的條目：放在 user 後段 */
  triggered: LoreItem[]
  states: Record<number, LoreEntryState>
  chars: number
}

export interface LoreQuery {
  /** 拿來比對關鍵字的文字（報告或行動） */
  text: string
  travel: boolean
}

function withPlayerName(content: string, playerName: string): string {
  return content.split(HARDCODED_NAME).join(playerName).split('{{player}}').join(playerName)
}

export function pickLore(items: LoreItem[], q: LoreQuery, opts: LoreOptions): LoreSelection {
  const haystack = q.text + '\n' + toSimplified(q.text)
  const states: Record<number, LoreEntryState> = {}
  const wanted: { item: LoreItem; constant: boolean }[] = []
  for (const it of items) {
    if (it.mode === 'off' || !it.content.trim()) {
      states[it.uid] = { status: 'off' }
      continue
    }
    if (it.adult && !opts.adult) {
      states[it.uid] = { status: 'adult' }
      continue
    }
    if (it.mode === 'constant') {
      wanted.push({ item: it, constant: true })
      continue
    }
    const hit = it.mode === 'travel' ? (q.travel ? '旅行報告' : undefined) : it.keys.find((k) => k && haystack.includes(k))
    if (hit) {
      states[it.uid] = { status: 'triggered', hit }
      wanted.push({ item: it, constant: false })
    } else {
      states[it.uid] = { status: 'idle' }
    }
  }

  // 常駐條目排前面，所以字數不夠時優先保留；兩組內部都依注入順序
  wanted.sort((a, b) => Number(b.constant) - Number(a.constant) || a.item.order - b.item.order || a.item.uid - b.item.uid)
  const result: LoreSelection = { constant: [], triggered: [], states, chars: 0 }
  let position = 0
  for (const { item, constant } of wanted) {
    const content = withPlayerName(item.content, opts.playerName)
    if (result.chars + content.length > opts.budgetChars && position > 0) {
      states[item.uid] = { ...states[item.uid], status: 'budget' }
      continue
    }
    position += 1
    result.chars += content.length
    states[item.uid] = { ...(constant ? { status: 'constant' as const } : states[item.uid]!), position }
    ;(constant ? result.constant : result.triggered).push({ ...item, content })
  }
  return result
}

/** 報告裡拿來比對關鍵字的文字 */
export function reportLoreText(report: Report): string {
  return [
    ...(report.lore_keys ?? []),
    report.location.scene ?? '',
    report.outcome.summary ?? '',
    ...(report.others ?? []).map((o) => o.name),
    ...(report.party ?? []).map((p) => p.personality ?? ''),
  ].join('\n')
}

export function loreForReport(items: LoreItem[], report: Report, opts: LoreOptions): LoreSelection {
  return pickLore(items, { text: reportLoreText(report), travel: report.kind === 'travel' }, opts)
}

/** 以預設設定挑選報告的世界書（常駐在前、觸發在後） */
export function selectLore(book: Worldbook, report: Report, opts: LoreOptions, overrides?: Record<string, LoreOverride>): LoreItem[] {
  const sel = loreForReport(loreItems(book, overrides), report, opts)
  return [...sel.constant, ...sel.triggered]
}

// ---- 世界書檔案（SillyTavern 格式）的匯出與匯入 ----

/** 匯出時附在每個條目 extensions 裡的本遊戲資料；SillyTavern 會忽略 */
interface ElondiaLoreExt {
  mode: LoreMode
  adult: boolean
  /** 內建條目：匯入時改成覆寫，而不是新增一條 */
  builtin: boolean
}

/** 匯出成 SillyTavern 世界書格式（含玩家的修改與新增條目），也可以匯入回本遊戲 */
export function exportWorldbook(items: LoreItem[], name = '埃隆迪亞大陸'): object {
  const entries: Record<string, object> = {}
  for (const it of items) {
    const ext: ElondiaLoreExt = { mode: it.mode, adult: it.adult, builtin: it.builtin }
    entries[it.uid] = {
      uid: it.uid,
      key: it.keys,
      keysecondary: [],
      comment: it.comment,
      content: it.content,
      constant: it.mode === 'constant',
      selective: true,
      order: it.order,
      position: 0,
      disable: it.mode === 'off',
      extensions: { elondia: ext },
    }
  }
  return { name, entries }
}

/** 從世界書檔案讀出的條目 */
export interface ImportedLore {
  uid?: number
  comment: string
  content: string
  keys: string[]
  mode: LoreMode
  order: number
  adult: boolean
  builtin: boolean
}

/** 讀取世界書檔案：SillyTavern 格式（entries 物件或陣列），或本遊戲匯出的檔案 */
export function parseWorldbookFile(raw: unknown): ImportedLore[] {
  const r = raw as { entries?: unknown } | unknown[] | null
  const list = Array.isArray(r) ? r : r && typeof r === 'object' && r.entries && typeof r.entries === 'object' ? Object.values(r.entries) : null
  if (!list) throw new Error('這不是世界書檔案（找不到 entries）')
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim()) : [])
  const out: ImportedLore[] = []
  for (const e of list as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object' || typeof e.content !== 'string' || !e.content.trim()) continue
    const ext = ((e.extensions as Record<string, unknown> | undefined)?.elondia ?? {}) as Partial<ElondiaLoreExt>
    const mode: LoreMode = ext.mode && ['constant', 'keyword', 'travel', 'off'].includes(ext.mode)
      ? ext.mode
      : e.disable ? 'off' : e.constant ? 'constant' : 'keyword'
    out.push({
      ...(typeof e.uid === 'number' ? { uid: e.uid } : {}),
      comment: typeof e.comment === 'string' && e.comment.trim() ? e.comment.trim() : String(e.content).trim().slice(0, 16),
      content: e.content,
      keys: strings(e.key ?? e.keys),
      mode,
      order: typeof e.order === 'number' ? e.order : 700,
      adult: !!ext.adult,
      builtin: !!ext.builtin,
    })
  }
  return out
}
