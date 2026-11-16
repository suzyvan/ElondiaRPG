<script setup lang="ts">
import { stripItemKeys } from '@/engine/itemKey'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { flash, floatText, sparks } from '@/fx/fx'
import { isFreshReport } from '@/fx/seen'
import { itemRarity } from './items/itemInfo'
import { locationName } from '@/engine/data'
import { formatTime } from '@/engine/state'
import type { Report } from '@/engine/types'
import { actorNames, describeChanges, describeCheck, describeEntry, formatTokens, rollDetail } from '@/narrator/describe'
import { narrationParagraphs } from '@/narrator/paragraphs'
import { streamingView } from '@/narrator/regex'
import { usePrompts } from '@/stores/prompts'
import { usageFeatureName, usageSourceLabel, useGame } from '@/stores/game'
import { undoConfirmText } from '@/stores/undo'
import { inventedIn } from '@/engine/invention'
import { canRerecord, intimateReport, sexLogged } from '@/engine/sexRecord'
import { useSettings } from '@/stores/settings'
import { useImageSettings } from '@/stores/image'
import { sceneKey, useScenes } from '@/stores/scenes'
import { attrName, skillName } from '@/engine/data'
import SceneImage from './SceneImage.vue'
import SceneSplitDialog from './SceneSplitDialog.vue'
import SceneStatus from './SceneStatus.vue'
import GameIcon from './ui/GameIcon.vue'
import type { IconName } from './ui/iconPaths'

const props = defineProps<{ report: Report }>()
const game = useGame()
const settings = useSettings()
// 親密場景還沒記下性經歷（自動記關著、失敗時，可以手動記；docs/LEWD_STATS.md 第 29 節）
// 每則日誌都可以手動記（規則判定、休息、移動……寫出了性愛場景卻沒標到的時候）；親密場景以外的寫在說明裡
// 記過的日誌：有帳本的可以重新記錄（覆蓋這則之前記下的；續寫、改寫之後依新的正文重記）
const logged = computed(() => !!game.state && sexLogged(game.state, props.report.report_id))
const rerecordable = computed(() => !!game.state && canRerecord(game.state, props.report.report_id))
const canRecordSex = computed(() => !!game.state && settings.sexRecords && settings.ready('sexlog') && (!logged.value || rerecordable.value))
function onSexRecord() {
  if (recordingSex.value) return
  if (logged.value && !window.confirm('重新記錄這則日誌的性經歷？\n會依現在的正文重記一次，取代這則之前記下的次數、對象與經過（受孕不會重擲）。')) return
  void game.recordSex(props.report, undefined, { manual: true, ...(logged.value ? { rerecord: true } : {}) })
}
const intimate = computed(() => intimateReport(props.report))
const recordingSex = computed(() => game.recordingSex.has(props.report.report_id))
// 記錄中不設 disabled（有些瀏覽器停用的按鈕不顯示滑過的說明），改成閃動、按了不重送
const sexTitle = computed(() => recordingSex.value
  ? '正在記下性經歷…（等「性經歷記錄」的模型回應；太久沒回應會依「AI 判定逾時」放棄，之後可以再按）'
  : narration.value?.status === 'streaming'
    ? '經過寫完之後才能記下性經歷'
    : logged.value
      ? '重新記錄性經歷：依現在的正文（續寫、改寫之後）重記一次，取代這則之前記下的次數、對象與經過（受孕不會重擲）'
      : intimate.value
      ? '記下性經歷：請「性經歷記錄」的模型讀這段經過，記下誰和誰發生了關係、性侍奉、初體驗（每則日誌只記一次，之後可以重新記錄）'
      : '記下性經歷：這則日誌沒有標成親密場景；經過裡寫到了性愛場景卻沒自動記下時按這裡，請「性經歷記錄」的模型讀這段經過記下來（每則日誌只記一次）')

// 回退（stores/undo.ts）：最近幾輪的日誌可以撤銷，連同之後的日誌
const undoSteps = computed(() => {
  const i = game.undoReports.indexOf(props.report.report_id)
  return i < 0 ? 0 : game.undoReports.length - i
})
function undoHere() {
  if (confirm(undoConfirmText(undoSteps.value))) game.undo(props.report.report_id)
}

// 經過的每一行：有加值拆解的擲骰，滑鼠移上去看（title），點一下在下面展開（手機版沒有滑鼠提示）
const openRolls = ref<Set<number>>(new Set())
function toggleRoll(seq: number) {
  const next = new Set(openRolls.value)
  if (next.has(seq)) next.delete(seq)
  else next.add(seq)
  openRolls.value = next
}

const KIND: Record<Report['kind'], { name: string; icon: IconName }> = {
  travel: { name: '旅行', icon: 'road' }, combat: { name: '戰鬥', icon: 'sword' }, action: { name: '行動', icon: 'd20' },
  event: { name: '事件', icon: 'sparkles' }, quest: { name: '委託', icon: 'scroll' }, rest: { name: '休息', icon: 'bed' },
  trade: { name: '交易', icon: 'coins' }, social: { name: '交流', icon: 'message' },
}
const DEGREE: Record<NonNullable<Report['check']>['degree'], string> = { critical: '大成功', success: '成功', partial: '部分成功', fail: '失敗', fumble: '大失敗' }

const entry = computed(() => game.narrations[props.report.report_id])
// 只存了判定的思考過程的空項目不算敘事
const narration = computed(() => (entry.value?.placeholder ? undefined : entry.value))
const thinking = computed(() => [
  ...(entry.value?.judgeThinking ? [{ label: '判定', text: entry.value.judgeThinking }] : []),
  ...(entry.value?.thinking ? [{ label: '敘事', text: entry.value.thinking }] : []),
])
// 串流中的正文照正文正則處理過再顯示（還沒寫完的 <think…> 先藏起來）；最多每 300 毫秒處理一次。
// 收完整段時 game.ts 已經套用正則、存下處理過的文字，之後直接顯示
const prompts = usePrompts()
const streamShown = ref('')
let streamTimer: ReturnType<typeof setTimeout> | null = null
let streamLast = 0
function refreshStream() {
  streamTimer = null
  streamLast = Date.now()
  streamShown.value = streamingView(narration.value?.text ?? '', prompts.config.regex, 'narration')
}
watch(() => (narration.value?.status === 'streaming' ? narration.value.text : null), (t) => {
  if (t === null) {
    if (streamTimer) clearTimeout(streamTimer)
    streamTimer = null
    return
  }
  if (streamTimer) return
  const wait = 300 - (Date.now() - streamLast)
  if (wait <= 0) refreshStream()
  else streamTimer = setTimeout(refreshStream, wait)
}, { immediate: true })
onBeforeUnmount(() => { if (streamTimer) clearTimeout(streamTimer) })
const displayText = computed(() => (narration.value?.status === 'streaming' ? streamShown.value : narration.value?.text ?? ''))

// 關閉 AI 細節描述時不顯示敘事，改顯示戰報或事件簡述（已生成的敘事仍保留，重新開啟後會再出現）
// AI 判定的主動行動：AI 直接寫出的經過一律顯示
// 敘事依空行分段（段距比整行空白小）
const paragraphs = computed(() => {
  const list = narrationParagraphs(displayText.value)
  return list.length ? list : ['']
})
const showStory = computed(() => !!narration.value && (settings.aiNarration || !!narration.value.manual || props.report.check?.source === 'ai'))
// 續寫：只有最新一則有經過的日誌、模型來源設好時才有按鈕；按了先問想多寫什麼（可以不填）
const canContinue = computed(() => showStory.value && narration.value?.status === 'done' && settings.ready(settings.narrationFeature(props.report)) && !game.continueBlock(props.report))
const continuing = ref(false)
const continueHint = ref('')
function startContinue() {
  continuing.value = false
  void game.continueNarration(props.report, continueHint.value)
  continueHint.value = ''
}
// 玩家的行動與要求：改了之後整段重寫（帶入原本寫的玩家行動，可以改、可以補要求）
const directing = ref(false)
const directText = ref('')
function openDirect() {
  directing.value = !directing.value
  if (directing.value) {
    continuing.value = false
    directText.value = props.report.narration?.player_intent ?? ''
  }
}
function startDirect() {
  directing.value = false
  void game.narrateWith(props.report, directText.value)
}
const showBattleReport = computed(() => props.report.kind === 'combat' && !showStory.value && !!props.report.timeline?.length)
const names = computed(() => actorNames(props.report))
const changes = computed(() => describeChanges(props.report))
const check = computed(() => describeCheck(props.report))
const roll = computed(() => props.report.check)
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
const tokens = computed(() => game.usage[props.report.report_id])
// 自創配方做出來的東西：可以改名（AI 取的名字不喜歡時）
const invented = computed(() => (game.state ? inventedIn(game.state, props.report) : undefined))
function renameInvented() {
  const from = invented.value
  if (!from) return
  const to = prompt('幫自創的物品取個名字（配方也跟著改）', from)
  if (to && to.trim() !== from) {
    const name = game.renameInvention(from, to)
    if (name) game.flash(`✏️ 改名為「${name}」`)
  }
}
// ── 特效：這次遊玩中剛產生的日誌才播（讀檔、重畫不重播）
const fresh = game.state ? isFreshReport(game.state, props.report.report_id) : false
const dieEl = ref<HTMLElement | null>(null)
const changesEl = ref<HTMLElement | null>(null)
/** 主動行動的檢定：d20 先翻滾一下才出數字 */
const rolling = ref(fresh && !!props.report.check)
const shownNatural = ref(props.report.check?.natural ?? 0)
/** 打造、製作：先敲出火花，再揭曉做出來的東西 */
const CRAFT = /打造|製作|鍛造|煉|調配|縫製|雕刻|料理|烹/
const crafting = ref(fresh && !!props.report.changes.items_gained?.length && CRAFT.test(props.report.check?.action ?? props.report.outcome.summary ?? ''))
const timers: ReturnType<typeof setTimeout | typeof setInterval>[] = []
onMounted(() => {
  if (rolling.value) {
    const spin = setInterval(() => (shownNatural.value = 1 + Math.floor(Math.random() * 20)), 60)
    timers.push(spin, setTimeout(() => {
      clearInterval(spin)
      shownNatural.value = props.report.check!.natural
      rolling.value = false
      const d = props.report.check!.degree
      if (d === 'critical') { floatText(dieEl.value, '大成功！', { color: '#ffd34d', top: true }); flash(dieEl.value, '#ffd34d', true) }
      else if (d === 'fumble') { floatText(dieEl.value, '大失敗', { color: '#ff6a50', top: true }); flash(dieEl.value, '#ff3a2a', true) }
    }, 650))
  }
  if (crafting.value) {
    sparks(changesEl.value)
    timers.push(setTimeout(() => sparks(changesEl.value), 220), setTimeout(() => (crafting.value = false), 650))
  }
})
onBeforeUnmount(() => timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))
/** 變化標籤的樣式：稀有以上的掉落依稀有度發光、升級、學會技能 */
const chips = computed(() => changes.value.map((text) => {
  const item = /^獲得 (.+) ×\d+$/.exec(text)?.[1]
  const rarity = item && game.state ? itemRarity(game.state, item) : ''
  const cls = ['rare', 'epic', 'legendary', 'mythic'].includes(rarity) ? `loot r-${rarity}` : text.includes('升級！') ? 'lvl' : text.includes('習得技能') ? 'learn' : ''
  return { text, cls }
}))
const showRaw = ref(false)
const copied = ref(false)

// 日誌插圖：日誌底下的按鈕一鍵整理分鏡、生圖（交給 AI 自動分段，張數照設定），或打開對話框手動選位置；
// 插圖插在正文的段落之間（SceneImage）；以前的整則插圖、正文改過對不上的放在最後。設定了自動生成時正文寫完自己畫
const image = useImageSettings()
const scenes = useScenes()
const scene = computed(() => (game.state ? sceneKey(game.state, props.report.report_id) : ''))
/** 正文的段落（插圖的位置照這個算；沒有正文時是空的） */
const storyParagraphs = computed(() => (showStory.value && narration.value ? narrationParagraphs(displayText.value) : []))
const sceneLayout = computed(() => scenes.layout(scene.value, storyParagraphs.value, storyParagraphs.value.length > 0))
const hasScene = computed(() => scenes.keysOf(scene.value).length > 0)
/** 正在整理分鏡或生圖（出錯的不算） */
const sceneBusy = computed(() => scenes.busy(scene.value))
/** 正文還沒寫完（串流中、續寫中、重寫中）：這時分段會拿到寫到一半的正文，先不給畫 */
const storyPending = computed(() => !!narration.value && narration.value.status !== 'done')
function illustrate() {
  if (!game.state) return
  const n = scenes.keysOf(scene.value).length
  if (n > 1 && !confirm(`重新交給 AI 分段，會換掉這則日誌的 ${n} 張插圖。要繼續嗎？`)) return
  scenes.clearError(scene.value)
  void scenes.generate(game.state, props.report)
}
// 手動分段：選位置的對話框（已經有、對得上的位置預先勾好）
const splitOpen = ref(false)
const splitExisting = computed(() => [...scenes.validSpots(scene.value, storyParagraphs.value).keys()].sort((a, b) => a - b))
function splitDraw(after: number[]) {
  if (!game.state) return
  scenes.clearError(scene.value)
  void scenes.generate(game.state, props.report, { after })
}
onMounted(() => {
  if (game.state) void scenes.scan(game.state.seed)
})

async function copyPrompt() {
  const p = await game.promptFor(props.report)
  await navigator.clipboard.writeText(stripItemKeys(`${p.system}\n\n---\n\n${p.user}`))
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <article class="report" :class="[report.kind, { fresh }]">
    <header class="head">
      <span class="kind"><GameIcon :name="KIND[report.kind].icon" :size="14" />{{ KIND[report.kind].name }}</span>
      <strong class="where">{{ locationName(report.location.at) }}<template v-if="report.location.to"> → {{ locationName(report.location.to) }}</template></strong>
      <span class="when">{{ formatTime(report.time.start) }}</span>
      <details class="menu">
        <summary class="menu-btn" title="更多：複製提示詞、報告 JSON" aria-label="更多"><GameIcon name="more" :size="18" /></summary>
        <div class="menu-list">
          <button class="small ghost" @click="copyPrompt"><GameIcon name="copy" :size="14" /> {{ copied ? '已複製' : '複製提示詞' }}</button>
          <button class="small ghost" @click="showRaw = !showRaw"><GameIcon name="code" :size="14" /> {{ showRaw ? '隱藏' : '顯示' }}報告 JSON</button>
          <button v-if="undoSteps" class="small ghost" :disabled="game.judging" @click="undoHere"><GameIcon name="undo" :size="14" /> 回退到這則之前（{{ undoSteps }} 步）</button>
        </div>
      </details>
    </header>
    <p class="summary">{{ report.outcome.summary }}</p>
    <p v-if="invented" class="small"><button class="small" @click="renameInvented"><GameIcon name="edit" :size="14" /> 幫「{{ invented }}」改名</button></p>
    <div v-if="roll && check" class="check small" :title="check">
      <span ref="dieEl" class="d20" :class="{ rolling, [roll.degree]: !rolling && fresh }">{{ rolling ? shownNatural : roll.natural }}</span>
      <span class="muted">{{ roll.action }}</span>
      <span v-if="roll.skill" class="tag" title="檢定分類：特質、身分寫在這個分類上的加成會算進來">{{ skillName(roll.skill) }}檢定</span>
      <span v-if="!roll.keeper" class="tag">{{ attrName(roll.attr) }} {{ signed(roll.modifier - (roll.situational ?? []).reduce((s, x) => s + x.value, 0)) }}</span>
      <span v-for="x in roll.situational ?? []" :key="x.label" class="tag">{{ x.label }} {{ signed(x.value) }}</span>
      <span class="muted">＝</span><b>{{ roll.total }}</b>
      <span class="muted">對 DC {{ roll.dc }}<template v-if="roll.dc !== roll.base_dc">（參考 {{ roll.base_dc }}）</template></span>
      <span v-show="!rolling" class="verdict" :class="roll.degree">{{ DEGREE[roll.degree] }}</span>
      <span v-if="roll.reference_degree" class="muted">（骰值參考：{{ DEGREE[roll.reference_degree] }}）</span>
      <span v-if="roll.trivial" class="tag" title="AI 判為日常小事：結果至少是成功，骰值只決定過程順不順">日常小事</span>
      <span v-if="roll.source === 'ai'" class="tag">AI 判定</span>
    </div>
    <p v-if="report.check?.twist || report.check?.rationale" class="small reason">
      <template v-if="report.check?.twist"><span class="twist"><GameIcon name="sparkles" :size="13" /> 出乎預料：{{ report.check.twist }}</span><br v-if="report.check?.rationale" /></template>
      <span v-if="report.check?.rationale" class="muted">判定理由：{{ report.check.rationale }}</span>
    </p>
    <!-- 打聽到的具體內容（AI 判定的 findings）：不用讀完正文也看得到 -->
    <div v-if="report.check?.findings" class="small findings"><b><GameIcon name="eye" :size="13" /> 得知</b><div>{{ report.check.findings }}</div></div>
    <div v-if="narration?.status === 'streaming' && !showStory" class="small muted"><button class="small" @click="game.cancelNarration(report.report_id)">停止</button></div>

    <details v-if="thinking.length" class="thinking small">
      <summary>思考過程（{{ thinking.map((t) => t.label).join('、') }}）<span v-if="narration?.status === 'streaming' && !narration.text" class="muted">・思考中……</span></summary>
      <div v-for="t in thinking" :key="t.label" class="thought">
        <b v-if="thinking.length > 1">{{ t.label }}</b>
        <pre>{{ t.text }}</pre>
      </div>
    </details>

    <div v-if="showStory && narration" class="story story-paper">
      <div class="narration" data-no-convert>
        <template v-for="(para, i) in paragraphs" :key="i">
          <p>{{ para }}<span v-if="narration.status === 'streaming' && i === paragraphs.length - 1" class="cursor">▌</span></p>
          <SceneImage v-for="k in sceneLayout.inline[i] ?? []" :key="k" :image-key="k" />
        </template>
      </div>
      <p v-if="narration.status === 'error'" class="small err">{{ narration.error }}</p>
      <button v-if="narration.status === 'streaming'" class="small stop" @click="game.cancelNarration(report.report_id)">停止</button>
    </div>

    <div v-if="showBattleReport" class="battle-report">
      <h3 class="small">戰報</h3>
      <div class="small timeline">
        <template v-for="t in report.timeline" :key="t.seq">
          <div
            v-if="rollDetail(t.roll)" class="roll-line" role="button" tabindex="0" :title="rollDetail(t.roll)" :aria-expanded="openRolls.has(t.seq)"
            @click="toggleRoll(t.seq)" @keydown.enter.prevent="toggleRoll(t.seq)"
          >{{ describeEntry(t, names) }}</div>
          <div v-else>{{ describeEntry(t, names) }}</div>
          <div v-if="openRolls.has(t.seq) && rollDetail(t.roll)" class="roll-detail">{{ rollDetail(t.roll) }}</div>
        </template>
      </div>
    </div>
    <details v-else-if="report.timeline?.length" class="steps">
      <summary class="small">經過（{{ report.timeline.length }} 筆）</summary>
      <div class="small timeline">
        <template v-for="t in report.timeline" :key="t.seq">
          <div
            v-if="rollDetail(t.roll)" class="roll-line" role="button" tabindex="0" :title="rollDetail(t.roll)" :aria-expanded="openRolls.has(t.seq)"
            @click="toggleRoll(t.seq)" @keydown.enter.prevent="toggleRoll(t.seq)"
          >{{ describeEntry(t, names) }}</div>
          <div v-else>{{ describeEntry(t, names) }}</div>
          <div v-if="openRolls.has(t.seq) && rollDetail(t.roll)" class="roll-detail">{{ rollDetail(t.roll) }}</div>
        </template>
      </div>
    </details>
    <div v-if="changes.length" ref="changesEl" class="row small changes" :class="{ crafting }">
      <span v-for="(c, i) in chips" :key="`${i}:${c.text}`" class="tag" :class="c.cls" :style="{ '--i': i }">{{ c.text }}</span>
    </div>

    <!-- 寫出經過、生成插圖：放在日誌底下（讀完正文不用捲回最上面），插圖也掛在這下面 -->
    <div class="tools">
      <button
        v-if="settings.ready('narration') && narration?.status !== 'streaming'" class="small ghost tool"
        :title="showStory ? '重新寫出經過（用「敘事正文」的模型）' : '寫出經過（用「敘事正文」的模型）'" :aria-label="showStory ? '重新寫出經過' : '寫出經過'"
        @click="game.narrate(report, { manual: !settings.aiNarration })"
      ><GameIcon name="edit" :size="15" /></button>
      <button
        v-if="settings.ready('narration') && narration?.status !== 'streaming'" class="small ghost tool" :class="{ active: directing }"
        aria-label="玩家的行動與要求" title="玩家的行動與要求：改寫這次的玩家行動、補上想要的寫法，再整段重寫（只是文字，不擲骰、不改結果）"
        @click="openDirect"
      ><GameIcon name="message" :size="15" /></button>
      <button
        v-if="canRecordSex" class="small ghost tool" :class="{ recording: recordingSex, logged }" :disabled="!recordingSex && narration?.status === 'streaming'"
        :aria-disabled="recordingSex" :aria-label="recordingSex ? '正在記下性經歷…' : logged ? '重新記錄性經歷' : '記下性經歷'" :title="sexTitle"
        @click="onSexRecord"
      ><GameIcon name="heart" :size="15" /></button>
      <button
        v-if="canContinue" class="small ghost tool" :class="{ active: continuing }" aria-label="續寫"
        title="續寫：接著這段經過往下寫，把這一幕寫得更完整（只是文字，不擲骰、不改結果、不過時間）"
        @click="continuing = !continuing; directing = false"
      ><GameIcon name="feather" :size="15" /></button>
      <button
        class="small ghost tool" :disabled="!image.ready() || sceneBusy || storyPending" :aria-label="hasScene ? '重新生成插圖' : '生成插圖'"
        :title="!image.ready() ? '先到「設定 → 插圖生成」設定生圖服務' : storyPending ? '正文寫完之後才能畫插圖' : hasScene ? '重新生成插圖（交給 AI 重新分段、全部重畫）' : '依這則日誌畫插圖（AI 挑段落、整理分鏡，張數照設定，再送給生圖服務）'"
        @click="illustrate"
      ><GameIcon name="image" :size="15" /></button>
      <button
        v-if="storyParagraphs.length && narration?.status === 'done'" class="small ghost tool" :disabled="!image.ready() || sceneBusy" aria-label="手動分段插圖"
        :title="!image.ready() ? '先到「設定 → 插圖生成」設定生圖服務' : '手動分段插圖：自己選要在哪幾段後面插圖'"
        @click="splitOpen = true"
      ><GameIcon name="sliders" :size="15" /></button>
    </div>
    <form v-if="directing" class="continue small" @submit.prevent="startDirect">
      <label>玩家的行動與要求（這次寫經過時當成玩家的行動；可以不填）
        <textarea v-model="directText" rows="3" maxlength="600" placeholder="例如：我壓低聲音問她昨晚去了哪裡；多寫她的表情，場景改在雨中" />
      </label>
      <div class="row">
        <button type="submit" class="small primary"><GameIcon name="edit" :size="14" /> 照這個重寫</button>
        <button type="button" class="small ghost" @click="directing = false">取消</button>
        <span class="muted">改的內容存在這則日誌裡，之後重寫也會沿用。只是文字：結果、得到的東西、時間都不變。每次重寫是一次 AI 呼叫。</span>
      </div>
    </form>
    <form v-if="continuing && canContinue" class="continue small" @submit.prevent="startContinue">
      <label>續寫：想多寫什麼？（可以不填）
        <input v-model="continueHint" maxlength="200" placeholder="例如：多寫兩人的對話、把親密的過程寫細一點" />
      </label>
      <div class="row">
        <button type="submit" class="small primary"><GameIcon name="feather" :size="14" /> 開始續寫</button>
        <button type="button" class="small ghost" @click="continuing = false">取消</button>
        <span class="muted">接在這段經過後面，只是文字：結果、得到的東西、時間都不變。每次續寫是一次 AI 呼叫。</span>
      </div>
    </form>
    <template v-if="game.state">
      <SceneImage v-for="t in sceneLayout.tail" :key="t.key" :image-key="t.key" :stale="t.stale" />
      <SceneStatus :scene-key="scene" />
      <SceneSplitDialog :open="splitOpen" :paragraphs="storyParagraphs" :existing="splitExisting" @close="splitOpen = false" @draw="splitDraw" />
    </template>

    <pre v-if="showRaw" class="raw small">{{ JSON.stringify(report, null, 2) }}</pre>
    <!-- 這則日誌用掉的 token：平常只顯示總數，點開看輸入、輸出、快取與各次呼叫 -->
    <details v-if="tokens" class="small muted tokens" title="這則日誌的 AI 呼叫（判定、敘事）用掉的 token">
      <summary>{{ formatTokens(tokens.input + tokens.output) }} tokens<template v-if="tokens.calls > 1">（{{ tokens.calls }} 次呼叫）</template></summary>
      輸入 {{ formatTokens(tokens.input) }}<template v-if="tokens.cached">（快取 {{ formatTokens(tokens.cached) }}）</template>・輸出 {{ formatTokens(tokens.output) }}
      <template v-for="(p, i) in tokens.by ?? []" :key="i">
        <br /><span class="origin">{{ usageFeatureName(p.feature) }}・{{ usageSourceLabel(p) }}：輸入 {{ formatTokens(p.input) }}<template v-if="p.cached">（快取 {{ formatTokens(p.cached) }}）</template>・輸出 {{ formatTokens(p.output) }}<template v-if="p.calls > 1">（{{ p.calls }} 次）</template></span>
      </template>
    </details>
  </article>
</template>

<style scoped>
.report { position: relative; padding: 12px 14px 10px 18px; margin-bottom: 14px; background: #00000040; border: 1px solid #ffffff0d; border-radius: 3px; --kind: var(--accent); }
.report::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--kind); box-shadow: 0 0 8px var(--kind); opacity: 0.85; }
.report.travel { --kind: #8fb3a3; } .report.combat { --kind: #c8483a; } .report.social { --kind: #d79ac0; }
.report.trade { --kind: #c9a24a; } .report.rest { --kind: #7f9bd0; } .report.quest { --kind: #d6a64e; }
.report.event { --kind: #b48ad8; } .report.action { --kind: #e0b45a; }
.head { display: flex; align-items: center; gap: 8px; }
.kind { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); letter-spacing: 0.1em; color: var(--kind); font-weight: 700; white-space: nowrap; }
.where { min-width: 0; }
.when { margin-left: auto; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
.summary { margin: 6px 0 8px; font-weight: 600; }
.report.trade .summary { font-weight: 400; color: var(--muted); font-size: var(--fs-sm); margin-bottom: 4px; }

.menu { position: relative; }
.menu > summary { list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.menu-btn { display: grid; place-items: center; width: 26px; height: 26px; color: var(--muted); cursor: pointer; border-radius: 3px; }
.menu-btn:hover, .menu[open] .menu-btn { color: var(--accent); background: #ffffff0d; }
.menu-list {
  position: absolute; right: 0; top: 30px; z-index: 5; display: grid; gap: 2px; min-width: 170px; padding: 6px;
  background: var(--panel); border: 1px solid var(--gold-lo); border-radius: 3px; box-shadow: 0 8px 20px #000a;
}
.menu-list button { justify-content: flex-start; text-align: left; display: flex; align-items: center; gap: 6px; color: var(--text); }
.tools { display: flex; justify-content: flex-end; gap: 2px; margin-top: 4px; }
.tool { display: grid; place-items: center; width: 28px; height: 26px; padding: 0; color: var(--muted); }
.tool:hover:not(:disabled) { color: var(--accent); }
/* 正在記下性經歷：心形閃動 */
/* 記過的（可以重新記錄）：心是粉紅色的 */
.tool.logged { color: #e07aa8; }
.tool.recording { color: #ff8cc8; cursor: progress; animation: sex-pulse 1.1s ease-in-out infinite; }
@keyframes sex-pulse { 50% { opacity: 0.35; transform: scale(0.85); } }
:global(html[data-fx='off']) .tool.recording { animation: none; }

.check { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.d20 {
  display: inline-grid; place-items: center; width: 28px; height: 28px; font-weight: 900; font-size: 13px; color: #1a1008;
  background: var(--gold-hi); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.verdict { font-weight: 900; letter-spacing: 0.12em; padding: 0 4px; }
.verdict.critical { color: var(--gold-hi); text-shadow: 0 0 8px #f0d08388; }
.verdict.success { color: var(--good); }
.verdict.partial { color: #d8b45a; }
.verdict.fail { color: var(--danger); }
.verdict.fumble { color: #ff6a50; text-shadow: 0 0 8px #ff6a5066; }
.reason { margin: 0 0 8px; }
.twist { color: var(--accent-2); }
.findings { margin: 0 0 8px; padding: 6px 10px; border-left: 2px solid var(--gold-lo); background: #0003; white-space: pre-line; }
.findings b { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-weight: 600; }

.story { margin: 8px 0; }
.story .err { color: var(--danger); }
.story .stop { margin-top: 6px; }
.thinking { margin: 6px 0; color: var(--muted); }
.thinking summary { cursor: pointer; }
.thought pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; line-height: 1.6; margin: 4px 0 8px; padding: 6px 10px; border-left: 2px dashed var(--border); max-height: 360px; overflow: auto; }
.cursor { animation: blink 1s steps(1) infinite; color: #7a2e12; }
@keyframes blink { 50% { opacity: 0; } }
.battle-report { border-left: 2px solid #c8483a66; padding: 6px 12px; margin: 8px 0; background: #0005; }
.battle-report h3 { margin: 0 0 2px; }
.battle-report .timeline { color: var(--text); }
.timeline { display: grid; gap: 2px; padding: 6px 0; color: var(--muted); }
.timeline .roll-line { cursor: help; text-decoration: underline dotted; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 3px; }
.timeline .roll-line:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.timeline .roll-detail { padding-left: 1em; font-size: var(--fs-xs); color: var(--accent); }
.changes { margin: 8px 0 2px; gap: 5px; }
/* 變化的標籤可能帶著 AI 寫的原因：允許換行，不要撐破卡片 */
.changes .tag { white-space: normal; height: auto; }
/* 剛產生的日誌：卡片由下往上滑入，變化標籤依序彈出 */
.report.fresh { animation: card-in 0.3s steps(5, end); }
@keyframes card-in { from { transform: translateY(14px); opacity: 0; } }
.report.fresh .changes .tag { animation: chip-in 0.3s steps(4, end) both; animation-delay: calc(var(--i) * 60ms + 0.2s); }
@keyframes chip-in { from { transform: scale(0.5); opacity: 0; } }
.changes.crafting .tag { visibility: hidden; }
/* 稀有以上的掉落：依稀有度發光；剛拿到時多閃一下 */
.tag.loot { font-weight: 700; }
.tag.r-rare { color: var(--r-rare); border-color: var(--r-rare); box-shadow: 0 0 6px color-mix(in srgb, var(--r-rare) 60%, transparent); }
.tag.r-epic { color: var(--r-epic); border-color: var(--r-epic); box-shadow: 0 0 8px color-mix(in srgb, var(--r-epic) 60%, transparent); }
.tag.r-legendary, .tag.r-mythic { color: var(--r-legendary); border-color: var(--r-legendary); box-shadow: 0 0 10px color-mix(in srgb, var(--r-legendary) 70%, transparent); }
.report.fresh .tag.loot { animation: chip-in 0.3s steps(4, end) both, loot-flash 0.9s ease-out both; animation-delay: calc(var(--i) * 60ms + 0.2s); }
@keyframes loot-flash { 0%, 30% { box-shadow: 0 0 22px 4px currentColor; } }
.tag.lvl { color: var(--gold-hi); border-color: var(--gold-hi); }
/* 學會技能：卡片從背面翻過來 */
.report.fresh .tag.learn { animation: flip-in 0.5s steps(6, end) both; animation-delay: calc(var(--i) * 60ms + 0.2s); }
@keyframes flip-in { from { transform: rotateY(180deg); color: transparent; background: var(--gold-lo); } 50% { transform: rotateY(90deg); } }
/* 檢定：d20 翻滾，大成功金光、大失敗紅光 */
.d20.rolling { animation: d20-spin 0.65s steps(8, end); }
@keyframes d20-spin { from { transform: rotate(-720deg) scale(0.6); } }
.d20.critical { background: #fff3c4; box-shadow: 0 0 0 2px var(--gold-hi); animation: d20-glow 1s ease-out; }
.d20.fumble { background: #ff8a70; animation: d20-glow 1s ease-out; }
@keyframes d20-glow { from { filter: drop-shadow(0 0 10px currentColor) brightness(1.6); } }
.raw { max-height: 320px; overflow: auto; background: var(--bg); padding: 8px; border-radius: 3px; }
details.steps summary, details.thinking summary { cursor: pointer; color: var(--accent-2); }
.tokens { margin: 6px 0 0; text-align: right; }
.tokens summary { cursor: pointer; list-style-position: inside; color: var(--muted); }
.tokens .origin { opacity: .85; }
.continue { display: grid; gap: 6px; margin: 4px 0 6px; padding: 8px; border: 1px dashed var(--border); border-radius: 6px; }
.continue label { display: grid; gap: 4px; }
.continue textarea { width: 100%; resize: vertical; font: inherit; }
.continue .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
</style>
