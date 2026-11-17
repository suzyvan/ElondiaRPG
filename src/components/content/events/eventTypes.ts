// 世界編輯器「🎲 事件」的事件類型：每一種的圖示、名稱、說明，以及類型專屬的欄位（EventTypeFields.vue 依這張表顯示）。
// 標題、描述、分類、內容標籤、劇情條件、檢定與選項是所有類型共用的，放在 TravelEventEditor.vue。

import type { EventScope, RoadTemplate } from '@/engine/road'
import { parasiteRules } from '@/engine/parasites'
import { BROOD_KIND_NAME } from '@/engine/brood'
import { MODE_NAME } from '@/engine/travel'
import { DUNGEON_TRIGGERS, EVENT_LAYERS, PREG_STAGE_NAME, type TravelEventMod } from '@/engine/travelEventMods'

/** 類型專屬的欄位（顯示順序照 EventTypeFields.vue 的排法） */
export type EventField =
  | 'kind' | 'tier' | 'cooldown' | 'hours' | 'cast' | 'offscreen'
  | 'modes' | 'cells' | 'locationTypes' | 'locations'
  | 'triggers' | 'layers' | 'regions' | 'dungeons'
  | 'parasite' | 'stages' | 'broodKinds'
  | 'pregKind' | 'subject' | 'father' | 'mixed' | 'forced' | 'pregStages' | 'fatherRaces'
  | 'moments' | 'inSettlement'

export interface EventTypeDef {
  id: EventScope
  icon: string
  /** 類型選單上的名字 */
  name: string
  /** 類型專屬那一區的標題 */
  legend: string
  /** 編輯畫面最上面的說明 */
  intro: (d: TravelEventMod) => string
  /** 事件發生在主角身上：只有選擇，檢定由主角自己擲 */
  onPc: boolean
  /** 選項的 DC 以 14 為普通、實際依什麼調整（dungeonEvents.ts 的 eventDc；沒寫的照寫的 DC 擲） */
  dcScale?: string
  fields: EventField[]
  /** 換成這個類型時補上的預設值 */
  init?: (d: TravelEventMod) => void
  /** 世界編輯器清單上那一列的說明 */
  note: (t: RoadTemplate) => string
}

const kindName = (t: RoadTemplate) => (t.kind === 'check' ? '檢定' : '選擇')
const adultNote = (t: RoadTemplate) => (t.tags?.includes('adult') ? (t.scene ? '・親密場景' : '・成人向') : '')
const stageNames = (t: RoadTemplate) => (t.stages?.length ? `・${t.stages.map((i) => parasiteRules.stages[i]?.name).join('、')}` : '')
const subjectNote = (t: RoadTemplate) => (t.subject === 'companion' ? '夥伴' : '主角')

const addTags = (d: TravelEventMod, tags: NonNullable<TravelEventMod['tags']>) => {
  d.tags = [...new Set([...(d.tags ?? []), ...tags])]
}

export const EVENT_TYPES: EventTypeDef[] = [
  {
    id: 'road', icon: '🧭', name: '旅途上', legend: '旅途', onPc: false,
    intro: () => '旅途事件：出發時依路段的機率與種類權重擲好，放在旅途的格子上。',
    note: (t) => `${(t.modes ?? []).map((m) => MODE_NAME[m]).join('、') || '任何路段'}・${kindName(t)}`,
    fields: ['kind', 'tier', 'modes', 'regions'],
  },
  {
    id: 'town', icon: '🏘️', name: '城鎮的設施上', legend: '城鎮', onPc: false,
    intro: () => '城鎮事件：走上聚落裡符合的設施時，依「事件設定」的機率與冷卻出現。',
    note: (t) => `城鎮・${kindName(t)}`,
    fields: ['kind', 'cooldown', 'hours', 'cells', 'locationTypes', 'locations'],
  },
  {
    id: 'dungeon', icon: '⚠️', name: '地下城與近郊', legend: '地下城', onPc: true, dcScale: '地下城的層',
    intro: () => '地下城事件：在地下城與近郊觸發陷阱、打開寶箱、採集或在安全房長休之後，依「事件設定」的機率與冷卻出現。',
    note: (t) => `地下城・${(t.triggers ?? []).map((x) => DUNGEON_TRIGGERS[x]).join('、')}${adultNote(t)}`,
    fields: ['cooldown', 'hours', 'triggers', 'layers', 'regions', 'dungeons'],
    init: (d) => { d.triggers ??= ['trap'] },
  },
  {
    id: 'lead', icon: '🔎', name: '線索事件（線索池的事件點）', legend: '線索', onPc: true, dcScale: '事件點所在的層',
    intro: () => '線索事件：地區的線索池擲到「事件」時，照地點與層抽一件放在地圖上一格，走到那一格時發生。登場角色在擲線索池時決定（一半是這個地區主角認識的冒險者，其他是新生成的）；文字寫 {a}、{b}（名字）與 {a他}、{b他}（照性別換成他或她），效果的角色選「登場角色甲／乙」。',
    note: (t) => `線索・登場 ${t.cast ?? 0} 人${t.layers?.length ? `・${t.layers.map((i) => EVENT_LAYERS[i]).join('、')}` : ''}`,
    fields: ['cast', 'offscreen', 'layers', 'regions', 'dungeons'],
  },
  {
    id: 'parasite', icon: '💗', name: '寄生物的發作', legend: '寄生物', onPc: true, dcScale: '主角等級與侵蝕度的階段',
    intro: () => '寄生物的發作：身上有這個寄生物（沒馴服、沒沉睡）時，走動、旅途或長休之後依 parasites.json 的機率（乘上存檔規則「寄生發作的機率」與階段的倍率）出現；選項的結果通常是侵蝕度的加減（效果「寄生物的侵蝕度」）。',
    note: (t) => `發作・${parasiteRules.parasites[t.parasite ?? '']?.name ?? t.parasite}${stageNames(t)}`,
    fields: ['hours', 'parasite', 'stages', 'moments'],
    init: (d) => { d.parasite ??= Object.keys(parasiteRules.parasites)[0] },
  },
  {
    id: 'pregnancy', icon: '🍼', name: '懷孕的事件（察覺、孕期）', legend: '懷孕', onPc: true,
    intro: (d) => `${d.known
      ? '孕期事件：已經察覺懷孕的人（主角或隊上的夥伴），依階段在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現（胎動、乾嘔……）。'
      : '察覺事件：還沒察覺懷孕的人，受孕幾天之後在長休之後或旅途每天出現；選項的「察覺」讓這個人察覺懷孕，沒察覺的之後還會再遇到，到中期一律自動察覺。'} 夥伴的事件文字寫 {a}（那位夥伴），父親寫 {f}（父親是主角時寫成「你」）；效果的親密度可以選「懷孕的夥伴」「孩子的父親」。`,
    note: (t) => `${t.known ? '孕期' : '察覺'}・${subjectNote(t)}${t.preg_stages?.length ? `・${t.preg_stages.map((x) => PREG_STAGE_NAME[x]).join('、')}` : ''}${adultNote(t)}`,
    fields: ['hours', 'pregKind', 'subject', 'father', 'mixed', 'forced', 'inSettlement', 'pregStages', 'moments', 'fatherRaces'],
    init: (d) => { d.subject ??= 'pc'; addTags(d, ['adult', 'pregnancy']) },
  },
  {
    id: 'lactation', icon: '💧', name: '泌乳的事件', legend: '泌乳', onPc: true,
    intro: () => '泌乳的事件：泌乳中的主角（條件「泌乳」成立）或隊上泌乳的夥伴，在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現。夥伴的事件文字寫 {a}，效果的親密度可以選「泌乳的夥伴」。',
    note: (t) => `泌乳・${subjectNote(t)}${adultNote(t)}`,
    fields: ['hours', 'subject', 'inSettlement', 'moments'],
    init: (d) => { d.subject ??= 'pc'; addTags(d, ['adult', 'lactation']) },
  },
  {
    id: 'brood', icon: '🪺', name: '苗床的事件', legend: '苗床', onPc: true,
    intro: () => '苗床的事件：主角身上有符合種類、階段的苗床時，在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現（長到支配時改成產下的事件）。文字寫 {m} 是留下苗床的怪物（沒記下時是「不知名的魔物」）；交給 AI 時會附上那隻怪物的樣子。',
    note: (t) => `苗床${t.brood_kinds?.length ? `・${t.brood_kinds.map((k) => BROOD_KIND_NAME[k]).join('、')}` : ''}${stageNames(t)}`,
    fields: ['hours', 'broodKinds', 'stages', 'moments', 'inSettlement'],
    init: (d) => addTags(d, ['adult', 'monster_brood']),
  },
]

const BY_ID = new Map(EVENT_TYPES.map((t) => [t.id, t]))

/** 清單上的圖示：高階的旅途事件是 ✨ */
export function eventIcon(t: Pick<RoadTemplate, 'scope' | 'tier'>): string {
  return !t.scope && t.tier === 'advanced' ? '✨' : eventTypeOf(t).icon
}

/** 清單的排序：照類型表的順序 */
export function eventTypeRank(t: Pick<RoadTemplate, 'scope'>): number {
  return EVENT_TYPES.indexOf(eventTypeOf(t))
}

/** 事件的類型（scope 沒寫的是旅途事件） */
export function eventTypeOf(d: Pick<RoadTemplate, 'scope'>): EventTypeDef {
  return BY_ID.get(d.scope ?? 'road') ?? EVENT_TYPES[0]!
}

/** 換類型：補上新類型的預設值；發生在主角身上的只有選擇 */
export function changeEventType(d: TravelEventMod, id: EventScope) {
  const t = BY_ID.get(id) ?? EVENT_TYPES[0]!
  d.scope = t.id === 'road' ? undefined : t.id
  if (t.onPc) d.kind = 'choice'
  if (!t.fields.includes('tier')) d.tier = 'normal'
  t.init?.(d)
  if (d.kind === 'choice' && !d.options?.length) d.options = [{ label: '離開', success: {} }]
}
