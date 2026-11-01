// 插圖生成：服務的模板（ChatGPT、NovelAI、ComfyUI）、角色形象插圖的提示詞、生圖提示詞的預處理（交給大語言模型改寫）。
// 送出請求的程式在 imageProviders.ts；設定存在瀏覽器（stores/image.ts），見 docs/PORTRAITS.md。

import { className, genderName, lewdRules, raceName } from '@/engine/data'
import { currentRegion, exposureAt, lewdOf, npcLewd } from '@/engine/lewd'
import { gearName, gearRules } from '@/engine/gear'
import { npcOutfit } from '@/engine/outfits'
import { appearanceOf, npcRecord, npcTitle } from '@/engine/npcs'
import { placeName, tattooDesc, tattooName, tattoosOf } from '@/engine/tattoos'
import type { EquippedGear, GameState, GearSlot } from '@/engine/types'
import type { Prompt } from './prompt'

export type ImageServiceId = 'openai' | 'novelai' | 'comfyui'

/** 一個生圖服務的設定（每個服務各自保存，切換服務不會弄丟 key） */
export interface ImageServiceConfig {
  apiKey: string
  baseURL: string
  /** OpenAI：模型；NovelAI：模型（ComfyUI 的模型與參數改放在設定組合裡，見 comfy.ts；這裡的舊值只用來轉換） */
  model: string
  width: number
  height: number
  steps: number
  /** CFG（提示詞的影響力） */
  scale: number
  sampler: string
  /** 負面提示詞（OpenAI 不支援） */
  negative: string
  /** 舊版 ComfyUI 的工作流程（升級時轉成設定組合） */
  workflow: string
  /** 額外的請求參數（JSON，合併進請求；NovelAI 合併進 parameters） */
  extra: string
}

export interface ImageServiceInfo {
  id: ImageServiceId
  name: string
  /** 預設的設定 */
  defaults: Omit<ImageServiceConfig, 'apiKey'>
  keyOptional?: boolean
  /** 預設用哪一份預處理指示（空字串是不預處理） */
  preprocess: string
  /** 設定畫面的說明 */
  note: string
  /** 可以選的尺寸（寬 × 高） */
  sizes: [number, number][]
}

export const NEGATIVE = 'lowres, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, worst quality, low quality, jpeg artifacts, text, signature, watermark, username, blurry'

/** ComfyUI 的預設工作流程（API 格式）：一般的文生圖。代號會換成設定與提示詞 */
export const DEFAULT_COMFY_WORKFLOW = JSON.stringify({
  3: {
    class_type: 'KSampler',
    inputs: {
      seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: 'normal', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '%negative%', clip: ['4', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'elondia', images: ['8', 0] } },
}, null, 2)

export const IMAGE_SERVICES: ImageServiceInfo[] = [
  {
    id: 'openai',
    name: 'ChatGPT（OpenAI 圖片 API）',
    defaults: { baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', width: 1024, height: 1536, steps: 0, scale: 0, sampler: '', negative: '', workflow: '', extra: '' },
    preprocess: '',
    note: '用 OpenAI 的 /images/generations。看得懂一般的句子描述（不需要 Danbooru 標籤）；不支援負面提示詞。也可以填相容的服務網址。',
    sizes: [[1024, 1536], [1024, 1024], [1536, 1024]],
  },
  {
    id: 'novelai',
    name: 'NovelAI',
    defaults: {
      baseURL: 'https://image.novelai.net', model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5,
      sampler: 'k_euler_ancestral', negative: NEGATIVE, workflow: '', extra: '',
    },
    preprocess: 'danbooru',
    note: '用 NovelAI 的 /ai/generate-image（key 是帳號設定裡的 Persistent API Token）。動漫模型只看得懂 Danbooru 標籤，建議用「Danbooru 標籤」預處理。瀏覽器直接呼叫被擋（CORS）時，把網址換成自己的轉送代理。',
    sizes: [[832, 1216], [1024, 1024], [1216, 832]],
  },
  {
    id: 'comfyui',
    name: 'ComfyUI（自架）',
    defaults: {
      baseURL: 'http://127.0.0.1:8188', model: 'model.safetensors', width: 832, height: 1216, steps: 28, scale: 6,
      sampler: 'euler_ancestral', negative: NEGATIVE, workflow: DEFAULT_COMFY_WORKFLOW, extra: '',
    },
    keyOptional: true,
    preprocess: 'danbooru',
    note: '送出工作流程到 /prompt，等算完再下載圖片。ComfyUI 啟動時要加 --enable-cors-header。每個主模存成一組設定：Checkpoint 或 UNet（模型、文字編碼器、VAE 分開載入）模式只用 ComfyUI 內建的節點，可以加多個 LoRA 與高解析修復；也可以貼上自己的工作流程。按「讀取 ComfyUI 清單」可以直接選伺服器上的檔案，「從工作流程匯入」可以把跑得動的工作流程變成一組設定。',
    sizes: [[832, 1216], [1024, 1024], [1216, 832], [512, 768]],
  },
]

export function imageServiceInfo(id: ImageServiceId): ImageServiceInfo {
  return IMAGE_SERVICES.find((s) => s.id === id) ?? IMAGE_SERVICES[0]!
}

// ---- 角色形象插圖的提示詞 ----

/** 畫一個角色需要的資料 */
export interface PortraitSubject {
  id: string
  name: string
  gender: string
  race: string
  /** 職業或身分 */
  role: string
  level?: number
  appearance: string
  personality: string
  background: string
  gear: string[]
  /** 刺青與印記：「部位：名稱（外觀）」 */
  tattoos: string[]
  /** 構圖：刺青、腿部飾品、露出的內褲在下半身時拉遠（full body、cowboy shot），否則 upper body */
  composition?: string
  /** 慾望的氣質：淫亂、曝露名聲達到門檻時的一句英文描述（lewd.json 的 portrait） */
  allure?: string
}

/** 淫亂、曝露名聲（目前的地區）換成形象圖的氣質描述：各取達到的最高一句 */
export function portraitAllure(lewdness: number, exposure: number): string {
  const r = lewdRules.portrait
  const pick = (rows: [number, string][] | undefined, v: number) => [...(rows ?? [])].reverse().find(([min]) => v >= min)?.[1]
  return [pick(r.lewdness, lewdness), pick(r.exposure, exposure)].filter(Boolean).join(', ')
}

// 下半身的刺青部位與裝備欄位：形象圖要拉遠才畫得到
const FULL_BODY_PLACES = new Set(['left_thigh', 'right_thigh', 'left_calf', 'right_calf'])
const WAIST_PLACES = new Set(['hips', 'belly'])

/** 依刺青與裝備決定構圖（見 PortraitSubject.composition） */
export function portraitComposition(places: string[], slots: string[]): string {
  if (places.some((p) => FULL_BODY_PLACES.has(p)) || slots.includes('leg_accessory')) return 'full body'
  if (places.some((p) => WAIST_PLACES.has(p)) || slots.includes('underwear_bottom')) return 'cowboy shot'
  return 'upper body'
}

/** 身上的裝備（名稱）：內衣、內褲被上身、下身的衣物蓋住時標「穿在裡面」；回傳露在外面的欄位 */
function wornGear(gear: Partial<Record<GearSlot, EquippedGear>> | undefined): { names: string[]; visible: string[] } {
  const names: string[] = []
  const visible: string[] = []
  const cover: Partial<Record<GearSlot, GearSlot>> = { underwear_top: 'body', underwear_bottom: 'legs' }
  for (const [slot, g] of Object.entries(gear ?? {}) as [GearSlot, EquippedGear | undefined][]) {
    if (!g?.name) continue
    const over = cover[slot]
    const hidden = !!over && !!gear?.[over]
    names.push(hidden ? `${g.name}（穿在裡面）` : g.name)
    // 額外飾品欄：照底材原本的部位（腿部飾品要拉遠構圖）
    if (!hidden) visible.push(slot === 'extra_1' ? gearRules.bases[g.spec?.base ?? '']?.slot ?? slot : slot)
  }
  return { names, visible }
}

/** 隊伍成員或登場過的 NPC 的形象資料 */
export function portraitSubject(state: GameState, id: string): PortraitSubject | undefined {
  const m = state.party.find((x) => x.id === id)
  const rec = npcRecord(state, id)
  if (!m && !rec) return undefined
  const gender = m?.gender ?? rec?.gender
  // 主角的性別是自由輸入的文字；NPC 是性別 id
  const genderText = !gender ? '' : m?.isPlayer ? gender : genderName(gender)
  const worn = wornGear(m ? m.gear : rec?.character?.gear)
  const gear = worn.names
  // 還沒有戰鬥資料的人（普通人、還沒登場的冒險者）：內容頁籤指定的裝備，沒有時依身分穿的服裝
  const defGear = gear.length ? [] : rec?.gear ? Object.values(rec.gear).filter((g) => !!g).map((g) => gearName(g!)) : rec ? wornGear(npcOutfit(rec, rec.class ? undefined : state.time.day)).names : []
  const tattoos = tattoosOf(m ?? rec?.character)
  return {
    id,
    name: m?.name ?? rec!.name,
    gender: genderText,
    race: raceName(m?.race ?? rec!.race),
    role: m ? className(m.class) : npcTitle(rec!),
    level: m?.level ?? rec?.level,
    appearance: appearanceOf(id, m?.appearance ?? rec?.appearance),
    personality: m?.personality ?? rec?.personality ?? '',
    background: m?.background ?? rec?.background ?? '',
    gear: [...gear, ...defGear],
    tattoos: tattoos.map((t) => {
      const name = tattooName(t)
      const desc = tattooDesc(t).slice(0, 60)
      return `${placeName(t.place)}：${name || desc}${name && desc ? `（${desc}）` : ''}`
    }),
    composition: portraitComposition(tattoos.map((t) => t.place), worn.visible),
    allure: portraitAllure((m ?? rec?.character ? lewdOf((m ?? rec!.character)!) : npcLewd(rec!)).lewdness, m ? exposureAt(state, m.id, currentRegion(state)) : 0),
  }
}

/** 加上 {allure} 之前的預設模板（讀設定時換成新的預設） */
const PORTRAIT_TEMPLATE_V2 = [
  'A single-character portrait illustration for a fantasy role-playing game.',
  'Character: {name}, {gender} {race}, {role}.',
  'Appearance: {appearance}',
  'Outfit and equipment: {gear}',
  'Tattoos and marks: {tattoos}',
  'Personality, shown through expression and pose: {personality}',
  'Background story hints: {background}',
  'Composition: {composition}, facing the viewer, simple softly lit fantasy background, only one person, no text, no watermark.',
  'Art style: {style}',
].join('\n')

/** 預設的形象插圖提示詞（{代號} 會換成角色的資料；值是空的那一行整行拿掉） */
export const DEFAULT_PORTRAIT_TEMPLATE = [
  'A single-character portrait illustration for a fantasy role-playing game.',
  'Character: {name}, {gender} {race}, {role}.',
  'Appearance: {appearance}',
  'Outfit and equipment: {gear}',
  'Tattoos and marks: {tattoos}',
  'Personality, shown through expression and pose: {personality}',
  'Allure: {allure}',
  'Background story hints: {background}',
  'Composition: {composition}, facing the viewer, simple softly lit fantasy background, only one person, no text, no watermark.',
  'Art style: {style}',
].join('\n')

/** 以前的預設模板（構圖寫死 upper body）：讀設定時換成新的預設 */
export const LEGACY_PORTRAIT_TEMPLATES = [PORTRAIT_TEMPLATE_V2.replace('{composition}', 'upper body'), PORTRAIT_TEMPLATE_V2]

export const DEFAULT_STYLE = 'detailed anime-style fantasy illustration, painterly shading, soft lighting'

/** 把模板的代號換成角色的資料 */
export function portraitPrompt(subject: PortraitSubject, template: string, style: string): string {
  const values: Record<string, string> = {
    name: subject.name, gender: subject.gender, race: subject.race, role: subject.role,
    level: subject.level ? String(subject.level) : '', appearance: subject.appearance, personality: subject.personality,
    background: subject.background.slice(0, 200), gear: subject.gear.join('、'), tattoos: (subject.tattoos ?? []).join('；'), style,
    composition: subject.composition ?? 'upper body',
    allure: subject.allure ?? '',
  }
  // 自訂的模板沒有 {composition}：寫死的 upper body 換成需要的構圖（下半身的刺青、腿部飾品才畫得到）
  if (!template.includes('{composition}') && values.composition !== 'upper body') template = template.replace(/upper[ -]body/gi, values.composition!)
  return template
    .split('\n')
    // 只有空值的代號：整行拿掉；有內容的照填
    .filter((line) => { const keys = [...line.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!); return !keys.length || keys.some((k) => (values[k] ?? '').trim()) })
    .map((line) => line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? ''))
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/,\s*,/g, ',').replace(/\s+([,.])/g, '$1').trim())
    .filter(Boolean)
    .join('\n')
}

// ---- 生圖提示詞預處理 ----
// 送給生圖服務之前，先請大語言模型照一份「預處理指示」改寫角色描述：轉成 Danbooru 標籤、英文句子、JSON……
// 指示有內建的幾份，玩家也可以自己建立；output 決定怎麼整理模型的回覆。

/** 模型回覆的整理方式：tags 整理成逗號分隔的標籤（去掉重複）；text 只拿掉程式碼框與前後空白，原樣送出（句子、JSON） */
export type PreprocessOutput = 'tags' | 'text'

export interface ImagePreprocessor {
  id: string
  name: string
  /** 交給大語言模型的指示（system） */
  instructions: string
  output: PreprocessOutput
  /** 內建的（不能修改，可以複製成自訂的） */
  builtin?: boolean
}

/** 預設的 Danbooru 標籤指示 */
export const DEFAULT_TAG_INSTRUCTIONS = [
  '你是 AI 繪圖提示詞的轉換器。把使用者給的角色形象描述轉成 Danbooru 標籤格式的提示詞，給動漫風格的生圖模型（NovelAI、Stable Diffusion 的動漫模型等）使用。',
  '規則：',
  '1. 只輸出一行英文標籤，用「, 」分隔；不要任何說明、編號、引號或程式碼框。',
  '2. 順序：人數與性別（1girl、1boy、1other……）→ 外貌（髮色、髮型、眼睛顏色、膚色、體型、種族特徵，例如 pointy ears、cat ears、animal ears、tail、horns）→ 服裝與裝備 → 表情與姿勢 → 構圖（upper body、looking at viewer）→ 背景 → 畫質（masterpiece, best quality, very aesthetic）。',
  '3. 只用 Danbooru 上實際存在的標籤，空格不要換成底線；描述沒寫到的細節可以依角色設定合理補上，不要和描述衝突。',
  '4. 不要寫出角色名字或作品名稱。',
  '5. 大約 20～40 個標籤。',
  '6. 刺青、印記與每件裝備都要保留成標籤並寫出部位（例如 butterfly tattoo, thigh tattoo）；構圖照描述的 Composition（upper body、cowboy shot、full body），讓這些部位畫得到。標成「穿在裡面」的內衣不要畫成露出來。',
].join('\n')

/** 內建的預處理指示 */
export const BUILTIN_PREPROCESSORS: ImagePreprocessor[] = [
  { id: 'danbooru', name: 'Danbooru 標籤', output: 'tags', builtin: true, instructions: DEFAULT_TAG_INSTRUCTIONS },
  {
    id: 'english', name: '英文自然語言描述', output: 'text', builtin: true,
    instructions: [
      '你是 AI 繪圖提示詞的改寫器。把使用者給的角色形象描述改寫成一段給生圖模型（DALL·E、Flux、SDXL 的寫實模型等）用的英文描述。',
      '規則：',
      '1. 只輸出描述本身，一段英文，不要任何說明、引號或程式碼框。',
      '2. 先寫主體（人物、性別、年齡感、種族特徵），再寫外貌、服裝與裝備、表情與姿勢，最後寫構圖、光線與背景。',
      '3. 用具體的視覺詞彙；描述沒寫到的細節可以依角色設定合理補上，不要和描述衝突。',
      '4. 不要寫出角色名字或作品名稱。',
      '5. 大約 60～120 個英文單字。',
      '6. 刺青、印記與每件裝備都要寫進去並寫出部位；構圖照描述的 Composition，讓這些部位畫得到。標成「穿在裡面」的內衣不要寫成露出來。',
    ].join('\n'),
  },
  {
    id: 'json', name: 'JSON 結構化', output: 'text', builtin: true,
    instructions: [
      '你是 AI 繪圖提示詞的轉換器。把使用者給的角色形象描述轉成給生圖模型用的 JSON。',
      '規則：',
      '1. 只輸出一個 JSON 物件，不要任何說明或程式碼框。',
      '2. 欄位（值都用英文）：{"subject": "人物與性別", "appearance": "髮型、髮色、眼睛、體型、種族特徵", "outfit": "服裝與裝備", "expression": "表情", "pose": "姿勢", "composition": "構圖", "background": "背景", "style": "畫風", "quality": "畫質詞"}。',
      '3. 描述沒寫到的細節可以依角色設定合理補上，不要和描述衝突；不要寫出角色名字或作品名稱。',
      '4. 刺青、印記與每件裝備都要寫進 outfit 或 appearance 並寫出部位；composition 照描述的 Composition。',
    ].join('\n'),
  },
]

/** 交給大語言模型的預處理請求 */
export function preprocessPrompt(semantic: string, instructions: string): Prompt {
  return { system: instructions.trim(), user: `角色形象描述：\n${semantic}` }
}

/** 依整理方式處理模型的回覆 */
export function cleanPreprocessed(text: string, output: PreprocessOutput): string {
  if (output === 'tags') return cleanTags(text)
  return text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
}

/** 整理模型回傳的標籤：拿掉程式碼框與說明，換行改成逗號，去掉重複 */
export function cleanTags(text: string): string {
  const body = text
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(tags?|標籤|prompt)\s*[:：]?$/i.test(l))
    .join(', ')
    .replace(/^(tags?|prompt|標籤)\s*[:：]\s*/i, '')
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of body.split(/[,，、]/)) {
    const t = raw.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ')
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    tags.push(t)
  }
  return tags.join(', ')
}
