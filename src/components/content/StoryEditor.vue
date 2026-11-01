<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { affinityStage } from '@/engine/character'
import { geography, itemRules, npcs as namedNpcs, stories, type StoryNode } from '@/engine/data'
import { storyMerit } from '@/engine/guild'
import { RANK_ORDER } from '@/engine/materialQuests'
import { placeText, storyDef } from '@/engine/story'
import { newModId } from '@/engine/mods'
import { builtinStory, copyStory, flagUsage, NODE_KINDS, newNode, progressBreaks, START_KINDS, storyCheck, type StoryMod } from '@/engine/storyMods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import EffectsEditor from './EffectsEditor.vue'
import FlagInput from './FlagInput.vue'
import NameListInput from './NameListInput.vue'
import StoryNodeEditor from './StoryNodeEditor.vue'
import UsageNote from './UsageNote.vue'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import RequiresEditor from './RequiresEditor.vue'
import CheckList from './CheckList.vue'
import { BODY_OPTIONS, CONTENT_TAG_OPTIONS } from './checks'
import FoldSet from './FoldSet.vue'
import HelpText from './HelpText.vue'
import StoryGraph from './StoryGraph.vue'
import { condMet } from '@/engine/storyFlags'

// 特殊任務的編輯表單：開頭、任務點（依劇情旗標解鎖）、完成報酬；下方檢查任務鏈與旗標的流向
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ deleted: []; open: [id: string] }>()
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
function current(): StoryMod {
  return clone(content.mods.stories[props.id] ?? (stories.find((s) => s.id === props.id) as StoryMod))
}
const draft = ref<StoryMod>(current())
// 比較時略過空的條件（表單會先建立空的 requires 物件）
const snap = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'requires' && x && !x.flags?.length && !x.flags_none?.length && !x.flags_any?.length && !Object.keys(x.counters ?? {}).length && !Object.keys(x.affinity ?? {}).length ? undefined : x))
const saved = ref(snap(draft.value))
watch(() => props.id, () => {
  draft.value = current()
  saved.value = snap(draft.value)
  open.value = 0
})
const dirty = computed(() => snap(draft.value) !== saved.value)
const builtin = computed(() => !!builtinStory(props.id))
const edited = computed(() => builtin.value && !!content.mods.stories[props.id])

const settlements = geography.locations.filter((l) => l.type !== 'dungeon')
const startReq = computed(() => (draft.value.start.requires ??= {}))
const itemOptions = computed((): [string, string][] => itemRules.items.map((i) => [i.name, i.name]))
const open = ref<number | null>(0)
// 錯誤擋儲存，警告只提醒（storyCheck）
const check = computed(() => {
  void content.version
  return storyCheck(draft.value)
})
// 目前的存檔正在進行這個任務、這次修改會弄壞它的進度：擋儲存，改成複製或放棄進度
const breaks = computed(() => {
  void content.version
  void game.state?.time.minute
  return dirty.value && game.state ? progressBreaks(game.state, storyDef(props.id), draft.value) : []
})
const flags = computed(() => flagUsage(draft.value))
// 任務點的兩種看法：清單（每個任務點一列，點開編輯），或流程圖（點任務點在下面編輯）；記在這個瀏覽器
const VIEW_KEY = 'elondia.ui.storyView'
const nodeView = ref<'list' | 'graph'>('list')
try {
  if (localStorage.getItem(VIEW_KEY) === 'graph') nodeView.value = 'graph'
} catch {
  // 讀不到就用清單
}
watch(nodeView, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // 存不進去：只在這次有效
  }
})
/** 目前的存檔進行這個任務時，現在解鎖、還沒完成的任務點（流程圖上發亮） */
const unlockedNow = computed(() => {
  const st = game.state
  if (!st || progress.value?.status !== 'active') return []
  return draft.value.nodes.filter((n) => !progress.value!.done.includes(n.id) && condMet(st, n.requires)).map((n) => n.id)
})
const ICON: Record<StoryNode['kind'], string> = { story: '📜', check: '🎲', combat: '⚔️', choice: '🔀' }

function setsOf(n: StoryNode): string[] {
  const outs = [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])]
  return [...new Set(outs.flatMap((o) => o?.set_flags ?? []))]
}
function ends(n: StoryNode): string {
  const outs = [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])]
  return [outs.some((o) => o?.complete) ? '✅' : '', outs.some((o) => o?.fail_quest) ? '❌' : ''].join('')
}
function addNode() {
  draft.value.nodes.push(newNode(draft.value))
  open.value = draft.value.nodes.length - 1
}
function move(i: number, d: number) {
  const list = draft.value.nodes
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  open.value = j
}
function duplicate(i: number) {
  const n = clone(draft.value.nodes[i]!)
  n.id = `${n.id}_copy`
  n.title = `${n.title}（複製）`.slice(0, 40)
  draft.value.nodes.splice(i + 1, 0, n)
  open.value = i + 1
}
function removeNode(i: number) {
  if (!confirm(`刪除任務點「${draft.value.nodes[i]!.title}」？`)) return
  draft.value.nodes.splice(i, 1)
  open.value = null
}
function setStartKind(kind: StoryMod['start']['kind']) {
  draft.value.start = { ...draft.value.start, kind }
  if (kind !== 'npc') delete draft.value.start.min_affinity
  if (kind === 'npc') draft.value.start.npc ??= namedNpcs[0]?.id
  if (kind === 'guild') draft.value.start.location ??= 'soriel'
  if (kind === 'travel') draft.value.start.chance ??= 0.2
  if (kind === 'informant') draft.value.start.price ??= 100
}

function setMinAffinity(v: string) {
  if (v.trim() === '' || !Number.isFinite(Number(v))) delete draft.value.start.min_affinity
  else draft.value.start.min_affinity = Math.max(-100, Math.min(100, Math.round(Number(v))))
}

// ---- 動作 ----
function save() {
  try {
    content.saveStory(props.id, draft.value)
    draft.value = current()
    saved.value = snap(draft.value)
    game.flash(`已儲存「${draft.value.title}」`)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function discard() {
  draft.value = current()
}
/** 進度會壞掉時：把修改後的內容存成新的任務，原本的任務不動 */
function saveAsCopy() {
  const id = newModId('story')
  try {
    content.saveStory(id, copyStory(draft.value, id))
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
    return
  }
  draft.value = current()
  saved.value = snap(draft.value)
  game.flash('已複製成新的任務，原本的任務沒有改')
  emit('open', id)
}
/** 進度會壞掉時：放棄這個存檔裡的任務進度（同冒險筆記的放棄），再儲存 */
function abandonAndSave() {
  if (!confirm(`放棄目前存檔裡「${draft.value.title}」的進度後儲存？放棄後這個存檔不能再接這個任務。`)) return
  game.abandonStory(props.id)
  if (game.state?.stories?.[props.id]?.status === 'active') return
  save()
}
function restore() {
  if (!confirm(`把「${draft.value.title}」恢復成內建的樣子？`)) return
  content.restoreStory(props.id)
  draft.value = current()
  saved.value = snap(draft.value)
}
// 目前存檔裡這個任務的進度：完成過的任務點 id 不能改
const progress = computed(() => game.state?.stories?.[props.id])
const doneInSave = computed(() => new Set(progress.value?.done ?? []))

// 還有地方用到時不能刪（見 docs/CONTENT_DEPENDENCIES.md）
const usage = computed(() => {
  void content.version
  void game.state?.time.minute
  return content.usageOf('story', props.id)
})
function remove() {
  if (!confirm(`刪除「${draft.value.title}」？其他存檔裡進行中的這個任務會中斷（任務同行的夥伴在讀檔時離隊）。`)) return
  try {
    content.deleteStory(props.id)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
    return
  }
  emit('deleted')
}
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="draft.title || '（未命名）'" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty" :blocked="check.errors.length ? '任務鏈有錯誤，修正後才能儲存' : breaks.length ? '這次修改會弄壞目前存檔的任務進度' : ''" :usage="usage"
      @save="save" @discard="discard" @restore="restore" @remove="remove"
    />
    <UsageNote :usage="usage" :deletable="!builtin" />
    <p v-if="progress?.status === 'active'" class="small warn-text">
      目前的存檔正在進行這個任務（完成了 {{ progress.done.length }} 個任務點）：完成過的任務點 id 不能改；改旗標名稱或解鎖條件可能讓這個存檔的任務卡住。
    </p>
    <div v-if="breaks.length" class="block-note">
      <p class="small warn-text">⛔ 目前的存檔正在進行這個任務，這次修改會弄壞它的進度，不能直接儲存：</p>
      <ul class="small warn-text">
        <li v-for="(x, i) in breaks" :key="i">{{ x }}</li>
      </ul>
      <div class="row">
        <button class="small" :disabled="check.errors.length > 0" @click="saveAsCopy">📄 複製成新任務再改</button>
        <button class="small danger" :disabled="check.errors.length > 0" @click="abandonAndSave">放棄這個存檔的任務進度後儲存</button>
      </div>
    </div>
    <p class="small muted">id：{{ id }}・旗標名稱只用在劇情（存成 story:名稱）；以 ai: 開頭的名稱讀 AI 判定寫下的旗標。</p>

    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>任務名稱 <input v-model="draft.title" maxlength="30" /></label>
        <label>建議的公會階級
          <select v-model="draft.rank">
            <option :value="undefined">（不限）</option>
            <option v-for="r in RANK_ORDER" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>完成時的公會功績 <input v-model.number="draft.merit" type="number" min="0" max="100" :placeholder="`預設 ${storyMerit()}`" /></label>
        <label><span>期限 <Hint text="開始後幾天內要完成，空白不限。" /></span><input v-model.number="draft.time_limit" type="number" min="0" max="365" placeholder="不限" /></label>
      </div>
      <label class="block"><span>簡介 <Hint text="冒險筆記與接任務時看到。" /></span><textarea v-model="draft.summary" rows="2" maxlength="300" /></label>
      <CheckList v-model="draft.tags" label="內容標籤" hint="接任務時與冒險筆記顯示成警示；成人向以外的標籤玩家可以在設定裡關閉（關閉的任務不開放）。分支才有的內容（例如 NTR 分支）標在那個選項上。" :options="CONTENT_TAG_OPTIONS" />
    </FoldSet>

    <FoldSet>
      <template #legend>開頭</template>
      <div class="grid">
        <label>從哪裡開始
          <select :value="draft.start.kind" @change="setStartKind(($event.target as HTMLSelectElement).value as StoryMod['start']['kind'])">
            <option v-for="(n, k) in START_KINDS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label v-if="draft.start.kind === 'guild' || draft.start.kind === 'informant'">{{ draft.start.kind === 'guild' ? '哪座城鎮的公會' : '哪座城鎮的情報商' }}
          <select v-model="draft.start.location">
            <option v-if="draft.start.kind === 'informant'" :value="undefined">（任何情報商）</option>
            <option v-for="l in settlements" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </label>
        <label v-if="draft.start.kind === 'npc'"><span>固定 NPC <Hint text="在身邊時可以接。" /></span>
          <select v-model="draft.start.npc">
            <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
        </label>
        <label v-if="draft.start.kind === 'npc'">親密度至少
          <input
            type="number" min="-100" max="100" placeholder="不限" :value="draft.start.min_affinity ?? ''"
            @input="setMinAffinity(($event.target as HTMLInputElement).value)"
          />
          <span v-if="draft.start.min_affinity !== undefined" class="small muted">（{{ affinityStage(draft.start.min_affinity) }}以上；沒見過面算 0）</span>
        </label>
        <label v-if="draft.start.kind === 'travel'">每段旅程遇到的機率（%）
          <input type="number" min="1" max="100" :value="Math.round((draft.start.chance ?? 0.2) * 100)" @input="draft.start.chance = Number(($event.target as HTMLInputElement).value) / 100" />
        </label>
        <label v-if="draft.start.kind === 'informant'">情報的價格（白鸛幣） <input v-model.number="draft.start.price" type="number" min="0" /></label>
        <label>主角至少幾級 <input v-model.number="draft.start.min_level" type="number" min="1" max="20" placeholder="不限" /></label>
      </div>
      <CheckList v-model="draft.start.pc_body" label="只給這些主角" hint="依主角的體型（建角時選的體態；沒選時依種族與性別）。都不勾＝都可以，例如做給女性主角的任務只勾女性形象。勾了女性形象、中性而沒勾男性形象時，設定打開「陽剛體型也能遇到『只給陰柔、中性』的成人內容」的玩家一樣會遇到。" :options="BODY_OPTIONS" />
      <div v-if="draft.start.kind === 'travel'" class="row checks small">
        <span>只在前往這些地區時（不勾＝任何地區）：</span>
        <label v-for="r in geography.regions" :key="r.id" class="check">
          <input type="checkbox" :checked="draft.start.regions?.includes(r.id)" @change="draft.start.regions = ($event.target as HTMLInputElement).checked ? [...(draft.start.regions ?? []), r.id] : (draft.start.regions ?? []).filter((x) => x !== r.id)" /> {{ r.name }}
        </label>
      </div>
      <label class="block"><span>開頭的事件描述 <Hint text="旅途、情報商、NPC 拜託時看到；沒有時用簡介。" /></span><textarea v-model="draft.start.text" rows="2" maxlength="400" /></label>
      <RequiresEditor :model-value="startReq" label="接取條件" @update:model-value="(v) => (draft.start.requires = v)" />
      <div class="row small">開始時設定的旗標 <Hint text="任務鏈的第一個旗標。" /> <FlagInput v-model="draft.start_flags" /></div>
      <div class="row small">接下任務時拿到的物品 <Hint text="各一件，例如打工的制服；搭配任務點的「限定穿著」。" /> <NameListInput v-model="draft.start.items" :options="itemOptions" placeholder="物品名稱" /></div>
    </FoldSet>

    <FoldSet>
      <template #legend>任務點（{{ draft.nodes.length }}）</template>
      <HelpText text="任務點在解鎖條件（劇情旗標）成立時出現；用結果設定的旗標串起順序與分支。同時解鎖多個任務點時，玩家可以自己選順序。" />
      <div class="row small view-switch">
        <button class="small" :class="{ active: nodeView === 'list' }" @click="nodeView = 'list'">📋 清單</button>
        <button class="small" :class="{ active: nodeView === 'graph' }" @click="nodeView = 'graph'">🕸️ 流程圖</button>
        <span v-if="nodeView === 'graph'" class="muted">點任務點在下面編輯；滑過卡片或結果，連到它的線會變粗。</span>
      </div>
      <StoryGraph
        v-if="nodeView === 'graph'" :def="draft" :selected="open" :done="progress?.status === 'active' ? progress.done : undefined" :unlocked="unlockedNow"
        @open="(i) => (open = i)"
      />
      <div v-for="(n, i) in draft.nodes" v-show="nodeView === 'list' || open === i" :key="i" class="node-card" :class="{ open: open === i }">
        <div class="row node-head" @click="open = open === i ? null : i">
          <span>{{ ICON[n.kind] }}</span>
          <b class="grow">{{ n.title }}</b>
          <span class="small muted">{{ NODE_KINDS[n.kind] }}・{{ placeText(n) }}</span>
          <span v-for="f in n.requires?.flags ?? []" :key="`r-${f}`" class="tag small">需要 🚩{{ f }}</span>
          <span v-for="f in setsOf(n)" :key="`s-${f}`" class="tag small set">→ 🚩{{ f }}</span>
          <span>{{ ends(n) }}</span>
          <button class="small" title="往上" @click.stop="move(i, -1)">▲</button>
          <button class="small" title="往下" @click.stop="move(i, 1)">▼</button>
          <button class="small" title="複製" @click.stop="duplicate(i)">📄</button>
          <button class="small" title="刪除" @click.stop="removeNode(i)">✕</button>
        </div>
        <StoryNodeEditor v-if="open === i" v-model="draft.nodes[i]!" :locked-id="doneInSave.has(draft.nodes[i]!.id)" />
      </div>
      <button class="small" @click="addNode">＋ 任務點</button>
    </FoldSet>

    <FoldSet>
      <template #legend>完成報酬（獨特報酬）</template>
      <EffectsEditor v-model="draft.rewards" />
    </FoldSet>

    <FoldSet filled>
      <template #legend>檢查任務鏈</template>
      <p v-if="!check.errors.length && !check.warnings.length" class="small">✅ 沒有發現問題。</p>
      <template v-if="check.errors.length">
        <p class="small warn-text">⛔ 錯誤（修正後才能儲存）：</p>
        <ul class="small warn-text">
          <li v-for="(x, i) in check.errors" :key="i">{{ x }}</li>
        </ul>
      </template>
      <template v-if="check.warnings.length">
        <p class="small muted">⚠️ 提醒（可以儲存）：</p>
        <ul class="small muted">
          <li v-for="(x, i) in check.warnings" :key="i">{{ x }}</li>
        </ul>
      </template>
      <table v-if="flags.length" class="flags small">
        <thead><tr><th>旗標</th><th>設定</th><th>清除</th><th>需要它</th><th>需要它不成立</th></tr></thead>
        <tbody>
          <tr v-for="u in flags" :key="u.flag">
            <td>🚩{{ u.flag }}</td>
            <td>{{ u.setBy.join('、') || '—' }}</td>
            <td>{{ u.clearedBy.join('、') || '—' }}</td>
            <td>{{ u.requiredBy.join('、') || '—' }}</td>
            <td>{{ u.blockedBy.join('、') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
<style scoped>
.block-note { border: 1px solid var(--danger); border-radius: var(--radius); padding: 6px 8px; }
.node-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 6px; display: grid; gap: 6px; }
.node-card.open { border-color: var(--accent); }
.view-switch button.active { border-color: var(--accent); color: var(--accent); }
.node-head { cursor: pointer; gap: 6px; }
.tag.set { border-color: var(--accent); }
.flags { border-collapse: collapse; width: 100%; }
.flags th, .flags td { border-bottom: 1px solid var(--border); padding: 3px 6px; text-align: left; vertical-align: top; }
</style>
