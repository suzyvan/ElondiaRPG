// 房屋設定（docs/HOMES.md 第 8 節）：homes.json 的家僕與舒適度數值，內容頁籤「🎒 物品」的「⚙️ 房屋設定」。
// 只有一筆（ContentMods.homes 的 rules）。套用時直接改 homes.json 載入的物件（data.ts 的 homeRules 就是它），恢復預設時套回快照。
// 能改的：職位的名稱與日薪、女僕的舒適度、各地段的家僕上限、欠薪辭職的天數、應徵者、請認識的人、奴隸做家務、舒適度三段的門檻。
// 職位的種類與效果是程式固定的，不能新增。

import homesJson from '@data/rules/homes.json'
import { STAFF_JOBS } from './data'

/** 內建的成套家具（設定頁的欄位依這份產生；新的套組不能從設定頁新增） */
const SETS = (homesJson as unknown as { furniture_sets: Record<string, { name: string }> }).furniture_sets
const SET_IDS = Object.keys(SETS).filter((k) => !k.startsWith('$'))

export interface HomeField { path: string; label: string; min: number; max: number; step: number; hint?: string }
export interface HomeGroup { name: string; fields: HomeField[] }

const f = (path: string, label: string, min: number, max: number, step: number, hint?: string): HomeField => ({ path, label, min, max, step, ...(hint ? { hint } : {}) })

/** 設定頁的數值欄位（依分組）；職位的名稱另外是文字欄位（HOME_TEXT_FIELDS） */
export const HOME_GROUPS: HomeGroup[] = [
  { name: '舒適度', fields: [
    f('comfort_tiers.0.at', '睡得香甜的舒適度', 1, 99, 1, '家具、女僕與成套家具的舒適度合計到這裡時，在家長休後睡得香甜'),
    f('comfort_tiers.1.at', '精神飽滿的舒適度', 1, 99, 1, '三段由低到高；存的時候後一段至少比前一段多 1'),
    f('comfort_tiers.2.at', '神采奕奕的舒適度', 1, 99, 1),
  ] },
  { name: '職位', fields: [
    f('staff.jobs.maid.wage_cc', '女僕的日薪（白鸛）', 0, 1000, 1),
    f('staff.jobs.maid.comfort', '女僕加的舒適度', 0, 10, 1),
    f('staff.jobs.cook.wage_cc', '廚師的日薪（白鸛）', 0, 1000, 1),
    f('staff.jobs.gardener.wage_cc', '園丁的日薪（白鸛）', 0, 1000, 1),
    f('staff.jobs.steward.wage_cc', '管家的日薪（白鸛）', 0, 1000, 1),
    f('staff.steward_bonus', '有管家時上限再加', 0, 5, 1),
  ] },
  { name: '家僕的上限', fields: [
    f('staff.caps.cottage', '小屋', 0, 10, 1),
    f('staff.caps.townhouse', '連棟房屋', 0, 10, 1),
    f('staff.caps.house', '宅邸', 0, 10, 1),
    f('staff.caps.manor', '豪宅', 0, 10, 1),
  ] },
  { name: '工錢與應徵', fields: [
    f('staff.quit_days', '欠工錢幾天以上就辭職', 1, 60, 1),
    f('staff.quit_affinity', '辭職時親密度的變化', -50, 0, 1),
    f('staff.refresh_days', '應徵者每幾天換一批', 1, 60, 1),
    f('staff.candidates_per_job.0', '每個職位的應徵者：最少', 0, 5, 1),
    f('staff.candidates_per_job.1', '每個職位的應徵者：最多', 0, 5, 1),
  ] },
  { name: '成套家具', fields: SET_IDS.flatMap((id) => [
    f(`furniture_sets.${id}.need`, `${SETS[id]!.name}：湊齊幾件`, 1, 20, 1),
    f(`furniture_sets.${id}.comfort`, `${SETS[id]!.name}：舒適度 +`, 0, 20, 1),
  ]) },
  { name: '請認識的人、奴隸做家務', fields: [
    f('staff.invite_affinity', '請認識的人：親密度至少', -100, 100, 1),
    f('staff.invite_dc', '請認識的人：參考 DC（減去親密度 / 10）', 5, 30, 1),
    f('staff.slave_chore_submission', '奴隸做家務：順從至少', 0, 100, 1),
    f('staff.slave_chore_daily', '奴隸做家務：每天順從 +', 0, 5, 1),
  ] },
]

export const HOME_FIELDS = HOME_GROUPS.flatMap((g) => g.fields)

/** 文字欄位：職位的名稱與職業描述（照性別換稱謂） */
export const HOME_TEXT_FIELDS: { path: string; label: string }[] = [...SET_IDS.map((id) => ({ path: `furniture_sets.${id}.name`, label: `成套家具「${SETS[id]!.name}」的名稱` })), ...STAFF_JOBS.flatMap((j) => [
  { path: `staff.jobs.${j}.name`, label: `${(homesJson as { staff: { jobs: Record<string, { name: string }> } }).staff.jobs[j]!.name}的名稱` },
  { path: `staff.jobs.${j}.occupation`, label: `${(homesJson as { staff: { jobs: Record<string, { name: string }> } }).staff.jobs[j]!.name}的職業描述` },
])]

export type HomeRulesMod = Record<string, unknown>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const data = homesJson as unknown as Record<string, unknown>
const snapshot = clone(data)

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

/** 沿路徑寫值；路徑的下一段是數字時建立陣列（應徵者的 [最少, 最多]） */
function set(obj: Record<string, unknown>, path: string, v: unknown) {
  const keys = path.split('.')
  let o: Record<string, unknown> = obj
  keys.slice(0, -1).forEach((k, i) => {
    o = ((o[k] ??= /^\d+$/.test(keys[i + 1]!) ? [] : {}) as Record<string, unknown>)
  })
  o[keys.at(-1)!] = v
}

/** 設定頁能改的部分（數值與文字）：從 homes.json 取出 */
function pick(src: unknown): HomeRulesMod {
  const out: HomeRulesMod = {}
  for (const fd of HOME_FIELDS) set(out, fd.path, get(src, fd.path))
  for (const fd of HOME_TEXT_FIELDS) set(out, fd.path, get(src, fd.path))
  return out
}

/** 內建的設定（模組載入時的快照） */
export function builtinHomeRules(): HomeRulesMod {
  return pick(snapshot)
}

/** 目前生效的設定 */
export function currentHomeRules(): HomeRulesMod {
  return pick(data)
}

/** 整理：從內建的開始，只收欄位清單裡的數值（夾在範圍內）與名稱（1～8 個字）；應徵者的最多不小於最少 */
export function sanitizeHomeRules(raw: unknown): HomeRulesMod {
  const out = builtinHomeRules()
  for (const fd of HOME_FIELDS) {
    const v = get(raw, fd.path)
    const n = Number(v)
    if (v === undefined || v === '' || v === null || !Number.isFinite(n)) continue
    set(out, fd.path, Math.round(Math.max(fd.min, Math.min(fd.max, n))))
  }
  for (const fd of HOME_TEXT_FIELDS) {
    const v = get(raw, fd.path)
    if (typeof v === 'string' && v.trim()) set(out, fd.path, [...v.trim()].slice(0, 8).join(''))
  }
  // 舒適度的分段由低到高
  let prev = 0
  for (let i = 0; i < 3; i++) {
    const at = Math.max(prev + 1, Number(get(out, `comfort_tiers.${i}.at`)))
    set(out, `comfort_tiers.${i}.at`, at)
    prev = at
  }
  const lo = Number(get(out, 'staff.candidates_per_job.0'))
  if (Number(get(out, 'staff.candidates_per_job.1')) < lo) set(out, 'staff.candidates_per_job.1', lo)
  return out
}

/** 套用設定：只改欄位清單裡的值（原地改，data.ts 的 homeRules 拿著同一份） */
export function applyHomeRules(r: HomeRulesMod) {
  for (const fd of [...HOME_FIELDS, ...HOME_TEXT_FIELDS]) {
    const v = get(r, fd.path)
    if (v !== undefined) set(data, fd.path, v)
  }
}

/** 恢復內建的設定 */
export function restoreHomeRules() {
  applyHomeRules(pick(snapshot))
}
