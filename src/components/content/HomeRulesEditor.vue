<script setup lang="ts">
import { computed, ref } from 'vue'
import { currentHomeRules, HOME_GROUPS, HOME_TEXT_FIELDS, type HomeRulesMod } from '@/engine/homeMods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import FoldSet from './FoldSet.vue'

// 房屋設定（docs/HOMES.md 第 8 節）：家僕的職位名稱與日薪、上限、工錢與應徵，以及舒適度三段的門檻。家具本身在物品編輯器
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const draft = ref<HomeRulesMod>(clone(currentHomeRules()))
const saved = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const edited = computed(() => !!content.mods.homes?.rules)
function reset() {
  draft.value = clone(currentHomeRules())
  saved.value = JSON.stringify(draft.value)
}
function save() {
  try {
    content.saveHomeRules(draft.value)
    reset()
    game.flash('已儲存房屋設定')
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function restore() {
  if (!confirm('把房屋設定恢復成內建的樣子？')) return
  content.restoreHomeRules()
  reset()
}

function valueOf(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), draft.value)
}
function setValue(path: string, v: unknown) {
  const keys = path.split('.')
  let o = draft.value as Record<string, unknown>
  for (const k of keys.slice(0, -1)) o = ((o[k] ??= {}) as Record<string, unknown>)
  o[keys.at(-1)!] = v
}
</script>

<template>
  <div class="editor">
    <EditorHeader :title="'⚙️ 房屋設定'" :kind="'rules'" :edited="edited" :dirty="dirty" @save="save" @discard="reset" @restore="restore" />
    <p class="small muted">家僕的職位名稱、日薪與上限，欠薪辭職、應徵者、請認識的人與奴隸做家務的數值，以及舒適度三段的門檻（docs/HOMES.md 第 4、8 節）。職位的種類與效果是固定的；家具在物品編輯器的「家具」欄位。</p>
    <FoldSet>
      <template #legend>職位的名稱 <Hint text="名稱寫在房屋區塊與日誌；職業描述是家僕的職業，照性別換稱謂（例如女僕／男僕、廚娘／廚子）。" /></template>
      <div class="grid">
        <label v-for="fd in HOME_TEXT_FIELDS" :key="fd.path">
          <span>{{ fd.label }}</span>
          <input type="text" maxlength="8" :value="valueOf(fd.path)" @change="setValue(fd.path, ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </FoldSet>
    <FoldSet v-for="g in HOME_GROUPS" :key="g.name">
      <template #legend>{{ g.name }}</template>
      <div class="grid">
        <label v-for="fd in g.fields" :key="fd.path">
          <span>{{ fd.label }} <Hint v-if="fd.hint" :text="fd.hint" /></span>
          <input type="number" :min="fd.min" :max="fd.max" :step="fd.step" :value="Number(valueOf(fd.path) ?? 0)" class="num" @change="setValue(fd.path, Number(($event.target as HTMLInputElement).value))" />
        </label>
      </div>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
