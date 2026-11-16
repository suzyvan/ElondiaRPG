// 家僕（見 docs/HOMES.md 第 8 節；規則在 data/rules/homes.json 的 staff）：
// - 在自己的房子雇普通人做家務：女僕（舒適度）、廚師（在家長休後的早餐）、園丁（每天收成、重新播種）、管家（上限 +1、從保險箱付工錢）。
// - 家僕不入隊，住在房子裡（NPC 登錄的 staff 與 at），出現在「這裡的人」；同一個職位雇好幾個人時效果不疊加。
// - 應徵者每座城每幾天換一批（亂數只看世界種子、地點與第幾批），雇下才寫進 NPC 登錄。
// - 工錢欠著（記 paidUntil），回家時結清；欠超過 quit_days 天的人辭職。主角不在時發生的事記在房子的 staffNotes，回家時看。
// - 自己的奴隸留在家裡時可以分派家務（chore）：不用工錢、不佔上限，效果和雇來的人一樣。

import { homeRules, locationById, npcTags, STAFF_JOBS, type StaffJob, type StaffJobDef } from './data'
import { currentArea, type Area } from './grid'
import { homeOfArea, homeReport, ownHomeOfArea, workbenchFor } from './homes'
import { formatMoney } from './money'
import { generateNpc, hashString, npcRecord, registerNpc } from './npcs'
import { assertFree, gainCondition } from './party'
import { buildHaunts } from './population'
import { Rng } from './rng'
import { addMemory, ensureRelationship, setAffinity } from './social'
import { commitReport } from './state'
import { locationMult } from './trade'
import type { GameState, Home, NpcRecord, Report } from './types'

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
  return Object.values(state.npcs ?? {}).filter((r) => r.staying === homeId && !!r.chore && r.character?.bond === 'slave')
}

/** 做這份家務的人：雇來的家僕與分派了家務的奴隸 */
export function workersFor(state: GameState, homeId: string, job: StaffJob): NpcRecord[] {
  return [...staffOf(state, homeId).filter((r) => r.staff!.job === job), ...choreSlaves(state, homeId).filter((r) => r.chore === job)]
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

/** 欠了幾天工錢 */
export function owedDays(state: GameState, rec: NpcRecord): number {
  return rec.staff ? Math.max(0, state.time.day - rec.staff.paidUntil) : 0
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
export function payFrom(state: GameState, homeId: string, budget: number): number {
  let left = budget
  for (const r of staffOf(state, homeId).sort((a, b) => a.staff!.paidUntil - b.staff!.paidUntil)) {
    const days = Math.min(owedDays(state, r), Math.floor(left / Math.max(1, r.staff!.wage_cc)))
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

function note(home: Home, day: number, text: string, tag: string) {
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

/**
 * 跨過的每一天（state.ts 的 advanceTime、commitReport 呼叫）：欠薪太久的家僕辭職。
 * 園丁、管家、做家務的奴隸也在這裡（H2～H4）。
 */
export function staffDaily(state: GameState, fromDay: number, toDay: number) {
  if (!state.homes || toDay <= fromDay) return
  const start = Math.max(fromDay + 1, toDay - 60)
  for (let day = start; day <= toDay; day++) {
    for (const home of Object.values(state.homes)) {
      for (const rec of staffOf(state, home.id)) if (day - rec.staff!.paidUntil > rules().quit_days) quit(state, home, rec, day)
    }
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
