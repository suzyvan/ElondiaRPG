<script setup lang="ts">
import { computed } from 'vue'
import { geography, landmarksIn, npcs as namedNpcs, shopRules, specialMaps, type StoryNode, type StoryOption } from '@/engine/data'
import { wearChoices } from '@/engine/gear'
import { cellName, type CellKind } from '@/engine/grid'
import { specialPreview, storySpotProblem } from '@/engine/specialMapMods'
import { LAYER_NAME, NODE_KINDS, SIDE_MAPS, STORY_CELLS, STORY_LAYERS, WHERE_NAME } from '@/engine/storyMods'
import { travelEvents } from '@/engine/road'
import NameListInput from './NameListInput.vue'
import NpcPicker from './NpcPicker.vue'
import OutcomeEditor from './OutcomeEditor.vue'
import StoryAffinityEditor from './StoryAffinityEditor.vue'
import Hint from '../ui/Hint.vue'
import RequiresEditor from './RequiresEditor.vue'
import CheckList from './CheckList.vue'
import { CONTENT_TAG_OPTIONS } from './checks'
import CellGrid from './CellGrid.vue'
import MonsterPick from './MonsterPick.vue'
import CheckRow from './CheckRow.vue'

// 一個任務點：在哪裡、解鎖的條件、種類（劇情、判定、戰鬥、選擇）、結果
const node = defineModel<StoryNode>({ required: true })
/** 目前存檔已經完成這個任務點：id 不能改（改了會被當成新的任務點，再觸發一次） */
const props = defineProps<{ lockedId?: boolean }>()
const where = computed(() => node.value.at.where)
const locations = computed(() => geography.locations.filter((l) =>
  where.value === 'dungeon' ? l.type === 'dungeon' : where.value === 'npc' ? true : l.type !== 'dungeon'))
const requires = computed(() => (node.value.requires ??= {}))
// 設施、自建的商店，加上這個地點的特色地標
const cellOptions = computed(() => [
  ...STORY_CELLS,
  ...Object.values(shopRules.types).filter((d) => d.custom).map((d) => d.cell as CellKind),
  ...landmarksIn(node.value.at.location ?? '').map((l) => l.id as CellKind),
])
const wearOptions = computed(() => wearChoices())

function setKind(kind: StoryNode['kind']) {
  node.value.kind = kind
  if (kind === 'check') node.value.check ??= { attr: 'int', dc: 12 }
  if (kind === 'choice') node.value.options ??= [{ label: '選項一', success: {} }, { label: '選項二', success: {} }]
  if (kind === 'combat') node.value.enemies ??= [['bandit', 1]]
}
function setHours(v: string) {
  if (v === 'day' || v === 'night') node.value.hours = v
  else delete node.value.hours
}
function setWhere(w: StoryNode['at']['where']) {
  node.value.at = { ...node.value.at, where: w }
  if (w === 'cell') node.value.at.cell ??= 'tavern'
  if (w === 'dungeon') {
    node.value.at.layer ??= 'outskirts'
    if (!geography.locations.find((l) => l.id === node.value.at.location && l.type === 'dungeon')) node.value.at.location = locations.value.find((l) => l.type === 'dungeon')?.id
  } else if (w !== 'npc' && geography.locations.find((l) => l.id === node.value.at.location)?.type === 'dungeon') {
    node.value.at.location = 'soriel'
  }
  if (w === 'npc') node.value.at.npc ??= namedNpcs[0]?.id
  if (w === 'special') node.value.at.special_map ??= Object.keys(specialMaps)[0]
}
// 特殊地圖：固定地圖可以指定 ⭐ 的確切格子（沒指定時隨機放在一格空地）
const spotMap = computed(() => (where.value === 'special' && node.value.at.special_map ? specialPreview(node.value.at.special_map) : undefined))
const spotPicked = computed(() => (spotMap.value && node.value.at.x !== undefined && node.value.at.y !== undefined ? node.value.at.y * spotMap.value.width + node.value.at.x : -1))
const spotProblem = computed(() => (spotPicked.value >= 0 ? storySpotProblem(node.value.at.special_map!, node.value.at.x!, node.value.at.y!) : undefined))
const spotOk = (i: number) => !!spotMap.value && !storySpotProblem(node.value.at.special_map!, i % spotMap.value.width, Math.floor(i / spotMap.value.width))
function pickSpot(i: number) {
  const m = spotMap.value
  if (!m || !spotOk(i)) return
  node.value.at.x = i % m.width
  node.value.at.y = Math.floor(i / m.width)
}
function clearSpot() {
  delete node.value.at.x
  delete node.value.at.y
}
function setSpecialMap(id: string) {
  node.value.at.special_map = id
  clearSpot()
}
function addOption() {
  ;(node.value.options ??= []).push({ label: '新的選項', success: {} })
}
function toggleCheck(o: StoryOption, on: boolean) {
  if (on) o.check = { attr: 'cha', dc: 12 }
  else {
    delete o.check
    delete o.fail
  }
}
</script>

<template>
  <div class="node">
    <div class="grid">
      <label>id <input v-model="node.id" maxlength="40" :disabled="props.lockedId" :title="props.lockedId ? '目前的存檔已經完成這個任務點，id 不能改（改了會再觸發一次）' : ''" /></label>
      <label><span>目標 <Hint text="冒險筆記上看到的。" /></span><input v-model="node.title" maxlength="40" /></label>
      <label>種類
        <select :value="node.kind" @change="setKind(($event.target as HTMLSelectElement).value as StoryNode['kind'])">
          <option v-for="(n, k) in NODE_KINDS" :key="k" :value="k">{{ n }}</option>
        </select>
      </label>
    </div>
    <label class="block"><span>事件描述 <Hint text="觸發時看到的，也會交給 AI。" /></span><textarea v-model="node.text" rows="3" maxlength="600" /></label>
    <label class="check"><input type="checkbox" :checked="!!node.urgent" @change="($event.target as HTMLInputElement).checked ? (node.urgent = true) : delete node.urgent" /> 緊急
      <Hint text="走到任務點時要先處理，不能移動或休息。不緊急（預設）：多一個「稍候」，這次先略過、不記日誌，離開這裡之後再來還會遇到。緊急：只能處理或「放棄」，選了任務線就中斷（適合旅途上、臨時地圖裡這種過了就沒有的場面）。" /></label>
    <label v-if="where !== 'road' && where !== 'side'" class="check">時段
      <select :value="node.hours ?? ''" @change="setHours(($event.target as HTMLSelectElement).value)">
        <option value="">不限</option>
        <option value="day">只在白天（6～18 點）</option>
        <option value="night">只在夜裡（18～6 點）</option>
      </select>
      <Hint text="時段不對時不算在任務點上：不會跳出來、不擋路，⭐ 照樣在地圖上。站在任務點上時，地點面板會提醒要等，也可以在原地等到那個時段。適合月下、深夜、清晨這類場景。" /></label>

    <div class="grid">
      <label>在哪裡
        <select :value="where" @change="setWhere(($event.target as HTMLSelectElement).value as StoryNode['at']['where'])">
          <option v-for="(n, k) in WHERE_NAME" :key="k" :value="k">{{ n }}</option>
        </select>
      </label>
      <label v-if="where !== 'road' && where !== 'side' && where !== 'special'">{{ where === 'npc' ? '地點（選填：只在這裡）' : '地點' }}
        <select v-model="node.at.location">
          <option v-if="where === 'npc'" :value="undefined">（跟著角色走）</option>
          <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </label>
      <label v-if="where === 'cell'">設施
        <select v-model="node.at.cell">
          <option v-for="c in cellOptions" :key="c" :value="c">{{ cellName(c) }}</option>
        </select>
      </label>
      <label v-if="where === 'dungeon'">哪一層
        <select v-model="node.at.layer">
          <option v-for="l in STORY_LAYERS" :key="l" :value="l">{{ LAYER_NAME[l] }}</option>
        </select>
      </label>
      <label v-if="where === 'side'">哪一種臨時地圖
        <select v-model="node.at.side_map">
          <option :value="undefined">（任何一種）</option>
          <option v-for="k in SIDE_MAPS()" :key="k" :value="k">{{ travelEvents.side_maps[k]!.name }}</option>
        </select>
      </label>
      <label v-if="where === 'special'">哪一張特殊地圖
        <select :value="node.at.special_map" @change="setSpecialMap(($event.target as HTMLSelectElement).value)">
          <option v-for="m in Object.values(specialMaps)" :key="m.id" :value="m.id">{{ m.name }}{{ m.grid?.length ? '' : '（隨機地圖）' }}</option>
        </select>
      </label>
      <label v-if="where === 'npc'">固定 NPC
        <select v-model="node.at.npc">
          <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
      </label>
    </div>
    <template v-if="where === 'special'">
      <template v-if="spotMap">
        <p class="small muted">
          ⭐ 的位置：{{ spotPicked >= 0 ? `（${node.at.x}, ${node.at.y}）${cellName(spotMap.cells[spotPicked]!.kind)}` : '隨機一格空地' }}。點一格指定（空地、遭遇、資源、寶箱、陷阱；入口與通道端點不行）。
          <button v-if="spotPicked >= 0" class="small" @click="clearSpot">改回隨機</button>
        </p>
        <p v-if="spotProblem" class="small warn-text">那一格：{{ spotProblem }}，遊戲裡會隨機放在一格空地。</p>
        <CellGrid :kinds="spotMap.cells.map((c) => c.kind)" :width="spotMap.width" :picked="spotPicked" :is-off="(i) => !spotOk(i)" @pick="pickSpot" />
      </template>
      <p v-else class="small muted">隨機地圖：⭐ 隨機放在一格空地（不能指定格子）。</p>
    </template>
    <RequiresEditor :model-value="requires" label="解鎖條件" placeholder="全部成立才解鎖" affinity @update:model-value="(v) => (node.requires = v)" />
    <div class="row small">限定穿著 <Hint text="主角要穿著這些才能進行（任務點照樣出現，按鈕停用並說明）。寫底材（例如 bunny_suit）時任何一件兔女郎裝都算，寫物品名稱時要那一件。" /> <NameListInput v-model="node.wear" :options="wearOptions" placeholder="底材或物品名稱" /></div>
    <NpcPicker v-model="node.allies" label="在場的友方固定 NPC：" :exclude="node.foes" />
    <p v-if="node.allies?.length" class="small muted">
      解鎖時，勾選的角色會站在{{ ['outskirts', 'dungeon', 'side', 'special'].includes(where) ? ' ⭐ 旁邊' : where === 'npc' || where === 'road' ? '這裡' : '設施上' }}（不管平常的出沒與出現條件）；戰鬥時站在你這邊（由你操作），AI 判定與寫經過時也知道他們在場。要在成功後一起走，結果裡用「任務同行」。
    </p>

    <template v-if="node.kind === 'check' && node.check">
      <div class="row small">
        檢定
        <CheckRow :check="node.check" />
        <Hint text="可以描述做法交給 AI 判定；大成功、成功、部分成功都算成功。" />
      </div>
      <StoryAffinityEditor v-model="node.check" />
      <OutcomeEditor v-model="node.success" label="成功" />
      <OutcomeEditor v-model="node.fail" label="失敗" optional />
    </template>

    <template v-else-if="node.kind === 'combat'">
      <div v-for="(g, i) in node.enemies ?? []" :key="i" class="row small">
        <MonsterPick :entry="g" @remove="node.enemies!.splice(i, 1)" />
      </div>
      <button class="small" @click="(node.enemies ??= []).push(['bandit', 1])">＋ 怪物</button>
      <NpcPicker v-model="node.foes" label="敵對的固定 NPC：" :exclude="node.allies" />
      <OutcomeEditor v-model="node.success" label="勝利" />
      <OutcomeEditor v-model="node.fail" label="落敗或撤退" optional />
    </template>

    <template v-else-if="node.kind === 'choice'">
      <div v-for="(o, i) in node.options ?? []" :key="i" class="option">
        <div class="row small">
          選項 <input v-model="o.label" maxlength="30" />
          <label class="check"><input type="checkbox" :checked="!!o.check" @change="toggleCheck(o, ($event.target as HTMLInputElement).checked)" /> 要檢定</label>
          <template v-if="o.check">
            <CheckRow :check="o.check" />
          </template>
          <button class="small" @click="node.options!.splice(i, 1)" title="移除這個選項">✕</button>
        </div>
        <CheckList v-model="o.tags" label="選項的內容標籤" hint="設定裡關掉的標籤，這個選項不會出現（例如 NTR 分支）。" :options="CONTENT_TAG_OPTIONS" />
        <StoryAffinityEditor v-if="o.check" v-model="o.check" />
        <RequiresEditor :model-value="o.requires ?? {}" label="這個選項出現的條件" placeholder="全部成立才出現" affinity @update:model-value="(v) => (o.requires = v)" />
        <OutcomeEditor v-model="o.success" :label="o.check ? '成功' : '結果'" />
        <OutcomeEditor v-if="o.check" v-model="o.fail" label="失敗" optional />
      </div>
      <button class="small" @click="addOption">＋ 選項</button>
    </template>

    <OutcomeEditor v-else v-model="node.success" label="結果" />
  </div>
</template>

<style scoped src="./editor.css"></style>
<style scoped>
.node { display: grid; gap: 6px; }
</style>
