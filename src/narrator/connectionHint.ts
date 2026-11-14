// 連不上 AI 服務時的說明：SDK 只會說「Connection error.」、瀏覽器只會說「Failed to fetch」，
// 玩家看不出是服務沒開、網址錯、還是被瀏覽器擋了（跨域 CORS、區域網路存取、混合內容）。
// 依網址補上可能的原因與怎麼查（docs/PROMPTS.md 的「連不上服務」）。

import { PROVIDERS, type ProviderConfig, type ProviderId } from './providerInfo'

/** 各家 SDK 與瀏覽器「根本沒連上」的錯誤訊息（和服務回了錯誤不同） */
const CONNECTION_ERRORS = [
  /^connection error\.?$/i, // OpenAI、Anthropic SDK 的 APIConnectionError
  /failed to fetch/i, // Chrome
  /networkerror when attempting to fetch/i, // Firefox
  /^load failed$/i, // Safari
  /fetch failed/i, // Node 與部分 SDK
  /network request failed/i,
  /err_connection_refused|econnrefused/i,
]

export function isConnectionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return CONNECTION_ERRORS.some((re) => re.test(msg.trim()))
}

/** Base URL 不是 http:// 或 https:// 開頭的完整網址（例如少打了 http://） */
function badBaseURL(baseURL: string | undefined): boolean {
  const u = baseURL?.trim()
  if (!u) return false
  try {
    return !/^https?:$/.test(new URL(u).protocol)
  } catch {
    return true
  }
}

function badBaseURLText(baseURL: string): string {
  return `Base URL 的格式不對（${baseURL.trim()}）：要寫完整的網址，開頭要有 http:// 或 https://，例如 http://127.0.0.1:3066/v1。`
}

/** 本機或區域網路的位址 */
function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.local') || h === '::1' || h === '0.0.0.0'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
}

/**
 * 給玩家看的說明（不是連線問題時是 undefined）。pageProtocol：遊戲網頁本身的協定（網頁版是 https:）
 */
export function connectionHint(provider: ProviderId, config: Pick<ProviderConfig, 'baseURL'>, pageProtocol = typeof location === 'undefined' ? '' : location.protocol): string {
  const name = PROVIDERS.find((p) => p.id === provider)?.name ?? provider
  const F12 = '按 F12 打開 Console 看紅字：寫 CORS policy 是被跨域擋了，寫 ERR_CONNECTION_REFUSED 是服務沒開或 port 不對，寫 private network／local network 是區域網路存取被擋。'
  if (badBaseURL(config.baseURL)) return badBaseURLText(config.baseURL!)
  const url = config.baseURL ? new URL(config.baseURL.trim()) : undefined
  if (!url) return `連不上 ${name}：檢查網路連線，以及 VPN、代理的設定；所在地區也可能連不上這個服務。`
  const where = url.host
  if (isLocalHost(url.hostname)) {
    return `連不上 ${where}：先確認服務已經啟動，網址與 port 正確（OpenAI 相容格式的 Base URL 通常以 /v1 結尾）。`
      + '服務有開卻還是連不上，多半是瀏覽器擋了跨域：服務要開啟 CORS（允許這個網站或 *，允許的標頭寫 *，並回應 OPTIONS 預檢；連本機時再加 Access-Control-Allow-Private-Network: true），'
      + 'Chrome 跳出「允許存取區域網路上的裝置」時要按允許（按掉了可以到網址列左邊的網站設定改回來）。' + F12
  }
  if (url.protocol === 'http:' && pageProtocol === 'https:') {
    return `連不上 ${where}：網頁版是 https，瀏覽器不讓它連 http 的服務（混合內容）。請改用 https 的網址，或用本機版。`
  }
  return `連不上 ${where}：確認網址正確、服務正常。也可能是這個服務不允許從瀏覽器直接連（CORS）：請服務開啟 CORS；或下載本機版，勾選模型設定的「經本機版轉送」；或改用自己的轉送代理。` + F12
}

/** 連不上服務時換成看得懂的錯誤（原本的訊息放在括號裡）；其他錯誤照原樣 */
export function explainConnection(e: unknown, provider: ProviderId, config: Pick<ProviderConfig, 'baseURL'>, pageProtocol?: string): unknown {
  // Base URL 少了 http://：SDK 直接丟英文的網址錯誤（Failed to construct 'URL'），或連到奇怪的地方
  const orig0 = e instanceof Error ? e.message : String(e)
  if (badBaseURL(config.baseURL) && (isConnectionError(e) || /invalid url|failed to construct 'url'/i.test(orig0))) {
    const out = new Error(`${badBaseURLText(config.baseURL!)}（原本的錯誤：${orig0.trim()}）`)
    out.name = 'ConnectionError'
    return out
  }
  if (!isConnectionError(e)) return e
  const orig = e instanceof Error ? e.message : String(e)
  const out = new Error(`${connectionHint(provider, config, pageProtocol)}（原本的錯誤：${orig.trim()}）`)
  out.name = 'ConnectionError'
  return out
}
