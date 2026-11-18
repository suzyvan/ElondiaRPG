// 寄生物（docs/ADULT_EVENTS.md 第 6 節）：寄生裝備、淫紋（詛咒印記）、寄生種子。只有主角會有，存在角色身上（Character.parasites）。
// - 侵蝕度 0～100 決定階段（潛伏、發作、共生、支配）；各階段有很輕的被動效果（檢定加減，算在 perks.ts 的 checkModifiers）。
// - 寄生裝備鎖住它的欄位（EquippedGear.locked = parasite:<id>，不綁契約）；淫紋是刺青的一種（kind: curse），未馴服時洗不掉，
//   只有奴隸印記能把它頂掉（頂掉時沉睡，刻印師可以紋回來）；馴服之後可以自由洗掉、換掉，之後也能紋回來。
// - 馴服（任務的結局）：寄生裝備換成馴服後的物品、淫紋變成已馴服的印記；不再自動發作，可以主動觸發（parasiteEvents.ts）。
// 規則與定義在 data/rules/parasites.json；發作事件在 travel_events.json（scope: parasite）。

import parasitesJson from '@data/rules/parasites.json'
import { enemies, itemDef, lewdRules, type AttrId, type CheckFilter, type Mods } from './data'
import { addLewdStat } from './lewd'
import { schoolsOf } from './schools'
import { placeName, tattooAt, tattoosOf } from './tattoos'
import type { Character, GameTime, GearSlot, ParasiteState, Tattoo, TattooPlace } from './types'

export interface ParasiteStage {
  min: number
  name: string
  /** 這個階段發作的機率倍率 */
  chance_mult?: number
}

export interface ParasiteDef {
  name: string
  kind: 'gear' | 'mark' | 'seed'
  /** 分類：可馴服（任務線把它馴服）、短期寄生（長到最後由發作事件拿掉）、苗床（怪物造成，長到支配時產下；docs/FAMILY.md 第 13 節）；沒寫時有 tamed 是可馴服（parasiteMods.ts 的 parasiteCategory） */
  category?: 'tameable' | 'short' | 'brood'
  /** 苗床：卵生、胎生（要有子宮）、寄生；產下的物品、胎生的幼體、寄生共生時的特質 */
  brood?: BroodDef
  desc: string
  /** 寄生裝備：寄生的物品（items.json）與鎖住的欄位 */
  item?: string
  slot?: GearSlot
  /** 陽剛體型的主角附著的版本（渴求的魔導衣 → 裹住肉棒的魔導套）：物品、欄位、馴服之後的物品 */
  masc?: { item: string; slot: GearSlot; tamed_item?: string }
  /** 淫紋：刻在哪個部位、印記的名稱與外觀 */
  place?: TattooPlace
  mark?: { name: string; desc: string }
  /** 每天自己增長的侵蝕度（例如種子會長大） */
  grow_per_day?: number
  /** 各階段的被動效果（依階段的順序；每一項是一種檢定的加減） */
  stage_effects?: { check: CheckFilter; bonus: number }[][]
  /** 各階段給的戰鬥技能（還沒馴服時；不佔攜帶上限） */
  stage_abilities?: string[][]
  /** 各階段開戰時帶著的慾望（慾望上限的比例；失控） */
  stage_lust?: number[]
  /** 受孕倍率（docs/FAMILY.md 第 3 節）：侵蝕度到 min 以上、沒有沉睡時，受孕的機率 × mult */
  fertility?: { min: number; mult: number }
  /** 解咒：DC 與價錢的基準（侵蝕度越高越難、越貴）；沒有時不能解咒 */
  remove?: { dc: number; price: number }
  /** 刻印師把淫紋紋回來的價錢 */
  reink_price?: number
  /** 解咒時中止的任務線（stories.json 的 id）；連同這個前綴的劇情旗標一起清掉，之後再被寄生可以重來 */
  stories?: string[]
  flag_prefix?: string
  /** 馴服之後：物品（寄生裝備）或印記（淫紋）、主動觸發的親密場景與結果 */
  tamed?: {
    item?: string
    mark?: { name: string; desc: string; attrs?: Partial<Record<AttrId, number>>; check?: CheckFilter; bonus?: number }
    scene: string
    text: string
    /** 主動觸發之後得到的非戰鬥狀態（companions.json 的 conditions） */
    buff?: string
    /** 獸蟲派：馴服之後變成這個戰鬥技能（每場戰鬥一次） */
    ability?: string
  }
}

export type BroodKind = 'egg' | 'live' | 'parasite'

export interface BroodDef {
  kind: BroodKind
  /** 產下（卵生）、排出（寄生）的物品與數量範圍 */
  yields?: { item: string; qty: [number, number] }[]
  /** 胎生的魔物幼體：名字、幾隻、交給魔物學者每隻多少錢 */
  offspring?: { name: string; count: [number, number]; value_cc: number; pet?: string }
  /** 卵生：修了獸蟲派的人可以留一顆孵化認主，學會這個技能（流派技能，不佔攜帶上限） */
  hatch?: string
  /** 寄生：修了獸蟲派的人破繭時可以共生，得到這個特質 */
  symbiosis?: string
}

/** 苗床的共用規則（parasites.json 的 brood_rules） */
export interface BroodRules {
  defeat: { fail: number; fumble: number }
  extract: { dc: number; price: number; attr: AttrId }
  egg_check: { attr: AttrId; dc: number }
  parasite_check: { attr: AttrId; dc: number }
  live_lactation_days: number
  title_births: number
}

export interface ParasiteRules {
  step_chance: number
  travel_chance: number
  rest_chance: number
  cooldown_hours: number
  /** 同一件發作至少隔幾小時才會再出現（沒寫時 72） */
  repeat_hours?: number
  stages: ParasiteStage[]
  /** 發作的檢定難度：普通 = base + 等級 × per_level（四捨五入）+ 階段的加減；選項寫的 DC 以 14 為「普通」 */
  dc?: { base: number; per_level: number; stages: number[] }
  /** 解咒的地方：神殿用信仰、刻印師用智力 */
  remove: Record<'temple' | 'carver', { name: string; attr: AttrId }>
  parasites: Record<string, ParasiteDef>
  brood_rules?: BroodRules
}

export const parasiteRules = parasitesJson as unknown as ParasiteRules

/** 寄生裝備的鎖：EquippedGear.locked 的前綴 */
export const PARASITE_LOCK = 'parasite:'

export function parasiteDef(id: string): ParasiteDef | undefined {
  return parasiteRules.parasites[id]
}

export function parasitesOf(c: Pick<Character, 'parasites'> | undefined): ParasiteState[] {
  return c?.parasites ?? []
}

export function parasiteOf(c: Pick<Character, 'parasites'> | undefined, id: string): ParasiteState | undefined {
  return parasitesOf(c).find((p) => p.id === id)
}

/** 侵蝕度對應的階段（0 潛伏 … 3 支配） */
export function stageOf(corruption: number): number {
  let s = 0
  parasiteRules.stages.forEach((st, i) => { if (corruption >= st.min) s = i })
  return s
}

export function stageName(corruption: number): string {
  return parasiteRules.stages[stageOf(corruption)]?.name ?? ''
}

/** 顯示用的階段：苗床沒有「發作」，標成「第 N 階段」；其他寄生物用階段名稱（潛伏、發作、共生、支配） */
export function stageLabel(p: { id: string; corruption: number }): string {
  return parasiteDef(p.id)?.category === 'brood' ? `第 ${stageOf(p.corruption) + 1} 階段` : stageName(p.corruption)
}

/** 會發作、有被動效果的寄生物：沒有沉睡、還沒馴服 */
export function activeParasites(c: Pick<Character, 'parasites'> | undefined): ParasiteState[] {
  return parasitesOf(c).filter((p) => !p.dormant && !p.tamed && parasiteDef(p.id))
}

/** 目前階段的被動效果 */
export function parasiteEffects(p: ParasiteState): { check: CheckFilter; bonus: number }[] {
  return parasiteDef(p.id)?.stage_effects?.[stageOf(p.corruption)] ?? []
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const dayOf = (t: GameTime) => t.day

/**
 * 依時間增長侵蝕度（例如種子）：上次增長之後過了幾天就加幾次。
 * 暫停時（沉睡、已馴服，或 paused 說發作關掉了）只把日子往前推、不增長，恢復時不會一次補上。
 */
export function growParasites(c: Character, now: GameTime, paused?: (p: ParasiteState) => boolean) {
  const active = new Set(activeParasites(c))
  for (const p of parasitesOf(c)) {
    const last = p.grown ?? dayOf(p.since)
    const days = dayOf(now) - last
    if (days <= 0) continue
    p.grown = dayOf(now)
    if (!active.has(p) || paused?.(p)) continue
    const grow = parasiteDef(p.id)?.grow_per_day ?? 0
    if (grow) {
      const before = p.corruption
      p.corruption = clamp(p.corruption + grow * days)
      corruptionGrowth(c, before, p.corruption)
    }
  }
}

/** 侵蝕度每跨過 10 點：淫亂 +1、敏感 +1（只算上升；docs/LEWD_STATS.md 第 14 節） */
export function corruptionGrowth(c: Character, before: number, after: number) {
  const steps = Math.floor(after / 10) - Math.floor(before / 10)
  if (steps <= 0) return
  addLewdStat(c, 'lewdness', steps)
  addLewdStat(c, 'sensitivity', steps)
}

/**
 * 寄生物給的戰鬥技能（不佔攜帶上限）：還沒馴服的依階段（魅魔的契紋：共生是魅惑之吻、支配再加傾國一笑），
 * 修了獸蟲派的人，馴服的寄生物變成每場戰鬥一次的技能
 */
export function parasiteAbilities(c: Character): string[] {
  const out: string[] = []
  const beast = schoolsOf(c).includes('beast')
  for (const p of parasitesOf(c)) {
    const def = parasiteDef(p.id)
    if (!def || p.dormant) continue
    if (p.tamed) {
      if (beast && def.tamed?.ability) out.push(def.tamed.ability)
    } else out.push(...(def.stage_abilities?.[stageOf(p.corruption)] ?? []))
  }
  return [...new Set(out)].filter((id) => !c.abilities.includes(id))
}

/**
 * 寄生類的雙面效應（docs/LEWD_STATS.md 第 14.1 節）：平常是各階段的檢定減值（stage_effects）；戰鬥中，修了任何流派的人，
 * 還沒馴服、沒有沉睡的寄生物依階段給修正，修了獸蟲派（fit_school）的人 × fit。active 是有效果的寄生物（角色詳情用）
 */
export function parasiteTwoFace(c: Character): { mods: Mods; lustBonus: number; active: { name: string; stage: string; mult: number }[] } {
  const out = { mods: {} as Mods, lustBonus: 0, active: [] as { name: string; stage: string; mult: number }[] }
  const r = lewdRules.parasite_two_face
  const schools = schoolsOf(c)
  if (!r || !schools.length) return out
  const mult = schools.includes(r.fit_school) ? r.fit : 1
  for (const p of parasitesOf(c)) {
    if (p.tamed || p.dormant) continue
    const stage = stageOf(p.corruption)
    const row = r.parasites[p.id]?.[stage]
    if (!row) continue
    let any = false
    for (const [k, v] of Object.entries(row)) {
      const n = Math.round((v ?? 0) * mult)
      if (!n) continue
      any = true
      if (k === 'lust_bonus') out.lustBonus += n
      else out.mods[k as keyof Mods] = (out.mods[k as keyof Mods] ?? 0) + n
    }
    if (any) out.active.push({ name: parasiteDef(p.id)?.name ?? p.id, stage: parasiteRules.stages[stage]?.name ?? '', mult })
  }
  return out
}

/** 失控：還沒馴服的寄生物在高的階段，開戰時帶著慾望（慾望上限的比例） */
export function parasiteStartLust(c: Character): number {
  return activeParasites(c).filter((p) => !p.tamed).reduce((s, p) => s + (parasiteDef(p.id)?.stage_lust?.[stageOf(p.corruption)] ?? 0), 0)
}

/** 侵蝕度加減（沉睡、已馴服的不動）；回傳說明 */
export function changeCorruption(c: Character, id: string, delta: number): string {
  const p = parasiteOf(c, id)
  const def = parasiteDef(id)
  if (!p || !def || p.dormant || p.tamed || !delta) return ''
  const before = stageOf(p.corruption)
  const raw = p.corruption
  p.corruption = clamp(p.corruption + delta)
  corruptionGrowth(c, raw, p.corruption)
  const after = stageOf(p.corruption)
  const stage = after !== before ? `，進入「${parasiteRules.stages[after]!.name}」` : ''
  return `${def.name}的侵蝕度${delta > 0 ? '上升' : '下降'}到 ${p.corruption}${stage}`
}

/**
 * 寄生：寄生裝備穿上並鎖住（原本那個欄位的東西放回行囊，由呼叫的人處理），淫紋刻在小腹（蓋掉原本的刺青，記下來）。
 * 已經有同一種寄生物、或小腹是奴隸印記時不寄生；回傳說明與換下來的裝備名稱。
 */
export function attachParasite(c: Character, id: string, time: GameTime, by?: string): { note: string; removed?: string } {
  const def = parasiteDef(id)
  if (!def) return { note: '' }
  if (parasiteOf(c, id)) return { note: `已經有${def.name}了` }
  const state: ParasiteState = { id, corruption: 0, since: { ...time }, grown: time.day }
  let removed: string | undefined
  // 說明寫穿上的那件的名字（陽剛體型是魔導套，不是魔導衣）
  let shown = def.name
  if (def.kind === 'gear') {
    // 陽剛體型：附著陽剛的版本（例如裹住肉棒的魔導套）
    const v = c.body === 'masc' && def.masc && itemDef(def.masc.item)?.gear ? def.masc : { item: def.item, slot: def.slot }
    const spec = v.item ? itemDef(v.item)?.gear : undefined
    if (!spec || !v.slot) return { note: '' }
    const gear = (c.gear ??= {})
    const old = gear[v.slot]
    if (old?.locked) return { note: `${def.name}沒有地方附著（那個欄位被鎖住了）` }
    removed = old?.name
    gear[v.slot] = { name: v.item!, spec, locked: `${PARASITE_LOCK}${id}` }
    if (v.item !== def.item) shown = v.item!
  } else if (def.kind === 'mark') {
    const place = def.place ?? 'belly'
    const there = tattooAt(c, place)
    if (there?.kind === 'slave') return { note: `${def.name}刻不上去：${placeName(place)}已經有奴隸印記` }
    if (there?.kind === 'curse') return { note: `${placeName(place)}已經有另一個詛咒印記` }
    if (there) {
      c.tattoos = tattoosOf(c).filter((t) => t !== there)
      state.covered = there
    }
    ;(c.tattoos ??= []).push({ kind: 'curse', place, name: def.mark?.name ?? def.name, desc: def.mark?.desc ?? def.desc, since: { ...time }, parasite: id, ...(by ? { by } : {}) })
  }
  ;(c.parasites ??= []).push(state)
  const cover = state.covered ? `（蓋掉了原本的「${state.covered.name ?? ''}」）` : ''
  return { note: `身上多了${shown}${cover}`, ...(removed ? { removed } : {}) }
}

/** 這個寄生物鎖住的裝備欄位（照鎖找，不照現在的定義：寄生之後改了欄位或種類也找得到） */
function lockedSlots(c: Character, id: string): GearSlot[] {
  return (Object.entries(c.gear ?? {}) as [GearSlot, { locked?: string } | undefined][])
    .filter(([, g]) => g?.locked === `${PARASITE_LOCK}${id}`).map(([slot]) => slot)
}

/** 這個寄生物的詛咒印記（照寄生物 id 找，不照現在的種類或部位） */
function curseMarks(c: Character, id: string): Tattoo[] {
  return tattoosOf(c).filter((t) => t.kind === 'curse' && t.parasite === id)
}

/**
 * 馴服：寄生裝備換成馴服後的物品、淫紋變成已馴服的印記；回傳說明。
 * 鎖住的裝備與印記照寄生時的樣子找（寄生之後在編輯器改了種類或欄位也一樣）：沒有馴服後的物品就只解鎖，
 * 沒有馴服後的印記就只標成已馴服（可以洗掉）
 */
export function tameParasite(c: Character, id: string): string {
  const p = parasiteOf(c, id)
  const def = parasiteDef(id)
  if (!p || !def || p.tamed) return ''
  p.tamed = true
  p.corruption = 0
  for (const slot of lockedSlots(c, id)) {
    // 附著的是陽剛的版本時，馴服後也換成陽剛的版本
    const item = def.masc && c.gear![slot]!.name === def.masc.item ? def.masc.tamed_item ?? def.tamed?.item : def.tamed?.item
    const spec = item ? itemDef(item)?.gear : undefined
    if (spec) c.gear![slot] = { name: item!, spec }
    else delete c.gear![slot]!.locked
  }
  const m = def.tamed?.mark
  for (const t of [...curseMarks(c, id), ...(p.stored ? [p.stored] : [])]) {
    if (m) applyTamedMark(t, m)
    else t.tamed = true
  }
  return `${def.name}被馴服了`
}

function applyTamedMark(t: Tattoo, m: NonNullable<NonNullable<ParasiteDef['tamed']>['mark']>) {
  t.tamed = true
  t.name = m.name
  t.desc = m.desc
  if (m.attrs) t.attrs = { ...m.attrs }
  else delete t.attrs
  if (m.check && m.bonus) t.unique = { check: m.check, bonus: m.bonus }
  else delete t.unique
}

/**
 * 身上的淫紋照現在的定義更新名稱與外觀（世界編輯器改過之後、讀檔時）：還沒馴服的照印記，馴服的照馴服後的印記（含屬性與檢定加值）。
 * 寄生之後改成別的種類的不動（拿掉時照寄生物 id 清掉）
 */
export function refreshParasiteMarks(chars: Character[]) {
  for (const c of chars) {
    for (const p of parasitesOf(c)) {
      const def = parasiteDef(p.id)
      if (def?.kind !== 'mark') continue
      for (const t of [...curseMarks(c, p.id), ...(p.stored ? [p.stored] : [])]) {
        const m = def.tamed?.mark
        if (t.tamed) {
          if (m) applyTamedMark(t, m)
        } else {
          t.name = def.mark?.name ?? def.name
          t.desc = def.mark?.desc ?? def.desc
        }
      }
    }
  }
}

/** 拿掉寄生物（解咒成功、種子產下）：寄生裝備消失、淫紋洗掉；照寄生時的鎖與印記找，不照現在的定義。回傳說明 */
export function detachParasite(c: Character, id: string): string {
  const p = parasiteOf(c, id)
  const def = parasiteDef(id)
  if (!p) return ''
  for (const slot of lockedSlots(c, id)) delete c.gear![slot]
  c.tattoos = tattoosOf(c).filter((t) => !(t.kind === 'curse' && t.parasite === id))
  // 被淫紋蓋掉的刺青留下來，之後還能到刻印師紋回來
  if (p.covered) (c.coveredTattoos ??= []).push({ parasite: id, tattoo: p.covered })
  c.parasites = parasitesOf(c).filter((x) => x !== p)
  return `${def?.name ?? '寄生物'}離開了你的身體`
}

/**
 * 奴隸印記頂掉淫紋（tattoos.ts 的 setContract 呼叫）：未馴服的淫紋沉睡；已馴服的只是不在身上。
 * 兩種都記下來，之後可以到刻印師紋回來。
 */
export function displaceCurse(c: Character, t: Tattoo) {
  const p = t.parasite ? parasiteOf(c, t.parasite) : undefined
  if (!p) return
  p.stored = t
  if (!p.tamed) p.dormant = true
}

/** 洗掉已馴服的淫紋：記下來，之後可以紋回來 */
export function storeTamedCurse(c: Character, t: Tattoo) {
  const p = t.parasite ? parasiteOf(c, t.parasite) : undefined
  if (p) p.stored = t
}

/** 可以紋回來的印記：記下來的淫紋（部位空著、而且不是被奴隸印記佔著）與被淫紋蓋掉的刺青 */
export function reinkable(c: Character): { parasite: string; tattoo: Tattoo; kind: 'curse' | 'covered'; price: number }[] {
  const out: { parasite: string; tattoo: Tattoo; kind: 'curse' | 'covered'; price: number }[] = []
  for (const p of parasitesOf(c)) {
    const def = parasiteDef(p.id)
    if (p.stored && !tattooAt(c, p.stored.place)) out.push({ parasite: p.id, tattoo: p.stored, kind: 'curse', price: def?.reink_price ?? 500 })
    if (p.covered && !tattooAt(c, p.covered.place)) out.push({ parasite: p.id, tattoo: p.covered, kind: 'covered', price: def?.reink_price ?? 500 })
  }
  // 淫紋已經拿掉、留下來的被蓋掉的刺青（同一種寄生物還在身上、也蓋著刺青時先列它的）
  for (const k of c.coveredTattoos ?? []) {
    if (out.some((o) => o.parasite === k.parasite && o.kind === 'covered') || tattooAt(c, k.tattoo.place)) continue
    out.push({ parasite: k.parasite, tattoo: k.tattoo, kind: 'covered', price: parasiteDef(k.parasite)?.reink_price ?? 500 })
  }
  return out
}

/** 紋回來（刻印師）：回傳說明 */
export function reinkTattoo(c: Character, parasite: string, kind: 'curse' | 'covered', time: GameTime): string {
  const p = parasiteOf(c, parasite)
  const kept = kind === 'covered' && !p?.covered ? c.coveredTattoos?.find((k) => k.parasite === parasite) : undefined
  const t = kind === 'curse' ? p?.stored : (p?.covered ?? kept?.tattoo)
  if (!t || (!p && !kept)) throw new Error('沒有可以紋回來的印記')
  if (tattooAt(c, t.place)) throw new Error(`${placeName(t.place)}已經有刺青了`)
  ;(c.tattoos ??= []).push({ ...t, since: { ...time } })
  if (kept) c.coveredTattoos = c.coveredTattoos!.filter((k) => k !== kept)
  else if (kind === 'curse') {
    delete p!.stored
    delete p!.dormant
    // 沉睡的日子不算：從今天起才繼續增長
    p!.grown = time.day
  } else delete p!.covered
  return `${placeName(t.place)}重新紋上了「${t.name ?? ''}」`
}

/** 解咒的 DC 與價錢（侵蝕度越高越難、越貴） */
export function removalTerms(p: ParasiteState): { dc: number; price: number } | undefined {
  const r = parasiteDef(p.id)?.remove
  if (!r) return undefined
  return { dc: r.dc + Math.floor(p.corruption / 10), price: Math.round(r.price * (1 + p.corruption / 100)) }
}

/**
 * 這個世界沒有的寄生物（自建的被刪掉、換了世界）：從角色身上拿掉，寄生裝備的鎖解開（裝備留著）、
 * 淫紋留下來當普通的刺青、記著的沉睡淫紋與被蓋掉的刺青也一起清掉。回傳拿掉了幾個
 */
let pruneNotice: string | null = null

/** 上一次 pruneParasites 拿掉寄生物時的提示（讀檔、世界內容改變之後跳出來）；拿了就清掉 */
export function takeParasiteNotice(): string | null {
  const n = pruneNotice
  pruneNotice = null
  return n
}

export function pruneParasites(chars: Character[]): number {
  let n = 0
  for (const c of chars) {
    const gone = parasitesOf(c).filter((p) => !parasiteDef(p.id)).map((p) => p.id)
    for (const [slot, g] of Object.entries(c.gear ?? {})) {
      const id = g?.locked?.startsWith(PARASITE_LOCK) ? g.locked.slice(PARASITE_LOCK.length) : undefined
      if (id && !parasiteDef(id)) delete c.gear![slot as GearSlot]!.locked
    }
    for (const t of tattoosOf(c)) {
      if (t.kind === 'curse' && t.parasite && !parasiteDef(t.parasite)) {
        t.kind = 'plain'
        delete t.parasite
      }
    }
    if (c.coveredTattoos) c.coveredTattoos = c.coveredTattoos.filter((k) => parasiteDef(k.parasite))
    if (!gone.length) continue
    c.parasites = parasitesOf(c).filter((p) => !gone.includes(p.id))
    n += gone.length
  }
  if (n) pruneNotice = `這個世界已經沒有存檔裡的 ${n} 種寄生物，已經從身上拿掉（鎖住的裝備解鎖、淫紋變成普通的刺青）。`
  return n
}

/** 給 AI 的寄生物清單（沒有時為空字串） */
export function parasiteSummary(c: Pick<Character, 'parasites'>): string {
  return parasitesOf(c).map((p) => {
    const def = parasiteDef(p.id)
    if (!def) return ''
    // 馴服之後不再寫未馴服時的樣子（會餓、會自己動），免得 AI 照舊描寫它作亂
    if (p.tamed) return `- ${def.name}：已馴服。蠢蠢欲動，但乖乖地在等待你的指令。`
    const state = p.dormant ? '沉睡中（被奴隸印記頂掉）' : `${stageName(p.corruption)}（侵蝕度 ${p.corruption}）`
    // 苗床：留下它的怪物（docs/FAMILY.md 第 13 節）
    const by = p.monster ? enemies[p.monster] : undefined
    return `- ${def.name}${by ? `（${by.name}留下的）` : ''}：${state}。${def.desc}`
  }).filter(Boolean).join('\n')
}
