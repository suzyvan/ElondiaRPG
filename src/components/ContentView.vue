<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import WorldBar from './WorldBar.vue'
import { abilities, className, companionRules, contractDef, describeCondition, describeStatus, enemies, genderName, raceName, tagDef, itemDef, itemRules, landmarks, landmarkTypes, locationById, MASTER_EVENT_POOLS, type MasterEventPool, npcs as namedNpcs, regionById, perkDef, perkRules, shopRules, slaveryRules, specialMaps, statuses, stories, storyCounters, type ShopType } from '@/engine/data'
import { newShop, newShopId, shopAsCustom } from '@/engine/shopMods'
import { builtinLandmark, newLandmark, newLandmarkId } from '@/engine/landmarkMods'
import { builtinSpecialMap, newSpecialMap, newSpecialMapId } from '@/engine/specialMapMods'
import { newMark, newTattooTemplate } from '@/engine/tattooMods'
import { oathText, placeName, tattooRules } from '@/engine/tattoos'
import { perkCategory, perkPower, PERK_CATEGORIES } from '@/engine/perks'
import { baseSlots, gearRules } from '@/engine/gear'
import { CONTENT_TAGS } from '@/engine/content'
import { BODY_LABEL } from './content/checks'
import {
  ABILITY_TYPES, abilityClasses, builtinAbility, builtinBase, builtinEnemy, builtinMaterial, builtinNpc, builtinPerk, ENEMY_KINDS, enemyPlaceIndex, enemyPlaceOptions,
  ITEM_SOURCE_NAME, itemSourceIndex, newAbility, newBase, newEnemy, newItem, newMaterial, newModId, newNpc, newPerk, builtinStatus, newStatus, newCondition,
  builtinMark, builtinTattoo, conditionIds,
} from '@/engine/mods'
import { formatMoney } from '@/engine/money'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import { dateStamp, download } from './download'
import AbilityEditor from './content/AbilityEditor.vue'
import EnemyEditor from './content/EnemyEditor.vue'
import GearEditor from './content/GearEditor.vue'
import ItemEditor from './content/ItemEditor.vue'
import NpcEditor from './content/NpcEditor.vue'
import PerkEditor from './content/PerkEditor.vue'
import StatusEditor from './content/StatusEditor.vue'
import ConditionEditor from './content/ConditionEditor.vue'
import CountersEditor from './content/CountersEditor.vue'
import StoryEditor from './content/StoryEditor.vue'
import TattooEditor from './content/TattooEditor.vue'
import ShopEditor from './content/ShopEditor.vue'
import LandmarkEditor from './content/LandmarkEditor.vue'
import SpecialMapEditor from './content/SpecialMapEditor.vue'
import MarkEditor from './content/MarkEditor.vue'
import MarkRulesEditor from './content/MarkRulesEditor.vue'
import { builtinStory, copyStory, newStory, START_KINDS } from '@/engine/storyMods'
import TravelEventEditor from './content/TravelEventEditor.vue'
import MasterEventEditor from './content/MasterEventEditor.vue'
import { allMasterEvents, builtinMasterEvent, masterEventById, newMasterEvent, POOL_IDS } from '@/engine/masterEventMods'
import EventRulesEditor from './content/EventRulesEditor.vue'
import BindRulesEditor from './content/BindRulesEditor.vue'
import CategoryIconsEditor from './content/CategoryIconsEditor.vue'
import ImportPickerDialog from './content/ImportPickerDialog.vue'
import QuestGenDialog from './content/QuestGenDialog.vue'
import StorylineOverview from './content/StorylineOverview.vue'
import type { RefKey } from '@/engine/contentRefs'
import ItemIcon from './items/ItemIcon.vue'
import ContentIcon from './icons/ContentIcon.vue'
import { travelEvents } from '@/engine/road'
import { MODE_NAME } from '@/engine/travel'
import { builtinTravelEvent, DUNGEON_TRIGGERS, newTravelEvent } from '@/engine/travelEventMods'
import { parasiteRules } from '@/engine/parasites'
import { isMobile, pushLayer } from './mobile/mobile'
import GameIcon from './ui/GameIcon.vue'
import { confirmDiscard, unsavedEdits } from './content/unsaved'

// 自訂內容：新增、修改怪物與物品（包括裝備的底材與材料）。內建項目可以修改、恢復預設，不能刪除；自建項目可以刪除。
type Sub = 'enemies' | 'items' | 'bases' | 'materials' | 'abilities' | 'statuses' | 'perks' | 'tattoos' | 'landmarks' | 'specialMaps' | 'shops' | 'events' | 'masterEvents' | 'npcs' | 'stories'
const SUBS: { id: Sub; label: string }[] = [
  { id: 'enemies', label: '👹 怪物' },
  { id: 'items', label: '🎒 物品' },
  { id: 'bases', label: '🗡️ 裝備底材' },
  { id: 'materials', label: '💎 材料' },
  { id: 'abilities', label: '✨ 技能' },
  { id: 'statuses', label: '🌀 狀態' },
  { id: 'perks', label: '🌟 特質' },
  { id: 'tattoos', label: '🖋️ 刺青與印記' },
  { id: 'landmarks', label: '🏛️ 地標' },
  { id: 'specialMaps', label: '🗺️ 特殊地圖' },
  { id: 'shops', label: '🏪 商店' },
  { id: 'events', label: '🎲 事件' },
  { id: 'masterEvents', label: '⛓️ 主奴與娼館' },
  { id: 'npcs', label: '🧑 固定 NPC' },
  { id: 'stories', label: '⭐ 特殊任務' },
]
/** 頁籤分成幾組（上面一排是組，下面一排是組裡的頁籤）；icons 是物品組裡的「類別圖示」 */
type Tab = Sub | 'icons'
const GROUPS: { id: string; label: string; tabs: Tab[] }[] = [
  { id: 'combat', label: '⚔️ 戰鬥', tabs: ['enemies', 'abilities', 'statuses'] },
  { id: 'people', label: '🧬 角色', tabs: ['npcs', 'perks', 'tattoos'] },
  { id: 'items', label: '🎒 物品', tabs: ['items', 'bases', 'materials', 'icons'] },
  { id: 'places', label: '🗺️ 地點', tabs: ['landmarks', 'specialMaps', 'shops'] },
  { id: 'story', label: '⭐ 劇情', tabs: ['stories', 'events', 'masterEvents'] },
]
const tabLabel = (t: Tab) => (t === 'icons' ? '🖼️ 類別圖示' : SUBS.find((x) => x.id === t)!.label)
const content = useContent()
const game = useGame()
const sub = ref<Sub>('enemies')
/** 「類別圖示」分頁：只有一個設定畫面，沒有左邊的列表 */
const iconsTab = ref(false)
const tab = computed<Tab>(() => (iconsTab.value ? 'icons' : sub.value))
const group = computed(() => GROUPS.find((g) => g.tabs.includes(tab.value))!)
/** 每一組上次看的頁籤（切回這一組時回到那裡） */
const lastTab: Record<string, Tab> = {}
async function openTab(t: Tab) {
  if (t === tab.value || !(await confirmDiscard())) return
  if (t === 'icons') iconsTab.value = true
  else {
    iconsTab.value = false
    sub.value = t
  }
  lastTab[group.value.id] = t
  resetFilters()
}
function openGroup(id: string) {
  const g = GROUPS.find((x) => x.id === id)!
  openTab(lastTab[g.id] ?? g.tabs[0]!)
}
const search = ref('')
const filter = ref<'all' | 'custom' | 'edited'>('all')
const category = ref('')
// 怪物：種類、出現地點、等級；物品：取得方式
const enemyKind = ref('')
const enemyPlace = ref('')
const enemyLevel = ref('')
// 怪物：發情（不會、在哪裡都可能、只在野外）、魔物娘形態（有、沒有）
const enemyRut = ref('')
const enemyGirl = ref('')
const itemSource = ref('')
const LEVEL_BANDS: Record<string, [number, number]> = { '1-2': [1, 2], '3-4': [3, 4], '5-6': [5, 6], '7-8': [7, 8], '9-10': [9, 10], '11+': [11, 99] }
const placeOptions = enemyPlaceOptions()
const places = computed(() => {
  void content.version
  return enemyPlaceIndex()
})
const sources = computed(() => {
  void content.version
  return itemSourceIndex()
})
function resetFilters() {
  for (const m of ALL_FILTER_MODELS) m.value = ''
  pickStatusType.value = false
}
const selected = ref<Record<Sub, string>>({ enemies: '', items: '', bases: '', materials: '', abilities: '', statuses: '', perks: '', tattoos: '', landmarks: '', specialMaps: '', shops: '', events: '', masterEvents: '', npcs: '', stories: '' })
// 刺青：普通刺青、誓約印記、奴隸印記（列表的 key：t:<圖樣>、m:<印記>、rules 是印記設定）
const tattooKind = ref('')
// 狀態：增益、減益、非戰鬥狀態（列表的 key：戰鬥狀態是 id，非戰鬥狀態是 c:<id>）
const statusKind = ref('')
// 事件：旅途、城鎮（列表的 key 是事件 id，rules 是事件設定）
const eventScope = ref('')
// 主奴與娼館：事件庫
const masterPool = ref('')
/** 清單上的效果簡述：第一項效果，太長就截斷（完整的在編輯畫面） */
function shortStatus(s: Parameters<typeof describeStatus>[0]): string {
  const parts = describeStatus(s).split('；')
  const first = parts[0]!
  return first.length > 12 ? `${first.slice(0, 11)}…` : parts.length > 1 ? `${first}…` : first
}
function shortCondition(c: Parameters<typeof describeCondition>[0]): string {
  const parts = describeCondition(c).split('；')
  const first = parts[0]!
  return first.length > 12 ? `${first.slice(0, 11)}…` : parts.length > 1 ? `${first}…` : first
}
// 技能：種類、職業
const abilityType = ref('')
const abilityClass = ref('')

const KINDS: Record<string, string> = { metal: '金屬', leather: '皮革', cloth: '布料', wood: '木材', jewel: '寶石' }
const BASE_SLOTS = baseSlots()

// 底材、裝備：欄位、材料類型；特質：分類
const gearSlot = ref('')
const matKind = ref('')
const perkCat = ref('')
// 地標、事件、固定 NPC、特殊任務共用：地點、成人向、內容標籤、主角形象、旗標
const placeFilter = ref('')
const adultFilter = ref('')
const tagFilter = ref('')
const bodyFilter = ref('')
const flagFilter = ref('')
// 固定 NPC：性別、種族、身分、職業、標籤；特殊任務：主角等級、固定 NPC
const npcGender = ref('')
const npcRace = ref('')
const npcKind = ref('')
const npcJob = ref('')
const npcTag = ref('')
const storyLevel = ref('')
const storyNpc = ref('')
const NPC_KINDS: Record<string, string> = { commoner: '普通人', adventurer: '冒險者' }
const STORY_BANDS: Record<string, [number, number]> = { '1-4': [1, 4], '5-8': [5, 8], '9-11': [9, 11], '12-15': [12, 15], '16-18': [16, 18], '19-20': [19, 99] }

const FLAG_KEYS = new Set(['flags', 'flags_none', 'flags_any', 'set_flags', 'clear_flags', 'start_flags'])
/** 一個定義裡寫到的所有旗標（條件與設定的旗標，任何深度） */
function flagsIn(o: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) for (const x of o) flagsIn(x, out)
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (FLAG_KEYS.has(k) && Array.isArray(v)) {
        for (const f of v) if (typeof f === 'string') out.add(f)
      } else flagsIn(v, out)
    }
  }
  return out
}
/** 特殊任務裡出現的固定 NPC（開始的角色、任務點的角色、同伴與敵人） */
function npcsIn(o: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) for (const x of o) npcsIn(x, out)
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'npc' && typeof v === 'string') out.add(v)
      else if ((k === 'allies' || k === 'foes') && Array.isArray(v)) {
        for (const x of v) if (typeof x === 'string') out.add(x)
      } else npcsIn(v, out)
    }
  }
  return out
}
const flagMatch = (o: unknown) => {
  const q = flagFilter.value.trim()
  return !q || [...flagsIn(o)].some((f) => f.includes(q))
}
const adultMatch = (adult: boolean) => !adultFilter.value || (adultFilter.value === 'yes') === adult
const bodyMatch = (bodies: string[] | undefined) => !bodyFilter.value || (bodyFilter.value === 'any' ? !bodies?.length : !!bodies?.includes(bodyFilter.value))
const locName = (id: string) => {
  try {
    return locationById(id).name
  } catch {
    return id
  }
}
/** 這一頁的篩選選項：用到的地點、旗標、職業、標籤 */
const options = computed(() => {
  void content.version
  const sorted = (ids: Iterable<string>, name: (id: string) => string = (x) => x) => [...new Set(ids)].map((id) => [id, name(id)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], 'zh-Hant'))
  const flagsOf = (list: unknown[]) => [...new Set(list.flatMap((x) => [...flagsIn(x)]))].sort()
  if (sub.value === 'landmarks') {
    const list = Object.values(landmarks)
    return { places: sorted(list.map((l) => l.location), locName), flags: flagsOf(list) }
  }
  if (sub.value === 'events') {
    const t = travelEvents.templates
    const regions = sorted(t.flatMap((x) => x.regions ?? []), (id) => {
      try {
        return `地區：${regionById(id).name}`
      } catch {
        return `地區：${id}`
      }
    }).map(([id, n]) => [`r:${id}`, n] as [string, string])
    return { places: [...sorted(t.flatMap((x) => [...(x.locations ?? []), ...(x.dungeons ?? [])]), locName), ...regions], flags: flagsOf(t) }
  }
  if (sub.value === 'npcs') {
    const jobs = [...sorted(namedNpcs.filter((n) => n.class).map((n) => n.class), className).map(([id, n]) => [`c:${id}`, n] as [string, string]),
      ...sorted(namedNpcs.filter((n) => !n.class && n.occupation).map((n) => n.occupation!)).map(([id, n]) => [`o:${id}`, n] as [string, string])]
    return {
      places: sorted(namedNpcs.map((n) => n.location), locName), flags: flagsOf(namedNpcs), jobs,
      genders: sorted(namedNpcs.map((n) => n.gender ?? ''), (g) => genderName(g) || '未設定'),
      races: sorted(namedNpcs.map((n) => n.race), raceName),
      tags: sorted(namedNpcs.flatMap((n) => n.tags ?? []), (t) => tagDef(t)?.name ?? t),
    }
  }
  if (sub.value === 'stories') return { flags: flagsOf(stories), npcNames: [...new Set(namedNpcs.map((n) => n.name))].sort() }
  return {}
})

// ---- 篩選列：每一頁宣告自己的篩選，畫面用同一套元件畫 ----
type Opt = [string, string]
interface FilterDef {
  model: Ref<string>
  /** 篩選的名稱（使用中的篩選顯示成「名稱：值」） */
  name: string
  /** 下拉選單「不篩選」那一項的文字 */
  all?: string
  options?: () => Opt[]
  /** 文字輸入（自動完成用的清單） */
  list?: 'flags' | 'npcs'
  /** 只在某些情況顯示（例如選了裝備類別才有欄位） */
  when?: () => boolean
}
const entries = (o: Record<string, string>): Opt[] => Object.entries(o)
const ADULT_OPTS: Opt[] = [['yes', '🔞 成人向'], ['no', '一般']]
const adultDef: FilterDef = { model: adultFilter, name: '成人向', all: '成人向與一般', options: () => ADULT_OPTS }
const flagDef: FilterDef = { model: flagFilter, name: '旗標', list: 'flags', all: '旗標（條件或設定的）' }
const tagDef_: FilterDef = { model: tagFilter, name: '內容標籤', all: '所有內容標籤', options: () => Object.entries(CONTENT_TAGS).map(([k, t]) => [k, t.name]) }
const bodyDef: FilterDef = { model: bodyFilter, name: '主角形象', all: '所有主角形象', options: () => [['any', '不限形象'], ...Object.entries(BODY_LABEL).map(([k, n]) => [k, `只給${n}`] as Opt)] }
const placeDef = (none?: string): FilterDef => ({ model: placeFilter, name: '地點', all: '所有地點', options: () => [...(options.value.places ?? []), ...(none ? [['none', none] as Opt] : [])] })
const slotDef: FilterDef = { model: gearSlot, name: '欄位', all: '所有欄位', options: () => entries(BASE_SLOTS) }
const matKindDef: FilterDef = { model: matKind, name: '材料類型', all: '所有材料類型', options: () => entries(KINDS) }
const FILTERS: Record<Sub, FilterDef[]> = {
  enemies: [
    { model: enemyKind, name: '種類', all: '所有種類', options: () => entries(ENEMY_KINDS) },
    { model: enemyLevel, name: '等級', all: '所有等級', options: () => Object.keys(LEVEL_BANDS).map((k) => [k, `${k} 級`]) },
    { model: enemyPlace, name: '出現地點', all: '所有出現地點', options: () => [...placeOptions.map((p) => [p.key, p.label] as Opt), ['none', '沒有出現地點']] },
    { model: enemyRut, name: '發情', all: '發情（不限）', options: () => [['yes', '會發情'], ['any', '在哪裡都可能'], ['field', '只在野外'], ['no', '不會發情']] },
    { model: enemyGirl, name: '魔物娘', all: '魔物娘（不限）', options: () => [['yes', '有魔物娘形態'], ['no', '沒有魔物娘形態']] },
  ],
  items: [
    { model: category, name: '類別', all: '所有類別', options: () => entries(itemRules.categories) },
    { model: itemSource, name: '取得方式', all: '所有取得方式', options: () => entries(ITEM_SOURCE_NAME) },
    { ...slotDef, when: () => category.value === 'equipment' },
    { ...matKindDef, when: () => category.value === 'equipment' },
    adultDef,
  ],
  bases: [slotDef, matKindDef, adultDef],
  materials: [matKindDef],
  abilities: [
    { model: abilityType, name: '種類', all: '所有種類', options: () => entries(ABILITY_TYPES) },
    { model: abilityClass, name: '職業', all: '所有職業', options: () => abilityClasses().map((c) => [c, c === 'monster' ? '怪物' : c === 'lewd' ? '色情技能（不分職業）' : className(c)]) },
  ],
  statuses: [{ model: statusKind, name: '種類', all: '所有狀態', options: () => [['buff', '🟢 增益（BUFF）'], ['debuff', '🔴 減益（DEBUFF）'], ['cond', '🏕️ 非戰鬥狀態（用餐、喝酒……）']] }],
  perks: [{ model: perkCat, name: '分類', all: '所有分類', options: () => [...entries(PERK_CATEGORIES), ['race', '種族天賦']] }],
  tattoos: [{ model: tattooKind, name: '種類', all: '所有刺青與印記', options: () => [['plain', '🖋️ 普通刺青'], ['oath', '📜 誓約印記'], ['slave', '⛓️ 奴隸印記']] }],
  landmarks: [placeDef(), adultDef, flagDef],
  specialMaps: [],
  shops: [],
  events: [
    { model: eventScope, name: '種類', all: '所有事件', options: () => [['road', '🧭 旅途事件'], ['town', '🏘️ 城鎮事件'], ['dungeon', '⚠️ 地下城事件'], ['parasite', '💗 寄生物的發作']] },
    placeDef('沒有限制地點'), adultDef, tagDef_, bodyDef, flagDef,
  ],
  masterEvents: [
    { model: masterPool, name: '事件庫', all: '所有事件庫', options: () => POOL_IDS.map((p) => [p, MASTER_EVENT_POOLS[p]]) },
    adultDef,
  ],
  npcs: [
    placeDef(),
    { model: npcJob, name: '職業', all: '所有職業', options: () => options.value.jobs ?? [] },
    { model: npcGender, name: '性別', all: '所有性別', options: () => options.value.genders ?? [] },
    { model: npcRace, name: '種族', all: '所有種族', options: () => options.value.races ?? [] },
    { model: npcKind, name: '身分', all: '所有身分', options: () => entries(NPC_KINDS) },
    { model: npcTag, name: '標籤', all: '所有標籤', options: () => options.value.tags ?? [] },
    adultDef, flagDef,
  ],
  stories: [
    { model: storyLevel, name: '主角等級', all: '所有主角等級', options: () => Object.keys(STORY_BANDS).map((k) => [k, `Lv.${k}`]) },
    { model: storyNpc, name: '固定 NPC', list: 'npcs', all: '固定 NPC 名稱' },
    tagDef_, adultDef, bodyDef, flagDef,
  ],
}
const ALL_FILTER_MODELS = [...new Set(Object.values(FILTERS).flat().map((f) => f.model))]
/** 篩選列直接顯示幾個，其他收進「更多篩選」 */
const PRIMARY_FILTERS = 2
const filterDefs = computed(() => (iconsTab.value ? [] : FILTERS[sub.value].filter((f) => !f.when || f.when())))
const primaryFilters = computed(() => filterDefs.value.slice(0, PRIMARY_FILTERS))
const moreFilters = computed(() => filterDefs.value.slice(PRIMARY_FILTERS))
const moreActive = computed(() => moreFilters.value.filter((f) => f.model.value.trim()))
const anyFilter = computed(() => !!search.value.trim() || filter.value !== 'all' || filterDefs.value.some((f) => f.model.value.trim()))
function filterValueName(f: FilterDef): string {
  const v = f.model.value
  return f.options?.().find(([k]) => k === v)?.[1] ?? v
}
function clearFilters() {
  search.value = ''
  filter.value = 'all'
  resetFilters()
}

/** 特殊任務頁的「劇情計數器」那一列 */
const COUNTERS_KEY = '|counters'
/** 裝備底材清單裡的「雙面效應設定」 */
const BIND_RULES_KEY = '|bind_rules'
/** 特殊任務頁的「故事線總覽」 */
const STORYLINES_KEY = '|storylines'
/** 每一頁只有一筆的設定：放在清單上方的固定按鈕（不跟著篩選消失） */
const SETTINGS = computed<{ key: string; label: string; edited: boolean }[]>(() => {
  void content.version
  const m = content.mods
  if (iconsTab.value) return []
  if (sub.value === 'events') return [{ key: 'rules', label: '⚙️ 事件設定', edited: !!m.eventRules?.rules }]
  if (sub.value === 'tattoos') return [{ key: 'rules', label: '⚙️ 印記設定', edited: !!m.markRules?.rules }]
  if (sub.value === 'bases') return [{ key: BIND_RULES_KEY, label: '⚙️ 雙面效應設定', edited: !!m.bindRules?.rules }]
  if (sub.value === 'stories') return [{ key: STORYLINES_KEY, label: '🗺️ 故事線總覽', edited: false }, { key: COUNTERS_KEY, label: `🔢 劇情計數器（${Object.keys(storyCounters).length}）`, edited: Object.keys(m.counters ?? {}).length > 0 }]
  return []
})
/** 編輯器共用的自動完成清單（cv-item-names、cv-known-flags） */
const allItemNames = computed(() => {
  void content.version
  return itemRules.items.map((i) => i.name)
})
const knownFlags = computed(() => {
  void content.version
  return content.knownFlags()
})
const isSetting = (key: string) => key === 'rules' || key.startsWith('|')

type Status = 'custom' | 'edited' | ''
interface Row { key: string; name: string; note: string; status: Status; sort?: number }
const st = (has: boolean, custom: boolean): Status => (has ? (custom ? 'custom' : 'edited') : '')

const rows = computed<Row[]>(() => {
  void content.version
  const m = content.mods
  const q = search.value.trim()
  let list: Row[] = []
  if (sub.value === 'enemies') {
    const band = LEVEL_BANDS[enemyLevel.value]
    list = Object.values(enemies)
      .filter((e) => !enemyKind.value || (e.kind ?? '') === enemyKind.value)
      .filter((e) => !band || (e.level >= band[0] && e.level <= band[1]))
      .filter((e) => !enemyPlace.value || (enemyPlace.value === 'none' ? !places.value.get(e.id)?.size : !!places.value.get(e.id)?.has(enemyPlace.value)))
      .filter((e) => !enemyRut.value || {
        yes: !!e.rut, any: e.rut === true, field: e.rut === 'field', no: !e.rut,
      }[enemyRut.value])
      .filter((e) => !enemyGirl.value || (enemyGirl.value === 'yes') === !!e.girl)
      .sort((a, b) => (m.enemies[a.id]?.custom ? -1 : 0) - (m.enemies[b.id]?.custom ? -1 : 0) || a.level - b.level)
      .map((e) => ({ key: e.id, name: e.name, note: `${e.level} 級・${ENEMY_KINDS[e.kind ?? ''] ?? ''}${e.rut ? '・發情' : ''}${e.girl ? '・魔物娘' : ''}`, status: st(!!m.enemies[e.id], !builtinEnemy(e.id)) }))
  } else if (sub.value === 'items') {
    list = itemRules.items
      .filter((i) => !category.value || i.category === category.value)
      .filter((i) => !itemSource.value || !!sources.value.get(i.name)?.has(itemSource.value))
      .filter((i) => adultMatch(!!i.adult))
      .filter((i) => category.value !== 'equipment' || ((!gearSlot.value || gearRules.bases[i.gear?.base ?? '']?.slot === gearSlot.value)
        && (!matKind.value || gearRules.materials[i.gear?.material ?? '']?.kind === matKind.value)))
      .map((i) => ({ key: i.name, name: i.name, note: `${itemRules.categories[i.category]}・${formatMoney(i.price_cc)}`, status: st(!!m.items[i.name], !!m.items[i.name]?.custom) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'abilities') {
    list = Object.values(abilities)
      .filter((a) => !abilityType.value || a.type === abilityType.value)
      .filter((a) => !abilityClass.value || a.classes.includes(abilityClass.value))
      .map((a) => ({
        key: a.id, name: a.name,
        note: `${ABILITY_TYPES[a.type]}${a.type === 'skill' ? ` ${a.unlock ?? 1} 級` : a.type === 'spell' ? ` ${a.circle ?? 1} 環` : ''}`,
        status: st(!!m.abilities[a.id], !builtinAbility(a.id)),
        sort: a.type === 'skill' ? a.unlock ?? 1 : a.type === 'spell' ? 20 + (a.circle ?? 1) : 0,
      }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || a.sort - b.sort)
  } else if (sub.value === 'statuses') {
    list = Object.entries(statuses)
      .filter(([, s]) => !statusKind.value || s.kind === statusKind.value)
      .map(([id, s]) => ({ key: id, name: `${s.kind === 'buff' ? '🟢' : '🔴'} ${s.name}`, note: shortStatus(s), status: st(!!m.statuses?.[id], !builtinStatus(id)), sort: s.kind === 'buff' ? 0 : 1 }))
    const conds = !statusKind.value || statusKind.value === 'cond'
      ? conditionIds().map((id) => {
        const c = companionRules.conditions[id]!
        return { key: `c:${id}`, name: `🏕️ ${c.name}`, note: shortCondition(c), status: st(!!m.conditions?.[id], !!m.conditions?.[id]?.custom), sort: 2 }
      })
      : []
    list = [...list, ...conds].sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || (a.sort ?? 0) - (b.sort ?? 0))
  } else if (sub.value === 'perks') {
    list = perkRules.perks
      .filter((p) => !perkCat.value || (perkCat.value === 'race' ? !!p.race : !p.race && perkCategory(p) === perkCat.value))
      .map((p) => ({ key: p.id, name: p.name, note: p.race ? '種族' : `強度 ${perkPower(p)}${p.train ? '・可受訓' : ''}`, status: st(!!m.perks[p.id], !builtinPerk(p.id)), sort: p.race ? 1 : 0 }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || a.sort - b.sort)
  } else if (sub.value === 'tattoos') {
    const k = tattooKind.value
    const tats = Object.entries(tattooRules.templates)
      .filter(([, t]) => !k || t.kind === k)
      .map(([id, t]) => ({ key: `t:${id}`, name: `${t.kind === 'oath' ? '📜' : '🖋️'} ${t.name}`, note: t.kind === 'oath' ? oathText(t.attrs ?? {}) : (t.places ?? []).map(placeName).slice(0, 3).join('、'), status: st(!!m.tattoos?.[id], !builtinTattoo(id)), sort: t.kind === 'oath' ? 1 : 0 }))
    const marks = !k || k === 'slave'
      ? Object.keys(slaveryRules.contracts).map((id) => ({ key: `m:${id}`, name: `⛓️ ${contractDef(id).name}`, note: placeName(contractDef(id).place), status: st(!!m.marks?.[id], !builtinMark(id)), sort: 2 }))
      : []
    list = [...tats, ...marks].sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || a.sort - b.sort)
  } else if (sub.value === 'landmarks') {
    list = Object.values(landmarks)
      .filter((l) => !placeFilter.value || l.location === placeFilter.value)
      .filter((l) => adultMatch(!!l.open?.adult || !!l.scenes?.some((x) => x.tags?.includes('adult'))))
      .filter((l) => flagMatch(l))
      .map((l) => ({ key: l.id, name: `${l.emoji} ${l.name}`, note: `${locationById(l.location).name}・${l.types.map((t) => landmarkTypes[t]?.name).join('、')}`, status: st(!!m.landmarks?.[l.id], !builtinLandmark(l.id)) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'specialMaps') {
    list = Object.values(specialMaps)
      .map((d) => ({ key: d.id, name: `🗺️ ${d.name}`, note: `${locationById(d.location).name}・${d.grid?.length ? '固定' : '隨機'}${d.refresh ? '・會刷新' : ''}`, status: st(!!m.specialMaps?.[d.id], !builtinSpecialMap(d.id)) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'shops') {
    list = Object.entries(shopRules.types)
      .map(([id, d]) => ({ key: id, name: `${d.emoji} ${d.name}`, note: d.custom ? `${m.shops?.[id]?.places?.length ?? 0} 處・${d.keeper.title}` : d.keeper.title, status: st(!!m.shops?.[id], !!d.custom) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'events') {
    const k = eventScope.value
    const evs = travelEvents.templates
      .filter((t) => !k || (t.scope ?? 'road') === k)
      .filter((t) => {
        const p = placeFilter.value
        if (!p) return true
        if (p === 'none') return !t.locations?.length && !t.dungeons?.length && !t.regions?.length
        return p.startsWith('r:') ? !!t.regions?.includes(p.slice(2)) : !!t.locations?.includes(p) || !!t.dungeons?.includes(p)
      })
      .filter((t) => adultMatch(!!t.tags?.includes('adult')))
      .filter((t) => !tagFilter.value || !!t.tags?.includes(tagFilter.value as never))
      .filter((t) => bodyMatch(t.pc_body))
      .filter((t) => flagMatch(t))
      .map((t) => ({
        key: t.id, name: `${t.scope === 'town' ? '🏘️' : t.scope === 'dungeon' ? '⚠️' : t.scope === 'parasite' ? '💗' : t.tier === 'advanced' ? '✨' : '🧭'} ${t.title}`,
        note: t.scope === 'town' ? `城鎮・${t.kind === 'check' ? '檢定' : '選擇'}`
          : t.scope === 'parasite' ? `發作・${parasiteRules.parasites[t.parasite ?? '']?.name ?? t.parasite}${t.stages?.length ? `・${t.stages.map((i) => parasiteRules.stages[i]?.name).join('、')}` : ''}`
          : t.scope === 'dungeon' ? `地下城・${(t.triggers ?? []).map((x) => DUNGEON_TRIGGERS[x]).join('、')}${t.tags?.includes('adult') ? '・成人向' : ''}`
          : `${(t.modes ?? []).map((m) => MODE_NAME[m]).join('、') || '任何路段'}・${t.kind === 'check' ? '檢定' : '選擇'}`,
        status: st(!!m.travelEvents?.[t.id], !builtinTravelEvent(t.id)), sort: t.scope === 'town' ? 1 : t.scope === 'dungeon' ? 2 : t.scope === 'parasite' ? 2.5 : 0,
      }))
    list = evs.sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || a.sort - b.sort)
  } else if (sub.value === 'masterEvents') {
    list = allMasterEvents()
      .filter((x) => !masterPool.value || x.pool === masterPool.value)
      .filter((x) => adultMatch(!!x.def.adult))
      .map(({ pool, def }) => ({
        key: def.id, name: def.text.replace(/\{master\}/g, '主人').slice(0, 28) || def.id,
        note: `${MASTER_EVENT_POOLS[pool]}${def.adult ? '・成人向' : ''}${def.teaches?.length ? `・技能 ${def.teaches.length}` : ''}`,
        status: st(!!m.masterEvents?.[def.id], !builtinMasterEvent(def.id)), sort: POOL_IDS.indexOf(pool),
      }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0) || a.sort - b.sort)
  } else if (sub.value === 'stories') {
    const band = STORY_BANDS[storyLevel.value]
    const who = storyNpc.value.trim()
    list = stories
      .filter((d) => !band || ((d.start.min_level ?? 1) >= band[0] && (d.start.min_level ?? 1) <= band[1]))
      .filter((d) => adultMatch(!!d.tags?.includes('adult')))
      .filter((d) => !tagFilter.value || !!d.tags?.includes(tagFilter.value))
      .filter((d) => bodyMatch(d.start.pc_body))
      .filter((d) => flagMatch(d))
      .filter((d) => !who || [...npcsIn(d)].some((id) => (namedNpcs.find((n) => n.id === id)?.name ?? id).includes(who)))
      .map((d) => ({ key: d.id, name: d.title, note: `${START_KINDS[d.start.kind]}・${d.nodes.length} 個任務點`, status: st(!!m.stories[d.id], !builtinStory(d.id)) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'npcs') {
    const job = npcJob.value
    list = namedNpcs
      .filter((n) => !placeFilter.value || n.location === placeFilter.value)
      .filter((n) => !npcGender.value || (n.gender ?? '') === npcGender.value)
      .filter((n) => !npcRace.value || n.race === npcRace.value)
      .filter((n) => !npcKind.value || (n.kind ?? (n.class ? 'adventurer' : 'commoner')) === npcKind.value)
      .filter((n) => !job || (job.startsWith('c:') ? n.class === job.slice(2) : !n.class && n.occupation === job.slice(2)))
      .filter((n) => !npcTag.value || !!n.tags?.includes(npcTag.value))
      .filter((n) => adultMatch(!!n.adult))
      .filter((n) => flagMatch(n))
      .map((n) => ({ key: n.id, name: n.name, note: `${locationById(n.location).name}・${n.class ? className(n.class) : n.occupation ?? '普通人'} Lv.${n.level}`, status: st(!!m.npcs[n.id], !builtinNpc(n.id)) }))
      .sort((a, b) => (a.status === 'custom' ? -1 : 0) - (b.status === 'custom' ? -1 : 0))
  } else if (sub.value === 'bases') {
    list = Object.entries(gearRules.bases)
      .filter(([, b]) => (!gearSlot.value || b.slot === gearSlot.value) && (!matKind.value || b.kind === matKind.value))
      .filter(([, b]) => adultMatch(!!b.adult || b.outfit === 'adult'))
      .map(([id, b]) => ({ key: id, name: b.name, note: `${KINDS[b.kind]}・${formatMoney(b.price)}`, status: st(!!m.bases[id], !builtinBase(id)) }))
  } else {
    list = Object.entries(gearRules.materials)
      .filter(([, x]) => !matKind.value || x.kind === matKind.value)
      .map(([id, x]) => ({ key: id, name: x.name, note: `${KINDS[x.kind]}・${x.tier} 級`, status: st(!!m.materials[id], !builtinMaterial(id)) }))
  }
  return list
    .filter((r) => !q || r.name.includes(q) || r.key.includes(q))
    .filter((r) => filter.value === 'all' || r.status === filter.value)
})

const counts = computed(() => {
  const m = content.mods
  const n = (o: Record<string, { custom?: boolean }>) => {
    const v = Object.values(o)
    return `自建 ${v.filter((x) => x.custom).length}・修改 ${v.filter((x) => !x.custom).length}`
  }
  return { enemies: n(m.enemies), items: n(m.items), bases: n(m.bases), materials: n(m.materials), abilities: n(m.abilities), statuses: n({ ...(m.statuses ?? {}), ...Object.fromEntries(Object.entries(m.conditions ?? {}).map(([k, v]) => [`c:${k}`, v as { custom?: boolean }])) }), perks: n(m.perks), tattoos: n({ ...(m.tattoos ?? {}), ...(m.marks ?? {}) }), landmarks: n(m.landmarks ?? {}), specialMaps: n(m.specialMaps ?? {}), shops: n(m.shops ?? {}), events: n(m.travelEvents ?? {}), masterEvents: n(m.masterEvents ?? {}), npcs: n(m.npcs), stories: n(m.stories) }
})

const current = computed(() => {
  void content.version
  const key = selected.value[sub.value]
  if (!key) return ''
  const exists = sub.value === 'enemies' ? !!enemies[key] : sub.value === 'items' ? !!itemDef(key) : sub.value === 'bases' ? key === BIND_RULES_KEY || !!gearRules.bases[key]
    : sub.value === 'npcs' ? namedNpcs.some((n) => n.id === key) : sub.value === 'stories' ? key === COUNTERS_KEY || key === STORYLINES_KEY || stories.some((d) => d.id === key)
    : sub.value === 'abilities' ? !!abilities[key] : sub.value === 'statuses' ? (key.startsWith('c:') ? conditionIds().includes(key.slice(2)) : !!statuses[key]) : sub.value === 'perks' ? !!perkDef(key)
    : sub.value === 'shops' ? !!shopRules.types[key as ShopType]
    : sub.value === 'landmarks' ? !!landmarks[key]
    : sub.value === 'specialMaps' ? !!specialMaps[key]
    : sub.value === 'events' ? key === 'rules' || travelEvents.templates.some((t) => t.id === key)
    : sub.value === 'masterEvents' ? !!masterEventById(key)
    : sub.value === 'tattoos' ? key === 'rules' || (key.startsWith('t:') ? !!tattooRules.templates[key.slice(2)] : !!slaveryRules.contracts[key.slice(2)])
    : !!gearRules.materials[key]
  return exists ? key : ''
})

async function select(key: string) {
  if (key === selected.value[sub.value] || !(await confirmDiscard())) return
  selected.value[sub.value] = key
}

// 手機版：平常只有清單；選了項目，編輯表單變成全螢幕頁面，左上角（或手機的返回鍵）回到清單
const editing = computed(() => isMobile.value && !!current.value)
const subLabel = computed(() => tabLabel(sub.value))
let dropLayer: (() => void) | null = null
watch(editing, (on) => {
  if (on && !dropLayer) dropLayer = pushLayer(() => select(''))
  else if (!on && dropLayer) {
    dropLayer()
    dropLayer = null
  }
}, { immediate: true })
onBeforeUnmount(() => dropLayer?.())

// 新增狀態時選類型（戰鬥狀態：技能與物品在戰鬥中施加；非戰鬥狀態：記在角色身上，事件、食物、地標給予）
const pickStatusType = ref(false)
function createStatus(type: 'combat' | 'cond') {
  pickStatusType.value = false
  try {
    if (type === 'combat') {
      const id = newModId('status')
      content.saveStatus(id, newStatus(statusKind.value === 'debuff' ? 'debuff' : 'buff'))
      select(id)
    } else {
      const id = newModId('cond')
      content.saveCondition(id, newCondition())
      select(`c:${id}`)
    }
    clearFilters()
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}

function create() {
  try {
    if (sub.value === 'enemies') {
      const id = newModId('enemy')
      content.saveEnemy(id, newEnemy(id))
      select(id)
    } else if (sub.value === 'items') {
      let name = '新的物品'
      for (let i = 2; itemDef(name) || game.state?.customItems?.[name]; i++) name = `新的物品${i}`
      content.saveItem(name, newItem(name))
      select(name)
    } else if (sub.value === 'npcs') {
      const id = newModId('npc')
      content.saveNpc(id, newNpc(id))
      select(id)
    } else if (sub.value === 'abilities') {
      const id = newModId('ability')
      content.saveAbility(id, newAbility(id))
      select(id)
    } else if (sub.value === 'statuses') {
      // 先選類型：戰鬥狀態或非戰鬥狀態
      pickStatusType.value = !pickStatusType.value
      return
    } else if (sub.value === 'perks') {
      const id = newModId('perk')
      content.savePerk(id, newPerk(id))
      select(id)
    } else if (sub.value === 'tattoos') {
      if (tattooKind.value === 'slave') {
        const id = newModId('mark')
        content.saveMark(id, newMark())
        select(`m:${id}`)
      } else {
        const id = newModId('tattoo')
        content.saveTattoo(id, newTattooTemplate(tattooKind.value === 'oath' ? 'oath' : 'plain'))
        select(`t:${id}`)
      }
    } else if (sub.value === 'landmarks') {
      const id = newLandmarkId()
      content.saveLandmark(id, newLandmark(id, game.state && locationById(game.state.location).type !== 'dungeon' ? game.state.location : undefined))
      select(id)
    } else if (sub.value === 'specialMaps') {
      const id = newSpecialMapId()
      content.saveSpecialMap(id, newSpecialMap(id, game.state?.location))
      select(id)
    } else if (sub.value === 'shops') {
      const id = newShopId()
      content.saveShop(id, newShop())
      select(id)
    } else if (sub.value === 'stories') {
      const id = newModId('story')
      content.saveStory(id, newStory(id))
      select(id)
    } else if (sub.value === 'events') {
      const id = newModId('event')
      content.saveTravelEvent(id, newTravelEvent(id, eventScope.value === 'town' || eventScope.value === 'dungeon' || eventScope.value === 'parasite' ? eventScope.value : 'road'))
      select(id)
    } else if (sub.value === 'masterEvents') {
      const id = newModId('mevent')
      content.saveMasterEvent(id, newMasterEvent(id, (POOL_IDS as string[]).includes(masterPool.value) ? masterPool.value as MasterEventPool : 'master'))
      select(id)
    } else if (sub.value === 'bases') {
      const id = newModId('base')
      content.saveBase(id, newBase(), true)
      select(id)
    } else {
      const id = newModId('mat')
      content.saveMaterial(id, newMaterial(), true)
      select(id)
    }
    // 新的項目可能不符合目前的篩選：全部解除，讓它出現在清單裡
    clearFilters()
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}

/** 以目前選的項目為範本複製一份自建項目 */
function duplicate() {
  const key = current.value
  // 非戰鬥狀態不能自建
  if (!key) return
  try {
    duplicateKey(key)
    // 複製出來的項目可能不符合目前的篩選：全部解除
    clearFilters()
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
/** 以 key 為範本複製一份自建項目並選取它 */
function duplicateKey(key: string) {
  if (sub.value === 'enemies') {
    const id = newModId('enemy')
    const src = JSON.parse(JSON.stringify(content.mods.enemies[key] ?? enemies[key]))
    delete src.spawns
    delete src.exclude
    content.saveEnemy(id, { ...src, name: `${src.name}（複製）`, custom: true })
    select(id)
  } else if (sub.value === 'items') {
    let name = `${key}（複製）`.slice(0, 20)
    for (let i = 2; itemDef(name) || game.state?.customItems?.[name]; i++) name = `${key.slice(0, 15)}（複製${i}）`
    content.saveItem(name, { ...JSON.parse(JSON.stringify(itemDef(key))), custom: true })
    select(name)
  } else if (sub.value === 'landmarks') {
    // 複製：同一個聚落另一格空地
    const id = newLandmarkId()
    const src = landmarks[key]!
    content.saveLandmark(id, { ...JSON.parse(JSON.stringify(src)), ...newLandmark(id, src.location), name: `${src.name}2`.slice(0, 12), emoji: src.emoji, desc: src.desc, types: [...src.types], ...(src.scene ? { scene: src.scene } : {}) })
    select(id)
  } else if (sub.value === 'specialMaps') {
    // 複製：通道不帶走（另一頭還接著原本的地圖）
    const id = newSpecialMapId()
    const src = JSON.parse(JSON.stringify(specialMaps[key]))
    delete src.connections
    content.saveSpecialMap(id, { ...src, id, name: `${src.name}2`.slice(0, 16), custom: true })
    select(id)
  } else if (sub.value === 'shops') {
    // 複製內建的店不會帶走專屬功能與位置
    const id = newShopId()
    content.saveShop(id, shopAsCustom(key))
    select(id)
  } else if (sub.value === 'events') {
    if (key === 'rules') return
    const id = newModId('event')
    const src = JSON.parse(JSON.stringify(content.mods.travelEvents?.[key] ?? travelEvents.templates.find((t) => t.id === key)))
    content.saveTravelEvent(id, { ...src, id, title: `${src.title}2`.slice(0, 20), custom: true })
    select(id)
  } else if (sub.value === 'masterEvents') {
    const id = newModId('mevent')
    const found = masterEventById(key)!
    content.saveMasterEvent(id, { ...JSON.parse(JSON.stringify(content.mods.masterEvents?.[key] ?? found.def)), pool: found.pool, custom: true })
    select(id)
  } else if (sub.value === 'stories') {
    const id = newModId('story')
    // 開頭旗標換成新任務自己的（和原本的重複算錯誤）
    content.saveStory(id, copyStory(content.mods.stories[key] ?? stories.find((d) => d.id === key)!, id))
    select(id)
  } else if (sub.value === 'perks') {
    // 複製種族特質會變成一般的特質
    const id = newModId('perk')
    const src = JSON.parse(JSON.stringify(content.mods.perks[key] ?? perkDef(key)))
    delete src.race
    content.savePerk(id, { ...src, name: `${src.name}2`.slice(0, 12), custom: true })
    select(id)
  } else if (sub.value === 'tattoos') {
    if (key === 'rules') return
    const raw = key.slice(2)
    if (key.startsWith('t:')) {
      const id = newModId('tattoo')
      const src = JSON.parse(JSON.stringify(content.mods.tattoos?.[raw] ?? tattooRules.templates[raw]))
      content.saveTattoo(id, { ...src, name: `${src.name}2`.slice(0, 12), custom: true })
      select(`t:${id}`)
    } else {
      const id = newModId('mark')
      const src = JSON.parse(JSON.stringify(content.mods.marks?.[raw] ?? slaveryRules.contracts[raw]))
      content.saveMark(id, { ...src, name: `${src.name}2`.slice(0, 12), custom: true })
      select(`m:${id}`)
    }
  } else if (sub.value === 'statuses' && key.startsWith('c:')) {
    const id = newModId('cond')
    const src = JSON.parse(JSON.stringify(companionRules.conditions[key.slice(2)]))
    content.saveCondition(id, { ...src, name: `${src.name}2`.slice(0, 10), custom: true })
    select(`c:${id}`)
  } else if (sub.value === 'statuses') {
    const id = newModId('status')
    const src = JSON.parse(JSON.stringify(content.mods.statuses[key] ?? statuses[key]))
    content.saveStatus(id, { ...src, name: `${src.name}2`.slice(0, 10), custom: true })
    select(id)
  } else if (sub.value === 'abilities') {
    const id = newModId('ability')
    const src = JSON.parse(JSON.stringify(content.mods.abilities[key] ?? abilities[key]))
    content.saveAbility(id, { ...src, name: `${src.name}2`.slice(0, 16), custom: true })
    select(id)
  } else if (sub.value === 'npcs') {
    const id = newModId('npc')
    const src = JSON.parse(JSON.stringify(content.mods.npcs[key] ?? namedNpcs.find((n) => n.id === key)))
    content.saveNpc(id, { ...src, name: `${src.name}2`.slice(0, 12), custom: true })
    select(id)
  } else if (sub.value === 'bases') {
    const id = newModId('base')
    const src = JSON.parse(JSON.stringify(content.mods.bases[key] ?? gearRules.bases[key]))
    content.saveBase(id, { ...src, name: `${src.name}2` }, true)
    select(id)
  } else {
    const id = newModId('mat')
    const src = JSON.parse(JSON.stringify(content.mods.materials[key] ?? gearRules.materials[key]))
    content.saveMaterial(id, { ...src, name: `${src.name}2` }, true)
    select(id)
  }
}

/** 有未儲存的修改時不能新增或複製（新的項目會先存進世界） */
const UNSAVED_HINT = '這一項還有未儲存的修改：先儲存或放棄修改，才能新增或複製'
const NEW_LABEL: Record<Sub, string> = { enemies: '＋ 新增怪物', items: '＋ 新增物品', bases: '＋ 新增底材', materials: '＋ 新增材料', abilities: '＋ 新增技能', statuses: '＋ 新增狀態', perks: '＋ 新增特質', tattoos: '＋ 新增刺青', landmarks: '＋ 新增地標', specialMaps: '＋ 新增地圖', shops: '＋ 新增商店', events: '＋ 新增事件', masterEvents: '＋ 新增事件', npcs: '＋ 新增角色', stories: '＋ 新增任務' }

// ---- 局部匯入、匯出（E2） ----
const showImport = ref(false)
/** ✨ AI 編排特殊任務（E4） */
const showGen = ref(false)
function onGenerated(id: string) {
  showGen.value = false
  void select(id)
}
const picking = ref(false)
const pickedKeys = ref<Set<RefKey>>(new Set())
/** 清單的 key → 內容的 key（區塊:id） */
function refOf(key: string): RefKey {
  if (sub.value === 'statuses') return key.startsWith('c:') ? `conditions:${key.slice(2)}` : `statuses:${key}`
  if (sub.value === 'tattoos') return key.startsWith('t:') ? `tattoos:${key.slice(2)}` : `marks:${key.slice(2)}`
  return `${sub.value === 'events' ? 'travelEvents' : sub.value}:${key}`
}
function togglePick(key: string, on: boolean) {
  const next = new Set(pickedKeys.value)
  if (on) next.add(refOf(key))
  else next.delete(refOf(key))
  pickedKeys.value = next
}
function exportPicked() {
  const out = content.exportPicked([...pickedKeys.value])
  download(`elondia-content-${content.activeName}-${dateStamp()}.json`, out.text)
  game.flash(`已匯出選的 ${pickedKeys.value.size} 項，連同用到的共 ${out.count} 項`)
}

// 上方的說明：關掉之後不再顯示（只記在這個瀏覽器）
const INTRO_KEY = 'elondia.ui.contentIntroHidden'
const showIntro = ref(true)
try {
  showIntro.value = localStorage.getItem(INTRO_KEY) !== '1'
} catch {
  // 讀不到就照常顯示
}
function hideIntro() {
  showIntro.value = false
  try {
    localStorage.setItem(INTRO_KEY, '1')
  } catch {
    // 寫不進去：只在這次關掉
  }
}

// ---- 匯出、匯入、重設 ----
const fileInput = ref<HTMLInputElement | null>(null)
function exportAll() {
  download(`elondia-content-${dateStamp()}.json`, content.exportMods())
}
async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (!confirm(`匯入會取代世界「${content.activeName}」目前所有的自訂內容，確定嗎？`)) return
  try {
    content.importMods(await f.text())
    game.flash('已匯入自訂內容')
  } catch (err) {
    game.error = `匯入失敗：${err instanceof Error ? err.message : String(err)}`
  }
}
function resetAll() {
  if (confirm(`刪除世界「${content.activeName}」所有自建的內容，並把修改過的內建項目全部恢復預設？`)) content.resetAll()
}
</script>

<template>
  <div class="content-view">
    <WorldBar />
    <p v-if="content.persistFailed" class="persist-warn small">
      ⚠️ 世界存不進瀏覽器（容量滿了，多半是上傳的圖示太多或太大）：這次的修改只在關掉頁面前有效。請移除一些圖示，或先匯出世界包備份。
    </p>
    <nav class="groups row" aria-label="內容的分類">
      <button v-for="g in GROUPS" :key="g.id" :class="{ active: group.id === g.id }" @click="openGroup(g.id)">{{ g.label }}</button>
      <span class="spacer" />
      <span class="small muted">{{ iconsTab ? `已自訂 ${Object.keys(content.mods.categoryIcons ?? {}).length} 種類別` : counts[sub] }}</span>
    </nav>
    <nav class="subs row" aria-label="頁籤">
      <button v-for="t in group.tabs" :key="t" class="small" :class="{ active: tab === t }" @click="openTab(t)">{{ tabLabel(t) }}</button>
    </nav>
    <p v-if="content.readOnly" class="small read-only">
      🔒 原版世界不能直接修改：新增、複製或儲存修改時，會自動建立「{{ content.forkName() }}」（原版的複本）並切換過去，修改存在那裡{{ game.state ? '，進行中的遊戲也改用它。' : '；也可以先在上面「＋ 新的世界」。' }}
    </p>
    <div v-if="showIntro" class="intro small muted">
      <p>
        在這裡新增或修改這個世界的內容。內建的項目可以修改（隨時「恢復預設」），不能刪除；自建的項目沒有被用到時可以刪除。
        修改存在目前的世界裡，用這個世界的存檔都會受影響；儲存後立刻生效（已經生成的地圖、今天的商店清單要等下次重新生成）。
      </p>
      <button class="ghost small" title="不再顯示這段說明" @click="hideIntro">✕</button>
    </div>
    <p v-if="content.problems.length" class="small warn-text">有些自訂內容沒辦法套用：{{ content.problems.join('；') }}</p>

    <section v-if="iconsTab" class="panel">
      <CategoryIconsEditor />
    </section>
    <div v-else class="layout">
      <section class="panel list-panel">
        <div class="row">
          <button class="small primary" :disabled="unsavedEdits" :title="unsavedEdits ? UNSAVED_HINT : ''" @click="create">{{ NEW_LABEL[sub] }}</button>
          <button v-if="sub === 'stories'" class="small" :disabled="unsavedEdits" :title="unsavedEdits ? UNSAVED_HINT : '寫一段描述，讓 AI 編排新的特殊任務（需要的 NPC、物品、地標、地圖、怪物也一起做）'" @click="showGen = true">✨ AI 編排</button>
          <button
            class="small" :disabled="!current || isSetting(current) || unsavedEdits"
            :title="unsavedEdits ? UNSAVED_HINT : '以選取的項目為範本，建立一個自建項目'" @click="duplicate"
          >📄 複製這一項</button>
          <button class="small" :class="{ active: picking }" title="勾幾項（自建或修改過的），匯出成內容檔：會連同它們用到的東西" @click="picking = !picking">☑ 選取匯出</button>
          <span class="spacer" />
          <button
            v-for="x in SETTINGS" :key="x.key" class="small" :class="{ active: current === x.key }"
            :title="x.edited ? '已修改' : ''" @click="select(x.key)"
          >{{ x.label }}{{ x.edited ? '・已修改' : '' }}</button>
        </div>
        <div v-if="sub === 'statuses' && pickStatusType && !unsavedEdits" class="pick-type">
          <span class="small muted">新狀態的類型：</span>
          <button class="small" title="技能或物品在戰鬥中施加，持續幾回合" @click="createStatus('combat')">⚔️ 戰鬥狀態（BUFF／DEBUFF）</button>
          <button class="small" title="記在角色身上，事件、特殊任務、地標、食物給予，可以設定長休時解除" @click="createStatus('cond')">🏕️ 非戰鬥狀態</button>
        </div>
        <div class="row">
          <input v-model="search" placeholder="搜尋名稱" class="grow" />
          <select v-model="filter">
            <option value="all">全部</option>
            <option value="custom">自建</option>
            <option value="edited">修改過的內建</option>
          </select>
        </div>
        <div v-if="filterDefs.length" class="row">
          <template v-for="f in primaryFilters" :key="f.name">
            <input v-if="f.list" v-model="f.model.value" :list="f.list === 'flags' ? 'cv-flags' : 'cv-npcs'" :placeholder="f.all" class="grow" />
            <select v-else v-model="f.model.value" class="grow">
              <option value="">{{ f.all }}</option>
              <option v-for="[k, n] in f.options!()" :key="k" :value="k">{{ n }}</option>
            </select>
          </template>
        </div>
        <details v-if="moreFilters.length" class="more-filters">
          <summary class="small">更多篩選{{ moreActive.length ? `（使用中 ${moreActive.length}）` : '' }}</summary>
          <div class="row">
            <template v-for="f in moreFilters" :key="f.name">
              <input v-if="f.list" v-model="f.model.value" :list="f.list === 'flags' ? 'cv-flags' : 'cv-npcs'" :placeholder="f.all" class="grow" />
              <select v-else v-model="f.model.value" class="grow">
                <option value="">{{ f.all }}</option>
                <option v-for="[k, n] in f.options!()" :key="k" :value="k">{{ n }}</option>
              </select>
            </template>
          </div>
        </details>
        <div v-if="moreActive.length" class="row chips-row">
          <button v-for="f in moreActive" :key="f.name" class="chip small" :title="`取消「${f.name}」的篩選`" @click="f.model.value = ''">{{ f.name }}：{{ filterValueName(f) }} ✕</button>
        </div>
        <datalist id="cv-flags"><option v-for="f in options.flags ?? []" :key="f" :value="f" /></datalist>
        <datalist id="cv-npcs"><option v-for="n in options.npcNames ?? []" :key="n" :value="n" /></datalist>
        <!-- 編輯器共用的自動完成：所有物品的名稱、內容裡用過的旗標（每個欄位各畫一份太多） -->
        <datalist id="cv-item-names"><option v-for="n in allItemNames" :key="n" :value="n" /></datalist>
        <datalist id="cv-known-flags"><option v-for="f in knownFlags" :key="f" :value="f" /></datalist>
        <p class="small muted count">
          符合 {{ rows.length }} 項
          <button v-if="anyFilter" class="ghost small" @click="clearFilters">清除篩選</button>
        </p>
        <div v-if="picking" class="row pick-bar small">
          <span>已選 {{ pickedKeys.size }} 項</span>
          <button class="small primary" :disabled="!pickedKeys.size" @click="exportPicked">📤 匯出選取的項目</button>
          <button class="small" :disabled="!pickedKeys.size" @click="pickedKeys = new Set()">清除</button>
          <span class="muted">只有自建或修改過的項目可以選。</span>
        </div>
        <ul class="plain rows">
          <li v-for="r in rows" :key="r.key" :class="{ active: current === r.key }" tabindex="0" @click="select(r.key)" @keydown.enter.self.prevent="select(r.key)">
            <input
              v-if="picking && r.status" type="checkbox" :checked="pickedKeys.has(refOf(r.key))" title="匯出這一項"
              @click.stop @change="togglePick(r.key, ($event.target as HTMLInputElement).checked)"
            />
            <ItemIcon v-if="sub === 'items'" :name="r.key" :size="18" class="row-ic" />
            <ItemIcon v-else-if="sub === 'bases'" :spec="{ base: r.key, material: '' }" :size="18" class="row-ic" />
            <ContentIcon v-else-if="sub === 'enemies'" kind="monster" :id="r.key" :size="16" class="row-ic" />
            <ContentIcon v-else-if="sub === 'abilities'" kind="ability" :id="r.key" :size="16" class="row-ic" />
            <ContentIcon v-else-if="sub === 'materials'" kind="material" :id="r.key" :size="16" class="row-ic" />
            <ContentIcon v-else-if="sub === 'perks'" kind="perk" :id="r.key" :size="16" class="row-ic" />
            <span class="name">{{ r.name }}</span>
            <span v-if="r.status === 'custom'" class="tag">自建</span>
            <span v-else-if="r.status === 'edited'" class="tag">已修改</span>
            <span class="small muted note-r">{{ r.note }}</span>
          </li>
          <li v-if="!rows.length" class="muted small">沒有符合的項目。</li>
        </ul>
      </section>

      <section v-if="!isMobile || current" class="panel editor" :class="{ 'm-page': editing }">
        <header v-if="editing" class="m-head">
          <button class="ghost" @click="select('')"><GameIcon name="right" :size="16" class="flip" />返回清單</button>
          <span class="muted small">{{ subLabel }}</span>
        </header>
        <p v-if="!current" class="muted">從左邊選一個項目，或新增一個。</p>
        <EnemyEditor v-else-if="sub === 'enemies'" :id="current" :key="`e-${current}`" @deleted="select('')" />
        <ItemEditor v-else-if="sub === 'items'" :key="`i-${current}`" :name="current" @renamed="select" @deleted="select('')" />
        <AbilityEditor v-else-if="sub === 'abilities'" :id="current" :key="`a-${current}`" @deleted="select('')" />
        <ConditionEditor v-else-if="sub === 'statuses' && current.startsWith('c:')" :id="current.slice(2)" :key="current" @deleted="select('')" />
        <StatusEditor v-else-if="sub === 'statuses'" :id="current" :key="`s-${current}`" @deleted="select('')" />
        <PerkEditor v-else-if="sub === 'perks'" :id="current" :key="`p-${current}`" @deleted="select('')" />
        <ShopEditor v-else-if="sub === 'shops'" :id="current" :key="`shop-${current}`" @deleted="select('')" />
        <LandmarkEditor v-else-if="sub === 'landmarks'" :id="current" :key="`lm-${current}`" @deleted="select('')" />
        <SpecialMapEditor v-else-if="sub === 'specialMaps'" :id="current" :key="`sm-${current}`" @deleted="select('')" />
        <template v-else-if="sub === 'tattoos'">
          <MarkRulesEditor v-if="current === 'rules'" key="rules" />
          <TattooEditor v-else-if="current.startsWith('t:')" :id="current.slice(2)" :key="current" @deleted="select('')" />
          <MarkEditor v-else :id="current.slice(2)" :key="current" @deleted="select('')" />
        </template>
        <template v-else-if="sub === 'events'">
          <EventRulesEditor v-if="current === 'rules'" key="ev-rules" />
          <TravelEventEditor v-else :id="current" :key="`ev-${current}`" @deleted="select('')" />
        </template>
        <MasterEventEditor v-else-if="sub === 'masterEvents'" :id="current" :key="`me-${current}`" @deleted="select('')" />
        <NpcEditor v-else-if="sub === 'npcs'" :id="current" :key="`n-${current}`" @deleted="select('')" />
        <CountersEditor v-else-if="sub === 'stories' && current === COUNTERS_KEY" key="counters" />
        <StorylineOverview v-else-if="sub === 'stories' && current === STORYLINES_KEY" key="storylines" @open="select" />
        <StoryEditor v-else-if="sub === 'stories'" :id="current" :key="`s-${current}`" @deleted="select('')" @open="select" />
        <BindRulesEditor v-else-if="sub === 'bases' && current === BIND_RULES_KEY" key="bind-rules" />
        <GearEditor v-else-if="sub === 'bases'" :id="current" :key="`b-${current}`" kind="base" @deleted="select('')" />
        <GearEditor v-else :id="current" :key="`m-${current}`" kind="material" @deleted="select('')" />
      </section>
    </div>

    <div class="row footer small">
      <span class="muted">這些內容屬於世界「{{ content.activeName }}」，用這個世界的存檔共用。</span>
      <span class="spacer" />
      <details class="world-menu">
        <summary class="small">⋯ 這個世界的全部內容</summary>
        <div class="menu" @click="($event.currentTarget as HTMLElement).closest('details')!.open = false">
          <button class="small" @click="showImport = true">📥 從檔案或其他世界帶入幾項…</button>
          <button class="small" :disabled="content.readOnly" @click="exportAll">📤 匯出自訂內容（內容檔）</button>
          <button class="small" title="會取代這個世界目前所有的自訂內容（原版世界時存成新的世界）" @click="fileInput?.click()">📥 匯入內容檔，取代全部內容…</button>
          <button class="small danger" :disabled="content.readOnly" @click="resetAll">↩️ 全部恢復預設…</button>
        </div>
      </details>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onImport" />
    </div>
    <ImportPickerDialog v-if="showImport" :open="showImport" @close="showImport = false" />
    <QuestGenDialog v-if="showGen" :open="showGen" @close="showGen = false" @created="onGenerated" />
  </div>
</template>

<style scoped>
.content-view { display: grid; gap: 10px; max-width: 1400px; margin: 0 auto; }
.groups, .subs { gap: 6px; }
.groups button.active { border-color: var(--accent); color: var(--accent); background: var(--panel-2); }
.subs { padding-left: 4px; border-left: 2px solid var(--gold-lo); }
.pick-type { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px; border: 1px dashed var(--border); border-radius: var(--radius); }
.subs button.active, .list-panel button.active { border-color: var(--accent); color: var(--accent); }
.read-only { margin: 0; padding: 6px 10px; border: 1px solid var(--gold-lo); border-radius: var(--radius); color: var(--accent); }
.intro { display: flex; gap: 6px; align-items: flex-start; padding: 6px 10px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.intro p { margin: 0; flex: 1; line-height: 1.7; }
.more-filters summary { cursor: pointer; color: var(--accent); }
.more-filters .row { margin-top: 6px; }
.chips-row .chip { padding: 0 8px; border-radius: 999px; }
.pick-bar { padding: 4px 6px; border: 1px dashed var(--gold-lo); border-radius: var(--radius); }
.world-menu { position: relative; }
.world-menu summary { cursor: pointer; list-style: none; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; }
.world-menu .menu { position: absolute; right: 0; bottom: calc(100% + 4px); z-index: 5; display: grid; gap: 4px; padding: 6px; min-width: 240px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 16px #000a; }
.spacer { flex: 1; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.warn-text { color: var(--danger); }
.layout { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 10px; align-items: start; }
/* 和手機版同一個斷點（mobile/mobile.ts 的 720px） */
@media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
/* 手機版：編輯表單是全螢幕頁面（清單留在底下，返回後捲動位置還在） */
.editor.m-page {
  position: fixed; inset: 0; z-index: 30; margin: 0; border: none; border-radius: 0; overflow-y: auto; overscroll-behavior: contain;
  background: var(--bg); padding: 0 12px calc(16px + env(safe-area-inset-bottom, 0px));
}
.editor.m-page { --m-head-h: calc(48px + env(safe-area-inset-top, 0px)); }
.m-head {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; height: var(--m-head-h); margin: 0 -12px 10px; padding: env(safe-area-inset-top, 0px) 12px 0;
  background: linear-gradient(180deg, #2a2017, #1d1611); border-bottom: 1px solid var(--gold-lo);
}
/* 編輯器自己的表頭（名稱、儲存……）停在「返回清單」那一條的下面，不會把它蓋住 */
.editor.m-page :deep(.editor > .head) { top: var(--m-head-h); }
.m-head button { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); }
.m-head .flip { transform: scaleX(-1); }
.m-head .muted { margin-left: auto; }
.list-panel { display: grid; gap: 6px; position: sticky; top: 8px; }
.grow { flex: 1; min-width: 100px; }
.count { margin: 0; }
.rows { max-height: 70vh; overflow: auto; margin: 0; padding: 0; list-style: none; }
.rows li { display: flex; gap: 6px; align-items: center; padding: 3px 6px; border-radius: var(--radius); cursor: pointer; }
.rows li:hover { background: var(--panel-2); }
.rows li.active { background: var(--panel-2); outline: 1px solid var(--accent); }
.rows .name { flex: 1; min-width: 5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 說明讓位給名字：放不下時說明先縮（選取匯出多了勾選框時名字不會只剩一個字） */
.note-r { white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 選到（focus）或正在編輯的那一列顯示完整的名字與說明：放不下時換行，不截斷 */
.rows li:is(:focus, :focus-within, .active) { flex-wrap: wrap; }
.rows li:is(:focus, :focus-within, .active) :is(.name, .note-r) { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
.rows li:focus-visible { outline: 2px solid var(--accent); }
.rows li > input, .rows li > .tag { flex: none; }
.row-ic { color: var(--accent); }
.persist-warn { margin: 0; padding: 6px 10px; border: 1px solid var(--danger); border-radius: var(--radius); color: var(--danger); }
.footer { border-top: 1px solid var(--border); padding-top: 8px; }
</style>
