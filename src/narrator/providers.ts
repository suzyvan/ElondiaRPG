// AI 服務：Anthropic、OpenAI、Google Gemini、Vertex AI（API key 或服務帳戶 JSON），以及 OpenAI 相容格式（OpenRouter、DeepSeek、本機 Ollama 等）。
// API key 由玩家自行輸入，只存在瀏覽器的 localStorage，請求直接從瀏覽器送到各服務。

// 各家 SDK 在用到時才載入，只會下載玩家選用的那一家
import { hasItemKey, stripItemKeys } from '@/engine/itemKey'
import { explainConnection } from './connectionHint'
import type { Prompt } from './prompt'
import { PROXY_HEADER, proxiedURL } from './localProxy'
import { listVertexModels, parseServiceAccount, streamVertexService, vertexBody } from './vertexAuth'
import { anthropicThinking, cacheMarkFor, geminiThinking, openAIReasoningBody, type ProviderConfig, type ProviderId, type TokenUsage } from './providerInfo'

export type { ProviderConfig, ProviderId, TokenUsage }
export type UsageCallback = (usage: TokenUsage) => void
/** 模型的思考過程（服務有回傳時，逐段呼叫） */
export type ThinkingCallback = (text: string) => void

export class NarrationRefusedError extends Error {
  constructor(detail?: string) {
    super(`模型拒絕了這次請求${detail ? `（${detail}）` : ''}`)
  }
}

// 支援伺服器端拒絕備援（fallbacks: "default"）的 Claude 模型
const CLAUDE_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'])
const CLAUDE_DEFAULT_MAX_TOKENS = 64000

/** 以串流方式產生敘事，逐段回傳文字。服務回報 token 用量時呼叫 onUsage，回傳思考過程時呼叫 onThinking。 */
export async function* streamNarration(
  provider: ProviderId,
  config: ProviderConfig,
  prompt: Prompt,
  signal?: AbortSignal,
  onUsage?: UsageCallback,
  onThinking?: ThinkingCallback,
): AsyncGenerator<string> {
  if (!config.model) throw new Error('請先在設定中選擇模型')
  // 自訂裝備的名字帶著看不見的雜湊（engine/itemKey.ts）：送出去之前拿掉，AI 只看到顯示的名字
  prompt = withoutItemKeys(prompt)
  try {
    switch (provider) {
      case 'anthropic':
        yield* streamAnthropic(config, prompt, signal, onUsage, onThinking)
        return
      case 'openai':
      case 'openai_compatible':
        yield* streamOpenAI(provider, config, prompt, signal, onUsage, onThinking)
        return
      case 'gemini':
      case 'vertex':
        yield* streamGemini(provider, config, prompt, signal, onUsage, onThinking)
        return
    }
  } catch (e) {
    // 連不上服務：補上可能的原因（服務沒開、網址錯、跨域被擋……）；取消的不改
    throw signal?.aborted ? e : explainConnection(e, provider, config)
  }
}

/** 提示詞裡物品名字的雜湊都拿掉（沒有時原樣傳回） */
export function withoutItemKeys(prompt: Prompt): Prompt {
  const text = [prompt.system, prompt.user, ...(prompt.sections ?? []).map((x) => x.text)]
  if (!text.some(hasItemKey)) return prompt
  return {
    ...prompt,
    system: stripItemKeys(prompt.system),
    user: stripItemKeys(prompt.user),
    ...(prompt.sections ? { sections: prompt.sections.map((x) => ({ ...x, text: stripItemKeys(x.text) })) } : {}),
  }
}

async function anthropicClient(config: ProviderConfig) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
}

/** Gemini API（AI Studio）或 Vertex AI 的快速模式（同一個 SDK，用 API key 連 aiplatform.googleapis.com） */
async function geminiClient(provider: 'gemini' | 'vertex', config: ProviderConfig) {
  const { GoogleGenAI } = await import('@google/genai')
  return new GoogleGenAI({ apiKey: config.apiKey, ...(provider === 'vertex' ? { vertexai: true } : {}) })
}

async function* streamAnthropic(config: ProviderConfig, prompt: Prompt, signal?: AbortSignal, onUsage?: UsageCallback, onThinking?: ThinkingCallback) {
  const client = await anthropicClient(config)
  const thinking = anthropicThinking(config)
  const budget = (thinking.thinking as { budget_tokens?: number } | undefined)?.budget_tokens ?? 0
  const params = {
    model: config.model,
    // 指定思考預算的舊模型：max_tokens 要比預算大
    max_tokens: Math.max(config.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS, budget ? budget + 4096 : 0),
    ...thinking,
    // system 只放不太變動的內容（規則、常駐世界書、文風），在這裡設快取斷點：
    // 下一次請求的 system 相同時直接讀快取，輸入費用與延遲都會下降
    system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: prompt.user }],
  }
  // 支援的模型開啟伺服器端備援：被安全分類器拒絕時，自動改由建議的備援模型完成
  // 思考參數（display、output_config）依模型而定，SDK 的型別不一定跟得上，交給服務檢查
  type Params = Parameters<typeof client.messages.stream>[0]
  const stream = CLAUDE_FALLBACK_MODELS.has(config.model)
    ? client.beta.messages.stream(
        { ...(params as Params), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as Parameters<typeof client.beta.messages.stream>[0],
        { signal },
      )
    : client.messages.stream(params as Params, { signal })
  for await (const event of stream) {
    if (event.type !== 'content_block_delta') continue
    if (event.delta.type === 'text_delta') yield event.delta.text
    else if (event.delta.type === 'thinking_delta' && event.delta.thinking) onThinking?.(event.delta.thinking)
  }
  const final = await stream.finalMessage()
  const u = final.usage
  onUsage?.({
    input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens,
    cached: u.cache_read_input_tokens ?? 0,
  })
  if (final.stop_reason === 'refusal') {
    throw new NarrationRefusedError(final.stop_details?.category ?? undefined)
  }
}

async function openAIClient(provider: ProviderId, config: ProviderConfig) {
  const { default: OpenAI } = await import('openai')
  // 經本機版轉送：Base URL 換成 http://localhost:8473/proxy/...，請求從玩家的電腦送出（不受瀏覽器的 CORS 限制）
  const viaProxy = provider === 'openai_compatible' && !!config.localProxy && !!config.baseURL
  return new OpenAI({
    // OpenAI SDK 一定要有 key；本機服務不檢查，給個佔位字串
    apiKey: config.apiKey || 'not-needed',
    ...(provider === 'openai_compatible' ? { baseURL: viaProxy ? proxiedURL(config.baseURL!) : config.baseURL } : {}),
    ...(viaProxy ? { defaultHeaders: { [PROXY_HEADER]: '1' } } : {}),
    dangerouslyAllowBrowser: true,
  })
}

async function* streamOpenAI(provider: ProviderId, config: ProviderConfig, prompt: Prompt, signal?: AbortSignal, onUsage?: UsageCallback, onThinking?: ThinkingCallback) {
  if (provider === 'openai_compatible' && !config.baseURL) throw new Error('請填寫 Base URL')
  const client = await openAIClient(provider, config)
  // 思考參數與自訂參數：各家的欄位不同，直接放進請求內容
  const extra = openAIReasoningBody(provider, config)
  // 不串流：設定關掉，或自訂參數寫了 "stream": false（之前會被後面的 stream: true 蓋掉）
  const noStream = config.stream === false || extra.stream === false
  delete extra.stream
  const body = {
    ...extra,
    model: config.model,
    messages: openAIMessages(provider, config, prompt),
    ...(config.maxTokens
      ? provider === 'openai'
        ? { max_completion_tokens: config.maxTokens }
        : { max_tokens: config.maxTokens }
      : {}),
  }
  if (noStream) {
    const res = await client.chat.completions.create({ ...body, stream: false }, { signal })
    if (res.usage) onUsage?.({ input: res.usage.prompt_tokens, output: res.usage.completion_tokens, cached: res.usage.prompt_tokens_details?.cached_tokens ?? 0 })
    const choice = res.choices[0]
    const msg = choice?.message as { content?: string | null; reasoning_content?: string; reasoning?: string } | undefined
    const thought = msg?.reasoning_content ?? msg?.reasoning
    if (thought) onThinking?.(thought)
    if (choice?.finish_reason === 'content_filter' && !msg?.content) throw new NarrationRefusedError('content_filter')
    if (msg?.content) yield msg.content
    if (choice?.finish_reason === 'content_filter') throw new NarrationRefusedError('content_filter')
    return
  }
  const stream = await client.chat.completions.create(
    {
      ...body,
      stream: true,
      // OpenAI 要明確要求才會在最後一段回報用量；相容服務不一定支援這個參數，有回報時才記錄
      ...(provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
    },
    { signal },
  )
  for await (const chunk of stream) {
    if (chunk.usage) {
      onUsage?.({
        input: chunk.usage.prompt_tokens,
        output: chunk.usage.completion_tokens,
        cached: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
      })
    }
    const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string; reasoning?: string } | undefined
    // 思考過程：DeepSeek、GLM、千問是 reasoning_content，OpenRouter 是 reasoning
    const thought = delta?.reasoning_content ?? delta?.reasoning
    if (thought) onThinking?.(thought)
    const text = delta?.content
    if (text) yield text
    if (chunk.choices[0]?.finish_reason === 'content_filter') throw new NarrationRefusedError('content_filter')
  }
}

/**
 * OpenAI 格式的訊息。需要手動標記快取的服務（見 providerInfo.ts 的 cacheMarkFor）：
 * system 改成內容陣列，在結尾標上 cache_control 斷點；system 只放不太變動的內容，下一次請求就能讀快取
 */
export function openAIMessages(provider: ProviderId, config: ProviderConfig, prompt: Prompt) {
  const mark = cacheMarkFor(provider, config)
  // SDK 的型別沒有 cache_control（OpenRouter、百煉的擴充），整個訊息陣列交給服務檢查
  type Messages = { role: 'system' | 'user'; content: string }[]
  const system = mark
    ? { role: 'system', content: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral', ...mark } }] }
    : { role: 'system', content: prompt.system }
  return [system, { role: 'user', content: prompt.user }] as unknown as Messages
}

async function* streamGemini(provider: 'gemini' | 'vertex', config: ProviderConfig, prompt: Prompt, signal?: AbortSignal, onUsage?: UsageCallback, onThinking?: ThinkingCallback) {
  const thinkingConfig = geminiThinking(config)
  // Vertex AI 的服務帳戶 JSON（和 SillyTavern 的完整模式一樣）：SDK 的瀏覽器版只收 API key，改打 REST
  const sa = provider === 'vertex' ? parseServiceAccount(config.apiKey) : undefined
  const ai = sa ? undefined : await geminiClient(provider, config)
  const request = {
    model: config.model,
    contents: prompt.user,
    config: {
      systemInstruction: prompt.system,
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(config.maxTokens ? { maxOutputTokens: config.maxTokens } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    },
  }
  // 不串流（API key 才有；服務帳戶照樣串流）：整段收下，當成只有一段的串流處理
  async function* once() { yield await ai!.models.generateContent(request) }
  const stream = sa ? streamVertexService(sa, config, vertexBody(config, prompt.system, prompt.user, thinkingConfig), signal)
    : config.stream === false ? once() : await ai!.models.generateContentStream(request)
  let usage: TokenUsage | undefined
  for await (const chunk of stream) {
    // 每一段都帶著累計的用量，取最後一段
    const m = chunk.usageMetadata
    if (m) usage = { input: m.promptTokenCount ?? 0, output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0), cached: m.cachedContentTokenCount ?? 0 }
    // 思考摘要是 thought 為 true 的部分，其餘是正文
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (!part.text) continue
      if (part.thought) onThinking?.(part.text)
      else yield part.text
    }
    if (chunk.promptFeedback?.blockReason) throw new NarrationRefusedError(String(chunk.promptFeedback.blockReason))
  }
  if (usage) onUsage?.(usage)
}

/** 向服務查詢可用的模型清單。 */
export async function listModels(provider: ProviderId, config: ProviderConfig): Promise<string[]> {
  try {
    return await listModelsRaw(provider, config)
  } catch (e) {
    throw explainConnection(e, provider, config)
  }
}

async function listModelsRaw(provider: ProviderId, config: ProviderConfig): Promise<string[]> {
  const ids: string[] = []
  switch (provider) {
    case 'anthropic': {
      const client = await anthropicClient(config)
      for await (const m of client.models.list()) ids.push(m.id)
      break
    }
    case 'openai':
    case 'openai_compatible': {
      const client = await openAIClient(provider, config)
      for await (const m of client.models.list()) ids.push(m.id)
      break
    }
    case 'vertex': {
      // 列出模型的 API 只收 OAuth：服務帳戶可以列，API key 不行（用「測試連線」確認 key 與模型名稱）
      const sa = parseServiceAccount(config.apiKey)
      if (!sa) throw new Error('Vertex AI 的 API key 不能列出模型，請直接輸入模型名稱（例如 gemini-2.5-flash），再按「測試連線」')
      ids.push(...(await listVertexModels(sa, config.region)))
      break
    }
    case 'gemini': {
      const ai = await geminiClient(provider, config)
      const pager = await ai.models.list()
      for await (const m of pager) {
        if (m.name && (m.supportedActions ?? ['generateContent']).includes('generateContent')) {
          ids.push(m.name.replace(/^models\//, ''))
        }
      }
      break
    }
  }
  return ids.sort()
}

/** 不串流顯示、只要完整文字時使用（AI 判定、角色潤飾）。 */
export async function completeText(
  provider: ProviderId, config: ProviderConfig, prompt: Prompt, signal?: AbortSignal, onUsage?: UsageCallback, onThinking?: ThinkingCallback,
  /** 每收到一段文字（例如用來重設「太久沒有回應」的計時） */
  onChunk?: (chunk: string) => void,
): Promise<string> {
  let text = ''
  for await (const chunk of streamNarration(provider, config, prompt, signal, onUsage, onThinking)) {
    text += chunk
    onChunk?.(chunk)
  }
  return text
}

/**
 * 測試連線：用設定的 key 與模型送一個很短的請求（不能列出模型的服務用，例如 Vertex AI 的 API key）。
 * 成功時回傳模型的回答（可能是空的：思考用掉了全部的輸出額度也算連得上）
 */
export async function testConnection(provider: ProviderId, config: ProviderConfig): Promise<string> {
  const text = await completeText(provider, { ...config, maxTokens: 256, showThinking: false }, { system: '這是連線測試。', user: '請只回答「OK」。' })
  return text.trim()
}

