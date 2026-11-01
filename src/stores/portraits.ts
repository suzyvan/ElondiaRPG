// 角色的形象插圖：存在這個瀏覽器的 IndexedDB（圖片太大，放不進 localStorage）。
// 匯出存檔時可以選擇附上（轉成 data URL）；沒有任何存檔用到的局（種子）的圖會被清掉。
// 依「這一局（種子）＋角色 id」保存，所以不同存檔的主角不會互相蓋掉。
//
// 同一個資料庫裡的 key（見 docs/PORTRAITS.md 第 4 節）：
// - `種子:角色id`：目前的形象圖（隊伍、關係裡顯示的那張）
// - `種子:角色id~時間`：生成過的每一版（最多 MAX_VERSIONS 版；目前的形象圖那版不會被擠掉）
// - `種子:角色id!desc`：玩家改過、要記住的描述（之後「重新生成」也用）
// - `種子:@scene:日誌id`：日誌插圖（stores/scenes.ts）
// 匯出只帶目前的形象圖與日誌插圖，不帶舊版與描述。
//
// 固定 NPC 的內建形象圖（src/assets/portraits/<npc id>.webp，tools/portraits/finalize.py 轉出來的）：
// 玩家還沒有自己的圖時顯示，也可以當微調的底圖、日誌插圖的參考圖；不存進資料庫、不跟著存檔匯出。
//
// 兩層操作：
// - 一般（PortraitBox）：生成、重新生成、✨ 微調（選一個預設或寫一句想改什麼，以這張為底重畫）、翻看舊版
// - 進階（PortraitStudio）：改預處理前的描述或送出的提示詞重送、負面提示詞、種子、以圖生圖的強度與遮罩

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { cleanPreprocessed, portraitPrompt, portraitSubject, preprocessPrompt, type ImageServiceId } from '@/narrator/imageInfo'
import { renderImage, type ImageInit, type ImageRequest, type ImageResult } from '@/narrator/imageProviders'
import { fitImage } from '@/narrator/imageUtils'
import type { GameState } from '@/engine/types'
import { OTHER_USAGE, useGame } from './game'
import { useImageSettings } from './image'
import { useSettings } from './settings'

const DB = 'elondia-portraits'
const STORE = 'portraits'
/** 每個角色保留幾版 */
export const MAX_VERSIONS = 8

export interface PortraitRecord {
  blob: Blob
  /** 生成時送出的提示詞（上傳的圖片沒有） */
  prompt?: string
  /** 有預處理時，預處理前的語意描述 */
  semantic?: string
  service?: string
  /** 用的種子（OpenAI 沒有） */
  seed?: number
  /** 這次另外指定的負面提示詞 */
  negative?: string
  /** 怎麼來的：生成、微調（以圖生圖）、進階、上傳 */
  from?: 'generate' | 'tweak' | 'studio' | 'upload'
  /** 微調時選的、寫的 */
  note?: string
  time: number
}

export type PortraitMeta = Omit<PortraitRecord, 'blob'>

/** 一版：key 與說明（圖片網址另外放在 versionUrls） */
export interface PortraitVersion extends PortraitMeta {
  vkey: string
}

/** 正在生成：預處理提示詞（stage tags）、生成圖片，或出錯 */
export interface PortraitJob {
  stage: 'tags' | 'image' | 'error'
  error?: string
  semantic?: string
  tags?: string
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('這個瀏覽器不能保存圖片（沒有 IndexedDB）'))
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('打不開圖片資料庫'))
    })
  }
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('圖片資料庫出錯'))
  })
}

/** 讀、寫、刪一筆（日誌插圖也用同一個資料庫） */
export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key))
export const idbPut = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key))
export const idbDelete = (key: string) => tx('readwrite', (s) => s.delete(key))
export const idbKeys = async (): Promise<string[]> => (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String)

/** 固定 NPC 的內建形象圖：npc id → 網址 */
const BUILTIN: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/portraits/*.webp', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]),
)

/** 這個角色的內建形象圖（只有固定 NPC 可能有） */
export function builtinPortrait(id: string): string | undefined {
  return BUILTIN[id]
}

/** 圖片 key 對應的內建形象圖（日誌插圖、舊版、描述的 key 沒有） */
function builtinFor(key: string): string | undefined {
  if (isSideKey(key) || key.includes(':@')) return undefined
  return BUILTIN[key.slice(key.indexOf(':') + 1)]
}

/** 目前的形象圖：自己的圖，沒有時是內建形象圖（微調的底圖、日誌插圖的參考圖用） */
export async function currentPortraitBlob(key: string): Promise<Blob | undefined> {
  const rec = await idbGet<PortraitRecord>(key).catch(() => undefined)
  if (rec?.blob) return rec.blob
  const url = builtinFor(key)
  if (!url) return undefined
  const res = await fetch(url)
  return res.ok ? res.blob() : undefined
}

/** 這一局、這個角色的圖片 key */
export function portraitKey(state: Pick<GameState, 'seed'>, id: string): string {
  return `${state.seed}:${id}`
}

/** 舊版、記住的描述這類附屬的 key（不是一張「目前的圖」） */
export const isSideKey = (key: string) => key.includes('~') || key.endsWith('!desc')
export const versionKey = (key: string, time: number) => `${key}~${time}`
const descKey = (key: string) => `${key}!desc`

/** 放進匯出存檔的形象圖：圖片轉成 data URL */
export interface PortraitFile extends PortraitMeta {
  data: string
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`
}

function fromDataUrl(url: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m || !m[2] || !m[1]!.startsWith('image/')) throw new Error('形象圖的資料壞掉了')
  const bin = atob(m[3]!)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: m[1] })
}

/** 一般模式的微調：選一個（或自己寫一句），以目前的圖為底重畫 */
export interface TweakPreset {
  label: string
  /** 重繪強度 */
  strength: number
  /** 加在提示詞後面的英文（標籤或短語） */
  add: string
  /** 另外加進負面提示詞 */
  negative?: string
}

export const TWEAKS: Record<string, TweakPreset> = {
  variation: { label: '小幅變化', strength: 0.35, add: '' },
  smile: { label: '微笑', strength: 0.5, add: 'smile, happy' },
  shy: { label: '害羞', strength: 0.5, add: 'blush, shy, embarrassed' },
  angry: { label: '生氣', strength: 0.5, add: 'angry, frown' },
  sad: { label: '難過', strength: 0.5, add: 'sad, teary eyes' },
  fix: { label: '修正崩壞', strength: 0.3, add: 'detailed face, detailed hands', negative: 'bad hands, bad anatomy, deformed, extra fingers' },
}
/** 自己寫想改什麼時的重繪強度 */
export const TWEAK_TEXT_STRENGTH = 0.55

/** OpenAI 的改圖是照文字指示改：把微調寫成指示 */
export function editInstruction(change: string): string {
  return [
    change ? `Edit this image: ${change}.` : 'Redraw this image with small natural variations.',
    'Keep the same character, face, hairstyle, outfit, art style and composition.',
  ].join(' ')
}

/** 進階模式的一次生成 */
export interface StudioRequest {
  /** 預處理前的描述（沒有 prompt 時預處理這段） */
  semantic?: string
  /** 直接送出的提示詞（不再預處理） */
  prompt?: string
  negative?: string
  seed?: number
  /** 以圖生圖：底圖用哪一版（vkey）或上傳的檔案、強度、遮罩 */
  base?: { vkey?: string; file?: Blob; strength: number; mask?: Blob }
}

export const usePortraits = defineStore('portraits', () => {
  /** key → 圖片網址（object URL）；null 表示查過了、沒有圖 */
  const urls = ref<Record<string, string | null>>({})
  const records = ref<Record<string, PortraitMeta>>({})
  const jobs = ref<Record<string, PortraitJob>>({})
  /** key → 生成過的各版（舊的在前）；versionUrls：vkey → 圖片網址 */
  const versions = ref<Record<string, PortraitVersion[]>>({})
  const versionUrls = ref<Record<string, string>>({})
  /** key → 玩家記住的描述 */
  const descs = ref<Record<string, string>>({})
  /** 匯入存檔還原圖片時加一（日誌插圖據此重新讀取） */
  const imported = ref(0)
  const controllers = new Map<string, AbortController>()

  /** 換掉顯示的圖；沒有自己的圖時顯示內建形象圖（records 沒有，所以看得出不是自己的） */
  function show(key: string, rec: PortraitRecord | undefined) {
    const old = urls.value[key]
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
    urls.value[key] = rec ? URL.createObjectURL(rec.blob) : builtinFor(key) ?? null
    if (rec) {
      const { blob: _b, ...meta } = rec
      records.value[key] = meta
    } else delete records.value[key]
  }

  /** 讀取一張圖（第一次顯示時）與記住的描述 */
  async function load(key: string) {
    if (key in urls.value) return
    urls.value[key] = null
    try {
      show(key, await idbGet<PortraitRecord>(key))
      const d = await idbGet<{ text: string }>(descKey(key))
      if (d?.text) descs.value[key] = d.text
    } catch {
      // 讀不到就當作沒有圖
    }
  }

  /** 換掉目前的形象圖（不新增一版） */
  async function put(key: string, rec: PortraitRecord) {
    await idbPut(key, rec)
    show(key, rec)
  }

  async function remove(key: string) {
    await idbDelete(key)
    show(key, undefined)
  }

  // ---- 各版 ----

  /** 讀出這個角色的各版；舊資料只有目前的圖時，把它補成第一版 */
  async function loadVersions(key: string): Promise<PortraitVersion[]> {
    const prefix = `${key}~`
    const keys = (await idbKeys()).filter((k) => k.startsWith(prefix))
    const list: PortraitVersion[] = []
    for (const vkey of keys) {
      const rec = await idbGet<PortraitRecord>(vkey)
      if (!rec?.blob) continue
      const { blob, ...meta } = rec
      list.push({ ...meta, vkey })
      if (!versionUrls.value[vkey]) versionUrls.value[vkey] = URL.createObjectURL(blob)
    }
    const current = await idbGet<PortraitRecord>(key)
    if (current?.blob && !list.some((v) => v.time === current.time)) {
      const vkey = versionKey(key, current.time)
      await idbPut(vkey, current)
      const { blob, ...meta } = current
      list.push({ ...meta, vkey })
      versionUrls.value[vkey] = URL.createObjectURL(blob)
    }
    list.sort((a, b) => a.time - b.time)
    versions.value[key] = list
    return list
  }

  /** 新增一版（makeCurrent：同時換成目前的形象圖）；超過上限時刪掉最舊的（目前的那版不刪） */
  async function addVersion(key: string, rec: PortraitRecord, makeCurrent: boolean): Promise<string> {
    const list = await loadVersions(key)
    const vkey = versionKey(key, rec.time)
    await idbPut(vkey, rec)
    if (makeCurrent) await put(key, rec)
    const currentTime = records.value[key]?.time
    const all = [...list, { ...rec, vkey }]
    for (const v of all.filter((x) => x.time !== currentTime).slice(0, Math.max(0, all.length - MAX_VERSIONS))) {
      await idbDelete(v.vkey)
      dropUrl(v.vkey)
    }
    await loadVersions(key)
    return vkey
  }

  function dropUrl(vkey: string) {
    const u = versionUrls.value[vkey]
    if (u) URL.revokeObjectURL(u)
    delete versionUrls.value[vkey]
  }

  /** 把某一版設成目前的形象圖 */
  async function useVersion(key: string, vkey: string) {
    const rec = await idbGet<PortraitRecord>(vkey)
    if (!rec?.blob) throw new Error('找不到這一版')
    await put(key, rec)
  }

  /** 刪掉一版（目前的形象圖那版不能刪） */
  async function removeVersion(key: string, vkey: string) {
    const v = versions.value[key]?.find((x) => x.vkey === vkey)
    if (v && v.time === records.value[key]?.time) throw new Error('這一版是目前的形象圖，先換成別張再刪')
    await idbDelete(vkey)
    dropUrl(vkey)
    await loadVersions(key)
  }

  /** 一版的圖片 */
  async function versionBlob(vkey: string): Promise<Blob> {
    const rec = await idbGet<PortraitRecord>(vkey)
    if (!rec?.blob) throw new Error('找不到這一版')
    return rec.blob
  }

  /** 上傳自己的圖片（也算一版） */
  async function upload(key: string, file: File) {
    if (!file.type.startsWith('image/')) throw new Error('只能上傳圖片')
    await addVersion(key, { blob: file, from: 'upload', time: Date.now() }, true)
  }

  // ---- 描述 ----

  /** 依角色資料與提示詞模板組成的描述 */
  function baseDescription(state: GameState, id: string): string {
    const subject = portraitSubject(state, id)
    if (!subject) throw new Error('找不到這個角色')
    const image = useImageSettings()
    return portraitPrompt(subject, image.template, image.style)
  }

  /** 這個角色的語意描述：記住的描述優先，沒有時依提示詞模板與畫風組成 */
  function describe(state: GameState, id: string): string {
    return descs.value[portraitKey(state, id)] || baseDescription(state, id)
  }

  /** 記住（text 有內容）或忘掉這個角色改過的描述 */
  async function setDescription(key: string, text: string | null) {
    if (text?.trim()) {
      await idbPut(descKey(key), { text: text.trim(), time: Date.now() })
      descs.value[key] = text.trim()
    } else {
      await idbDelete(descKey(key))
      delete descs.value[key]
    }
  }

  // ---- 生成 ----

  /** 預處理：請大語言模型依這個服務的指示改寫描述；沒有選預處理時原樣回傳 */
  async function preprocess(semantic: string, service: ImageServiceId, signal: AbortSignal, usageKey = OTHER_USAGE): Promise<string> {
    const image = useImageSettings()
    const pre = image.preprocessorFor(service)
    if (!pre) return semantic
    const settings = useSettings()
    const game = useGame()
    const src = settings.sourceFor('tags')
    if (!settings.sourceReady(src.index)) throw new Error(`「插圖提示詞預處理」的模型來源（${src.name}）還沒設定好`)
    const collector = game.usageCollector(game.originOf('tags', src))
    const { completeText } = await import('@/narrator/providers')
    const text = await completeText(src.provider, src.config, preprocessPrompt(semantic, pre.instructions), signal, collector.onUsage)
    collector.flush(usageKey)
    const out = cleanPreprocessed(text, pre.output)
    if (!out) throw new Error(`模型沒有回傳預處理的結果（${pre.name}）`)
    return out
  }

  /** 用這個服務出圖（ComfyUI 用目前的設定組合） */
  async function render(service: ImageServiceId, req: ImageRequest): Promise<ImageResult> {
    const image = useImageSettings()
    if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
    return renderImage(service, image.configs[service], { ...req, ...(service === 'comfyui' ? { comfy: image.preset() } : {}) })
  }

  /** 生成的流程：記下工作狀態、可以取消、出錯時留下訊息 */
  async function withJob<T>(key: string, job: PortraitJob, fn: (signal: AbortSignal, step: (patch: Partial<PortraitJob>) => void) => Promise<T>): Promise<T | undefined> {
    if (jobs.value[key] && jobs.value[key]!.stage !== 'error') return undefined
    const controller = new AbortController()
    controllers.set(key, controller)
    jobs.value[key] = job
    try {
      const out = await fn(controller.signal, (patch) => { jobs.value[key] = { ...jobs.value[key]!, ...patch } })
      delete jobs.value[key]
      return out
    } catch (e) {
      if (controller.signal.aborted) delete jobs.value[key]
      else jobs.value[key] = { ...jobs.value[key]!, stage: 'error', error: e instanceof Error ? e.message : String(e) }
      return undefined
    } finally {
      controllers.delete(key)
    }
  }

  /** 生成形象插圖：組成描述 →（選了預處理時）請大語言模型依指示改寫 → 送給生圖服務；成為新的一版與目前的形象圖 */
  async function generate(state: GameState, id: string) {
    const key = portraitKey(state, id)
    const image = useImageSettings()
    const service = image.service
    await withJob(key, { stage: 'tags', semantic: describe(state, id) }, async (signal, step) => {
      const semantic = jobs.value[key]!.semantic!
      if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
      const prompt = await preprocess(semantic, service, signal)
      if (prompt !== semantic) step({ tags: prompt })
      step({ stage: 'image' })
      const out = await render(service, { prompt, signal })
      await addVersion(key, {
        blob: out.blob, prompt, ...(prompt !== semantic ? { semantic } : {}), service, ...(out.seed !== undefined ? { seed: out.seed } : {}),
        from: 'generate', time: Date.now(),
      }, true)
    })
  }

  // ---- 第一次產生關係時自動畫（插圖設定的 portraitAuto）：一張一張排隊 ----
  let autoQueue: Promise<void> = Promise.resolve()
  const autoQueued = new Set<string>()

  /** 這些人第一次出現在人際關係裡：沒有形象圖（內建的或畫過的）就排隊畫一張 */
  function autoPortraits(state: GameState, ids: string[]) {
    const image = useImageSettings()
    if (!image.portraitAuto || !image.ready()) return
    for (const id of ids) {
      const key = portraitKey(state, id)
      if (autoQueued.has(key) || builtinPortrait(id)) continue
      autoQueued.add(key)
      autoQueue = autoQueue.then(async () => {
        try {
          if (await currentPortraitBlob(key)) return
          await generate(state, id)
        } finally {
          autoQueued.delete(key)
        }
      })
    }
  }

  /** 以圖生圖的底圖：縮放成這個服務的尺寸 */
  async function initFrom(blob: Blob, service: ImageServiceId, strength: number, mask?: Blob): Promise<ImageInit> {
    const { width, height } = useImageSettings().sizeFor(service)
    return { image: await fitImage(blob, width, height), strength, ...(mask ? { mask: await fitImage(mask, width, height) } : {}) }
  }

  /**
   * 一般模式的微調：以目前的形象圖為底重畫。preset 是 TWEAKS 的一個；text 是玩家自己寫的想改什麼（中文也可以）。
   * 寫了文字而且有預處理時，把「這次要改的」接在描述後面重新預處理；OpenAI 照文字指示改圖
   */
  async function tweak(state: GameState, id: string, preset: string, text = '') {
    const key = portraitKey(state, id)
    // 自己的圖，沒有時用內建形象圖當底圖
    const rec = await idbGet<PortraitRecord>(key)
    const base = rec?.blob ?? await currentPortraitBlob(key)
    if (!base) throw new Error('還沒有形象圖可以微調')
    const image = useImageSettings()
    const service = image.service
    const p = TWEAKS[preset]
    const change = text.trim()
    const note = [p && preset !== 'variation' ? p.label : '', change].filter(Boolean).join('・') || (p?.label ?? '')
    await withJob(key, { stage: 'image' }, async (signal, step) => {
      if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
      let prompt: string
      let semantic: string | undefined
      if (service === 'openai') prompt = editInstruction([p?.add, change].filter(Boolean).join(', '))
      else if (change && image.preprocessorFor(service)) {
        semantic = `${rec?.semantic ?? describe(state, id)}\nChange in this version (must be reflected): ${change}`
        step({ stage: 'tags', semantic })
        prompt = await preprocess(semantic, service, signal)
        if (p?.add) prompt = `${prompt}, ${p.add}`
        step({ stage: 'image', tags: prompt })
      } else prompt = [rec?.prompt ?? describe(state, id), p?.add, change].filter(Boolean).join(', ')
      const strength = change ? TWEAK_TEXT_STRENGTH : p?.strength ?? 0.4
      const negative = p?.negative ? [image.negativeFor(service), p.negative].filter(Boolean).join(', ') : undefined
      const out = await render(service, { prompt, signal, init: await initFrom(base, service, strength), ...(negative ? { negative } : {}) })
      await addVersion(key, {
        blob: out.blob, prompt, ...(semantic ? { semantic } : rec?.semantic ? { semantic: rec.semantic } : {}), service,
        ...(out.seed !== undefined ? { seed: out.seed } : {}), ...(negative ? { negative } : {}), from: 'tweak', note, time: Date.now(),
      }, true)
    })
  }

  /** 進階：只預處理，不生圖（看看會改成什麼） */
  async function preprocessOnly(key: string, semantic: string): Promise<string | undefined> {
    const service = useImageSettings().service
    return withJob(key, { stage: 'tags', semantic }, async (signal) => preprocess(semantic, service, signal))
  }

  /** 進階：照玩家改過的描述或提示詞生成；成為新的一版，不換掉目前的形象圖（回傳新版的 vkey） */
  async function studioGenerate(key: string, req: StudioRequest): Promise<string | undefined> {
    const image = useImageSettings()
    const service = image.service
    return withJob(key, { stage: req.prompt ? 'image' : 'tags', ...(req.semantic ? { semantic: req.semantic } : {}) }, async (signal, step) => {
      if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
      const semantic = req.prompt ? undefined : req.semantic?.trim()
      if (!req.prompt && !semantic) throw new Error('描述是空的')
      const prompt = req.prompt?.trim() || await preprocess(semantic!, service, signal)
      step({ stage: 'image', tags: prompt })
      let init: ImageInit | undefined
      if (req.base) {
        const blob = req.base.file ?? (req.base.vkey ? await versionBlob(req.base.vkey) : undefined)
        if (!blob) throw new Error('要選一張底圖')
        init = await initFrom(blob, service, req.base.strength, req.base.mask)
      }
      const negative = req.negative?.trim()
      const out = await render(service, {
        prompt, signal, ...(negative ? { negative } : {}), ...(req.seed !== undefined ? { seed: req.seed } : {}), ...(init ? { init } : {}),
      })
      return addVersion(key, {
        blob: out.blob, prompt, ...(semantic && semantic !== prompt ? { semantic } : {}), service, ...(out.seed !== undefined ? { seed: out.seed } : {}),
        ...(negative ? { negative } : {}), from: 'studio', ...(init ? { note: init.mask ? '局部重繪' : '以圖生圖' } : {}), time: Date.now(),
      }, false)
    })
  }

  // ---- 跟著存檔匯出、匯入；清理沒有存檔用到的圖 ----

  /** 這一局（種子）的圖片數量（目前的形象圖與日誌插圖） */
  async function countFor(seed: number): Promise<number> {
    try {
      return (await idbKeys()).filter((k) => k.startsWith(`${seed}:`) && !isSideKey(k)).length
    } catch {
      return 0
    }
  }

  /** 這一局的形象圖與日誌插圖：id → 圖片（舊版與記住的描述不帶） */
  async function exportFor(seed: number): Promise<Record<string, PortraitFile>> {
    const out: Record<string, PortraitFile> = {}
    for (const key of (await idbKeys()).filter((k) => k.startsWith(`${seed}:`) && !isSideKey(k))) {
      const rec = await idbGet<PortraitRecord>(key)
      if (!rec?.blob) continue
      const { blob, ...meta } = rec
      out[key.slice(`${seed}:`.length)] = { ...meta, data: await toDataUrl(blob) }
    }
    return out
  }

  /** 還原匯入存檔裡的形象圖（同一個角色已經有圖時換成檔案裡的）；回傳還原的張數 */
  async function importFor(seed: number, files: Record<string, PortraitFile>): Promise<number> {
    let n = 0
    for (const [id, f] of Object.entries(files)) {
      if (!id || isSideKey(id) || typeof f?.data !== 'string') continue
      const { data, ...meta } = f
      await put(`${seed}:${id}`, { ...meta, blob: fromDataUrl(data), time: Number(meta.time) || Date.now() })
      n++
    }
    if (n) imported.value++
    return n
  }

  /** 刪掉不屬於這些局（種子）的圖；回傳刪掉的張數 */
  async function pruneExcept(seeds: Set<number>): Promise<number> {
    const keep = new Set([...seeds].map(String))
    let n = 0
    for (const key of await idbKeys()) {
      if (keep.has(key.split(':')[0]!)) continue
      await idbDelete(key)
      if (key in urls.value) show(key, undefined)
      if (!isSideKey(key)) n++
    }
    return n
  }

  function cancel(key: string) {
    controllers.get(key)?.abort()
  }

  function clearError(key: string) {
    if (jobs.value[key]?.stage === 'error') delete jobs.value[key]
  }

  return {
    urls, records, jobs, versions, versionUrls, descs, imported,
    load, upload, remove, describe, baseDescription, setDescription, generate, autoPortraits, tweak, preprocessOnly, studioGenerate,
    loadVersions, useVersion, removeVersion, versionBlob, preprocess, render, withJob,
    cancel, clearError, countFor, exportFor, importFor, pruneExcept,
  }
})
