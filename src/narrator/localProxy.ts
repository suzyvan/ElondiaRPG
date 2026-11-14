// 本機版內建轉送（docs/PROMPTS.md「本機轉送」）：本機版的啟動器（release/local 的 server.py、start-windows.ps1）
// 在 http://localhost:8473/proxy/ 提供轉送，請求從玩家自己的電腦送到服務，不經瀏覽器的跨域檢查（CORS）。
// 給沒開 CORS 的 OpenAI 相容服務（部分中轉站）用；線上版（GitHub Pages 只能放靜態檔案）沒有這個功能。
// 轉送的網址：/proxy/<http 或 https>/<主機[:port]>/<路徑>?<參數>；請求要帶 X-Elondia-Proxy: 1（別的網站送不出這個標頭，不能借用）。

export const PROXY_HEADER = 'X-Elondia-Proxy'

/** 遊戲現在是不是從本機開的（本機版或自己跑的伺服器） */
export function onLocalhost(loc: Pick<Location, 'hostname'> | undefined = typeof location === 'undefined' ? undefined : location): boolean {
  const h = loc?.hostname ?? ''
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

/** 服務的網址換成經本機轉送的網址；格式不對時照原樣 */
export function proxiedURL(target: string, origin: string = typeof location === 'undefined' ? '' : location.origin): string {
  let u: URL
  try {
    u = new URL(target.trim())
  } catch {
    return target
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return target
  const path = u.pathname.replace(/\/+$/, '')
  return `${origin}/proxy/${u.protocol.slice(0, -1)}/${u.host}${path}${u.search}`
}

/** 本機轉送能不能用：啟動器回應 /proxy/ping（線上版、舊版啟動器、自己跑的伺服器都不能） */
export async function localProxyAvailable(): Promise<boolean> {
  if (!onLocalhost()) return false
  try {
    const res = await fetch(`${location.origin}/proxy/ping`, { headers: { [PROXY_HEADER]: '1' }, cache: 'no-store' })
    if (!res.ok) return false
    const body = (await res.json()) as { elondiaProxy?: boolean }
    return body.elondiaProxy === true
  } catch {
    return false
  }
}
