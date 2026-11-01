<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { geography, type LocationType, type RouteMode } from '@/engine/data'
import { cellName, type CellKind } from '@/engine/grid'
import { travelEvents, type RoadOption } from '@/engine/road'
import { MODE_NAME } from '@/engine/travel'
import { parasiteRules } from '@/engine/parasites'
import { builtinTravelEvent, DUNGEON_TRIGGERS, EVENT_LAYERS, PARASITE_MOMENTS, LOCATION_TYPE_NAME, ROUTE_MODES, townEventCells, travelEventWarnings, type TravelEventMod } from '@/engine/travelEventMods'
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
// 發生在主角身上的事件（地下城事件、寄生物的發作）：只有選擇，主角自己擲
const onPc = computed(() => dungeon.value || parasite.value)
const parasiteIds = Object.keys(parasiteRules.parasites)
function setScope(v: string) {
  const scope = (['town', 'dungeon', 'parasite'].includes(v) ? v : undefined) as EventScope | undefined
  draft.value.scope = scope
  if (scope === 'dungeon') {
    setKind('choice')
    draft.value.triggers ??= ['trap']
  }
  if (scope === 'parasite') {
    setKind('choice')
    draft.value.parasite ??= parasiteIds[0]
  }
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

function toggle<T extends string>(field: 'modes' | 'cells' | 'location_types' | 'locations' | 'triggers' | 'dungeons' | 'regions' | 'tags' | 'pc_body' | 'moments', v: T, on: boolean) {
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
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="`${town ? '🏘️' : dungeon ? '⚠️' : parasite ? '💗' : '🧭'} ${draft.title || '（未命名）'}`" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty"
      @save="save" @discard="reset" @restore="restore" @remove="remove"
    />
    <p class="small muted">
      id：{{ id }}。{{ town ? '城鎮事件：走上聚落裡符合的設施時，依「事件設定」的機率與冷卻出現。' : dungeon ? '地下城事件：在地下城與近郊觸發陷阱、打開寶箱、採集或在安全房長休之後，依「事件設定」的機率與冷卻出現。' : parasite ? '寄生物的發作：身上有這個寄生物（沒馴服、沒沉睡）時，走動、旅途或長休之後依 parasites.json 的機率（乘上存檔規則「寄生發作的機率」與階段的倍率）出現；選項的結果通常是侵蝕度的加減（效果「寄生物的侵蝕度」）。' : '旅途事件：出發時依路段的機率與種類權重擲好，放在旅途的格子上。' }}
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
        <label v-if="dungeon">同一事件幾天後才會再出現 <input v-model.number="draft.cooldown_days" type="number" min="0" max="60" class="num" :placeholder="String(travelEvents.dungeon?.repeat_days ?? 3)" /></label>
      </div>
      <label class="block">描述（給玩家與 AI）<textarea v-model="draft.text" rows="3" maxlength="400" /></label>
    </FoldSet>

    <FoldSet v-if="dungeon">
      <template #legend>出現的地方 <Hint text="每一項沒勾時不限（觸發點至少勾一個）。" /></template>
      <div class="row small"><b>觸發點</b>
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
      <div class="row small"><b>只在這些地下城</b> <Hint text="近郊的事件寫那座聚落；這裡只列地下城。" />
        <label v-for="l in dungeonPlaces" :key="l.id" class="check">
          <input type="checkbox" :checked="draft.dungeons?.includes(l.id)" @change="toggle('dungeons', l.id, ($event.target as HTMLInputElement).checked)" /> {{ l.name }}
        </label>
      </div>
    </FoldSet>
    <FoldSet v-else-if="parasite">
      <template #legend>哪一種寄生物 <Hint text="階段與時機沒勾時不限。" /></template>
      <div class="row small">
        <select v-model="draft.parasite">
          <option v-for="p in parasiteIds" :key="p" :value="p">{{ parasiteRules.parasites[p]!.name }}</option>
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
    <FoldSet v-else-if="!town">
      <template #legend>路段 <Hint text="沒勾時任何路段都會出現。" /></template>
      <div class="row">
        <label v-for="m in ROUTE_MODES" :key="m" class="check small">
          <input type="checkbox" :checked="draft.modes?.includes(m)" @change="toggle<RouteMode>('modes', m, ($event.target as HTMLInputElement).checked)" /> {{ MODE_NAME[m] }}
        </label>
      </div>
      <div v-if="!onPc" class="row small"><b>地區</b> <Hint text="這一段路要去的地區；沒勾時任何地區。旅途事件在規劃路線時就決定，所以魅氣濃度、地點這類條件看的是出發的地方，要限定地區請用這裡。" />
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
            <Hint v-if="onPc" :text="`14 是「普通」：實際 DC 依${parasite ? '主角等級與侵蝕度的階段' : '地下城的層'}調整，寫 12 就是比普通容易 2、寫 16 比普通難 2。`" />
          </template>
          <select v-if="draft.scene" v-model="o.adult_scene" class="small" title="這個選項進入親密場景">
            <option :value="undefined">不進入親密場景</option>
            <option value="always">一定進入親密場景</option>
            <option v-if="o.check" value="success">成功時進入</option>
            <option v-if="o.check" value="fail">失敗時進入</option>
          </select>
          <button class="small" @click="draft.options!.splice(i, 1)" title="移除">✕</button>
        </div>
        <OutcomeEditor v-model="o.success" :label="o.check ? '成功' : '結果'" optional event />
        <OutcomeEditor v-if="o.check" v-model="o.fail" label="失敗" optional event />
      </div>
      <button class="small" :disabled="(draft.options?.length ?? 0) >= 5" @click="addOption">＋ 選項</button>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
