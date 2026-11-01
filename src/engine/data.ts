// 讀入 data/ 底下的 JSON，並提供型別。

import geographyJson from '@data/world/geography.json'
import countersJson from '@data/rules/counters.json'
import npcsJson from '@data/world/npcs.json'
import progressionJson from '@data/rules/progression.json'
import economyJson from '@data/rules/economy.json'
import attributesJson from '@data/rules/attributes.json'
import classesJson from '@data/rules/classes.json'
import combatJson from '@data/rules/combat.json'
import damageTypesJson from '@data/rules/damage_types.json'
import statusesJson from '@data/rules/statuses.json'
import abilitiesJson from '@data/rules/abilities.json'
import equipmentJson from '@data/rules/equipment.json'
import enemiesJson from '@data/rules/enemies.json'
import monsterTraitsJson from '@data/rules/monster_traits.json'
import townQuestsJson from '@data/rules/town_quests.json'
import companionsJson from '@data/rules/companions.json'
import slaveryJson from '@data/rules/slavery.json'
import actionsJson from '@data/rules/actions.json'
import npcPoolJson from '@data/world/npc_pool.json'
import npcTagsJson from '@data/rules/npc_tags.json'
import npcActivitiesJson from '@data/rules/npc_activities.json'
import populationJson from '@data/rules/npc_population.json'
import itemsJson from '@data/rules/items.json'
import shopsJson from '@data/rules/shops.json'
import negotiationsJson from '@data/rules/negotiations.json'
import workJson from '@data/rules/work.json'
import storiesJson from '@data/rules/stories.json'
import craftsJson from '@data/rules/crafts.json'
import homesJson from '@data/rules/homes.json'
import perksJson from '@data/rules/perks.json'
import lewdJson from '@data/rules/lewd.json'
import landmarksJson from '@data/world/landmarks.json'
import specialMapsJson from '@data/world/special_maps.json'
import type { RewardEffect } from './effects'
import type { GearSlot, GearSpec, GuildRank, LewdStat, QuestKind, SkillQuality, TattooPlace } from './types'
import type { Lighting } from './light'

// ---- 地理 ----

export type RouteMode = 'road' | 'trail' | 'wild' | 'sea' | 'dive' | 'underground'
export type LocationType =
  | 'capital' | 'city' | 'town' | 'village' | 'port' | 'outpost' | 'fortress' | 'dungeon'

export interface Region { id: string; name: string; climate: string; dominant: string; danger: number }
export interface Location {
  id: string
  name: string
  region: string
  type: LocationType
  faction?: string | null
  /** 這個地點生成 NPC 的種族權重；沒寫時用所屬地區的預設 */
  races?: Record<string, number>
  note?: string
  /** 主題地下城的園區：從這張特殊地圖（入口廣場）的通道進出，沒有周邊、不能直接旅行到（docs/LUST_PARK.md） */
  park?: string
  /** 劇情條件成立前不存在：旅行的目的地、委託、情報與給 AI 的地點都不列出（docs/DUNGEON_DESIGN.md 第 1 節） */
  requires?: StoryCond
  /** 這裡的寶箱與人形怪物掉的隨機裝備優先用這一套材料（gear.json 材料的 series；例如緋夢樂園底下的遺跡是 pleasure） */
  material_series?: string
}
export interface Route {
  a: string
  b: string
  days: [number, number] | null
  mode: RouteMode
  estimated?: boolean
  /** 這段路每人收的船資（白鸛）；沒寫時海路每段 SEA_FARE_CC、其他路不收 */
  fare?: number
  note?: string
}

export interface Faction { id: string; name: string }
export const geography = geographyJson as unknown as {
  factions: Faction[]
  regions: Region[]
  locations: Location[]
  routes: Route[]
}

export interface NpcDef {
  id: string
  name: string
  /** 性別 id（見 npc_pool.json 的 genders） */
  gender?: string
  race: string
  class: string
  level: number
  location: string
  hire_cc: number
  /** 不受雇用（統治者、機構首長……）：不出現在雇用候選、不能談雇用；特殊任務的「任務同行」不受影響 */
  unhireable?: boolean
  /** 不能偷襲（一國之主、機構首長……）：只能透過特殊任務的戰鬥交手 */
  no_attack?: boolean
  /** 不能偷竊（身邊戒備森嚴） */
  no_steal?: boolean
  personality: string
  faction?: string
  appearance?: string
  /** 成人向角色：不佔名單名額；內容編輯器的篩選用 */
  adult?: boolean
  /** 成人向的外貌細節（私密部位、性徵……）：接在外貌後面交給 AI 與形象圖，見 npcs.ts 的 appearanceOf */
  adult_appearance?: string
  /** 與其他角色的關係：角色 id → 文字 */
  relations?: Record<string, string>
  /** 普通人或冒險者；沒寫時有職業的算冒險者 */
  kind?: NpcKind
  /** 標籤（見 data/rules/npc_tags.json） */
  tags?: string[]
  /** 活躍地點：每天依權重決定出現在哪個地點的哪個地區 */
  haunts?: Haunt[]
  /** 普通人的職業描述（麵包師、修女……） */
  occupation?: string
  /** 血統、部族、氏族或出身派系（例如「沙痕部落」「魅魔（赤翼宮廷）」） */
  lineage?: string
  // ---- 固定 NPC（內容頁籤可以編輯）：不寫時依職業與等級生成 ----
  background?: string
  /** 屬性（升級之後的最終值） */
  attrs?: Partial<Attrs>
  /** 會的能力（取代依職業隨機學的能力） */
  abilities?: string[]
  /** 特質（data/rules/perks.json 的 id；生成的 NPC 隨機抽，固定 NPC 可以在內容頁籤指定） */
  perks?: string[]
  /** 慾望指標（淫亂、敏感、忍耐、順從，0～100；沒寫的依標籤與 id 固定地擲，見 docs/LEWD_STATS.md） */
  lewd?: Partial<Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', number>>
  /** 娼婦：光顧時可能教主角的色情技能（docs/LEWD_STATS.md 第 10 節；沒寫時用 lewd.json 的 brothel.patron.default） */
  teaches?: string[]
  /** 初始裝備（取代依等級隨機生成的裝備；沒寫的欄位空著） */
  gear?: Partial<Record<GearSlot, GearSpec>>
  /** 固定站在聚落的某一格（區塊 key 與座標）；有這個欄位時不看活躍地點 */
  fixed?: { area: string; x: number; y: number }
  /** 待在所屬地點的某個地標（站在地標那一格，地標搬家時跟著走）；有這個欄位時不看 fixed 與活躍地點 */
  landmark?: string
  /** 擔任所屬地點這種店的店主（shops.json 的店種，流浪商人除外）：取代自動生成的店主 */
  keeper?: string
  /** 只在劇情旗標符合時出現（特殊任務用，見 story.ts） */
  requires?: StoryCond
  /** 依劇情旗標改變出沒：由上往下第一組條件成立的設定取代上面的所屬地點、活躍地點與固定格子 */
  stages?: NpcStage[]
  /** 這個人帶著的小隊（寫在隊長身上，見 engine/squads.ts）：隊員跟著隊長出沒，只能整隊邀請或請他們帶主角同行 */
  squad?: NpcSquad
}

/** 固定 NPC 的小隊（2–4 人，含隊長） */
export interface NpcSquad {
  /** 隊名 */
  name: string
  /** 隊員：固定 NPC 的 id（不含隊長，1–3 人） */
  members: string[]
  /** 隊員每天跟著隊長的機率（0–1，預設 1） */
  together?: number
  /** 小隊成立的條件；不成立時各自行動 */
  requires?: StoryCond
}

export interface NpcStage {
  requires: StoryCond
  /** 只在白天（6～18 時）或只在夜裡成立（例如只在夜裡營業的地方） */
  hours?: 'day' | 'night'
  location: string
  haunts?: Haunt[]
  fixed?: { area: string; x: number; y: number }
  /** 身分改變（例如皇子登基成為國王）：有寫的取代預設的名字、背景、性格、標籤；條件不再成立時換回來 */
  name?: string
  background?: string
  personality?: string
  tags?: string[]
}

/** 劇情旗標的條件：flags 全部成立、flags_none 全部不成立、flags_any 至少一個成立、計數器在範圍內 */
export interface StoryCond {
  flags?: string[]
  flags_none?: string[]
  /** 至少一個成立（「或」） */
  flags_any?: string[]
  /** 劇情計數器的範圍：{ 計數器 id: { min, max } }（含邊界） */
  counters?: Record<string, CounterRange>
  /** 角色的好感（親密度）至少多少：{ 角色 id: 最低值 }（沒見過面算 0） */
  affinity?: Record<string, number>
  /** 主角身上的寄生物：{ 寄生物 id: { min, max（侵蝕度，含邊界）, tamed（已經馴服或還沒） } }；寫了就要身上有、而且沒有沉睡 */
  parasites?: Record<string, ParasiteRange>
  /** 主角的慾望指標（有效值；曝露名聲看目前的地區）的範圍：{ lewdness: { min, max } }（含邊界；docs/LEWD_STATS.md） */
  stats?: Partial<Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission' | 'exposure', CounterRange>>
  /** 所在地的魅氣濃度（1～4，含邊界；docs/LEWD_STATS.md 第 12 節） */
  charm?: CounterRange
  /** 主角身上戴著什麼（寫 true 要有、false 要沒有；docs/LEWD_STATS.md 第 27 節） */
  wearing?: WearingCond
  /** 主角至少有其中一個身分標籤（npc_tags.json 的 id；docs/NPC_SYSTEM.md 4.1 節） */
  pc_tags?: string[]
  /**
   * 某個特殊任務（或它的某個任務點）結束之後至少過了幾天（docs/STORY_QUESTS.md「幾天之後」）：
   * 「三天後來取件」「三天後在餘燼裂隙」——時間照常走，玩家這幾天可以做別的事。那個任務還沒結束時不成立
   */
  after?: AfterCond
}

export interface AfterCond { story: string; node?: string; days: number }

/**
 * 主角身上戴著什麼：bind 任何拘束具、bind_kind 這一種拘束具（要有）、locked 別人鎖上的（主人或陷阱）、
 * adult_outfit 成人向服裝、mark 奴隸印記
 */
export interface WearingCond { bind?: boolean; bind_kind?: BindKind; locked?: boolean; adult_outfit?: boolean; mark?: boolean }

export interface ParasiteRange { min?: number; max?: number; tamed?: boolean }

export interface CounterRange { min?: number; max?: number }

/** 劇情計數器（data/rules/counters.json，內容頁籤可以修改與新增）：存在存檔的 flags 的 count:<id> */
export interface CounterDef {
  name: string
  desc?: string
  /** 開新遊戲時的值（沒寫是 0） */
  initial?: number
  min?: number
  max?: number
}
export const storyCounters = (countersJson as unknown as { counters: Record<string, CounterDef> }).counters

// ---- 特殊任務（人工編寫的任務鏈，data/rules/stories.json，說明見 docs/STORY_QUESTS.md） ----

/** 任務從哪裡開始 */
export type StoryStartKind = 'guild' | 'npc' | 'travel' | 'informant' | 'manual'
export interface StoryStart {
  kind: StoryStartKind
  /** guild：哪座城鎮的公會；informant：哪座城鎮的情報商（沒有時任何情報商） */
  location?: string
  /** npc：跟這位固定 NPC 說話 */
  npc?: string
  /** travel：旅途中遇到的機率（每段旅程），只在前往這些地區時（沒有時任何地區） */
  chance?: number
  regions?: string[]
  /** informant：情報的價格 */
  price?: number
  /** 主角至少要幾級 */
  min_level?: number
  /** 只給這些體型的主角（男性形象 masc、女性形象 fem、中性 andro；沒寫時都可以），例如做給女性主角的任務 */
  pc_body?: ('masc' | 'fem' | 'andro')[]
  /** npc：這位角色對主角的親密度至少要多少（沒見過面算 0） */
  min_affinity?: number
  /** 劇情旗標的條件 */
  requires?: StoryCond
  /** 開頭的事件描述（旅途、情報商的開頭；沒有時用任務的簡介） */
  text?: string
  /** 接下任務時拿到的物品（各一件，例如打工的制服） */
  items?: string[]
}

/** 任務點在哪裡觸發 */
export type StoryWhere = 'settlement' | 'cell' | 'npc' | 'outskirts' | 'dungeon' | 'road' | 'side' | 'special'
export interface StoryPlace {
  where: StoryWhere
  /** 地點 id（npc 時可以不寫：跟著角色走） */
  location?: string
  /** cell：站在這種設施上 */
  cell?: string
  /** dungeon：放在第幾層（outskirts / shallow / middle / deep） */
  layer?: DungeonLayerId
  /** npc：這位固定 NPC 在身邊時 */
  npc?: string
  /** side：哪一種臨時地圖（沒有時任何一種） */
  side_map?: string
  /** special：哪一張特殊地圖 */
  special_map?: string
  /** special：固定地圖上的確切格子（沒有時隨機放在一格空地） */
  x?: number
  y?: number
}

/**
 * 檢定參考某位角色的好感（親密度）：每 per 點 +1（負的就 -1），最多 ±max；
 * min：好感不到這個數字就直接算失敗，不擲骰（見 docs/STORY_QUESTS.md 第 2 節）
 */
export interface StoryAffinity { npc: string; per?: number; max?: number; min?: number }
export interface StoryCheck { attr: AttrId; dc: number; affinity?: StoryAffinity }

/** 任務點的結果：旗標、效果、同行的夥伴、任務完成或失敗 */
export interface StoryOutcome {
  text?: string
  /**
   * 成人向的親密場景（只在特殊任務）：寫了時，這段經過交給「成人場景正文」，依成人場景規則詳細描寫，
   * 不會一筆帶過；寫的是誰和誰、在哪裡、做了什麼（給 AI 看的提示，不顯示給玩家）
   */
  scene?: string
  set_flags?: string[]
  clear_flags?: string[]
  /** 劇情計數器的加減：{ 計數器 id: 增減 } */
  counters?: Record<string, number>
  /** 這些固定 NPC 在這裡死去（故事裡的死亡；不用和他戰鬥）：之後不再出現，需要他的其他任務會失敗 */
  deaths?: string[]
  effects?: RewardEffect[]
  /** 固定 NPC 以「任務同行」加入、離開 */
  join?: string
  leave?: string
  complete?: boolean
  fail_quest?: boolean
  /** 這個任務點可以再來一次（沒有時觸發過就結束） */
  retry?: boolean
  /** 進入臨時地圖（travel_events.json 的 side_maps），出口回到原本的地方 */
  side_map?: string
  /** 傳送到特殊地圖（special_maps.json），站在那張地圖的入口 */
  special_map?: string
  /** 改去別的地點：旅途中直接抵達那裡，不在旅途時被帶到那裡 */
  travel_to?: string
  /** 結束時把時間往前推（timeOfDay.ts）：先推到夜裡（20 點）或隔天早上（8 點），再經過 hours 小時；旅途中不調整 */
  time?: { hours?: number; until?: 'night' | 'morning' }
}

export interface StoryOption {
  label: string
  /** 內容標籤（content.ts 的 CONTENT_TAGS）：設定關掉的標籤的選項不出現，例如 NTR 分支 */
  tags?: string[]
  /** 選項出現的條件（旗標、好感）；沒有時一直都在 */
  requires?: StoryCond
  check?: StoryCheck
  success?: StoryOutcome
  fail?: StoryOutcome
}

/** 任務點：劇情（直接發生）、判定（檢定）、戰鬥、選擇（多個選項，各自可以有檢定） */
export type StoryNodeKind = 'story' | 'check' | 'combat' | 'choice'
export interface StoryNode {
  id: string
  /** 冒險筆記上的目標 */
  title: string
  /** 觸發時的事件描述（給玩家與 AI） */
  text: string
  at: StoryPlace
  /** 解鎖的條件；沒有時任務一開始就解鎖 */
  requires?: StoryCond
  /** 限定穿著：每一項是物品名稱或裝備底材的 id（例如 bunny_suit，任何一件兔女郎裝都算），主角都穿在身上才能進行（任務點照樣出現，按鈕停用並說明） */
  wear?: string[]
  /** 只在白天或夜裡進行（timeOfDay.ts）：時段不對時不算在任務點上（不跳出、不擋路），⭐ 照樣在地圖上 */
  hours?: 'day' | 'night'
  kind: StoryNodeKind
  check?: StoryCheck
  /** 戰鬥：怪物（遭遇表的格式）與固定 NPC */
  enemies?: EncounterGroup
  /** 戰鬥：怪物裡「只在野外發情」（rut: field）的也可以擲到發情（任務需要時才寫） */
  rut?: boolean
  foes?: string[]
  /** 在場的友方固定 NPC：站在任務點旁邊、戰鬥時站在隊伍這邊、判定與敘事時列為在場的人 */
  allies?: string[]
  options?: StoryOption[]
  /**
   * 玩家走到任務點時要先處理（不能移動、休息），另外多一個選擇：
   * 不緊急（預設）多「稍候」：這次先略過，不記事件，離開這裡之後再來還會觸發；緊急（true）多「放棄」：任務線中斷
   */
  urgent?: boolean
  /** 劇情、判定成功、戰鬥勝利 */
  success?: StoryOutcome
  /** 判定失敗、戰鬥落敗或撤退 */
  fail?: StoryOutcome
}

export interface StoryDef {
  id: string
  title: string
  summary: string
  /** 內容標籤（content.ts 的 CONTENT_TAGS：成人向、NTR、非處女、主角非自願）：接任務前顯示，設定關掉的不會開放 */
  tags?: string[]
  /** 建議的公會階級：接取時檢查（同級或更低，組隊時可以高一級；story.ts 的 storyRankOk） */
  rank?: GuildRank
  start: StoryStart
  /** 開始時成立的旗標（任務鏈的第一個旗標） */
  start_flags?: string[]
  nodes: StoryNode[]
  /** 完成時的報酬 */
  rewards?: RewardEffect[]
  /** 完成時的公會功績（沒有時用 progression.json 的 guild_merit.story） */
  merit?: number
  /** 期限：開始後幾天內要完成，過了就失敗（沒有時不限） */
  time_limit?: number
}

// ---- 內容的版本 ----
// 套用世界設定（applyContent）或還原成內建時加一：依內容算出來的快取（任務用到的地標、小隊表……）
// 看這個數字決定要不要重算。只跟遊戲資料有關，不跟存檔有關，不寫進存檔。
let contentRev = 0
export const contentRevision = () => contentRev
export function bumpContentRevision() {
  contentRev++
}

/** 內建的特殊任務；內容頁籤的修改套用在這份清單上 */
export const stories = (storiesJson as unknown as { stories: StoryDef[] }).stories

export type NpcKind = 'commoner' | 'adventurer'

export interface Haunt {
  location: string
  /** 地區：town、noble、palace、temple、outskirts、dungeon（見 grid.ts 的 Zone） */
  zone: string
  weight: number
}
export const npcs = (npcsJson as unknown as { npcs: NpcDef[] }).npcs

// ---- 城鎮的特色地標（docs/LANDMARKS.md） ----

/** 地標的 id：lm_ 開頭（小寫英文、數字、底線），地圖格子的種類就是這個 id */
export type LandmarkId = `lm_${string}`
export const LANDMARK_ID = /^lm_[a-z0-9_]+$/
export function isLandmarkId(id: string): id is LandmarkId {
  return LANDMARK_ID.test(id)
}
export interface LandmarkTypeDef {
  name: string
  /** 生成居民的分布：一般人、冒險者站在這種地標的權重；帶這些標籤的人另外的權重 */
  npc: { commoner?: number; adventurer?: number; tags?: Record<string, number> }
}
export interface LandmarkDef {
  id: string
  name: string
  emoji: string
  /** 所在的聚落 */
  location: string
  /** 在聚落的哪一格（區塊 key 與座標，要是道路） */
  at: { area: string; x: number; y: number }
  /** 地點面板的說明 */
  desc: string
  /** 交給 AI 的氛圍（站在這裡行動時） */
  scene?: string
  /** 類型（landmarks.json 的 types）：居民的分布、公會委託的標的 */
  types: string[]
  /** 開放的條件；不開放時不能參訪、探索、打工、受訓（委託照樣可以做） */
  open?: LandmarkOpen
  /** 參訪：付錢或花時間，得到效果；隔幾天才能再來 */
  visit?: LandmarkVisit
  /** 探索：主動行動的檢定，成功得到效果；隔幾天才能再試 */
  explore?: LandmarkExplore
  /** 在這裡打工（和設施的工作一樣，見 work.ts） */
  work?: { attr: AttrId; dc: number; rate_cc: number; desc: string }
  /** 場景：條件成立時可以選的固定場景（例如解鎖的特殊區域），隔幾天才能再來（預設 3 天，場景之間共用） */
  scenes?: LandmarkScene[]
  /** 內部：一張特殊地圖（固定地圖、同一個聚落）。地標格變成入口，場景可以指定在裡面的哪一格 */
  interior?: string
  /** 拍賣會（成人向，auction.ts；規則在 lewd.json 的 auction） */
  auction?: boolean
}
/** 地標的場景（docs/LANDMARKS.md 第 6 節） */
export interface LandmarkScene {
  /** 名稱（按鈕） */
  title: string
  /** 地點面板的說明 */
  desc?: string
  /** 交給 AI 的經過：這段場景是什麼（{cast} 換成在場的人） */
  scene: string
  /** 內容標籤（成人向的場景照成人場景規則詳細描寫；設定關掉的標籤不出現） */
  tags?: string[]
  /** 出現的條件：劇情旗標 */
  requires?: { flags?: string[]; flags_none?: string[]; flags_any?: string[] }
  /** 只給這些體型的主角（不寫＝都可以） */
  pc_body?: ('masc' | 'fem' | 'andro')[]
  /** 限定穿著：物品名稱或裝備底材的 id，主角都穿在身上才能選（例如打工的制服；和特殊任務的任務點一樣） */
  wear?: string[]
  /** 登場的固定 NPC：寫了旗標的，旗標成立才在場；死了、被抓走的不在場 */
  cast?: { npc: string; flags?: string[] }[]
  /** 有人不在場時，代替的人（例如「其他不知名的魅魔」） */
  extras?: string
  money_cc?: number
  hours?: number
  effects?: RewardEffect[]
  /** 在場的每個固定 NPC 加的好感 */
  affinity?: number
  /** 隔幾天才能再來（預設 3） */
  cooldown_days?: number
  /** 自己算冷卻，不和這個地標的其他場景共用（例如咖啡廳的喝茶） */
  own_cooldown?: boolean
  /** 在地標內部（interior）的哪一格；沒寫時在地標格上（外面） */
  spot?: { x: number; y: number }
  /** 那一格的名稱（地圖上的提示，例如「米米的小房間」） */
  spot_name?: string
}
export interface LandmarkOpen {
  /** 只在白天（6～18 時）或只在夜裡開放 */
  hours?: 'day' | 'night'
  /** 劇情旗標：這些成立（而且那些不成立）時才開放 */
  flags?: string[]
  flags_none?: string[]
  /** 旗標的條件不成立時不顯示：地圖上是普通的道路（例如開幕前的女僕咖啡廳、秘密俱樂部） */
  hidden?: boolean
  /** 在這裡的勢力至少要有這麼多聲望 */
  min_reputation?: number
  /** 官方場所：逃亡奴隸不能用 */
  official?: boolean
  /** 成人向的場所：不當委託地點；內容編輯器的篩選用 */
  adult?: boolean
}
export interface LandmarkVisit {
  title: string
  desc?: string
  money_cc?: number
  hours?: number
  effects: RewardEffect[]
  /** 隔幾天才能再參訪（預設 1：每天一次） */
  cooldown_days?: number
}
export interface LandmarkExplore {
  title: string
  desc?: string
  attr: AttrId
  dc: number
  hours: number
  /** 成功（含大成功）得到的效果 */
  effects: RewardEffect[]
  /** 大成功另外得到的效果 */
  critical?: RewardEffect[]
  /** 隔幾天才能再試（預設 7） */
  cooldown_days?: number
}
const landmarksData = landmarksJson as unknown as { types: Record<string, LandmarkTypeDef>; landmarks: LandmarkDef[] }
export const landmarkTypes = landmarksData.types
/** 目前的地標（內容編輯器會改、加、刪） */
export const landmarks: Record<string, LandmarkDef> = Object.fromEntries(landmarksData.landmarks.map((l) => [l.id, l]))
export function landmarkDef(id: string): LandmarkDef | undefined {
  return isLandmarkId(id) ? landmarks[id] : undefined
}
/** 某個聚落的地標 */
export function landmarksIn(location: string): LandmarkDef[] {
  return Object.values(landmarks).filter((l) => l.location === location)
}

// ---- 特殊地圖（data/world/special_maps.json，說明見 docs/SPECIAL_MAPS.md） ----

/** 特殊地圖的一個通道：這張地圖的 at 格與另一張地圖（城鎮區塊或 sm/ 開頭的特殊地圖）的 to 格互通 */
export interface SpecialConnection {
  at: { x: number; y: number }
  to: { area: string; x: number; y: number }
  /** 這些旗標成立時才打開（沒寫時一直開著） */
  requires?: StoryCond
}
/** 特殊地圖的一格 BOSS：守在 (x, y) 的怪物（一組），name 是地圖上與戰鬥場景顯示的名字（選填） */
export interface SpecialBoss {
  x: number
  y: number
  group: EncounterGroup
  name?: string
}

export interface SpecialMapDef {
  id: string
  name: string
  /** 所屬地點：遭遇表的地區、AI 的場景、戰敗後被送回的地方 */
  location: string
  /** 給 AI 看的描述（外觀、氣氛、危險） */
  desc: string
  lighting?: Lighting
  /** 離開這片特殊地圖之後再進來，內容全部重來 */
  refresh?: boolean
  /** 陷阱、寶箱與所屬地點是地下城時的遭遇，比照哪一層 */
  layer?: DungeonLayerId
  /** 固定地圖：每個字元依 legend（沒寫時用共用的 legend）對應格子種類 */
  grid?: string[]
  legend?: Record<string, CellKindName>
  /** 隨機地圖：大小與挖幾步 */
  size?: [number, number]
  carve_steps?: number
  encounters?: [number, number]
  elites?: number
  traps?: [number, number]
  resources?: [number, number]
  chests?: [number, number]
  /** 遭遇表（沒寫時：所屬地點是地下城就用那一層，否則用地區的城郊遭遇表） */
  table?: EncounterGroup[]
  /** 資源格的採集物（沒寫時用地下城的採集表） */
  resource_items?: string[]
  /** 被事件傳送進來時站的位置（沒寫時是出口，再沒有就是第一格空地） */
  entry?: { x: number; y: number }
  connections?: SpecialConnection[]
  /** 擺在地圖上的商店（shops.json 的店種或自建商店的 id；只有固定地圖） */
  shops?: { shop: string; x: number; y: number }[]
  /** BOSS 格（地圖上的 B）各自的怪物與名字（只有固定地圖；沒設定的 B 格照強敵的規則） */
  bosses?: SpecialBoss[]
  /** 安全的室內（例如地標的內部）：休息不會被襲擊 */
  peaceful?: boolean
}
/** 格子種類的名稱（和 grid.ts 的 CellKind 相同，這裡用字串避免循環引用） */
export type CellKindName = string
const specialMapsData = specialMapsJson as unknown as { legend: Record<string, CellKindName>; maps: Record<string, Omit<SpecialMapDef, 'id'>> }
/** 固定地圖共用的圖例 */
export const specialMapLegend = specialMapsData.legend
/** 目前的特殊地圖（內容編輯器會改、加、刪） */
export const specialMaps: Record<string, SpecialMapDef> = Object.fromEntries(Object.entries(specialMapsData.maps).map(([id, m]) => [id, { ...m, id }]))
export function isSpecialMapId(id: string): boolean {
  return /^sm_[a-z0-9_]+$/.test(id)
}
/** 特殊地圖的區域 key */
export function specialKey(id: string): string {
  return `sm/${id}`
}
/** 區域 key 對應的特殊地圖（不是特殊地圖時為 undefined） */
export function specialMapOfKey(key: string | undefined): SpecialMapDef | undefined {
  return key?.startsWith('sm/') ? specialMaps[key.slice(3)] : undefined
}

export const progression = progressionJson as unknown as {
  life_tiers: { tier: number; levels: [number, number]; max_skill_quality: SkillQuality }[]
  guild_ranks: { rank: GuildRank; levels: [number, number]; merit: number; desc: string }[]
  guild_merit: { quest: number[]; boss: number; story: number; exam_clears: number }
  classes: { id: string; name: string; power: string[] }[]
  races: { id: string; name: string; home: string }[]
  affinity: { min: number; max: number; initial: number; stages: { range: [number, number]; name: string }[] }
  power_gap_attitude: { by_diff: Record<string, string>; clamp: [number, number] }
  ability_rerolls: number
}
/** 一個公會階級的委託報酬（economy.json 的 quest_rewards_cc） */
export interface QuestReward {
  solo: [number, number]
  /** 團隊任務的合計 */
  team?: [number, number]
  /** S 級：單人主導、帶領麾下勢力 */
  leader?: [number, number]
  /** 公會發的委託用哪一種 */
  use: 'solo' | 'team' | 'leader'
  duration_days: [number, number]
  alt_reward?: string
}

export const economy = economyJson as unknown as {
  /** 一般人每天的生活費（罰金、禮物價值的基準） */
  commoner_living_cc_per_day: number
  quest_rewards_cc: { team_size: number; team_mult: number } & Record<string, QuestReward>
  lodging_cc_per_night: Record<string, [number, number]>
  meals_cc: Record<string, number | [number, number]>
}

// ---- 屬性、種族、職業 ----

export type AttrId = 'str' | 'dex' | 'int' | 'fai' | 'cha'
export const ATTR_IDS: AttrId[] = ['str', 'dex', 'int', 'fai', 'cha']
export type Attrs = Record<AttrId, number>

/** 傷害屬性或群組（physical / elemental / divine / arcane / all）→ 倍率加減 */
export type AffinityMap = Partial<Record<string, number>>

/**
 * 抗性（受到的傷害倍率加減）疊在一起時是乘算：每一個來源各自乘上 (1 + 值)，
 * 兩個 -0.5 是 ×0.25 而不是免疫；單一來源 -1 才是免疫，弱點（正值）也一樣相乘。
 */
export function mulResist(into: AffinityMap, from?: AffinityMap) {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (!v) continue
    const m = Math.max(0, 1 + (into[k] ?? 0)) * Math.max(0, 1 + v)
    into[k] = Math.round((m - 1) * 10000) / 10000
  }
}

/** 戰鬥修正，欄位同 statuses.json 的 mods */
export interface Mods {
  hit?: number
  evade?: number
  save?: number
  damage?: number
  dr?: number
  ap_regen?: number
  crit?: number
  /** 仇恨倍率的加減（0.1 = +10%） */
  threat?: number
}

export interface RaceDef {
  name: string
  emoji: string
  bonus: Partial<Attrs>
}

export const attributeRules = attributesJson as unknown as {
  attributes: { id: AttrId; name: string; short: string; desc: string }[]
  score: { min: number; max: number }
  creation: { array: number[]; bonus_points: number; max_score: number }
  level_up_points: number
  races: Record<string, RaceDef>
}

export type CasterType = 'full' | 'half' | 'none'
export interface ClassDef {
  name: string
  /** 仇恨值：開戰時的初始值與累積倍率（combat.json 的 threat） */
  threat?: { start: number; mult: number }
  priority: AttrId[]
  caster: CasterType
  casting?: AttrId
  weapon: string
  armor: string
  start: string[]
  role: string
  emoji: string
  /** 生命骰面數（短休時花費） */
  hit_die: number
  /** 無法戰鬥：同行但不參與戰鬥、不分經驗（普通人入隊時用） */
  noncombat?: boolean
  /** 職業本身的受傷倍率加減（武僧的卸力：物理 -0.25），和防具、特質一樣相乘 */
  resist?: AffinityMap
}
export const classes = (classesJson as unknown as { classes: Record<string, ClassDef> }).classes
/** 普通人入隊時的職業 */
export const NONCOMBAT_CLASS = 'noncombatant'
/** 可以選、可以隨機抽到的職業（不含「無法戰鬥」） */
export const combatClasses: Record<string, ClassDef> = Object.fromEntries(Object.entries(classes).filter(([, c]) => !c.noncombat))

export function classDef(id: string): ClassDef {
  const c = classes[id]
  if (!c) throw new Error(`unknown class: ${id}`)
  return c
}

// ---- 戰鬥規則 ----

export const combatRules = combatJson as unknown as {
  threat: { floor: number; decay: number; gains: Record<'damage' | 'heal' | 'status' | 'defend' | 'miss' | 'item', number> }
  proficiency: { base: number; every_levels: number }
  xp_to_next_level_per_level: number
  party_max: number
  /** 跟著別人的隊伍時的上限（見 party.ts 的 partyMax） */
  party_max_following?: number
  hp: { base: number; per_level: number; min_per_level: number }
  ap: { base: number; every_levels: number; min: number; regen: number; regen_every_levels: number }
  action_costs: { weapon_attack: number; defend: number; flee: number; item: number; spell_by_circle: number[] }
  defend: { evade: number }
  flee_dc: number
  boss: { control_turns: number; immune_turns: number }
  /** 難度係數（存檔規則）：怪物的生命與輸出各乘一個係數，普通 = 1 */
  difficulty: {
    default: string
    levels: { id: string; name: string; hp: number; damage: number; minions?: Partial<Record<MinionTier, { hp: number; damage: number }>>; desc: string }[]
  }
  hit: { evade_floor_base: number }
  lucky: { base: number; attr_floor: number; floor: number }
  save: { dc_base: number }
  concentration: { attr: AttrId; min_dc: number }
  spell_slots: { full: Record<string, number[]>; half_max_circle: number; bonus_max_circle: number }
  cantrip: { scale_levels: number[]; known_base: number; known_every_levels: number }
  quality_by_level: { levels: [number, number]; quality: SkillQuality }[]
  quality_by_circle: SkillQuality[]
  /** 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節） */
  lust: {
    max_base: number; max_per_level: number; decay: number
    party_climax_hp: number; afterglow_turns: number; down_after: number; enemy_climax_hp: number
    aroused_start: number; rut_start: number; aroused_after: number
    kind_resist: Record<string, number>
  }
  defeat_event: {
    npc_tags: string[]; monster_traits: string[]; exclude_traits: string[]
    check: { attr: AttrId; dc: number }
    options: { label: string; attr: AttrId; dc: number }[]
    free_dc: number
    money_loss: Record<Degree, number>
    shaken_on: Degree[]
    /** 這場戰鬥我方每高潮一次，起意的 DC 降低多少（最多 climax_max） */
    climax_dc: number
    climax_max: number
    /** 回應的結果對主角五項指標的加減 */
    lewd: Partial<Record<Degree, Partial<Record<LewdStat, number>>>>
    /** 敵人的類型（docs/LEWD_STATS.md 第 18 節） */
    villains: Record<string, DefeatVillain>
  }
}

/** 戰敗事件裡敵人的類型：依標籤或職業；effects 是 effects.ts 的 RewardEffect */
export interface DefeatVillain {
  name: string
  tags?: string[]
  classes?: string[]
  default?: boolean
  hint: string
  effects?: Partial<Record<Degree, unknown[]>>
  money?: Partial<Record<Degree, number>>
}

export interface DamageTypeDef { id: string; name: string; group: string }
export const damageTypes = damageTypesJson as unknown as {
  types: DamageTypeDef[]
  groups: Record<string, string>
  labels: { max: number; name: string }[]
}
const damageTypeIndex = new Map(damageTypes.types.map((t) => [t.id, t]))

export function damageType(id: string): DamageTypeDef {
  const t = damageTypeIndex.get(id)
  if (!t) throw new Error(`unknown damage type: ${id}`)
  return t
}

export function damageTypeName(id: string): string {
  return damageTypeIndex.get(id)?.name ?? damageTypes.groups[id] ?? id
}

export type LuckRoll = 'attack' | 'evade' | 'save'
export type Control = 'stun' | 'silence' | 'no_cast' | 'taunt' | 'confuse'
export interface StatusDef {
  name: string
  kind: 'buff' | 'debuff'
  mods?: Mods
  luck?: string
  luck_on?: LuckRoll[]
  advantage?: LuckRoll[]
  disadvantage?: LuckRoll[]
  attacked_advantage?: boolean
  attacked_disadvantage?: boolean
  resist?: AffinityMap
  offense?: AffinityMap
  dot?: { dice: string; type: string }
  hot?: string
  pulse?: { dice: string; type: string; mod?: boolean }
  on_hit?: { status?: string; turns?: number; dice?: string; type?: string }
  control?: Control
  special?: 'undying' | 'halve_next' | 'reduce_next'
  charges?: number
  // ---- 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節） ----
  /** 受到的慾望倍率加減（敏感 +0.25、高潮餘韻 -0.5） */
  lust_mult?: number
  /** 這段時間不會高潮（慾望停在上限） */
  no_climax?: boolean
  /** 淨化（cleanse）拿不掉 */
  no_cleanse?: boolean
  /** 戰鬥中的拘束：可以掙脫（自己）或撕開（隊友），數字是 DC 的加減（lewd.json 的 unbind.combat） */
  struggle?: number
  /** 受到的生命傷害有這個比例改成慾望 */
  convert?: number
  /** 被侍奉：下一次受到的攻擊由施加者代為承受，承受的傷害有這個比例改成慾望 */
  guard?: number
  /** 依目前慾望的比例給修正：慾望每 10%，stat +per（最多 max） */
  lust_scale?: { stat: keyof Mods; per: number; max: number }
  /** 每回合開始慾望 +這個數 */
  lust_tick?: number
  /** 慾望上限的倍率加減 */
  lust_max?: number
  /** 慾望不會自然消退 */
  lust_hold?: boolean
  /** 生命低於最大生命的 below 時，受到的生命傷害這個比例改成慾望（戰利品的覺悟） */
  convert_low?: { below: number; ratio: number }
  /** 高潮或引爆時，對所有敵人造成 amount（+ 等級）的 type 傷害（獻祭的契紋） */
  on_release?: { amount: number; level?: boolean; type: string }
  /** 下一個自己的回合開始時，慾望全部消退（潮之新娘） */
  lust_dump?: boolean
  /** 下一次高潮不扣生命（用掉這個狀態；精力藥） */
  climax_guard?: boolean
}
export const statuses = (statusesJson as unknown as { statuses: Record<string, StatusDef> }).statuses

export function statusDef(id: string): StatusDef {
  const s = statuses[id]
  if (!s) throw new Error(`unknown status: ${id}`)
  return s
}

const STATUS_MOD_NAME: Record<string, string> = { hit: '命中', evade: '迴避', save: '豁免', damage: '武器傷害', dr: '減傷', ap_regen: '行動點回復', crit: '幸運一擊閾值 -', threat: '仇恨' }
const ROLL_NAME: Record<LuckRoll, string> = { attack: '攻擊', evade: '迴避', save: '豁免' }
const CONTROL_NAME: Record<Control, string> = { stun: '暈眩（跳過回合、無法迴避）', silence: '無法施法與戲法', no_cast: '無法施法', taunt: '只能攻擊施放者', confuse: '隨機攻擊任何人' }
const SPECIAL_NAME: Record<NonNullable<StatusDef['special']>, string> = { undying: '致命傷保留 1 HP', halve_next: '下一次受到的傷害減半', reduce_next: '下一次物理傷害減去一個數值' }

/** 狀態的效果寫成一段說明（內容編輯器的預覽、戰鬥畫面的提示） */
export function describeStatus(s: StatusDef): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(s.mods ?? {})) {
    if (!v) continue
    if (k === 'threat') parts.push(`仇恨 ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`)
    else if (k === 'crit') parts.push(`幸運一擊閾值 ${v > 0 ? '-' : '+'}${Math.abs(v)}`)
    else parts.push(`${STATUS_MOD_NAME[k] ?? k} ${v > 0 ? '+' : ''}${v}`)
  }
  const rolls = (r?: LuckRoll[]) => (r ?? []).map((x) => ROLL_NAME[x]).join('、')
  if (s.luck && s.luck_on?.length) parts.push(`${rolls(s.luck_on)}${s.luck.startsWith('-') ? ` ${s.luck}` : ` +${s.luck}`}`)
  if (s.advantage?.length) parts.push(`${rolls(s.advantage)}優勢`)
  if (s.disadvantage?.length) parts.push(`${rolls(s.disadvantage)}劣勢`)
  if (s.attacked_advantage) parts.push('被攻擊時對方優勢')
  if (s.attacked_disadvantage) parts.push('被攻擊時對方劣勢')
  for (const [k, v] of Object.entries(s.resist ?? {})) if (v) parts.push(`受到的${damageTypeName(k)}傷害 ×${Math.round((1 + v) * 100) / 100}`)
  for (const [k, v] of Object.entries(s.offense ?? {})) if (v) parts.push(`造成的${damageTypeName(k)}傷害 ×${Math.round((1 + v) * 100) / 100}`)
  if (s.dot) parts.push(`每回合 ${s.dot.dice} ${damageTypeName(s.dot.type)}傷害`)
  if (s.hot) parts.push(`每回合回復 ${s.hot} HP`)
  if (s.pulse) parts.push(`每回合對隨機敵人 ${s.pulse.dice}${s.pulse.mod ? ' + 屬性調整值' : ''} ${damageTypeName(s.pulse.type)}傷害`)
  if (s.on_hit?.status) parts.push(`武器命中時使目標${statuses[s.on_hit.status]?.name ?? s.on_hit.status} ${s.on_hit.turns ?? 1} 回合`)
  else if (s.on_hit?.dice) parts.push(`武器命中時附加 ${s.on_hit.dice} ${damageTypeName(s.on_hit.type ?? '')}傷害`)
  if (s.control) parts.push(CONTROL_NAME[s.control])
  if (s.special) parts.push(SPECIAL_NAME[s.special])
  if (s.charges) parts.push(`生效 ${s.charges} 次後消失`)
  if (s.lust_mult) parts.push(`受到的慾望 ×${Math.round((1 + s.lust_mult) * 100) / 100}`)
  if (s.no_climax) parts.push('不會高潮')
  if (s.convert) parts.push(`受到的生命傷害 ${Math.round(s.convert * 100)}% 改成慾望`)
  if (s.guard) parts.push(`下一次受到的攻擊由施加者代為承受（${Math.round(s.guard * 100)}% 改成慾望）`)
  if (s.lust_scale) parts.push(`慾望每 10%，${STATUS_MOD_NAME[s.lust_scale.stat] ?? s.lust_scale.stat} +${s.lust_scale.per}（最多 +${s.lust_scale.max}）`)
  if (s.lust_tick) parts.push(`每回合慾望 +${s.lust_tick}`)
  if (s.lust_max) parts.push(`慾望上限 ×${Math.round((1 + s.lust_max) * 100) / 100}`)
  if (s.lust_hold) parts.push('慾望不會消退')
  return parts.join('；') || '沒有效果'
}

// ---- 技能、法術、戲法 ----

export type AbilityType = 'skill' | 'spell' | 'cantrip'
export type AbilityTarget =
  | 'enemy' | 'ally' | 'ally_or_downed' | 'self' | 'all_enemies' | 'all_allies' | 'random_enemies'
export interface DamagePart {
  dice?: string
  type?: string
  mod?: boolean
  weapon?: boolean
  scale?: { dice: string; per: number }
  /** 魅惑傷害：目標的受傷倍率至少 ×0.5（對免疫魅惑的不死、構裝也有效） */
  pierce?: boolean
}
export interface ApplyDef {
  status: string
  turns: number
  to?: 'target' | 'self' | 'allies' | 'enemies'
  on?: 'hit' | 'fail' | 'always'
  save?: AttrId
  value?: { dice?: string; mod?: boolean; level?: boolean; flat?: number }
  /** 目標的慾望達到上限的這個比例才套用 */
  if_lust?: number
  /** 目標身上有奴隸印記才套用（驅奴術） */
  if_slave?: boolean
  /** 目標的等級比施放者低才套用（威壓） */
  if_weaker?: boolean
}
export interface AbilityDef {
  id: string
  name: string
  /** 使用時另外加減的仇恨值（例如堅守 +20、隱匿 -10） */
  threat?: number
  type: AbilityType
  classes: string[]
  unlock?: number
  circle?: number
  ap?: number
  attr?: AttrId | 'casting'
  target: AbilityTarget
  count?: number
  resolve: 'attack' | 'save' | 'auto'
  save?: AttrId
  on_save?: 'half' | 'none'
  damage?: DamagePart[]
  mult?: number
  hits?: number
  hit?: number
  adv?: boolean
  crit?: number
  heal?: { dice?: string; mod?: boolean; level?: boolean; flat?: number; full?: boolean }
  shield?: { flat?: number; level?: number }
  apply?: ApplyDef[]
  ap_gain?: number
  ap_gain_on_hit?: number
  uses?: { per_turn?: number; per_combat?: number; per_rest?: number }
  concentration?: boolean
  cleanse?: boolean
  lifesteal?: number
  /** 對身上有奴隸印記的目標，傷害乘上這個數（驅奴術） */
  vs_slave?: number
  recover_slot?: boolean
  hp_limit?: number
  kill?: boolean
  // ---- 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節） ----
  /** 增加目標的慾望 */
  lust_gain?: { flat: number }
  /** 消退目標的慾望 */
  lust_relief?: number
  /** 消耗自己的慾望（不夠就不能用） */
  lust_cost?: number
  /** 慾望在隊伍裡移動：spread 把自己 ratio 的慾望平分給其他友軍（每 shield_per 點給 1 點臨時生命）；take 從其他每位友軍吸 amount 過來 */
  /** dump：吸過來的慾望不會讓自己高潮（停在上限），下一個自己的回合開始時全部消退 */
  lust_transfer?: { mode: 'spread' | 'take'; ratio?: number; amount?: number; shield_per?: number; dump?: boolean }
  /** 擲一次：一半機會全體友軍得到 status（turns 回合），否則全體友軍慾望 + lust */
  gamble?: { status: string; turns: number; lust: number }
  /** 自己的慾望至少要上限的這個比例才能用 */
  requires_lust?: number
  /** 引爆：消耗全部的慾望，造成慾望 × mult + 屬性調整值的 type 傷害（heal 時改成治療目標）；用了立刻結束回合，下一回合脫力 */
  burst?: { type?: string; mult: number; min_ratio?: number; heal?: boolean }
  /** 給目標行動點 */
  ap_give?: number
  /** 用了之後，戰後曝露名聲 +這個數（寬衣） */
  exposure?: number
  /** 升環（只有法術）：用比 circle 高的法術環施放時，每高一環多的效果（upcast.ts） */
  upcast?: UpcastDef
  desc: string
}
/** 升環：每高一環多的效果，數值照 D&D 5e 的升環規則 */
export interface UpcastDef {
  /** 傷害多擲的骰子，加在 damage 的第 part 筆（預設第一筆） */
  dice?: string
  part?: number
  /** 治療多擲的骰子、多的固定值 */
  heal?: string
  heal_flat?: number
  /** 隨機敵人的次數（魔法飛彈的飛彈、連環閃電的跳躍） */
  count?: number
  /** 攻擊次數（灼熱射線的射線） */
  hits?: number
  /** 臨時生命 */
  shield?: number
  /** 施加的持續傷害、每回合攻擊的狀態（月華光束、靈體武器……）每次多擲的骰子 */
  status_dice?: string
}
const abilityList = (abilitiesJson as unknown as { abilities: AbilityDef[] }).abilities
/** 所有能力（玩家自訂的內容會改這份：見 mods.ts） */
export const abilities: Record<string, AbilityDef> = Object.fromEntries(abilityList.map((a) => [a.id, a]))

export function abilityDef(id: string): AbilityDef {
  const a = abilities[id]
  if (!a) throw new Error(`unknown ability: ${id}`)
  return a
}

export function classAbilities(classId: string): AbilityDef[] {
  return Object.values(abilities).filter((a) => a.classes.includes(classId))
}

// ---- 裝備 ----

export interface WeaponDef { name: string; dice: string; type: string; attr: AttrId; scale?: Record<string, string>; threat?: number; natural?: boolean }
export interface ArmorDef { name: string; evade: number; dr: number; resist?: AffinityMap; offense?: AffinityMap; threat?: number }
export const equipment = equipmentJson as unknown as {
  weapons: Record<string, WeaponDef>
  armors: Record<string, ArmorDef>
}

export function weaponDef(id: string): WeaponDef {
  return equipment.weapons[id] ?? equipment.weapons.unarmed!
}

export function armorDef(id: string): ArmorDef {
  return equipment.armors[id] ?? equipment.armors.none!
}

// ---- 敵人 ----

export interface EnemyDef {
  id: string
  name: string
  level: number
  attrs: Attrs
  hp: number
  ap: number
  weapon: { dice: string; type: string; attr: AttrId }
  evade: number
  dr: number
  resist?: AffinityMap
  offense?: AffinityMap
  abilities?: string[]
  /** 生命降到這個百分比（1～99）以下才能用的技能：技能 id → 百分比；沒寫的技能隨時能用 */
  ability_hp_below?: Record<string, number>
  xp: number
  habitats?: string[]
  money_cc?: [number, number]
  /** 掉落物：機率與數量（預設 1） */
  loot?: { item: string; chance: number; qty?: number }[]
  /** 種類：beast、humanoid、undead、spirit、construct、plant、demon、elemental、fey */
  kind?: string
  /** 持有裝備的人形怪物：打倒時有機會掉落裝備（gear.json 的 drops.armed） */
  armed?: boolean
  /**
   * 可以擲到「發情」特徵（monster_traits.json 的 requires）：true 是在哪裡都可能；
   * field 是只在近郊、旅途、地下城的遭遇（特殊任務的戰鬥任務點要寫 rut 才擲，淫鬥場不擲）
   */
  rut?: boolean | 'field'
  /** 魔物娘的樣子（設定「魔物娘」打開時，交給 AI 的名字與外觀換成這個；docs/MONSTERS.md 的「魔物娘」） */
  girl?: MonsterGirl
  /** 一定帶著的特徵（例如層主天生巨大） */
  traits?: string[]
  /** 給 AI 的一句描述（外觀與習性） */
  desc?: string
  /** 上傳的圖示（data URL，只給這一隻怪物）；沒有時依種類與等級用內建的圖 */
  icon?: string
}
/** 怪物的魔物娘形態：name 是給 AI 的稱呼（例如「狼娘」），desc 是外觀與習性（成年女性的身體，保留原本種族的特徵） */
export interface MonsterGirl {
  name: string
  desc: string
}
export type EncounterGroup = [string, number][]
export type DungeonLayerId = 'outskirts' | 'shallow' | 'middle' | 'deep' | 'abyss'
/** 地下城的各層，由淺到深（底層只有寫了 abyss 的地下城才有） */
export const DUNGEON_LAYER_IDS: DungeonLayerId[] = ['outskirts', 'shallow', 'middle', 'deep', 'abyss']
/** 有層主的層 */
export type BossLayerId = Exclude<DungeonLayerId, 'outskirts'>
export const BOSS_LAYER_IDS: BossLayerId[] = ['shallow', 'middle', 'deep', 'abyss']
export const DUNGEON_LAYER_NAME: Record<DungeonLayerId, string> = { outskirts: '周邊', shallow: '淺層', middle: '中層', deep: '深層', abyss: '底層' }
export interface DungeonEncounters {
  outskirts: EncounterGroup[]
  shallow: EncounterGroup[]
  middle: EncounterGroup[]
  deep: EncounterGroup[]
  /** 底層（A 級）：有寫的地下城，深層的層主改成守著往下的階梯，底層是最終層主 */
  abyss?: EncounterGroup[]
  /** 深層的層主（舊資料） */
  boss: EncounterGroup
  /** 各層的層主：淺層、中層（與有底層時的深層）守著往下的階梯，最深的一層是最終層主 */
  bosses?: Partial<Record<BossLayerId, EncounterGroup>>
}
/** 這座地下城有幾層（有底層時 5 層） */
export function dungeonDepth(id: string): number {
  return dungeonEncounters[id]?.abyss?.length ? 5 : 4
}
/** 主題地下城的園區（從入口廣場進出）：回傳入口廣場的特殊地圖 id */
export function parkPlaza(id: string | undefined): string | undefined {
  return id ? locationIndex.get(id)?.park : undefined
}
/** 打倒園區的最終層主時引擎設定的旗標（集章）：park_stamp_<園區 id> */
export const PARK_STAMP_PREFIX = 'park_stamp_'
/** 地下城最上面一層的編號：一般是周邊（0），園區沒有周邊，從淺層（1）開始 */
export function dungeonFirstLayer(id: string): number {
  return parkPlaza(id) ? 1 : 0
}
/** 這隻怪物是不是某座地下城某一層的層主（含內容編輯放上去的層主） */
export function isLayerBoss(id: string): boolean {
  return Object.values(dungeonEncounters).some((e) => e.boss?.[0]?.[0] === id || Object.values(e.bosses ?? {}).some((g) => g?.[0]?.[0] === id))
}
const enemiesData = enemiesJson as unknown as {
  enemies: EnemyDef[]
  encounters: Record<string, DungeonEncounters>
  wild_encounters: Record<string, EncounterGroup[] | string>
}
export const enemies: Record<string, EnemyDef> = Object.fromEntries(enemiesData.enemies.map((e) => [e.id, e]))
export const dungeonEncounters = enemiesData.encounters
/** 城郊遭遇表（玩家自訂內容會直接修改） */
export const wildEncounterTables = enemiesData.wild_encounters

export function wildEncounters(region: string): EncounterGroup[] {
  const table = enemiesData.wild_encounters[region] ?? enemiesData.wild_encounters.default
  return Array.isArray(table) ? table : []
}

/** 小怪最淺出現在哪裡（難度的係數依這個分開）：城郊遭遇表、地下城的周邊、淺層，其他（中層以下、只在特殊任務出現）算 deep */
export type MinionTier = 'wild' | 'outskirts' | 'shallow' | 'deep'
export const MINION_TIERS: MinionTier[] = ['wild', 'outskirts', 'shallow', 'deep']

export function minionTier(id: string): MinionTier {
  const has = (groups: EncounterGroup[] | undefined) => !!groups?.some((g) => g.some(([m]) => m === id))
  if (geography.regions.some((r) => has(wildEncounters(r.id)))) return 'wild'
  const tables = Object.values(dungeonEncounters)
  if (tables.some((e) => has(e.outskirts))) return 'outskirts'
  if (tables.some((e) => has(e.shallow))) return 'shallow'
  return 'deep'
}

// ---- 怪物的特徵與狀態 ----

export interface MonsterTraitDef {
  name: string
  weight: number
  desc: string
  hp_mult?: number
  hp_ratio?: number
  mods?: Mods
  ap?: number
  initiative?: number
  resist?: AffinityMap
  offense?: AffinityMap
  xp_mult?: number
  ai?: MonsterAi
  /** 帶著這個特徵時多會的技能（發情的野獸會撲上來） */
  abilities?: string[]
  excludes?: string[]
  /** 怪物資料上要有這個旗標才會擲到 */
  requires?: 'rut'
}

export interface MonsterAi {
  /** 對仇恨的在意程度：選目標的權重 = floor + 仇恨 × focus（預設 1） */
  focus?: number
  prefer?: 'weakest' | 'caster'
  /** 慾望攻擊的偏好：挑技能時慾望攻擊的分數乘上這個數（發情 1.5） */
  lust?: number
  flee_below?: number
  never_flee?: boolean
}

export const monsterTraits = monsterTraitsJson as unknown as {
  roll: { chance: number; max: number; bonus: Record<string, number> }
  traits: Record<string, MonsterTraitDef>
}

// ---- 委託 ----

export interface TownQuestTemplate {
  id: string
  kind: Exclude<QuestKind, 'clear_dungeon' | MaterialQuestKind>
  area: 'town' | 'outskirts'
  title: string
  scene: string
  /** 城內委託的執行地點（設施種類） */
  spot?: string
  /** 以城鎮的特色地標為標的：地標的類型（發布時挑一個符合的地標，{landmark} 換成它的名字，執行地點就是它） */
  landmark?: string[]
  hours: number
  dc?: number
  item?: string
  qty?: number
  encounter?: EncounterGroup
  encounter_chance?: number
  reward_cc: [number, number]
  /** 交付時的額外報酬（報酬模板，見 effects.ts） */
  rewards?: RewardEffect[]
  /** 發布的條件（劇情旗標、慾望指標……；成人向的委託要曝露名聲或淫亂，docs/LEWD_STATS.md 第 20 節） */
  requires?: StoryCond
  /** 內容標籤（成人向） */
  tags?: string[]
}
export type MaterialQuestKind = 'gather_wild' | 'gather_dungeon' | 'drop_wild' | 'drop_dungeon' | 'boss_hunt'
export interface MaterialQuestDef {
  /** 固定的等級 */
  rank?: GuildRank
  /** 依怪物等級浮動的範圍 [最低, 最高] */
  ranks?: [GuildRank, GuildRank]
  /** 只在這一層（gather_dungeon：周邊） */
  layer?: DungeonLayerId
  qty: [number, number]
  reward_mult?: number
}
export interface MaterialQuestRules {
  max_multiplier: number
  max_cells: number
  item_value_mult: number
  per_town: number
  dungeon_quests: number
  dungeon_kinds: Partial<Record<MaterialQuestKind, number>>
  gather_wild: MaterialQuestDef
  gather_dungeon: MaterialQuestDef
  drop_wild: MaterialQuestDef
  drop_dungeon: MaterialQuestDef
  boss_hunt: MaterialQuestDef
}
/** 委託的期限（天）：城內、近郊固定天數；地下城另加來回路程（per_travel_day × 單程最多天數），最多 max 天 */
export interface QuestDeadlineRules { town: number; outskirts: number; dungeon: number; per_travel_day: number; max: number }
/** 交付委託的經驗：只給 kinds 列的委託，per_rank_level × 委託階級的等級下限 */
export interface QuestXpRules { per_rank_level: number; kinds: string[] }
const townQuestsData = townQuestsJson as unknown as { per_town: number; refresh_days: number; quest_xp?: QuestXpRules; templates: TownQuestTemplate[]; material_quests: MaterialQuestRules; deadline_days?: QuestDeadlineRules }
export const materialQuestRules = townQuestsData.material_quests
export const questDeadlineRules: QuestDeadlineRules | undefined = townQuestsData.deadline_days
export const townQuestsPerTown = townQuestsData.per_town
export const townQuestsRefreshDays = townQuestsData.refresh_days
export const questXpRules: QuestXpRules | undefined = townQuestsData.quest_xp
export const townQuestTemplates: Record<string, TownQuestTemplate> = Object.fromEntries(
  townQuestsData.templates.map((t) => [t.id, t]),
)

// ---- 夥伴、奴隸契約、主動行動 ----

export type Bond = 'hired' | 'voluntary' | 'slave' | 'leader' | 'ally' | 'guest'
export interface ConditionDef {
  name: string
  desc: string
  /** 主動行動檢定的減值（負數是加值） */
  check_penalty?: number
  /** 只影響這些屬性的檢定（沒有時所有檢定） */
  check_attrs?: AttrId[]
  clears?: 'long_rest'
  /** 每場戰鬥的加減 */
  combat_mods?: Mods
  /** 每場戰鬥開始時的暫時生命 */
  combat_temp_hp?: number
  /** 每場戰鬥的慾望上限倍率加減（壯陽料理：0.2 = +20%） */
  combat_lust_max?: number
  /** 同一組只留一個：rank 高的取代低的，低的蓋不掉高的（用餐） */
  group?: string
  rank?: number
  /** 已經有這個狀態時再獲得一次，改成這個狀態（喝酒：興致高昂 → 微醺） */
  stacks_to?: string
  /** 獲得時拿掉這些狀態 */
  replaces?: string[]
}
export const companionRules = companionsJson as unknown as {
  bonds: Record<Bond, string>
  /** 任務同行的夥伴最多幾人（不佔隊伍名額） */
  guest_max: number
  /** 離隊的人留在那座城鎮的酒館幾天（之後照自己的活動範圍走動） */
  leave_stay_days: number
  leave_threshold: number
  initial_affinity: Record<Bond, number>
  tavern: {
    asking: { a: number; b: number; c: number }; asking_variance: number
    hire: { base: number; fee_weight: number; level_gap: number; min: number; max: number }
  }
  wait_party: {
    hours: number; base: number; per_cha_mod: number; per_level: number; max: number
    pay_chance: number; pay_chance_per_cha_mod: number; pay_per_level: number; leader_level: [number, number]
  }
  /** unhireable：不受雇用的人（統治者、機構首長……）邀請的 DC 另外加多少 */
  invite: { min_affinity: number; base: number; affinity_step: number; level_gap: number; unhireable?: number }
  /** 固定 NPC 的小隊（squads.ts）：整隊邀請每多一人 DC +invite_per_member；請他們帶主角同行的 DC */
  squad: { invite_per_member: number; join: { base: number; min: number; affinity_step: number; per_companion: number; level_gap: number } }
  leave_party: { sneak_base: number; affinity: { formal: number; sneak_success: number; sneak_fail: number } }
  rest: { short_hours: number; long_hours: number; long_rest_gap_hours: number; ambush: Record<'settlement' | 'home' | 'wild' | 'dungeon' | 'road' | 'side' | 'special', number> }
  noncombatant: { defeat_check: { dc: number; affinity_step: number }; rescue_hours: number; return_hp_ratio: number }
  conditions: Record<string, ConditionDef>
}

export function conditionName(id: string): string {
  return companionRules.conditions[id]?.name ?? statuses[id]?.name ?? id
}

/** 狀態是好是壞（介面上色用）：檢定減值是壞的；加值、暫時生命、用餐是好的；戰鬥狀態看 kind */
export function conditionTone(id: string): 'good' | 'bad' | 'plain' {
  const c = companionRules.conditions[id]
  if (c) {
    if ((c.check_penalty ?? 0) > 0) return 'bad'
    // 戰鬥修正（命中、傷害、減傷……；仇恨值不算好壞）加總的正負
    const combat = Object.entries(c.combat_mods ?? {}).reduce((t, [k, v]) => (k === 'threat' ? t : t + (v ?? 0)), 0)
    if (combat < 0) return 'bad'
    return (c.check_penalty ?? 0) < 0 || c.combat_temp_hp || c.combat_lust_max || c.group || combat > 0 ? 'good' : 'plain'
  }
  const st = statuses[id]
  return st ? (st.kind === 'buff' ? 'good' : 'bad') : 'plain'
}

/** 非戰鬥狀態的效果簡述（內容編輯器的清單與編輯畫面） */
export function describeCondition(c: ConditionDef): string {
  const parts: string[] = []
  if (c.check_penalty) parts.push(`${c.check_attrs?.length ? c.check_attrs.map(attrName).join('、') : '所有'}檢定 ${c.check_penalty < 0 ? '+' : '-'}${Math.abs(c.check_penalty)}`)
  if (c.combat_temp_hp) parts.push(`每場戰鬥開始時暫時生命 ${c.combat_temp_hp}`)
  if (c.combat_mods && Object.values(c.combat_mods).some(Boolean)) parts.push(`戰鬥中${describeStatus({ name: '', kind: 'buff', mods: c.combat_mods })}`)
  return parts.join('；') || '沒有數值效果'
}

export type ContractFunction = 'identity' | 'obedience' | 'income' | 'tether' | 'tracking' | 'spell_seal' | 'submission'
export interface ContractDef {
  name: string
  mark: string
  place: TattooPlace
  obedience_penalty: number
  income_share: number
  spell_cap?: number
  negotiate_dc: number
  escape_dc: number
  recapture_chance: number
  exit_dc: number
  side_effects: string[]
  escape_effects: { hp_ratio: number }
  /** 順從累積：每這麼多天順從 +1 */
  submission_every?: number
}
export interface MarketDef { name: string; price_mult: number; stock: [number, number]; races: Record<string, number> }
export type Degree = 'critical' | 'success' | 'partial' | 'fail' | 'fumble'
export const slaveryRules = slaveryJson as unknown as {
  prices_cc: Record<'1' | '2' | '3', Record<'human' | 'demon' | 'elf', [number, number]>> & {
    beyond_tier3_mult: number; variance: number
    race_group: Record<string, 'human' | 'demon' | 'elf'>; race_mult: Record<string, number>; class_mult: Record<string, number>
  }
  black_market_only: string[]
  markets: Record<string, { public?: MarketDef; black?: MarketDef }>
  black_market_search: { attr: AttrId; dc: number; hours: number }
  /** 黑市每天刷新的珍品（獨特裝備） */
  curios: { price_mult: number }
  haggle: { attr: AttrId; base: number; black_market_bonus: number; price_factor: Record<Degree, number> }
  self_sale: { hours: number; base: number; per_cha_mod: number; per_level: number; max: number; share: number; contract_weights: Record<string, number> }
  /** 逃亡時在不同地方休息，被契約印記追蹤到的機率倍率（沒列的地方 1） */
  track_place_mult: Partial<Record<string, number>>
  /** 印記模板的用途：default 沒有指定時、madam 老鴇與娼妓主人 */
  roles: { default: string; madam: string }
  /** 奴隸市場上的印記（權重） */
  market_contracts: { public: Record<string, number>; black: Record<string, number> }
  contracts: Record<string, ContractDef>
  functions: Record<ContractFunction, string>
  freedom: {
    negotiate: { attr: AttrId; hours: number; affinity_step: number }
    escape: { attr: AttrId; hours: number }
    punishment: Record<'light' | 'heavy', { hp_ratio: number; affinity: number; obedience?: number }>
    obedience_max: number
    fugitive: { inn_mult: number; inn_recapture_mult: number }
  }
  release_affinity: number
  custom_mark: Record<'income_share' | 'negotiate_dc' | 'escape_dc' | 'exit_dc' | 'recapture_chance' | 'escape_hp_ratio' | 'obedience_penalty', [number, number]> & {
    name_chars: number; mark_chars: number; side_effect_chars: number; side_effects: number
  }
  master_permit: { attr: AttrId; hours: number; affinity_step: number }
  master_home: {
    days: { pivot_exit_dc: number; per_dc: number; min: number; max: number; affinity_step: number }
    tag_days: Record<string, number>
    tag_mult: Record<string, number>
    leave: { attr: AttrId; base: number; hours: number; affinity_step: number }
    strict: { found: number; overdue: number; decay_days: number; max: number }
    overdue: { base: number; per_day: number; max: number }
    district: Record<string, HomeDistrict>
    household: {
      patterns: Record<HomeDistrict, HouseholdPattern[]>
      spouse_same_race: number
      spouse_inherits: string[]
      servant_jobs: string[]
      slave_jobs: string[]
    }
  }
  fugitive_master: { return: { attr: AttrId; base: number; affinity_step: number }; negotiate_dc_bonus: number }
  seek_master: { attr: AttrId; base: number; affinity_step: number }
  /** 被主人帶著時向主人提議雇人、買奴隸（companions.ts 的 proposeDc） */
  propose: {
    attr: AttrId; base: number; affinity_step: number; budget_per_level: number; cost_dc: number; cost_dc_max: number
    wealth: Record<string, number>; tag_dc: Record<'hire' | 'buy', Record<string, number>>
    partial_share: number; critical_affinity: number; fumble_affinity: number
  }
  master_tags: {
    kinds: Record<'adventurer' | 'commoner', { dc: number; market: number }>
    tags: Record<string, { dc: number; chance: number; public: number; black: number; negotiate?: number }>
  }
  unmark: { hours: number; fee_ratio: Record<Degree, number>; services: Record<'temple' | 'carver' | 'mage', UnmarkServiceDef> }
  safe_spots: string[]
  marking: { attr: AttrId; base: number; severity: string[] }
  master_events: {
    step_chance: number; travel_chance: number; cooldown_hours: number
    free_dc: number; free_outcomes: Record<Degree, RewardEffect[]>
    events: MasterEventDef[]
  }
  /** 調教事件（主角對自己的奴隸；S5） */
  owner_events: { events: MasterEventDef[] }
  /** 娼館的打工與受訓事件（S5） */
  brothel_events: { work: MasterEventDef[]; train: MasterEventDef[] }
}

/** 共用主人事件格式的事件庫（內容編輯器「⛓️ 主奴與娼館」） */
export type MasterEventPool = 'master' | 'owner' | 'brothel_work' | 'brothel_train'
export const MASTER_EVENT_POOLS: Record<MasterEventPool, string> = { master: '主人的突發事件', owner: '調教事件', brothel_work: '娼館打工事件', brothel_train: '娼館受訓事件' }

/** 這個事件庫的事件清單（直接改這個陣列就會生效） */
export function masterEventPool(pool: MasterEventPool): MasterEventDef[] {
  const r = slaveryRules as unknown as { owner_events?: { events: MasterEventDef[] }; brothel_events?: { work: MasterEventDef[]; train: MasterEventDef[] } }
  if (pool === 'master') return slaveryRules.master_events.events
  if (pool === 'owner') return ((r.owner_events ??= { events: [] }).events ??= [])
  const b = (r.brothel_events ??= { work: [], train: [] })
  return pool === 'brothel_work' ? (b.work ??= []) : (b.train ??= [])
}

/** 主人家裡的人的一種組成：spouse 是伴侶出現的機率，其他是人數範圍 */
export interface HouseholdPattern {
  weight: number
  spouse?: number
  children?: [number, number]
  servants?: [number, number]
  slaves?: [number, number]
}

export interface MasterEventDef {
  id: string
  weight: number
  /** {master} 會換成主人的名字 */
  text: string
  hours: number
  /** 給玩家選的三種回應 */
  options: MasterEventOption[]
  /** 自己輸入回應時的參考 DC（沒有時用 free_dc） */
  free_dc?: number
  /** 成人向：內容篩選關掉「主角非自願」時不發生 */
  adult?: boolean
  /** 只在經過這種設施（同一格或相鄰）時發生，機率為 chance，不在一般事件的抽選裡 */
  cell?: string
  chance?: number
  /** 成人向的親密場景是什麼（{master} 換成主人的名字）：回應帶 adult_scene 時，敘事要詳細描寫 */
  scene?: string
  /** 只在主人的親密度在這個範圍時發生（含） */
  affinity_min?: number
  affinity_max?: number
  /** 主人有其中一個標籤時才發生 */
  tags?: string[]
  /** 主人有其中一個標籤時不發生 */
  tags_none?: string[]
  /** 只在主人的家裡（at_home: true）或不在家時（false）發生 */
  at_home?: boolean
  /** 離家逾期時的「主人要回家」事件：不在一般事件的抽選裡 */
  overdue?: boolean
  /** 主角身上還有空著的部位時才發生（主人要替主角刺青） */
  free_place?: boolean
  /** 有這位主人會強制主角裝上的東西時才發生（items.json 的 master_force） */
  forced_gear?: boolean
  /** 掛的色情技能（ability_pool 效果從事件庫裡還沒學的技能抽；娼館的事件只抽打工的人還沒學的） */
  teaches?: string[]
  /** 調教課程（調教事件） */
  course?: string
  /** 要求的頭牌等級（娼館的事件） */
  rank_min?: number
  /** 同一個課程成功幾次保證學會一個技能（調教事件） */
  progress?: number
}

export interface UnmarkServiceDef {
  name: string
  desc: string
  /** cell：站在設施上；black_market：知道這裡的黑市，在酒館；caster：身邊或隊伍裡有這些職業的人 */
  where: 'cell' | 'black_market' | 'caster'
  cell?: string
  classes?: string[]
  attr: AttrId
  dc_offset: number
  /** 對魔力封印的印記，DC 再降低 */
  arcane_bonus?: number
  /** 逃亡奴隸的 DC 增加 */
  fugitive_dc?: number
  price_per_point: number
  /** 要在這裡的勢力有這麼多聲望 */
  min_reputation?: number
  /** 解除契約但紋樣留下來變成普通刺青（也能拆誓約印記） */
  convert?: boolean
  fumble: 'backlash' | 'betray'
  backlash_hp_ratio?: number
}

export interface MasterEventOption {
  label: string
  /** 沒有檢定時的結果文字 */
  result?: string
  check?: { attr: AttrId; dc: number }
  success?: string
  fail?: string
  effects?: RewardEffect[]
  effects_success?: RewardEffect[]
  fail_effects?: RewardEffect[]
  /** 覆蓋事件的耗時 */
  hours?: number
  /** 這個回應會進入親密場景（事件的 scene）：always 一定、success / fail 檢定成功或失敗時 */
  adult_scene?: 'always' | 'success' | 'fail'
  /** 屈服（submit）或抵抗（resist）：有檢定時依順從加減（lewd.json 的 master_tool.stance_per） */
  stance?: 'submit' | 'resist'
  /** 成功時（沒有檢定時一定）學會事件掛的一個還沒學的技能（teaches） */
  learn?: boolean
}

export function contractDef(id: string): ContractDef {
  // 沒有這個模板（例如自訂內容刪掉了）：用預設的
  const c = slaveryRules.contracts[id] ?? slaveryRules.contracts[slaveryRules.roles.default]
  if (!c) throw new Error(`unknown contract: ${id}`)
  return c
}

export type ActionKind = 'free' | 'hire' | 'haggle' | 'invite' | 'squad_join' | 'black_market' | 'negotiate' | 'escape' | 'bargain' | 'negotiation' | 'rest_talk'
  | 'chat' | 'gift' | 'flatter' | 'seduce' | 'bluff' | 'intimidate' | 'steal' | 'attack' | 'master_permit' | 'master_leave' | 'marking' | 'master_event'
  | 'master_return' | 'seek_master' | 'unmark' | 'unbind' | 'work' | 'patron' | 'craft' | 'make' | 'produce' | 'invent' | 'defeat_event' | 'story' | 'propose'
  | 'train' | 'perk_pitch' | 'explore' | 'palace_gate'
export type EffectKind = 'affinity' | 'relationship_text' | 'flag' | 'reputation' | 'money' | 'item' | 'xp' | 'meet' | 'ability' | 'hp' | 'mark'
  | 'release' | 'change_master' | 'gear' | 'join' | 'lewd' | 'rumor'
export const actionRules = actionsJson as unknown as {
  dc_adjust: number
  degrees: { critical_margin: number; partial_margin: number; fumble_margin: number }
  caps: {
    affinity: number; reputation: number; money_cc_per_level: number; xp_per_level: number
    item_qty: number; item_qty_bought?: number; items: number; flags: number; relationship_text_chars: number; summary_chars: number; findings_chars: number; narrative_chars: number; meet_affinity: number; hp_loss_ratio: number; hp_gain_ratio: number
    /** 慾望指標：每項每次 ±這個數 */
    lewd: number
  }
  kinds: Record<ActionKind, {
    name: string; attr: AttrId; base?: number; hours: number; effects: EffectKind[]
    /** 社交互動：各成功程度的親密度變化 */
    affinity?: Record<Degree, number>
    value_steps?: number[]
    wealth_scale?: number[]
    status_dc?: number
    /** 誘惑：成功時對方淫亂的增加、慾望抗性每多少換 1 點 DC、對方淫亂每多少點 DC −1 */
    lewd_gain?: Partial<Record<Degree, number>>
    resist_per?: number
    lewd_per?: number
    /** 自由行動：一次最多幾個對象（含主要對象） */
    max_targets?: number
    /** 自由行動：主要對象之外每多一人，DC 增加多少 */
    extra_target_dc?: number
    /** AI 判定時可以填花費的時間（小時）：程式夾在這個範圍，沒填時用 hours */
    hours_range?: [number, number]
    /** AI 判定時可以判為日常小事（difficulty: trivial）：結果至少是成功 */
    trivial?: boolean
  }>
}

export interface GenderDef {
  name: string; color: string; weight: number; names: 'm' | 'f' | 'any'
  /** 交給 AI 時接在性別後面的身體說明（偽娘、TS、扶她），見 genderPrompt */
  ai?: string
}
export const npcPool = npcPoolJson as unknown as {
  genders: Record<string, GenderDef>
  outfits: string[]
  slave_backgrounds: string[]
  commoner_outfits: Record<string, string[]>
}

export interface NpcTagDef {
  name: string
  emoji: string
  kinds: NpcKind[]
  commoner_weight?: number
  adventurer_chance?: number
  /** 冒險者依職業調整 adventurer_chance 的倍率（沒寫的職業是 1），例如聖騎士很少是惡人 */
  class_mult?: Record<string, number>
  extra_chance?: number
  location_types?: string[]
  /** 只出現在有這個地區的聚落（例如娼妓只在有娼館的城鎮） */
  requires_zone?: string
  zone_weights?: Record<string, number>
  haunt_extra?: [number, number]
  haunt_extra_weight?: [number, number]
  wealth: number
  occupations?: string[]
  ai_hint: string
  /** 互斥的標籤（不會同時擁有） */
  exclusive?: string[]
  /** 和帶這個標籤的人互動時的參考 DC 修正 */
  dc_mods?: Partial<Record<'chat' | 'gift' | 'flatter' | 'seduce' | 'hire' | 'invite', number>>
  /** 不會因關係差而在野外動手（被攻擊過才會） */
  never_hostile?: boolean
  /** 對他犯罪被發現時，額外的聲望變化 */
  crime_reputation?: number
  /** false：主角不能選這個標籤（例如奴隸、娼妓，由各自的系統決定） */
  player?: boolean
  /** 主角帶著這個標籤時的效果（見 engine/pcTags.ts） */
  pc_effects?: PcTagEffects
}

/** 主角帶著這個標籤時的效果（docs/NPC_SYSTEM.md 4.1 節；pcTags.ts） */
export interface PcTagEffects {
  /** 所有要聲望的場所都不看聲望 */
  bypass_reputation?: boolean
  /** 檢定的加減（篩選和特質同格式，vs_tags 是對方的標籤） */
  checks?: { check: CheckFilter; bonus: number }[]
  /** 商店的買價、賣價倍率 */
  buy_mult?: number
  sell_mult?: number
  /** 神殿服務（神殿的交易、洗刺青、解除契約）的收費倍率 */
  service_mult?: number
  /** 曝露名聲累積的倍率（成人向） */
  exposure_mult?: number
  /** 主角被賣時的身價倍率（成人向） */
  slave_price_mult?: number
  /** 戰鬥中的慾望抗性（負數是受到的慾望變少；成人向） */
  lust_resist?: number
  /** 給 AI 的身分說明 */
  hint?: string
}

/** 標籤的 DC 修正：所有標籤相加 */
export function tagDcMod(rec: { tags?: string[] }, key: keyof NonNullable<NpcTagDef['dc_mods']>): number {
  return (rec.tags ?? []).reduce((sum, t) => sum + (npcTags.tags[t]?.dc_mods?.[key] ?? 0), 0)
}

/** 兩個標籤互斥嗎（任何一方寫了就算） */
export function tagsExclusive(a: string, b: string): boolean {
  return !!npcTags.tags[a]?.exclusive?.includes(b) || !!npcTags.tags[b]?.exclusive?.includes(a)
}
export const npcTags = npcTagsJson as unknown as {
  kinds: Record<NpcKind, { name: string; zone_weights: Record<string, number>; level?: [number, number]; dungeon_haunts?: [number, number] }>
  neighbor_weight: number
  /** 有性別的職業稱呼（公主／王子……），見 npcs.ts 的 occupationFor */
  gendered_occupations?: { female: string; male: string; neutral: string }[]
  tags: Record<string, NpcTagDef>
}

/** NPC 正在做什麼的時段（見 data/rules/npc_activities.json、activities.ts） */
export type ActivityPeriod = 'dawn' | 'day' | 'evening' | 'night'
/** 一條活動規則：沒寫的條件不限，條件越多越優先 */
export interface ActivityRule {
  at?: string[]
  area?: string[]
  kind?: NpcKind
  staff?: boolean
  tags?: string[]
  occupation?: string[]
  personality?: string[]
  when?: ActivityPeriod[]
  hostile?: boolean
  weight?: number
  list: string[]
}
export const npcActivities = npcActivitiesJson as unknown as {
  slot_hours: number
  periods: Record<ActivityPeriod, [number, number]>
  rules: ActivityRule[]
}

export const population = populationJson as unknown as {
  /** 有娼館的城鎮，名單上至少有幾位娼妓 */
  brothel_workers: number
  roster: Record<string, { adventurer: number; commoner: number }>
  /** 個別地點的名單人數（取代地點類型的人數），例如冒險者特別多的河谷鎮 */
  roster_by_location?: Record<string, { adventurer: number; commoner: number }>
  /** 個別地點的普通人職業：依機率取代標籤的職業描述，例如渡口的水手 */
  local_occupations?: Record<string, { chance: number; list: string[] }>
  adventurer_level: Record<string, [number, number]>
  turnover: { period_days: number; chance: number }
  visitors: {
    outskirts: { chance: number; adventurer: number; reunion_chance: number }
    dungeon: { chance: number; party_chance: number; party_size: [number, number]; villain_chance: number; reunion_chance: number }
  }
  hostility: { affinity: number; sight: number; toll_per_level: number; xp_per_level: number; money_per_level: [number, number] }
}

export function tagDef(id: string): NpcTagDef | undefined {
  return npcTags.tags[id]
}

// ---- 工作與娼館 ----

export interface JobDef {
  name: string
  attr: AttrId
  dc: number
  /** 每小時的基本工資 */
  rate_cc: number
  desc: string
  /** 官方機構：逃亡奴隸不能在這裡工作 */
  official?: boolean
}

export const workRules = workJson as unknown as {
  hours: number[]
  degree_pay: Record<Degree, number>
  fumble_affinity: number
  jobs: Record<string, JobDef>
  brothel: {
    patron: {
      attr: AttrId; dc: number; hours: number; price_cc: number; race_mult: Record<string, number>
      discount: number; overcharge: number; pickpocket_ratio: number; affinity: Record<Degree, number>
    }
  }
}
/** 地標的打工（work.json 的 jobs 以格子的種類為 key，地標的格子種類就是它的 id） */
export function landmarkJob(l: LandmarkDef): JobDef | undefined {
  return l.work ? { name: `${l.name}的雜務`, attr: l.work.attr, dc: l.work.dc, rate_cc: l.work.rate_cc, desc: l.work.desc } : undefined
}
for (const l of Object.values(landmarks)) {
  const job = landmarkJob(l)
  if (job) workRules.jobs[l.id] = job
}

// ---- 物品、商店、談判 ----

export type ItemCategory = 'food' | 'consumable' | 'gear' | 'material' | 'scroll' | 'equipment' | 'info' | 'furniture'
/**
 * 消耗品的效果（都是可以量化的數值）：
 * heal 回復生命（骰子）、slot 回復一個 N 環以下的法術環、cleanse 解除狀態、status 給自己或隊友一個狀態、
 * temp_hp 臨時生命值、ap 立刻獲得行動點、revive 以最大生命的比例救起倒下的隊友、
 * damage 對敵人造成傷害、apply 對敵人施加狀態、save 豁免（成功時傷害減半、不受狀態），area 為投擲的範圍（one 單體、all 全體）；
 * escape 傳送脫離戰鬥。戰鬥以外只能用 heal 與 slot。
 */
export interface ItemUse {
  /** 吃喝：得到這個非戰鬥狀態（companions.json 的 conditions），只能在戰鬥以外使用 */
  condition?: string
  /** 書籍：讀了之後有機會學會其中一個特質（perks.json 的 id；也可以寫說法交給 AI） */
  perks?: string[]
  /** 技能書：每讀一次（約 4 小時）學會清單裡下一個還沒學、等級也夠（能力的 unlock）的能力；色情技能誰都能學，職業能力要是自己職業的 */
  abilities?: string[]
  heal?: string
  slot?: number
  cleanse?: string[]
  status?: { id: string; turns: number }
  temp_hp?: number
  ap?: number
  /** 戰鬥中：慾望增減（負數消退，正數算自己增加的慾望） */
  lust?: number
  revive?: number
  /** 投擲：對敵人造成傷害（area 為 all 時波及所有敵人） */
  damage?: { dice: string; type: string }
  /** 投擲：對敵人施加狀態，save 與 dc 為豁免（成功時不受狀態、傷害減半） */
  apply?: { status: string; turns: number; save?: AttrId; dc?: number }
  /** 投擲的豁免（沒有 apply 也能用）：成功時傷害減半、不受狀態 */
  save?: { attr: AttrId; dc: number }
  area?: 'one' | 'all'
  /** 傳送：全隊立刻脫離戰鬥 */
  escape?: boolean
  combat_only?: boolean
}

export interface ItemDef {
  name: string
  category: ItemCategory
  price_cc: number
  tags: string[]
  desc?: string
  use?: ItemUse
  /** 光源與燃料：每一份在黑暗中能照亮幾格（火把一捆、一瓶燈油） */
  burns?: number
  /** 家具：能放的地方、功能（床、高階工作台）、舒適度（見 docs/HOMES.md） */
  furniture?: FurnitureSpec
  /** 裝備：底材 × 材料（gear.json） */
  gear?: GearSpec
  /** 打造材料：可以做成哪些材料（gear.json 的 materials） */
  forge?: { materials: string[] }
  /** 最低要在哪種規模的聚落才買得到 */
  min_location?: string
  /** 魅氣濃度至少這麼高的聚落才買得到（淫市的貨，docs/LEWD_STATS.md 第 20 節） */
  charm_min?: number
  /** 事件可能出現：AI 判定主動行動時可以把它當成報酬 */
  event?: boolean
  /** 雜物的工具模板（items.json 的 tools） */
  tool?: ItemTool
  /** 情報：解讀之後得到什麼（沒有時是附近隨機的事件點） */
  intel?: ItemIntel
  /** 配方：怎麼做出這件物品（見 docs/CRAFTING.md 第 6 節） */
  recipe?: RecipeSpec
  /** 種子：種在房子的苗圃會長出什麼（見 docs/HOMES.md） */
  seed?: SeedSpec
  /** 主人會強制主角裝上這件裝備（主人的事件 force_equip）；tags：只有這些身分的主人會用（沒有時任何主人） */
  master_force?: { tags?: string[] }
  /** 成人向的物品：內容編輯器的篩選用 */
  adult?: boolean
  /** 鎖（lewd.json 的 locks）：可以替身上的拘束具上鎖，雙面效應的戰鬥增益才生效 */
  lock?: LockGrade
  /** 鑰匙（docs/LEWD_STATS.md 第 16 節）：打開這個等級以下的鎖，用一次就沒了 */
  key?: LockGrade
  /** 獨特物品可以出現在黑市（每天刷新的珍品，見 docs/ITEMS.md 3.1 節） */
  black_market?: boolean
  /** 玩家在世界裡上傳的圖示（data URL，見 itemIcons.ts）；沒有時用底材或類別的圖示 */
  icon?: string
}

/** 配方：用哪種工藝的幾級、哪些材料，做出幾份這件物品 */
export interface RecipeSpec {
  craft: CraftId
  /** 需要的工藝等級（1～5）；也決定 DC 與工具階級 */
  level: number
  inputs: { name: string; qty: number }[]
  /** 一批做出幾份（預設 1） */
  qty?: number
  /** 一批另外要買的東西（瓶子、溶劑、基本食材……），乘地點物價 */
  cost_cc?: number
  /** 一批花幾小時（預設 2） */
  hours?: number
}

/** 種子：種在苗圃（place）上，days 天後收成 yields，數量在 qty 之間；yields 有好幾種時隨機一種 */
export interface SeedSpec {
  yields: string[]
  qty: [number, number]
  days: number
  place: FurniturePlace
}

/**
 * 情報物品解讀之後的內容：
 * point 事件點（event 沒寫時隨機；location 沒寫時在解讀的地方附近；地下城可以指定 layer）、
 * story 特殊任務的消息（開始 story）、lead 進行中委託的線索（委託檢定 +5）。
 */
export interface ItemIntel {
  kind: 'point' | 'story' | 'lead'
  event?: 'combat' | 'chest' | 'merchant'
  location?: string
  layer?: DungeonLayerId
  /** 事件點有效幾天（預設 5） */
  days?: number
  story?: string
}

export type ToolKind = 'lockpick' | 'trap' | 'light' | 'travel' | 'camp' | 'hone' | 'craft'
export interface ItemTool {
  kind: ToolKind
  bonus?: number
  /** 工藝工具：哪種工藝、第幾階（1 低階隨身、2 中階工坊、3 高階工作台） */
  craft?: CraftId
  tier?: 1 | 2 | 3
  /** 照明：燒的是哪種物品（油燈的燈油）；沒有時燒工具本身（有 burns 時）或不會燒掉 */
  fuel?: string
}
export interface ToolDef { name: string; desc: string; bonus?: number; max?: number; condition?: string }
export interface MealDef { id: string; name: string; condition: string; min_location?: string }
export const itemRules = itemsJson as unknown as {
  sell_ratio: number
  material_sell_ratio: number
  custom_price_ranges: Record<string, [number, number]>
  categories: Record<ItemCategory, string>
  meals: { hours: number; menu: MealDef[] }
  tools: Record<ToolKind, ToolDef>
  items: ItemDef[]
}
const itemIndex = new Map(itemRules.items.map((i) => [i.name, i]))
/** 物品清單改變後（玩家自訂內容）重建索引 */
export function reindexItems() {
  itemIndex.clear()
  for (const i of itemRules.items) itemIndex.set(i.name, i)
}
export function itemDef(name: string): ItemDef | undefined {
  return itemIndex.get(name) ?? saveItemIndex.get(name)
}

// 這個存檔自創的物品（自創配方，見 invention.ts）：不在物品目錄裡，讀檔、開新遊戲時換成那個存檔的
const saveItemIndex = new Map<string, ItemDef>()
export function setSaveItems(items: ItemDef[]) {
  saveItemIndex.clear()
  for (const i of items) saveItemIndex.set(i.name, i)
}
export function saveItems(): ItemDef[] {
  return [...saveItemIndex.values()]
}

export type BuiltinShopType = 'general' | 'temple' | 'tavern' | 'smithy' | 'tailor' | 'jeweler' | 'magic' | 'informant' | 'wanderer'
/** 自建的商店：id 是 shop_ 開頭（只有小寫英文與數字），地圖格子的種類就是這個 id */
export type CustomShopId = `shop_${string}`
export type ShopType = BuiltinShopType | CustomShopId
export const CUSTOM_SHOP_ID = /^shop_[a-z0-9]+$/
export function isCustomShopId(id: string): id is CustomShopId {
  return CUSTOM_SHOP_ID.test(id)
}
/** 可以指定固定 NPC 擔任店主的內建店種（流浪商人不是固定的店）；自建的商店也可以 */
export const KEEPER_SHOPS: ShopType[] = ['general', 'temple', 'tavern', 'smithy', 'tailor', 'jeweler', 'magic', 'informant']
/** 商店的設定（自建的商店被刪掉時丟出錯誤） */
export function shopDef(type: ShopType): ShopTypeDef {
  const d = shopRules.types[type]
  if (!d) throw new Error(`沒有這家店：${type}`)
  return d
}
export function isKeeperShop(id: string): boolean {
  return (KEEPER_SHOPS as string[]).includes(id) || isCustomShopId(id)
}
export interface DealCost { type: 'money' | 'item' | 'hours'; amount?: number; name?: string; qty?: number }
export interface ShopSpecial {
  id: string; title: string; desc?: string; gives: DealCost[]; gets: RewardEffect[]; stock: number
  /** 氛圍性的交易：給 AI 的提示（帶進這次交易的敘事，寫成無關緊要的日常，例如酒保的閒話） */
  flavor?: string
}
export interface ShopTypeDef {
  name: string
  cell: string
  /** 地圖與標題的圖示 */
  emoji: string
  /** 商店畫面的說明 */
  desc: string
  /** AI 判定開啟時，請 AI 設計今天的特別商品 */
  ai: boolean
  /** 店主：職稱與身分標籤（生成店主時用；classes 保留給 AI 參考） */
  keeper: { classes: string[]; title: string; tags?: string[] }
  catalog_tag: string
  /** 每天另外上架幾件服裝（底材有 outfit 的裝備）：[最少, 最多]；沒有時不賣服裝 */
  outfits?: [number, number]
  /** 每天另外上架幾件拘束具（束縛用的底材）：[最少, 最多]；沒有時和一般裝備一起抽（docs/LEWD_STATS.md 第 7 節） */
  restraints?: [number, number]
  buys: ItemCategory[]
  ai_effects: RewardEffect['type'][]
  specials: ShopSpecial[]
  /** 每天隨機上架：目錄裡任何商店的消耗品與材料（材料的售價 = 收購價 × material_markup） */
  random?: { consumables?: number; materials?: number; material_markup?: number; max_material_price?: number[] }
  /** 情報商：事件點的情報（依層數的價格：近郊、周邊、淺層、中層、深層）、特殊任務的消息、委託的線索 */
  info?: { point_prices: number[]; points_per_day: number; valid_days: number; quest_price: number }
  /** 流浪商人：每天幾件隨機的優良裝備 */
  rare_gear?: number
  /** 固定清單：每天一定上架的物品（世界設定加的；price_cc 沒寫照目錄價） */
  fixed?: ShopFixedDeal[]
  /** 自建的商店（內容編輯器建立；cell 就是自己的 id） */
  custom?: boolean
  /** 自建的商店：接哪些材料類型的打造委託（metal、wood、leather、cloth、jewel） */
  craft?: string[]
}
export interface ShopFixedDeal { item: string; stock: number; price_cc?: number }
export const shopRules = shopsJson as unknown as {
  location_price_mult: Record<string, number>
  location_rank: Record<string, number>
  /** 旅途上的驛站：物價與貨色照哪種聚落算 */
  waystation: { price_as: string; name: string }
  affinity_discount_per_point: number
  max_affinity_discount: number
  max_deals: number
  ai_caps: { affinity: number; reputation: number; price_floor_ratio: number; deals: number; stock: number }
  bargain: { base: number; price_factor: Record<Degree, number> }
  types: Record<ShopType, ShopTypeDef>
  /** 店名與描述的生成規則（見 shopNames.ts） */
  naming: ShopNaming
}
/** 店名的字詞：地區 → 字詞、氛圍，可以改店型的後綴；手寫覆寫依地點 */
export interface ShopNaming {
  suffix: Record<string, string[]>
  regions: Record<string, { words: string[]; air: string[]; suffix?: Record<string, string[]> }>
  desc: Record<string, string[]>
  greeting: Record<string, string[]>
  overrides: Record<string, Record<string, { name?: string; desc?: string; greeting?: string }>>
}

export interface NegotiationOutcome { text: string; effects: RewardEffect[] }
export interface NegotiationTemplate {
  title: string
  goal: string
  counterpart: 'guild_clerk' | 'informant' | 'keeper'
  base: number
  rank_dc: number
  options: { label: string; attr: AttrId; dc: number; cost_cc?: number; cost_ratio?: number }[]
  outcomes: Record<Degree, NegotiationOutcome>
}
export const negotiationRules = negotiationsJson as unknown as {
  max_attempts: number
  templates: Record<string, NegotiationTemplate>
}

// ---- 性別、種族與職業的顯示 ----

export const GENDER_IDS = Object.keys(npcPool.genders).filter((k) => !k.startsWith('$'))

/** 性別：NPC 用 id；主角是自由輸入的文字，能對應到已知性別時沿用其顏色 */
export function genderDef(g?: string): (GenderDef & { id: string }) | undefined {
  if (!g) return undefined
  const byId = npcPool.genders[g]
  if (byId && !g.startsWith('$')) return { ...byId, id: g }
  const text = g.trim().toLowerCase()
  const alias: Record<string, string> = {
    男: 'male', 男性: 'male', male: 'male', m: 'male', 女: 'female', 女性: 'female', female: 'female', f: 'female',
    偽娘: 'femboy', 伪娘: 'femboy', ts: 'ts', 扶她: 'futa', 未知: 'unknown', 不明: 'unknown',
  }
  const id = alias[text]
  return id ? { ...npcPool.genders[id]!, id } : undefined
}

export function genderName(g?: string): string {
  return genderDef(g)?.name ?? g ?? ''
}

/** 交給 AI 的性別：顯示名稱，偽娘、TS、扶她再附上身體的說明（例如 TS 沒有陰唇）；對應不到的主角性別照原文 */
export function genderPrompt(g?: string): string {
  const def = genderDef(g)
  if (!def) return g ?? ''
  return def.ai ? `${def.name}（${def.ai}）` : def.name
}

export function raceEmoji(id: string): string {
  return attributeRules.races[id]?.emoji ?? ''
}

export function classEmoji(id: string): string {
  return classes[id]?.emoji ?? ''
}

// ---- 查詢 ----

const locationIndex = new Map(geography.locations.map((l) => [l.id, l]))
const regionIndex = new Map(geography.regions.map((r) => [r.id, r]))

export function locationById(id: string): Location {
  const loc = locationIndex.get(id)
  if (!loc) throw new Error(`unknown location: ${id}`)
  return loc
}

export function regionById(id: string): Region {
  const region = regionIndex.get(id)
  if (!region) throw new Error(`unknown region: ${id}`)
  return region
}

export function className(id: string): string {
  return classes[id]?.name ?? id
}

export function raceName(id: string): string {
  return attributeRules.races[id]?.name ?? id
}

export function attrName(id: AttrId): string {
  return attributeRules.attributes.find((a) => a.id === id)?.name ?? id
}

/** 有公會、旅店、酒館的聚落 */
export function isSettlement(loc: Location): boolean {
  return loc.type !== 'dungeon'
}


// ---- 工藝（crafts.json，見 docs/CRAFTING.md） ----

export type CraftId = 'smithing' | 'woodworking' | 'leatherwork' | 'tailoring' | 'jewelcraft' | 'alchemy' | 'cooking'

export interface CraftSkillDef {
  name: string
  /** 處理的材料種類（gear.json 的 materials.kind）；煉金、烹飪沒有，只走配方 */
  kinds: string[]
  attr: AttrId
  /** 可以租工坊、委託打造的店 */
  shop: string
}

export const craftRules = craftsJson as unknown as {
  skills: Record<CraftId, CraftSkillDef>
  max_level: number
  level_bonus: number
  xp_to_next: number[]
  xp: Record<Degree, number>
  tool_tier: number[]
  tool_tier_names: string[]
  safe_points: string[]
  workshop_rent: { per_hour_cc: number }
  self: { hours: number; tier1_cost_ratio: number }
  shop_levels: Record<string, [number, number]>
  companion: { min_affinity: number }
  recipe: { dc: number[]; max_batches: number; critical_bonus: number; partial_ratio: number; lost_on_fail: number }
  invention: { categories: Record<CraftId, ItemCategory[]>; dc_bonus: number; hours: number; max_effects: number; max_inputs: number }
  dismiss_penalty: { days: number; affinity: number; price_mult: number; notoriety_days: number }
}

export const CRAFT_IDS = Object.keys(craftRules.skills) as CraftId[]

// ---- 房屋（homes.json，見 docs/HOMES.md） ----

export type FurniturePlace = 'indoor' | 'yard' | 'basement'

export interface FurnitureSpec {
  places: FurniturePlace[]
  /** bed：在家長休；workbench：高階工作台（craft）；garden：可以播種的苗圃；training：調教室的家具（docs/LEWD_STATS.md 第 19 節） */
  function?: 'bed' | 'workbench' | 'garden' | 'training'
  craft?: CraftId
  /** 調教室的家具：在家調教時的檢定加值 */
  training?: number
  comfort?: number
  icon?: string
}

export type HomeDistrict = 'cottage' | 'townhouse' | 'house' | 'manor'

export interface HomeDistrictDef {
  name: string
  price_cc: number
  floors: number
  basement: boolean
  size: [number, number]
  yard: number
  rooms: [number, number]
}

export const homeRules = homesJson as unknown as {
  districts: Record<HomeDistrict, HomeDistrictDef>
  by_location: Record<string, HomeDistrict>
  noble: HomeDistrict
  lots: Record<string, number>
  comfort_rested: number
}

// ---- 特質（被動，data/rules/perks.json，見 docs/PERKS.md） ----

/** 檢定的情境：主動行動以外的檢定各有一種 */
export type CheckContext =
  | 'action' | 'negotiation' | 'master_event' | 'gate' | 'trap' | 'lock' | 'travel' | 'road' | 'quest' | 'retreat' | 'stealth'
  | 'initiative' | 'save'

/** 檢定加值適用的範圍：同一欄位是「或」，不同欄位是「且」；沒寫的欄位不限 */
export interface CheckFilter {
  attrs?: AttrId[]
  contexts?: CheckContext[]
  kinds?: ActionKind[]
  vs_tags?: string[]
}

export type PerkEffect =
  | { check: CheckFilter; bonus: number }
  | { combat: Mods }
  | { resist: AffinityMap }
  | { offense: AffinityMap }

export interface PerkDef {
  id: string
  name: string
  desc: string
  effects: PerkEffect[]
  /** 缺陷：效果是負的（檢定減值、戰鬥減值、弱點）；不能從機會學，事件直接給，受訓（train）是克服它 */
  flaw?: boolean
  /** 種族特質（原本的種族天賦）：這個種族的角色自動擁有，不寫進存檔；不能選、不能學、不會失去 */
  race?: string
  /** perks：要先有這些特質（流派的進階特質要先入門） */
  requires?: { races?: string[]; classes?: string[]; perks?: string[] }
  /** 和這些特質互斥 */
  exclusive?: string[]
  /** 可以在這些設施花錢學（缺陷：花錢克服） */
  train?: { cells: string[]; price_cc: number; hours: number; attr: AttrId; dc: number }
  /** NPC 生成時抽到的權重與更容易抽到的標籤、職業 */
  npc?: { weight?: number; tags?: string[]; classes?: string[] }
  /** 玩家自訂或 AI 設計的（不在清單裡） */
  custom?: boolean
  /** 稀有度（common～legendary）：只決定圖示的顏色；沒寫時依強度 */
  rarity?: string
  /** 分類（建角時依分類折疊，見 perks.ts 的 PERK_CATEGORIES）；沒寫時依效果推斷 */
  category?: string
  /** 能在城外的野外、旅途上紮營長休（rest.ts 的 campRest）：隊伍裡有一個人有就可以 */
  camp?: boolean
  /** 慾望流派（lewd.json 的 schools）：入門或進階特質（流派只是特質，不限制能學的技能） */
  school?: string
  /** 流派特質的慾望效果（docs/LEWD_STATS.md 第 6 節） */
  lust?: LustPerk
}

export const perkRules = perksJson as unknown as {
  contexts: Record<CheckContext, string>
  levelup: { levels: number[]; choices: number }
  npc: { chances: number[]; flaw_chance: number; tag_mult: number; class_mult: number }
  creation: { slots: number; max_flaws: number; slots_per_flaw: number }
  pitch: { attr: AttrId; dc: number; hours: number; power_delta: Partial<Record<Degree, number>> }
  custom: {
    name_chars: number; desc_chars: number; effects: number; check_bonus: [number, number]; combat: [number, number]; resist: [number, number]
    flaw: { check_bonus: [number, number]; combat: [number, number]; resist: [number, number] }
  }
  perks: PerkDef[]
}

/** 清單裡的特質 */
export function perkDef(id: string): PerkDef | undefined {
  return perkRules.perks.find((p) => p.id === id)
}

/** 可以取得的特質（建角、升級、事件、訓練、書籍、NPC 的特質清單）：種族特質除外 */
export function choosablePerks(): PerkDef[] {
  return perkRules.perks.filter((p) => !p.race)
}

/** 可以取得的特質 id（種族特質與不存在的回傳 false） */
export function isChoosablePerk(id: string): boolean {
  const p = perkDef(id)
  return !!p && !p.race
}

// ---- 慾望指標（docs/LEWD_STATS.md） ----

export type LewdKey = 'lewdness' | 'sensitivity' | 'endurance' | 'submission' | 'exposure'
/** 雙面效應的拘束種類（底材的 bind_kind） */
export type BindKind = 'legs' | 'hands' | 'eyes' | 'stim' | 'body' | 'mouth'
export const BIND_KINDS: BindKind[] = ['legs', 'hands', 'eyes', 'mouth', 'stim', 'body']
/** 鎖的等級（物品的 lock、裝備上的鎖） */
export type LockGrade = 'white' | 'blue' | 'rune' | 'gold'
export const LOCK_GRADES: LockGrade[] = ['white', 'blue', 'rune', 'gold']
/** 陷阱鎖（事件的 restrain 鎖在主角身上的）：EquippedGear.locked 的前綴，不綁契約（docs/LEWD_STATS.md 第 27 節） */
export const TRAP_LOCK = 'trap:'
/** 慾望流派（lewd.json 的 schools） */
export interface LewdSchool { name: string; group: string; role: string; entry: string; advanced: string; fit: BindKind[] }
/**
 * 流派特質的慾望效果（PerkDef.lust；慾望戰鬥關閉時不生效）。數值都是加在基本值上的：
 * max 慾望上限、taken 受到的慾望倍率、self 自己增加的慾望倍率、convert 傷害轉成慾望的比例（有轉換的狀態時）、
 * burst 引爆的傷害倍率、relief 消退慾望的倍率、crit_convert 受到幸運一擊時改成慾望的比例、regen 慾望一半以上時每回合回復的生命、
 * climax_heal 高潮時回復最大生命的比例、exposure 曝露名聲的魅惑傷害加值倍率、exposure_level 穿著的曝露度每 1 點的魅惑傷害、
 * endurance_max 忍耐每 20 點的慾望上限、sensitivity_bonus 敏感每 25 點的魅惑傷害、growth 指標成長的倍率（-0.5 = 減半）、
 * wounded 生命低於一半時的戰鬥修正、master 主人在隊伍裡時的戰鬥修正（奴之誓）、bound 穿著上鎖的拘束具時的戰鬥修正、bound_max 同上的慾望上限
 */
export interface LustPerk {
  max?: number; taken?: number; self?: number; convert?: number; burst?: number; relief?: number; crit_convert?: number; regen?: number
  climax_heal?: number; exposure?: number; exposure_level?: number; endurance_max?: number; sensitivity_bonus?: number
  growth?: Partial<Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', number>>
  wounded?: Mods; master?: Mods; bound?: Mods; bound_max?: number
}
type LewdBonus = Partial<Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', number>>
export const lewdRules = lewdJson as unknown as {
  stats: Record<LewdKey, { name: string; bands: string[]; forced_bands?: string[] }>
  defaults: Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', number>
  npc_tags: Record<string, Partial<Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', [number, number]>>>
  npc_random: Record<'lewdness' | 'sensitivity' | 'endurance' | 'submission', [number, number]>
  combat: {
    endurance_max_div: number; sensitivity_base: number; sensitivity_div: number; lewd_start_per: number; lewd_start_ratio: number; lewd_decay_div: number
    self_gain_lewd: number; self_gain_bonus: number; submission_per: number; submission_convert: number; exposure_per: number; faith_resist: number
    bond_step: number; bond_share: number; bond_max: number
  }
  gear: {
    item_cap: number; total_cap: number; exposure_slots: string[]
    outfit: Partial<Record<'regular' | 'anime' | 'adult', { exposure?: number; lewd?: LewdBonus }>>
    restraint: { lewd?: LewdBonus }
    underwear_visible: number; naked: number
  }
  schools: Record<string, LewdSchool>
  servitude: { no_master: number }
  outfit_two_face: {
    penalty_tags: string[]; penalty_kinds: string[]; penalty_per: number; penalty_max: number; endurance_per: number; max_pieces: number
    schools: Record<string, { lust_bonus?: number; evade?: number; save?: number }>
  }
  outfit_tailor: { charm_min: number; fee_mult: number; fee_base: number; stats: LewdStat[]; bonus: Record<string, number> }
  auction: {
    lots: number; start_ratio: number; rival_ratio: [number, number]; step: number; consign_ratio: [number, number]; consign_fee: number
    watch_chance: number; watch_flag: string; pool: [string, number][]
  }
  two_face: {
    endurance_per: number; fit: number; servitude_master: number
    kinds: Record<BindKind, { name: string; checks: CheckFilter[]; penalty: number[]; combat: (Mods & { initiative?: number })[]; immune?: string[] }>
  }
  locks: { grades: Record<LockGrade, { name: string; mult: number }>; master_default: LockGrade; master_tags: Record<string, LockGrade> }
  master_tool: { release_affinity: number; new_master_affinity: number; hours: number; submission_dc_per: number; stance_per: number }
  training: {
    sub_div: number; low_affinity: number; low_dc: number; progress: number; backlash_affinity: number; backlash_delta: number
    /** 調教室（家具的 training）：在家調教的加值上限、留在家裡的奴隸每天的順從、反彈時逃走的機率 */
    room_max: number; resident_submission: number; escape_chance: number
    courses: Record<string, { name: string; attr: AttrId; stats: Partial<Record<LewdKey, number>>; affinity?: number; desc: string }>
  }
  brothel: {
    work_event: { base: number; per_lewd: number; max: number }
    ranks: { min: number; name: string }[]
    rank_gain: { work: number; event: number }
    wage_per_rank: number
    train: { price_base: number; price_per_unlock: number; discount_per_rank: number; review: RewardEffect[] }
    patron: { affinity_min: number; chance: number; tiers: { lewd: number; unlock: number }[]; default: string[] }
    propose: { attr: AttrId; dc: number; lewd_div: number; affinity_div: number; tags: Record<string, number>; share: number; fail_affinity: number; fumble_affinity: number }
  }
  growth: Record<'adult_scene' | 'climax' | 'climax_won' | 'brothel_work' | 'obedience' | 'disrobe', Partial<Record<LewdKey, number>>>
  daily: {
    adult_outfit: LewdBonus; restraint: LewdBonus; locked: LewdBonus
    free_submission_every: number; idle_days: number; exposure_decay: number; exposure_per_level: number; settlements: string[]
  }
  park: ParkRules
  /** 慾望勝利的「征服」掉落：打倒的怪物在高潮中屈服時，有 chance 的機率依種類多掉一件 */
  conquest: { chance: number; kinds: Record<string, string> }
  arena: {
    charm_min: number; cells: string[]; fee: number; streak_per_tier: number
    prize: { base: number; per_tier: number }
    item_chance: number; items: string[]; book_tier: number; book_chance: number; books: string[]
    wager: { mult: number; loss: Partial<Record<LewdKey, number>> }
    lust_convert: number
    /** rare：對手等級 tier 以上的勝場有 chance 的機率拿到 items 裡的一樣（這個擂臺專屬的獎品） */
    rings: Record<string, { name: string; desc: string; restraint?: boolean; lust_only?: boolean; tiers: EncounterGroup[]; rare?: { tier: number; chance: number; items: string[] } }>
  }
  slave_price: { above: number; per: Partial<Record<LewdStat, number>>; per_skill: number; max: number }
  npc_schools: { tags: Record<string, { chance: number; schools: string[] }> }
  portrait: Partial<Record<'lewdness' | 'exposure', [number, string][]>>
  fusion: { shops: string[]; fee_cc: number; days: number; tiers: [number, number][]; penalty_mult: number }
  slave_room: {
    charm_min: number; cost_ratio: number; submission: number; learn_chance: number; abilities: string[]; condition: string; scene: string
  }
  unbind: {
    attr: AttrId; base: number; lock_dc: Record<LockGrade, number>; bind_dc: number; endurance_per: number; fumble_submission: number
    keys: { chance: number; levels: [number, LockGrade][] }
    combat: { ap: number; base: number; per_level: number; hands: number }
    /** 鐵匠剪鎖：只剪陷阱鎖（docs/LEWD_STATS.md 第 27 節） */
    cut: { shops: string[]; fee_cc: Record<LockGrade, number> }
  }
  charm: {
    names: string[]
    regions: Record<string, number>
    locations: Record<string, number>
    exposure_mult: number[]
    rut_mult: number[]
    spread: { ratio: number }
    gate: { min: number; item: string; lock: string }
    ai: string[]
  }
}
/** 主題地下城（魅魔的遊樂園）的規則：魅氣、擬態寶箱、寶箱加料、各園區的專屬戰敗 */
export interface ParkRules {
  /** 每走一格，全隊的魅氣（跨戰鬥保留的慾望，慾望上限的比例）增加多少；走路最多累積到 step_cap */
  step_lust: number
  step_cap: number
  /** 園區的陷阱沒察覺時（媚藥機關），觸發的人魅氣增加多少（取代陷阱的傷害） */
  trap_lust: number
  /** 園區的寶箱有這個機率是擬態寶箱（打開時變成戰鬥）；mimics 依層（1 淺層、2 中層、3 深層）的怪物 */
  mimic_chance: number
  mimics: Record<string, string>
  /** 個別園區自己的擬態寶箱（地點 id → 依層的怪物），覆蓋 mimics；例如緋夢樂園底下的遺跡（docs/LUST_PARK.md 第 8 節） */
  mimics_at?: Record<string, Record<string, string>>
  /** 不蓋集章卡的園區（地點 id）：打倒最終層主不立 park_stamp_ 旗標 */
  unstamped?: string[]
  /** 園區的寶箱另外擲的物品 [名稱, 機率] */
  chest_items: [string, number][]
  /** 每個園區（地點 id）的專屬戰敗：AI 的成人場景、摘要、效果、經過的時間 */
  defeats: Record<string, { scene: string; summary: string; effects: RewardEffect[]; hours: number }>
}

