<script setup lang="ts">
import { computed, ref } from 'vue'
import { currentHomeRules, HOME_GROUPS, HOME_TEXT_FIELDS, isCustomSetId, SET_LIMITS, setEffectText, type CustomSetDef, type HomeRulesMod, type SetEffect } from '@/engine/homeMods'
import { ATTR_IDS, attrName, itemRules, type AttrId } from '@/engine/data'
import { buildSetEffectPrompt, parseSetEffect } from '@/narrator/setEffect'
import { useContent } from '@/stores/content'
import { OTHER_USAGE, useGame } from '@/stores/game'
import { useSettings } from '@/stores/settings'
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

// ---- 自建的成套家具：名稱、件數、舒適度、主題，效果可以請 AI 決定（narrator/setEffect.ts） ----
const sets = computed(() => (draft.value.furniture_sets ??= {}) as Record<string, CustomSetDef>)
const customSets = computed(() => Object.entries(sets.value).filter(([id]) => isCustomSetId(id)))
function addSet() {
  if (customSets.value.length >= SET_LIMITS.sets) return
  sets.value[`mod_set_${Date.now().toString(36)}`] = { name: '新的套組', need: 3, comfort: 2, custom: true }
}
function removeSet(id: string) {
  if (confirm(`刪掉「${sets.value[id]?.name}」？擺在家裡的家具照樣在，只是不再算成套。`)) delete sets.value[id]
}
const piecesOf = (id: string) => {
  void content.version
  return itemRules.items.filter((i) => i.furniture?.set === id).map((i) => i.name)
}
function manualEffect(def: CustomSetDef) {
  def.effect = { name: def.name, desc: '', check_attrs: ['cha'] }
}
function toggleAttr(e: SetEffect, a: AttrId, on: boolean) {
  const list = new Set(e.check_attrs ?? [])
  if (on) list.add(a)
  else list.delete(a)
  if (list.size) e.check_attrs = ATTR_IDS.filter((x) => list.has(x)).slice(0, 2)
  else delete e.check_attrs
}
function setFlag(e: SetEffect, k: 'save' | 'evade', on: boolean) {
  if (on) e[k] = 1
  else delete e[k]
}
const aiBusy = ref('')
const aiError = ref('')
async function askAi(id: string) {
  const def = sets.value[id]
  if (!def || aiBusy.value) return
  aiError.value = ''
  const settings = useSettings()
  if (!settings.ready('designer')) {
    aiError.value = '還沒有設定「世界設計」的模型來源（設定 → AI）；也可以手動設定效果。'
    return
  }
  aiBusy.value = id
  const src = settings.sourceFor('designer')
  const collector = game.usageCollector(game.originOf('designer', src))
  try {
    const { completeText } = await import('@/narrator/providers')
    const text = await completeText(src.provider, src.config, buildSetEffectPrompt({ name: def.name, theme: def.theme, pieces: piecesOf(id), need: def.need }), undefined, collector.onUsage)
    def.effect = parseSetEffect(text)
  } catch (e) {
    aiError.value = e instanceof Error ? e.message : String(e)
  } finally {
    collector.flush(OTHER_USAGE)
    aiBusy.value = ''
  }
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
    <FoldSet>
      <template #legend>自建的成套家具（{{ customSets.length }}／{{ SET_LIMITS.sets }}） <Hint text="自己新增的套組：寫好名稱與主題，按「讓 AI 決定效果」，AI 會依主題和這一套的家具，在上限內（最多兩項：某些屬性的檢定 +1、豁免 +1、迴避 +1、暫時生命）決定在家長休後的狀態；也可以手動設定、之後微調。家具在物品編輯器的「家具」欄位選這一套。" /></template>
      <div v-for="[id, def] in customSets" :key="id" class="custom-set">
        <div class="grid">
          <label>名稱 <input v-model="def.name" :maxlength="SET_LIMITS.name_chars" /></label>
          <label>湊齊幾件 <input v-model.number="def.need" type="number" min="1" max="20" class="num" /></label>
          <label>舒適度 + <input v-model.number="def.comfort" type="number" min="0" max="10" class="num" /></label>
        </div>
        <label class="block">主題（交給 AI 的說明） <textarea v-model="def.theme" rows="2" :maxlength="SET_LIMITS.theme_chars" placeholder="例如：海邊漁村的小屋，掛著漁網和貝殼" /></label>
        <p class="small">家具：{{ piecesOf(id).join('、') || '還沒有家具指定到這一套（在物品編輯器的家具欄位選）' }}</p>
        <p class="small"><b>在家長休後</b>：{{ setEffectText(def.effect) }}</p>
        <template v-if="def.effect">
          <div class="grid">
            <label>狀態名稱 <input v-model="def.effect.name" :maxlength="SET_LIMITS.effect_name_chars" /></label>
            <label>描寫 <input v-model="def.effect.desc" :maxlength="SET_LIMITS.desc_chars" /></label>
            <label>暫時生命 <input :value="def.effect.temp_hp ?? 0" type="number" min="0" :max="SET_LIMITS.temp_hp" class="num" @change="(($event.target as HTMLInputElement).valueAsNumber > 0 ? (def.effect!.temp_hp = ($event.target as HTMLInputElement).valueAsNumber) : delete def.effect!.temp_hp)" /></label>
          </div>
          <div class="row small"><b>檢定 +1</b>
            <label v-for="a in ATTR_IDS" :key="a" class="check"><input type="checkbox" :checked="def.effect.check_attrs?.includes(a)" @change="toggleAttr(def.effect!, a, ($event.target as HTMLInputElement).checked)" /> {{ attrName(a) }}</label>
            <label class="check"><input type="checkbox" :checked="!!def.effect.save" @change="setFlag(def.effect!, 'save', ($event.target as HTMLInputElement).checked)" /> 豁免 +1</label>
            <label class="check"><input type="checkbox" :checked="!!def.effect.evade" @change="setFlag(def.effect!, 'evade', ($event.target as HTMLInputElement).checked)" /> 迴避 +1</label>
          </div>
          <p class="small muted">最多兩項好處（檢定算一項、最多兩個屬性）；存的時候超過的照檢定、豁免、迴避、暫時生命的順序拿掉。</p>
        </template>
        <div class="row">
          <button class="small" :disabled="!!aiBusy" @click="askAi(id)">{{ aiBusy === id ? 'AI 想效果中…' : def.effect ? '請 AI 重新決定效果' : '讓 AI 決定效果' }}</button>
          <button v-if="!def.effect" class="small" @click="manualEffect(def)">手動設定</button>
          <button class="small danger" @click="removeSet(id)">刪掉這一套</button>
        </div>
      </div>
      <p v-if="aiError" class="small error">{{ aiError }}</p>
      <button class="small" :disabled="customSets.length >= SET_LIMITS.sets" @click="addSet">＋ 新增套組</button>
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
<style scoped>
.custom-set { border: 1px dashed var(--border); border-radius: 6px; padding: 6px; margin-bottom: 6px; display: grid; gap: 4px; }
.custom-set p { margin: 0; }
</style>
