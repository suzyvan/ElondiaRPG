<script setup lang="ts">
import { computed, ref } from 'vue'
import { MODE_NAME } from '@/engine/travel'
import { currentEventRules, DUNGEON_TRIGGERS, EVENT_LAYERS, ROUTE_MODES, type EventRulesMod } from '@/engine/travelEventMods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import FoldSet from './FoldSet.vue'

// 事件設定：旅途各種路段每天發生事件的機率、事件種類的權重；城鎮事件的機率、冷卻與分類平衡
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const draft = ref<EventRulesMod>(clone(currentEventRules()))
const saved = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const edited = computed(() => !!content.mods.eventRules?.rules)
function reset() {
  draft.value = clone(currentEventRules())
  saved.value = JSON.stringify(draft.value)
}
function save() {
  try {
    content.saveEventRules(draft.value)
    reset()
    game.flash('已儲存事件設定')
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function restore() {
  if (!confirm('把事件設定恢復成內建的樣子？')) return
  content.restoreEventRules()
  reset()
}
const WEIGHT_NAME = { auto: '原本的旅途事件與普通檢定', choice: '普通選擇', combat: '戰鬥', advanced: '高階事件' } as const
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="'⚙️ 事件設定'" :kind="'rules'" :edited="edited" :dirty="dirty"
      @save="save" @discard="reset" @restore="restore"
    />
    <FoldSet>
      <template #legend>旅途：每天發生事件的機率（0～1）</template>
      <div class="grid">
        <label v-for="m in ROUTE_MODES" :key="m">{{ MODE_NAME[m] }} <input v-model.number="draft.chance[m]" type="number" min="0" max="1" step="0.05" class="num" /></label>
      </div>
    </FoldSet>
    <FoldSet>
      <template #legend>旅途：事件種類的權重 <Hint text="戰鬥只在官道、山道、荒野、地底。" /></template>
      <div class="grid">
        <label v-for="(n, k) in WEIGHT_NAME" :key="k">{{ n }} <input v-model.number="draft.weights[k]" type="number" min="0" max="20" step="0.5" class="num" /></label>
      </div>
    </FoldSet>
    <FoldSet>
      <template #legend>城鎮事件</template>
      <div class="grid">
        <label>走上設施時的機率（0～1）<input v-model.number="draft.town.chance" type="number" min="0" max="1" step="0.01" class="num" /></label>
        <label>兩次事件至少隔幾小時 <input v-model.number="draft.town.cooldown_hours" type="number" min="0" max="168" class="num" /></label>
        <label>同一事件預設幾天後才會再出現 <input v-model.number="draft.town.repeat_days" type="number" min="0" max="60" class="num" /></label>
        <label>最近出現過的分類，權重乘上（0～1）<input v-model.number="draft.town.recent_penalty" type="number" min="0" max="1" step="0.05" class="num" /></label>
        <label>記住最近幾次的分類 <input v-model.number="draft.town.recent_size" type="number" min="0" max="10" class="num" /></label>
      </div>
      <p class="small muted">分類：{{ Object.values(draft.town.categories).join('、') }}。同一個分類最近出現過一次，權重就乘一次，所以不會一直遇到同一類的事。</p>
    </FoldSet>
    <FoldSet>
      <template #legend>地下城事件 <Hint text="在地下城與近郊觸發陷阱（沒察覺時）、打開寶箱、採集、在安全房長休之後的機率。內建的地下城事件都是成人向。" /></template>
      <div class="grid">
        <label v-for="(n, k) in DUNGEON_TRIGGERS" :key="k">{{ n }}的機率（0～1）<input v-model.number="draft.dungeon.chance[k]" type="number" min="0" max="1" step="0.01" class="num" /></label>
        <label>兩次事件至少隔幾小時 <input v-model.number="draft.dungeon.cooldown_hours" type="number" min="0" max="168" class="num" /></label>
        <label>同一事件預設幾天後才會再出現 <input v-model.number="draft.dungeon.repeat_days" type="number" min="0" max="60" class="num" /></label>
        <label v-for="(n, i) in EVENT_LAYERS" :key="n"><span>{{ n }}普通難度的 DC <Hint text="選項寫的 DC 以 14 為「普通」：實際 DC = 這一層的 DC +（寫的 DC − 14）。" /></span><input v-model.number="draft.dungeon.dc![i]" type="number" min="5" max="30" class="num" /></label>
      </div>
    </FoldSet>
    <FoldSet>
      <template #legend>家裡的事 <Hint text="有家僕（或做家務的奴隸）時，在自己的房子裡走動（每一步）、在家長休醒來時的機率（docs/HOMES.md 第 8.1 節）。分類的權重和城鎮事件共用。" /></template>
      <div class="grid">
        <label>在家裡走動，每一步的機率（0～1）<input v-model.number="draft.home.chance.step" type="number" min="0" max="1" step="0.01" class="num" /></label>
        <label>在家長休醒來的機率（0～1）<input v-model.number="draft.home.chance.rest" type="number" min="0" max="1" step="0.01" class="num" /></label>
        <label>兩次事件至少隔幾小時 <input v-model.number="draft.home.cooldown_hours" type="number" min="0" max="168" class="num" /></label>
        <label>同一事件預設幾天後才會再出現 <input v-model.number="draft.home.repeat_days" type="number" min="0" max="60" class="num" /></label>
      </div>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
