<script setup lang="ts">
import { computed } from 'vue'
import { attributeRules, geography, type LocationType, type RouteMode } from '@/engine/data'
import { cellName, type CellKind } from '@/engine/grid'
import { travelEvents, type DungeonTrigger } from '@/engine/road'
import { MODE_NAME } from '@/engine/travel'
import { parasiteRules } from '@/engine/parasites'
import { BROOD_KIND_NAME } from '@/engine/brood'
import {
  DUNGEON_TRIGGERS, EVENT_LAYERS, FATHER_FILTERS, LOCATION_TYPE_NAME, PARASITE_MOMENTS, PREG_STAGE_IDS, PREG_STAGE_NAME, ROUTE_MODES,
  townEventCells, type TravelEventMod,
} from '@/engine/travelEventMods'
import Hint from '../../ui/Hint.vue'
import type { EventField, EventTypeDef } from './eventTypes'

// 事件類型專屬的欄位（eventTypes.ts 的 fields 決定這個類型有哪些）：怎麼出現、在哪裡、什麼時候、對誰。
// 共用的欄位（標題、描述、內容、條件、檢定與選項）在 TravelEventEditor.vue
const props = defineProps<{ draft: TravelEventMod; type: EventTypeDef }>()
const d = computed(() => props.draft)
const has = (f: EventField) => props.type.fields.includes(f)
const id = computed(() => props.type.id)

type ListField = 'modes' | 'cells' | 'location_types' | 'locations' | 'triggers' | 'dungeons' | 'regions' | 'moments'
function toggle(field: ListField, v: string, on: boolean) {
  const set = new Set<string>((d.value[field] as string[] | undefined) ?? [])
  if (on) set.add(v)
  else set.delete(v)
  const rec = d.value as unknown as Record<string, string[] | undefined>
  if (set.size) rec[field] = [...set]
  else delete rec[field]
}
function toggleNum(field: 'layers' | 'stages', v: number, on: boolean) {
  const set = new Set<number>(d.value[field] ?? [])
  if (on) set.add(v)
  else set.delete(v)
  if (set.size) d.value[field] = [...set].sort()
  else delete d.value[field]
}
function toggleOrdered<T extends string>(field: 'preg_stages' | 'brood_kinds' | 'father_races', all: readonly T[], v: T, on: boolean) {
  const set = new Set<string>((d.value[field] as string[] | undefined) ?? [])
  if (on) set.add(v)
  else set.delete(v)
  const rec = d.value as unknown as Record<string, string[] | undefined>
  if (set.size) rec[field] = all.filter((x) => set.has(x))
  else delete rec[field]
}
function setHours(v: string) {
  if (v === 'day' || v === 'night') d.value.hours = v
  else delete d.value.hours
}
function setTri(field: 'mixed' | 'forced', v: string) {
  if (v === 'yes') d.value[field] = true
  else if (v === 'no') d.value[field] = false
  else delete d.value[field]
}
function setKind(kind: 'check' | 'choice') {
  d.value.kind = kind
  if (kind === 'check') d.value.check ??= { attr: 'int', dc: 12 }
  if (kind === 'choice' && !d.value.options?.length) d.value.options = [{ label: '離開', success: {} }]
}
// 懷孕：察覺事件的選項才有「察覺」，換成孕期事件時拿掉
function setKnown(v: boolean) {
  if (v) {
    d.value.known = true
    for (const o of d.value.options ?? []) delete o.reveal
  } else delete d.value.known
}
const parasiteIds = Object.keys(parasiteRules.parasites)
const raceIds = Object.keys(attributeRules.races)
const regionIds = geography.regions
const settlements = geography.locations.filter((l) => l.type !== 'dungeon')
const dungeonPlaces = geography.locations.filter((l) => l.type === 'dungeon')
const cellLabel = (c: string) => cellName(c as CellKind)
// 苗床長到支配時就產下了：階段只到共生
const stageList = computed(() => (id.value === 'brood' ? parasiteRules.stages.slice(0, -1) : parasiteRules.stages))
const subjectLabel = computed(() => (id.value === 'pregnancy' ? '隊上懷孕的夥伴（{a}）' : '隊上泌乳的夥伴（{a}）'))
const cooldownDefault = computed(() => String(id.value === 'town' ? travelEvents.town?.repeat_days ?? 7 : travelEvents.dungeon?.repeat_days ?? 3))
const regionHint = computed(() => (id.value === 'road'
  ? '這一段路要去的地區（海路是兩端的地區，去程回程都算）；沒勾時任何地區。旅途事件在規劃路線時就決定，所以魅氣濃度、地點這類條件看的是出發的地方，要限定地區請用這裡。'
  : '沒勾時不限。'))
const hasGrid = computed(() => (['kind', 'tier', 'cooldown', 'hours', 'cast', 'pregKind', 'subject', 'father', 'mixed', 'forced', 'inSettlement'] as EventField[]).some(has))
</script>

<template>
  <div class="type-fields">
    <div v-if="hasGrid" class="grid">
      <label v-if="has('pregKind')">種類
        <select :value="d.known ? 'stage' : 'discover'" @change="setKnown(($event.target as HTMLSelectElement).value === 'stage')">
          <option value="discover">察覺事件（還沒察覺的人）</option>
          <option value="stage">孕期事件（已經察覺的人）</option>
        </select>
      </label>
      <label v-if="has('kind')">怎麼進行
        <select :value="d.kind" @change="setKind(($event.target as HTMLSelectElement).value as 'check' | 'choice')">
          <option value="check">檢定（走到時直接擲骰揭曉）</option>
          <option value="choice">選擇（玩家選一個選項）</option>
        </select>
      </label>
      <label v-if="has('tier')">等級
        <select v-model="d.tier">
          <option value="normal">普通事件</option>
          <option value="advanced">高階事件（✨，可以帶進臨時地圖）</option>
        </select>
      </label>
      <label v-if="has('subject')">誰的事
        <select v-model="d.subject">
          <option value="pc">主角</option>
          <option value="companion">{{ subjectLabel }}</option>
        </select>
      </label>
      <label v-if="has('cast')"><span>登場角色 <Hint text="0～2 位：甲是 {a}、乙是 {b}；{a他}、{b他} 照性別換成他或她。" /></span>
        <select v-model.number="d.cast">
          <option :value="undefined">沒有</option>
          <option :value="1">1 位（甲）</option>
          <option :value="2">2 位（甲、乙）</option>
        </select>
      </label>
      <label v-if="has('father')">父親
        <select :value="d.father ?? ''" @change="d.father = (($event.target as HTMLSelectElement).value || undefined) as TravelEventMod['father']">
          <option value="">不限</option>
          <option v-for="(n, k) in FATHER_FILTERS" :key="k" :value="k">{{ n }}</option>
        </select>
      </label>
      <label v-if="has('mixed')">混血
        <select :value="d.mixed === undefined ? '' : d.mixed ? 'yes' : 'no'" @change="setTri('mixed', ($event.target as HTMLSelectElement).value)">
          <option value="">不限</option><option value="yes">父親和母親不同種族</option><option value="no">同種族</option>
        </select>
      </label>
      <label v-if="has('forced')">怎麼懷上的
        <select :value="d.forced === undefined ? '' : d.forced ? 'yes' : 'no'" @change="setTri('forced', ($event.target as HTMLSelectElement).value)">
          <option value="">不限</option><option value="yes">只有非自願懷上的</option><option value="no">只有不是非自願的</option>
        </select>
      </label>
      <label v-if="has('cooldown')">同一事件幾天後才會再出現 <input v-model.number="d.cooldown_days" type="number" min="0" max="60" class="num" :placeholder="cooldownDefault" /></label>
      <label v-if="has('hours')"><span>時段 <Hint text="時段不對時不會抽到這個事件。適合「今晚」「半夜」這類場景；地下城與寄生物也看外面的時間，長休時看入睡的時間（醒來時已經是早上）。寄生物在旅途中的發作不看時段。" /></span>
        <select :value="d.hours ?? ''" @change="setHours(($event.target as HTMLSelectElement).value)">
          <option value="">不限</option>
          <option value="day">只在白天（6～18 點）</option>
          <option value="night">只在夜裡（18～6 點）</option>
        </select>
      </label>
      <label v-if="has('inSettlement')" class="check"><input type="checkbox" :checked="!!d.in_settlement" @change="d.in_settlement = ($event.target as HTMLInputElement).checked || undefined" /> 只在聚落裡</label>
    </div>
    <label v-if="has('offscreen') && d.cast" class="block"><span>沒人去處理時的近況 <Hint text="線索過期時，主角認識的登場角色記一則近況（NPC 近況）；空著時用預設的一句。" /></span><input v-model="d.offscreen" maxlength="120" /></label>

    <div v-if="has('parasite')" class="row small"><b>寄生物</b>
      <select v-model="d.parasite">
        <option v-for="p in parasiteIds" :key="p" :value="p">{{ parasiteRules.parasites[p]!.name }}</option>
        <option v-if="d.parasite && !parasiteIds.includes(d.parasite)" :value="d.parasite">{{ d.parasite }}（不存在）</option>
      </select>
    </div>
    <div v-if="has('broodKinds')" class="row small"><b>苗床的種類</b>
      <label v-for="(n, k) in BROOD_KIND_NAME" :key="k" class="check">
        <input type="checkbox" :checked="d.brood_kinds?.includes(k)" @change="toggleOrdered('brood_kinds', ['egg', 'live', 'parasite'] as const, k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
      </label>
    </div>
    <div v-if="has('stages')" class="row small"><b>階段</b>
      <label v-for="(st, i) in stageList" :key="i" class="check">
        <input type="checkbox" :checked="d.stages?.includes(i)" @change="toggleNum('stages', i, ($event.target as HTMLInputElement).checked)" /> {{ st.name }}（{{ st.min }}+）
      </label>
    </div>
    <div v-if="has('pregStages')" class="row small"><b>懷孕的階段</b>
      <label v-for="st in PREG_STAGE_IDS" :key="st" class="check">
        <input type="checkbox" :checked="d.preg_stages?.includes(st)" @change="toggleOrdered('preg_stages', PREG_STAGE_IDS, st, ($event.target as HTMLInputElement).checked)" /> {{ PREG_STAGE_NAME[st] }}
      </label>
    </div>
    <div v-if="has('modes')" class="row small"><b>路段</b> <Hint text="沒勾時任何路段都會出現。" />
      <label v-for="m in ROUTE_MODES" :key="m" class="check">
        <input type="checkbox" :checked="d.modes?.includes(m)" @change="toggle('modes', m as RouteMode, ($event.target as HTMLInputElement).checked)" /> {{ MODE_NAME[m] }}
      </label>
    </div>
    <div v-if="has('cells')" class="row small"><b>設施</b>
      <label v-for="c in townEventCells()" :key="c" class="check">
        <input type="checkbox" :checked="d.cells?.includes(c)" @change="toggle('cells', c, ($event.target as HTMLInputElement).checked)" /> {{ cellLabel(c) }}
      </label>
    </div>
    <div v-if="has('locationTypes')" class="row small"><b>聚落規模</b>
      <label v-for="(n, k) in LOCATION_TYPE_NAME" :key="k" class="check">
        <input type="checkbox" :checked="d.location_types?.includes(k)" @change="toggle('location_types', k as LocationType, ($event.target as HTMLInputElement).checked)" /> {{ n }}
      </label>
    </div>
    <div v-if="has('locations')" class="row small"><b>只在這些地點</b>
      <label v-for="l in settlements" :key="l.id" class="check">
        <input type="checkbox" :checked="d.locations?.includes(l.id)" @change="toggle('locations', l.id, ($event.target as HTMLInputElement).checked)" /> {{ l.name }}
      </label>
    </div>
    <div v-if="has('triggers')" class="row small"><b>觸發點</b> <Hint text="至少勾一個。" />
      <label v-for="(n, k) in DUNGEON_TRIGGERS" :key="k" class="check">
        <input type="checkbox" :checked="d.triggers?.includes(k)" @change="toggle('triggers', k as DungeonTrigger, ($event.target as HTMLInputElement).checked)" /> {{ n }}
      </label>
    </div>
    <div v-if="has('layers')" class="row small"><b>層</b> <Hint text="沒勾時不限。近郊與地下城的周邊都是第 0 層。" />
      <label v-for="(n, i) in EVENT_LAYERS" :key="i" class="check">
        <input type="checkbox" :checked="d.layers?.includes(i)" @change="toggleNum('layers', i, ($event.target as HTMLInputElement).checked)" /> {{ n }}
      </label>
    </div>
    <div v-if="has('regions')" class="row small"><b>地區</b> <Hint :text="regionHint" />
      <label v-for="r in regionIds" :key="r.id" class="check">
        <input type="checkbox" :checked="d.regions?.includes(r.id)" @change="toggle('regions', r.id, ($event.target as HTMLInputElement).checked)" /> {{ r.name }}
      </label>
    </div>
    <div v-if="has('dungeons')" class="row small"><b>{{ id === 'lead' ? '只在這些地點' : '只在這些地下城' }}</b> <Hint :text="id === 'lead' ? '近郊寫那座聚落、地下城寫地下城。' : '近郊的事件寫那座聚落；這裡只列地下城。'" />
      <label v-for="l in id === 'lead' ? geography.locations : dungeonPlaces" :key="l.id" class="check">
        <input type="checkbox" :checked="d.dungeons?.includes(l.id)" @change="toggle('dungeons', l.id, ($event.target as HTMLInputElement).checked)" /> {{ l.name }}
      </label>
    </div>
    <div v-if="has('moments')" class="row small"><b>時機</b> <Hint :text="id === 'pregnancy' ? '沒勾時不限。察覺事件只在長休之後、旅途擲（走動不擲）；孕期事件三種時機都擲。' : '沒勾時不限。'" />
      <label v-for="(n, k) in PARASITE_MOMENTS" :key="k" class="check">
        <input type="checkbox" :checked="d.moments?.includes(k)" @change="toggle('moments', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
      </label>
    </div>
    <div v-if="has('fatherRaces')" class="row small"><b>父親的種族</b> <Hint text="沒勾時不限。父親不明時，有寫種族或混血的條件都不成立；非自願看懷上的那次經歷。" />
      <label v-for="r in raceIds" :key="r" class="check">
        <input type="checkbox" :checked="d.father_races?.includes(r)" @change="toggleOrdered('father_races', raceIds, r, ($event.target as HTMLInputElement).checked)" /> {{ attributeRules.races[r]?.name ?? r }}
      </label>
    </div>
  </div>
</template>

<style scoped src="../editor.css"></style>
<style scoped>
.type-fields { display: grid; gap: 6px; }
</style>
