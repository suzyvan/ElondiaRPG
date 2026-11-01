// 日誌插圖：請大語言模型把一則日誌整理成一張圖的分鏡（誰在畫面上、站在哪、在做什麼、整體畫面），再組成生圖提示詞。
// 多人場景：NovelAI 的 V4 模型每個角色分開描述、標出位置；其他服務接成一段提示詞。見 docs/PORTRAITS.md 第 7 節。

import { genderPrompt, locationById, regionById } from '@/engine/data'
import type { GameState, Report } from '@/engine/types'
import { portraitSubject, type ImagePreprocessor, type ImageServiceId } from './imageInfo'
import { novelAIV4, type SceneCharacter } from './imageProviders'
import type { Prompt } from './prompt'
import { monsterGirlsIn, monsterLines, reportFocus, reportMonsters } from './monsters'

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
  state: GameState, report: Report, cast: SceneCastMember[], opts: { format?: ImagePreprocessor; multi: boolean; narration?: string; style?: string },
): Prompt {
  const loc = locationById(report.location.at)
  // 分流：帶親密場景的日誌才可以畫成人場景
  const adult = !!report.narration?.adult_scene
  const system = [
    '你是遊戲插圖的分鏡師。依使用者給的冒險日誌，設計一張最能代表這段經過的插圖，交給 AI 生圖。',
    '只輸出一個 JSON 物件，不要任何說明或程式碼框：',
    '{"rating": "general | suggestive | explicit", "scene": "整體畫面", "characters": [{"id": "登場角色的 id", "position": "left | center | right", "prompt": "這個角色"}]}',
    '規則：',
    `1. characters 只放畫面上看得清楚的人，最多 ${SCENE_MAX_CHARACTERS} 人，從「可以登場的人」裡選；主角通常要在。其他人（路人、敵人、怪物）寫在 scene 裡。`,
    `2. scene：人數（例如 2girls, 1boy）、地點與背景、時段與光線、氣氛、鏡頭與構圖${opts.style?.trim() ? '（畫風、畫師與畫質詞由程式另外接在最後，不要寫）' : '、畫風'}。不要寫各角色的外貌細節；登場的怪物寫在 scene 裡，要寫出牠們的種族特徵（例如 green skin, pointy ears, wolf ears, tail）。`,
    '3. 每個角色的 prompt：照提供的外貌描述畫（髮色、眼睛、種族特徵、體型不要改），加上服裝、表情、動作與姿勢；要和其他人的位置與互動對得上。',
    '4. position 是角色在畫面上的位置；兩個人時通常一左一右。',
    opts.multi ? '' : '5. 這個生圖服務不能分開描述每個人：scene 也要簡短交代每個人在哪裡、在做什麼（例如 on the left, on the right）。',
    adult
      ? '6. rating：一般場景 general；有性暗示、裸露 suggestive；性行為 explicit。成人場景照實畫，不要迴避。'
      : '6. 不要裸露、性暗示或血腥的內容；rating 一律 general。',
    '7. 不要寫出角色名字、地名或作品名稱。',
    opts.format
      ? `\nscene 與每個角色的 prompt 都照這份指示的寫法寫（只套用寫法，輸出仍然是上面的 JSON）：\n${opts.format.instructions.trim()}`
      : '\nscene 與每個角色的 prompt 都用英文自然語言描述。',
  ].filter(Boolean).join('\n')
  const user = [
    `地點：${loc.name}（${regionById(loc.region).name}）${report.location.scene ? `・${report.location.scene}` : ''}`,
    `時間：第 ${report.time.start.day} 天・${TIME_NAME(report.time.start.hour)}`,
    `經過：${report.outcome.summary ?? ''}`,
    report.check?.action ? `主角的行動：${report.check.action}` : '',
    report.narration?.player_intent ? `玩家描述的做法：${report.narration.player_intent}` : '',
    adult ? `這段是成人場景：${report.narration?.adult_scene}` : '',
    opts.narration ? `\n日誌正文：\n${opts.narration.slice(0, 1500)}` : '',
    '\n可以登場的人：',
    ...cast.map((c) => `- id: ${c.id}｜${c.player ? '主角' : '其他人'}｜${c.description}`),
    ...monsterScene(state, report),
  ].filter(Boolean).join('\n')
  return { system, user }
}

/** 登場的怪物（寫在 scene 裡）：外觀；魔物娘的設定打開時，標了「→」的畫成魔物娘（成年女性） */
function monsterScene(state: GameState, report: Report): string[] {
  const girls = monsterGirlsIn(state, reportFocus(report))
  const lines = monsterLines(reportMonsters(report), girls)
  if (!lines.length) return []
  const note = girls && lines.some((l) => l.includes(' → ')) ? '（標了「→」的畫成右邊的魔物娘：成年女性，保留原本種族的特徵）' : ''
  return [`\n登場的怪物（寫在 scene 裡）${note}：`, ...lines]
}

const POSITIONS: ScenePosition[] = ['left', 'center', 'right']

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
