import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setContentFilters, setDefeatAdult, setDefeatAlways, setDefeatCompanion, setMascBodyContent, type DefeatAdultMode, type FilterTag } from '@/engine/content'
import { companionRules, progression } from '@/engine/data'
import { gearRules } from '@/engine/gear'
import { setLongRestGap } from '@/engine/rest'
import { setStepMinutes, type StepPlace } from '@/engine/grid'
import mapsJson from '@data/world/maps.json'
import type { Report } from '@/engine/types'
import { PROVIDERS, type ProviderConfig, type ProviderId } from '@/narrator/providerInfo'
import { applyUiLanguage, type UiLanguage } from '@/i18n/uiScript'

const KEY = 'elondia.settings'

/** 畫面特效：全部、精簡（只留飄字、HP 殘影與橫幅）、關閉 */
export type FxLevel = 'full' | 'lite' | 'off'
/** 系統開了「減少動態效果」時預設精簡 */
function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 會呼叫 AI 的功能（見 docs/PROMPTS.md 第 1 節） */
export type AiFeature = 'narration' | 'adult' | 'judge' | 'roster' | 'shop' | 'negotiation' | 'tags' | 'designer'

export const AI_FEATURES: { id: AiFeature; name: string; desc: string; prose: boolean }[] = [
  { id: 'narration', name: '敘事正文', desc: '所有日誌的詳細經過：戰鬥、旅行、事件，以及主動行動判定之後的經過；也可以在每則日誌手動生成', prose: true },
  { id: 'adult', name: '成人場景正文', desc: '帶親密場景的日誌（娼館、主人的邀約、戰敗後的遭遇、AI 判定認為有親密場景的行動）改用這個來源寫經過；提示詞用套用到「成人場景」的文風與其他提示詞', prose: true },
  { id: 'judge', name: '主動行動判定', desc: '「擲骰的行動交給 AI 判定」開啟時：看骰值決定成敗與後果，只回傳 JSON；經過交給「敘事正文」（除非下方勾選「判定時順便寫出經過」）', prose: false },
  { id: 'roster', name: '居民潤飾', desc: '「AI 設計 → 居民」開啟時：到一個地點而有還沒潤飾的居民時（第一次來或新搬來的人），設計居民的名字、外貌與性格（JSON）', prose: false },
  { id: 'shop', name: '商店清單', desc: '「AI 設計 → 商店清單」開啟時：每間店每天第一次進店時，設計今天的交易清單（JSON）', prose: false },
  { id: 'negotiation', name: '談判方式', desc: '「AI 設計 → 談判方式」開啟時：開始談判時設計可以採取的方式（JSON）', prose: false },
  { id: 'tags', name: '插圖提示詞預處理', desc: '生成形象插圖前，依選的預處理指示改寫角色描述（例如轉成 Danbooru 標籤、JSON），插圖設定選了「生圖提示詞預處理」時才用；日誌插圖整理分鏡也用這個來源', prose: false },
  { id: 'designer', name: '世界設計', desc: '世界編輯器的「✨ AI 編排」：依一段描述編排新的特殊任務（大綱、完整內容與修正，JSON）；輸入很長，建議用推理強的模型', prose: false },
]

/** AI 設計：和擲骰無關、由 AI 生成內容的功能，各自開關（舊版跟著「AI 判定」一起開關） */
export type AiDesign = 'roster' | 'shop' | 'negotiation'
export const AI_DESIGNS: { id: AiDesign; name: string; desc: string }[] = [
  { id: 'roster', name: '居民', desc: '第一次到一個地點時，設計名單上居民的名字、外貌、性格與背景（種族、職業、等級、要價不變）' },
  { id: 'shop', name: '商店清單', desc: '每間店每天第一次進店時，設計今天的特別商品與收購（店名不經 AI）' },
  { id: 'negotiation', name: '談判方式', desc: '開始談判時，依對象與情境設計可以採取的方式' },
]

/** 「AI 判定」（擲骰的行動交給 AI）涵蓋的地方：設定頁與遊戲裡的勾選框說明用 */
export const AI_JUDGED_PLACES = '主動行動；這裡的人（交談、送禮、恭維、偷竊、提議……）；酒館的雇傭、邀請與黑市；殺價；王城衛兵；地標探索；休息時的互動；打工、娼館；打造、製作、種植與自創配方；爭取特質；談判裡自己描述的做法；身為奴隸時的談判、逃離、刻印與主人的事件；戰敗事件、戰後處置、對峙'

/** 模型來源：一組服務、key 與模型。每個來源對各服務各自保存設定，切換服務不會弄丟 key。 */
export interface ModelSource {
  name: string
  provider: ProviderId
  configs: Record<ProviderId, ProviderConfig>
}

/** 模型來源的數量：預設 3 個，可以新增到 SOURCE_MAX 個、刪到剩 1 個 */
export const SOURCE_COUNT = 3
export const SOURCE_MAX = 8

/** 自動寫出經過的日誌種類 */
export type NarrateKind = 'action' | 'combat' | 'travel' | 'event' | 'story' | 'rest' | 'social' | 'trade'

export const NARRATE_KINDS: { id: NarrateKind; name: string; desc: string }[] = [
  { id: 'action', name: '🎲 主動行動', desc: '擲骰判定的行動：聊天、送禮、偷竊、雇傭、談判、蒙混……' },
  { id: 'combat', name: '⚔️ 戰鬥', desc: '戰報' },
  { id: 'travel', name: '🧭 旅行', desc: '旅途與抵達' },
  { id: 'event', name: '📜 事件與委託', desc: '陷阱、採集、對峙、委託、旅途與城鎮的事件' },
  { id: 'story', name: '⭐ 特殊任務', desc: '特殊任務的每一步：劇情、判定、戰鬥' },
  { id: 'rest', name: '🛏️ 休息', desc: '短休、長休' },
  { id: 'social', name: '💬 交流', desc: '沒有擲骰的交流：直接雇用、城門、繳罰金……' },
  { id: 'trade', name: '🛒 交易', desc: '買賣（通常不需要）' },
]

/** 日誌屬於哪一種（決定要不要自動寫出經過） */
export function narrateKindOf(report: Report): NarrateKind {
  // 特殊任務的每一步（劇情、判定、戰鬥）都歸在這一類，單獨開關
  if (report.story) return 'story'
  if (report.check) return 'action'
  // 採集（日誌顯示成「行動」）：照設定的說明算「事件與委託」
  if (report.outcome.tags?.includes('採集')) return 'event'
  switch (report.kind) {
    case 'combat': return 'combat'
    case 'travel': return 'travel'
    case 'rest': return 'rest'
    case 'trade': return 'trade'
    case 'social': return 'social'
    case 'action': return 'action'
    default: return 'event'
  }
}

interface SavedSettings {
  sources: ModelSource[]
  /** 各功能使用哪一個來源（索引） */
  routes: Record<AiFeature, number>
  /** 判定與正文同一個來源時，判定順便寫出經過（省一次呼叫）；預設分開 */
  judgeWritesNarrative: boolean
  /** 開啟 AI 細節描述時，哪些日誌自動寫出經過 */
  narrateKinds: Record<NarrateKind, boolean>
  /** AI 細節描述：開啟時每次行動後自動請 AI 寫事件經過；關閉時只顯示戰報與事件簡述 */
  aiNarration: boolean
  /** AI 判定：擲骰的行動由 AI 看骰值判定並寫出經過；關閉時依規則判定 */
  aiJudge: boolean
  /** AI 設計：居民、商店清單、談判方式各自開關 */
  aiDesign: Record<AiDesign, boolean>
  /** 升級時的能力三選一，每組可以重抽的次數 */
  abilityRerolls: number
  /** 兩次長休至少隔幾小時（0～24） */
  longRestGap: number
  /** 走一格花幾分鐘（城鎮、近郊、冒險區域，0～60） */
  stepMinutes: Record<StepPlace, number>
  /** 建角時在職業模板之上挑裝備的預算（材料等級點數，見 docs/ITEMS.md 第 2.1 節） */
  creationGearBudget: number
  /** 完整保留最近幾則日誌（更早的封存，見 docs/SAVES.md 第 6 節） */
  logKeep: number
  /** 內容篩選：false 的標籤（NTR、非處女、主角非自願）的特殊任務與事件不出現 */
  contentFilters: Record<FilterTag, boolean>
  /** 戰敗色情事件：全部、男性形象的主角不發生、關閉 */
  defeatAdult: DefeatAdultMode
  /** 隊友的戰敗色情事件（主角不會遇到時改由隊友遇到）：全部的隊友、男性形象的隊友不發生、關閉 */
  defeatCompanion: DefeatAdultMode
  /** 陽剛體型也能遇到「只給陰柔、中性」的成人內容（預設關） */
  mascBodyContent: boolean
  /** 戰敗色情事件一定發生（不擲「敵人起意」） */
  defeatAlways: boolean
  /** 讀檔、開新遊戲前，先把目前（或還沒繼續）的進度存進自動存檔欄位 */
  backupBeforeSwitch: boolean
  language: 'zh-Hant' | 'zh-Hans'
  /** 介面語言（畫面上的文字；AI 的輸出語言是 language） */
  uiLanguage: UiLanguage
  /** 畫面特效；auto 跟著系統的「減少動態效果」 */
  effects: FxLevel | 'auto'
  /** 背景圖：依所在的地區、城鎮、地下城換背景（見 src/assets/backgrounds） */
  background: boolean
  /** 背景圖的亮度（百分比，20～100；越低越暗，面板上的字越清楚） */
  backgroundBrightness: number
  /** 有背景圖時面板的不透明度（百分比，40～100；100 = 完全不透） */
  panelOpacity: number
  loreBudget: number
}

function defaultConfigs(): Record<ProviderId, ProviderConfig> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel, ...(p.presets ? { baseURL: p.presets[0]!.baseURL } : {}) }]),
  ) as Record<ProviderId, ProviderConfig>
}

function defaultRoutes(): Record<AiFeature, number> {
  return Object.fromEntries(AI_FEATURES.map((f) => [f.id, 0])) as Record<AiFeature, number>
}

function defaultNarrateKinds(): Record<NarrateKind, boolean> {
  return Object.fromEntries(NARRATE_KINDS.map((k) => [k.id, k.id !== 'trade'])) as Record<NarrateKind, boolean>
}

function cloneSource(s: ModelSource, name: string): ModelSource {
  return { name, provider: s.provider, configs: JSON.parse(JSON.stringify(s.configs)) as Record<ProviderId, ProviderConfig> }
}

function defaults(): SavedSettings {
  const first: ModelSource = { name: '來源 1', provider: 'anthropic', configs: defaultConfigs() }
  return {
    sources: [first, cloneSource(first, '來源 2'), cloneSource(first, '來源 3')],
    routes: defaultRoutes(),
    judgeWritesNarrative: false,
    narrateKinds: defaultNarrateKinds(),
    aiNarration: false,
    aiDesign: { roster: false, shop: false, negotiation: false },
    aiJudge: false,
    abilityRerolls: progression.ability_rerolls,
    longRestGap: companionRules.rest.long_rest_gap_hours,
    stepMinutes: { ...mapsJson.generation.step_minutes },
    creationGearBudget: gearRules.creation.default_budget,
    logKeep: 200,
    contentFilters: { ntr: true, non_virgin: true, pc_unwilling: true, male_partner: true },
    defeatAdult: 'all',
    defeatCompanion: 'not_masc',
    mascBodyContent: false,
    defeatAlways: false,
    backupBeforeSwitch: true,
    language: 'zh-Hant',
    uiLanguage: 'zh-Hant',
    loreBudget: 12000,
    effects: 'auto',
    background: true,
    backgroundBrightness: 60,
    panelOpacity: 80,
  }
}

type OldSettings = Partial<SavedSettings> & { adult?: boolean; autoNarrate?: boolean; provider?: ProviderId; configs?: Record<ProviderId, ProviderConfig> }

function load(): SavedSettings {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as OldSettings
    // 舊版設定叫 autoNarrate
    const aiNarration = saved.aiNarration ?? saved.autoNarrate ?? base.aiNarration
    // 舊版只有一組服務設定：當作來源 1，來源 2、3 先複製一份（只要改模型就好）
    let sources = Array.isArray(saved.sources) ? saved.sources : null
    if (!sources) {
      const first: ModelSource = { name: '來源 1', provider: saved.provider ?? 'anthropic', configs: { ...defaultConfigs(), ...saved.configs } }
      sources = [first, cloneSource(first, '來源 2'), cloneSource(first, '來源 3')]
    }
    const count = Math.min(SOURCE_MAX, Math.max(1, sources.length))
    sources = Array.from({ length: count }, (_, i) => {
      const s = sources![i] ?? cloneSource(sources![0] ?? base.sources[0]!, `來源 ${i + 1}`)
      return { name: s.name || `來源 ${i + 1}`, provider: s.provider ?? 'anthropic', configs: { ...defaultConfigs(), ...s.configs } }
    })
    // 舊版沒有「成人場景正文」：和敘事正文用同一個來源
    const routes = { ...defaultRoutes(), ...(saved.routes ? { adult: saved.routes.narration ?? 0 } : {}), ...saved.routes }
    for (const k of Object.keys(routes) as AiFeature[]) if (!(routes[k] >= 0 && routes[k] < sources.length)) routes[k] = 0
    // 舊版的「成人向」開關已經拿掉
    const { autoNarrate: _a, provider: _p, configs: _c, adult: _adult, ...rest } = saved
    const defeatAdult = (['all', 'not_masc', 'off'] as const).includes(saved.defeatAdult as DefeatAdultMode) ? saved.defeatAdult! : base.defeatAdult
    const defeatCompanion = (['all', 'not_masc', 'off'] as const).includes(saved.defeatCompanion as DefeatAdultMode) ? saved.defeatCompanion! : base.defeatCompanion
    // 舊版的居民、商店清單、談判方式跟著「AI 判定」一起開關：沿用當時的狀態
    const designWas = saved.aiJudge ?? false
    const aiDesign = Object.fromEntries(AI_DESIGNS.map((d) => [d.id, typeof saved.aiDesign?.[d.id] === 'boolean' ? saved.aiDesign[d.id] : designWas])) as Record<AiDesign, boolean>
    return { ...base, ...rest, aiNarration, aiDesign, sources, routes, defeatAdult, defeatCompanion, contentFilters: { ...base.contentFilters, ...saved.contentFilters }, narrateKinds: { ...base.narrateKinds, ...saved.narrateKinds }, stepMinutes: { ...base.stepMinutes, ...saved.stepMinutes } }
  } catch {
    return base
  }
}

export const useSettings = defineStore('settings', () => {
  const initial = load()
  const sources = ref(initial.sources)
  const routes = ref(initial.routes)
  const judgeWritesNarrative = ref(initial.judgeWritesNarrative)
  const narrateKinds = ref(initial.narrateKinds)
  const aiNarration = ref(initial.aiNarration)
  const aiJudge = ref(initial.aiJudge)
  const aiDesign = ref(initial.aiDesign)
  const abilityRerolls = ref(initial.abilityRerolls)
  const longRestGap = ref(initial.longRestGap)
  // 引擎的長休間隔
  watch(longRestGap, (h) => setLongRestGap(h), { immediate: true })
  const stepMinutes = ref(initial.stepMinutes)
  // 引擎走一格的時間
  watch(stepMinutes, (m) => setStepMinutes(m), { immediate: true, deep: true })
  const creationGearBudget = ref(initial.creationGearBudget)
  const logKeep = ref(initial.logKeep)
  // 引擎的內容篩選與戰敗事件設定
  const contentFilters = ref(initial.contentFilters)
  watch(contentFilters, (f) => setContentFilters(f), { immediate: true, deep: true })
  const defeatAdult = ref(initial.defeatAdult)
  watch(defeatAdult, setDefeatAdult, { immediate: true })
  const defeatCompanion = ref(initial.defeatCompanion)
  watch(defeatCompanion, setDefeatCompanion, { immediate: true })
  const mascBodyContent = ref(initial.mascBodyContent === true)
  watch(mascBodyContent, setMascBodyContent, { immediate: true })
  const defeatAlways = ref(initial.defeatAlways === true)
  watch(defeatAlways, setDefeatAlways, { immediate: true })
  const backupBeforeSwitch = ref(initial.backupBeforeSwitch !== false)
  const language = ref(initial.language)
  const uiLanguage = ref(initial.uiLanguage)
  watch(uiLanguage, applyUiLanguage, { immediate: true })
  const loreBudget = ref(initial.loreBudget)
  const effects = ref(initial.effects)
  /** 實際用的特效等級 */
  const effectsLevel = (): FxLevel => (effects.value === 'auto' ? (reducedMotion() ? 'lite' : 'full') : effects.value)
  // 樣式表用 html[data-fx] 決定播哪些 CSS 動畫
  watch(effects, () => {
    if (typeof document !== 'undefined') document.documentElement.dataset.fx = effectsLevel()
  }, { immediate: true })
  const background = ref(initial.background)
  const backgroundBrightness = ref(initial.backgroundBrightness)
  const panelOpacity = ref(initial.panelOpacity)

  watch(
    [sources, routes, judgeWritesNarrative, narrateKinds, aiNarration, aiJudge, aiDesign, abilityRerolls, longRestGap, stepMinutes, creationGearBudget, logKeep, contentFilters, defeatAdult, defeatCompanion, mascBodyContent, defeatAlways, backupBeforeSwitch, language, uiLanguage, loreBudget, effects, background, backgroundBrightness, panelOpacity],
    () => {
      const data: SavedSettings = {
        sources: sources.value,
        routes: routes.value,
        judgeWritesNarrative: judgeWritesNarrative.value,
        narrateKinds: narrateKinds.value,
        aiNarration: aiNarration.value,
        aiJudge: aiJudge.value,
        aiDesign: { ...aiDesign.value },
        abilityRerolls: abilityRerolls.value,
        // 欄位清空時存成預設，下次打開設定不會是空的
        longRestGap: typeof longRestGap.value === 'number' && Number.isFinite(longRestGap.value) ? longRestGap.value : companionRules.rest.long_rest_gap_hours,
        // 清空的欄位存成預設
        stepMinutes: Object.fromEntries(Object.entries(mapsJson.generation.step_minutes).map(([k, d]) => {
          const v = stepMinutes.value[k as StepPlace] as number | string
          return [k, v === '' || !Number.isFinite(Number(v)) ? d : Math.max(0, Math.min(60, Math.round(Number(v))))]
        })) as Record<StepPlace, number>,
        creationGearBudget: gearBudget(),
        logKeep: logKeep.value,
        contentFilters: { ...contentFilters.value },
        defeatAdult: defeatAdult.value,
        defeatCompanion: defeatCompanion.value,
        mascBodyContent: mascBodyContent.value,
        defeatAlways: defeatAlways.value,
        backupBeforeSwitch: backupBeforeSwitch.value,
        language: language.value,
        uiLanguage: uiLanguage.value === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant',
        loreBudget: loreBudget.value,
        effects: effects.value,
        background: background.value !== false,
        backgroundBrightness: Math.max(20, Math.min(100, Math.round(Number(backgroundBrightness.value) || 60))),
        panelOpacity: Math.max(40, Math.min(100, Math.round(Number(panelOpacity.value) || 80))),
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(data))
      } catch {
        // 無痕模式等情況下寫不進去，設定只在本次有效
      }
    },
    { deep: true },
  )

  function sourceReady(i: number): boolean {
    const s = sources.value[i]
    if (!s) return false
    const cfg = s.configs[s.provider]
    const info = PROVIDERS.find((p) => p.id === s.provider)!
    return !!cfg.model && (!!cfg.apiKey || !!info.keyOptional) && (!info.needsBaseURL || !!cfg.baseURL)
  }

  /** 功能使用的來源 */
  function sourceIndex(feature: AiFeature): number {
    return routes.value[feature] ?? 0
  }

  /** 呼叫 AI 用的服務與設定 */
  function sourceFor(feature: AiFeature): { index: number; name: string; provider: ProviderId; config: ProviderConfig } {
    const index = sourceIndex(feature)
    const s = sources.value[index] ?? sources.value[0]!
    return { index, name: s.name, provider: s.provider, config: s.configs[s.provider] }
  }

  /** 功能的來源設定完成了嗎（不指定時：任何一個功能能用就算） */
  const ready = (feature?: AiFeature) =>
    feature ? sourceReady(sourceIndex(feature)) : AI_FEATURES.some((f) => sourceReady(sourceIndex(f.id)))

  /** 擲骰的行動要不要交給 AI 判定：開啟而且判定的來源設定好了 */
  const judgesWithAi = () => aiJudge.value && ready('judge')
  /** 這項 AI 設計要不要呼叫 AI：開啟而且來源設定好了 */
  const designs = (d: AiDesign) => aiDesign.value[d] && ready(d)

  /** 判定只回傳 JSON，經過交給敘事正文：預設如此；只有勾選「順便寫出經過」而且同一個來源時才合併 */
  const splitJudgeNarrative = () => !judgeWritesNarrative.value || sourceIndex('judge') !== sourceIndex('narration')

  /** 寫這則日誌的經過用哪個功能的來源：帶親密場景用「成人場景正文」 */
  function narrationFeature(report: Report): 'narration' | 'adult' {
    return report.narration?.adult_scene ? 'adult' : 'narration'
  }

  /** 這則日誌要不要自動寫出經過：AI 判定的主動行動只看種類開關，其他還要開啟 AI 細節描述 */
  function autoNarrates(report: Report): boolean {
    const kind = narrateKindOf(report)
    if (!narrateKinds.value[kind]) return false
    // AI 判定的行動（含特殊任務的判定）：判定時就寫了經過，關掉 AI 細節描述也照樣顯示
    return aiNarration.value || report.check?.source === 'ai'
  }

  /** 新增一個來源（先複製來源 1 的服務與 key，只要改模型就好）；回傳新來源的位置，到上限時 -1 */
  function addSource(): number {
    if (sources.value.length >= SOURCE_MAX) return -1
    const names = new Set(sources.value.map((s) => s.name))
    let n = sources.value.length + 1
    while (names.has(`來源 ${n}`)) n++
    sources.value.push(cloneSource(sources.value[0]!, `來源 ${n}`))
    return sources.value.length - 1
  }

  /** 刪掉一個來源（至少留一個）：用它的功能改用第一個來源，後面的來源往前移 */
  function removeSource(index: number) {
    if (sources.value.length <= 1 || !sources.value[index]) return
    sources.value.splice(index, 1)
    for (const k of Object.keys(routes.value) as AiFeature[]) {
      const r = routes.value[k]
      routes.value[k] = r === index ? 0 : r > index ? r - 1 : r
    }
  }

  /** 把一個來源的設定複製到另一個（例如只想換模型） */
  function copySource(from: number, to: number) {
    const src = sources.value[from]
    if (!src || !sources.value[to] || from === to) return
    sources.value[to] = cloneSource(src, sources.value[to]!.name)
  }

  /** 重抽次數（夾在 0～99） */
  const rerollLimit = () => Math.max(0, Math.min(99, Math.floor(Number(abilityRerolls.value) || 0)))
  /** 建角裝備的預算（夾在 0～max_budget；欄位清空時用預設） */
  function gearBudget(): number {
    const v = creationGearBudget.value as number | string | null
    const n = typeof v === 'number' ? v : v === '' || v == null ? NaN : Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(gearRules.creation.max_budget, Math.floor(n))) : gearRules.creation.default_budget
  }
  /** 完整保留的日誌數（夾在 50～5000） */
  const logKeepLimit = () => Math.max(50, Math.min(5000, Math.floor(Number(logKeep.value) || 200)))

  return {
    sources, routes, judgeWritesNarrative, narrateKinds, autoNarrates, aiNarration, aiJudge, aiDesign, judgesWithAi, designs, abilityRerolls, rerollLimit, longRestGap, stepMinutes, creationGearBudget, gearBudget, logKeep, logKeepLimit, contentFilters, defeatAdult, defeatCompanion, mascBodyContent, defeatAlways, backupBeforeSwitch, language, uiLanguage, loreBudget, effects, effectsLevel, background, backgroundBrightness, panelOpacity,
    sourceReady, sourceIndex, sourceFor, ready, splitJudgeNarrative, narrationFeature, copySource, addSource, removeSource,
  }
})
