// 性經歷（成人向；docs/LEWD_STATS.md 第 29 節）：主角、夥伴與 NPC 都有一份記錄——是不是處子、初體驗、
// 發生過關係與性侍奉的人數與次數、最喜歡的人、性癖、最近三次。記在存檔的 sexRecords（角色 id → 記錄）；
// 還沒有記錄的人依角色擲出初始值（NPC 依標籤與 id 固定地擲，固定 NPC 可以在內容頁籤指定）。
// 親密場景之後另外請 AI 讀這段經過、回傳這次誰和誰做了什麼（stores/game.ts 的 recordSex），程式驗證後加進記錄。

import { tagsAllowed } from './content'
import { genderName, lewdRules, namedNpcById, stories, type NpcSexSeed, type SexSeedRule, type StoryDef } from './data'
import { npcRecord } from './npcs'
import { maybeConceive } from './pregnancy'
import type { Character, GameState, LewdStat, Report, SexEncounter, SexLedgerEntry, SexRecord } from './types'

const rules = () => lewdRules.experience

/**
 * 「性經歷」整個開關（設定 → 成人內容的內容篩選；預設打開）。關掉時：AI 不記錄、提示詞不附、
 * NPC 私生活不擲成人向的事、奴隸身價不看性經歷；已經記下的資料保留，打開就恢復
 */
let recordsOn = true
export function setSexRecords(on: boolean) {
  recordsOn = on
}
export function sexRecordsOn(): boolean {
  return recordsOn
}

/** 依字串固定的亂數（不用共用的亂數，不影響其他生成） */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return (h >>> 0) / 4294967296
  }
}

const between = (next: () => number, [lo, hi]: [number, number]) => lo + Math.floor(next() * (hi - lo + 1))
const nonNeg = (n: unknown, max = 100000) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : undefined)

export function emptySexRecord(virgin = true): SexRecord {
  return { virgin, partners: 0, times: 0, servicePartners: 0, serviceTimes: 0, recent: [] }
}

/** 這些標籤用哪一組擲法（標籤寫了的欄位蓋過 npc_random，多個標籤取最後符合的） */
function seedRule(tags: string[] = []): SexSeedRule {
  let out = { ...rules().npc_random }
  for (const t of tags) {
    const r = rules().npc_tags[t]
    if (r) out = { ...out, ...r }
  }
  return out
}

/**
 * 成人向任務的開頭 NPC（任務沒標非處女、自己也不是男性）：劇情把她寫成還沒有經驗，初始性經歷一律是處子。
 * 也當開頭 NPC 的非處女任務不算（那條線本來就照有經驗寫）。特殊任務可以在內容頁籤編輯，清單換了就重算
 */
let storyVirginCache: { list: StoryDef[]; ids: Set<string> } | null = null
export function storyVirginIds(): Set<string> {
  if (storyVirginCache && storyVirginCache.list.length === stories.length && storyVirginCache.list.every((x, i) => x === stories[i])) return storyVirginCache.ids
  const adult = new Set<string>()
  const nv = new Set<string>()
  for (const st of stories) {
    const id = st.start?.kind === 'npc' ? st.start.npc : undefined
    if (!id) continue
    const tags = st.tags ?? []
    if (tags.includes('non_virgin')) nv.add(id)
    else if (tags.includes('adult')) adult.add(id)
  }
  const ids = new Set([...adult].filter((id) => !nv.has(id) && namedNpcById(id)?.gender !== 'male'))
  storyVirginCache = { list: [...stories], ids }
  return ids
}

/**
 * 初始一定是處子嗎（性經歷沒有寫死的人）：成人向任務的開頭 NPC（storyVirginIds），
 * 或內容篩選關掉了非處女（所有照擲的人都是處子）
 */
export function seedsVirgin(id: string): boolean {
  return !tagsAllowed(['non_virgin']) || storyVirginIds().has(id)
}

/**
 * NPC 的初始性經歷：依 id 固定地擲，標籤決定機率與範圍（娼妓一定有經驗、神官多半沒有……）；
 * 固定 NPC 指定了的欄位優先（NpcDef.sex）
 */
export function npcSexSeed(def: { id: string; tags?: string[]; sex?: NpcSexSeed }): SexRecord {
  const next = seeded(`${def.id}:sex`)
  const rule = seedRule(def.tags)
  const fixed = def.sex ?? {}
  // 寫了人數或次數就算有經驗
  const hinted = (fixed.partners ?? 0) > 0 || (fixed.times ?? 0) > 0
  // 照擲的人：成人向任務的開頭 NPC、或關掉了非處女時一律是處子（照樣先擲一次，後面的亂數不變）
  const rolled = hinted ? false : next() < rule.virgin
  const virgin = fixed.virgin ?? (hinted ? false : rolled || seedsVirgin(def.id))
  const rec = emptySexRecord(virgin)
  if (!virgin) {
    rec.partners = Math.max(1, fixed.partners ?? between(next, rule.partners))
    rec.times = Math.max(rec.partners, fixed.times ?? rec.partners * between(next, rule.times_per))
  }
  const serves = next() < rule.service
  const basis = Math.max(1, rec.partners)
  rec.servicePartners = fixed.service_partners ?? (serves && !virgin ? Math.max(1, Math.round(basis * rule.service_share)) : 0)
  rec.serviceTimes = fixed.service_times ?? (rec.servicePartners ? rec.servicePartners * between(next, rule.times_per) : 0)
  // 自慰（最後才擲：不影響前面擲出來的值）
  const solo = fixed.solo ?? between(next, rule.solo ?? [0, 0])
  if (solo) rec.solo = solo
  if (fixed.first && !virgin) rec.first = { note: fixed.first }
  if (fixed.notes) rec.notes = fixed.notes
  return rec
}

/**
 * NPC 初始的淫亂照經歷調整（npcLewd 用）：還沒有經驗的打折，有經驗的依人數加一點；
 * 標籤已經決定淫亂範圍的（娼妓、貴族……）不加（範圍本來就照身分定）
 */
export function experienceLewdness(lewdness: number, rec: SexRecord, tagRanged: boolean): number {
  const r = rules().lewdness
  if (rec.virgin) return Math.round(lewdness * r.virgin_mult)
  let bonus = 0
  for (const [min, add] of r.partner_bonus) if (rec.partners >= min) bonus = add
  return lewdness + (tagRanged ? 0 : bonus)
}

/** 主角還沒有記錄時：有過親密場景（淫亂記過日子）的舊存檔算有經驗，次數不明 */
function pcSeed(pc: Character | undefined): SexRecord {
  return emptySexRecord(pc?.lewd?.lastScene === undefined)
}

/** 這個人的性經歷：存檔裡有就用，沒有時依角色擲出初始值（不寫進存檔） */
export function sexRecordOf(state: GameState, id: string): SexRecord {
  const stored = state.sexRecords?.[id]
  if (stored) return stored
  const member = state.party.find((m) => m.id === id)
  if (id === 'pc' || member?.isPlayer) return pcSeed(state.party.find((m) => m.isPlayer))
  const rec = npcRecord(state, id)
  const def = namedNpcById(id)
  return npcSexSeed({ id, tags: rec?.tags ?? def?.tags ?? [], ...(def?.sex ? { sex: def.sex } : {}) })
}

/** 存檔裡的記錄（沒有時先照初始值寫進去） */
function ensureRecord(state: GameState, id: string): SexRecord {
  const map = (state.sexRecords ??= {})
  return (map[id] ??= JSON.parse(JSON.stringify(sexRecordOf(state, id))) as SexRecord)
}

/** 處女、處男或處子（依性別） */
export function virginWord(gender?: string): string {
  const g = genderName(gender) || gender || ''
  if (g.includes('女') && !g.includes('男')) return '處女'
  if (g.includes('男') && !g.includes('女')) return '處男'
  return '處子'
}

function genderOf(state: GameState, id: string): string | undefined {
  const m = state.party.find((x) => x.id === id || (id === 'pc' && x.isPlayer))
  return m?.gender ?? npcRecord(state, id)?.gender
}

/** 名字列表 */
const names = (e: SexEncounter) => e.with.map((w) => w.name).join('、') || '不明的對象'

/** 一次經歷的文字（第幾天、對象、做了什麼） */
export function encounterText(e: SexEncounter): string {
  const what = [e.sex ? `性交 ${e.sex} 次` : '', e.service ? `性侍奉 ${e.service} 次` : ''].filter(Boolean).join('、')
  return `第 ${e.day} 天和${names(e)}（${what}${e.forced ? '・非自願' : ''}）：${e.summary}`
}

/** 角色詳情與人際關係顯示用：每一項一列 */
export function sexRecordItems(state: GameState, id: string): { label: string; value: string }[] {
  const rec = sexRecordOf(state, id)
  const word = virginWord(genderOf(state, id))
  const out: { label: string; value: string }[] = []
  out.push({ label: '經驗', value: rec.virgin ? `${word}` : `非${word}` })
  if (rec.first) out.push({ label: '初體驗', value: [rec.first.day !== undefined ? `第 ${rec.first.day} 天` : '', rec.first.with ? `和${rec.first.with}` : '', rec.first.note ?? ''].filter(Boolean).join('・') })
  out.push({ label: '發生過關係', value: `${rec.partners} 人・${rec.times} 次` })
  out.push({ label: '性侍奉', value: `${rec.servicePartners} 人・${rec.serviceTimes} 次` })
  if (rec.forced) out.push({ label: '非自願', value: `${rec.forced} 次` })
  out.push({ label: '自慰', value: `${rec.solo ?? 0} 次${rec.soloLast !== undefined ? `・最近在第 ${rec.soloLast} 天` : ''}` })
  if (rec.favorite) out.push({ label: '最喜歡的人', value: rec.favorite })
  const last = rec.recent[0]
  if (last) out.push({ label: '最近一次的對象', value: names(last) })
  if (rec.notes) out.push({ label: '性癖與偏好', value: rec.notes })
  return out
}

/** 交給 AI 的一段（成人場景的敘事與判定、記錄請求） */
export function sexRecordText(state: GameState, id: string): string {
  if (!recordsOn) return ''
  const rec = sexRecordOf(state, id)
  const items = sexRecordItems(state, id).map((x) => `${x.label}：${x.value}`).join('；')
  const recent = rec.recent.length ? `\n  最近${rec.recent.length}次：${rec.recent.map(encounterText).join(' ／ ')}` : ''
  return `${items}${recent}`
}

/** 是不是要記下性經歷的親密場景：帶 adult_scene（不是戰鬥中只有挑逗、剝衣），或寫手在正文後標出了親密場景（intimate_note） */
export function intimateReport(report: Report): boolean {
  const a = report.narration?.adult_scene
  return (!!a && report.narration?.tease !== a) || !!report.narration?.intimate_note
}

/**
 * 這次可能有性經歷的人（AI 只能更新這些人的記錄）：主角、隊伍、報告裡的其他人（怪物除外）、
 * 派去接客的人與戰敗事件被圍住的隊友
 */
export function sexCandidates(state: GameState, report: Report): string[] {
  const ids = new Set<string>(['pc'])
  for (const a of report.party ?? []) ids.add(state.party.find((m) => m.id === a.id)?.isPlayer ? 'pc' : a.id)
  for (const a of report.others ?? []) if (!a.monster && (npcRecord(state, a.id) || state.party.some((m) => m.id === a.id))) ids.add(a.id)
  for (const id of [report.narration?.adult_actor, report.narration?.defeat_victim]) if (id) ids.add(id)
  return [...ids].filter((id) => id === 'pc' || !!npcRecord(state, id) || state.party.some((m) => m.id === id))
}

/** 這則日誌已經記過了嗎 */
export function sexLogged(state: GameState, reportId: string): boolean {
  return !!state.sexLogged?.includes(reportId)
}

/** 記過的日誌最多留幾則：跟日誌保留的則數一樣（設定的「日誌保留」；日誌還在、記錄就還在，不會變回可以再記一次） */
export function markSexLogged(state: GameState, reportId: string, limit = 200) {
  const list = (state.sexLogged ??= [])
  if (!list.includes(reportId)) list.push(reportId)
  const cap = Math.max(50, Math.floor(limit) || 0)
  if (list.length > cap) list.splice(0, list.length - cap)
  // 帳本只留還記得的日誌
  if (state.sexLedger) for (const id of Object.keys(state.sexLedger)) if (!list.includes(id)) delete state.sexLedger[id]
}

/** 這則日誌能不能重新記錄：記過、而且有帳本（帳本之前就記過的舊日誌扣不回來，不能重記，免得重複加） */
export function canRerecord(state: GameState, reportId: string): boolean {
  return sexLogged(state, reportId) && !!state.sexLedger?.[reportId]
}

/** 日誌的先後（state.reports 的順序；已經不在日誌裡的當成最早） */
function reportOrder(state: GameState, reportId: string | undefined): number {
  if (!reportId) return -1
  const i = state.reports.findIndex((r) => r.report_id === reportId)
  return i
}

/** 這個人在其他日誌的帳本（不含 reportId），由早到晚 */
function otherEntries(state: GameState, id: string, reportId: string): { report: string; e: SexLedgerEntry }[] {
  const out: { report: string; e: SexLedgerEntry }[] = []
  for (const [rid, list] of Object.entries(state.sexLedger ?? {})) {
    if (rid === reportId) continue
    for (const e of list) if (e.id === id) out.push({ report: rid, e })
  }
  return out.sort((a, b) => reportOrder(state, a.report) - reportOrder(state, b.report))
}

/** 這則帳本裡跟這個對象有關嗎（新帳本看 sexKeys；沒有時看最近幾次裡那則的對象） */
function involves(rec: SexRecord, o: { report: string; e: SexLedgerEntry }, side: 'sex' | 'service', key: string): boolean {
  const keys = side === 'sex' ? o.e.sexKeys : o.e.serviceKeys
  if (keys) return keys.includes(key)
  const enc = rec.recent.find((x) => x.report === o.report)
  if (!enc || !(side === 'sex' ? enc.sex : enc.service)) return false
  return enc.with.some((w) => (w.id ?? `name:${w.name}`) === key)
}

/**
 * 把這則日誌之前記下的性經歷扣回來（重新記錄的第一步）：次數、人數、記住的對象、非自願、自慰、
 * 初體驗、最喜歡的人與性癖（還是這次改的才換回去）、最近幾次裡這則的那一筆。受孕不退（已經擲過）。
 * 其他日誌也有的經驗不扣：這則記住的對象如果較晚那則也有，改算在那則（人數不減）；扣完還有性交次數就不恢復處子，
 * 初體驗挪到最早有性交的那則。之後在角色詳情手動改過的數字照樣扣，扣到 0 為止。回傳帳本被改到的其他日誌
 */
export function undoSexRecord(state: GameState, reportId: string): string[] {
  const touched = new Set<string>()
  for (const e of state.sexLedger?.[reportId] ?? []) {
    const rec = ensureRecord(state, e.id)
    const others = otherEntries(state, e.id, reportId)
    // 記住的對象：其他日誌也有這個人就留著，算成那則認識的
    const moveKnown = (side: 'sex' | 'service', keys: string[]): number => {
      let kept = 0
      for (const k of keys) {
        const holder = others.find((o) => involves(rec, o, side, k))
        if (holder) {
          kept++
          if (side === 'sex') { holder.e.known.push(k); holder.e.partners++ } else { holder.e.serviceKnown.push(k); holder.e.servicePartners++ }
          touched.add(holder.report)
        } else if (side === 'sex') rec.known = (rec.known ?? []).filter((x) => x !== k)
        else rec.serviceKnown = (rec.serviceKnown ?? []).filter((x) => x !== k)
      }
      return kept
    }
    const keptSex = moveKnown('sex', e.known)
    const keptService = moveKnown('service', e.serviceKnown)
    rec.times = Math.max(0, rec.times - e.times)
    rec.partners = Math.max(0, rec.partners - Math.max(0, e.partners - keptSex))
    rec.serviceTimes = Math.max(0, rec.serviceTimes - e.serviceTimes)
    rec.servicePartners = Math.max(0, rec.servicePartners - Math.max(0, e.servicePartners - keptService))
    if (e.solo) rec.solo = Math.max(0, (rec.solo ?? 0) - e.solo)
    if (e.soloLast !== undefined) {
      if (e.soloLast === null) delete rec.soloLast
      else rec.soloLast = e.soloLast
    }
    if (e.forced) rec.forced = Math.max(0, (rec.forced ?? 0) - e.forced)
    if (e.first) {
      if (rec.times > 0) {
        // 其他日誌也有性交：還不是處子，初體驗挪到最早有性交的那則（成長已經長過，不退）
        const holder = others.find((o) => o.e.times > 0 && o.e.firstIf)
        if (holder) {
          holder.e.first = true
          rec.first = { ...holder.e.firstIf }
          touched.add(holder.report)
        }
      } else {
        rec.virgin = true
        delete rec.first
        const c = characterOf(state, e.id)
        if (c) for (const [k, v] of Object.entries(rules().first_time)) if (v) bumpLewd(c, k as LewdStat, -v)
      }
    }
    if (e.favorite && rec.favorite === e.favorite.set) {
      if (e.favorite.prev) rec.favorite = e.favorite.prev
      else delete rec.favorite
    }
    if (e.notes && rec.notes === e.notes.set) {
      if (e.notes.prev) rec.notes = e.notes.prev
      else delete rec.notes
    }
    rec.recent = rec.recent.filter((x) => x.report !== reportId)
  }
  if (state.sexLedger) delete state.sexLedger[reportId]
  return [...touched]
}

/**
 * 重新記錄之後：重記前挪到較晚那則的初體驗、新對象，這則又有的話挪回這則（記錄的數字不變，只是算在哪一則）。
 * 回傳帳本被改到的其他日誌
 */
export function reclaimFirst(state: GameState, reportId: string): string[] {
  const touched = new Set<string>()
  const at = reportOrder(state, reportId)
  for (const e of state.sexLedger?.[reportId] ?? []) {
    const later = otherEntries(state, e.id, reportId).filter((o) => reportOrder(state, o.report) > at)
    for (const side of ['sex', 'service'] as const) {
      const mine = side === 'sex' ? e.known : e.serviceKnown
      for (const k of (side === 'sex' ? e.sexKeys : e.serviceKeys) ?? []) {
        if (mine.includes(k)) continue
        const o = later.find((x) => (side === 'sex' ? x.e.known : x.e.serviceKnown).includes(k))
        if (!o) continue
        if (side === 'sex') { o.e.known = o.e.known.filter((x) => x !== k); o.e.partners = Math.max(0, o.e.partners - 1); e.partners++ }
        else { o.e.serviceKnown = o.e.serviceKnown.filter((x) => x !== k); o.e.servicePartners = Math.max(0, o.e.servicePartners - 1); e.servicePartners++ }
        mine.push(k)
        touched.add(o.report)
      }
    }
    if (!e.times || e.first || !e.firstIf) continue
    const holder = later.find((o) => o.e.first)
    if (!holder) continue
    holder.e.first = false
    e.first = true
    ensureRecord(state, e.id).first = { ...e.firstIf }
    touched.add(holder.report)
  }
  return [...touched]
}

/** 兩份記錄的差：這一則日誌對這個人造成的變化 */
function ledgerOf(id: string, before: SexRecord, after: SexRecord): SexLedgerEntry {
  const added = (a: string[] | undefined, b: string[] | undefined) => (b ?? []).filter((k) => !(a ?? []).includes(k))
  const e: SexLedgerEntry = {
    id, times: after.times - before.times, partners: after.partners - before.partners, known: added(before.known, after.known),
    serviceTimes: after.serviceTimes - before.serviceTimes, servicePartners: after.servicePartners - before.servicePartners,
    serviceKnown: added(before.serviceKnown, after.serviceKnown), solo: (after.solo ?? 0) - (before.solo ?? 0), forced: (after.forced ?? 0) - (before.forced ?? 0),
  }
  if (before.virgin && !after.virgin) e.first = true
  if (after.soloLast !== before.soloLast) e.soloLast = before.soloLast ?? null
  if (after.favorite && after.favorite !== before.favorite) e.favorite = { ...(before.favorite ? { prev: before.favorite } : {}), set: after.favorite }
  if (after.notes && after.notes !== before.notes) e.notes = { ...(before.notes ? { prev: before.notes } : {}), set: after.notes }
  return e
}

/** 記錄成功時的提示：每個人這次加了什麼（「莉娜：性交 2 次（初體驗）、性侍奉 1 次」） */
export function sexRecordToast(state: GameState, entries: SexLedgerEntry[], rerecorded = false): string {
  return `📒 ${rerecorded ? '重新記下性經歷（取代這則之前的記錄）' : '記下性經歷'}：${sexRecordLines(state, entries).join('；')}`
}

/** 每個人一行：「莉娜：性交 2 次（初體驗）、性侍奉 1 次」（提示與日誌卡上的粉紅色記錄） */
export function sexRecordLines(state: GameState, entries: SexLedgerEntry[]): string[] {
  return entries.map((e) => {
    const bits = [
      e.times ? `性交 ${e.times} 次${e.partners ? `（新對象 ${e.partners} 人）` : ''}` : '',
      e.serviceTimes ? `性侍奉 ${e.serviceTimes} 次` : '',
      e.solo ? `自慰 ${e.solo} 次` : '',
      e.forced ? '非自願' : '',
      e.first ? '初體驗' : '',
    ].filter(Boolean)
    return `${nameFor(state, e.id)}${bits.length ? `：${bits.join('、')}` : ''}`
  })
}

/** AI 回傳的一筆：誰、這次性交與性侍奉幾次、和誰、經過、是不是初體驗…… */
export interface SexUpdate {
  id: string
  sex?: number
  service?: number
  solo?: number
  /** 這次的對象：每人一筆，sex／service 是和這個人性交、替這個人侍奉的次數（沒寫時兩邊都算） */
  with?: { name?: string; id?: string; gender?: string; sex?: number; service?: number }[]
  forced?: boolean
  summary?: string
  first_time?: string
  favorite?: string
  notes?: string
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function characterOf(state: GameState, id: string): Character | undefined {
  if (id === 'pc') return state.party.find((m) => m.isPlayer)
  return state.party.find((m) => m.id === id) ?? state.npcs?.[id]?.character
}

/** 記過的對象：認得就不再算一個新的人 */
function countPartners(list: string[], keys: string[]): { list: string[]; added: number } {
  const cap = rules().known_cap
  let added = 0
  const out = [...list]
  for (const k of keys) {
    if (out.includes(k)) continue
    added += 1
    out.push(k)
  }
  return { list: out.slice(-cap), added }
}

/** 一次經歷（AI 記下的，或 NPC 自己的日子擲出來的） */
/** 一次經歷的對象；sex／service 是 false 時這個人不算進那一邊的人數（沒寫時兩邊都算） */
export interface EncounterPartner {
  name: string
  id?: string
  sex?: boolean
  service?: boolean
  /** 沒有 id 的對象：AI 寫的性別（受孕判定用，pregnancy.ts；不存進記錄） */
  gender?: string
}

export interface EncounterInput {
  day: number
  with: EncounterPartner[]
  sex: number
  service: number
  /** 自慰的次數（不算在最近幾次裡） */
  solo?: number
  forced?: boolean
  summary: string
  /** 第一次性交時記下的初體驗（沒寫時用 summary） */
  firstNote?: string
  report?: string
  /** 對象寫不出來時用來認人的 key（同一個 key 算同一個人） */
  anonKey?: string
  /** 一次好幾個不認識的人（接客）：每個 key 算一個人，with 只用來顯示 */
  anonKeys?: string[]
}

/**
 * 加進一個人的記錄：認得的對象不再算新的人；第一次性交時記下初體驗，有角色資料的人照 experience.first_time 成長；
 * 有性交或性侍奉時加進最近幾次。回傳這次是不是初體驗
 */
/** 這次經歷裡性交（或性侍奉）的對象，認人用的 key */
export function encounterKeys(e: EncounterInput, side: 'sex' | 'service'): string[] {
  const key = (p: EncounterPartner) => p.id ?? `name:${p.name}`
  // 對象寫不出來（例如一群看不清臉的人）：至少算一個新的人
  const fallback = e.anonKeys?.length ? e.anonKeys : [e.anonKey ?? `anon:${e.report ?? e.day}`]
  if (e.anonKeys?.length) return e.anonKeys
  // 性交與性侍奉各自的對象：AI 分開寫了（只替其中一人侍奉……）就照寫的算，沒寫的人兩邊都算
  const all = e.with.map(key)
  const some = e.with.filter((p) => p[side] !== false).map(key)
  return some.length ? some : all.length ? all : fallback
}

export function addEncounter(state: GameState, id: string, e: EncounterInput): boolean {
  const rec = ensureRecord(state, id)
  const keysFor = (side: 'sex' | 'service') => encounterKeys(e, side)
  let first = false
  if (e.sex) {
    const r = countPartners(rec.known ?? [], keysFor('sex'))
    rec.known = r.list
    rec.partners += r.added
    rec.times += e.sex
    if (rec.virgin) {
      first = true
      rec.virgin = false
      const note = e.firstNote || e.summary
      rec.first = { day: e.day, ...(e.with.length ? { with: e.with.map((p) => p.name).join('、') } : {}), ...(note ? { note } : {}) }
      const c = characterOf(state, id)
      if (c) for (const [k, v] of Object.entries(rules().first_time)) if (v) bumpLewd(c, k as LewdStat, v)
    }
  }
  if (e.service) {
    const r = countPartners(rec.serviceKnown ?? [], keysFor('service'))
    rec.serviceKnown = r.list
    rec.servicePartners += r.added
    rec.serviceTimes += e.service
  }
  if (e.solo) {
    rec.solo = (rec.solo ?? 0) + e.solo
    rec.soloLast = e.day
  }
  if (e.forced) rec.forced = (rec.forced ?? 0) + 1
  if (e.sex || e.service) {
    const enc: SexEncounter = { day: e.day, with: e.with.map((p) => ({ name: p.name, ...(p.id ? { id: p.id } : {}) })), sex: e.sex, service: e.service, summary: e.summary, ...(e.report ? { report: e.report } : {}) }
    if (e.forced) enc.forced = true
    // 照日子排（同一天照日誌先後）：重記較早的日誌時，那一筆回到原本的位置，不會跑到最上面
    const order = (x: SexEncounter) => reportOrder(state, x.report)
    rec.recent = [enc, ...rec.recent.filter((x) => !e.report || x.report !== e.report)]
      .map((x, i) => ({ x, i }))
      .sort((a, b) => b.x.day - a.x.day || (a.x.report && b.x.report ? order(b.x) - order(a.x) : 0) || a.i - b.i)
      .map(({ x }) => x)
      .slice(0, rules().recent)
  }
  return first
}

/**
 * 套用 AI 回傳的性經歷（驗證後加進記錄）：只收 candidates 裡的人；次數、對象有上限；
 * 第一次性交時記下初體驗，有角色資料的人照 experience.first_time 成長。回傳更新了誰
 */
export function applySexUpdates(state: GameState, raw: unknown, ctx: { report: Report; candidates: string[]; noConceive?: boolean }): string[] {
  const caps = rules().caps
  const list = Array.isArray(raw) ? (raw as SexUpdate[]) : []
  const updated: string[] = []
  const day = ctx.report.time.end.day
  for (const u of list) {
    if (!u || typeof u !== 'object' || typeof u.id !== 'string') continue
    const id = u.id === state.party.find((m) => m.isPlayer)?.id ? 'pc' : u.id
    if (!ctx.candidates.includes(id) || updated.includes(id)) continue
    const before = JSON.parse(JSON.stringify(ensureRecord(state, id))) as SexRecord
    const sex = nonNeg(u.sex, caps.times) ?? 0
    const service = nonNeg(u.service, caps.times) ?? 0
    const solo = nonNeg(u.solo, caps.times) ?? 0
    if (!sex && !service && !solo) continue
    const partners = (Array.isArray(u.with) ? u.with : [])
      .filter((w) => w && typeof w === 'object')
      .map((w) => {
        const wid = typeof w.id === 'string' && w.id && w.id !== id ? (w.id === state.party.find((m) => m.isPlayer)?.id ? 'pc' : w.id) : undefined
        const known = wid && (wid === 'pc' || state.party.some((m) => m.id === wid) || !!npcRecord(state, wid)) ? wid : undefined
        const name = text(w.name, 16) || (known ? nameFor(state, known) : '')
        // 和這個人性交、替這個人侍奉的次數：寫了才分開算（0 表示這一邊沒有這個人）
        const side = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? { on: n > 0 } : undefined)
        const s = side(w.sex)
        const v = side(w.service)
        const gender = !known ? text(w.gender, 8) : ''
        return name ? { name, ...(known ? { id: known } : {}), ...(gender ? { gender } : {}), ...(s ? { sex: s.on } : {}), ...(v ? { service: v.on } : {}) } : null
      })
      .filter((w): w is EncounterPartner => !!w)
      .slice(0, caps.partners)
    const input: EncounterInput = {
      day, with: sex || service ? partners : [], sex, service, solo, forced: u.forced === true,
      summary: text(u.summary, 120) || ctx.report.narration?.adult_scene?.slice(0, 120) || '',
      firstNote: text(u.first_time, 120), report: ctx.report.report_id, anonKey: `anon:${ctx.report.report_id}`,
    }
    addEncounter(state, id, input)
    // 受孕只在這裡判定（AI 記下的經歷）；NPC 私生活走 addEncounter，不會受孕（docs/FAMILY.md）
    if (sex && !ctx.noConceive) maybeConceive(state, { report: ctx.report, mother: id, partners, times: sex, forced: u.forced === true })
    const rec = ensureRecord(state, id)
    const favorite = text(u.favorite, 16)
    if (favorite) rec.favorite = favorite
    const notes = text(u.notes, 120)
    if (notes) rec.notes = notes
    updated.push(id)
    // 帳本：這則日誌對這個人造成的變化（重新記錄時扣回來）
    const entry = ledgerOf(id, before, rec)
    if (sex) {
      entry.sexKeys = encounterKeys(input, 'sex')
      const note = input.firstNote || input.summary
      entry.firstIf = { day, ...(input.with.length ? { with: input.with.map((p) => p.name).join('、') } : {}), ...(note ? { note } : {}) }
    }
    if (service) entry.serviceKeys = encounterKeys(input, 'service')
    ;((state.sexLedger ??= {})[ctx.report.report_id] ??= []).push(entry)
  }
  // 沒有人要記也留一筆空的帳本：之後可以重新記錄
  ;(state.sexLedger ??= {})[ctx.report.report_id] ??= []
  return updated
}

/** 淫亂、敏感……的基本值（不經過流派的成長倍率：初體驗是一次性的變化） */
function bumpLewd(c: Character, k: LewdStat, v: number) {
  const stats = (c.lewd ??= { ...lewdRules.defaults })
  stats[k] = Math.max(0, Math.min(100, Math.round(stats[k] + v)))
}

function nameFor(state: GameState, id: string): string {
  if (id === 'pc') return state.party.find((m) => m.isPlayer)?.name ?? '主角'
  return state.party.find((m) => m.id === id)?.name ?? npcRecord(state, id)?.name ?? id
}

/** 玩家在角色詳情改的記錄（是不是處子、人數、次數、最喜歡的人、性癖）；清空時回到初始值 */
export function editSexRecord(state: GameState, id: string, patch: Partial<Pick<SexRecord, 'virgin' | 'partners' | 'times' | 'servicePartners' | 'serviceTimes' | 'solo' | 'favorite' | 'notes'>> | null) {
  if (!patch) {
    if (state.sexRecords) delete state.sexRecords[id]
    return
  }
  const rec = ensureRecord(state, id)
  if (typeof patch.virgin === 'boolean') rec.virgin = patch.virgin
  for (const k of ['partners', 'times', 'servicePartners', 'serviceTimes', 'solo'] as const) {
    const n = nonNeg(patch[k])
    if (n !== undefined) rec[k] = n
  }
  if (patch.favorite !== undefined) {
    const f = text(patch.favorite, 16)
    if (f) rec.favorite = f
    else delete rec.favorite
  }
  if (patch.notes !== undefined) {
    const n = text(patch.notes, 120)
    if (n) rec.notes = n
    else delete rec.notes
  }
}

/**
 * 奴隸的身價照性經歷調整（docs/LEWD_STATS.md 第 23 節；lewd.json 的 experience.slave_price）：
 * 處子加價；有經驗的照人數扣一點；性侍奉做得多的加一點。回傳倍率與說明（市場的清單顯示）
 */
export function sexValue(rec: SexRecord, gender?: string): { mult: number; notes: string[] } {
  const r = rules().slave_price
  const tier = (table: [number, number][], n: number) => table.reduce((v, [min, d]) => (n >= min ? d : v), 0)
  const pct = (d: number) => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%`
  const notes: string[] = []
  let d = 0
  if (rec.virgin) {
    d += r.virgin
    notes.push(`${virginWord(gender)} ${pct(r.virgin)}`)
  } else {
    const off = tier(r.partners, rec.partners)
    if (off) {
      d -= off
      notes.push(`和 ${rec.partners} 人有過關係 ${pct(-off)}`)
    }
  }
  const skill = tier(r.service, rec.serviceTimes)
  if (skill) {
    d += skill
    notes.push(`熟練的侍奉 ${pct(skill)}`)
  }
  return { mult: Math.max(r.min, Math.min(r.max, 1 + d)), notes }
}

/** 這個人的身價倍率（性經歷的部分） */
export function sexValueOf(state: GameState, id: string): { mult: number; notes: string[] } {
  if (!recordsOn) return { mult: 1, notes: [] }
  return sexValue(sexRecordOf(state, id), genderOf(state, id))
}

/** 主角建角時選的經驗（開新遊戲） */
export function pcExperience(experienced: boolean, note = ''): SexRecord {
  const rec = emptySexRecord(!experienced)
  if (experienced) {
    rec.partners = 1
    rec.times = 1
    const n = text(note, 120)
    if (n) rec.first = { note: n }
  }
  return rec
}

/** 成人場景的敘事與判定：主角、隊友與在場的人的性經歷，每人一行（ids 是報告或行動裡的其他人） */
export function sexRecordsNote(state: GameState, ids: string[] = []): string {
  if (!recordsOn) return ''
  const pc = state.party.find((m) => m.isPlayer)
  const list = ['pc', ...state.party.filter((m) => !m.isPlayer).map((m) => m.id), ...ids.filter((id) => id !== pc?.id && !!npcRecord(state, id))]
  return [...new Set(list)].map((id) => `\n${nameFor(state, id)}的性經歷：${sexRecordText(state, id)}`).join('')
}

/** 存檔救濟（11/9）只做一次：記在 flags 裡 */
export const STORY_VIRGIN_FIX = 'fix:story_virgin_1109'

/**
 * 存檔救濟（11/9 實測決定）：成人向任務的開頭 NPC（storyVirginIds）與劇情寫了第一次的固定 NPC，以前照擲可能是有經驗，
 * 或在私生活裡失去了第一次。已經寫進存檔的記錄改回處子（照現在的初始值重算），幕後的成人向近況一起拿掉。
 * 和主角發生過關係的不動（那是玩出來的）。只做一次。回傳改了誰
 */
export function rescueStoryVirgins(state: GameState): string[] {
  const flags = (state.flags ??= {})
  if (flags[STORY_VIRGIN_FIX]) return []
  flags[STORY_VIRGIN_FIX] = true
  const pcIds = new Set(['pc', ...state.party.filter((m) => m.isPlayer).map((m) => m.id)])
  const fixed: string[] = []
  for (const [id, rec] of Object.entries(state.sexRecords ?? {})) {
    if (pcIds.has(id) || rec.virgin) continue
    const def = namedNpcById(id)
    if (!def || !(def.sex?.virgin === true || storyVirginIds().has(id))) continue
    if ((rec.known ?? []).some((k) => pcIds.has(k)) || (rec.serviceKnown ?? []).some((k) => pcIds.has(k))) continue
    if (rec.recent.some((e) => e.with.some((p) => p.id && pcIds.has(p.id)))) continue
    const seed = npcSexSeed({ id, tags: def.tags ?? [], ...(def.sex ? { sex: def.sex } : {}) })
    if (!seed.virgin) continue
    state.sexRecords![id] = seed
    const news = state.npcLife?.news?.[id]
    if (news) state.npcLife!.news[id] = news.filter((n) => !n.adult || n.adult.kind === 'solo')
    fixed.push(id)
  }
  return fixed
}
