import { defineStore } from 'pinia'
import { toSimplifiedText } from '@/engine/script'
import { consign, placeBid } from '@/engine/auction'
import { orderOutfit } from '@/engine/outfitTailor'
import { fuseGear, splitGear } from '@/engine/fusion'
import { startArena } from '@/engine/arena'
import { leavePark } from '@/engine/park'
import { charmGatePass } from '@/engine/charm'
import { DIFFICULTY_DEFS, sanitizeRules, type NumericRule } from '@/engine/gameRules'
import { enterLandmark, playLandmarkScene, visitLandmark } from '@/engine/landmarks'
import * as perkActions from '@/engine/perkActions'
import * as townEvents from '@/engine/townEvents'
import { setPcTags } from '@/engine/pcTags'
import * as dungeonEvents from '@/engine/dungeonEvents'
import * as parasiteEvents from '@/engine/parasiteEvents'
import * as deadlines from '@/engine/deadlines'
import * as restraints from '@/engine/restraints'
import { pitchTarget } from '@/engine/perks'
import { noteBystanders } from '@/engine/activities'
import { computed, ref, toRaw, watch } from 'vue'
import * as actions from '@/engine/actions'
import * as combat from '@/engine/combat'
import * as companions from '@/engine/companions'
import * as rest from '@/engine/rest'
import * as trade from '@/engine/trade'
import * as negotiation from '@/engine/negotiation'
import * as inventory from '@/engine/inventory'
import * as masterTool from '@/engine/masterTool'
import * as ownerTraining from '@/engine/ownerTraining'
import * as brothelLife from '@/engine/brothelLife'
import * as meals from '@/engine/meals'
import { classes, shopRules, slaveryRules, type ShopType } from '@/engine/data'
import { syncGear } from '@/engine/gear'
import { migrate, newGame, player } from '@/engine/state'
import * as grid from '@/engine/grid'
import * as specialMaps from '@/engine/specialMaps'
import * as masterHome from '@/engine/masterHome'
import * as population from '@/engine/population'
import * as encounters from '@/engine/encounters'
import * as captives from '@/engine/captives'
import * as security from '@/engine/security'
import * as slavery from '@/engine/slavery'
import * as defeat from '@/engine/defeat'
import * as social from '@/engine/social'
import * as story from '@/engine/story'
import * as npcLife from '@/engine/npcLife'
import { editProfile, spendAttrPoint, type ProfilePatch } from '@/engine/character'
import type { Attrs, AttrId } from '@/engine/data'
import type { NewGameOptions } from '@/engine/state'
import * as town from '@/engine/town'
import * as tattooShop from '@/engine/tattooShop'
import { markPromoted } from '@/engine/promoteNpc'
import * as road from '@/engine/road'
import * as homes from '@/engine/homes'
import * as away from '@/engine/away'
import * as partyEngine from '@/engine/party'
import * as garden from '@/engine/garden'
import * as invention from '@/engine/invention'
import type { DefeatLoot, Difficulty, GameState, GearSlot, LewdStat, Report, TattooPlace } from '@/engine/types'
import {
  buildNegotiationPrompt, buildNewsPrompt, buildRosterPrompt, buildShopPrompt, extractJson, splitSuggestions,
} from '@/narrator/judge'
import type { Prompt } from '@/narrator/prompt'
import { providerInfo, type ProviderId, type TokenUsage } from '@/narrator/providerInfo'
import type { ContentMods } from '@/engine/mods'
import { useContent, VANILLA, VANILLA_NAME, type WorldRef } from './content'
import { usePortraits } from './portraits'
import { usePrompts } from './prompts'
import { useScenes } from './scenes'
import { AI_FEATURES, useSettings, type AiFeature } from './settings'
import { archiveOldReports, mergeUsage } from './logArchive'
import { actionInputOf, firstNewReport, midTurn, restoreTurn, UNDO_STEPS, type UndoStep } from './undo'
import { withoutIcons } from '@/engine/itemIcons'
import {
  AUTO_SLOTS, currentStore, parseSaveFile, QUICK_SLOT, saveFileName, slotMeta, slotStore, slotTitle, takePreloaded,
  type CurrentData, type SaveData, type SlotMeta,
} from './saves'

export { ARCHIVE_USAGE } from './logArchive'

/** 不屬於任何一則日誌的 AI 呼叫（酒館候選人、商店清單、談判方式、失敗的判定、回退掉的日誌） */
export const OTHER_USAGE = '_other'

export interface UsageEntry {
  input: number
  output: number
  calls: number
  /** 輸入中讀取提示詞快取的部分 */
  cached?: number
  /** 依來源分開的用量（哪個功能、哪個模型來源、服務與模型）；舊紀錄沒有 */
  by?: UsagePart[]
}

/** 一次 AI 呼叫的來源：功能、模型來源的名稱、服務與模型 */
export interface UsageOrigin {
  feature: AiFeature
  source: string
  provider: ProviderId
  model: string
}

export interface UsagePart extends UsageOrigin {
  input: number
  output: number
  calls: number
  cached?: number
}

function sameOrigin(a: UsageOrigin, b: UsageOrigin): boolean {
  return a.feature === b.feature && a.source === b.source && a.provider === b.provider && a.model === b.model
}

/** 來源的顯示文字：「來源名（服務 模型）」；舊紀錄沒有記下來源 */
export function usageSourceLabel(o: Pick<UsageOrigin, 'source' | 'provider' | 'model'>): string {
  if (!o.provider) return '未記錄來源'
  const service = [providerInfo(o.provider)?.name, o.model].filter(Boolean).join(' ')
  return o.source ? `${o.source}（${service}）` : service
}

export function usageFeatureName(f: AiFeature): string {
  return AI_FEATURES.find((x) => x.id === f)?.name ?? f
}

function parseJson<T>(raw: string | undefined): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** 儲存失敗的原因（給玩家看） */
function saveFailure(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'QuotaExceededError') return '瀏覽器的儲存空間不足'
  return e instanceof Error ? e.message : String(e)
}

export interface NarrationState {
  text: string
  status: 'streaming' | 'done' | 'error'
  /** 玩家手動要求的（AI 細節描述關閉時也顯示） */
  manual?: boolean
  error?: string
  /** 寫敘事時模型的思考過程（服務有回傳時） */
  thinking?: string
  /** AI 判定時模型的思考過程 */
  judgeThinking?: string
  /** 只是為了存判定的思考過程，還沒有敘事 */
  placeholder?: boolean
}

export interface ImportPreview {
  meta: SlotMeta
  /** 存檔用的世界 */
  world?: WorldRef
  /** 首頁匯入時會用附帶的內容建立的新世界名稱 */
  newWorld?: string
  /** 遊戲中匯入、世界不同：不能匯入的原因 */
  blocked?: string
  portraits: number
}

/** 自訂內容的項目數 */
function modCount(m: ContentMods): number {
  return Object.values(m).reduce((n, v) => n + (v && typeof v === 'object' ? Object.keys(v).length : 0), 0)
}

/** 移動之後：附近有敵對的冒險者時開始對峙 */
function afterMove(s: GameState, r: grid.StepResult): grid.StepResult {
  if (r.combat || r.report) return r
  // 敵對的冒險者優先；被主人帶著時可能有主人的突發事件（等待回應，顯示在主動行動面板）
  const report = encounters.checkHostiles(s)
  if (report) return { report }
  // 戰敗時逃開的同伴：回到聚落或安全房時歸隊
  const back = companions.rejoinAway(s)
  if (back) return { report: back }
  // 旅途上主人的事件出發時就放在格子上了
  if (!s.road || s.side) slavery.maybeMasterEvent(s, slaveryRules.master_events.step_chance)
  // 城鎮事件（事件導演）：走上設施時可能遇到一件事
  const town = townEvents.maybeTownEvent(s)
  if (town.report) return { report: town.report }
  // 寄生物的發作：旅途上一格一天，其他地方一步
  parasiteEvents.maybeParasiteEvent(s, s.road && !s.side ? 'travel' : 'step')
  return r
}

/** 讀入存檔：補上新欄位，舊存檔沒有格子位置時放到目前地點的入口。 */
function load(s: GameState): GameState {
  migrate(s)
  // 自訂內容刪掉的特殊任務：中斷，任務同行的夥伴離隊
  story.pruneStories(s)
  // 自訂內容刪掉的事件：等待中的作廢
  road.pruneRoadEvent(s)
  townEvents.pruneTownEvent(s)
  dungeonEvents.pruneDungeonEvent(s)
  parasiteEvents.pruneParasiteEvent(s)
  // 武器與防具類型由裝備決定（自訂內容可能改過底材）
  for (const m of s.party) if (m.gear) syncGear(m, classes[m.class]?.weapon)
  // 主人的家：先對齊格局（舊格局的樓層、超出範圍的座標改到一樓出口），再檢查位置
  masterHome.syncMasterHome(s)
  // 地圖改版後舊的區塊可能不存在了：回到這個地點的城門
  if (s.position) {
    try {
      grid.getArea(s, s.position.area)
    } catch {
      delete s.position
    }
  }
  if (!s.position) grid.enterLocation(s)
  population.ensureRoster(s, s.location)
  population.refreshRosters(s)
  return s
}

export const useGame = defineStore('game', () => {
  // 進行中的遊戲（自動保存的那一份）：啟動時只讀出來放著，在首頁按「繼續」才載入
  const boot = takePreloaded()
  const resume = ref<CurrentData | null>(boot.state ? boot : null)
  /** 「繼續」按鈕上的摘要（讀不了時 null） */
  const resumeMeta = computed<SlotMeta | null>(() => {
    if (!resume.value?.state) return null
    try {
      return slotMeta('current', '進行中的遊戲', 'auto', { state: JSON.parse(resume.value.state) as GameState })
    } catch {
      return null
    }
  })
  const state = ref<GameState | null>(null)
  // 改內容篩選：被關掉的特殊任務暫停或繼續，地圖上的任務點（⭐）跟著拿掉或放回（在設定套用之後）
  watch(() => useSettings().contentFilters, () => {
    if (state.value) story.refreshStoryMarkers(state.value)
  }, { flush: 'post', deep: true })
  const narrations = ref<Record<string, NarrationState>>({})
  /** token 用量：日誌 id（或 OTHER_USAGE）→ 累計 */
  const usage = ref<Record<string, UsageEntry>>({})
  const error = ref<string | null>(null)
  /** 有進行中的遊戲（已經載入，或還沒按「繼續」） */
  const hasProgress = computed(() => !!state.value || !!resume.value)
  /** 自動保存失敗：一直顯示到下一次保存成功 */
  const saveWarning = ref<string | null>(null)
  /** AI 正在判定主動行動 */
  const judging = ref(false)
  /** 行動備註：下一次委託或旅行時交給 AI 的玩家意圖 */
  const intent = ref('')
  /** 主動行動的對象：第一位是主要對象，其他是同行的對象（「這裡的人」可以直接帶入） */
  const actionTargets = ref<string[]>([])
  /** 存檔欄位列表（新的在前） */
  const slots = ref<SlotMeta[]>([])
  /** 畫面上方短暫顯示的提示（例如「已快速存檔」） */
  const notice = ref<string | null>(null)
  /** 往過不去的方向移動的次數（地圖用來播放撞牆的動畫） */
  const bump = ref(0)
  /** 騰出位子的對話框（MakeRoomDialog.vue）：隊伍放不下時先讓同伴留守、寄放或離隊，騰出 need 個位子後執行 then */
  const makeRoom = ref<{ need: number; title: string; follow?: boolean; then: () => unknown } | null>(null)
  /** 有 need 個空位就直接執行，不夠時打開騰出位子的對話框（follow：以跟著別人隊伍的上限計） */
  function requireRoom(need: number, title: string, then: () => unknown, follow = false) {
    const s = state.value
    if (!s) return
    const room = follow ? partyEngine.followRoom(s) : partyEngine.partyRoom(s)
    if (room >= need) {
      then()
      return
    }
    makeRoom.value = { need, title, then, ...(follow ? { follow } : {}) }
  }
  /** 撞牆或規則不讓走時的提示（「那邊走不過去」「旅途只能往前走」「要出門，先請求主人同意」……） */
  const bumpText = ref('')
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const controllers = new Map<string, AbortController>()

  const pc = computed(() => (state.value ? player(state.value) : null))
  // 畫面共用的「現在所在的地方」：同一個狀態下只算一次，各面板不用各自重算（Vue 的 computed 會記住，相關的狀態改了才重算）。
  // 只在遊戲畫面（有進行中的遊戲）讀
  const here = computed(() => population.peopleHere(state.value!))
  const area = computed(() => grid.currentArea(state.value!))
  const cell = computed(() => grid.currentCell(state.value!))

  // 自動保存：每次動作後把整份遊戲寫進 IndexedDB。寫入是非同步的，寫到一半又有新的動作時，
  // 只保留最新的一份，等這次寫完再寫
  let pendingWrite: CurrentData | null = null
  let writing: Promise<void> | null = null

  function save() {
    cancelSaveSoon()
    // 沒有進行中的遊戲（例如啟動時讀不了）：不要拿空的資料蓋掉原本的存檔
    if (!state.value) return
    // 用原始物件序列化：直接序列化響應式物件，每個欄位都要經過 Vue 的代理，存檔大的時候一次要十幾毫秒
    const finished = Object.fromEntries(Object.entries(toRaw(narrations.value)).filter(([, n]) => n.status === 'done'))
    pendingWrite = {
      state: JSON.stringify(toRaw(state.value)),
      narrations: JSON.stringify(finished),
      usage: JSON.stringify(toRaw(usage.value)),
    }
    writing ??= flushSave()
  }

  // 一般動作之後的自動保存延到畫面更新之後（先讓玩家看到結果，再花時間序列化）；
  // 離開頁面或切到背景時馬上存
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let saveFrame: number | undefined
  function saveSoon() {
    if (saveTimer !== undefined || saveFrame !== undefined) return
    const later = () => {
      saveFrame = undefined
      saveTimer = setTimeout(() => {
        saveTimer = undefined
        save()
      }, 0)
    }
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') saveFrame = requestAnimationFrame(later)
    else later()
  }
  function cancelSaveSoon() {
    if (saveFrame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(saveFrame)
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveFrame = undefined
    saveTimer = undefined
  }
  /** 還沒寫出的自動保存馬上寫（離開頁面、切到背景、讀檔前） */
  function saveNow() {
    if (saveTimer !== undefined || saveFrame !== undefined) save()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', saveNow)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow()
    })
  }

  async function flushSave() {
    try {
      while (pendingWrite) {
        const data = pendingWrite
        pendingWrite = null
        try {
          await currentStore().write(data)
          saveWarning.value = null
        } catch (e) {
          saveWarning.value = `自動保存失敗（${saveFailure(e)}）：重新整理或關掉頁面會失去最近的進度。請先用「💾 存讀檔」匯出存檔，或刪掉用不到的存檔欄位與形象圖再繼續。`
        }
      }
    } finally {
      writing = null
    }
  }

  /** 等目前的自動保存寫完（測試與讀檔前用） */
  async function flushed(): Promise<void> {
    saveNow()
    while (writing) await writing
  }

  /** 執行引擎動作；錯誤訊息顯示在畫面上而不是丟出。 */
  /** onMap：移動類的動作做不到時（主人不讓你出門、奴隸不能出城……），提示顯示在地圖上，不跳出錯誤訊息 */
  function run<T>(fn: (s: GameState) => T, opts: { narrate?: boolean; onMap?: boolean } = {}): T | undefined {
    if (!state.value) return undefined
    error.value = null
    // 動作中途出錯時還原成動作之前的狀態（不會留下改到一半的存檔）
    const before = snapshotState(state.value)
    const lastReport = state.value.reports.at(-1)?.report_id
    try {
      const result = fn(state.value)
      // 期限：逾期的委託與特殊任務（各自產生報告）
      deadlines.expireDeadlines(state.value)
      // NPC 自己的日子：每 X 天替在乎的冒險者擲一次（npcLife.ts）
      const lived = npcLife.tickNpcLife(state.value)
      // 離開了按過「稍候」的任務點：之後再來會再觸發
      story.forgetStoryWaits(state.value)
      // 日誌太長時把舊的封存（token 用量另外合計，見 logArchive.ts）
      archiveOldReports(state.value, useSettings().logKeepLimit(), narrations.value, usage.value)
      recordTurn(before, lastReport)
      saveSoon()
      const settings = useSettings()
      // 第一次產生關係的人：插圖設定開了自動畫時，排隊畫他的形象圖（已經有的不畫）
      const met = Object.keys(state.value.relationships ?? {}).filter((id) => !before.relationships?.[id])
      if (met.length) usePortraits().autoPortraits(state.value, met)
      // 近況交給 AI 寫：每次擲骰時（這次有變化的人），或重逢時（身邊有還沒寫的人）
      if (settings.npcLife && settings.npcLifeAi === 'roll' && lived.length) void polishNews(lived)
      else if (settings.npcLife && settings.npcLifeAi === 'reunion') polishReunions()
      const report = isReport(result) ? result : hasReport(result) ? result.report : undefined
      // 旁邊的人在做什麼：交給敘事當背景（不用 AI，見 activities.ts）
      if (report) noteBystanders(state.value, report)
      // 自動存檔：長休、抵達目的地
      if (report?.kind === 'rest' && report.outcome.tags?.includes('長休')) void autoSave('長休')
      if (report?.kind === 'travel' && report.outcome.result === 'arrived') void autoSave('抵達')
      if (opts.narrate !== false && report && settings.autoNarrates(report) && settings.ready(settings.narrationFeature(report))) {
        void narrate(report)
      }
      return result
    } catch (e) {
      state.value = before
      const msg = e instanceof Error ? e.message : String(e)
      if (opts.onMap) blockedOnMap(msg)
      else error.value = msg
      return undefined
    }
  }

  // ---- 回退（undo.ts）：最近 UNDO_STEPS 輪開始前的狀態，只放在記憶體 ----
  let undoStack: UndoStep[] = []
  /** 進行中這一輪開始前的狀態（產生日誌時記進 undoStack） */
  let turnStart: GameState | null = null
  /** 畫面用：可以回退到哪幾則日誌之前（舊的在前） */
  const undoReports = ref<string[]>([])
  /** 剛回退掉的是主動行動：可以用同樣的行動重擲 */
  const redoInput = ref<actions.ActionInput | null>(null)

  function syncUndo() {
    undoReports.value = undoStack.map((u) => u.report)
  }

  function clearUndo() {
    undoStack = []
    turnStart = null
    redoInput.value = null
    syncUndo()
  }

  /** 動作成功之後：記下這一輪開始前的狀態；產生了新的日誌就算一輪 */
  function recordTurn(before: GameState, lastReport: string | undefined) {
    if (!turnStart || !midTurn(before)) turnStart = before
    const report = firstNewReport(state.value!, lastReport)
    if (!report) return
    undoStack.push({ state: turnStart, report, ...(before.pendingAction ? { redo: actionInputOf(before.pendingAction) } : {}) })
    if (undoStack.length > UNDO_STEPS) undoStack.shift()
    turnStart = null
    redoInput.value = null
    syncUndo()
  }

  /** 回退：撤銷到 report 那一則日誌之前（不給時撤銷最近一輪）。被撤銷的日誌的敘事一起刪掉，token 用量算在「其他」 */
  function undo(report?: string): boolean {
    const s = state.value
    if (!s || judging.value || !undoStack.length) return false
    const i = report ? undoStack.findIndex((u) => u.report === report) : undoStack.length - 1
    if (i < 0) return false
    const step = undoStack[i]!
    const steps = undoStack.length - i
    undoStack = undoStack.slice(0, i)
    turnStart = null
    const { state: restored, removed } = restoreTurn(toRaw(s), step.state)
    for (const id of removed) {
      controllers.get(id)?.abort()
      delete narrations.value[id]
      const u = usage.value[id]
      if (u) {
        mergeUsage((usage.value[OTHER_USAGE] ??= { input: 0, output: 0, calls: 0 }), u)
        delete usage.value[id]
      }
    }
    state.value = restored
    error.value = null
    redoInput.value = step.redo ?? null
    syncUndo()
    save()
    flash(`↶ 已回退 ${steps} 步`)
    return true
  }

  /** 回退之後用同樣的行動重擲 */
  async function redo() {
    const input = redoInput.value
    if (!input) return
    redoInput.value = null
    await perform(input)
  }

  // ---- NPC 自己的日子（npcLife.ts）：近況交給 AI 寫 ----
  const polishing = new Set<string>()

  /** 請 AI 把這些人還沒寫的近況寫成一段（失敗時保留規則寫的短句） */
  async function polishNews(ids: string[]) {
    const s = state.value
    const settings = useSettings()
    if (!s || !settings.ready('life')) return
    const items = ids.filter((id) => !polishing.has(id))
      .map((id) => ({ id, news: npcLife.newsOf(s, id).filter((n) => !n.story) }))
      .filter((x) => x.news.length)
    const built = buildNewsPrompt(s, items)
    if (!built) return
    // 近況是給玩家看的正文：輸出簡體時整份提示詞轉成簡體（和敘事一樣，docs/I18N.md 第 4 節）
    const prompt = settings.language === 'zh-Hans' ? { system: toSimplifiedText(built.system), user: toSimplifiedText(built.user) } : built
    for (const x of items) polishing.add(x.id)
    const src = settings.sourceFor('life')
    try {
      const { completeText } = await import('@/narrator/providers')
      const raw = extractJson(await completeText(src.provider, src.config, prompt, undefined, (u) => addUsage(OTHER_USAGE, u, originOf('life', src)))) as { news?: { id: string; day: number; story: string }[] }
      // 等 AI 的時候讀了別的檔：不要寫進去
      if (state.value !== s) return
      npcLife.applyNewsStories(s, Array.isArray(raw.news) ? raw.news : [])
      save()
    } catch (e) {
      error.value = `AI 寫 NPC 近況失敗：${e instanceof Error ? e.message : String(e)}（先用簡短的近況）`
    } finally {
      for (const x of items) polishing.delete(x.id)
    }
  }

  /** 重逢時才寫：身邊（含隊上）有還沒寫近況的人 */
  function polishReunions() {
    const s = state.value
    if (!s?.npcLife || !Object.values(s.npcLife.news).some((list) => list.some((n) => !n.story))) return
    const near = new Set([...s.party.map((m) => m.id), ...population.nearbyPeople(s).map((p) => p.rec.id)])
    const ids = Object.keys(s.npcLife.news).filter((id) => near.has(id) && npcLife.newsOf(s, id).some((n) => !n.story))
    if (ids.length) void polishNews(ids)
  }

  /** 動作前的一份複本（裡面混進響應式物件時改用 JSON） */
  function snapshotState(s: GameState): GameState {
    // 日誌與封存只會在動作中加在後面（不改舊的），複製陣列就夠了：存檔大的時候整份深複製要好幾毫秒
    const { reports, logArchive, ...rest } = toRaw(s)
    let copy: GameState
    try {
      copy = structuredClone(rest) as GameState
    } catch {
      copy = JSON.parse(JSON.stringify(rest)) as GameState
    }
    copy.reports = [...reports]
    if (logArchive) copy.logArchive = [...logArchive]
    return copy
  }

  /** 走一格（方向鍵、點旁邊的格子、點遠處時一格一格走）。撞牆不算錯誤：地圖上輕輕晃一下就好；規則不讓走的也一樣 */
  function move(dx: number, dy: number) {
    const blocked = state.value && !state.value.combat ? grid.blockedMove(state.value, dx, dy) : null
    if (blocked) {
      blockedOnMap(blocked)
      return undefined
    }
    return run((s) => afterMove(s, grid.move(s, dx, dy)), { onMap: true })
  }

  // ---- 點地圖上的格子走過去（grid.pathTo）：一格一格走（和方向鍵一樣的規則），路上有事就停 ----
  /** 正在走去的格子（地圖標出來） */
  const walkTarget = ref<{ x: number; y: number } | null>(null)
  let walkTimer: ReturnType<typeof setTimeout> | undefined
  /** 每一步的間隔：和地圖上角色滑過一格的動畫差不多 */
  const WALK_STEP_MS = 140

  function stopWalk() {
    clearTimeout(walkTimer)
    walkTimer = undefined
    walkTarget.value = null
  }

  /** 走完這一步之後有要先處理的事（戰鬥、事件、等待判定、擋路的任務點……）：停下來 */
  function mustStop(s: GameState): boolean {
    return !!(s.combat || s.pendingAction || s.pendingDefeat || s.pendingMark || s.pendingMasterEvent || s.townEvent || s.roadEvent || s.dungeonEvent || s.parasiteEvent || story.blockingNode(s))
  }

  function walkTo(x: number, y: number) {
    stopWalk()
    const s = state.value
    if (!s || s.combat) return
    const path = grid.pathTo(s, x, y)
    if (!path) {
      blockedOnMap('到不了那裡：只能走已經探索過、沒有東西擋路的地方')
      return
    }
    walkTarget.value = { x, y }
    const areaKey = grid.currentArea(s).key
    const stepAt = (i: number) => {
      walkTimer = undefined
      const now = state.value
      const t = path[i]
      if (!now || !t || grid.currentArea(now).key !== areaKey) return stopWalk()
      const p = grid.position(now)
      const r = move(t.x - p.x, t.y - p.y)
      const after = state.value
      const there = after && grid.position(after)
      // 沒走成、發生了事、或到了終點：停
      if (!r || r.combat || r.report || !after || mustStop(after) || there?.x !== t.x || there.y !== t.y || i + 1 >= path.length) return stopWalk()
      walkTimer = setTimeout(() => stepAt(i + 1), WALK_STEP_MS)
    }
    stepAt(0)
  }

  /** 地圖上的提示：主角那一格晃一下，地圖角落顯示原因 */
  function blockedOnMap(text: string) {
    bumpText.value = text
    bump.value++
  }

  function isReport(x: unknown): x is Report {
    return typeof x === 'object' && x !== null && 'report_id' in x
  }

  /** 記下一次呼叫的用量：日誌（或「其他」）的合計，以及依來源分開的明細 */
  function addUsage(key: string, u: TokenUsage, origin: UsageOrigin) {
    const e = (usage.value[key] ??= { input: 0, output: 0, calls: 0 })
    e.input += u.input
    e.output += u.output
    e.calls += 1
    if (u.cached) e.cached = (e.cached ?? 0) + u.cached
    const by = (e.by ??= [])
    let part = by.find((x) => sameOrigin(x, origin))
    if (!part) by.push((part = { ...origin, input: 0, output: 0, calls: 0 }))
    part.input += u.input
    part.output += u.output
    part.calls += 1
    if (u.cached) part.cached = (part.cached ?? 0) + u.cached
  }

  /** 這個功能現在用的來源（記在用量明細上） */
  function originOf(feature: AiFeature, src: { name: string; provider: ProviderId; config: { model: string } }): UsageOrigin {
    return { feature, source: src.name, provider: src.provider, model: src.config.model || providerInfo(src.provider).defaultModel || '' }
  }

  /** 收集一次呼叫的用量；呼叫結束後再決定記在哪一則日誌 */
  function usageCollector(origin: UsageOrigin) {
    const got: TokenUsage[] = []
    return { onUsage: (u: TokenUsage) => got.push(u), flush: (key: string) => { for (const u of got.splice(0)) addUsage(key, u, origin) } }
  }

  /** 本局依來源（模型來源、服務與模型）合計的用量，舊紀錄沒有明細的歸在「未記錄來源」 */
  const usageBySource = computed(() => {
    const out: (Omit<UsagePart, 'feature'> & { features: AiFeature[] })[] = []
    for (const e of Object.values(usage.value)) {
      const parts: UsagePart[] = e.by?.length ? e.by : [{ feature: 'narration', source: '', provider: '' as ProviderId, model: '', input: e.input, output: e.output, calls: e.calls, ...(e.cached ? { cached: e.cached } : {}) }]
      for (const p of parts) {
        let t = out.find((x) => x.source === p.source && x.provider === p.provider && x.model === p.model)
        if (!t) out.push((t = { source: p.source, provider: p.provider, model: p.model, input: 0, output: 0, calls: 0, cached: 0, features: [] }))
        t.input += p.input
        t.output += p.output
        t.calls += p.calls
        t.cached = (t.cached ?? 0) + (p.cached ?? 0)
        if (e.by?.length && !t.features.includes(p.feature)) t.features.push(p.feature)
      }
    }
    return out.sort((a, b) => b.input + b.output - (a.input + a.output))
  })

  const totalUsage = computed(() =>
    Object.values(usage.value).reduce<Required<Omit<UsageEntry, 'by'>>>(
      (t, e) => ({ input: t.input + e.input, output: t.output + e.output, calls: t.calls + e.calls, cached: t.cached + (e.cached ?? 0) }),
      { input: 0, output: 0, calls: 0, cached: 0 },
    ),
  )

  // ---- 存檔欄位 ----

  function flash(text: string) {
    notice.value = text
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice.value = null), 2500)
  }

  /** 目前的遊戲；存檔欄位與匯出的檔案也附上當時的自訂內容（沒有自訂內容時不附；上傳的圖示不附） */
  function snapshot(): SaveData | null {
    if (!state.value) return null
    const finished = Object.fromEntries(Object.entries(narrations.value).filter(([, n]) => n.status === 'done'))
    const content = currentContent()
    return JSON.parse(JSON.stringify({ state: toRaw(state.value), narrations: finished, usage: toRaw(usage.value), ...(content ? { content } : {}) })) as SaveData
  }

  function currentContent(): ContentMods | undefined {
    const mods = withoutIcons(useContent().mods)
    return modCount(mods) ? mods : undefined
  }

  /** 清掉沒有任何存檔（含進行中的遊戲）用到的形象圖；讀不到存檔列表時不清 */
  async function prunePortraits(): Promise<number> {
    try {
      const seeds = new Set<number>()
      if (state.value) seeds.add(state.value.seed)
      for (const m of await slotStore().list()) {
        const seed = m.seed ?? (await slotStore().get(m.id))?.state.seed
        if (seed !== undefined) seeds.add(seed)
      }
      return await usePortraits().pruneExcept(seeds)
    } catch {
      return 0
    }
  }

  async function refreshSlots() {
    try {
      slots.value = (await slotStore().list()).sort((a, b) => b.savedAt - a.savedAt)
    } catch (e) {
      error.value = `讀取存檔列表失敗：${e instanceof Error ? e.message : String(e)}`
    }
  }

  async function writeSlot(id: string, name: string, kind: SlotMeta['kind'], given?: SaveData) {
    const data = given ?? snapshot()
    if (!data) throw new Error('沒有進行中的遊戲')
    await slotStore().put(slotMeta(id, name, kind, data), data)
    await refreshSlots()
    // 覆寫掉的欄位可能是某一局唯一的存檔
    void prunePortraits()
  }

  /** 手動存檔：給 id 時覆寫那個欄位 */
  async function saveToSlot(name: string, id?: string) {
    try {
      const data = snapshot()
      if (!data) return
      const meta = slots.value.find((m) => m.id === id)
      await writeSlot(id ?? `m-${Date.now().toString(36)}`, name.trim() || meta?.name || slotTitle(slotMeta('', '', 'manual', data)), 'manual')
      flash('💾 已存檔')
    } catch (e) {
      error.value = `存檔失敗：${e instanceof Error ? e.message : String(e)}`
    }
  }

  async function quickSave() {
    try {
      await writeSlot(QUICK_SLOT, '快速存檔', 'quick')
      flash('⚡ 已快速存檔')
    } catch (e) {
      error.value = `快速存檔失敗：${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** 自動存檔：在長休、抵達目的地、讀檔前保存，循環使用 AUTO_SLOTS 個欄位 */
  async function autoSave(reason: string, given?: SaveData) {
    if (!state.value && !given) return
    let n = 0
    try {
      n = (Number(localStorage.getItem('elondia.autoIndex') ?? 0) + 1) % AUTO_SLOTS
      localStorage.setItem('elondia.autoIndex', String(n))
    } catch {
      // 無痕模式等情況下照樣存在第 0 格
    }
    try {
      await writeSlot(`auto-${n}`, `自動存檔（${reason}）`, 'auto', given)
    } catch {
      // 自動存檔失敗不打斷遊戲
    }
  }

  /** 還沒按「繼續」的遊戲要被蓋掉前：先存進自動存檔欄位（不用載入）；設定關掉備份時直接放掉 */
  async function backupResume(reason: string) {
    const r = resume.value
    resume.value = null
    if (!r?.state || !useSettings().backupBeforeSwitch) return
    try {
      await autoSave(reason, { state: JSON.parse(r.state) as GameState, narrations: parseJson(r.narrations) ?? {}, usage: parseJson(r.usage) ?? {} })
    } catch {
      // 備份失敗不擋住開新遊戲或讀檔
    }
  }

  /** 載入一份遊戲：先切到它的世界，再補上新欄位 */
  function enter(data: SaveData) {
    for (const c of controllers.values()) c.abort()
    clearUndo()
    stopWalk()
    const world = useContent().enterWorld(data.state.world, data.content)
    state.value = load(data.state)
    state.value.world = { id: world.id, name: world.name }
    narrations.value = (data.narrations ?? {}) as Record<string, NarrationState>
    usage.value = (data.usage ?? {}) as Record<string, UsageEntry>
    error.value = null
    if (world.note) flash(world.note)
    save()
  }

  function applySnapshot(data: SaveData) {
    enter(data)
  }

  /** 首頁的「繼續」：載入進行中的遊戲 */
  function continueGame(): boolean {
    const r = resume.value
    if (!r?.state) return false
    try {
      enter({ state: JSON.parse(r.state) as GameState, narrations: parseJson(r.narrations) ?? {}, usage: parseJson(r.usage) ?? {} })
      resume.value = null
      return true
    } catch (e) {
      // 讀不了（例如來自比較新的版本）：不要蓋掉它，說明原因
      state.value = null
      error.value = `讀取進行中的遊戲失敗：${e instanceof Error ? e.message : String(e)}（開新遊戲或讀取存檔會蓋掉它，蓋掉前會先存一份到自動存檔）`
      return false
    }
  }

  /** 回到首頁：存好進度，之後按「繼續」再載入 */
  async function toHome() {
    if (!state.value) return
    for (const c of controllers.values()) c.abort()
    clearUndo()
    stopWalk()
    save()
    await flushed()
    const finished = Object.fromEntries(Object.entries(narrations.value).filter(([, n]) => n.status === 'done'))
    resume.value = { state: JSON.stringify(state.value), narrations: JSON.stringify(finished), usage: JSON.stringify(usage.value) }
    state.value = null
    narrations.value = {}
    usage.value = {}
    error.value = null
  }

  /** 讀檔：先把目前的進度自動存一份，免得誤讀（設定可以關掉） */
  async function loadSlot(id: string) {
    try {
      const data = await slotStore().get(id)
      if (!data) throw new Error('找不到這個存檔')
      if (state.value && useSettings().backupBeforeSwitch) await autoSave('讀檔前')
      await backupResume('讀檔前')
      applySnapshot(data)
      flash('📂 已讀取存檔')
    } catch (e) {
      error.value = `讀檔失敗：${e instanceof Error ? e.message : String(e)}`
    }
  }

  async function quickLoad() {
    if (!slots.value.length) await refreshSlots()
    if (!slots.value.some((m) => m.id === QUICK_SLOT)) {
      flash('還沒有快速存檔')
      return
    }
    await loadSlot(QUICK_SLOT)
  }

  async function deleteSlot(id: string) {
    await slotStore().remove(id)
    await refreshSlots()
    const n = await prunePortraits()
    if (n) flash(`🗑️ 已刪除存檔，並清掉 ${n} 張沒有存檔用到的形象圖`)
  }

  async function renameSlot(id: string, name: string) {
    await slotStore().rename(id, name.trim())
    await refreshSlots()
  }

  /**
   * 匯出成檔案：回傳檔名與內容（目前的遊戲或某個欄位）。
   * 記下存檔用的世界（id 與名字）；附上那個世界的自訂內容（欄位存檔時的；舊的欄位沒有時用這個瀏覽器裡那個世界的），
   * 原版世界的存檔不附內容。可以選擇附上這一局的形象圖
   */
  async function exportFile(id?: string, opts: { content?: boolean; portraits?: boolean } = {}): Promise<{ name: string; text: string } | null> {
    const data = id ? await slotStore().get(id) : snapshot()
    if (!data) return null
    const content = useContent()
    const world = data.state.world
    if (world?.id === VANILLA) {
      // 原版世界：標明是原版，不附任何自訂內容
      data.state.world = { id: VANILLA, name: VANILLA_NAME }
      delete data.content
    } else if (opts.content === false) delete data.content
    else if (!data.content && world) {
      const w = content.worlds.find((x) => x.id === world.id)
      if (w && modCount(withoutIcons(w.mods))) data.content = withoutIcons(w.mods)
    } else if (data.content) data.content = withoutIcons(data.content)
    if (world && world.id !== VANILLA) data.state.world = { id: world.id, name: content.worlds.find((x) => x.id === world.id)?.name ?? world.name }
    delete data.portraits
    if (opts.portraits) {
      const portraits = await usePortraits().exportFor(data.state.seed)
      if (Object.keys(portraits).length) data.portraits = portraits
    }
    return { name: saveFileName(slotMeta('', '', 'manual', data)), text: JSON.stringify(data, null, 2) }
  }

  /** 遊戲中只能匯入同一個世界的存檔（不同的世界要回首頁匯入）；可以時回傳 undefined */
  function importBlocked(data: SaveData): string | undefined {
    if (!state.value) return undefined
    const content = useContent()
    const want = data.state.world?.id ?? content.active
    if (want === content.active) return undefined
    return `這個存檔用的世界「${data.state.world?.name ?? want}」和目前的世界「${content.activeName}」不同，請回首頁匯入`
  }

  /** 匯入前的檢查：存檔摘要、用的世界（首頁匯入時會不會建立新的世界）、遊戲中能不能匯入、附上幾張形象圖 */
  function previewImport(text: string, fileName = '匯入的存檔'): ImportPreview {
    const data = parseSaveFile(text)
    const blocked = importBlocked(data)
    const plan = state.value ? {} : useContent().worldForImport(data.state.world, data.content, true)
    return {
      meta: slotMeta('', fileName.replace(/\.json$/i, ''), 'manual', data),
      ...(data.state.world ? { world: data.state.world } : {}),
      ...(plan.created ? { newWorld: plan.created } : {}),
      ...(blocked ? { blocked } : {}),
      portraits: Object.keys(data.portraits ?? {}).length,
    }
  }

  /**
   * 匯入檔案：存成一個新的手動存檔欄位（不會直接讀取）。
   * 遊戲中只能匯入同一個世界的存檔；首頁匯入時，附了自訂內容而且世界不同（或不存在）時，用附帶的內容建立新的世界。
   * portraits：還原附上的形象圖
   */
  async function importFile(text: string, fileName = '匯入的存檔', opts: { portraits?: boolean } = {}) {
    try {
      const data = parseSaveFile(text)
      const blocked = importBlocked(data)
      if (blocked) throw new Error(blocked)
      const portraits = data.portraits
      delete data.portraits
      const notes: string[] = []
      if (!state.value) {
        const plan = useContent().worldForImport(data.state.world, data.content)
        if (plan.ref && (plan.created || plan.reused)) {
          data.state.world = plan.ref
          notes.push(plan.created ? `用存檔附帶的自訂內容建立了世界「${plan.created}」` : `存檔附帶的自訂內容和世界「${plan.reused}」相同，改用這個世界`)
        }
      }
      const meta = slotMeta(`m-${Date.now().toString(36)}`, fileName.replace(/\.json$/i, ''), 'manual', data)
      await slotStore().put(meta, data)
      // 先有存檔欄位再還原圖片，清理孤兒圖片時才不會被刪掉
      if (opts.portraits && portraits) {
        const n = await usePortraits().importFor(data.state.seed, portraits)
        if (n) notes.push(`還原 ${n} 張形象圖`)
      }
      await refreshSlots()
      flash(`📥 已匯入${notes.length ? `（${notes.join('，')}）` : ''}，可以在存檔列表讀取`)
    } catch (e) {
      error.value = `匯入失敗：${e instanceof Error ? e.message : String(e)}`
    }
  }

  function hasReport(x: unknown): x is { report: Report } {
    return typeof x === 'object' && x !== null && 'report' in x && isReport((x as { report: unknown }).report)
  }

  /** 開新遊戲；world：用哪個世界（不給時用目前的） */
  function start(name: string, race: string, classId: string, bonus?: Partial<Attrs>, profile: Omit<NewGameOptions, 'name' | 'race' | 'classId' | 'bonus' | 'seed'> = {}, world?: string) {
    const content = useContent()
    if (world !== undefined && world !== content.active) content.switchWorld(world)
    // 還沒繼續的遊戲會被蓋掉：先備份（設定關掉時不備份）
    void backupResume('開新遊戲前')
    clearUndo()
    stopWalk()
    state.value = newGame({ name, race, classId, ...(bonus ? { bonus } : {}), ...profile })
    state.value.world = { id: content.active, name: content.activeName }
    grid.enterLocation(state.value)
    population.ensureRoster(state.value, state.value.location)
    if (profile.slave) slavery.startAsSlave(state.value, profile.slave)
    narrations.value = {}
    usage.value = {}
    error.value = null
    save()
    // 上一局沒有存檔的話，它的形象圖就用不到了
    void prunePortraits()
  }

  function reset() {
    for (const c of controllers.values()) c.abort()
    clearUndo()
    stopWalk()
    state.value = null
    resume.value = null
    narrations.value = {}
    usage.value = {}
    pendingWrite = null
    void (async () => {
      await flushed()
      try {
        await currentStore().clear()
        saveWarning.value = null
      } catch (e) {
        saveWarning.value = `清除進行中的遊戲失敗（${saveFailure(e)}）`
      }
    })()
  }



  // 世界書、繁簡轉換字典與各家 SDK 都很大，用到時才載入
  async function composeFor(report: Report) {
    const [{ composeNarration }, opts] = await Promise.all([import('@/narrator/compose'), usePrompts().composeOptions()])
    return composeNarration(state.value, report, opts, narrations.value)
  }

  async function promptFor(report: Report): Promise<Prompt> {
    return (await composeFor(report)).prompt
  }

  /** 判定請求的提示詞；沒有等待中的行動時用一個範例行動（在複製的狀態上擲骰，不影響遊戲） */
  async function composeJudgePreview(text = '（預覽用的範例行動）') {
    const s = state.value
    if (!s) return null
    let st = s
    let pending = s.pendingAction
    if (!pending) {
      if (s.combat) return null
      st = JSON.parse(JSON.stringify(s)) as GameState
      try {
        pending = actions.prepareAction(st, { kind: 'free', text })
      } catch {
        return null
      }
    }
    const [{ composeJudge }, opts] = await Promise.all([import('@/narrator/compose'), usePrompts().composeOptions()])
    return { ...composeJudge(st, pending, opts, narrations.value), sample: !s.pendingAction }
  }

  /** 請「敘事正文」（帶親密場景時是「成人場景正文」）的模型寫出這則日誌的經過。manual：玩家在日誌上手動要求（AI 細節描述關閉時也顯示） */
  async function narrate(report: Report, opts: { manual?: boolean } = {}) {
    const settings = useSettings()
    controllers.get(report.report_id)?.abort()
    const controller = new AbortController()
    controllers.set(report.report_id, controller)
    // 判定時的思考過程留著
    const before = narrations.value[report.report_id]
    const judgeThinking = before?.judgeThinking
    // 重寫已經寫好的經過：不自動重畫插圖（要重畫用日誌底下的按鈕）
    const rewrite = before?.status === 'done' && !before.placeholder && !!before.text.trim()
    narrations.value[report.report_id] = { text: '', status: 'streaming', ...(opts.manual ? { manual: true } : {}), ...(judgeThinking ? { judgeThinking } : {}) }
    const entry = narrations.value[report.report_id]!
    try {
      const prompt = await promptFor(report)
      const { streamNarration } = await import('@/narrator/providers')
      const feature = settings.narrationFeature(report)
      const src = settings.sourceFor(feature)
      const onUsage = (u: TokenUsage) => addUsage(report.report_id, u, originOf(feature, src))
      const onThinking = (t: string) => { entry.thinking = (entry.thinking ?? '') + t }
      for await (const chunk of streamNarration(src.provider, src.config, prompt, controller.signal, onUsage, onThinking)) {
        entry.text += chunk
      }
      // 正文後面的人際關係更新提議：取出來等玩家確認
      const { text, updates } = splitSuggestions(entry.text)
      entry.text = text
      if (state.value && updates.length) social.addSuggestions(state.value, updates, report.report_id)
      entry.status = 'done'
      save()
      if (!rewrite && text.trim() && state.value) void useScenes().auto(state.value, report)
    } catch (e) {
      entry.status = 'error'
      entry.error = controller.signal.aborted ? '已取消' : e instanceof Error ? e.message : String(e)
    } finally {
      controllers.delete(report.report_id)
    }
  }

  function cancelNarration(reportId: string) {
    controllers.get(reportId)?.abort()
  }

  // ---- 主動行動：程式擲骰，AI 看骰值判定（或依規則） ----

  async function perform(input: actions.ActionInput) {
    const pending = run((s) => actions.prepareAction(s, input))
    if (pending) await judge()
  }

  /** 判定等待中的行動。useAI 未指定時依設定。AI 失敗時保留行動，可以重試或改用規則。 */
  async function judge(useAI?: boolean) {
    const s = state.value
    const pending = s?.pendingAction
    if (!s || !pending || judging.value) return
    const settings = useSettings()
    const ai = useAI ?? settings.judgesWithAi()
    if (!ai) {
      run((st) => actions.resolveAction(st, null))
      return
    }
    judging.value = true
    error.value = null
    const src = settings.sourceFor('judge')
    const collector = usageCollector(originOf('judge', src))
    try {
      const { completeText } = await import('@/narrator/providers')
      const [{ composeJudge }, opts] = await Promise.all([import('@/narrator/compose'), usePrompts().composeOptions()])
      let thinking = ''
      const text = await completeText(src.provider, src.config, composeJudge(s, pending, opts, narrations.value).prompt, undefined, collector.onUsage, (t) => { thinking += t })
      const judgment = actions.sanitizeJudgment(s, pending, extractJson(text))
      // 分開時就算判定的模型寫了經過也不採用，交給寫作的模型；
      // 數值被程式截掉時也不採用（判定寫的是截掉前的數字），交給寫手照實際結算的數字重寫
      if (opts.splitNarrative || judgment.adjusted?.length) delete judgment.narrative
      // 預設：判定只回傳 JSON，經過交給「敘事正文」依報告撰寫（和其他日誌一樣）。
      // 勾選「判定時順便寫出經過」而且同一個來源時，直接採用判定寫的經過，省一次呼叫。
      const report = run((st) => actions.resolveAction(st, judgment), { narrate: !judgment.narrative })
      collector.flush(report?.report_id ?? OTHER_USAGE)
      // 判定寫了經過，結果卻是親密場景、而「成人場景正文」用另一個來源：不採用，交給那個來源重寫
      const rewrite = !!report && !!judgment.narrative && settings.narrationFeature(report) === 'adult' && settings.sourceIndex('adult') !== settings.sourceIndex('judge')
      if (report && rewrite) {
        if (settings.autoNarrates(report) && settings.ready('adult')) void narrate(report)
      } else if (report && judgment.narrative) {
        narrations.value[report.report_id] = { text: judgment.narrative, status: 'done' }
        if (judgment.narrative.trim()) void useScenes().auto(s, report)
      }
      // 判定的思考過程：記在這則日誌（還沒有敘事時先放一個空的）
      if (report && thinking.trim()) {
        const entry = narrations.value[report.report_id]
        if (entry) entry.judgeThinking = thinking.trim()
        else narrations.value[report.report_id] = { text: '', status: 'done', placeholder: true, judgeThinking: thinking.trim() }
      }
      save()
    } catch (e) {
      collector.flush(OTHER_USAGE)
      error.value = `AI 判定失敗：${e instanceof Error ? e.message : String(e)}（可以重試，或改用規則判定）`
    } finally {
      judging.value = false
    }
  }

  /** 地點的名單：AI 開啟時請 AI 潤飾名字、外貌、性格與背景（每個人一次；到了這裡才潤飾還沒潤飾過的人） */
  async function flavorRoster() {
    const s = state.value
    const settings = useSettings()
    if (!s || !settings.designs('roster')) return
    const loc = s.location
    const roster = s.rosters?.[loc]
    if (!roster || flavoring.has(loc)) return
    // 還沒潤飾過的人（第一次來，或名單變動搬來了新居民）
    const prompt = buildRosterPrompt(s, loc)
    if (!prompt) return
    const sent = population.unflavored(s, loc).map((r) => r.id)
    flavoring.add(loc)
    try {
      const { completeText } = await import('@/narrator/providers')
      const src = settings.sourceFor('roster')
      const raw = extractJson(await completeText(src.provider, src.config, prompt, undefined, (u) => addUsage(OTHER_USAGE, u, originOf('roster', src)))) as { npcs?: population.NpcFlavor[] }
      run((st) => population.applyRosterFlavor(st, loc, Array.isArray(raw.npcs) ? raw.npcs : [], sent))
    } catch (e) {
      error.value = `AI 潤飾居民失敗：${e instanceof Error ? e.message : String(e)}（先用預設的名字與設定）`
    } finally {
      flavoring.delete(loc)
    }
  }
  const flavoring = new Set<string>()

  /** 商店：AI 開啟時請 AI 生成今天的交易清單（每間店每天一次，失敗時保留規則清單） */
  async function flavorShop(type: ShopType) {
    const s = state.value
    const settings = useSettings()
    if (!s || !settings.designs('shop') || shopRules.types[type]?.ai === false) return
    const shop = trade.shopState(s, type)
    if (shop.aiTried || shop.source === 'ai') return
    shop.aiTried = true
    save()
    try {
      const { completeText } = await import('@/narrator/providers')
      const src = settings.sourceFor('shop')
      const raw = extractJson(await completeText(src.provider, src.config, buildShopPrompt(s, type), undefined, (u) => addUsage(OTHER_USAGE, u, originOf('shop', src))))
      run((st) => trade.applyAiDeals(st, type, raw))
    } catch (e) {
      error.value = `AI 生成交易清單失敗：${e instanceof Error ? e.message : String(e)}（先用一般的商品清單）`
    }
  }

  /** 要打開哪一場談判的對話框（開始或繼續談判時設定，見 NegotiationPanel） */
  const negotiationFocus = ref<string | null>(null)
  /** 開始談判；AI 開啟時請 AI 依對象與情境生成談判方式 */
  async function startNegotiation(template: string, ctx: negotiation.NegotiationContext) {
    const n = run((s) => negotiation.startNegotiation(s, template, ctx))
    if (n) negotiationFocus.value = n.id
    const s = state.value
    const settings = useSettings()
    if (!n || !s || n.ai || !settings.designs('negotiation')) return n
    n.ai = true
    try {
      const { completeText } = await import('@/narrator/providers')
      const src = settings.sourceFor('negotiation')
      const raw = extractJson(await completeText(src.provider, src.config, buildNegotiationPrompt(s, n), undefined, (u) => addUsage(OTHER_USAGE, u, originOf('negotiation', src))))
      // 等 AI 的時候玩家可能已經放棄了（還沒談過的會從清單拿掉）
      if (state.value?.negotiations?.some((x) => x.id === n.id && x.status === 'open')) run((st) => negotiation.applyAiOptions(st, n.id, raw))
    } catch (e) {
      error.value = `AI 生成談判方式失敗：${e instanceof Error ? e.message : String(e)}（先用預設的談判方式）`
    }
    return n
  }

  function hire(npcId: string, offer: number, text: string) {
    const s = state.value
    if (!s) return
    const c = s.taverns?.[s.location]?.candidates.find((x) => x.npc === npcId)
    if (c && offer >= companions.askingFor(c)) return run((st) => companions.hireAtAsking(st, npcId, offer))
    return perform({ kind: 'hire', target: npcId, offer_cc: offer, text })
  }

  return {
    /** 在動作的保護下改狀態：出錯時還原、顯示訊息（測試與少數元件用） */
    runAction: run,
    undoReports, redoInput, undo, redo, dismissRedo: () => (redoInput.value = null),
    state, narrations, error, saveWarning, flushed, pc, here, area, cell, resumeMeta, hasProgress, continueGame, toHome, judging, intent, actionTargets, usage, totalUsage, usageBySource, slots, notice, flash, bump, bumpText, makeRoom, requireRoom,
    usageCollector, originOf,
    refreshSlots, saveToSlot, quickSave, quickLoad, loadSlot, deleteSlot, renameSlot, exportFile, previewImport, importFile, prunePortraits,
    start, reset, promptFor, composeFor, composeJudgePreview, narrate, cancelNarration,
    perform, judge, flavorRoster, hire, flavorShop, startNegotiation, negotiationFocus,
    // 商店、談判、行囊
    shopState: (type: ShopType) => run((s) => trade.shopState(s, type)),
    buyDeal: (type: ShopType, id: string, qty = 1) => run((s) => trade.buyDeal(s, type, id, qty)),
    sellItem: (type: ShopType, name: string, qty: number) => run((s) => trade.sellItem(s, type, name, qty)),
    bargain: (type: ShopType, dealId: string, text: string) => perform({ kind: 'bargain', target: trade.bargainTarget(type, dealId), text }),
    chooseOption: (id: string, option: string) => run((s) => negotiation.chooseOption(s, id, option)),
    negotiateFreely: (id: string, text: string, use?: { member: string; ability: string }) =>
      perform({ kind: 'negotiation', target: id, text, ...(use ? { use } : {}) }),
    abandonNegotiation: (id: string) => run((s) => negotiation.abandonNegotiation(s, id)),
    useItem: (name: string, member: string) => run((s) => inventory.useItem(s, name, member)),
    readIntel: (name: string) => run((s) => inventory.readIntelItem(s, name)),
    eatMeal: (id: string) => run((s) => meals.eatMeal(s, id)),
    equipItem: (name: string, member: string, slot?: GearSlot) => run((s) => inventory.equipItem(s, name, member, slot)),
    unequipItem: (member: string, slot: GearSlot) => run((s) => inventory.unequipItem(s, member, slot)),
    // 拘束具的鎖（雙面效應）
    lockGear: (member: string, slot: GearSlot, lock: string) => run((s) => inventory.lockGear(s, member, slot, lock)),
    unlockGear: (member: string, slot: GearSlot) => run((s) => inventory.unlockGear(s, member, slot)),
    // 鑰匙與脫縛（別人鎖上的拘束具）
    useKey: (member: string, slot: GearSlot, key: string) => run((s) => inventory.useKey(s, member, slot, key)),
    tryUnbind: (member: string, slot: GearSlot) => perform({ kind: 'unbind', target: `${member}:${slot}`, text: '' }),
    // 陷阱鎖：在鐵匠鋪花錢剪掉
    cutLock: (member: string, slot: GearSlot) => run((s) => restraints.cutLock(s, member, slot)),
    // 主人是工具人：親密度夠高時直接解約、換主人
    masterRelease: () => run((s) => masterTool.masterRelease(s)),
    masterTransfer: (npc: string) => run((s) => masterTool.masterTransfer(s, npc)),
    editProfile: (patch: ProfilePatch) => run((s) => editProfile(player(s), patch)),
    // 旅行：畫出旅途的單行道，一格一天往前走（road.ts）
    travel: (to: string, intent?: string) => run((s) => road.startJourney(s, to, intent), { onMap: true }),
    /** 一路往前走，遇到事件、戰鬥或抵達時停下 */
    walkRoad: () => run((s) => {
      for (let i = 0; i < 80; i++) {
        if (!s.road || s.side || s.roadEvent || s.parasiteEvent || s.combat || s.pendingMasterEvent || s.standoff || s.pendingAction || story.blockingNode(s)) return {}
        const r = afterMove(s, grid.move(s, 1, 0))
        if (r.report || r.combat || s.roadEvent || s.pendingMasterEvent || s.parasiteEvent) return r
      }
      return {}
    }),
    answerRoadEvent: (i: number) => run((s) => road.answerRoadEvent(s, i)),
    answerTownEvent: (i: number) => run((s) => townEvents.answerTownEvent(s, i)),
    answerDungeonEvent: (i: number) => run((s) => dungeonEvents.answerDungeonEvent(s, i)),
    answerParasiteEvent: (i: number) => run((s) => parasiteEvents.answerParasiteEvent(s, i)),
    triggerParasite: (id: string) => run((s) => parasiteEvents.triggerTamed(s, id)),
    cureParasite: (id: string) => run((s) => parasiteEvents.cureParasite(s, id)),
    reinkParasite: (id: string, kind: 'curse' | 'covered') => run((s) => parasiteEvents.reinkAtCarver(s, id, kind)),
    leaveSide: () => run((s) => road.leaveSide(s)),
    leaveSpecial: () => run((s) => specialMaps.leaveSpecial(s), { onMap: true }),
    leavePark: () => run((s) => leavePark(s), { onMap: true }),
    charmGatePass: () => run((s) => charmGatePass(s)),
    startArena: (ring: string, opts: { restraint?: string; wager?: boolean }) => run((s) => startArena(s, ring, opts)),
    fuseGear: (weapon: string, restraint: string) => run((s) => fuseGear(s, weapon, restraint)),
    splitGear: (name: string) => run((s) => splitGear(s, name)),
    placeBid: (index: number, amount: number) => run((s) => placeBid(s, index, amount)),
    consign: (name: string) => run((s) => consign(s, name)),
    orderOutfit: (base: string, material: string, stat: LewdStat) => run((s) => orderOutfit(s, base, material, stat)),
    rest: () => run(town.rest),
    shortRest: (spend?: Record<string, number>) => run((s) => rest.shortRest(s, spend)),
    /** 長休；有寫互動內容時，長休後接著進行「長休時的互動」（主動行動） */
    longRest: async (place: rest.RestPlace, talk?: { text: string; target?: string }) => {
      const withTalk = !!talk?.text.trim()
      // 有互動時，長休本身不另外寫敘事：和互動合成一段（互動的報告會帶上長休的經過）
      // 野外紮營可能被襲擊（回傳戰鬥）：被襲擊時不做長休時的互動
      const report = run((s) => (place === 'camp' ? rest.campRest(s) : rest.longRest(s, place)), { narrate: !withTalk })
      if (report && 'report_id' in report && withTalk) await perform({ kind: 'rest_talk', text: talk!.text, ...(talk!.target ? { target: talk!.target } : {}) })
      return report
    },
    abandonQuest: (id: string) => run((s) => town.abandonQuest(s, id)),
    buyRations: (qty: number) => run((s) => town.buyRations(s, qty)),
    recruit: (id: string) => run((s) => town.recruit(s, id)),
    dismiss: (id: string) => run((s) => town.dismiss(s, id)),
    visitGuild: () => run(town.guildQuests) ?? [],
    acceptQuest: (id: string) => run((s) => town.acceptQuest(s, id)),
    turnInQuest: (id: string, count?: number) => run((s) => town.turnInQuest(s, id, count)),
    templeHeal: () => run(town.templeHeal),
    /** 參訪站著的地標 */
    visitLandmark: () => run(visitLandmark),
    /** 走進站著的地標的內部（特殊地圖） */
    enterLandmark: () => run(enterLandmark, { onMap: true }),
    /** 選站著的地標上的場景 */
    playLandmarkScene: (index: number) => run((s) => playLandmarkScene(s, index)),
    /** 把生成的人存成固定 NPC（存進目前的世界） */
    promoteNpc: (id: string) => run((s) => {
      useContent().promoteNpc(s, id)
      markPromoted(s, id)
    }),
    inkTattoo: (order: tattooShop.InkOrder) => run((s) => tattooShop.inkTattoo(s, order)),
    washTattoo: (place: TattooPlace) => run((s) => tattooShop.washTattoo(s, place)),
    chooseAbility: (member: string, ability: string) => run((s) => town.chooseAbility(s, member, ability)),
    rerollAbility: (member: string) => run((s) => town.rerollAbility(s, member, useSettings().rerollLimit())),
    // 技能攜帶上限：把學會的技能帶上或放回技能庫
    setAbilityCarried: (member: string, ability: string, on: boolean) => run((s) => town.setAbilityCarried(s, member, ability, on)),
    spendAttr: (member: string, attr: AttrId) =>
      run((s) => spendAttrPoint(s.party.find((m) => m.id === member)!, attr)),
    doTownQuest: (id: string, intent?: string) => run((s) => town.doTownQuest(s, id, intent)),
    // 特殊任務：接下、進行沒有檢定的任務點（劇情、選項、戰鬥）、放棄；有檢定的走 perform({ kind: 'story' })
    startStory: (id: string) => run((s) => story.startStory(s, id)),
    playStoryNode: (ref: string, option?: number, intent?: string) => run((s) => story.playNode(s, ref, option, intent)),
    // 特殊任務的檢定：好感不到門檻時不擲骰，直接套用失敗的結果
    attemptStory: (target: string, text: string, use?: actions.ActionInput['use']) => {
      const s = state.value
      const gate = s ? (() => { try { return story.storyCheckGate(s, target) } catch { return undefined } })() : undefined
      if (gate) return run((st) => story.failStoryCheck(st, target))
      return perform({ kind: 'story', target, text, ...(use ? { use } : {}) })
    },
    abandonStory: (id: string) => run((s) => story.abandonStory(s, id)),
    // 走到不緊急的任務點：這次先略過（不記事件），離開這裡之後再來還會觸發
    waitStory: (ref: string) => run((s) => story.waitStory(s, ref)),
    // 只在白天或夜裡的任務點：在原地等到那個時段
    waitForStoryNode: (ref: string) => run((s) => story.waitForNode(s, ref)),
    act: (action: combat.CombatAction) => run((s) => combat.act(s, action)),
    finishCombat: () =>
      run((s) => {
        const report = combat.finishCombat(s)
        grid.afterCombat(s, report)
        return report
      }),
    // 走格子
    moveTo: (x: number, y: number) => run((s) => afterMove(s, grid.moveTo(s, x, y)), { onMap: true }),
    pickLock: (method: grid.LockMethod) => run((s) => grid.pickLock(s, method)),
    // 走過腳下的出入口（城鎮各區、房子的門、特殊地圖的通道）：按 E 或格子資訊的按鈕
    crossLink: () => run((s) => afterMove(s, grid.crossLink(s)), { onMap: true }),
    move: (dx: number, dy: number) => {
      stopWalk()
      return move(dx, dy)
    },
    walkTo, stopWalk, walkTarget,
    // NPC 自己的日子：關注、手動請 AI 寫近況
    setFollowed: (id: string, on: boolean) => run((s) => npcLife.setFollowed(s, id, on)),
    polishNews,
    goOutskirts: () => run((s) => grid.goOutskirts(s) ?? encounters.checkHostiles(s), { onMap: true }),
    returnToTown: () => run(grid.returnToTown, { onMap: true }),
    // 房子（homes.ts）
    buyHome: (lotId: string, name?: string) => run((s) => homes.buyHome(s, lotId, name)),
    renameHome: (id: string, name: string) => run((s) => homes.renameHome(s, id, name)),
    placeFurniture: (name: string) => run((s) => {
      const p = grid.position(s)
      homes.placeFurniture(s, grid.currentArea(s), p.x, p.y, name)
    }),
    takeFurniture: () => run((s) => {
      const p = grid.position(s)
      homes.takeFurniture(s, grid.currentArea(s), p.x, p.y)
    }),
    stayHome: (id: string) => run((s) => homes.stayHome(s, grid.currentArea(s), id)),
    takeResident: (id: string) => run((s) => homes.leaveWithResident(s, grid.currentArea(s), id)),
    // 不在隊上的夥伴與騰出位子（away.ts）
    sendHome: (homeId: string, id: string) => run((s) => away.sendHome(s, homeId, id)),
    lodgeAtTavern: (id: string) => run((s) => away.lodgeAtTavern(s, id)),
    takeLodger: (id: string) => run((s) => away.takeLodger(s, id)),
    acceptPendingJoin: (id: string) => run((s) => away.acceptPendingJoin(s, id)),
    declinePendingJoin: (id: string) => run((s) => away.declinePendingJoin(s, id)),
    /** 忘記自創的配方（invention.ts） */
    // 特質：從機會選一個、放棄、寫說法交給 AI、受訓（docs/PERKS.md）
    learnPerk: (member: string, offer: string, perk: string) => run((s) => perkActions.learnFromOffer(s, member, offer, perk)),
    declinePerk: (member: string, offer: string) => run((s) => perkActions.declineOffer(s, member, offer)),
    pitchPerk: (member: string, offer: string, text: string) => perform({ kind: 'perk_pitch', target: pitchTarget(member, offer), text }),
    train: (perk: string, text: string) => perform({ kind: 'train', target: perk, text }),
    forgetInvention: (name: string) => run((s) => invention.forgetInvention(s, name)),
    /** 自創物品改名（回傳新的名字） */
    renameInvention: (from: string, to: string) => run((s) => invention.renameInvention(s, from, to)),
    // 苗圃（garden.ts）：站在苗圃上播種、收成、拔掉
    plant: (seed: string) => run((s) => {
      const p = grid.position(s)
      garden.plant(s, grid.currentArea(s), p.x, p.y, seed)
    }),
    harvest: () => run((s) => {
      const p = grid.position(s)
      return garden.harvest(s, grid.currentArea(s), p.x, p.y)
    }, { narrate: false }),
    uproot: () => run((s) => {
      const p = grid.position(s)
      garden.uproot(s, grid.currentArea(s), p.x, p.y)
    }),
    /** 地下城的緊急撤退（失敗會被追上打一場） */
    retreat: () => run(grid.retreat),
    /** 這個存檔的規則 */
    setDefeatLoot: (rule: DefeatLoot) => {
      if (!state.value) return
      state.value.options = { ...(state.value.options ?? { defeatLoot: 'half' }), defeatLoot: rule }
      save()
    },
    /** 這個存檔的難度（combat.json 的 difficulty）：只影響之後開打的戰鬥 */
    setDifficulty: (difficulty: Difficulty) => {
      if (!state.value || !DIFFICULTY_DEFS[difficulty]) return
      state.value.options = { ...(state.value.options ?? { defeatLoot: 'half' }), difficulty }
      save()
    },
    /** 這個存檔的數值規則（gameRules.ts）：和預設一樣的不存 */
    setRules: (rules: Partial<Record<NumericRule, unknown>>) => {
      if (!state.value) return
      const { defeatLoot = 'half', difficulty, tagChange } = state.value.options ?? {}
      state.value.options = { defeatLoot, ...(difficulty ? { difficulty } : {}), ...(tagChange ? { tagChange } : {}), ...sanitizeRules(rules) }
      save()
    },
    /** 這個存檔允不允許在遊戲中更換主角的身分標籤 */
    setTagChange: (on: boolean) => {
      if (!state.value) return
      const { tagChange: _, ...rest } = state.value.options ?? { defeatLoot: 'half' }
      state.value.options = { ...rest, ...(on ? { tagChange: true } : {}) }
      save()
    },
    /** 更換主角的身分標籤（存檔規則要允許，見 pcTags.ts） */
    setPcTags: (tags: string[]) => run((s) => setPcTags(s, tags)),
    descend: () => run((s) => (grid.descend(s), encounters.checkHostiles(s)), { onMap: true }),
    ascend: () => run((s) => (grid.ascend(s), encounters.checkHostiles(s)), { onMap: true }),
    // 對峙：避開、現身、偷襲或開戰、付過路費（蒙混與威嚇是主動行動）
    avoidFoes: () => run(encounters.avoidFoes),
    revealSelf: () => run(encounters.revealSelf),
    fightFoes: () => run((s) => encounters.fightFoes(s)),
    payToll: () => run(encounters.payToll),
    // 戰後處置被制伏的人：處決、放過、收為奴隸，連同順便做的劫財、劫色寫成一篇（主動行動走 perform）
    resolveCaptive: (id: string, choice: captives.CaptiveChoice, text?: string, deeds?: captives.CaptiveDeed[]) => run((s) => captives.resolveCaptive(s, id, choice, text, deeds)),
    payFine: () => run(security.payFine),
    restAtSafeRoom: () => run((s) => rest.longRest(s, 'safe')),
    // 夥伴
    tavernCandidates: () => run(companions.tavernCandidates) ?? [],
    waitForParty: () => run(companions.waitForParty),
    acceptPartyOffer: (id: string) => run((s) => companions.acceptPartyOffer(s, id)),
    declinePartyOffer: (id: string) => run((s) => companions.declinePartyOffer(s, id)),
    requestLeave: (mode: 'sneak' | 'formal' | null) => run((s) => companions.requestLeave(s, mode)),
    marketStock: (kind: companions.MarketKind) => run((s) => companions.marketStock(s, kind)) ?? [],
    buySlave: (kind: companions.MarketKind, id: string, mark?: slavery.MarkChoice) => run((s) => companions.buySlave(s, kind, id, mark)),
    curioStock: () => run((s) => companions.curioStock(s)) ?? [],
    buyCurio: (item: string) => run((s) => companions.buyCurio(s, item)),
    chooseMark: (choice: slavery.MarkChoice) => run((s) => slavery.chooseMark(s, choice)),
    answerMasterEvent: (index: number) => run((s) => slavery.answerMasterEvent(s, index)),
    // 調教（主角對自己的奴隸）、娼館受訓、提議夥伴去接客（docs/LEWD_STATS.md 第 9、10 節）
    startTraining: (slave: string, course: string) => run((s) => { ownerTraining.startTraining(s, slave, course); return {} }),
    startBrothelTraining: (who?: string) => run((s) => brothelLife.startBrothelTraining(s, who)),
    proposeWork: (who: string) => run((s) => brothelLife.proposeWork(s, who)),
    // 等待回應的主人事件在內容編輯器被刪掉了：作廢
    dropMissingMasterEvent: () => run((s) => slavery.dropMissingMasterEvent(s)),
    // 成人向的戰敗事件：設定改成不發生（主角非自願、戰敗事件）時直接離開
    skipDefeatEvent: () => run(defeat.skipDefeatEvent),
    offerSelf: (kind: companions.MarketKind) => run((s) => companions.offerSelf(s, kind)),
    releaseSlave: (id: string) => run((s) => companions.releaseSlave(s, id)),
    acceptSuggestion: (id: string, text?: string) => run((s) => social.acceptSuggestion(s, id, text)),
    rejectSuggestion: (id: string) => run((s) => social.rejectSuggestion(s, id)),
    // 人際關係與共同記憶
    editRelationship: (id: string, patch: social.RelationshipPatch) => run((s) => social.editRelationship(s, id, patch)),
    addMemory: (m: Omit<social.Memory, 'id'>) => run((s) => social.addMemory(s, m)),
    editMemory: (id: string, patch: social.MemoryPatch) => run((s) => social.editMemory(s, id, patch)),
    deleteMemory: (id: string) => run((s) => social.deleteMemory(s, id)),
  }
})

/** AbilityPicker 的值（"成員|能力"）轉成主動行動的 use */
export function parseUse(value: string): { member: string; ability: string } | undefined {
  const [member, ability] = value.split('|')
  return member && ability ? { member, ability } : undefined
}
