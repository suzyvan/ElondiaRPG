// 家僕（見 docs/HOMES.md 第 8 節；規則在 data/rules/homes.json 的 staff）：
// - 在自己的房子雇普通人做家務：女僕（舒適度）、廚師（在家長休後的早餐）、園丁（每天收成、重新播種）、管家（上限 +1、從保險箱付工錢）。
// - 家僕不入隊，住在房子裡（NPC 登錄的 staff 與 at），出現在「這裡的人」；同一個職位雇好幾個人時效果不疊加。
// - 應徵者每座城每幾天換一批（亂數只看世界種子、地點與第幾批），雇下才寫進 NPC 登錄。
// - 工錢欠著（記 paidUntil），回家時結清；欠超過 quit_days 天的人辭職。主角不在時發生的事記在房子的 staffNotes，回家時看。
// - 自己的奴隸留在家裡時可以分派家務（chore）：不用工錢、不佔上限，效果和雇來的人一樣。

import { homeRules, locationById, npcTags, STAFF_JOBS, tagDcMod, type Degree, type StaffJob, type StaffJobDef } from './data'
import { currentArea, type Area } from './grid'
import { homeOfArea, homeReport, ownHomeOfArea, workbenchFor } from './homes'
import { formatMoney } from './money'
import { generateNpc, hashString, npcKind, npcRecord, npcSpot, registerNpc } from './npcs'
import { addAffinity, assertFree, gainCondition, isBound } from './party'
import { addLewd, lewdOf } from './lewd'
import { isOwnSlave } from './ownedSlaves'
import { buildHaunts, isUnhireable, presentHere } from './population'
import { Rng } from './rng'
import { addMemory, ensureRelationship, setAffinity } from './social'
import { commitReport, withRng } from './state'
import { plotPlace, seedOf } from './garden'
import { homeMoney, removeFromHome, storeInHome, takeHomeMoney } from './storage'
import { settleConstruction } from './homeExpand'
import { guestDaily } from './rooms'
import { cohabitDaily, cohabitScene } from './cohabit'
import { locationMult } from './trade'
import type { GameState, GameTime, Home, NpcRecord, Report } from './types'

const rules = () => homeRules.staff

export function jobDef(job: StaffJob): StaffJobDef {
  return rules().jobs[job]
}

export function jobName(job: StaffJob): string {
  return jobDef(job)?.name ?? job
}

// ---- 誰在這棟房子做事 ----

/** 這棟房子雇的家僕 */
export function staffOf(state: GameState, homeId: string): NpcRecord[] {
  return Object.values(state.npcs ?? {}).filter((r) => r.staff?.home === homeId && !r.dead)
}

/** 這棟房子分派了家務的奴隸（留在家裡、主角的奴隸） */
export function choreSlaves(state: GameState, homeId: string): NpcRecord[] {
  return Object.values(state.npcs ?? {}).filter((r) => r.staying === homeId && !!r.chore && isOwnSlave(state, r.character))
}

/** 請假中（家裡的事給的 staff_pause）：這幾天效果停掉 */
export function onLeave(state: GameState, rec: NpcRecord): boolean {
  return (rec.staffPause ?? 0) >= state.time.day
}

/** 做這份家務的人：雇來的家僕與分派了家務的奴隸（請假中的不算） */
export function workersFor(state: GameState, homeId: string, job: StaffJob): NpcRecord[] {
  return [...staffOf(state, homeId).filter((r) => r.staff!.job === job), ...choreSlaves(state, homeId).filter((r) => r.chore === job)].filter((r) => !onLeave(state, r))
}

export function hasWorker(state: GameState, homeId: string, job: StaffJob): boolean {
  return workersFor(state, homeId, job).length > 0
}

/** 這棟房子最多能雇幾個家僕（有管家時多 steward_bonus 個） */
export function staffCap(state: GameState, home: Home): number {
  const base = rules().caps[home.district] ?? 1
  return base + (staffOf(state, home.id).some((r) => r.staff!.job === 'steward') ? rules().steward_bonus : 0)
}

/** 這座城雇這個職位的日薪（乘物價） */
export function wageHere(state: GameState, job: StaffJob): number {
  return Math.max(1, Math.round(jobDef(job).wage_cc * locationMult(state)))
}

// ---- 效果 ----

/** 女僕：加多少舒適度（不疊加） */
export function staffComfort(state: GameState, home: Home): number {
  return hasWorker(state, home.id, 'maid') ? jobDef('maid').comfort ?? 0 : 0
}

/** 廚師：在家長休後的早餐（狀態 id；有烹飪的高階工作台時是比較好的那一種） */
export function breakfastOf(state: GameState, home: Home): string | undefined {
  if (!hasWorker(state, home.id, 'cook')) return undefined
  const def = jobDef('cook')
  return (workbenchFor(home, 'cooking') && def.fine_condition) || def.condition
}

/** 在家長休醒來：廚師做早餐，全隊得到用餐狀態；回傳寫進摘要的一句 */
export function serveBreakfast(state: GameState, home: Home, report: Report): string {
  const id = breakfastOf(state, home)
  if (!id) return ''
  for (const m of state.party) gainCondition(m, id, report)
  const cook = workersFor(state, home.id, 'cook')[0]!
  return `${cook.name}一早就做好了早餐。`
}

// ---- 應徵者 ----

const candidateCache = new Map<string, NpcRecord[]>()

/** 第幾批應徵者（每 refresh_days 天換一批） */
function batchOf(state: GameState): number {
  return Math.floor((state.time.day - 1) / Math.max(1, rules().refresh_days))
}

/**
 * 這座城這一批的應徵者（還沒雇的）：每個職位 candidates_per_job 人，普通人。
 * 亂數只看世界種子、地點與第幾批，讀檔重來結果一樣；生成時不寫進 NPC 登錄（雇下才寫）。
 */
export function candidates(state: GameState, location: string): NpcRecord[] {
  const batch = batchOf(state)
  const key = `${state.seed}:${location}:${batch}`
  let list = candidateCache.get(key)
  if (!list) {
    const rng = new Rng(hashString(`staff:${key}`))
    const [lo, hi] = rules().candidates_per_job
    const [llo, lhi] = npcTags.kinds.commoner.level ?? [1, 3]
    const loc = locationById(location)
    // 生成時用一份抄本，不寫進存檔的 NPC 登錄
    const scratch = { ...state, npcs: { ...(state.npcs ?? {}) } } as GameState
    list = []
    for (const job of STAFF_JOBS) {
      const n = rng.int(lo, hi)
      for (let i = 0; i < n; i++) {
        const rec = generateNpc(scratch, rng, {
          id: `staff_${location}_${batch}_${job}_${i}`, kind: 'commoner', location, level: rng.int(llo, lhi), tags: ['commoner'],
          occupation: jobDef(job).occupation, ...(loc.faction ? { faction: loc.faction } : {}),
        }, 'staff')
        rec.staff = { home: '', job, wage_cc: 0, paidUntil: 0, since: { ...state.time } }
        list.push(rec)
      }
    }
    if (candidateCache.size > 50) candidateCache.clear()
    candidateCache.set(key, list)
  }
  return list.filter((r) => !state.npcs?.[r.id])
}

/** 應徵者的職位 */
export function candidateJob(rec: NpcRecord): StaffJob {
  return rec.staff!.job
}

// ---- 雇用、解雇、工錢 ----

/** 站在自己的房子裡（雇人、付錢、解雇都要在房子裡） */
function homeHereOrThrow(state: GameState, area: Area = currentArea(state)): Home {
  const home = ownHomeOfArea(state, area)
  if (!home) throw new Error('要在自己的房子裡才能處理家僕的事')
  return home
}

/** 不能再雇人的原因（沒有時可以雇） */
export function hireRefusal(state: GameState, home: Home): string | undefined {
  if (staffOf(state, home.id).length >= staffCap(state, home)) return `家僕滿了（這棟房子最多 ${staffCap(state, home)} 人）`
  return undefined
}

/** 家僕在房子裡站的格子：園丁在院子，其他人在一樓（避開家具、樓梯與別人站的地方） */
function spotFor(state: GameState, home: Home, job: StaffJob, id: string): { area: string; x: number; y: number; until: number } {
  const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground') ?? Object.values(home.areas)[0]!
  const taken = new Set(Object.values(state.npcs ?? {}).filter((r) => r.at && r.id !== id).map((r) => `${r.at!.area}:${r.at!.x},${r.at!.y}`))
  const free = (kind: string) => ground.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.kind === kind && !c.furniture && !taken.has(`${ground.key}:${i % ground.width},${Math.floor(i / ground.width)}`))
  const list = (job === 'gardener' && free('yard').length ? free('yard') : free('floor'))
  const pick = list.length ? list[hashString(`${id}:spot`) % list.length]!.i : 0
  return { area: ground.key, x: pick % ground.width, y: Math.floor(pick / ground.width), until: 1e9 }
}

/** 雇用一位應徵者：先付第一天的工錢 */
export function hireStaff(state: GameState, id: string): Report {
  assertFree(state, '自己雇家僕')
  const home = homeHereOrThrow(state)
  const cand = candidates(state, home.location).find((r) => r.id === id)
  if (!cand) throw new Error('這位應徵者已經不在了')
  const refused = hireRefusal(state, home)
  if (refused) throw new Error(refused)
  const job = candidateJob(cand)
  const wage = wageHere(state, job)
  if (state.money_cc < wage) throw new Error(`錢不夠先付第一天的工錢（${formatMoney(wage)}）`)
  const rec: NpcRecord = structuredClone(cand)
  rec.staff = { home: home.id, job, wage_cc: wage, paidUntil: state.time.day, since: { ...state.time } }
  rec.at = spotFor(state, home, job, rec.id)
  registerNpc(state, rec)
  ensureRelationship(state, { id: rec.id, name: rec.name })
  const report = homeReport(state, 'social', 0.5, home.name)
  report.changes.money_cc = -wage
  report.outcome = {
    result: 'success',
    summary: `雇了${rec.name}在「${home.name}」當${jobName(job)}，日薪 ${formatMoney(wage)}，先付了第一天的工錢。`,
    tags: ['雇用家僕'],
  }
  return commitReport(state, report)
}

/** 欠了幾天工錢（day：算到第幾天，預設今天） */
export function owedDays(state: GameState, rec: NpcRecord, day = state.time.day): number {
  return rec.staff ? Math.max(0, day - rec.staff.paidUntil) : 0
}

export function owedWage(state: GameState, rec: NpcRecord): number {
  return owedDays(state, rec) * (rec.staff?.wage_cc ?? 0)
}

/** 這棟房子欠的工錢合計 */
export function homeOwed(state: GameState, homeId: string): number {
  return staffOf(state, homeId).reduce((n, r) => n + owedWage(state, r), 0)
}

/**
 * 用 budget 付工錢：從欠最久的人開始，付得了幾天就付幾天。回傳付了多少。
 * 回家結清（身上的錢）與管家（保險箱）共用。
 */
export function payFrom(state: GameState, homeId: string, budget: number, day = state.time.day): number {
  let left = budget
  for (const r of staffOf(state, homeId).sort((a, b) => a.staff!.paidUntil - b.staff!.paidUntil)) {
    const days = Math.min(owedDays(state, r, day), Math.floor(left / Math.max(1, r.staff!.wage_cc)))
    if (days <= 0) continue
    r.staff!.paidUntil += days
    left -= days * r.staff!.wage_cc
  }
  return budget - left
}

/** 結清工錢（身上的錢；不夠時付得了幾天就付幾天） */
export function payWages(state: GameState): Report {
  const home = homeHereOrThrow(state)
  const owed = homeOwed(state, home.id)
  if (!owed) throw new Error('沒有欠工錢')
  const paid = payFrom(state, home.id, state.money_cc)
  if (!paid) throw new Error('身上的錢連一天的工錢都不夠')
  const report = homeReport(state, 'trade', 0.2, home.name)
  report.changes.money_cc = -paid
  const left = homeOwed(state, home.id)
  report.outcome = {
    result: 'success',
    summary: `付了家僕的工錢 ${formatMoney(paid)}${left ? `，還欠 ${formatMoney(left)}` : '，都結清了'}。`,
    tags: ['付工錢'],
  }
  return commitReport(state, report)
}

/** 不再當家僕：回到城裡過日子（沒有活躍地點的人補上，免得找不到） */
function release(rec: NpcRecord) {
  delete rec.staff
  delete rec.at
  if (!rec.haunts?.length) rec.haunts = buildHaunts(new Rng(hashString(`${rec.id}:haunts`)), 'commoner', rec.tags?.length ? rec.tags : ['commoner'], locationById(rec.location))
}

/** 解雇：先結清欠的工錢，親密度不變 */
export function fireStaff(state: GameState, id: string): Report {
  const home = homeHereOrThrow(state)
  const rec = npcRecord(state, id)
  if (!rec?.staff || rec.staff.home !== home.id) throw new Error('這個人不是這棟房子的家僕')
  const owed = owedWage(state, rec)
  if (state.money_cc < owed) throw new Error(`要先結清欠${rec.name}的工錢（${formatMoney(owed)}）`)
  const job = rec.staff.job
  release(rec)
  const report = homeReport(state, 'social', 0.2, home.name)
  if (owed) report.changes.money_cc = -owed
  report.outcome = {
    result: 'success',
    summary: `${owed ? `結清了 ${formatMoney(owed)} 工錢，` : ''}請${rec.name}不用再當${jobName(job)}了。`,
    tags: ['解雇'],
  }
  return commitReport(state, report)
}

// ---- 每天 ----

/** 記一筆「你不在的時候」（同一句不重複，最多 40 筆） */
export function note(home: Home, day: number, text: string, tag: string) {
  if (home.staffNotes?.some((n) => n.text === text)) return
  ;(home.staffNotes ??= []).push({ text, tag, day })
  if (home.staffNotes.length > 40) home.staffNotes.splice(0, home.staffNotes.length - 40)
}

/** 欠薪太久：辭職，親密度下降，記一段記憶 */
function quit(state: GameState, home: Home, rec: NpcRecord, day: number) {
  const days = day - rec.staff!.paidUntil
  const job = rec.staff!.job
  release(rec)
  const rel = state.relationships?.[rec.id]
  if (rel) setAffinity(state, rec.id, rel.affinity + rules().quit_affinity)
  addMemory(state, {
    time: { day, hour: 8, minute: 0 }, location: home.location, scene: home.name, participants: ['pc', rec.id], importance: 1,
    summary: `${rec.name}在「${home.name}」當${jobName(job)}，被欠了 ${days} 天工錢，收拾東西辭職了。`,
  })
  note(home, day, `${rec.name}（${jobName(job)}）被欠了 ${days} 天工錢，辭職了。`, '辭職')
}

const minutesOf = (t: GameTime) => ((t.day - 1) * 24 + (t.hour ?? 0)) * 60 + (t.minute ?? 0)
const timeAt = (m: number): GameTime => ({ day: Math.floor(m / 1440) + 1, hour: Math.floor((m % 1440) / 60), minute: m % 60 })

/** 管家的一天：從保險箱付工錢（到 day 為止欠的）；回傳付了多少，錢不夠時 short 為 true */
function stewardPays(state: GameState, home: Home, day: number): { paid: number; short: boolean } {
  if (!staffOf(state, home.id).some((r) => r.staff!.job === 'steward')) return { paid: 0, short: false }
  const owed = staffOf(state, home.id).reduce((n, r) => n + owedDays(state, r, day) * r.staff!.wage_cc, 0)
  if (!owed) return { paid: 0, short: false }
  const paid = payFrom(state, home.id, homeMoney(home), day)
  takeHomeMoney(home, paid)
  return { paid, short: paid < owed }
}

/** 管家的提醒：再一天就要辭職的人、剛成熟的作物（沒有園丁時） */
function stewardWarns(state: GameState, home: Home, day: number, from: number, until: number) {
  if (!staffOf(state, home.id).some((r) => r.staff!.job === 'steward')) return
  for (const r of staffOf(state, home.id)) {
    if (owedDays(state, r, day) === rules().quit_days) note(home, day, `管家提醒：${r.name}已經欠了 ${rules().quit_days} 天工錢，明天再不付就要辭職了。`, '提醒')
  }
  if (hasWorker(state, home.id, 'gardener')) return
  for (const a of Object.values(home.areas)) {
    for (const c of a.cells) {
      const spec = c.crop && plotPlace(a, c) ? seedOf(c.crop.seed) : undefined
      if (!spec) continue
      const ripe = minutesOf(c.crop!.planted) + spec.days * 1440
      if (ripe > from && ripe <= until) note(home, day, `管家提醒：${c.furniture}的${c.crop!.seed}可以收成了。`, '提醒')
    }
  }
}

/** 園丁的一天：把到 until（分鐘）為止成熟的作物收進箱子；箱子裡有同樣的種子時，在成熟的那一刻重新播種 */
interface GardenLog { got: Map<string, number>; replanted: number; full: boolean }
function tendGarden(state: GameState, home: Home, until: number, log: GardenLog) {
  if (!hasWorker(state, home.id, 'gardener')) return
  for (const a of Object.values(home.areas)) {
    for (const c of a.cells) {
      if (!c.crop || !plotPlace(a, c)) continue
      // 一次可能跨過好幾輪（短天數的作物、很久沒回來）
      for (let guard = 0; c.crop && guard < 30; guard++) {
        const spec = seedOf(c.crop.seed)
        if (!spec) break
        const ripe: number = minutesOf(c.crop.planted) + spec.days * 1440
        if (ripe > until) break
        const [name, n] = withRng(state, (rng) => [rng.pick(spec.yields), rng.int(spec.qty[0], spec.qty[1])] as const)
        // 箱子放不下：留在苗圃上等你回來收
        if (!storeInHome(state, home, name, n)) {
          log.full = true
          break
        }
        log.got.set(name, (log.got.get(name) ?? 0) + n)
        const seed: string = c.crop.seed
        delete c.crop
        if (removeFromHome(home, seed, 1)) {
          c.crop = { seed, planted: timeAt(ripe) }
          log.replanted++
        }
      }
    }
  }
}

/**
 * 跨過的每一天（state.ts 的 advanceTime、commitReport 呼叫）：欠薪太久的家僕辭職、園丁收成。
 * 管家、做家務的奴隸也在這裡（H3、H4）。主角不在時發生的事記在房子的 staffNotes。
 */
export function staffDaily(state: GameState, fromDay: number, toDay: number) {
  if (!state.homes || toDay <= fromDay) return
  // 擴建：到了完工的那天（homeExpand.ts）
  settleConstruction(state)
  const start = Math.max(fromDay + 1, toDay - 60)
  const now = minutesOf(state.time)
  const logs = new Map<string, GardenLog>()
  const pay = new Map<string, { paid: number; short: boolean }>()
  for (let day = start; day <= toDay; day++) {
    for (const home of Object.values(state.homes)) {
      // 管家先從保險箱付錢，付不出來的才會欠到辭職
      const p = stewardPays(state, home, day)
      const sum = pay.get(home.id) ?? { paid: 0, short: false }
      pay.set(home.id, { paid: sum.paid + p.paid, short: sum.short || p.short })
      for (const rec of staffOf(state, home.id)) if (day - rec.staff!.paidUntil > rules().quit_days) quit(state, home, rec, day)
      // 這一天的範圍（第一天往前包含上一次跨日的那天，重複的提醒在 note 裡略過）
      stewardWarns(state, home, day, (day === start ? day - 2 : day - 1) * 1440, Math.min(day * 1440, now))
      const log = logs.get(home.id) ?? { got: new Map(), replanted: 0, full: false }
      logs.set(home.id, log)
      tendGarden(state, home, Math.min(day * 1440, now), log)
      choreDaily(state, home)
      // 客房：留守的夥伴住在生效的客房裡，親密度上升（rooms.ts）
      guestDaily(state, home, day, (id, d) => { const rel = state.relationships?.[id]; if (rel) setAffinity(state, id, rel.affinity + d) })
    }
    // 同居的人（cohabit.ts）：親密度上升、處不來就搬走
    cohabitDaily(state, day)
  }
  for (const [id, p] of pay) {
    if (p.paid || p.short) note(state.homes[id]!, toDay, `${p.paid ? `管家從保險箱付了 ${formatMoney(p.paid)} 工錢。` : ''}${p.short ? '保險箱的錢不夠付工錢。' : ''}`, '付工錢')
  }
  for (const [id, log] of logs) {
    if (!log.got.size && !log.full) continue
    const got = [...log.got].map(([n, q]) => `${n}×${q}`).join('、')
    note(state.homes[id]!, toDay, `${got ? `園丁收成了${got}，收進箱子${log.replanted ? `，重新播種了 ${log.replanted} 次` : ''}。` : ''}${log.full ? '箱子滿了，有作物還留在苗圃上。' : ''}`, '收成')
  }
}

/** 看過主角不在時家裡發生的事：寫進日誌，清掉 */
export function ackStaffNotes(state: GameState): Report {
  const home = homeHereOrThrow(state)
  const notes = home.staffNotes ?? []
  if (!notes.length) throw new Error('家裡沒有新的事')
  delete home.staffNotes
  const report = homeReport(state, 'social', 0, home.name)
  report.outcome = {
    result: 'success',
    summary: `你不在的時候，「${home.name}」：${notes.map((n) => n.text).join('')}`,
    tags: [...new Set(['家務', ...notes.map((n) => n.tag)])],
  }
  return commitReport(state, report)
}

/** 這一格所在的房子（給畫面用：站在別人家裡時沒有） */
export function staffHome(state: GameState, area: Area): Home | undefined {
  const home = homeOfArea(state, area)
  return home && !home.master ? home : undefined
}

// ---- 請認識的人來家裡做事（主動行動 staff_invite，target「NPC id:職位」） ----

export function parseStaffInvite(target: string | undefined): { id: string; job: StaffJob } {
  const [id, job] = (target ?? '').split(':')
  if (!id || !STAFF_JOBS.includes(job as StaffJob)) throw new Error('要請誰、做什麼？')
  return { id, job: job as StaffJob }
}

/** 請來的人住哪一棟：站在自己的房子裡就是這一棟，否則是這座城裡還有空位的第一棟 */
export function inviteHome(state: GameState): Home | undefined {
  const here = ownHomeOfArea(state, currentArea(state))
  if (here) return here
  return Object.values(state.homes ?? {}).find((h) => h.location === state.location && !h.master && !hireRefusal(state, h))
}

/** 不能請這個人來家裡做事的原因（沒有時可以；介面用來停用按鈕） */
export function staffInviteRefusal(state: GameState, id: string): string | undefined {
  if (isBound(state)) return '被主人帶著時不能自己雇人'
  const rec = npcRecord(state, id)
  if (!rec) return '你不認識這個人'
  if (npcKind(rec) !== 'commoner') return '只能請普通人（冒險者要雇用或邀請入隊）'
  if (rec.staff) return `${rec.name}已經在你家做事了`
  if (!rec.haunts?.length && npcSpot(rec)) return `${rec.name}得顧自己的店`
  if (isUnhireable(id) || rec.tags?.includes('slave') || rec.dead || rec.hostile) return `${rec.name}不會來當家僕`
  const rel = state.relationships?.[id]
  if (!rel || rel.affinity < rules().invite_affinity) return `親密度要 ${rules().invite_affinity} 以上`
  if (state.flags[`invite_wait:${id}`]) return `${rec.name}說要再想想，下次長休後再問`
  const home = inviteHome(state)
  if (!home) return Object.values(state.homes ?? {}).some((h) => h.location === state.location && !h.master) ? '這座城的房子家僕都滿了' : '這座城沒有你的房子'
  return undefined
}

export function staffInviteDc(state: GameState, id: string): number {
  const rec = npcRecord(state, id)!
  const rel = state.relationships?.[id]
  return rules().invite_dc - Math.floor((rel?.affinity ?? 0) / 10) + tagDcMod(rec, 'invite')
}

export function setupStaffInvite(state: GameState, target: string | undefined) {
  const { id, job } = parseStaffInvite(target)
  const why = staffInviteRefusal(state, id)
  if (why) throw new Error(why)
  if (!presentHere(state, id)) throw new Error('要走到他旁邊才能開口')
  const rec = npcRecord(state, id)!
  const home = inviteHome(state)!
  return {
    dc: staffInviteDc(state, id), targetName: rec.name, situational: [], scene: locationById(state.location).name,
    outcomes: {
      critical: `答應到「${home.name}」當${jobName(job)}，親密度 +3`, success: `答應到「${home.name}」當${jobName(job)}`,
      partial: '要再想想（下次長休後才能再問）', fail: '婉拒（親密度 -2）', fumble: '覺得被看輕了（親密度 -5）',
    } as Partial<Record<Degree, string>>,
  }
}

export function applyStaffInvite(state: GameState, report: Report, target: string, degree: Degree): string {
  const { id, job } = parseStaffInvite(target)
  const rec = npcRecord(state, id)!
  const home = inviteHome(state)
  if ((degree === 'critical' || degree === 'success') && home) {
    rec.staff = { home: home.id, job, wage_cc: wageHere(state, job), paidUntil: state.time.day, since: { ...state.time } }
    rec.at = spotFor(state, home, job, rec.id)
    registerNpc(state, rec)
    if (degree === 'critical') addAffinity(state, report, id, 3, '很高興能來幫忙')
    return `${rec.name}答應到「${home.name}」當${jobName(job)}，日薪 ${formatMoney(rec.staff.wage_cc)}，從明天開始算。`
  }
  ;(report.changes.flags ??= {})[`invite_wait:${id}`] = true
  if (degree === 'partial') return `${rec.name}有些心動，但說要再想想。`
  addAffinity(state, report, id, degree === 'fumble' ? -5 : -2, '請他來當家僕被拒')
  return degree === 'fumble' ? `${rec.name}覺得被看輕了，冷冷地拒絕。` : `${rec.name}婉拒了。`
}

// ---- 奴隸做家務 ----

/** 能分派的家務（管家要雇人） */
export const CHORE_JOBS: StaffJob[] = ['maid', 'cook', 'gardener']

/** 不能分派這個奴隸做家務的原因（沒有時可以） */
export function choreRefusal(state: GameState, id: string): string | undefined {
  const rec = npcRecord(state, id)
  const c = rec?.character
  if (!rec || !c || !isOwnSlave(state, c)) return '只有你的奴隸能分派家務'
  if (!rec.staying || !state.homes?.[rec.staying]) return '要留在家裡才能做家務'
  const need = rules().slave_chore_submission
  if ((lewdOf(c).submission ?? 0) < need) return `${c.name}還不夠順從（順從要 ${need} 以上）`
  return undefined
}

/** 分派（或取消，job 為 null）留在家裡的奴隸做家務 */
export function assignChore(state: GameState, id: string, job: StaffJob | null) {
  const home = homeHereOrThrow(state)
  const rec = npcRecord(state, id)
  if (!rec || rec.staying !== home.id) throw new Error('這個人沒有留在這棟房子')
  if (job === null) {
    delete rec.chore
    return
  }
  if (!CHORE_JOBS.includes(job)) throw new Error('奴隸不能當管家')
  const why = choreRefusal(state, id)
  if (why) throw new Error(why)
  rec.chore = job
}

/** 做家務的奴隸每天順從上升 */
function choreDaily(state: GameState, home: Home) {
  for (const r of choreSlaves(state, home.id)) addLewd(state, r.character!, 'submission', rules().slave_chore_daily)
}

/** 在自己的房子裡行動時，場景帶上家裡的僕人（交給 AI）：雇來的家僕與做家務的奴隸；還有同居的人（cohabit.ts） */
export function withHomeStaff(state: GameState, scene: string): string {
  const home = ownHomeOfArea(state, currentArea(state))
  if (!home) return scene
  const list = [
    ...staffOf(state, home.id).map((r) => `${r.name}（${jobName(r.staff!.job)}）`),
    ...choreSlaves(state, home.id).map((r) => `${r.name}（奴隸，做${jobName(r.chore!)}的家務）`),
  ]
  const mates = cohabitScene(state, home)
  return [scene, ...(list.length ? [`家裡的僕人：${list.join('、')}`] : []), ...(mates ? [mates] : [])].join('・')
}
