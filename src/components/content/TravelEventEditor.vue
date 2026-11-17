<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { travelEvents, type EventScope, type RoadOption } from '@/engine/road'
import { schoolIds, schoolName } from '@/engine/schools'
import { builtinTravelEvent, travelEventWarnings, type TravelEventMod } from '@/engine/travelEventMods'
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
import EventTypeFields from './events/EventTypeFields.vue'
import { changeEventType, EVENT_TYPES, eventTypeOf } from './events/eventTypes'

// 事件的編輯表單（旅途、城鎮、地下城、線索、寄生物、懷孕、泌乳、苗床）。
// 所有類型共用的放在這裡：基本（類型、標題、分類、描述）、內容、劇情條件、檢定與選項；
// 類型專屬的欄位（在哪裡、什麼時候、對誰）照 events/eventTypes.ts 的表，由 EventTypeFields.vue 顯示
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
/** 這個事件的類型（圖示、說明、專屬欄位） */
const type = computed(() => eventTypeOf(draft.value))
const pregnancy = computed(() => type.value.id === 'pregnancy')
// 線索事件的效果可以指定登場角色（EffectsEditor 的 NPC 選單多出甲、乙）
provide('eventCast', computed(() => (type.value.id === 'lead' ? draft.value.cast ?? 0 : 0)))
// 選項裡新增寄生物效果時，預設是這件發作事件自己的寄生物（EffectsEditor）
provide('eventParasite', computed(() => (type.value.id === 'parasite' ? draft.value.parasite : undefined)))
// 懷孕的事件：效果的親密度可以指定懷孕的夥伴（$a）與孩子的父親（$f）
provide('eventPregnancy', computed(() => (pregnancy.value ? { companion: draft.value.subject === 'companion' }
  : type.value.id === 'lactation' ? { companion: draft.value.subject === 'companion', label: '泌乳的夥伴', father: false } : undefined)))
const warnings = computed(() => travelEventWarnings(draft.value))
const requires = computed(() => draft.value.requires!)
const categories = computed(() => travelEvents.town?.categories ?? {})

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
      :title="`${type.icon} ${draft.title || '（未命名）'}`" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty"
      @save="save" @discard="reset" @restore="restore" @remove="remove"
    />
    <p class="small muted">
      id：{{ id }}。{{ type.intro(draft) }}
      {{ type.onPc ? '事件發生在主角身上：只有選擇，檢定由主角自己擲。' : '檢定由隊伍裡最擅長那個屬性的人來擲。' }}
    </p>
    <p v-for="w in warnings" :key="w" class="small warn-text">⚠️ {{ w }}</p>

    <!-- 共用：類型、標題、分類、描述 -->
    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label><span>事件類型 <Hint text="換類型時，下面「…的設定」換成那個類型的欄位；發生在主角身上的類型只有選擇。" /></span>
          <select :value="type.id" @change="changeEventType(draft, ($event.target as HTMLSelectElement).value as EventScope)">
            <option v-for="t in EVENT_TYPES" :key="t.id" :value="t.id">{{ t.icon }} {{ t.name }}</option>
          </select>
        </label>
        <label>標題 <input v-model="draft.title" maxlength="20" /></label>
        <label><span>分類 <Hint text="城鎮事件依最近的分類平衡。" /></span>
          <select v-model="draft.category">
            <option :value="undefined">（無）</option>
            <option v-for="(n, k) in categories" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
      </div>
      <label class="block">描述（給玩家與 AI）<textarea v-model="draft.text" rows="3" maxlength="400" /></label>
    </FoldSet>

    <!-- 類型專屬：在哪裡、什麼時候、對誰 -->
    <FoldSet>
      <template #legend>{{ type.icon }} {{ type.legend }}的設定 <Hint text="這一區只有這個類型才有；勾選的項目沒勾時不限。" /></template>
      <EventTypeFields :draft="draft" :type="type" />
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
            <Hint v-if="type.dcScale" :text="`14 是「普通」：實際 DC 依${type.dcScale}調整，寫 12 就是比普通容易 2、寫 16 比普通難 2。`" />
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
