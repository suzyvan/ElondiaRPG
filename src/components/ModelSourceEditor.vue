<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { localProxyAvailable, onLocalhost } from '@/narrator/localProxy'
import {
  CACHE_MARKS, guessCacheMark, guessReasoningFormat, parseExtraBody, providerInfo, PROVIDERS, REASONING_FORMATS, REASONING_LEVELS, type ProviderId, type ReasoningLevel,
} from '@/narrator/providerInfo'
import { parseServiceAccount, VERTEX_DEFAULT_REGION } from '@/narrator/vertexAuth'
import { AI_FEATURES, useSettings } from '@/stores/settings'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'

// 一個模型來源的設定：服務、key、模型、最大輸出 tokens
const props = defineProps<{ index: number }>()
const settings = useSettings()
const source = computed(() => settings.sources[props.index]!)
const info = computed(() => providerInfo(source.value.provider))
const cfg = computed(() => source.value.configs[source.value.provider])
const used = computed(() => AI_FEATURES.filter((f) => settings.routes[f.id] === props.index).map((f) => f.name))

// 載入的模型清單依服務分開保存，切換服務再切回來不必重新載入
const loaded = ref<Partial<Record<ProviderId, string[]>>>({})
const models = computed(() => loaded.value[source.value.provider] ?? [])
const hints = computed(() => info.value.modelHints.filter((m) => !models.value.includes(m)))
const known = computed(() => [...hints.value, ...models.value])
const loading = ref(false)
const message = ref('')
const showKey = ref(false)

async function loadModels() {
  loading.value = true
  message.value = ''
  try {
    const { listModels } = await import('@/narrator/providers')
    const provider = source.value.provider
    loaded.value[provider] = await listModels(provider, cfg.value)
    message.value = `連線成功，共 ${loaded.value[provider]!.length} 個模型，可以從下拉選單選擇。`
  } catch (e) {
    message.value = `連線失敗：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}

// Vertex AI：key 欄位也可以貼服務帳戶的 JSON（SillyTavern 的「完整模式」），或直接選 JSON 檔
const serviceAccount = computed(() => (source.value.provider === 'vertex' ? parseServiceAccount(cfg.value.apiKey) : undefined))
async function loadJson(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  if (!parseServiceAccount(text)) {
    message.value = '這不是服務帳戶的金鑰檔（要有 client_email、private_key、project_id）'
    return
  }
  cfg.value.apiKey = text.trim()
  message.value = ''
}
// 不能列出模型的服務（Vertex AI）：用選的模型送一個很短的請求，確認 key（或服務帳戶）與模型名稱都對
async function testModel() {
  loading.value = true
  message.value = ''
  try {
    const { testConnection } = await import('@/narrator/providers')
    const reply = await testConnection(source.value.provider, cfg.value)
    message.value = `連線成功：${cfg.value.model} 有回應${reply ? `（「${reply.slice(0, 20)}」）` : ''}。`
  } catch (e) {
    message.value = `連線失敗：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}

function pickModel(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v) cfg.value.model = v
}

function onMaxTokens(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  cfg.value.maxTokens = v > 0 ? v : undefined
}

// ---- 思考（推理） ----
const reasoning = computed({
  get: () => cfg.value.reasoning ?? '',
  set: (v: string) => {
    if (v) cfg.value.reasoning = v as ReasoningLevel
    else delete cfg.value.reasoning
  },
})
// 經本機版轉送（localProxy.ts）：只有 OpenAI 相容格式；本機版的啟動器有回應時才能用
const proxyOk = ref<boolean | null>(null)
onMounted(async () => { if (onLocalhost()) proxyOk.value = await localProxyAvailable() })
const viaProxy = computed({
  get: () => !!cfg.value.localProxy,
  set: (v: boolean) => {
    if (v) cfg.value.localProxy = true
    else delete cfg.value.localProxy
  },
})
const streaming = computed({
  get: () => cfg.value.stream !== false,
  set: (v: boolean) => {
    if (v) delete cfg.value.stream
    else cfg.value.stream = false
  },
})
const showThinking = computed({
  get: () => cfg.value.showThinking !== false,
  set: (v: boolean) => {
    if (v) delete cfg.value.showThinking
    else cfg.value.showThinking = false
  },
})
const guessed = computed(() => REASONING_FORMATS.find((f) => f.id === guessReasoningFormat(cfg.value.baseURL))?.name ?? '')
// 快取標記：自動時依模型判斷
const cacheGuess = computed(() => (guessCacheMark(cfg.value) ? '標記（這個模型要手動標記才會快取）' : '不標記（這個模型會自動快取，或不支援）'))
const extraError = computed(() => {
  try {
    parseExtraBody(cfg.value.extraBody)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
})
const REASONING_NOTE: Record<ProviderId, string> = {
  anthropic: 'Claude 5 系列與 4.6 之後的模型用自適應思考（強度是 effort）；舊模型用思考預算。Opus 5.5 不能關閉思考。',
  openai: 'reasoning_effort（推理模型才有效；關閉對應 minimal）。OpenAI 不回傳思考內容。',
  gemini: 'thinkingBudget（Gemini 3 用 thinkingLevel）；部分 Pro 模型不能關閉思考。',
  vertex: 'thinkingBudget（Gemini 3 用 thinkingLevel）；部分 Pro 模型不能關閉思考。',
  openai_compatible: '各家的參數不同，依下方的「參數格式」送出；服務要求的其他參數可以寫在「自訂請求參數」。',
}

function copyFrom(e: Event) {
  const from = Number((e.target as HTMLSelectElement).value)
  ;(e.target as HTMLSelectElement).value = ''
  if (Number.isInteger(from) && confirm(`用「${settings.sources[from]!.name}」的設定（服務、key、模型）覆蓋「${source.value.name}」？`)) {
    settings.copySource(from, props.index)
  }
}
</script>

<template>
  <div class="form">
    <div class="row">
      <label class="grow">
        名稱
        <input v-model="source.name" maxlength="20" />
      </label>
      <label>
        複製其他來源
        <select @change="copyFrom">
          <option value="">選擇…</option>
          <template v-for="(s, i) in settings.sources" :key="i">
            <option v-if="i !== index" :value="i">{{ s.name }}</option>
          </template>
        </select>
      </label>
    </div>

    <label>
      服務
      <select v-model="source.provider" @change="message = ''">
        <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <label v-if="info.needsBaseURL">
      Base URL
      <input v-model="cfg.baseURL" placeholder="https://.../v1" />
      <span class="row">
        <button v-for="p in info.presets" :key="p.name" class="small" @click="cfg.baseURL = p.baseURL">{{ p.name }}</button>
      </span>
    </label>

    <label>
      {{ source.provider === 'vertex' ? 'API key 或服務帳戶 JSON' : 'API key' }}{{ info.keyOptional ? '（選填）' : '' }}
      <span class="row">
        <input v-model="cfg.apiKey" :type="showKey ? 'text' : 'password'" :placeholder="info.keyHint" autocomplete="off" style="flex: 1" />
        <button class="small" @click="showKey = !showKey">{{ showKey ? '隱藏' : '顯示' }}</button>
        <label v-if="source.provider === 'vertex'" class="small file-btn">選擇 JSON 檔<input type="file" accept=".json,application/json" hidden @change="loadJson" /></label>
      </span>
    </label>
    <template v-if="serviceAccount">
      <p class="small">服務帳戶：{{ serviceAccount.client_email }}・專案 {{ serviceAccount.project_id }}</p>
      <label>
        <span class="lab">區域 <Hint text="Vertex AI 的區域，預設 us-central1；新模型（例如 Gemini 3 的預覽版）有時只在 global。" /></span>
        <span class="row">
          <input v-model.trim="cfg.region" :placeholder="VERTEX_DEFAULT_REGION" style="width: 180px" />
          <button class="small" @click="cfg.region = 'global'">global</button>
        </span>
      </label>
    </template>

    <div class="field">
      <span>模型</span>
      <span class="row">
        <select :value="known.includes(cfg.model) ? cfg.model : ''" style="flex: 1; min-width: 0" @change="pickModel">
          <option value="" disabled>{{ cfg.model ? `自訂：${cfg.model}` : '選擇模型' }}</option>
          <optgroup v-if="hints.length" label="常用">
            <option v-for="m in hints" :key="m" :value="m">{{ m }}</option>
          </optgroup>
          <optgroup v-if="models.length" :label="`服務提供的模型（${models.length}）`">
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </optgroup>
        </select>
        <button v-if="!info.noModelList || serviceAccount" class="small" :disabled="loading || (!cfg.apiKey && !info.keyOptional)" @click="loadModels">
          {{ loading ? '載入中…' : '載入模型清單' }}
        </button>
        <button v-if="info.noModelList" class="small" :disabled="loading || !cfg.apiKey || !cfg.model" title="用選的模型送一個很短的請求，確認 key 與模型名稱" @click="testModel">
          {{ loading ? '測試中…' : '測試連線' }}
        </button>
      </span>
      <input v-model.trim="cfg.model" placeholder="或直接輸入模型名稱" aria-label="模型名稱" />
    </div>
    <p v-if="source.provider === 'vertex'" class="small muted">
      兩種用法：① API key（快速模式）：在 Google Cloud 主控台建立 API key 並啟用 Vertex AI API。② 服務帳戶 JSON（和 SillyTavern 的 Vertex AI「完整模式」一樣，例如用贈金的專案）：在主控台的「IAM 與管理 → 服務帳戶」建立帳戶、給它「Vertex AI 使用者」角色，新增 JSON 金鑰，把檔案選進來或整段貼上。JSON 只存在這台瀏覽器，請求直接從瀏覽器送到 Google。服務帳戶可以「載入模型清單」；API key 不能列出模型（Google 的清單 API 只收 OAuth），請直接輸入模型名稱（Vertex 沒有 gemini-flash-latest 這類別名，要寫完整的版本，例如 gemini-2.5-flash）。兩種都可以按「測試連線」，用選的模型送一個很短的請求，確認 key 和模型名稱都對。
    </p>
    <p v-if="message" class="small">{{ message }}</p>

    <label>
      <span class="lab">最大輸出 tokens（選填） <Hint text="留空用服務的預設值。" /></span>
      <input type="number" min="0" :value="cfg.maxTokens ?? ''" style="width: 140px" @input="onMaxTokens" />
    </label>

    <template v-if="source.provider === 'openai_compatible'">
      <label class="check">
        <input id="model-local-proxy" v-model="viaProxy" type="checkbox" :disabled="!viaProxy && proxyOk !== true" /> 經本機版轉送（連不上沒開 CORS 的服務時用）
        <Hint :width="340" text="有些中轉站不允許網頁直接連（沒開 CORS），瀏覽器會擋下請求，只看到「Connection error」。用本機版的啟動器開遊戲時，可以勾這個：請求改由你自己電腦上的啟動器轉送給服務，不經過任何第三方，key 也只送到那個服務。線上版（GitHub Pages）只能放靜態檔案，沒有轉送。" />
      </label>
      <p v-if="!onLocalhost() || proxyOk === false || (viaProxy && proxyOk !== true)" class="small muted">
        {{ onLocalhost() ? '偵測不到本機轉送：請用新版本機版的啟動器（Start-Windows.bat、Start-macOS.command、start.sh）開遊戲。' : '本機轉送只有本機版能用：到 Releases 下載本機版，用啟動器開遊戲。' }}
      </p>
    </template>

    <label v-if="source.provider !== 'anthropic'" class="check">
      <input v-model="streaming" type="checkbox" /> 串流傳輸（邊產生邊顯示）
      <Hint :width="320" text="關掉後等整段回答完成才一次顯示。有些中轉服務會在串流途中審查、把成人內容截斷，關掉串流比較不會被切掉；代價是要等比較久才看到文字。Vertex AI 用服務帳戶 JSON 時照樣串流。自訂請求參數寫 &quot;stream&quot;: false 也一樣。" />
    </label>

    <fieldset class="reasoning">
      <legend>思考（reasoning）</legend>
      <label>
        思考強度
        <select v-model="reasoning">
          <option v-for="r in REASONING_LEVELS" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <p class="small muted">{{ REASONING_NOTE[source.provider] }}</p>
      <label v-if="source.provider === 'openai_compatible'">
        參數格式
        <select v-model="cfg.reasoningFormat">
          <option v-for="f in REASONING_FORMATS" :key="f.id" :value="f.id === 'auto' ? undefined : f.id">{{ f.name }}</option>
        </select>
        <span v-if="!cfg.reasoningFormat || cfg.reasoningFormat === 'auto'" class="small muted">目前判斷為：{{ guessed }}</span>
      </label>
      <label class="check"><input v-model="showThinking" type="checkbox" /> 在日誌顯示思考過程 <Hint text="摺疊顯示；服務有回傳思考過程時才有。" /></label>
      <label v-if="source.provider === 'openai_compatible'">
        <span class="lab">自訂請求參數（JSON，選填） <Hint text='會直接加進請求，例如 {"thinking": {"type": "enabled"}}。' /></span>
        <textarea v-model="cfg.extraBody" rows="2" spellcheck="false" placeholder='{"reasoning": {"enabled": true}}' />
        <span v-if="extraError" class="small" style="color: var(--danger)">{{ extraError }}</span>
      </label>
      <label v-if="source.provider === 'openai_compatible'">
        <span class="lab">提示詞快取標記
          <Hint :width="320" text="有些服務要在請求裡標出快取斷點（cache_control）才會快取，例如 OpenRouter 上的 Gemini 與 Claude、阿里雲百煉的通義千問；DeepSeek、OpenAI 會自動快取。標在不太變動的 system 部分；Gemini 要 system 超過約 4096 tokens 才會寫入快取，判定請求的 system 較短，通常只有敘事請求用得到。命中時日誌的用量會顯示「快取」。" />
        </span>
        <select v-model="cfg.cacheMark">
          <option v-for="c in CACHE_MARKS" :key="c.id" :value="c.id === 'auto' ? undefined : c.id">{{ c.name }}</option>
        </select>
        <span v-if="!cfg.cacheMark || cfg.cacheMark === 'auto'" class="small muted">目前判斷為：{{ cacheGuess }}</span>
      </label>
    </fieldset>

    <p class="small status" :style="{ color: settings.sourceReady(index) ? 'var(--good)' : 'var(--muted)' }">
      <GameIcon v-if="settings.sourceReady(index)" name="check" :size="14" />{{ settings.sourceReady(index) ? '設定完成' : '尚未完成設定' }}・{{ used.length ? `用於：${used.join('、')}` : '目前沒有功能使用這個來源' }}
    </p>
  </div>
</template>

<style scoped>
.form { display: grid; gap: 12px; max-width: 560px; }
.form label, .form .field { display: grid; gap: 4px; }
.grow { flex: 1; }
.reasoning { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; display: grid; gap: 8px; }
.reasoning legend { color: var(--accent); padding: 0 4px; }
.reasoning textarea { width: 100%; font-family: monospace; }
.lab, .status { display: flex; align-items: center; gap: 4px; }
label.check { display: inline-flex !important; gap: 6px; align-items: center; }
.file-btn { cursor: pointer; border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 8px; white-space: nowrap; }
</style>
