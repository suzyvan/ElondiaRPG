// 插圖生成的設定：用哪個生圖服務（各自的 key 與參數）、形象插圖的提示詞、生圖提示詞的預處理（內建與自訂的指示）。
// 和模型來源一樣只存在這個瀏覽器的 localStorage。

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  BUILTIN_PREPROCESSORS, DEFAULT_PORTRAIT_TEMPLATE, LEGACY_PORTRAIT_TEMPLATES, DEFAULT_STYLE, DEFAULT_TAG_INSTRUCTIONS, IMAGE_SERVICES, imageServiceInfo,
  type ImagePreprocessor, type ImageServiceConfig, type ImageServiceId,
} from '@/narrator/imageInfo'
import {
  comfyServer, fetchComfyOptions, newPreset, presetFromLegacy, presetFromWorkflow, presetIssues, sanitizePreset,
  type ComfyMode, type ComfyOptions, type ComfyPreset, type ImportedPreset,
} from '@/narrator/comfy'

const KEY = 'elondia.image'

export const SCENE_AUTO = ['off', 'adult', 'all'] as const
export type SceneAuto = (typeof SCENE_AUTO)[number]

interface SavedImageSettings {
  service: ImageServiceId
  configs: Record<ImageServiceId, ImageServiceConfig>
  /** 各服務用哪一份預處理指示（空字串是不預處理；預處理後直接送出結果，不再套提示詞模板） */
  preprocess: Record<ImageServiceId, string>
  /** 玩家自己建立的預處理指示 */
  preprocessors: ImagePreprocessor[]
  /** 形象插圖的提示詞模板（{name} 等代號） */
  template: string
  /** 畫風（模板的 {style}） */
  style: string
  /** ComfyUI 的設定組合（每個主模一組）與目前用的那一組 */
  comfyPresets: ComfyPreset[]
  comfyActive: string
  /** 日誌插圖：成人場景改用哪個服務（空字串是和一般場景一樣用目前的服務） */
  sceneAdultService: ImageServiceId | ''
  /** 日誌插圖的自動生成：關閉、只畫成人場景、每一則寫出正文的日誌 */
  sceneAuto: SceneAuto
  /** 第一次和 NPC 產生關係（人際關係多了這個人）時，自動畫他的形象圖（他已經有形象圖時不畫） */
  portraitAuto: boolean
}

function defaultConfigs(): Record<ImageServiceId, ImageServiceConfig> {
  return Object.fromEntries(IMAGE_SERVICES.map((s) => [s.id, { apiKey: '', ...s.defaults }])) as Record<ImageServiceId, ImageServiceConfig>
}

function defaults(): SavedImageSettings {
  return {
    service: 'openai',
    configs: defaultConfigs(),
    preprocess: Object.fromEntries(IMAGE_SERVICES.map((s) => [s.id, s.preprocess])) as Record<ImageServiceId, string>,
    preprocessors: [],
    template: DEFAULT_PORTRAIT_TEMPLATE,
    style: DEFAULT_STYLE,
    comfyPresets: [],
    comfyActive: '',
    sceneAdultService: '',
    sceneAuto: 'off',
    portraitAuto: false,
  }
}

/** 設定組合：舊版只有一份 ComfyUI 工作流程，轉成第一組 */
function loadPresets(saved: Partial<SavedImageSettings> | null, comfy: ImageServiceConfig): { presets: ComfyPreset[]; active: string } {
  const list = Array.isArray(saved?.comfyPresets) ? saved!.comfyPresets.map((p, i) => sanitizePreset(p, `p-${i + 1}`)) : []
  // id 重複時重新編號
  const seen = new Set<string>()
  for (const p of list) {
    while (seen.has(p.id)) p.id = `${p.id}-x`
    seen.add(p.id)
  }
  const presets = list.length ? list : [presetFromLegacy(comfy)]
  const active = presets.some((p) => p.id === saved?.comfyActive) ? saved!.comfyActive! : presets[0]!.id
  return { presets, active }
}

function load(): SavedImageSettings {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...base, ...presetsOf(loadPresets(null, base.configs.comfyui)) }
    const saved = JSON.parse(raw) as Partial<SavedImageSettings> & LegacyImageSettings
    const configs = defaultConfigs()
    for (const id of Object.keys(configs) as ImageServiceId[]) configs[id] = { ...configs[id], ...saved.configs?.[id] }
    return {
      ...base, ...saved,
      service: IMAGE_SERVICES.some((s) => s.id === saved.service) ? saved.service! : base.service,
      sceneAdultService: IMAGE_SERVICES.some((s) => s.id === saved.sceneAdultService) ? saved.sceneAdultService! : '',
      sceneAuto: SCENE_AUTO.includes(saved.sceneAuto as SceneAuto) ? saved.sceneAuto! : 'off',
      portraitAuto: saved.portraitAuto === true,
      // 沒改過的舊預設模板（構圖寫死 upper body）：換成新的預設
      template: typeof saved.template === 'string' && !LEGACY_PORTRAIT_TEMPLATES.includes(saved.template) ? saved.template : base.template,
      configs,
      ...loadPreprocess(saved, base),
      ...presetsOf(loadPresets(saved, configs.comfyui)),
    }
  } catch {
    return { ...base, ...presetsOf(loadPresets(null, base.configs.comfyui)) }
  }
}

/** 舊版：各服務勾選「先轉成 Danbooru 標籤」，指示只有一份（可以修改） */
interface LegacyImageSettings {
  danbooru?: Partial<Record<ImageServiceId, boolean>>
  tagInstructions?: string
}

const OUTPUTS = ['tags', 'text'] as const

function sanitizePreprocessor(p: Partial<ImagePreprocessor>, i: number): ImagePreprocessor {
  return {
    id: typeof p.id === 'string' && p.id && !BUILTIN_PREPROCESSORS.some((b) => b.id === p.id) ? p.id : `c-${i + 1}`,
    name: String(p.name || '自訂的預處理').slice(0, 30),
    instructions: String(p.instructions ?? ''),
    output: OUTPUTS.includes(p.output as never) ? p.output! : 'text',
  }
}

/** 預處理的設定：舊版的勾選轉成「Danbooru 標籤」；改過的指示變成一份自訂的 */
function loadPreprocess(saved: Partial<SavedImageSettings> & LegacyImageSettings, base: SavedImageSettings): Pick<SavedImageSettings, 'preprocess' | 'preprocessors'> {
  const preprocessors = (Array.isArray(saved.preprocessors) ? saved.preprocessors : []).map(sanitizePreprocessor)
  const known = (id: string) => !id || BUILTIN_PREPROCESSORS.some((b) => b.id === id) || preprocessors.some((p) => p.id === id)
  if (saved.preprocess) {
    const preprocess = { ...base.preprocess }
    for (const id of Object.keys(preprocess) as ImageServiceId[]) {
      const v = saved.preprocess[id]
      if (typeof v === 'string' && known(v)) preprocess[id] = v
    }
    return { preprocess, preprocessors }
  }
  if (!saved.danbooru) return { preprocess: base.preprocess, preprocessors }
  let tagId = 'danbooru'
  if (saved.tagInstructions && saved.tagInstructions.trim() !== DEFAULT_TAG_INSTRUCTIONS.trim()) {
    tagId = 'c-legacy'
    preprocessors.push({ id: tagId, name: 'Danbooru 標籤（自訂）', instructions: saved.tagInstructions, output: 'tags' })
  }
  const preprocess = { ...base.preprocess }
  for (const id of Object.keys(preprocess) as ImageServiceId[]) {
    if (saved.danbooru[id] !== undefined) preprocess[id] = saved.danbooru[id] ? tagId : ''
  }
  return { preprocess, preprocessors }
}

const presetsOf = (x: { presets: ComfyPreset[]; active: string }) => ({ comfyPresets: x.presets, comfyActive: x.active })

export const useImageSettings = defineStore('image', () => {
  const initial = load()
  const service = ref(initial.service)
  const configs = ref(initial.configs)
  const preprocess = ref(initial.preprocess)
  const preprocessors = ref<ImagePreprocessor[]>(initial.preprocessors)
  const template = ref(initial.template)
  const style = ref(initial.style)
  const comfyPresets = ref<ComfyPreset[]>(initial.comfyPresets)
  const comfyActive = ref(initial.comfyActive)
  const sceneAdultService = ref<ImageServiceId | ''>(initial.sceneAdultService)
  const sceneAuto = ref<SceneAuto>(initial.sceneAuto)
  const portraitAuto = ref(initial.portraitAuto)
  /** 從 ComfyUI 讀到的清單（不保存，每次開啟設定時再讀） */
  const comfyOptions = ref<ComfyOptions | null>(null)
  const comfyLoading = ref(false)
  const comfyError = ref<string | null>(null)

  watch([service, configs, preprocess, preprocessors, template, style, comfyPresets, comfyActive, sceneAdultService, sceneAuto, portraitAuto], () => {
    const data: SavedImageSettings = {
      service: service.value, configs: configs.value, preprocess: preprocess.value, preprocessors: preprocessors.value,
      template: template.value, style: style.value,
      comfyPresets: comfyPresets.value, comfyActive: comfyActive.value, sceneAdultService: sceneAdultService.value, sceneAuto: sceneAuto.value,
      portraitAuto: portraitAuto.value,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // 寫不進去時只在本次有效
    }
  }, { deep: true })

  /** 目前的服務設定 */
  const config = () => configs.value[service.value]
  /** 設定完成了嗎（有網址；需要 key 的服務有 key；ComfyUI 的設定組合選好了模型） */
  function ready(id: ImageServiceId = service.value): boolean {
    const info = imageServiceInfo(id)
    const c = configs.value[id]
    return !!c.baseURL && (!!c.apiKey || !!info.keyOptional) && (id !== 'comfyui' || !presetIssues(preset()).length)
  }

  /** 這個服務出圖的尺寸（ComfyUI 看設定組合）；landscape：場景插圖用橫的（長邊當寬） */
  function sizeFor(id: ImageServiceId = service.value, landscape = false): { width: number; height: number } {
    const c = id === 'comfyui' ? preset() : configs.value[id]
    const [a, b] = [c.width, c.height]
    if (!landscape) return { width: a, height: b }
    // OpenAI 只有固定的幾種尺寸：橫的是 1536 × 1024
    if (id === 'openai') return { width: 1536, height: 1024 }
    return { width: Math.max(a, b), height: Math.min(a, b) }
  }

  /** 這個服務預設的負面提示詞（ComfyUI 看設定組合；OpenAI 沒有） */
  function negativeFor(id: ImageServiceId = service.value): string {
    if (id === 'openai') return ''
    return id === 'comfyui' ? preset().negative : configs.value[id].negative
  }

  /** 日誌插圖用哪個服務：成人場景可以另外指定 */
  function sceneService(adult: boolean): ImageServiceId {
    return adult && sceneAdultService.value ? sceneAdultService.value : service.value
  }

  // ---- ComfyUI 的設定組合 ----

  /** 目前用的設定組合 */
  function preset(): ComfyPreset {
    return comfyPresets.value.find((p) => p.id === comfyActive.value) ?? comfyPresets.value[0]!
  }

  function newId(): string {
    let n = comfyPresets.value.length + 1
    while (comfyPresets.value.some((p) => p.id === `p-${n}`)) n++
    return `p-${n}`
  }

  function uniqueName(name: string): string {
    let out = name.trim() || '新的設定'
    for (let i = 2; comfyPresets.value.some((p) => p.name === out); i++) out = `${name.trim() || '新的設定'} ${i}`
    return out
  }

  function addPreset(mode: ComfyMode = 'checkpoint'): ComfyPreset {
    const p = newPreset(newId(), uniqueName('新的設定'), mode)
    comfyPresets.value.push(p)
    comfyActive.value = p.id
    return p
  }

  function duplicatePreset(): ComfyPreset {
    const p = { ...JSON.parse(JSON.stringify(preset())) as ComfyPreset, id: newId() }
    p.name = uniqueName(`${preset().name} 複製`)
    comfyPresets.value.push(p)
    comfyActive.value = p.id
    return p
  }

  /** 刪掉目前這組（至少留一組） */
  function removePreset() {
    if (comfyPresets.value.length <= 1) throw new Error('至少要留一組設定')
    comfyPresets.value = comfyPresets.value.filter((p) => p.id !== comfyActive.value)
    comfyActive.value = comfyPresets.value[0]!.id
  }

  /** 從玩家的工作流程（API 格式）匯入成新的一組 */
  function importPreset(text: string): ImportedPreset & { added: ComfyPreset } {
    const result = presetFromWorkflow(text, comfyOptions.value?.loras ?? [])
    const added = sanitizePreset({ ...result.preset, id: newId(), name: uniqueName(result.name) })
    comfyPresets.value.push(added)
    comfyActive.value = added.id
    return { ...result, added }
  }

  /** 讀取 ComfyUI 上的模型、LoRA、取樣器清單 */
  async function loadComfyOptions() {
    comfyLoading.value = true
    comfyError.value = null
    try {
      comfyOptions.value = await fetchComfyOptions(comfyServer(configs.value.comfyui))
    } catch (e) {
      comfyError.value = e instanceof Error ? e.message : String(e)
    } finally {
      comfyLoading.value = false
    }
  }

  /** 這個服務恢復預設的參數（保留 key；ComfyUI 的設定組合不動） */
  function resetService(id: ImageServiceId) {
    configs.value[id] = { apiKey: configs.value[id].apiKey, ...imageServiceInfo(id).defaults }
  }

  // ---- 生圖提示詞的預處理 ----

  /** 內建的在前，再來是自訂的 */
  function allPreprocessors(): ImagePreprocessor[] {
    return [...BUILTIN_PREPROCESSORS, ...preprocessors.value]
  }

  /** 這個服務用的預處理指示（不預處理時是 undefined） */
  function preprocessorFor(id: ImageServiceId = service.value): ImagePreprocessor | undefined {
    const pick = preprocess.value[id]
    return pick ? allPreprocessors().find((p) => p.id === pick) : undefined
  }

  /** 新增一份自訂的指示（可以從現有的複製），並讓目前的服務改用它 */
  function addPreprocessor(copyFrom?: ImagePreprocessor): ImagePreprocessor {
    let n = preprocessors.value.length + 1
    while (preprocessors.value.some((p) => p.id === `c-${n}`)) n++
    const p: ImagePreprocessor = {
      id: `c-${n}`,
      name: (copyFrom ? `${copyFrom.name}（自訂）` : '自訂的預處理').slice(0, 30),
      instructions: copyFrom?.instructions ?? '',
      output: copyFrom?.output ?? 'text',
    }
    preprocessors.value.push(p)
    preprocess.value[service.value] = p.id
    return p
  }

  /** 刪掉自訂的指示；用它的服務改成不預處理 */
  function removePreprocessor(id: string) {
    preprocessors.value = preprocessors.value.filter((p) => p.id !== id)
    for (const s of Object.keys(preprocess.value) as ImageServiceId[]) {
      if (preprocess.value[s] === id) preprocess.value[s] = ''
    }
  }

  return {
    service, configs, preprocess, preprocessors, template, style, config, ready, resetService, sizeFor, negativeFor,
    sceneAdultService, sceneService, sceneAuto, portraitAuto,
    allPreprocessors, preprocessorFor, addPreprocessor, removePreprocessor,
    comfyPresets, comfyActive, comfyOptions, comfyLoading, comfyError,
    preset, addPreset, duplicatePreset, removePreset, importPreset, loadComfyOptions,
  }
})
