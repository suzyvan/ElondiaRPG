// 日誌插圖：請大語言模型把一則日誌整理成一張圖的分鏡（誰在畫面上、站在哪、在做什麼、整體畫面），再組成生圖提示詞。
// 多人場景：NovelAI 的 V4 模型每個角色分開描述、標出位置；其他服務接成一段提示詞。見 docs/PORTRAITS.md 第 7 節。

import { findLocation, genderPrompt, locationName, regionById } from '@/engine/data'
import type { GameState, Report } from '@/engine/types'
import { portraitSubject, type ImagePreprocessor, type ImageServiceId } from './imageInfo'
import { novelAIV4, type SceneCharacter } from './imageProviders'
import type { Prompt } from './prompt'
import { monsterGirlsIn, monsterLines, reportFocus, reportGirlSeed, reportMonsters } from './monsters'

export type SceneRating = 'general' | 'suggestive' | 'explicit'
export type ScenePosition = 'left' | 'center' | 'right'

/** 一張圖的分鏡 */
export interface ScenePlan {
  rating: SceneRating
  /** 整體畫面：人數、地點、時段、光線、氣氛、鏡頭與構圖、畫風（不含各角色的外貌） */
  scene: string
  characters: { id: string; name: string; position: ScenePosition; prompt: string }[]
}

/** 可以登場的人：日誌裡的隊伍與其他人，附上外貌描述 */
export interface SceneCastMember {
  id: string
  name: string
  player: boolean
  description: string
}

/** 畫面上最多幾個人 */
export const SCENE_MAX_CHARACTERS = 4
/** 一則日誌最多幾張插圖：自動分段（設定的「最多 N 張」）、手動分段 */
export const SCENE_MAX_AUTO = 4
export const SCENE_MAX_MANUAL = 6

/**
 * 分段插圖：正文的段落（narrationParagraphs），以及要畫幾張
 *   auto：交給 AI 挑最多 count 個時刻（每張插在它挑的段落之後）
 *   manual：玩家在對話框選好的位置（段落的索引，從 0 起算），每個位置一張
 */
export type SceneSegments = { paragraphs: string[]; count: number; after?: undefined; kept?: undefined }
  | { paragraphs: string[]; after: number[]; count?: undefined; kept?: number[] }

/** 一張分段插圖：插在第 after 段之後（從 0 起算） */
export interface SegmentPlan {
  after: number
  plan: ScenePlan
}

/** 自動分段的張數設定：1 張、依長度（約每 400 字一張）、最多 2～4 張 */
export type SceneCount = '1' | 'length' | '2' | '3' | '4'
export const SCENE_COUNTS: SceneCount[] = ['1', 'length', '2', '3', '4']
export const SCENE_COUNT_NAME: Record<SceneCount, string> = { 1: '1 張', length: '依長度（約每 400 字一張）', 2: '最多 2 張', 3: '最多 3 張', 4: '最多 4 張' }

/** 自動分段這次要畫幾張：不超過段落數 */
export function autoSceneCount(setting: SceneCount, paragraphs: string[]): number {
  const chars = paragraphs.reduce((s, p) => s + p.length, 0)
  const want = setting === 'length' ? Math.round(chars / 400) : Number(setting)
  return Math.max(1, Math.min(SCENE_MAX_AUTO, paragraphs.length || 1, want || 1))
}

/** 交給分鏡的正文：每段標上編號（從 1 起算），太長的段落截短 */
function numberedParagraphs(paragraphs: string[]): string {
  const per = Math.max(200, Math.floor(6000 / Math.max(1, paragraphs.length)))
  return paragraphs.map((p, i) => `[${i + 1}] ${p.length > per ? `${p.slice(0, per)}……` : p}`).join('\n')
}

export function sceneCast(state: GameState, report: Report): SceneCastMember[] {
  const ids = [...report.party, ...(report.others ?? [])].map((a) => a.id)
  const out: SceneCastMember[] = []
  for (const id of [...new Set(ids)]) {
    const s = portraitSubject(state, id)
    if (!s) continue
    const player = !!state.party.find((m) => m.id === id)?.isPlayer
    const description = [
      [genderPrompt(s.gender), s.race, s.role].filter(Boolean).join(' '),
      s.appearance && `外貌：${s.appearance}`,
      s.gear.length ? `裝備：${s.gear.slice(0, 6).join('、')}` : '',
      s.tattoos.length ? `刺青與印記：${s.tattoos.join('；')}` : '',
    ].filter(Boolean).join('；')
    out.push({ id, name: s.name, player, description })
  }
  return out
}

const TIME_NAME = (hour = 12) => (hour >= 5 && hour < 7 ? '黎明' : hour >= 7 && hour < 17 ? '白天' : hour >= 17 && hour < 19 ? '黃昏' : '夜晚')

/**
 * 分鏡的請求。format：這個服務用的預處理指示（照它的寫法寫各欄位；沒有時寫英文句子）；
 * multi：服務能分開描述每個角色（NovelAI V4），不能時 scene 也要交代每個人
 */
export function scenePrompt(
  state: GameState, report: Report, cast: SceneCastMember[], opts: { format?: ImagePreprocessor; multi: boolean; narration?: string; style?: string; segments?: SceneSegments },
): Prompt {
  const loc = findLocation(report.location.at)
  // 分流：親密場景的日誌才可以畫成人場景（判定時標的、寫正文時標出的、記下了性經歷的）
  const adult = adultScene(report)
  const seg = opts.segments
  const one = '{"rating": "general | suggestive | explicit", "scene": "整體畫面", "characters": [{"id": "登場角色的 id", "position": "left | center | right", "prompt": "這個角色"}]}'
  const head = !seg
    ? [
        '你是遊戲插圖的分鏡師。依使用者給的冒險日誌，設計一張最能代表這段經過的插圖，交給 AI 生圖。',
        '只輸出一個 JSON 物件，不要任何說明或程式碼框：',
        one,
      ]
    : [
        `你是遊戲插圖的分鏡師。使用者給的冒險日誌正文已經分段、標上編號；依正文設計插在段落之間的插圖，交給 AI 生圖。`,
        seg.after
          ? `玩家指定了 ${seg.after.length} 個位置：${seg.after.map((a) => `第 ${a + 1} 段之後`).join('、')}。每個位置畫一張，after 照寫那個段落的編號；每張畫「上一張之後到這一段為止」的內容裡最有代表性的瞬間。${seg.kept?.length ? `${seg.kept.map((a) => `第 ${a + 1} 段之後`).join('、')}已經有插圖（不用畫），也算「上一張」：不要再畫那些插圖之前的內容。` : ''}`
          : seg.count === 1
            ? '挑出最能代表這段經過的一刻，畫一張，插在那一刻所在的段落之後（after 是那個段落的編號）。'
            : `挑出 1～${seg.count} 個畫面差別最大的時刻（例如進場、衝突的高潮、收尾），每個時刻一張，依時間順序，插在那一刻所在的段落之後（after 是那個段落的編號）。不要兩張畫同一件事；正文短、場面單純時少畫幾張。`,
        '同一個角色在每一張的外貌寫法（髮色、眼睛、種族特徵、體型）要一字不差，服裝、表情、動作照那一刻寫。',
        '只輸出一個 JSON 物件，不要任何說明或程式碼框：',
        '{"images": [{"after": 3, "rating": "general | suggestive | explicit", "scene": "整體畫面", "characters": [{"id": "登場角色的 id", "position": "left | center | right", "prompt": "這個角色"}]}, ...]}',
        'after 只寫段落編號的阿拉伯數字（例如 3），不要加引號或任何字。',
      ]
  const system = [
    ...head,
    '規則：',
    `1. characters 只放畫面上看得清楚的人，最多 ${SCENE_MAX_CHARACTERS} 人，從「可以登場的人」裡選；主角通常要在。其他人（路人、敵人、怪物）寫在 scene 裡。`,
    `2. scene：人數（例如 2girls, 1boy）、地點與背景、時段與光線、氣氛、鏡頭與構圖${opts.style?.trim() ? '（畫風、畫師與畫質詞由程式另外接在最後，不要寫）' : '、畫風'}。不要寫各角色的外貌細節；登場的怪物寫在 scene 裡，要寫出牠們的種族特徵（例如 green skin, pointy ears, wolf ears, tail）。`,
    '3. 每個角色的 prompt：照提供的外貌描述畫（髮色、眼睛、種族特徵、體型不要改；種族後面括號裡的英文標籤一定要原樣寫進去），加上服裝、表情、動作與姿勢；要和其他人的位置與互動對得上。',
    '4. position 是角色在畫面上的位置；兩個人時通常一左一右。',
    opts.multi ? '' : '5. 這個生圖服務不能分開描述每個人：scene 也要簡短交代每個人在哪裡、在做什麼（例如 on the left, on the right）。',
    adult
      ? `6. rating：一般場景 general；有性暗示、裸露 suggestive；性行為 explicit。成人場景照實畫，不要迴避。${seg ? '每一張分開標。' : ''}`
      : '6. 不要裸露、性暗示或血腥的內容；rating 一律 general。',
    '7. 不要寫出角色名字、地名或作品名稱。',
    opts.format
      ? `\nscene 與每個角色的 prompt 都照這份指示的寫法寫（只套用寫法，輸出仍然是上面的 JSON）：\n${opts.format.instructions.trim()}`
      : '\nscene 與每個角色的 prompt 都用英文自然語言描述。',
  ].filter(Boolean).join('\n')
  const user = [
    `地點：${loc ? `${loc.name}（${regionById(loc.region).name}）` : locationName(report.location.at)}${report.location.scene ? `・${report.location.scene}` : ''}`,
    `時間：第 ${report.time.start.day} 天・${TIME_NAME(report.time.start.hour)}`,
    `經過：${report.outcome.summary ?? ''}`,
    report.check?.action ? `主角的行動：${report.check.action}` : '',
    report.narration?.player_intent ? `玩家描述的做法：${report.narration.player_intent}` : '',
    adult ? `這段是成人場景：${adultSceneText(report)}` : '',
    seg ? `\n日誌正文（已分段）：\n${numberedParagraphs(seg.paragraphs)}` : opts.narration ? `\n日誌正文：\n${opts.narration.slice(0, 1500)}` : '',
    '\n可以登場的人：',
    ...cast.map((c) => `- id: ${c.id}｜${c.player ? '主角' : '其他人'}｜${c.description}`),
    ...monsterScene(state, report),
  ].filter(Boolean).join('\n')
  return { system, user }
}

/** 登場的怪物（寫在 scene 裡）：外觀；魔物娘的設定打開時，標了「→」的畫成魔物娘（成年女性） */
/** 有魔物娘登場時，插圖的負面提示詞另外補上的詞（分鏡不寫否定句，避開的東西放這裡） */
export const GIRL_SCENE_NEGATIVE = 'blood, corpse, guro'

/** 這則日誌的插圖有沒有魔物娘登場 */
export function sceneHasGirls(state: GameState, report: Report): boolean {
  return monsterLines(reportMonsters(report), monsterGirlsIn(state, reportFocus(report)), { seed: reportGirlSeed(state, report) }).some((l) => l.includes(' → '))
}

function monsterScene(state: GameState, report: Report): string[] {
  const girls = monsterGirlsIn(state, reportFocus(report))
  // 插圖只要外觀（性情、習性畫不出來，只會讓分鏡變長）
  const lines = monsterLines(reportMonsters(report), girls, { seed: reportGirlSeed(state, report) })
  if (!lines.length) return []
  const note = lines.some((l) => l.includes(' → ')) ? '（標了「→」的畫成右邊的魔物娘：成年女性，保留原本種族的特徵；被打倒的是倒地或逃跑的樣子，畫成正面的描述（例如 lying on the ground, limping away）；scene 不要寫 no blood 這類否定句，血腥、屍體由程式另外放進負面提示詞）' : ''
  return [`\n登場的怪物（寫在 scene 裡）${note}：`, ...lines]
}

const POSITIONS: ScenePosition[] = ['left', 'center', 'right']

/**
 * 這則日誌可以畫成人場景嗎：判定時標了親密場景（adult_scene）、寫正文時寫手標出了性愛場景（intimate_note，
 * 長休、旅行、續寫……）、或記下了性經歷（sex_log 有內容，包括手動按 ♥ 記的）。只看 adult_scene 時，後兩種一律被當成一般場景
 */
export function adultScene(report: Report): boolean {
  return !!report.narration?.adult_scene || !!report.narration?.intimate_note || !!report.sex_log?.length
}

/** 交給分鏡的成人場景說明 */
export function adultSceneText(report: Report): string {
  return report.narration?.adult_scene || report.narration?.intimate_note || report.sex_log?.join('；') || ''
}

/** 讀分鏡的回覆：不認識的人略過、位置補上；adult：日誌帶親密場景，不是的話一律 general */
export function parseScenePlan(raw: unknown, cast: SceneCastMember[], adult: boolean): ScenePlan {
  const r = (raw ?? {}) as { rating?: unknown; scene?: unknown; characters?: unknown }
  const scene = typeof r.scene === 'string' ? r.scene.trim() : ''
  if (!scene) throw new Error('AI 沒有寫出畫面（scene）')
  const list = Array.isArray(r.characters) ? r.characters : []
  const characters: ScenePlan['characters'] = []
  for (const c of list as { id?: unknown; position?: unknown; prompt?: unknown }[]) {
    if (characters.length >= SCENE_MAX_CHARACTERS || !c || typeof c !== 'object') continue
    const who = cast.find((m) => m.id === c.id || m.name === c.id)
    if (!who || characters.some((x) => x.id === who.id) || typeof c.prompt !== 'string' || !c.prompt.trim()) continue
    const position = POSITIONS.includes(c.position as ScenePosition) ? c.position as ScenePosition : 'center'
    characters.push({ id: who.id, name: who.name, position, prompt: c.prompt.trim() })
  }
  // 兩個人都站在同一邊時拉開
  if (characters.length === 2 && characters[0]!.position === characters[1]!.position) {
    characters[0]!.position = 'left'
    characters[1]!.position = 'right'
  }
  const rating: SceneRating = !adult ? 'general' : (['general', 'suggestive', 'explicit'] as const).find((x) => x === r.rating) ?? 'general'
  return { rating, scene, characters }
}

/** 從 start 起找配對的右括號（略過字串裡的括號）；找不到回傳 -1 */
function closingBrace(text: string, start: number): number {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 讀分鏡的回覆（比一般的 JSON 寬鬆）：容忍 ```json 區塊、前後的說明、after 寫成「Der 7」「第 7 段」「"7"」、
 * 多餘的逗號；回覆被截斷（輸出額度用完）時留下寫完的那幾張。都讀不出來時說明回覆是空的還是寫了什麼
 */
export function extractSceneJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/.exec(text)
  let body = (fenced ? fenced[1]! : text).trim()
  const start = body.indexOf('{')
  if (start < 0) {
    if (!text.trim()) throw new Error('整理分鏡的 AI 回覆是空的：可能被模型拒絕（成人內容）或輸出額度被思考用完。可以到「⚙️ 設定」換「插圖提示詞預處理」的模型來源，或調高它的輸出上限')
    throw new Error(`整理分鏡的 AI 沒有回傳 JSON：「${text.trim().slice(0, 80)}${text.trim().length > 80 ? '…' : ''}」`)
  }
  body = body.slice(start)
    // after 只要數字："after": Der 7、"after": 第7段、"after": "7" → "after": 7
    .replace(/"after"\s*:\s*("?)[^\d\-",}\n]*?(-?\d+)[^,}\n]*?\1(?=\s*[,}\n])/g, '"after": $2')
    // 多餘的逗號
    .replace(/,(\s*[}\]])/g, '$1')
  const end = closingBrace(body, 0)
  if (end >= 0) return JSON.parse(body.slice(0, end + 1))
  // 被截斷：留下 images 裡寫完的幾張
  const list = /"images"\s*:\s*\[/.exec(body)
  if (list) {
    const images: unknown[] = []
    let i = list.index + list[0].length
    for (;;) {
      const open = body.indexOf('{', i)
      if (open < 0) break
      const close = closingBrace(body, open)
      if (close < 0) break
      try {
        images.push(JSON.parse(body.slice(open, close + 1)))
      } catch {
        break
      }
      i = close + 1
    }
    if (images.length) return { images }
  }
  throw new Error('整理分鏡的 AI 回覆被截斷了（輸出額度不夠）：可以調高「插圖提示詞預處理」模型來源的輸出上限，或少畫幾張')
}

/**
 * 讀分段插圖的回覆：{images: [{after, ...分鏡}]}（after 從 1 起算，轉成從 0 起算）。
 * 編號不在正文裡、手動分段時不在指定位置的、同一段重複的、畫面寫不出來的略過；自動分段最多 count 張。依段落順序排好
 */
export function parseScenePlans(raw: unknown, cast: SceneCastMember[], adult: boolean, seg: SceneSegments): SegmentPlan[] {
  const r = (raw ?? {}) as { images?: unknown }
  // 只回了一張（沒有 images）：手動分段只選一個位置時插在那裡，其他時候當作插在最後一段之後
  const single = seg.after?.length === 1 ? seg.after[0]! + 1 : seg.paragraphs.length
  const list = Array.isArray(r.images) ? r.images : raw && typeof raw === 'object' && 'scene' in (raw as object) ? [{ ...(raw as object), after: single }] : []
  const allowed = seg.after ? new Set(seg.after) : undefined
  const max = seg.after ? seg.after.length : seg.count
  const out: SegmentPlan[] = []
  for (const x of list as { after?: unknown }[]) {
    if (!x || typeof x !== 'object') continue
    const after = Number(x.after) - 1
    if (!Number.isInteger(after) || after < 0 || after >= seg.paragraphs.length) continue
    if (allowed && !allowed.has(after)) continue
    if (out.some((o) => o.after === after)) continue
    try {
      out.push({ after, plan: parseScenePlan(x, cast, adult) })
    } catch {
      // 這一張沒有寫出畫面：略過
    }
  }
  out.sort((a, b) => a.after - b.after)
  if (!out.length) throw new Error('AI 沒有寫出畫面（scene）')
  return out.slice(0, max)
}

/** 這個服務能不能分開描述每個人：只有 V4 以後的 NovelAI 模型可以（整理分鏡與組成請求都照這個） */
export function sceneMulti(service: ImageServiceId, model: string): boolean {
  return service === 'novelai' && novelAIV4(model)
}

/** 位置換成 NovelAI 的座標（0～1） */
export function positionX(p: ScenePosition): number {
  return p === 'left' ? 0.3 : p === 'right' ? 0.7 : 0.5
}

const POSITION_TEXT: Record<ScenePosition, string> = { left: 'on the left', center: 'in the center', right: 'on the right' }

/**
 * 分鏡組成生圖的請求：NovelAI 的 V4 以後的模型用整體畫面＋每個角色分開（多角色提示）；
 * 其他服務與 V3 以前的 NovelAI 接成一段（標籤用逗號、句子用句點，加上位置）。
 * multi：這個服務能不能分開描述每個人（sceneMulti），要和整理分鏡時一樣
 */
export function composeScene(plan: ScenePlan, service: ImageServiceId, tags: boolean, multi = service === 'novelai', style = ''): { prompt: string; characters?: SceneCharacter[] } {
  // 畫風（設定的「畫風」，和形象圖同一個）照原樣接在最後：畫師名、權重寫法都不經過 AI
  const s = style.trim()
  if (service === 'novelai' && multi && plan.characters.length) {
    return { prompt: [plan.scene, s].filter(Boolean).join(', '), characters: plan.characters.map((c) => ({ prompt: c.prompt, x: positionX(c.position), y: 0.5 })) }
  }
  if (tags) return { prompt: [plan.scene, ...plan.characters.map((c) => c.prompt), s].filter(Boolean).join(', ') }
  return { prompt: [plan.scene, ...plan.characters.map((c) => `${POSITION_TEXT[c.position]}: ${c.prompt}`), ...(s ? [`Art style: ${s}`] : [])].join('\n') }
}
