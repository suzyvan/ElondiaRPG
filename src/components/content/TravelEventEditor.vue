<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { geography, STAFF_JOBS, type LocationType, type RouteMode, type StaffJob } from '@/engine/data'
import { jobName } from '@/engine/staff'
import { cellName, type CellKind } from '@/engine/grid'
import { travelEvents, type RoadOption } from '@/engine/road'
import { MODE_NAME } from '@/engine/travel'
import { parasiteRules } from '@/engine/parasites'
import { schoolIds, schoolName } from '@/engine/schools'
import { BROOD_KIND_NAME } from '@/engine/brood'
import { builtinTravelEvent, DUNGEON_TRIGGERS, EVENT_LAYERS, FATHER_FILTERS, PARASITE_MOMENTS, PREG_STAGE_IDS, PREG_STAGE_NAME, LOCATION_TYPE_NAME, ROUTE_MODES, townEventCells, travelEventWarnings, type TravelEventMod } from '@/engine/travelEventMods'
import { attributeRules } from '@/engine/data'
import type { DungeonTrigger, EventScope } from '@/engine/road'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import OutcomeEditor from './OutcomeEditor.vue'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import RequiresEditor from './RequiresEditor.vue'
import CheckList from './CheckList.vue'
import { BODY_OPTIONS, CONTENT_TAG_OPTIONS } from './checks'
import FoldSet from './FoldSet.vue'
import CheckRow from './CheckRow.vue'

// 旅途事件、城鎮事件、地下城事件或寄生物的發作的編輯表單：在哪裡出現、檢定或選項、結果
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ deleted: [] }>()
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
// requires 先放一個空的（表單綁定用；儲存時空的條件會被拿掉），才不會一打開就顯示「未儲存」
const current = (): TravelEventMod => {
  const t = clone(content.mods.travelEvents?.[props.id] ?? (travelEvents.templates.find((x) => x.id === props.id) as TravelEventMod))
  t.requires ??= {}
  return t
}
const draft = ref<TravelEventMod>(current())
const saved = ref(JSON.stringify(draft.value))
watch(() => props.id, () => reset())
function reset() {
  draft.value = current()
  saved.value = JSON.stringify(draft.value)
}
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const builtin = computed(() => !!builtinTravelEvent(props.id))
const edited = computed(() => builtin.value && !!content.mods.travelEvents?.[props.id])
const town = computed(() => draft.value.scope === 'town')
const dungeon = computed(() => draft.value.scope === 'dungeon')
const parasite = computed(() => draft.value.scope === 'parasite')
const lead = computed(() => draft.value.scope === 'lead')
const pregnancy = computed(() => draft.value.scope === 'pregnancy')
const lactation = computed(() => draft.value.scope === 'lactation')
const brood = computed(() => draft.value.scope === 'brood')
const home = computed(() => draft.value.scope === 'home')
// 發生在主角身上的事件（地下城事件、線索事件、寄生物的發作、懷孕、泌乳、苗床、家裡的事）：只有選擇，主角自己擲
const onPc = computed(() => dungeon.value || parasite.value || lead.value || pregnancy.value || lactation.value || brood.value || home.value)
// 家裡的事：家僕的職位、親密度範圍
const homeJobs = STAFF_JOBS
function setStaffAffinity(i: 0 | 1, v: string) {
  const cur: [number, number] = draft.value.staff_affinity ? [...draft.value.staff_affinity] : [-100, 100]
  cur[i] = v === '' ? (i === 0 ? -100 : 100) : Number(v)
  if (cur[0] <= -100 && cur[1] >= 100) delete draft.value.staff_affinity
  else draft.value.staff_affinity = cur
}
function setHours(v: string) {
  if (v === 'day' || v === 'night') draft.value.hours = v
  else delete draft.value.hours
}
// 線索事件的效果可以指定登場角色（EffectsEditor 的 NPC 選單多出甲、乙）
provide('eventCast', computed(() => (lead.value ? draft.value.cast ?? 0 : 0)))
const parasiteIds = Object.keys(parasiteRules.parasites)
// 選項裡新增寄生物效果時，預設是這件發作事件自己的寄生物（EffectsEditor）
provide('eventParasite', computed(() => (parasite.value ? draft.value.parasite : undefined)))
// 懷孕的事件：效果的親密度可以指定懷孕的夥伴（$a）與孩子的父親（$f）
provide('eventPregnancy', computed(() => (pregnancy.value ? { companion: draft.value.subject === 'companion' }
  : lactation.value ? { companion: draft.value.subject === 'companion', label: '泌乳的夥伴', father: false }
  : home.value ? { companion: true, label: '這件事的家僕', father: false } : undefined)))
// 家裡的事：效果多了家僕請假、工錢、收起裝飾家具（EffectsEditor）
provide('eventHome', home)
const raceIds = Object.keys(attributeRules.races)
function toggleStage(v: string, on: boolean) {
  const set = new Set<string>(draft.value.preg_stages ?? [])
  if (on) set.add(v)
  else set.delete(v)
  if (set.size) draft.value.preg_stages = PREG_STAGE_IDS.filter((x) => set.has(x))
  else delete draft.value.preg_stages
}
function toggleRace(v: string, on: boolean) {
  const set = new Set<string>(draft.value.father_races ?? [])
  if (on) set.add(v)
  else set.delete(v)
  if (set.size) draft.value.father_races = [...set]
  else delete draft.value.father_races
}
function setTri(field: 'mixed' | 'forced', v: string) {
  if (v === 'yes') draft.value[field] = true
  else if (v === 'no') draft.value[field] = false
  else delete draft.value[field]
}
function setKnown(v: boolean) {
  if (v) {
    draft.value.known = true
    for (const o of draft.value.options ?? []) delete o.reveal
  } else delete draft.value.known
}
function setScope(v: string) {
  const scope = (['town', 'dungeon', 'parasite', 'lead', 'pregnancy', 'lactation', 'brood', 'home'].includes(v) ? v : undefined) as EventScope | undefined
  draft.value.scope = scope
  if (scope === 'home') setKind('choice')
  if (scope === 'dungeon') {
    setKind('choice')
    draft.value.triggers ??= ['trap']
  }
  if (scope === 'lead') setKind('choice')
  if (scope === 'parasite') {
    setKind('choice')
    draft.value.parasite ??= parasiteIds[0]
  }
  if (scope === 'pregnancy') {
    setKind('choice')
    draft.value.subject ??= 'pc'
    draft.value.tags = [...new Set([...(draft.value.tags ?? []), 'adult' as const, 'pregnancy' as const])]
  }
  if (scope === 'lactation') {
    setKind('choice')
    draft.value.subject ??= 'pc'
    draft.value.tags = [...new Set([...(draft.value.tags ?? []), 'adult' as const, 'lactation' as const])]
  }
  if (scope === 'brood') {
    setKind('choice')
    draft.value.tags = [...new Set([...(draft.value.tags ?? []), 'adult' as const, 'monster_brood' as const])]
  }
}
function toggleBroodKind(k: 'egg' | 'live' | 'parasite', on: boolean) {
  const set = new Set<string>(draft.value.brood_kinds ?? [])
  if (on) set.add(k)
  else set.delete(k)
  if (set.size) draft.value.brood_kinds = (['egg', 'live', 'parasite'] as const).filter((x) => set.has(x))
  else delete draft.value.brood_kinds
}
function toggleNum(field: 'layers' | 'stages', v: number, on: boolean) {
  const set = new Set<number>(draft.value[field] ?? [])
  if (on) set.add(v)
  else set.delete(v)
  if (set.size) draft.value[field] = [...set].sort()
  else delete draft.value[field]
}
const warnings = computed(() => travelEventWarnings(draft.value))
const requires = computed(() => draft.value.requires!)
const categories = computed(() => travelEvents.town?.categories ?? {})
const settlements = geography.locations.filter((l) => l.type !== 'dungeon')
const dungeonPlaces = geography.locations.filter((l) => l.type === 'dungeon')
const cellLabel = (c: string) => cellName(c as CellKind)

function toggle<T extends string>(field: 'modes' | 'cells' | 'location_types' | 'locations' | 'triggers' | 'dungeons' | 'regions' | 'tags' | 'pc_body' | 'moments' | 'staff', v: T, on: boolean) {
  const set = new Set<string>((draft.value[field] as string[] | undefined) ?? [])
  if (on) set.add(v)
  else set.delete(v)
  if (set.size) (draft.value as unknown as Record<string, string[]>)[field] = [...set]
  else delete draft.value[field]
}
function setKind(kind: 'check' | 'choice') {
  draft.value.kind = kind
  if (kind === 'check') draft.value.check ??= { attr: 'int', dc: 12 }
  if (kind === 'choice' && !draft.value.options?.length) draft.value.options = [{ label: '離開', success: {} }]
}
function setTier(tier: 'normal' | 'advanced') {
  draft.value.tier = tier
}
function addOption() {
  ;(draft.value.options ??= []).push({ label: '新的選項', success: {} })
}
function toggleCheck(o: RoadOption, on: boolean) {
  if (on) o.check = { attr: 'cha', dc: 12 }
  else {
    delete o.check
    delete o.fail
  }
}
function save() {
  try {
    content.saveTravelEvent(props.id, draft.value)
    reset()
    game.flash(`已儲存「${draft.value.title}」`)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function restore() {
  if (!confirm(`把「${draft.value.title}」恢復成內建的樣子？`)) return
  content.restoreTravelEvent(props.id)
  reset()
}
function remove() {
  if (!confirm(`刪除「${draft.value.title}」？等待中的這個事件會作廢。`)) return
  try {
    content.deleteTravelEvent(props.id)
    emit('deleted')
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}

// 選項的流派條件（RoadOption.requires.schools）：至少修了其中一個才能選
function toggleOptionSchool(o: RoadOption, id: string, on: boolean) {
  const list = new Set(o.requires?.schools ?? [])
  if (on) list.add(id)
  else list.delete(id)
  const { schools: _drop, ...rest } = o.requires ?? {}
  void _drop
  o.requires = list.size ? { ...rest, schools: [...list] } : Object.keys(rest).length ? rest : undefined
  if (!o.requires) delete o.requires
}
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="`${town ? '🏘️' : home ? '🏠' : dungeon ? '⚠️' : parasite ? '💗' : lead ? '🔎' : pregnancy ? '🍼' : lactation ? '💧' : brood ? '🪺' : '🧭'} ${draft.title || '（未命名）'}`" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty"
      @save="save" @discard="reset" @restore="restore" @remove="remove"
    />
    <p class="small muted">
      id：{{ id }}。{{ home ? '家裡的事：有家僕（或做家務的奴隸）時，在自己的房子裡走動、在家長休醒來時依「事件設定」的機率與冷卻出現。事件裡的他是符合職位、親密度條件的一位家僕：文字寫 {a}，效果選「這件事的家僕」。' : town ? '城鎮事件：走上聚落裡符合的設施時，依「事件設定」的機率與冷卻出現。' : dungeon ? '地下城事件：在地下城與近郊觸發陷阱、打開寶箱、採集或在安全房長休之後，依「事件設定」的機率與冷卻出現。' : parasite ? '寄生物的發作：身上有這個寄生物（沒馴服、沒沉睡）時，走動、旅途或長休之後依 parasites.json 的機率（乘上存檔規則「寄生發作的機率」與階段的倍率）出現；選項的結果通常是侵蝕度的加減（效果「寄生物的侵蝕度」）。' : pregnancy ? (draft.known ? '孕期事件：已經察覺懷孕的人（主角或隊上的夥伴），依階段在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現（胎動、乾嘔……）。' : '察覺事件：還沒察覺懷孕的人，受孕幾天之後在長休之後或旅途每天出現；選項的「察覺」讓這個人察覺懷孕，沒察覺的之後還會再遇到，到中期一律自動察覺。') + ' 夥伴的事件文字寫 {a}（那位夥伴），父親寫 {f}（父親是主角時寫成「你」）；效果的親密度可以選「懷孕的夥伴」「孩子的父親」。' : lactation ? '泌乳的事件：泌乳中的主角（條件「泌乳」成立）或隊上泌乳的夥伴，在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現。夥伴的事件文字寫 {a}，效果的親密度可以選「泌乳的夥伴」。' : brood ? '苗床的事件：主角身上有符合種類、階段的苗床時，在長休之後、旅途每天或走動時依「⚙️ 懷孕與泌乳設定」的機率出現（長到支配時改成產下的事件）。文字寫 {m} 是留下苗床的怪物（沒記下時是「不知名的魔物」）；交給 AI 時會附上那隻怪物的樣子。' : lead ? '線索事件：地區的線索池擲到「事件」時，照地點與層抽一件放在地圖上一格，走到那一格時發生。登場角色在擲線索池時決定（一半是這個地區主角認識的冒險者，其他是新生成的）；文字寫 {a}、{b}（名字）與 {a他}、{b他}（照性別換成他或她），效果的角色選「登場角色甲／乙」。' : '旅途事件：出發時依路段的機率與種類權重擲好，放在旅途的格子上。' }}
      {{ onPc ? '事件發生在主角身上：檢定由主角自己擲。' : '檢定由隊伍裡最擅長那個屬性的人來擲。' }}
    </p>
    <p v-for="w in warnings" :key="w" class="small warn-text">⚠️ {{ w }}</p>

    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>標題 <input v-model="draft.title" maxlength="20" /></label>
        <label>在哪裡
          <select :value="draft.scope ?? 'road'" @change="setScope(($event.target as HTMLSelectElement).value)">
            <option value="road">旅途上</option>
            <option value="town">城鎮的設施上</option>
            <option value="dungeon">地下城與近郊</option>
            <option value="parasite">寄生物的發作</option>
            <option value="lead">線索事件（線索池的事件點）</option>
            <option value="pregnancy">懷孕的事件（察覺、孕期）</option>
            <option value="lactation">泌乳的事件</option>
            <option value="brood">苗床的事件</option>
            <option value="home">家裡的事（家僕）</option>
          </select>
        </label>
        <label v-if="!onPc">種類
          <select :value="draft.kind" @change="setKind(($event.target as HTMLSelectElement).value as 'check' | 'choice')">
            <option value="check">檢定（走到時直接擲骰揭曉）</option>
            <option value="choice">選擇（玩家選一個選項）</option>
          </select>
        </label>
        <label v-if="!town && !onPc">等級
          <select :value="draft.tier" @change="setTier(($event.target as HTMLSelectElement).value as 'normal' | 'advanced')">
            <option value="normal">普通事件</option>
            <option value="advanced">高階事件（✨，可以帶進臨時地圖）</option>
          </select>
        </label>
        <label><span>分類 <Hint text="城鎮事件依最近的分類平衡。" /></span>
          <select v-model="draft.category">
            <option :value="undefined">（無）</option>
            <option v-for="(n, k) in categories" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label v-if="town">同一事件幾天後才會再出現 <input v-model.number="draft.cooldown_days" type="number" min="0" max="60" class="num" :placeholder="String(travelEvents.town?.repeat_days ?? 7)" /></label>
        <label v-if="lead"><span>登場角色 <Hint text="0～2 位：甲是 {a}、乙是 {b}；{a他}、{b他} 照性別換成他或她。" /></span>
          <select v-model.number="draft.cast">
            <option :value="undefined">沒有</option>
            <option :value="1">1 位（甲）</option>
            <option :value="2">2 位（甲、乙）</option>
          </select>
        </label>
        <label v-if="home">同一事件幾天後才會再出現 <input v-model.number="draft.cooldown_days" type="number" min="0" max="60" class="num" :placeholder="String(travelEvents.home?.repeat_days ?? 6)" /></label>
        <label v-if="dungeon">同一事件幾天後才會再出現 <input v-model.number="draft.cooldown_days" type="number" min="0" max="60" class="num" :placeholder="String(travelEvents.dungeon?.repeat_days ?? 3)" /></label>
        <label v-if="town || dungeon || parasite || pregnancy || lactation || brood || home"><span>時段 <Hint text="時段不對時不會抽到這個事件。適合「今晚」「半夜」這類場景；地下城與寄生物也看外面的時間，長休時看入睡的時間（醒來時已經是早上）。旅途、線索事件與寄生物在旅途中的發作不看時段。" /></span>
          <select :value="draft.hours ?? ''" @change="setHours(($event.target as HTMLSelectElement).value)">
            <option value="">不限</option>
            <option value="day">只在白天（6～18 點）</option>
            <option value="night">只在夜裡（18～6 點）</option>
          </select>
        </label>
      </div>
      <label class="block">描述（給玩家與 AI）<textarea v-model="draft.text" rows="3" maxlength="400" /></label>
      <label v-if="lead && draft.cast" class="block"><span>沒人去處理時的近況 <Hint text="線索過期時，主角認識的登場角色記一則近況（NPC 近況）；空著時用預設的一句。" /></span><input v-model="draft.offscreen" maxlength="120" /></label>
    </FoldSet>

    <FoldSet v-if="dungeon || lead">
      <template #legend>出現的地方 <Hint :text="lead ? '每一項沒勾時不限。近郊與地下城的周邊都是第 0 層。' : '每一項沒勾時不限（觸發點至少勾一個）。'" /></template>
      <div v-if="dungeon" class="row small"><b>觸發點</b>
        <label v-for="(n, k) in DUNGEON_TRIGGERS" :key="k" class="check">
          <input type="checkbox" :checked="draft.triggers?.includes(k)" @change="toggle<DungeonTrigger>('triggers', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
      <div class="row small"><b>層</b>
        <label v-for="(n, i) in EVENT_LAYERS" :key="i" class="check">
          <input type="checkbox" :checked="draft.layers?.includes(i)" @change="toggleNum('layers', i, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
      <div class="row small"><b>地區</b>
        <label v-for="r in geography.regions" :key="r.id" class="check">
          <input type="checkbox" :checked="draft.regions?.includes(r.id)" @change="toggle('regions', r.id, ($event.target as HTMLInputElement).checked)" /> {{ r.name }}
        </label>
      </div>
      <div class="row small"><b>{{ lead ? '只在這些地點' : '只在這些地下城' }}</b> <Hint :text="lead ? '近郊寫那座聚落、地下城寫地下城。' : '近郊的事件寫那座聚落；這裡只列地下城。'" />
        <label v-for="l in lead ? geography.locations : dungeonPlaces" :key="l.id" class="check">
          <input type="checkbox" :checked="draft.dungeons?.includes(l.id)" @change="toggle('dungeons', l.id, ($event.target as HTMLInputElement).checked)" /> {{ l.name }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="parasite">
      <template #legend>哪一種寄生物 <Hint text="階段與時機沒勾時不限。" /></template>
      <div class="row small">
        <select v-model="draft.parasite">
          <option v-for="p in parasiteIds" :key="p" :value="p">{{ parasiteRules.parasites[p]!.name }}</option>
          <option v-if="draft.parasite && !parasiteIds.includes(draft.parasite)" :value="draft.parasite">{{ draft.parasite }}（不存在）</option>
        </select>
      </div>
      <div class="row small"><b>階段</b>
        <label v-for="(st, i) in parasiteRules.stages" :key="i" class="check">
          <input type="checkbox" :checked="draft.stages?.includes(i)" @change="toggleNum('stages', i, ($event.target as HTMLInputElement).checked)" /> {{ st.name }}（{{ st.min }}+）
        </label>
      </div>
      <div class="row small"><b>時機</b>
        <label v-for="(n, k) in PARASITE_MOMENTS" :key="k" class="check">
          <input type="checkbox" :checked="draft.moments?.includes(k)" @change="toggle('moments', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="pregnancy">
      <template #legend>懷孕 <Hint text="每一項沒勾、沒選時不限。父親的種族、混血看受孕時記下的父親（父親不明時，有寫種族或混血的條件都不成立）；非自願看懷上的那次經歷。" /></template>
      <div class="grid">
        <label>種類
          <select :value="draft.known ? 'stage' : 'discover'" @change="setKnown(($event.target as HTMLSelectElement).value === 'stage')">
            <option value="discover">察覺事件（還沒察覺的人）</option>
            <option value="stage">孕期事件（已經察覺的人）</option>
          </select>
        </label>
        <label>誰的事
          <select v-model="draft.subject">
            <option value="pc">主角</option>
            <option value="companion">隊上懷孕的夥伴（{a}）</option>
          </select>
        </label>
        <label>父親
          <select :value="draft.father ?? ''" @change="draft.father = (($event.target as HTMLSelectElement).value || undefined) as TravelEventMod['father']">
            <option value="">不限</option>
            <option v-for="(n, k) in FATHER_FILTERS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label>混血
          <select :value="draft.mixed === undefined ? '' : draft.mixed ? 'yes' : 'no'" @change="setTri('mixed', ($event.target as HTMLSelectElement).value)">
            <option value="">不限</option><option value="yes">父親和母親不同種族</option><option value="no">同種族</option>
          </select>
        </label>
        <label>怎麼懷上的
          <select :value="draft.forced === undefined ? '' : draft.forced ? 'yes' : 'no'" @change="setTri('forced', ($event.target as HTMLSelectElement).value)">
            <option value="">不限</option><option value="yes">只有非自願懷上的</option><option value="no">只有不是非自願的</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" :checked="!!draft.in_settlement" @change="draft.in_settlement = ($event.target as HTMLInputElement).checked || undefined" /> 只在聚落裡</label>
      </div>
      <div class="row small"><b>階段</b>
        <label v-for="st in PREG_STAGE_IDS" :key="st" class="check">
          <input type="checkbox" :checked="draft.preg_stages?.includes(st)" @change="toggleStage(st, ($event.target as HTMLInputElement).checked)" /> {{ PREG_STAGE_NAME[st] }}
        </label>
      </div>
      <div class="row small"><b>時機</b>
        <label v-for="(n, k) in PARASITE_MOMENTS" :key="k" class="check">
          <input type="checkbox" :checked="draft.moments?.includes(k)" @change="toggle('moments', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
        <Hint text="察覺事件只在長休之後、旅途擲（走動不擲）；孕期事件三種時機都擲。" />
      </div>
      <div class="row small"><b>父親的種族</b>
        <label v-for="r in raceIds" :key="r" class="check">
          <input type="checkbox" :checked="draft.father_races?.includes(r)" @change="toggleRace(r, ($event.target as HTMLInputElement).checked)" /> {{ attributeRules.races[r]?.name ?? r }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="lactation">
      <template #legend>泌乳 <Hint text="時機沒勾時不限。" /></template>
      <div class="grid">
        <label>誰的事
          <select v-model="draft.subject">
            <option value="pc">主角</option>
            <option value="companion">隊上泌乳的夥伴（{a}）</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" :checked="!!draft.in_settlement" @change="draft.in_settlement = ($event.target as HTMLInputElement).checked || undefined" /> 只在聚落裡</label>
      </div>
      <div class="row small"><b>時機</b>
        <label v-for="(n, k) in PARASITE_MOMENTS" :key="k" class="check">
          <input type="checkbox" :checked="draft.moments?.includes(k)" @change="toggle('moments', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="brood">
      <template #legend>苗床 <Hint text="種類、階段、時機沒勾時不限。長到支配時改成產下的事件，所以階段只有潛伏、發作、共生。" /></template>
      <div class="row small"><b>種類</b>
        <label v-for="(n, k) in BROOD_KIND_NAME" :key="k" class="check">
          <input type="checkbox" :checked="draft.brood_kinds?.includes(k)" @change="toggleBroodKind(k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
      <div class="row small"><b>階段</b>
        <label v-for="(st, i) in parasiteRules.stages.slice(0, -1)" :key="i" class="check">
          <input type="checkbox" :checked="draft.stages?.includes(i)" @change="toggleNum('stages', i, ($event.target as HTMLInputElement).checked)" /> {{ st.name }}（{{ st.min }}+）
        </label>
      </div>
      <div class="row small"><b>時機</b>
        <label v-for="(n, k) in PARASITE_MOMENTS" :key="k" class="check">
          <input type="checkbox" :checked="draft.moments?.includes(k)" @change="toggle('moments', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
        <label class="check"><input type="checkbox" :checked="!!draft.in_settlement" @change="draft.in_settlement = ($event.target as HTMLInputElement).checked || undefined" /> 只在聚落裡</label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="home">
      <template #legend>家僕與時機 <Hint text="有家僕（或做家務的奴隸）時，在自己的房子裡走動、在家長休醒來時依「事件設定」的機率出現。事件裡的他是符合條件的一位家僕：文字寫 {a}，效果的親密度、慾望指標選「這件事的家僕」。每一項沒勾時不限。" /></template>
      <div class="row small"><b>職位</b>
        <label v-for="j in homeJobs" :key="j" class="check">
          <input type="checkbox" :checked="draft.staff?.includes(j)" @change="toggle<StaffJob>('staff', j, ($event.target as HTMLInputElement).checked)" /> {{ jobName(j) }}
        </label>
      </div>
      <div class="row small"><b>誰</b>
        <select :value="draft.staff_bond ?? ''" @change="(($event.target as HTMLSelectElement).value ? (draft.staff_bond = ($event.target as HTMLSelectElement).value as 'hired' | 'slave') : delete draft.staff_bond)">
          <option value="">雇來的家僕與做家務的奴隸</option>
          <option value="hired">只有雇來的家僕</option>
          <option value="slave">只有做家務的奴隸</option>
        </select>
        <b>親密度</b>
        <input type="number" min="-100" max="100" class="num" :value="draft.staff_affinity?.[0] ?? ''" placeholder="-100" @change="setStaffAffinity(0, ($event.target as HTMLInputElement).value)" />～
        <input type="number" min="-100" max="100" class="num" :value="draft.staff_affinity?.[1] ?? ''" placeholder="100" @change="setStaffAffinity(1, ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="row small"><b>時機</b>
        <label class="check"><input type="checkbox" :checked="draft.moments?.includes('step')" @change="toggle<'step' | 'travel' | 'rest'>('moments', 'step', ($event.target as HTMLInputElement).checked)" /> 在家裡走動</label>
        <label class="check"><input type="checkbox" :checked="draft.moments?.includes('rest')" @change="toggle<'step' | 'travel' | 'rest'>('moments', 'rest', ($event.target as HTMLInputElement).checked)" /> 在家長休醒來</label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="!town">
      <template #legend>路段 <Hint text="沒勾時任何路段都會出現。" /></template>
      <div class="row">
        <label v-for="m in ROUTE_MODES" :key="m" class="check small">
          <input type="checkbox" :checked="draft.modes?.includes(m)" @change="toggle<RouteMode>('modes', m, ($event.target as HTMLInputElement).checked)" /> {{ MODE_NAME[m] }}
        </label>
      </div>
      <div v-if="!onPc" class="row small"><b>地區</b> <Hint text="這一段路要去的地區（海路是兩端的地區，去程回程都算）；沒勾時任何地區。旅途事件在規劃路線時就決定，所以魅氣濃度、地點這類條件看的是出發的地方，要限定地區請用這裡。" />
        <label v-for="r in geography.regions" :key="r.id" class="check">
          <input type="checkbox" :checked="draft.regions?.includes(r.id)" @change="toggle('regions', r.id, ($event.target as HTMLInputElement).checked)" /> {{ r.name }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else>
      <template #legend>出現的地方 <Hint text="每一項沒勾時不限。" /></template>
      <div class="row small"><b>設施</b>
        <label v-for="c in townEventCells()" :key="c" class="check">
          <input type="checkbox" :checked="draft.cells?.includes(c)" @change="toggle('cells', c, ($event.target as HTMLInputElement).checked)" /> {{ cellLabel(c) }}
        </label>
      </div>
      <div class="row small"><b>聚落規模</b>
        <label v-for="(n, k) in LOCATION_TYPE_NAME" :key="k" class="check">
          <input type="checkbox" :checked="draft.location_types?.includes(k)" @change="toggle<LocationType>('location_types', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
      <div class="row small"><b>只在這些地點</b>
        <label v-for="l in settlements" :key="l.id" class="check">
          <input type="checkbox" :checked="draft.locations?.includes(l.id)" @change="toggle('locations', l.id, ($event.target as HTMLInputElement).checked)" /> {{ l.name }}
        </label>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>內容 <Hint text="內容標籤：設定沒有開啟或關掉時這個事件不出現。親密場景：選項勾了「進入親密場景」時，敘事依這段描寫。" /></template>
      <CheckList v-model="draft.tags" label="內容標籤" :options="CONTENT_TAG_OPTIONS" />
      <CheckList v-model="draft.pc_body" label="只給這些主角" hint="依主角的體型；都不勾＝都可以。勾了女性形象、中性而沒勾男性形象時，設定打開「陽剛體型也能遇到『只給陰柔、中性』的成人內容」的玩家一樣會遇到。" :options="BODY_OPTIONS" />
      <label class="block">親密場景（成人向，可以空著）<textarea v-model="draft.scene" rows="2" maxlength="200" /></label>
    </FoldSet>

    <FoldSet>
      <template #legend>劇情條件</template>
      <RequiresEditor :model-value="requires" label="出現的條件" placeholder="全部成立才出現" @update:model-value="(v) => (draft.requires = v)" />
    </FoldSet>

    <FoldSet v-if="draft.kind === 'check'">
      <template #legend>檢定 <Hint v-if="draft.tier === 'advanced'" text="成功時接著出現下面的選項。" /></template>
      <div class="row small">
        <CheckRow :check="draft.check!" />
      </div>
      <OutcomeEditor v-model="draft.success" label="成功" optional event />
      <OutcomeEditor v-model="draft.fail" label="失敗" optional event />
    </FoldSet>

    <FoldSet v-if="draft.kind === 'choice' || draft.tier === 'advanced'">
      <template #legend>選項（最多 5 個）</template>
      <div v-for="(o, i) in draft.options ?? []" :key="i" class="option">
        <div class="row small">
          <input v-model="o.label" maxlength="30" class="grow" />
          <label class="check"><input type="checkbox" :checked="!!o.check" @change="toggleCheck(o, ($event.target as HTMLInputElement).checked)" /> 要檢定</label>
          <template v-if="o.check">
            <CheckRow :check="o.check" />
            <Hint v-if="onPc && !pregnancy" :text="`14 是「普通」：實際 DC 依${parasite ? '主角等級與侵蝕度的階段' : lead ? '事件點所在的層' : '地下城的層'}調整，寫 12 就是比普通容易 2、寫 16 比普通難 2。`" />
          </template>
          <select v-if="draft.scene" v-model="o.adult_scene" class="small" title="這個選項進入親密場景">
            <option :value="undefined">不進入親密場景</option>
            <option value="always">一定進入親密場景</option>
            <option v-if="o.check" value="success">成功時進入</option>
            <option v-if="o.check" value="fail">失敗時進入</option>
          </select>
          <select v-if="pregnancy && !draft.known" v-model="o.reveal" class="small" title="選了這個選項會不會察覺懷孕">
            <option :value="undefined">不會察覺</option>
            <option value="always">選了就察覺</option>
            <option v-if="o.check" value="success">成功時察覺</option>
          </select>
          <label v-if="pregnancy" class="small" title="這次生產的 DC 減多少（例如產婆的叮囑）；有檢定時成功才算">生產 DC − <input v-model.number="o.birth_bonus" type="number" min="0" max="5" class="num" /></label>
          <button class="small" @click="draft.options!.splice(i, 1)" title="移除">✕</button>
        </div>
        <div class="row small">
          只有修了這些流派的人能選
          <label v-for="id in schoolIds()" :key="id" class="check"><input type="checkbox" :checked="o.requires?.schools?.includes(id)" @change="toggleOptionSchool(o, id, ($event.target as HTMLInputElement).checked)" /> {{ schoolName(id) }}</label>
          <Hint text="勾了之後，主角至少要修其中一個流派才能選這個選項；沒修的人看得到，但選項灰掉、寫出要哪一派。" />
        </div>
        <OutcomeEditor v-model="o.success" :label="o.check ? '成功' : '結果'" optional event />
        <OutcomeEditor v-if="o.check" v-model="o.fail" label="失敗" optional event />
      </div>
      <button class="small" :disabled="(draft.options?.length ?? 0) >= 5" @click="addOption">＋ 選項</button>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
