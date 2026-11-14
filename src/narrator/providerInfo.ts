// AI 服務的基本資料（不含 SDK，讓設定畫面不必載入各家 SDK）。

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'vertex' | 'openai_compatible'

/** 思考（推理）的強度；沒有設定時不送參數，用服務與模型的預設 */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'
/**
 * OpenAI 相容格式的思考參數（各家不一樣）：
 * reasoning_effort（OpenAI 的寫法）、thinking（智譜 GLM、Kimi：thinking.type）、openrouter（reasoning.effort）、
 * enable_thinking（通義千問）、none（不送）；auto 依 Base URL 猜。
 */
export type ReasoningFormat = 'auto' | 'reasoning_effort' | 'thinking' | 'openrouter' | 'enable_thinking' | 'none'

export interface ProviderConfig {
  apiKey: string
  model: string
  /** 只有 OpenAI 相容格式需要 */
  baseURL?: string
  /** Vertex AI 用服務帳戶 JSON 時的區域（預設 us-central1；global 也可以） */
  region?: string
  /** 留空則用各服務預設值 */
  maxTokens?: number
  /** 思考的強度（沒有設定時用預設） */
  reasoning?: ReasoningLevel
  /** OpenAI 相容格式：思考參數的寫法 */
  reasoningFormat?: ReasoningFormat
  /** 要求服務回傳思考過程（顯示在日誌裡，摺疊起來）；預設開啟 */
  showThinking?: boolean
  /** OpenAI 相容格式：額外加進請求的參數（JSON 物件） */
  extraBody?: string
  /** OpenAI 相容格式：在 system 訊息標上快取斷點（cache_control）；沒有設定時自動判斷 */
  cacheMark?: CacheMark
  /**
   * false：不用串流傳輸，等整段回答完成才一次收下（OpenAI、相容格式、Gemini 與 Vertex 的 API key；Claude 與 Vertex 服務帳戶照樣串流）。
   * 有些中轉服務會在串流途中審查、把成人內容截斷，整段收比較不會被切掉。預設串流
   */
  stream?: boolean
  /** OpenAI 相容格式：經本機版的啟動器轉送（連沒開 CORS 的服務；localProxy.ts） */
  localProxy?: boolean
}

/**
 * 快取標記：有些服務不會自動快取，要在訊息內容上標出斷點（cache_control）才會寫入快取，
 * 例如 OpenRouter 上的 Gemini 與 Claude、阿里雲百煉的通義千問顯式快取。DeepSeek、OpenAI 等會自動快取，不必標。
 * auto 依模型名稱與 Base URL 判斷；on_1h 是保留一小時（只有 Claude 支援，寫入費用較高）。
 */
export type CacheMark = 'auto' | 'on' | 'on_1h' | 'off'

export const CACHE_MARKS: { id: CacheMark; name: string }[] = [
  { id: 'auto', name: '自動（依模型判斷）' },
  { id: 'on', name: '標記（cache_control，約 5 分鐘）' },
  { id: 'on_1h', name: '標記，保留 1 小時（只有 Claude 支援）' },
  { id: 'off', name: '不標記（服務會自動快取時）' },
]

/** 自動判斷：Gemini、Claude（例如 OpenRouter 的 google/gemini-…、anthropic/claude-…），或百煉上的千問 */
export function guessCacheMark(config: Pick<ProviderConfig, 'model' | 'baseURL'>): boolean {
  const model = config.model.toLowerCase()
  if (/gemini|claude|anthropic/.test(model)) return true
  return /dashscope|aliyuncs/.test(config.baseURL ?? '') && /qwen/.test(model)
}

/** 這次請求要不要標快取斷點、保留多久（只用在 OpenAI 相容格式） */
export function cacheMarkFor(provider: ProviderId, config: ProviderConfig): { ttl?: '1h' } | null {
  if (provider !== 'openai_compatible') return null
  const mark = config.cacheMark ?? 'auto'
  if (mark === 'off' || (mark === 'auto' && !guessCacheMark(config))) return null
  return mark === 'on_1h' ? { ttl: '1h' } : {}
}

export const REASONING_LEVELS: { id: ReasoningLevel | ''; name: string }[] = [
  { id: '', name: '預設（不指定）' },
  { id: 'off', name: '關閉思考' },
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
]

export const REASONING_FORMATS: { id: ReasoningFormat; name: string }[] = [
  { id: 'auto', name: '自動（依 Base URL 判斷）' },
  { id: 'reasoning_effort', name: 'reasoning_effort（OpenAI 寫法）' },
  { id: 'thinking', name: 'thinking.type（智譜 GLM、Kimi）' },
  { id: 'openrouter', name: 'reasoning.effort（OpenRouter）' },
  { id: 'enable_thinking', name: 'enable_thinking（通義千問）' },
  { id: 'none', name: '不送思考參數' },
]

export interface ProviderInfo {
  id: ProviderId
  name: string
  defaultModel: string
  modelHints: string[]
  keyHint: string
  needsBaseURL: boolean
  /** 本機服務可以不填 key */
  keyOptional?: boolean
  /** 不能用 key 列出模型（Vertex AI 的快速模式） */
  noModelList?: boolean
  presets?: { name: string; baseURL: string }[]
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic（Claude）',
    defaultModel: 'claude-opus-5-5',
    modelHints: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    keyHint: 'sk-ant-...',
    needsBaseURL: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: '',
    modelHints: [],
    keyHint: 'sk-...',
    needsBaseURL: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-flash-latest',
    modelHints: ['gemini-flash-latest', 'gemini-pro-latest'],
    keyHint: 'AIza...',
    needsBaseURL: false,
  },
  {
    // Vertex AI 的快速模式（express mode）：用 Google Cloud 的 API key，不需要專案與服務帳號
    id: 'vertex',
    name: 'Google Vertex AI',
    defaultModel: 'gemini-2.5-flash',
    modelHints: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    keyHint: 'API key，或貼上服務帳戶的 JSON',
    needsBaseURL: false,
    noModelList: true,
  },
  {
    id: 'openai_compatible',
    name: 'OpenAI 相容格式',
    defaultModel: '',
    modelHints: [],
    keyHint: '依服務而定；本機服務可留空',
    needsBaseURL: true,
    keyOptional: true,
    presets: [
      { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
      { name: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
      { name: '智譜 GLM（BigModel）', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
      { name: '智譜 GLM（Z.ai 國際）', baseURL: 'https://api.z.ai/api/paas/v4' },
      { name: '通義千問（DashScope）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { name: 'Moonshot（Kimi）', baseURL: 'https://api.moonshot.cn/v1' },
      { name: 'Ollama（本機）', baseURL: 'http://localhost:11434/v1' },
      { name: 'LM Studio（本機）', baseURL: 'http://localhost:1234/v1' },
    ],
  },
]

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id)!
}

/** 一次 AI 呼叫的 token 用量（輸入含快取讀寫） */
export interface TokenUsage {
  /** 輸入 tokens（含讀取快取的部分） */
  input: number
  output: number
  /** 輸入中從提示詞快取讀取的部分 */
  cached?: number
}

// ---- 思考參數（各家的寫法） ----

/** OpenAI 相容格式：依 Base URL 猜思考參數的寫法 */
export function guessReasoningFormat(baseURL = ''): Exclude<ReasoningFormat, 'auto'> {
  const u = baseURL.toLowerCase()
  if (u.includes('openrouter.ai')) return 'openrouter'
  if (u.includes('bigmodel.cn') || u.includes('z.ai') || u.includes('moonshot')) return 'thinking'
  if (u.includes('dashscope')) return 'enable_thinking'
  if (u.includes('deepseek')) return 'none'
  return 'reasoning_effort'
}

/** 自訂參數（JSON 物件）；格式不對時丟出錯誤 */
export function parseExtraBody(text?: string): Record<string, unknown> {
  if (!text?.trim()) return {}
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error('自訂請求參數不是有效的 JSON')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('自訂請求參數要是 JSON 物件，例如 {"thinking": {"type": "enabled"}}')
  return v as Record<string, unknown>
}

/** OpenAI 與相容格式：加進請求的思考參數（加上自訂參數） */
export function openAIReasoningBody(provider: ProviderId, config: ProviderConfig): Record<string, unknown> {
  const level = config.reasoning
  const show = config.showThinking !== false
  let body: Record<string, unknown> = {}
  if (provider === 'openai') {
    // OpenAI 的 Chat Completions 不回傳思考內容，只能調強度
    if (level) body = { reasoning_effort: level === 'off' ? 'minimal' : level }
    return body
  }
  const format = !config.reasoningFormat || config.reasoningFormat === 'auto' ? guessReasoningFormat(config.baseURL) : config.reasoningFormat
  switch (format) {
    case 'reasoning_effort':
      if (level && level !== 'off') body = { reasoning_effort: level }
      break
    case 'thinking':
      if (level) body = { thinking: { type: level === 'off' ? 'disabled' : 'enabled' } }
      break
    case 'openrouter':
      if (level === 'off') body = { reasoning: { enabled: false } }
      else if (level) body = { reasoning: { effort: level, ...(show ? {} : { exclude: true }) } }
      else if (!show) body = { reasoning: { exclude: true } }
      break
    case 'enable_thinking':
      if (level) body = { enable_thinking: level !== 'off' }
      break
  }
  return { ...body, ...parseExtraBody(config.extraBody) }
}

/** Claude：自適應思考的模型（Claude 5 系列、4.6 之後） */
const CLAUDE_ADAPTIVE = /claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/
/** 預設就會思考的模型（Claude 5 系列） */
const CLAUDE_THINKS_BY_DEFAULT = /claude-(opus|sonnet|haiku|fable|mythos)-5/
/** 不能關閉思考的模型 */
const CLAUDE_ALWAYS_THINKS = /claude-(opus-5-5|fable|mythos)/
const CLAUDE_BUDGET: Record<Exclude<ReasoningLevel, 'off'>, number> = { low: 2048, medium: 8192, high: 16384 }

/** Claude：思考的參數（thinking、output_config.effort）；回傳空物件時不送 */
export function anthropicThinking(config: ProviderConfig): Record<string, unknown> {
  const level = config.reasoning
  const show = config.showThinking !== false
  const model = config.model
  if (CLAUDE_ADAPTIVE.test(model)) {
    if (level === 'off') return CLAUDE_ALWAYS_THINKS.test(model) ? {} : { thinking: { type: 'disabled' } }
    // 思考內容預設不回傳（display: omitted），要顯示時要求摘要
    const thinking = level || CLAUDE_THINKS_BY_DEFAULT.test(model) ? { thinking: { type: 'adaptive', display: show ? 'summarized' : 'omitted' } } : {}
    return { ...thinking, ...(level ? { output_config: { effort: level } } : {}) }
  }
  // 舊的模型：指定思考的預算（要小於 max_tokens）
  if (!level || level === 'off') return {}
  return { thinking: { type: 'enabled', budget_tokens: CLAUDE_BUDGET[level] } }
}

const GEMINI_BUDGET: Record<ReasoningLevel, number> = { off: 0, low: 1024, medium: 8192, high: 24576 }

/** Gemini：thinkingConfig（includeThoughts 回傳思考摘要；Gemini 3 用 thinkingLevel） */
export function geminiThinking(config: ProviderConfig): Record<string, unknown> | undefined {
  const level = config.reasoning
  const show = config.showThinking !== false
  if (!level && !show) return undefined
  const out: Record<string, unknown> = {}
  if (show && level !== 'off') out.includeThoughts = true
  if (level) {
    if (/gemini-3/.test(config.model)) out.thinkingLevel = level === 'high' || level === 'medium' ? 'high' : 'low'
    else out.thinkingBudget = GEMINI_BUDGET[level]
  }
  return Object.keys(out).length ? out : undefined
}
