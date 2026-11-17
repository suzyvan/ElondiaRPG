<script setup lang="ts">
import { textHas } from '@/engine/script'
import { stripItemKeys } from '@/engine/itemKey'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import PromptSetBar from './PromptSetBar.vue'
import type { Composed } from '@/narrator/compose'
import { LORE_STATUS_NAME, type LoreItem, type LoreMode, type LoreSelection } from '@/narrator/lore'
import { estimateTokens } from '@/narrator/promptConfig'
import { MAX_CONTINUITY } from '@/narrator/continuity'
import { CUSTOM_LENGTH_MAX, CUSTOM_LENGTH_MIN, DEFAULT_DEFEAT_RULES, DEFAULT_NARRATION_RULES, DEFAULT_SCENE_RULES, LENGTH_NAME, LENGTH_SCALE_NAME, LENGTH_SCALES, LENGTHS, POV_NAME, POVS, type PromptSection } from '@/narrator/prompt'
import { sanitizeCustomLength } from '@/narrator/promptConfig'
import { useGame } from '@/stores/game'
import { usePrompts } from '@/stores/prompts'
import { useSettings } from '@/stores/settings'
import PromptEntryList from './PromptEntryList.vue'
import RegexPanel from './RegexPanel.vue'
import { dateStamp, download } from './download'
import Hint from './ui/Hint.vue'

type Sub = 'rules' | 'styles' | 'lore' | 'custom' | 'regex' | 'data' | 'preview'
const SUBS: { id: Sub; label: string }[] = [
  { id: 'rules', label: '📜 敘事規則' },
  { id: 'styles', label: '🎨 文風' },
  { id: 'lore', label: '📚 世界書' },
  { id: 'custom', label: '🧩 其他提示詞' },
  { id: 'regex', label: '🔣 正文正則' },
  { id: 'data', label: '🔍 注入資料' },
  { id: 'preview', label: '👁️ 預覽' },
]
const MODES: { id: LoreMode; label: string }[] = [
  { id: 'constant', label: '常駐' },
  { id: 'keyword', label: '關鍵字觸發' },
  { id: 'travel', label: '旅行報告' },
  { id: 'off', label: '停用' },
]

const game = useGame()
const prompts = usePrompts()
/** 自訂篇幅改完：夾在範圍內、下限不大於上限 */
function fixLength() {
  prompts.config.customLength = sanitizeCustomLength(prompts.config.customLength)
}
const settings = useSettings()
const sub = ref<Sub>('rules')

// ---- 預覽依據：哪一則日誌（敘事）、等待中的行動或範例行動（判定） ----
const reports = computed(() => [...(game.state?.reports ?? [])].reverse().slice(0, 30))
const reportId = ref<string>('')
watch(reports, (list) => {
  if (!list.some((r) => r.report_id === reportId.value)) reportId.value = list[0]?.report_id ?? ''
}, { immediate: true })
const report = computed(() => reports.value.find((r) => r.report_id === reportId.value))

const narration = shallowRef<Composed | null>(null)
const judge = shallowRef<(Composed & { sample: boolean }) | null>(null)
const loading = ref(true)
let seq = 0

async function refresh() {
  const n = ++seq
  await prompts.ensureLoaded()
  const r = report.value
  const [a, b] = await Promise.all([r ? game.composeFor(r) : Promise.resolve(null), game.composeJudgePreview()])
  if (n !== seq) return
  narration.value = a
  judge.value = b
  loading.value = false
}

onMounted(refresh)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [JSON.stringify(prompts.config), settings.loreBudget, settings.language, reportId.value, game.state?.reports.length, game.state?.pendingAction?.id, game.state?.relationships, game.state?.memories],
  () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 250)
  },
  { deep: true },
)

// ---- 敘事規則 ----
// 沒有修改時存成 undefined（跟著預設走，之後更新遊戲時會拿到新的預設）
const rulesText = computed({
  get: () => prompts.config.narrationRules ?? DEFAULT_NARRATION_RULES,
  set: (v: string) => {
    // 清空時暫時保留空白（方便整段重寫），送出時用預設；重新載入後恢復成預設
    if (v === DEFAULT_NARRATION_RULES) delete prompts.config.narrationRules
    else prompts.config.narrationRules = v
  },
})
const rulesEdited = computed(() => prompts.config.narrationRules !== undefined)

// 戰敗事件規則（成人向）：同樣可以修改、恢復預設
const defeatText = computed({
  get: () => prompts.config.defeatRules ?? DEFAULT_DEFEAT_RULES,
  set: (v: string) => {
    if (v === DEFAULT_DEFEAT_RULES) delete prompts.config.defeatRules
    else prompts.config.defeatRules = v
  },
})
const defeatEdited = computed(() => prompts.config.defeatRules !== undefined)
function restoreDefeat() {
  if (confirm('把戰敗事件規則恢復成預設？你的修改會消失。')) delete prompts.config.defeatRules
}

// 成人場景規則：娼館、主人的邀約、戰敗事件的遭遇等親密場景，要求在正文詳細描寫
const sceneText = computed({
  get: () => prompts.config.sceneRules ?? DEFAULT_SCENE_RULES,
  set: (v: string) => {
    if (v === DEFAULT_SCENE_RULES) delete prompts.config.sceneRules
    else prompts.config.sceneRules = v
  },
})
const sceneEdited = computed(() => prompts.config.sceneRules !== undefined)
function restoreScene() {
  if (confirm('把成人場景規則恢復成預設？你的修改會消失。')) delete prompts.config.sceneRules
}

function restoreRules() {
  if (confirm('把敘事規則恢復成預設？你的修改會消失。')) delete prompts.config.narrationRules
}

// ---- 世界書 ----
const loreBasis = ref<'narration' | 'judge'>('narration')
const selection = computed<LoreSelection | undefined>(() => (loreBasis.value === 'judge' ? judge.value?.lore : narration.value?.lore))
const loreFilter = ref<'all' | 'injected' | 'off'>('all')
const loreSort = ref<'order' | 'position'>('position')
const loreSearch = ref('')
const openLore = ref<number | null>(null)

const loreRows = computed(() => {
  const states = selection.value?.states ?? {}
  const q = loreSearch.value.trim()
  const rows = prompts.items
    .map((it) => ({ it, st: states[it.uid] }))
    .filter(({ it, st }) => {
      if (q && !textHas(it.comment, q) && !it.keys.some((k) => textHas(k, q)) && !textHas(it.content, q)) return false
      if (loreFilter.value === 'injected') return !!st?.position
      if (loreFilter.value === 'off') return it.mode === 'off'
      return true
    })
  if (loreSort.value === 'position') {
    rows.sort((a, b) => (a.st?.position ?? 9999) - (b.st?.position ?? 9999) || a.it.order - b.it.order || a.it.uid - b.it.uid)
  }
  return rows
})

const loreSummary = computed(() => {
  const s = selection.value
  if (!s) return ''
  const sum = (l: LoreItem[]) => l.reduce((t, e) => t + e.content.length, 0)
  return `常駐 ${s.constant.length} 條（${sum(s.constant)} 字，放在前段）・觸發 ${s.triggered.length} 條（${sum(s.triggered)} 字，放在後段）・合計 ${s.chars} / ${settings.loreBudget} 字`
})

function keysText(it: LoreItem) {
  return it.keys.join('、')
}

function setKeys(it: LoreItem, text: string) {
  prompts.updateLore(it.uid, { keys: text.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean) })
}

function inputValue(e: Event) {
  return (e.target as HTMLInputElement).value
}

const loreInput = ref<HTMLInputElement | null>(null)

async function exportLore() {
  download(`elondia-worldbook-${dateStamp()}.json`, await prompts.exportLore())
}

async function onImportLore(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const total = { added: 0, updated: 0, skipped: 0 }
  try {
    for (const f of files) {
      const r = await prompts.importLore(await f.text())
      total.added += r.added
      total.updated += r.updated
      total.skipped += r.skipped
    }
    game.flash(`世界書：新增 ${total.added} 條、更新 ${total.updated} 條${total.skipped ? `、略過 ${total.skipped} 條（已存在）` : ''}`)
  } catch (err) {
    game.error = `匯入世界書失敗：${err instanceof Error ? err.message : String(err)}`
  }
}

function addLore() {
  openLore.value = prompts.addLore().uid
  loreFilter.value = 'all'
  loreSearch.value = ''
}

function removeLore(it: LoreItem) {
  if (confirm(`刪除「${it.comment}」？`)) prompts.removeLore(it.uid)
}

// ---- 注入資料與預覽 ----
function section(c: Composed | null | undefined, key: string): PromptSection | undefined {
  return c?.prompt.sections?.find((s) => s.key === key)
}

const injected = computed(() => [
  { title: '🧝 主角設定', note: '敘事請求', s: section(narration.value, 'protagonist') },
  { title: '🧝 主角（判定用）', note: '判定請求：含屬性、技能、金錢、契約', s: section(judge.value, 'actor') },
  { title: '👥 隊伍狀態', note: '判定請求；敘事請求的隊伍狀態在報告裡', s: section(judge.value, 'party') },
  { title: '🎒 行囊', note: '判定請求：用到行囊裡的道具時，AI 可以當成助力', s: section(judge.value, 'inventory') },
  { title: '💞 人際關係與冒險記憶（敘事）', note: '依這則日誌的參與人、地點與時間檢索', s: section(narration.value, 'context') },
  { title: '💞 人際關係與冒險記憶（判定）', note: '隊伍全員與行動對象，加上目前地點', s: section(judge.value, 'context') },
])

const previewKind = ref<'narration' | 'judge'>('narration')
const preview = computed(() => (previewKind.value === 'narration' ? narration.value : judge.value))
const previewSections = computed(() => preview.value?.prompt.sections ?? [])
const totals = computed(() => {
  const t = { system: 0, user: 0, systemChars: 0, userChars: 0 }
  for (const s of previewSections.value) {
    t[s.part] += estimateTokens(s.text)
    t[s.part === 'system' ? 'systemChars' : 'userChars'] += s.text.length
  }
  return t
})
const expanded = ref<Record<string, boolean>>({})

async function copyPreview() {
  const p = preview.value?.prompt
  if (!p) return
  try {
    await navigator.clipboard.writeText(stripItemKeys(`[system]\n${p.system}\n\n[user]\n${p.user}`))
    game.flash('已複製提示詞')
  } catch {
    game.flash('瀏覽器不允許複製')
  }
}

// ---- 匯出、匯入、重設 ----
const fileInput = ref<HTMLInputElement | null>(null)

function exportConfig() {
  download(`elondia-prompts-${dateStamp()}.json`, prompts.exportConfig())
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  try {
    prompts.importConfig(await f.text())
    game.flash('已匯入全部提示詞設定')
  } catch (err) {
    game.error = `匯入失敗：${err instanceof Error ? err.message : String(err)}`
  }
}

function resetAll() {
  if (confirm('把敘事規則、戰敗事件規則、文風、其他提示詞與世界書的修改全部恢復成預設值？')) prompts.resetAll()
}
</script>

<template>
  <div class="prompts">
    <PromptSetBar />
    <nav class="subs row">
      <button v-for="t in SUBS" :key="t.id" :class="{ active: sub === t.id }" @click="sub = t.id">{{ t.label }}</button>
      <span class="spacer" />
      <label v-if="game.state" class="small basis">
        預覽依據的日誌
        <select v-model="reportId">
          <option v-for="r in reports" :key="r.report_id" :value="r.report_id">第 {{ r.time.start.day }} 天・{{ r.outcome.summary?.slice(0, 24) || r.kind }}</option>
        </select>
      </label>
    </nav>

    <p class="small muted order-note">
      送出順序：<b>前段（system，同一局幾乎不變，可以被快取）</b> 規則 → 文風（接在規則最後，當作規則的一條）→ 常駐世界書 → 其他提示詞（前段）
      ｜ <b>後段（user，每次不同）</b> 主角 → 觸發的世界書 → 人際關係與記憶 → 報告或行動 → 其他提示詞（後段）→ 本次要求。
      前段任何一個字改變，快取就要重新建立，所以請把常變動的指示放在後段。
    </p>

    <!-- 敘事規則 -->
    <section v-if="sub === 'rules'" class="panel">
      <div class="row">
        <h2>📜 敘事規則</h2>
        <span v-if="rulesEdited" class="tag">已修改</span>
        <span class="spacer" />
        <button class="small" :disabled="!rulesEdited" @click="restoreRules">↩️ 恢復預設</button>
      </div>
      <p class="small muted">
        「AI 細節描述」每次請求最前面的規則（判定主動行動用的是另一份判定規則，不受影響）。修改後立即套用到之後的敘事，可以到「👁️ 預覽」確認送出的內容。<br />
        可用的代換：<code v-pre>{{language}}</code> 輸出語言、<code v-pre>{{currency}}</code> 貨幣說明、<code v-pre>{{player}}</code> 主角名、<code v-pre>{{style}}</code> 文風放的位置（自成一行；沒有時文風接在規則最後），文風的前綴接續它前一行：前一行是「10.」就變成「11. 文風」，是「-」就變成「- 文風」，其他（例如 <code>&lt;/negative&gt;</code>）就只寫「文風」。
        視角與篇幅每次由程式寫在最後的「本次要求」，規則裡不要寫死。<br />
        ⚠ 預設第 10 條的 <code>&lt;relationship_updates&gt;</code> 格式是遊戲用來讀取人際關係更新的，刪掉或改格式會讓這個功能失效；清空內容等於恢復預設。
      </p>
      <div class="row settings small">
        <label>正文篇幅
          <select v-model="prompts.config.lengthScale">
            <option v-for="s in LENGTH_SCALES" :key="s" :value="s">{{ LENGTH_SCALE_NAME[s] }}</option>
          </select>
        </label>
        <Hint text="整體調整「本次要求」的篇幅字數。短篇、中篇、長篇分別是：偏短約 150～300／400～700／800～1200 字，標準約 200～400／500～900／1000～1500 字，偏長約 400～700／900～1400／1500～2200 字；選「自訂」可以自己填每一檔的字數。自由行動與親密場景是中篇，其他多數是短篇。判定時順便寫的經過也照這個。字數變多時，模型來源的「最大輸出 tokens」要夠大。" />
        <label>視角
          <select v-model="prompts.config.pov">
            <option v-for="v in POVS" :key="v" :value="v">{{ POV_NAME[v] }}</option>
          </select>
        </label>
        <Hint text="寫在每次請求最後的「本次要求」，正文、續寫與判定時順便寫的經過都照這個。依日誌：和以前一樣，通常是第二人稱（「你」）。第三人稱用主角的名字；第一人稱用「我」。文風或其他提示詞寫的視角會被本次要求蓋過，要改視角請改這裡。" />
        <label class="check"><input v-model="prompts.config.continuity" type="checkbox" /> 前後銜接</label>
        <label v-if="prompts.config.continuity">前文
          <input v-model.number="prompts.config.continuityCount" type="number" min="1" :max="MAX_CONTINUITY" step="1" class="num" @change="prompts.config.continuityCount = Math.max(1, Math.min(MAX_CONTINUITY, Math.round(prompts.config.continuityCount || 1)))" /> 段
        </label>
        <Hint :text="`敘事與判定帶前面的正文，以及之後沒有寫成正文的事（移動、交易、沒有寫經過的日誌），要 AI 在開頭自然帶過、接著寫。前文 1 段只帶上一段的結尾（約 300 字）；2 段以上時上一段帶約 1000 字，更早的每段帶時間、地點、摘要與約 300 字的結尾（最多 ${MAX_CONTINUITY} 段），比較不會和前文對不上。放在後段，不影響快取；預設 3 段，每次大約多送 2000 字，段數越多 token 越多。`" />
        <label class="check"><input v-model="prompts.config.variety" type="checkbox" /> 變化正文的寫法</label>
        <Hint text="每次在「本次要求」指定不同的開場與收尾（從對白開場、從動作中途切入、停在一個畫面上……），連續兩則不會一樣，避免每次結構都相同。文風已經規定結構時可以關掉。" />
      </div>
      <!-- 自訂篇幅：每一檔的字數下限與上限（輸入完夾在範圍內、下限不大於上限） -->
      <div v-if="prompts.config.lengthScale === 'custom'" class="row settings small custom-length">
        <template v-for="l in LENGTHS" :key="l">
          <label>{{ LENGTH_NAME[l] }}
            <input v-model.number="prompts.config.customLength[l][0]" type="number" :min="CUSTOM_LENGTH_MIN" :max="CUSTOM_LENGTH_MAX" step="50" @change="fixLength" />
            ～
            <input v-model.number="prompts.config.customLength[l][1]" type="number" :min="CUSTOM_LENGTH_MIN" :max="CUSTOM_LENGTH_MAX" step="50" @change="fixLength" />
            字
          </label>
        </template>
        <span class="muted">{{ CUSTOM_LENGTH_MIN }}～{{ CUSTOM_LENGTH_MAX }} 字</span>
      </div>
      <textarea v-model="rulesText" class="rules" rows="22" spellcheck="false" />
      <p class="small muted">{{ rulesText.length }} 字・約 {{ estimateTokens(rulesText) }} tokens。規則放在前段（可以被快取），改動後第一次請求會重新建立快取。</p>

      <div class="row defeat-head">
        <h3>戰敗事件規則（成人向）</h3>
        <span v-if="defeatEdited" class="tag">已修改</span>
        <span class="spacer" />
        <button class="small" :disabled="!defeatEdited" @click="restoreDefeat">↩️ 恢復預設</button>
      </div>
      <p class="small muted">
        只在成人向的戰敗事件附加在敘事規則之後：前半段是戰報（停在敵人動手的前一刻），後半段是玩家回應之後的經過（AI 判定的 narrative 也會用）。
        可用的代換：<code v-pre>{{player}}</code> 主角名。內容篩選關掉「主角非自願」或關閉戰敗色情事件時不會發生。
      </p>
      <textarea v-model="defeatText" class="rules" rows="9" spellcheck="false" />
      <div class="row defeat-head">
        <h3>成人場景規則（成人向）</h3>
        <span v-if="sceneEdited" class="tag">已修改</span>
        <span class="spacer" />
        <button class="small" :disabled="!sceneEdited" @click="restoreScene">↩️ 恢復預設</button>
      </div>
      <p class="small muted">
        經過包含親密場景時附加在敘事規則之後，要求在正文詳細描寫：娼館的消費與接客、主人的邀約（答應或被推進娼館）、戰敗事件沒能脫身，以及 AI 判定認為有親密場景的行動（自由行動、長休的互動等）。
        判定請求也會附上（只在 AI 標出 adult_scene 時適用）。可用的代換：<code v-pre>{{player}}</code> 主角名。
      </p>
      <textarea v-model="sceneText" class="rules" rows="9" spellcheck="false" />
    </section>

    <!-- 文風 -->
    <section v-else-if="sub === 'styles'" class="panel">
      <h2>🎨 文風</h2>
      <p class="small muted">開啟的文風會常駐在每次敘事與判定請求的前段：依序合併成一個 &lt;style&gt; 區塊，接在硬性規則的最後當作規則的一條（排在世界書前面），讓 AI 更確實遵守。可以同時開啟多個，例如一個整體風格加一個「多寫環境描寫」。</p>
      <PromptEntryList list="styles" />
    </section>

    <!-- 其他提示詞 -->
    <section v-else-if="sub === 'custom'" class="panel">
      <h2>🧩 其他提示詞</h2>
      <p class="small muted">
        不限類型的指示，例如角色的口癖、想避開的題材、輸出格式的偏好。<br />
        前段：和規則、文風一起常駐，可以被快取。後段：放在每次請求的最後、「本次要求」之前，AI 比較不容易忘記，但每次都要重新計費。
      </p>
      <PromptEntryList list="custom" />
    </section>

    <!-- 正文正則 -->
    <section v-else-if="sub === 'regex'" class="panel">
      <h2>🔣 正文正則</h2>
      <RegexPanel />
    </section>

    <!-- 世界書 -->
    <section v-else-if="sub === 'lore'" class="panel">
      <h2>📚 世界書</h2>
      <div class="row settings small">
        <label>注入字數上限 <input v-model.number="settings.loreBudget" type="number" min="2000" step="1000" style="width: 100px" /></label>
        <label class="check"><input v-model="prompts.config.loreInJudge" type="checkbox" /> 判定請求也帶世界書</label>
        <button class="small primary" @click="addLore">＋ 新增條目</button>
        <button class="small" title="SillyTavern 世界書格式，含修改與新增的條目" @click="exportLore">📤 匯出世界書</button>
        <button class="small" title="SillyTavern 世界書，或本遊戲匯出的世界書" @click="loreInput?.click()">📥 匯入世界書</button>
        <input ref="loreInput" type="file" accept=".json,application/json" multiple hidden @change="onImportLore" />
      </div>
      <p class="small muted">標了成人向的條目只在成人場景（日誌帶親密場景，或判定的行動可能進入親密場景）注入。</p>
      <p class="small muted">
        常駐：每次都注入，放在前段。關鍵字觸發：報告（或判定的行動）文字裡出現關鍵字時注入，放在後段；世界書是簡體，比對時繁簡兩種寫法都會比。
        注入順序（order）越小越前面；超過字數上限時，常駐條目優先保留。<br />
        匯出的檔案是 SillyTavern 世界書格式，可以在酒館使用，也可以匯入回來（內建條目的修改會還原成匯出時的樣子）。匯入其他世界書時，條目會加成自訂條目；
        常駐、停用依檔案的設定，其餘為關鍵字觸發；內容和現有條目完全相同的會略過。
      </p>
      <div class="row small">
        觸發情形依據：
        <label class="check"><input v-model="loreBasis" type="radio" value="narration" /> 敘事（上方選的日誌）</label>
        <label class="check"><input v-model="loreBasis" type="radio" value="judge" :disabled="!prompts.config.loreInJudge" /> 判定（{{ judge?.sample ? '範例行動' : '等待中的行動' }}）</label>
      </div>
      <p v-if="!game.state" class="small muted">開始遊戲後，這裡會顯示每個條目對最新日誌是否觸發。</p>
      <p v-else-if="loreSummary" class="small">{{ loreSummary }}</p>
      <div class="row small">
        <input v-model="loreSearch" placeholder="搜尋名稱、關鍵字或內容" style="flex: 1; min-width: 160px" />
        <select v-model="loreFilter">
          <option value="all">全部條目</option>
          <option value="injected">這次會注入的</option>
          <option value="off">停用的</option>
        </select>
        <select v-model="loreSort">
          <option value="position">依注入順序</option>
          <option value="order">依 order</option>
        </select>
      </div>

      <p v-if="!prompts.items.length" class="muted">載入世界書中…</p>
      <ul class="plain lore">
        <li v-for="{ it, st } in loreRows" :key="it.uid" :class="{ off: it.mode === 'off' }">
          <div class="row head">
            <span class="pos small">{{ st?.position ? `#${st.position}` : '—' }}</span>
            <span v-if="st" class="tag status" :class="st.status">{{ LORE_STATUS_NAME[st.status] }}</span>
            <strong class="name" @click="openLore = openLore === it.uid ? null : it.uid">{{ it.comment }}</strong>
            <span v-if="st?.hit" class="small muted">命中「{{ st.hit }}」</span>
            <span v-if="!it.builtin" class="tag">自訂</span>
            <span v-else-if="it.edited" class="tag">已修改</span>
            <span v-if="it.adult" class="tag">成人</span>
            <span v-if="st?.variant" class="tag" :title="`依劇情旗標換掉了內容：${st.variant}`">劇情變體</span>
            <span class="spacer" />
            <select class="small" :value="it.mode" @change="prompts.updateLore(it.uid, { mode: inputValue($event) as LoreMode })">
              <option v-for="m in MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <label class="small" title="注入順序，越小越前面">order <input class="num" type="number" :value="it.order" @change="prompts.updateLore(it.uid, { order: Number(inputValue($event)) || 0 })" /></label>
            <span class="small muted chars">{{ it.content.length }} 字</span>
            <button class="small" @click="openLore = openLore === it.uid ? null : it.uid">{{ openLore === it.uid ? '收起' : '✏️' }}</button>
          </div>
          <p v-if="it.note && openLore !== it.uid" class="small muted note">{{ it.note }}</p>
          <div v-if="openLore === it.uid" class="editor">
            <p v-if="it.note" class="small muted">{{ it.note }}</p>
            <p v-if="it.variants?.length" class="small muted">依劇情旗標換掉內容（第一個符合的生效；下面編輯的是原本的內容）：{{ it.variants.map((v) => v.note ?? v.flags.join('＋')).join('；') }}</p>
            <label>名稱 <input :value="it.comment" @change="prompts.updateLore(it.uid, { comment: inputValue($event) })" /></label>
            <label><span>關鍵字 <Hint text="用逗號或頓號分隔；「關鍵字觸發」時使用。" /></span><input :value="keysText(it)" @change="setKeys(it, inputValue($event))" /></label>
            <label class="check"><input type="checkbox" :checked="it.adult" @change="prompts.updateLore(it.uid, { adult: ($event.target as HTMLInputElement).checked })" /> 成人向 <Hint text="只在成人場景注入（日誌帶親密場景，或判定的行動可能進入親密場景）。" /></label>
            <textarea :value="it.content" rows="10" @change="prompts.updateLore(it.uid, { content: inputValue($event) })" />
            <div class="row">
              <span class="small muted">內容修改在離開輸入框時儲存。</span>
              <span class="spacer" />
              <button v-if="it.builtin" class="small" :disabled="!it.edited" @click="prompts.resetLore(it.uid)">恢復預設</button>
              <button v-else class="small danger" @click="removeLore(it)">刪除</button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- 注入資料 -->
    <section v-else-if="sub === 'data'" class="panel">
      <h2>🔍 注入資料</h2>
      <p class="small muted">這些內容由遊戲自動產生；要修改請到冒險頁的「👥 隊伍」（主角設定）與「💞 關係」（人際關係、冒險記憶）。</p>
      <p v-if="!game.state" class="muted">開始遊戲後才有資料。</p>
      <template v-else>
        <div v-for="d in injected" :key="d.title" class="data">
          <h3>{{ d.title }} <span class="small muted">{{ d.note }}{{ d.s ? `・${d.s.text.length} 字・約 ${estimateTokens(d.s.text)} tokens` : '' }}</span></h3>
          <pre v-if="d.s">{{ d.s.text }}</pre>
          <p v-else class="small muted">（這次沒有內容，不會送出）</p>
        </div>
      </template>
    </section>

    <!-- 預覽 -->
    <section v-else class="panel">
      <h2>👁️ 預覽</h2>
      <div class="row">
        <label class="check"><input v-model="previewKind" type="radio" value="narration" /> 敘事（AI 細節描述）</label>
        <label class="check"><input v-model="previewKind" type="radio" value="judge" /> 判定（AI 判定主動行動）</label>
        <span class="spacer" />
        <button class="small" :disabled="!preview" @click="copyPreview">📋 複製全文</button>
      </div>
      <p v-if="!game.state" class="muted">開始遊戲後才能預覽。</p>
      <p v-else-if="loading" class="muted">組合中…</p>
      <p v-else-if="previewKind === 'narration' && !narration" class="muted">還沒有日誌。</p>
      <p v-else-if="previewKind === 'judge' && !judge" class="muted">戰鬥中不能預覽判定。</p>
      <template v-else-if="preview">
        <p v-if="previewKind === 'judge' && judge?.sample" class="small muted">目前沒有等待判定的行動，以一個範例「自由行動」預覽（骰值是範例，不影響遊戲）。</p>
        <p v-if="previewKind === 'narration'" class="small muted">
          以上方選的日誌重新生成敘事時，會送出下面的內容。
          <template v-if="report && settings.narrationFeature(report) === 'adult'">這則日誌帶親密場景：用套用到「成人場景」的條目，由「成人場景正文」的來源（{{ settings.sourceFor('adult').name }}）撰寫。</template>
        </p>
        <table class="sections small">
          <thead><tr><th>#</th><th>區塊</th><th>位置</th><th>字數</th><th>約 tokens</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in previewSections" :key="s.key" :class="s.part">
              <td>{{ i + 1 }}</td>
              <td>{{ s.title }}</td>
              <td>{{ s.part === 'system' ? '前段・可快取' : '後段' }}</td>
              <td>{{ s.text.length }}</td>
              <td>{{ estimateTokens(s.text) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td /><td>前段合計</td><td /><td>{{ totals.systemChars }}</td><td>{{ totals.system }}</td></tr>
            <tr><td /><td>後段合計</td><td /><td>{{ totals.userChars }}</td><td>{{ totals.user }}</td></tr>
          </tfoot>
        </table>
        <p class="small muted">
          token 數是粗估（中文約一字一 token），實際用量看日誌下方的統計；有讀到快取時會標示「快取」。
          Anthropic 的前段要超過約 1024～4096 tokens（依模型）才會被快取，5 分鐘內沒有再用就會失效；OpenAI、Gemini 會自動快取相同的開頭。
        </p>
        <div v-for="s in previewSections" :key="s.key" class="block" :class="s.part">
          <div class="row block-head" @click="expanded[s.key] = !expanded[s.key]">
            <span>{{ expanded[s.key] ? '▾' : '▸' }}</span>
            <strong>{{ s.title }}</strong>
            <span class="tag">{{ s.part === 'system' ? 'system・前段' : 'user・後段' }}</span>
            <span class="small muted">{{ s.text.length }} 字</span>
          </div>
          <pre v-if="expanded[s.key]">{{ s.text }}</pre>
        </div>
      </template>
    </section>

    <div class="row footer small">
      <span class="muted">提示詞設定存在這個瀏覽器，所有存檔共用。</span>
      <span class="spacer" />
      <button class="small" title="敘事規則、文風、其他提示詞、世界書的修改與判定設定，一次全部" @click="exportConfig">📤 匯出全部設定</button>
      <button class="small" title="會取代目前所有的提示詞設定" @click="fileInput?.click()">📥 匯入全部設定</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onImport" />
      <button class="small danger" @click="resetAll">全部恢復預設</button>
    </div>
  </div>
</template>

<style scoped>
.prompts { display: grid; gap: 10px; max-width: 1200px; margin: 0 auto; }
.subs { gap: 6px; }
.subs button.active { border-color: var(--accent); color: var(--accent); }
.spacer { flex: 1; }
.basis { display: flex; gap: 6px; align-items: center; }
.basis select { max-width: 340px; }
.order-note { margin: 0; line-height: 1.7; }
.settings label { display: flex; gap: 6px; align-items: center; }
.custom-length input { width: 76px; }
label.check { display: inline-flex; gap: 4px; align-items: center; }
.lore > li.off .name { color: var(--muted); }
.lore .head { gap: 6px; }
.lore .name { cursor: pointer; }
.pos { min-width: 2.6em; color: var(--accent); }
.num { width: 64px; }
.chars { min-width: 4.5em; text-align: right; }
.note { margin: 2px 0 0 3.2em; }
.status.constant { color: var(--accent); border-color: var(--accent); }
.status.triggered { color: var(--good); border-color: var(--good); }
.status.idle { color: var(--muted); }
.status.off { opacity: 0.5; }
.status.budget { color: var(--danger); border-color: var(--danger); }
.editor { display: grid; gap: 8px; margin: 8px 0 4px; }
.editor label { display: grid; gap: 4px; }
.editor label.check { display: inline-flex; }
.editor textarea { width: 100%; font-family: inherit; line-height: 1.6; }
textarea.rules { width: 100%; font-family: inherit; line-height: 1.6; box-sizing: border-box; }
.defeat-head { margin-top: 16px; gap: 6px; align-items: center; }
.defeat-head h3 { margin: 0; }
pre {
  white-space: pre-wrap; word-break: break-word; background: var(--panel-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 8px 10px; margin: 4px 0 8px; max-height: 420px; overflow: auto; font-size: 0.85rem; line-height: 1.6;
}
.data h3 { margin: 10px 0 2px; }
.sections { border-collapse: collapse; width: 100%; max-width: 640px; }
.sections th, .sections td { border-bottom: 1px solid var(--border); padding: 3px 8px; text-align: left; }
.sections tr.system td:nth-child(3) { color: var(--accent); }
.sections tfoot td { font-weight: 600; }
.block { border-left: 3px solid var(--border); padding-left: 8px; margin: 6px 0; }
.block.system { border-left-color: var(--accent); }
.block-head { cursor: pointer; gap: 6px; }
.footer { border-top: 1px solid var(--border); padding-top: 8px; }
</style>
