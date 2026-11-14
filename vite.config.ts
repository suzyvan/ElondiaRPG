import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Connect, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// 版本號（首頁與設定頁顯示）：照 package.json
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/**
 * @fontsource 的 CSS 每個字型切片都寫了 woff2 與舊的 woff 兩個檔案；現在的瀏覽器都支援 woff2，
 * 拿掉 woff 的那一段，建置結果少一千多個檔案（約 43 MB），GitHub Pages 同步檔案才不會逾時
 */
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null
      return { code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, ''), map: null }
    },
  }
}

/**
 * 本機轉送（和本機版啟動器 release/local/server.py 一樣，docs/PROMPTS.md「本機版轉送」）：
 * 開發時的 `pnpm dev` 與 `pnpm preview` 也能勾「經本機版轉送」測試沒開 CORS 的服務。
 * /proxy/<http|https>/<主機[:port]>/<路徑>?<參數> 轉給服務；要帶 X-Elondia-Proxy: 1，有 Origin 時要是這個開發伺服器
 */
function localRelay(): Plugin {
  const SKIP_REQUEST = new Set(['host', 'origin', 'referer', 'cookie', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'x-elondia-proxy', 'expect'])
  const SKIP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'trailer', 'upgrade', 'set-cookie'])
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  const fail = (res: ServerResponse, status: number, message: string) => json(res, status, { error: { message, type: 'local_proxy_error' } })
  const handle: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/proxy/')) return next()
    void (async () => {
      const origin = req.headers.origin
      if (req.headers['x-elondia-proxy'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) return fail(res, 403, '本機轉送只接受遊戲自己送出的請求')
      if (url === '/proxy/ping' || url.startsWith('/proxy/ping?')) return json(res, 200, { elondiaProxy: true })
      const m = /^\/proxy\/(https?)\/([^/?#]+)(.*)$/.exec(url)
      if (!m) return fail(res, 400, '轉送的網址格式不對')
      const target = `${m[1]}://${m[2]}${m[3]}`
      const headers: Record<string, string> = { 'accept-encoding': 'identity' }
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || SKIP_REQUEST.has(k) || k.startsWith('sec-')) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const abort = new AbortController()
      res.on('close', () => abort.abort())
      let upstream: Response
      try {
        upstream = await fetch(target, {
          method: req.method, headers, signal: abort.signal,
          ...(chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}),
        })
      } catch (e) {
        const cause = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message
        return fail(res, 502, `本機轉送連不上 ${m[2]}：${cause}`)
      }
      res.statusCode = upstream.status
      upstream.headers.forEach((v, k) => { if (!SKIP_RESPONSE.has(k)) res.setHeader(k, v) })
      if (!upstream.body || req.method === 'HEAD') return res.end()
      // 一段一段即時轉（敘事是串流的）
      try {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk)
      } catch {
        // 遊戲取消了請求，或連線中斷
      }
      res.end()
    })().catch((e) => {
      if (!res.headersSent) fail(res, 500, String(e))
      else res.end()
    })
  }
  return {
    name: 'elondia-local-relay',
    configureServer: (server) => { server.middlewares.use(handle) },
    configurePreviewServer: (server) => { server.middlewares.use(handle) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // 相對路徑：建置結果放在任何路徑底下都能用（例如 GitHub Pages 的 https://<帳號>.github.io/ElondiaRPG/）
  base: './',
  plugins: [
    woff2Only(),
    localRelay(),
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
})
