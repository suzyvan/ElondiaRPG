// 遊戲狀態、時間與報告提交。

import { refundSpareAttrPoints } from './xpSinks'
import { fitCreationPerks, sanitizePerk } from './perks'
import { baseAttrs, createPlayer, gainXp, guildRankFor, recalc } from './character'
import { pruneSpecialMaps } from './specialMaps'
import { pruneParasites, refreshParasiteMarks } from './parasites'
import { pruneLocations } from './pruneLocations'
import { abilities, attributeRules, classDef, classes, contractDef, companionRules, findLocation, isChoosablePerk, itemDef, locationById, perkDef, setSaveItems, specialMapOfKey, statuses, type Attrs, type PerkDef } from './data'
import { noteLoot } from './expedition'
import { creationGear, gearRules, setExtraSlotCount, syncGear, wearDefaultUnderwear, type CreationGear } from './gear'
import { addMerit, applyRankUp } from './guild'
import { contractTerms, termsFromTemplate, type SlaveStart } from './slavery'
import { backfillEventMemories, ensureRelationship, MEMORY_RULES_VERSION, recordMemory, setAffinity } from './social'
import { Rng } from './rng'
import type { Character, ContractRef, EquippedGear, GameOptions, GameState, GameTime, InventoryItem, MarkTerms, Report } from './types'
import { contractOf, setContract } from './tattoos'
import { gameRule } from './gameRules'
import { moneyPartsShown } from './money'
import { hasItemKey, itemKey, sameShape } from './itemKey'
import { backfillLewdSkills, lewdDaily, noteAdultScene } from './lewd'
import { staffDaily } from './staff'
import { familyTick } from './pregnancy'
import { pcTagStartItems, sanitizePcTags } from './pcTags'
import { startCrafts } from './crafting'
import { occupationFor } from './npcs'
import { characterBody, genderId, lookAppearance, sanitizeLook } from './look'
import { BODIES, bodyOf, type Body } from './traits'
import { pcExperience, rescueStoryVirgins } from './sexRecord'

export const START_LOCATION = 'soriel'
export const START_MONEY_CC = 500

export interface NewGameOptions {
  name: string
  race: string
  classId: string
  bonus?: Partial<Attrs>
  seed?: number
  /** 出生地（聚落的 location id），也是冒險的起點 */
  birthplace?: string
  gender?: string
  appearance?: string
  background?: string
  /** 體型與各部位的體態（見 engine/look.ts）；體態寫在外貌的開頭 */
  body?: Body
  look?: Record<string, string>
  /** 以奴隸身分開始（主人與印記，見 engine/slavery.ts） */
  slave?: SlaveStart
  /** 建立角色時選的特質（perks.json 的 id）與自訂的特質（docs/PERKS.md） */
  perks?: string[]
  customPerks?: unknown[]
  /** 身分標籤（npc_tags.json 的 id，最多 3 個，見 pcTags.ts） */
  tags?: string[]
  /** 這個存檔的規則（沒有時用預設） */
  options?: Partial<GameOptions>
  /** 建角時挑的裝備（沒有時用職業的起始裝備）與預算（材料等級點數，見 gear.ts 的 creationGear） */
  gear?: CreationGear
  gearBudget?: number
  /** 主角的性經驗（成人向，docs/LEWD_STATS.md 第 29 節）：有沒有，以及一句話的初體驗；沒有時算沒有經驗 */
  experience?: { experienced: boolean; note?: string }
}

/** 各種族的預設出生地 */
export const DEFAULT_BIRTHPLACE: Record<string, string> = {
  human: 'soriel', elf: 'silvermoon', dwarf: 'ironforge', demon: 'bloodplume', catfolk: 'sandcastle', yulin: 'canglue',
  hualong: 'longan', linghu: 'qingqiu', centaur: 'jinzhang',
}

/** 開局的行囊：5 份乾糧，加上身分標籤帶的物品（同一樣合在一起，目錄沒有的略過） */
function startInventory(tags: string[]): { name: string; qty: number }[] {
  const inv = [{ name: '乾糧', qty: 5 }]
  for (const x of pcTagStartItems(tags)) {
    if (!itemDef(x.name)) continue
    const have = inv.find((i) => i.name === x.name)
    if (have) have.qty += x.qty
    else inv.push({ name: x.name, qty: x.qty })
  }
  return inv
}

export function newGame(opts: NewGameOptions): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31)
  const birthplace = opts.birthplace ?? START_LOCATION
  const loc = locationById(birthplace)
  if (loc.type === 'dungeon') throw new Error('出生地必須是聚落')
  const pc = createPlayer(opts.name, opts.race, opts.classId, opts.bonus)
  pc.birthplace = birthplace
  if (loc.faction) pc.faction = loc.faction
  const clip = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined
  const gender = clip(opts.gender, 20)
  const body = opts.body && BODIES.includes(opts.body) ? opts.body : undefined
  const look = body || opts.look ? sanitizeLook(opts.look, body ?? bodyOf(opts.race, genderId(opts.gender)), opts.race, opts.gender) : {}
  const appearance = clip(lookAppearance(look, clip(opts.appearance, 400)), 600)
  const background = clip(opts.background, 800)
  // 建角時挑的裝備：不合法時（例如預算不夠）丟錯，畫面上會先擋下來
  // 存檔規則「額外飾品欄的格數」：開新遊戲一律用預設的格數（建角畫面也是），進遊戲後再到設定調整
  setExtraSlotCount(gameRule(null, 'extraSlots'))
  if (opts.gear) {
    pc.gear = creationGear(opts.classId, opts.gear, Math.max(0, opts.gearBudget ?? gearRules.creation.default_budget), opts.race, !!opts.options?.classWeapons)
    syncGear(pc, classDef(opts.classId).weapon)
  }
  if (gender) pc.gender = gender
  const tags = sanitizePcTags(opts.tags)
  if (tags.length) pc.tags = tags
  // 工藝從 0 級開始，工匠身分那一門 Lv.2（docs/CRAFTING.md 1.1 節）
  pc.crafts = startCrafts(tags)
  if (appearance) pc.appearance = appearance
  if (body) pc.body = body
  // 依性別（體型）預設穿上內衣、內褲；建角時自己挑了的欄位不動
  wearDefaultUnderwear(pc, characterBody(pc))
  syncGear(pc, classDef(opts.classId).weapon)
  if (background) pc.background = background
  // 特質：清單裡的照選，自訂的整理過才收
  // 缺陷最多兩個、每個換一個一般特質的名額（perks.json 的 creation），多的從後面拿掉
  // 種族限定的特質（requires.races，例如化龍族的「蛇相」）別的種族帶不進來
  const listed = [...new Set(opts.perks ?? [])].filter(isChoosablePerk).map((id) => perkDef(id)!).filter((p) => !p.requires?.races?.length || p.requires.races.includes(opts.race))
  const created = (opts.customPerks ?? []).map((raw, i) => sanitizePerk(raw, `c-start-${i + 1}`, undefined, true)).filter((p): p is PerkDef => !!p)
  const fitted = fitCreationPerks([...listed, ...created])
  const picked = listed.filter((p) => fitted.includes(p)).map((p) => p.id)
  if (picked.length) pc.perks = picked
  const custom = created.filter((p) => fitted.includes(p))
  if (custom.length) pc.customPerks = custom
  // 換成新存檔：沒有自創的物品
  setSaveItems([])
  return {
    version: 1,
    seed,
    rngState: seed,
    time: { day: 1, hour: 8, minute: 0 },
    location: birthplace,
    money_cc: START_MONEY_CC,
    party: [pc],
    // 開局的乾糧，加上身分帶的東西（獵人的風乾肉、工匠的工具組……，npc_tags.json 的 start_items）
    inventory: startInventory(tags),
    quests: [],
    recruited: [],
    reputation: {},
    flags: {},
    reports: [],
    nextReportNo: 1,
    relationships: {},
    memories: [],
    memoryRules: MEMORY_RULES_VERSION,
    schema: SAVE_SCHEMA,
    guild: { rank: 'F', merit: 0 },
    homes: {},
    // 額外飾品欄的格數不在開新遊戲時決定（一律預設）
    options: (({ extraSlots: _x, ...rest }) => ({ ...defaultOptions(), ...rest }))(opts.options ?? {}) as GameOptions,
    // 新遊戲的 NPC 一開始就照新的職業生成：不用問「炎華之地要不要改一批職業」（classRebalance.ts）
    classRebalance: { done: 'skipped' },
    // 主角的性經歷：建角時選的（sexRecord.ts）
    sexRecords: { pc: pcExperience(!!opts.experience?.experienced, opts.experience?.note) },
  }
}

/** 讀入舊版存檔時補上新欄位。 */
/**
 * 舊的飾品欄位：首飾放戒指、兩條項鍊放項鍊與護符。改成首飾放項鍊、兩枚戒指：
 * 原本的首飾（戒指）移到第一枚戒指，第一條項鍊移到首飾，第二條項鍊放回行囊（沒有行囊的 NPC 直接拿掉）。
 */
function migrateJewelry(gear: Record<string, EquippedGear | undefined> | undefined, pack?: GameState['inventory']) {
  if (!gear || (!('neck_1' in gear) && !('neck_2' in gear))) return
  const ring = gear.accessory
  const neck1 = gear.neck_1
  const neck2 = gear.neck_2
  delete gear.accessory
  delete gear.neck_1
  delete gear.neck_2
  if (ring) gear.ring_1 = ring
  if (neck1) gear.accessory = neck1
  if (neck2 && pack) {
    const it = pack.find((i) => i.name === neck2.name)
    if (it) it.qty++
    else pack.push({ name: neck2.name, qty: 1 })
  }
}

/**
 * 存檔格式的版本。改了存檔的結構時：版本加一，並在 SCHEMA_STEPS 加一個轉換步驟（舊存檔讀入時依序執行）。
 * 1：這個機制之前的所有存檔（由 migrate 前半的各項檢查補齊）
 * 2：公會階級與功績（guild）、存檔規則（options）
 * 3：房屋（homes；留守的夥伴記在 NPC 登錄的 staying）
 * 4：主人的家改成固定設施（民宅）：從 homes 拿掉 m- 開頭的那棟，改記在 masterHome（主人、城市、家裡的人）
 * 5：名單的潤飾記在每個人身上（flavored）
 * 6：刺青：奴隸契約搬進刺青清單（tattoos 的奴隸印記），條款一律存一份、加上部位
 * 7：金屬腰帶的底材改名（鐵腰帶 → 護腰，免得變成「鐵鐵腰帶」）：行囊、裝備、商店裡的舊名稱跟著改
 * 8：金屬靴子的底材改名（鐵靴 → 戰靴，免得變成「鐵鐵靴」）：同上
 * 9：7、8 只換掉剛好等於制式名稱的字串；這一步連帶稀有度前綴、編號的自訂裝備（優良鐵鐵靴、精製秘銀鐵腰帶（2）……）一起改，自訂物品的鍵也跟著改
 * 10：特殊任務的獨特裝備改名（不再用「某某人的材質類型」）：行囊、裝備、商店裡的舊名稱跟著改
 * 11：緋夢樂園的「魅魔女王」改叫「緋夢夫人」（免得和魔王莉莎爾搞混）：用她命名的物品跟著改
 * 12：自訂裝備的鍵改成「名字＋看不見的屬性雜湊」（itemKey.ts）：撞名時加的編號（優良亞麻女僕頭飾（2））拿掉，
 *     行囊、裝備、商店……裡的舊名字跟著改；屬性一樣的合成一疊
 * 13：自己鎖上的拘束具有了鑰匙（EquippedGear.keyHolder，docs/LEWD_STATS.md 第 7 節）：已經自己鎖上的（有鎖、不是別人鎖上的）
 *     鑰匙算在自己身上（self）；正在淫鬥場打的那件（打完就拿掉）不算
 * 14：魔導束縛契約不再封印法術：存檔裡照模板刻的魔導束縛（kind arcane）拿掉法術環上限、魔力封印的功能與那一項副作用（自訂印記不動）
 */
export const SAVE_SCHEMA = 14

const SCHEMA_STEPS: [number, (state: GameState) => void][] = [
  [2, (s) => {
    // 以前的階級由等級換算：沿用換算出來的階級，功績從 0 開始
    s.guild ??= { rank: guildRankFor(player(s).level), merit: 0 }
    s.options ??= defaultOptions()
    // 正在地下城裡：從現在開始記這趟探索
    if (locationById(s.location).type === 'dungeon' && !s.road) s.expedition ??= { location: s.location, started: { ...s.time }, deepest: 0, loot: [], money_cc: 0 }
  }],
  [3, (s) => {
    s.homes ??= {}
  }],
  [4, (s) => {
    // 主人的家以前疊在一塊空地上、地圖存在 homes：改成那座城的民宅，家裡的人照舊（站的位置在讀檔後的 syncMasterHome 對齊）
    for (const [id, home] of Object.entries(s.homes ?? {})) {
      if (!home.master && !id.startsWith('m-')) continue
      // 沿用舊房子的規格：主角、家裡的人站的位置都是照那個格局記的（例如首都的貴族宅邸有三樓）
      if (home.master && !s.masterHome) s.masterHome = { master: home.master, location: home.location, household: home.household ?? [], ...(home.district ? { district: home.district } : {}) }
      delete s.homes![id]
    }
  }],
  [5, (s) => {
    // 名單的潤飾改成記在每個人身上：整份潤飾過的名單，上面的人都算潤飾過
    for (const roster of Object.values(s.rosters ?? {})) {
      if (!roster.flavored) continue
      for (const id of roster.members) {
        const rec = s.npcs?.[id]
        if (rec?.generated) rec.flavored = true
      }
      delete roster.flavored
    }
  }],
  [6, (s) => {
    for (const c of [...s.party, ...Object.values(s.npcs ?? {}).map((r) => r.character)]) migrateContract(c)
  }],
  [7, (s) => {
    renameValues(s, { 鐵鐵腰帶: '鐵護腰', 鋼鐵腰帶: '鋼護腰', 秘銀鐵腰帶: '秘銀護腰', 精金鐵腰帶: '精金護腰', 星隕鐵鐵腰帶: '星隕鐵護腰' })
  }],
  [8, (s) => {
    renameValues(s, { 鐵鐵靴: '鐵戰靴', 鋼鐵靴: '鋼戰靴', 秘銀鐵靴: '秘銀戰靴', 精金鐵靴: '精金戰靴', 星隕鐵鐵靴: '星隕鐵戰靴' })
  }],
  [9, (s) => {
    const fix = (v: string) => v.replace(/(星隕鐵|秘銀|精金|鐵|鋼)鐵(靴|腰帶)/g, (_, m: string, b: string) => `${m}${b === '靴' ? '戰靴' : '護腰'}`)
    rewriteStrings(s, fix)
  }],
  [10, (s) => {
    renameValues(s, UNIQUE_GEAR_RENAMES)
  }],
  [11, (s) => {
    renameValues(s, PARK_HOSTESS_RENAMES)
  }],
  [12, (s) => {
    const renames = gearKeyRenames(s.customItems)
    if (!Object.keys(renames).length) return
    rewriteStrings(s, (v) => renames[v] ?? v)
    s.inventory = mergeStacks(s.inventory)
    if (s.expedition) s.expedition.loot = mergeStacks(s.expedition.loot)
  }],
  [13, (s) => {
    const arena = s.combat?.arena?.restraint
    const chars = [...s.party, ...Object.values(s.npcs ?? {}).map((r) => r.character)]
    for (const c of chars) {
      for (const [slot, g] of Object.entries(c?.gear ?? {})) {
        if (!g?.lock || g.locked || g.keyHolder) continue
        if (arena && c?.isPlayer && arena.slot === slot && arena.name === g.name) continue
        g.keyHolder = 'self'
      }
    }
  }],
  [14, (s) => {
    unsealArcane(s)
  }],
]

/**
 * 存檔格式 14：魔導束縛契約不再封印法術。契約的條款是刻印時複製進存檔的（隊伍、NPC、留在房子裡的奴隸身上都有），
 * 照模板刻的（kind arcane）拿掉法術環上限、魔力封印的功能，副作用裡的那一項換成現在模板的寫法
 */
function unsealArcane(node: unknown) {
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const terms = obj.terms as Partial<MarkTerms> | undefined
  if (obj.kind === 'arcane' && terms && typeof terms === 'object' && 'spell_cap' in terms) {
    delete terms.spell_cap
    if (Array.isArray(terms.functions)) terms.functions = terms.functions.filter((f) => f !== 'spell_seal')
    if (Array.isArray(terms.side_effects)) {
      const now = contractDef('arcane').side_effects[0]
      terms.side_effects = terms.side_effects.map((x) => (x.startsWith('法陣抽取魔力') && now ? now : x))
    }
  }
  for (const v of Object.values(obj)) unsealArcane(v)
}

/**
 * 存檔格式 12：自訂裝備的舊名字 → 新的鍵（名字＋屬性雜湊）。撞名時加的編號（「（2）」）拿掉；
 * 屬性一樣的舊名字對到同一個鍵
 */
function gearKeyRenames(items: GameState['customItems']): Record<string, string> {
  const out: Record<string, string> = {}
  const specs = new Map<string, unknown>()
  for (const [name, item] of Object.entries(items ?? {})) {
    if (!item.gear || hasItemKey(name)) continue
    const label = name.replace(/（\d+）$/, '')
    let key = itemKey(label, item.gear)
    for (let salt = 1; specs.has(key) && !sameShape(specs.get(key), item.gear); salt++) key = itemKey(label, item.gear, salt)
    specs.set(key, item.gear)
    out[name] = key
  }
  return out
}

/** 同名（同品質）的物品合成一疊 */
function mergeStacks(list: InventoryItem[]): InventoryItem[] {
  const out: InventoryItem[] = []
  for (const i of list) {
    const same = out.find((x) => x.name === i.name && (x.quality ?? '') === (i.quality ?? ''))
    if (same) same.qty += i.qty
    else out.push(i)
  }
  return out
}

/** 存檔格式 11：用緋夢樂園的主人命名的物品（舊名「魅魔女王」） */
const PARK_HOSTESS_RENAMES: Record<string, string> = Object.fromEntries(
  ['吊帶襪', '黑薔薇', '舊項圈', '晚禮服'].map((n) => [`魅魔女王的${n}`, `緋夢夫人的${n}`]),
)

/** 存檔格式 10：特殊任務獨特裝備的舊名稱 → 新名稱 */
const UNIQUE_GEAR_RENAMES: Record<string, string> = {
  南郊守夜人的長劍: '守夜餘燼', 最弱四天王的巨斧: '千敗', 晨霧修道院的鐘鎚: '遠鐘', 托倫的紫杉長弓: '根界歸途', 扒手凱的折刀: '順手牽羊',
  舞孃的纏腕絲帶: '金幣之舞', 席恩的指揮細劍: '顫音', 灰燼修會的骨鎚矛: '亡者靜聽', 莫格婆婆的採藥杖: '沼地先知', 莫菲的夢遊法杖: '夢遊者',
  白棋信使的胸甲: '白城堡', 赤鬃狩獵皮甲: '赤鬃疾風', 伊莎貝拉的舊鍊甲: '賭債', 夜爪獵手的皮甲: '無聲峽谷', 走私客的夜行皮甲: '海鷗不看',
  月華巡禮的修行袍: '新月靜心', 春潮閣的宴會皮甲: '櫻色宴席', 聖環護衛的鍊甲: '官道遺誓', 守泉祭司的苔紋皮甲: '泉苔', 觀星者的星圖長袍: '多餘之星',
  杜拉克的軍戒: '山之心跳', 血誓侍從的臍釘: '不倦戰紋', 流水之靈的誓約護符: '石橋一滴', 海盜王的瞭望耳環: '桅頂之眼', 密探的迅捷之戒: '鴿籠密碼',
  風錘村的風紋腳鍊: '山風銀屑', 代筆人的靜心耳墜: '他人之言', 驅散低語的護符: '噤聲', 蛇溪的解毒項鍊: '紅溪蛇鱗', 記得名字的項鍊: '不忘',
  心火之劍: '呼吸之焰', 沉默之斧: '戈爾的沉默', 聖者埃利昂的鎚: '指甲刻名', 月影根穴的古樹長弓: '根穴月光', 白棋密探的秘銀匕首: '無刃',
  競技場的月影絲纏腕: '先於目光', 史詩終章的秘銀細劍: '史詩最後一句', 白焰鎚矛: '遺火白焰', 新芽古樹杖: '不止的新芽', 魔焰織法者的法杖: '馴焰',
  四將軍的秘銀板甲: '四色軍議', 血獸皮甲: '新月血夜', 年輕騎士的秘銀鍊甲: '還命之恩', 沙獅皮甲: '草原沙影', 黑帆的夜行皮甲: '無月之海',
  女神倒影的修行袍: '女神倒影', 夏瀾殿的鯨皮外套: '鯨歌浪鈴', 大公會議的護教鍊甲: '兩百年之護', 根語者的獸皮甲: '樹說你需要', 星落之夜的月影長袍: '星落之夜',
  白棋的金印戒: '羅莎琳德之印', 求婚者的金臍釘: '勇士之奪', 誓約守望者的護符: '兩百年誓約', 紅鬚的鷹眼耳環: '紅鬚的夾層', 假幣師的迅捷之戒: '比真的還真',
  太陽神諭的腳鍊: '沙上之舞', 海妖的金耳墜: '洞中歌聲', 古王的驅暗項鍊: '敗王的饋贈', 綠化計畫的項鍊: '未萌之種', 封印隊的明心項鍊: '唯一歸來者',
  無火精金長劍: '無紋', 無火精金戰鎚: '穩定器', 無火精金巨斧: '第四十三稿', 無火精金細劍: '無火之針', 無火精金鎚矛: '七棱星',
  無火精金護臂: '拳之設計', 重鑄的黎明・長弓: '晨弦', 重鑄的黎明・法杖: '一點晨光', 重鑄的黎明・長棍: '草生黎明', 重鑄的黎明・匕首: '黎明之尖',
  重鑄的黎明・長劍: '黎明', 重鑄的黎明・細劍: '晨鐘', 千爐機甲・板甲: '半重', 千爐機甲・鍊甲: '千環無偏', 千爐機甲・皮甲: '彈簧之躍',
  千爐機甲・武僧袍: '發條一推', 千爐機甲・長袍: '袖中齒輪', 千爐機甲・樂師皮甲: '不修的故障', 巨人武庫的板甲: '巨人王之贈', 巨人武庫的鍊甲: '古符千環',
  巨人武庫的皮甲: '改小三圈', 巨人武庫的獵裝: '山路皮圖', 巨人武庫的武僧袍: '三千年無塵', 巨人武庫的苔紋皮甲: '活苔', 無名寶藏的精準之戒: '最上層',
  無名寶藏的鐵膚護符: '無名戰士', 無名寶藏的活力臍釘: '自熱', 無名寶藏的鷹眼耳環: '細繩之後', 無名寶藏的靜心耳墜: '流沙慢歌', 老船長的迅捷之戒: '船長室的抽屜',
  老船長的守護護符: '不鏽船首', 老船長的明心項鍊: '星位紙條', 老船長的風紋腳鍊: '桅上奔跑', 老船長的抗毒項鍊: '永綠海草', 星心長劍: '同步心跳',
  星心巨斧: '劈開大物', 星心細劍: '追不上的風', 星心戰鎚: '星之禱', 星心長弓: '先見之箭', 星心纏腕: '拳中星光',
  星心指揮細劍: '星星的音高', 星心鎚矛: '守門人名錄', 星心長棍: '草之朝向', 星心法杖: '與星對眨', 聖環的白金板甲: '白金七芒',
  教廷遊騎兵的古龍皮甲: '兩百年追獵', 樞機的星輝長袍: '燭光金線', 聖戰騎士的星隕鍊甲: '環環禱詞', 懺悔者的古龍皮甲: '劃掉的印記', 教廷夜巡者的古龍皮甲: '不在這裡',
  苦修院的星輝武僧袍: '三百年擋拳', 聖詠隊的古龍皮甲: '五線譜', 聖林守衛的古龍皮甲: '不枯橡葉', 教廷書庫的星輝長袍: '未還的借書單', 赤翼近衛的星隕鍊甲: '血誓之環',
  赤翼斥候的古龍皮甲: '夜色深紅', 赤翼拳衛的星輝武僧袍: '展翼', 赤翼聖印的星隕板甲: '翼下聖印', 血吼戰團的古龍皮甲: '爪痕勳章', 赤翼獵手的古龍皮甲: '赤羽引路',
  赤翼宮廷樂師的古龍皮甲: '宴會與戰場', 赤翼血祭司的星隕鍊甲: '暗紅祈禱', 荒原巫者的古龍皮甲: '最後的草籽', 赤翼宮廷法師的星輝長袍: '血羽結界', 滿月之戒: '月光之言',
  潮鏡耳墜: '最好的一刻', 聖鐘碎片的墜飾: '未響之鐘', 燒毀詔書的封蠟戒: '沒有打起的戰爭', 和平的鷹眼耳環: '各出一半', 血誓碑的碎片: '裂開的血誓',
  帝國的勝利之戒: '金鷹凱旋', 赤羽臍環: '配得上的人', 萊茵堡的城門鑰匙墜: '不破之門', 赤翼的凱旋之戒: '赤翼凱旋', 帝國金鷹耳環: '易主的金鷹',
  歷史的指環: '萬代之憶', 回響耳墜: '英雄的致意', 熾寂之斧: '熾寂', 兩極之劍: '兩極', 真名之刃: '真名',
  迷言細劍: '迷言', 千年夢杖: '千年之夢', 夢林之杖: '倒懸之林', 尖頂之鎚: '最後一塊磚', 登頂者的纏腕: '登頂者',
  史冊之鎚: '闔上的史冊', 回響長弓: '千年回響',
}

/** 存檔裡所有字串（值與物件的鍵）都套用 fix：自訂物品以名稱當鍵，鍵和值要一起改 */
function rewriteStrings(node: unknown, fix: (v: string) => string) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === 'string') node[i] = fix(v)
      else rewriteStrings(v, fix)
    })
    return
  }
  const obj = node as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    const key = fix(k)
    const value = typeof v === 'string' ? fix(v) : v
    if (typeof v !== 'string') rewriteStrings(v, fix)
    if (key !== k) delete obj[k]
    obj[key] = value
  }
}

/** 把存檔裡剛好等於舊名稱的字串換成新名稱（物品名稱散在行囊、裝備、商店與戰利品裡） */
function renameValues(node: unknown, names: Record<string, string>) {
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && names[v]) obj[k] = names[v]
    else renameValues(v, names)
  }
}

/**
 * 改過名字的物品（舊存檔裡的名字 → 現在的名字）：行囊、隊伍與 NPC 身上的裝備、當天的商店與拍賣會一起換。
 * 乳牛比基尼拆成上衣與下著（worldgen/scripts/elondia/park_outfits49.py）：原本的那件就是上衣。
 */
const ITEM_RENAMES: Record<string, string> = {
  亞麻乳牛比基尼: '亞麻乳牛比基尼上衣',
  絲綢乳牛比基尼: '絲綢乳牛比基尼上衣',
  月影絲乳牛比基尼: '月影絲乳牛比基尼上衣',
}
const RENAMED = new Set(Object.values(ITEM_RENAMES))
function renameOldItems(state: GameState) {
  const to = (n: string) => ITEM_RENAMES[n] ?? n
  const merged = new Map<string, GameState['inventory'][number]>()
  const pack: GameState['inventory'] = []
  for (const i of state.inventory) {
    const name = to(i.name)
    // 改名之後和原本就有的同名（同品質）物品合在一起
    const key = `${name}|${i.quality ?? ''}`
    const same = merged.get(key)
    if (same && RENAMED.has(name)) {
      same.qty += i.qty
      continue
    }
    const item = name === i.name ? i : { ...i, name }
    merged.set(key, item)
    pack.push(item)
  }
  state.inventory = pack
  const gearOf = (c?: Character) => { for (const g of Object.values(c?.gear ?? {})) if (g) g.name = to(g.name) }
  for (const m of state.party) gearOf(m)
  for (const r of Object.values(state.npcs ?? {})) gearOf(r.character)
  // 當天已經上架的商品（item:名稱）與拍賣會的拍品：0.6.2 的存檔可能還是舊名字
  rewriteStrings(state.shops, (v) => (v.startsWith('item:') ? `item:${to(v.slice(5))}` : to(v)))
  rewriteStrings(state.auction, to)
}

/** 舊的契約（角色身上的 contract）改成刺青清單裡的奴隸印記 */
function migrateContract(c: Character | undefined) {
  const old = (c as (Character & { contract?: ContractRef & { terms?: MarkTerms } }) | undefined)?.contract
  if (!c || !old) return
  delete (c as { contract?: unknown }).contract
  const base = termsFromTemplate(old.kind)
  const terms: MarkTerms = old.terms ? { ...base, ...old.terms, place: old.terms.place ?? base.place } : base
  setContract(c, { ...old, terms })
}

export function defaultOptions(): GameOptions {
  return { defeatLoot: 'half' }
}

/** 存檔來自比較新的遊戲版本時丟出錯誤（不要硬讀，避免把存檔弄壞） */
export function assertSchema(state: Pick<GameState, 'schema'>) {
  const v = state.schema ?? 1
  if (v > SAVE_SCHEMA) throw new Error(`這個存檔來自比較新版本的遊戲（存檔格式 ${v}，目前支援到 ${SAVE_SCHEMA}），請更新遊戲後再讀取`)
}

/**
 * 存檔用到目前的世界沒有的職業時丟出錯誤，不讀取（職業被世界管理刪掉、或換了世界）。
 * 不換成別的職業：角色的能力、裝備、屬性都跟著職業走，硬換會把存檔弄壞。
 */
export function assertClasses(state: Pick<GameState, 'party' | 'npcs'>) {
  const missing = new Set<string>()
  for (const m of state.party ?? []) if (!classes[m.class]) missing.add(m.class)
  for (const r of Object.values(state.npcs ?? {})) {
    if (r.class && !classes[r.class]) missing.add(r.class)
    if (r.character && !classes[r.character.class]) missing.add(r.character.class)
  }
  if (missing.size) throw new Error(`這個存檔用到目前的世界沒有的職業（${[...missing].join('、')}），不能讀取。如果還有這個世界的匯出檔，匯入就能把職業加回來；或改用存檔原本的世界`)
}

export function migrate(state: GameState): GameState {
  assertSchema(state)
  assertClasses(state)
  // 成人向任務的開頭 NPC 以前可能擲成有經驗、或在私生活裡失去第一次：改回處子（只做一次；sexRecord.ts）
  rescueStoryVirgins(state)
  // 「本地」聲望以前會直接存成 local（以前記在 KNOWN_ISSUES 的 W5）：沒有人讀，拿掉
  if (state.reputation) delete state.reputation.local
  // 以前 AI 會替商店取名字（shopNames）：店名改成只用手寫與規則生成，拿掉
  delete (state as { shopNames?: unknown }).shopNames
  // 「飾品」類別已經拿掉（併入裝備）：AI 自創的飾品改成雜物
  for (const c of Object.values(state.customItems ?? {})) if (c.category === 'valuable') c.category = 'gear'
  for (const m of state.party) migrateJewelry(m.gear as Record<string, EquippedGear | undefined>, state.inventory)
  renameOldItems(state)
  for (const r of Object.values(state.npcs ?? {})) {
    migrateJewelry(r.character?.gear as Record<string, EquippedGear | undefined> | undefined)
    // 以前職業比性別先決定，可能出現男性的「女王的姪女」：依性別換成對應的稱呼
    if (r.generated && r.occupation) r.occupation = occupationFor(r.occupation, r.gender)
  }
  for (const q of state.quests) {
    q.kind ??= 'clear_dungeon'
    q.area ??= 'dungeon'
  }
  // v1 的角色沒有五屬性與能力清單：依職業與種族重建，已升的等級換成屬性點
  for (const c of state.party as (typeof state.party[number] & { skills?: string[]; mp?: number; maxMp?: number; pendingSkillChoices?: unknown })[]) {
    if (c.attrs) continue
    const cls = classDef(c.class)
    c.attrs = baseAttrs(c.class, c.race)
    c.attrPoints = (c.level - 1) * attributeRules.level_up_points
    c.abilities = [...new Set([...cls.start, ...(c.skills ?? []).filter((id) => abilities[id]?.classes.includes(c.class))])]
    c.weapon = cls.weapon
    c.armor = cls.armor
    c.slotsUsed = []
    c.usesPerRest = {}
    delete c.skills
    delete c.mp
    delete c.maxMp
    delete c.pendingSkillChoices
    c.maxHp = 0
    recalc(c)
    c.hp = c.maxHp
  }
  // v2 之前沒有人際關係與共同記憶：由隊友與過去的報告補建
  if (!state.relationships) {
    state.relationships = {}
    for (const m of state.party) {
      if (m.isPlayer) continue
      ensureRelationship(state, { id: m.id, name: m.name })
      setAffinity(state, m.id, m.affinity ?? 0)
    }
  }
  if (!state.memories) {
    state.memories = []
    for (const r of state.reports) recordMemory(state, r)
    state.memoryRules = MEMORY_RULES_VERSION
  }
  backfillEventMemories(state)
  // v3 之前沒有夥伴系統：原本的隊友都是雇傭的
  for (const m of state.party) {
    m.hitDiceUsed ??= 0
    if (!m.isPlayer) m.bond ??= 'hired'
    // 主角的身分標籤（v0.3.1 起）：舊存檔沒有；拿掉不認得、不能選或互斥的
    if (m.isPlayer && m.tags) {
      const tags = sanitizePcTags(m.tags)
      if (tags.length) m.tags = tags
      else delete m.tags
    }
  }
  state.npcs ??= {}
  state.suggestions ??= []
  pruneStatuses(state)
  pruneAbilities(state)
  prunePerks(state)
  // 打工線的獨特色情技能（v0.4 起，慾望戰鬥 S6）：已經完成的任務線補發
  backfillLewdSkills(state)
  // 依存檔格式的版本依序轉換
  for (const [v, step] of SCHEMA_STEPS) {
    if ((state.schema ?? 1) >= v) continue
    step(state)
    state.schema = v
  }
  // 這個存檔自創的物品
  setSaveItems(Object.values(state.inventions ?? {}))
  // 這個世界沒有的特殊地圖
  pruneSpecialMaps(state)
  // 這個世界沒有的寄生物（刪掉的自建寄生物）：拿掉、解開鎖住的裝備
  pruneParasites(state.party)
  // 身上的淫紋照這個世界的寄生物更新名稱與外觀（世界編輯器改過之後）
  refreshParasiteMarks(state.party)
  // 這個世界沒有的自建地下城：人在裡面時送回聚落（格子位置清掉，load 會重新進入地點）
  pruneLocations(state)
  // 屬性都加滿了還剩的屬性點（舊版可以一直苦練屬性）：用經驗換來的退回經驗，其餘收回，免得「待處理」消不掉
  for (const c of state.party) refundSpareAttrPoints(c, state)
  return state
}

/**
 * 自訂內容刪掉的狀態（讀檔時，以及自訂內容改變之後）：戰鬥狀態從進行中的戰鬥拿掉；
 * 自建的非戰鬥狀態（mod_cond_ 開頭）從角色身上拿掉。
 */
export function pruneStatuses(state: GameState) {
  for (const x of state.combat?.combatants ?? []) if (x.statuses.some((s) => !statuses[s.id])) x.statuses = x.statuses.filter((s) => !!statuses[s.id])
  // 自建的非戰鬥狀態、自建成套家具的狀態（set_mod_set_，房屋設定拿掉套組時）
  const gone = (id: string) => (id.startsWith('mod_cond_') || id.startsWith('set_mod_set_')) && !companionRules.conditions[id]
  for (const c of [...state.party, ...Object.values(state.npcs ?? {}).map((r) => r.character).filter((x): x is Character => !!x)]) {
    if (c.status?.some(gone)) c.status = c.status.filter((id) => !gone(id))
  }
}

/** 自訂內容刪掉的能力：從角色身上拿掉（讀檔時，以及自訂內容改變之後） */
export function pruneAbilities(state: GameState) {
  const known = (id: string) => !!abilities[id]
  for (const c of [...state.party, ...Object.values(state.npcs ?? {}).map((r) => r.character).filter((x): x is Character => !!x)]) {
    if (c.abilities?.some((id) => !known(id))) c.abilities = c.abilities.filter(known)
    // 升級時還沒選的能力：拿掉不存在的選項，整組都沒了就不用選
    if (c.pendingAbilityChoices?.length) {
      c.pendingAbilityChoices = c.pendingAbilityChoices.map((set) => set.filter(known)).filter((set) => set.length)
      if (!c.pendingAbilityChoices.length) delete c.pendingAbilityChoices
    }
  }
  // 進行中的戰鬥
  for (const x of state.combat?.combatants ?? []) if (x.abilities.some((id) => !known(id))) x.abilities = x.abilities.filter(known)
}

/**
 * 自訂內容刪掉的特質：從角色身上、學特質的機會與登場過的人身上拿掉（讀檔時，以及自訂內容改變之後）。
 * 種族特質依種族計算、自訂特質寫在角色身上，都不受影響。
 */
export function prunePerks(state: GameState) {
  for (const c of [...state.party, ...Object.values(state.npcs ?? {}).map((r) => r.character).filter((x): x is Character => !!x)]) {
    if (c.perks?.some((id) => !isChoosablePerk(id))) c.perks = c.perks.filter(isChoosablePerk)
    if (c.perkOffers?.length) {
      // 機會裡不存在的選項拿掉；沒有選項又不能寫說法的機會整個拿掉
      c.perkOffers = c.perkOffers.map((o) => ({ ...o, options: o.options.filter(isChoosablePerk) })).filter((o) => o.options.length || o.pitch)
      if (!c.perkOffers.length) delete c.perkOffers
    }
  }
  for (const r of Object.values(state.npcs ?? {})) if (r.perks?.some((id) => !isChoosablePerk(id))) r.perks = r.perks.filter(isChoosablePerk)
}

/** 主角賺到 amount 時，依奴隸契約的「收益歸屬」被主人拿走多少（逃亡中、沒有主人、契約沒有這項功能時是 0） */
export function masterTake(state: GameState, amount: number): number {
  const pc = state.party.find((m) => m.isPlayer)
  const contract = contractOf(pc)
  if (!pc || !contract?.master || pc.status.includes('fugitive') || amount <= 0) return 0
  const def = contractTerms(contract)
  return def.functions.includes('income') ? Math.floor(amount * def.income_share) : 0
}

export function player(state: GameState) {
  const pc = state.party.find((c) => c.isPlayer)
  if (!pc) throw new Error('no player character')
  return pc
}

/** 用狀態裡的亂數種子執行一段邏輯，結束後寫回種子。 */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rngState)
  try {
    return fn(rng)
  } finally {
    state.rngState = rng.state
  }
}

/** 推進遊戲時間（走格子、旅途、開寶箱這類不產生報告的動作）：跨日時結算每天的變化 */
export function advanceTime(state: GameState, hours: number) {
  const prevDay = state.time.day
  state.time = addHours(state.time, hours)
  lewdDaily(state, prevDay, state.time.day)
  staffDaily(state, prevDay, state.time.day)
  familyTick(state)
}

export function addHours(time: GameTime, hours: number): Required<GameTime> {
  const totalMinutes =
    ((time.day - 1) * 24 + (time.hour ?? 0)) * 60 + (time.minute ?? 0) + Math.round(hours * 60)
  return {
    day: Math.floor(totalMinutes / 1440) + 1,
    hour: Math.floor((totalMinutes % 1440) / 60),
    minute: totalMinutes % 60,
  }
}

export function formatTime(time: GameTime): string {
  const hh = String(time.hour ?? 0).padStart(2, '0')
  const mm = String(time.minute ?? 0).padStart(2, '0')
  return `第 ${time.day} 天 ${hh}:${mm}`
}

export function newReportId(state: GameState): string {
  return `r-${String(state.nextReportNo++).padStart(6, '0')}`
}

export function addItem(inv: InventoryItem[], name: string, qty: number, quality?: string) {
  const item = inv.find((i) => i.name === name)
  if (item) item.qty += qty
  else inv.push(quality ? { name, qty, quality } : { name, qty })
}

/** 扣除物品，回傳實際扣掉的數量。 */
export function removeItem(inv: InventoryItem[], name: string, qty: number): number {
  const i = inv.findIndex((it) => it.name === name)
  if (i < 0) return 0
  const item = inv[i]!
  const taken = Math.min(item.qty, qty)
  item.qty -= taken
  if (item.qty <= 0) inv.splice(i, 1)
  return taken
}

/**
 * 把報告的結果套用到遊戲狀態，並把報告加進事件紀錄。
 * 經驗值造成的升級在這裡結算，結果會補寫進 report.changes.level_up。
 * 隊伍的 HP 以報告 party 快照的「事件後」數值為準。
 */
export function commitReport(state: GameState, report: Report): Report {
  const c = report.changes
  // 存檔規則「職業武器限制」：入隊、歸隊時收進行囊的武器寫在摘要後面
  if (report.stowed?.length) {
    const s = report.outcome.summary?.trim()
    report.outcome.summary = `${s ? `${s} ` : ''}${report.stowed.join('；')}。`
  }
  // 在特殊地圖裡：場景帶上地圖的描述（給 AI）
  const special = specialMapOfKey(state.position?.area)
  if (special && report.kind !== 'travel' && !(report.location.scene ?? '').includes(special.desc.slice(0, 20))) {
    const scene = report.location.scene && !report.location.scene.includes(special.name) ? `${report.location.scene}・` : ''
    report.location.scene = `${scene}${special.name}（${special.desc.slice(0, 120)}）`
  } else {
    // 自建的地下城：場景帶上給 AI 的描述（內建地點的設定在世界書）
    const loc = findLocation(report.location.at)
    if (loc?.desc && report.kind !== 'travel' && !(report.location.scene ?? '').includes(loc.desc.slice(0, 20))) {
      const scene = report.location.scene ? `${report.location.scene}・` : ''
      report.location.scene = `${scene}${loc.name}（${loc.desc.slice(0, 120)}）`
    }
  }
  const prevDay = state.time.day
  state.time = { day: report.time.end.day, hour: report.time.end.hour ?? 0, minute: report.time.end.minute ?? 0 }
  // 慾望指標：跨過的每一天（曝露名聲、服裝……）與親密場景
  lewdDaily(state, prevDay, state.time.day)
  staffDaily(state, prevDay, state.time.day)
  noteAdultScene(state, report)
  if (report.kind === 'travel' && report.outcome.result === 'arrived' && report.location.to) {
    locationById(report.location.to)
    state.location = report.location.to
  }
  for (const snap of report.party) {
    const member = state.party.find((m) => m.id === snap.id)
    if (!member) continue
    if (snap.hp) member.hp = Math.max(0, Math.min(member.maxHp, snap.hp[1]))
  }
  // 奴隸契約「收益歸屬」：主角賺到的錢有一部分歸主人（成為奴隸的那份報告除外）
  if ((c.money_cc ?? 0) > 0 && !c.companions?.some((x) => x.npc === 'pc' && x.change === 'enslaved')) {
    const taken = masterTake(state, c.money_cc!)
    if (taken > 0) {
      c.money_cc! -= taken
      c.master_share_cc = taken
    }
  }
  if (c.money_cc) state.money_cc += c.money_cc
  // 金錢的明細只在兩筆以上、而且和合計對得上時留著（有的地方直接改 money_cc，就只寫合計）
  if (c.money_parts && !moneyPartsShown(c)) delete c.money_parts
  for (const item of c.items_gained ?? []) addItem(state.inventory, item.name, item.qty, item.quality)
  for (const item of c.items_lost ?? []) removeItem(state.inventory, item.name, item.qty)
  for (const a of c.affinity ?? []) setAffinity(state, a.npc, a.after)
  for (const r of c.reputation ?? []) state.reputation[r.faction] = (state.reputation[r.faction] ?? 0) + r.delta
  if (c.flags) Object.assign(state.flags, c.flags)
  // 地下城探索：這趟撿到的東西記下來（戰敗時依規則失去）
  noteLoot(state, report)
  if (c.merit) addMerit(state, c.merit)
  if (c.rank_up) applyRankUp(state, c.rank_up.to)
  // 主角的階級是公會給的（隊友依等級換算）
  const pcSnap = report.party.find((p) => p.id === player(state).id)
  if (pcSnap && state.guild) pcSnap.rank = state.guild.rank

  if (c.xp?.length) {
    withRng(state, (rng) => {
      for (const x of c.xp!) {
        const member = state.party.find((m) => m.id === x.actor)
        if (!member || !x.amount) continue
        // 存檔規則的經驗值倍率：報告裡記下實際得到的量
        if (x.amount > 0) x.amount = Math.max(1, Math.round(x.amount * gameRule(state, 'xpMult')))
        const from = member.level
        if (gainXp(member, x.amount, rng) > 0) {
          ;(c.level_up ??= []).push({ actor: member.id, from, to: member.level })
        }
      }
    })
  }

  state.reports.push(report)
  recordMemory(state, report)
  // 懷孕：察覺、陣痛、生產（docs/FAMILY.md）
  familyTick(state)
  return report
}
