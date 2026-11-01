// 送出生圖請求：OpenAI（/images/generations）、NovelAI（/ai/generate-image，回傳 ZIP）、ComfyUI（/prompt → /history → /view）。
// 請求直接從瀏覽器送出，key 只存在這個瀏覽器。

import {
  buildWorkflow, checkWorkflow, comfyServer, executionErrorText, pickOutputImage, presetFromLegacy, promptErrorText, uploadComfyImage,
  type ComfyHistoryEntry, type ComfyPreset,
} from './comfy'
import type { ImageServiceConfig, ImageServiceId } from './imageInfo'
import { blobToBase64, fitMask } from './imageUtils'

export { fillWorkflow } from './comfy'

/** 以圖生圖：底圖（已經是要的尺寸）、重繪強度、局部重繪的遮罩 */
export interface ImageInit {
  image: Blob
  /** 重繪強度 0～1（OpenAI 沒有，照文字指示改） */
  strength: number
  /** 遮罩：白色是要重畫的地方、黑色保留，和底圖一樣大 */
  mask?: Blob
}

/** 多人場景裡的一個角色（NovelAI V4 的多角色提示）：自己的提示詞與在畫面上的位置（0～1） */
export interface SceneCharacter {
  prompt: string
  x: number
  y: number
}

export interface ImageRequest {
  prompt: string
  /** 負面提示詞（沒有時用設定的） */
  negative?: string
  seed?: number
  signal?: AbortSignal
  /** 尺寸（沒有時用設定的） */
  width?: number
  height?: number
  /** 以圖生圖 */
  init?: ImageInit
  /** NovelAI：多人場景的各個角色 */
  characters?: SceneCharacter[]
  /** OpenAI：參考圖（例如登場角色的形象圖），讓人物長得一樣 */
  references?: Blob[]
  /** ComfyUI：用哪一組設定（沒有時由舊版的單一工作流程設定轉換） */
  comfy?: ComfyPreset
  /** ComfyUI：送出前檢查節點與檔案（預設檢查） */
  check?: boolean
}

export interface ImageResult {
  blob: Blob
  /** 用的種子（OpenAI 沒有種子） */
  seed?: number
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32)

/** 產生一張圖片，連同用的種子（記下來，之後可以沿用種子微調） */
export async function renderImage(service: ImageServiceId, cfg: ImageServiceConfig, req: ImageRequest): Promise<ImageResult> {
  const seed = service === 'openai' ? undefined : req.seed ?? randomSeed()
  const r = { ...req, ...(seed !== undefined ? { seed } : {}) }
  let blob: Blob
  switch (service) {
    case 'openai': blob = await openAIImage(cfg, r); break
    case 'novelai': blob = await novelAIImage(cfg, r); break
    case 'comfyui': blob = await comfyImage(cfg, r); break
  }
  return { blob, ...(seed !== undefined ? { seed } : {}) }
}

/** 產生一張圖片 */
export async function generateImage(service: ImageServiceId, cfg: ImageServiceConfig, req: ImageRequest): Promise<Blob> {
  return (await renderImage(service, cfg, req)).blob
}

const trimURL = (u: string) => u.trim().replace(/\/+$/, '')

/** 額外參數（JSON 物件；空白時是空的） */
export function parseExtra(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error('額外參數不是正確的 JSON')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('額外參數要是一個 JSON 物件')
  return v as Record<string, unknown>
}

async function failure(res: Response, service: string): Promise<Error> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // 讀不到內容就算了
  }
  return new Error(`${service} 回應 ${res.status}${detail ? `：${detail}` : ''}`)
}

function base64ToBlob(b64: string, type = 'image/png'): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

// ---- OpenAI ----

export function openAIBody(cfg: ImageServiceConfig, req: ImageRequest): Record<string, unknown> {
  return { model: cfg.model, prompt: req.prompt, size: `${req.width ?? cfg.width}x${req.height ?? cfg.height}`, n: 1, ...parseExtra(cfg.extra) }
}

/**
 * 改圖（/images/edits，multipart）：以圖生圖的底圖、參考圖都放在 image；局部重繪的遮罩是透明的地方要重畫。
 * mask 已經轉成 OpenAI 的格式
 */
export function openAIEditForm(cfg: ImageServiceConfig, req: ImageRequest, mask?: Blob): FormData {
  const form = new FormData()
  form.append('model', cfg.model)
  form.append('prompt', req.prompt)
  form.append('size', `${req.width ?? cfg.width}x${req.height ?? cfg.height}`)
  form.append('n', '1')
  const images = [...(req.init ? [req.init.image] : []), ...(req.references ?? [])]
  // 一張用 image；好幾張用 image[]
  images.forEach((b, i) => form.append(images.length > 1 ? 'image[]' : 'image', b, `image-${i + 1}.png`))
  if (mask) form.append('mask', mask, 'mask.png')
  for (const [k, v] of Object.entries(parseExtra(cfg.extra))) form.append(k, typeof v === 'string' ? v : JSON.stringify(v))
  return form
}

async function openAIImage(cfg: ImageServiceConfig, req: ImageRequest): Promise<Blob> {
  const base = trimURL(cfg.baseURL || 'https://api.openai.com/v1')
  const edit = !!req.init || !!req.references?.length
  const mask = req.init?.mask ? await fitMask(req.init.mask, req.width ?? cfg.width, req.height ?? cfg.height, true) : undefined
  const res = await fetch(`${base}/images/${edit ? 'edits' : 'generations'}`, {
    method: 'POST',
    headers: edit ? { Authorization: `Bearer ${cfg.apiKey}` } : { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: edit ? openAIEditForm(cfg, req, mask) : JSON.stringify(openAIBody(cfg, req)),
    signal: req.signal,
  })
  if (!res.ok) throw await failure(res, 'OpenAI')
  const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
  const first = data.data?.[0]
  if (first?.b64_json) return base64ToBlob(first.b64_json)
  if (first?.url) {
    const img = await fetch(first.url, { signal: req.signal })
    if (!img.ok) throw await failure(img, 'OpenAI（下載圖片）')
    return img.blob()
  }
  throw new Error('OpenAI 沒有回傳圖片')
}

// ---- NovelAI ----

/**
 * NovelAI 的請求。enc：以圖生圖的底圖與遮罩（base64，已經是要的尺寸）。
 * 有底圖是 img2img，再有遮罩是 infill（局部重繪，用模型的 -inpainting 版）；
 * V4 以後的模型（4、4.5、5……）用 v4_prompt 的格式，多人場景把每個角色放進 char_captions，位置寫在 centers
 */
export function novelAIBody(cfg: ImageServiceConfig, req: ImageRequest, enc: { image?: string; mask?: string } = {}): Record<string, unknown> {
  const negative = req.negative ?? cfg.negative
  const seed = req.seed ?? randomSeed()
  // V4 以後的模型（nai-diffusion-4-5-full、nai-diffusion-5-full……）都要 v4_prompt，沒有時 NovelAI 回 500
  const v4 = /diffusion-(?:[4-9]|\d{2,})/.test(cfg.model)
  const chars = v4 ? req.characters ?? [] : []
  const action = enc.image ? (enc.mask ? 'infill' : 'img2img') : 'generate'
  const model = action === 'infill' && !/-inpainting$/.test(cfg.model) ? `${cfg.model}-inpainting` : cfg.model
  return {
    input: req.prompt,
    model,
    action,
    parameters: {
      params_version: 3, width: req.width ?? cfg.width, height: req.height ?? cfg.height, scale: cfg.scale, sampler: cfg.sampler, steps: cfg.steps,
      n_samples: 1, seed, ucPreset: 0, qualityToggle: true, noise_schedule: 'karras', cfg_rescale: 0,
      negative_prompt: negative,
      ...(v4 ? {
        v4_prompt: {
          caption: { base_caption: req.prompt, char_captions: chars.map((c) => ({ char_caption: c.prompt, centers: [{ x: c.x, y: c.y }] })) },
          use_coords: chars.length > 0, use_order: true,
        },
        v4_negative_prompt: {
          caption: { base_caption: negative, char_captions: chars.map((c) => ({ char_caption: '', centers: [{ x: c.x, y: c.y }] })) },
          legacy_uc: false,
        },
        ...(chars.length ? { characterPrompts: chars.map((c) => ({ prompt: c.prompt, uc: '', center: { x: c.x, y: c.y }, enabled: true })) } : {}),
      } : {}),
      ...(enc.image ? { image: enc.image, strength: req.init?.strength ?? 0.6, noise: 0, extra_noise_seed: seed } : {}),
      ...(enc.mask ? { mask: enc.mask, add_original_image: true } : {}),
      ...parseExtra(cfg.extra),
    },
  }
}

async function novelAIImage(cfg: ImageServiceConfig, req: ImageRequest): Promise<Blob> {
  const enc = req.init
    ? { image: await blobToBase64(req.init.image), ...(req.init.mask ? { mask: await blobToBase64(await fitMask(req.init.mask, req.width ?? cfg.width, req.height ?? cfg.height)) } : {}) }
    : {}
  const res = await fetch(`${trimURL(cfg.baseURL || 'https://image.novelai.net')}/ai/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(novelAIBody(cfg, req, enc)),
    signal: req.signal,
  })
  if (!res.ok) throw await failure(res, 'NovelAI')
  const buf = new Uint8Array(await res.arrayBuffer())
  // 回傳的是 ZIP（裡面是 PNG）；有些代理直接回傳圖片
  if (buf[0] === 0x50 && buf[1] === 0x4b) return firstZipEntry(buf)
  return new Blob([buf], { type: res.headers.get('content-type') ?? 'image/png' })
}

/** 取出 ZIP 的第一個檔案（不壓縮或 deflate） */
export async function firstZipEntry(buf: Uint8Array): Promise<Blob> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // 從中央目錄讀大小（本地檔頭可能用資料描述，大小是 0）
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('看不懂回傳的 ZIP')
  const cd = view.getUint32(eocd + 16, true)
  if (view.getUint32(cd, true) !== 0x02014b50) throw new Error('看不懂回傳的 ZIP')
  const method = view.getUint16(cd + 10, true)
  const size = view.getUint32(cd + 20, true)
  const local = view.getUint32(cd + 42, true)
  const nameLen = view.getUint16(local + 26, true)
  const extraLen = view.getUint16(local + 28, true)
  const start = local + 30 + nameLen + extraLen
  const data = buf.slice(start, start + size)
  if (method === 0) return new Blob([data], { type: 'image/png' })
  if (method === 8) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Blob([await new Response(stream).arrayBuffer()], { type: 'image/png' })
  }
  throw new Error(`ZIP 的壓縮方式（${method}）不支援`)
}

// ---- ComfyUI ----

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(t)
    reject(new DOMException('已取消', 'AbortError'))
  }, { once: true })
})

/** 依設定組合組出工作流程 → 送出前檢查 → /prompt → 等 /history → 從 /view 下載成品圖 */
async function comfyImage(cfg: ImageServiceConfig, req: ImageRequest): Promise<Blob> {
  const preset = req.comfy ?? presetFromLegacy(cfg)
  const server = comfyServer(cfg)
  // 以圖生圖：先把底圖（與遮罩）上傳到 ComfyUI
  let image: string | undefined
  let mask: string | undefined
  if (req.init) {
    const tag = Date.now().toString(36)
    image = await uploadComfyImage(server, req.init.image, `elondia-${tag}.png`, req.signal)
    if (req.init.mask) mask = await uploadComfyImage(server, req.init.mask, `elondia-${tag}-mask.png`, req.signal)
  }
  const prompt = buildWorkflow(preset, {
    prompt: req.prompt, seed: req.seed ?? randomSeed(), ...(req.negative ? { negative: req.negative } : {}),
    ...(req.width ? { width: req.width } : {}), ...(req.height ? { height: req.height } : {}),
    ...(image ? { image, denoise: req.init!.strength } : {}), ...(mask ? { mask } : {}),
  })
  if (req.check !== false) {
    const problems = await checkWorkflow(server, prompt, preset.mode !== 'custom', req.signal)
    if (problems.length) throw new Error(problems.join('；'))
  }
  let res: Response
  try {
    res = await fetch(`${server.base}/prompt`, {
      method: 'POST', headers: server.headers, body: JSON.stringify({ prompt, client_id: 'elondia', ...parseExtra(cfg.extra) }), signal: req.signal,
    })
  } catch (e) {
    if (req.signal?.aborted) throw e
    throw new Error(`連不到 ComfyUI（${server.base}）：確認 ComfyUI 有開、網址正確，並且啟動時加了 --enable-cors-header`)
  }
  if (res.status === 400) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // 不是 JSON 就用一般的錯誤訊息
    }
    if (body) throw new Error(promptErrorText(body))
  }
  if (!res.ok) throw await failure(res, 'ComfyUI')
  const { prompt_id: id } = (await res.json()) as { prompt_id?: string }
  if (!id) throw new Error('ComfyUI 沒有回傳工作編號')
  // 等它算完（最多 10 分鐘）
  for (let i = 0; i < 400; i++) {
    await sleep(1500, req.signal)
    const h = await fetch(`${server.base}/history/${id}`, { headers: server.headers, signal: req.signal })
    if (!h.ok) continue
    const entry = ((await h.json()) as Record<string, ComfyHistoryEntry>)[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(executionErrorText(entry))
    const image = pickOutputImage(entry.outputs, preset.mode === 'custom' ? preset.outputNode : '')
    if (!image) {
      if (entry.status?.completed) throw new Error('ComfyUI 跑完了，但工作流程沒有輸出圖片（需要 SaveImage 或 PreviewImage 節點）')
      continue
    }
    const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' })
    const img = await fetch(`${server.base}/view?${q}`, { headers: server.headers, signal: req.signal })
    if (!img.ok) throw await failure(img, 'ComfyUI（下載圖片）')
    return img.blob()
  }
  throw new Error('ComfyUI 等太久了（超過 10 分鐘）')
}
