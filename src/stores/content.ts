// 自訂內容：怪物、物品、裝備底材與材料的新增與修改（「🌍 世界」頁籤）。
// 世界（見 docs/CONTENT_EDITOR.md 第 0 節）：可以同時存有好幾套自訂內容，另有不能修改的「原版世界」。
// 開新遊戲時選一個世界，存檔記住它（state.world）；讀檔、繼續時自動切到那個世界，遊戲進行中不能切換。
// 存在 localStorage；每次修改後立刻（同步）重新套用到遊戲資料，表單才讀得到新的值。

import { sanitizeFamilyRules, type FamilyRulesMod } from '@/engine/familyMods'
import { sanitizeHomeRules, type HomeRulesMod } from '@/engine/homeMods'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { abilities, enemies, geography, itemDef, locationName, npcs as namedNpcs, specialMaps, stories } from '@/engine/data'
import { builtinStory, flagUsage, progressBreaks, sanitizeStory, storyCheck, type StoryMod } from '@/engine/storyMods'
import {
  abilityUsage, applyContent, cleanItemName, builtinAbility, builtinEnemy, builtinNpc, builtinPerk, dropBrokenStories, emptyMods, normalizeMods, sanitizePerkMod, type PerkMod, sanitizeAbility, sanitizeBase, sanitizeEnemy,
  sanitizeItem, sanitizeMaterial, sanitizeNpc, type AbilityMod, type BaseMod, type ContentMods, type EnemyMod, type ItemMod, type MaterialMod, type NpcMod,
  builtinStatus, sanitizeStatus, statusUsage, type StatusMod, builtinCondition, sanitizeCondition, conditionUsage, parasiteUsage, type ConditionMod, builtinTattoo, builtinNpcTag, builtinMark, builtinMarkRules,
} from '@/engine/mods'
import { builtinParasite, sanitizeParasiteMod, type ParasiteMod } from '@/engine/parasiteMods'
import { editableOf, npcTagUsage, sanitizeNpcTagMod, type NpcTagMod } from '@/engine/npcTagMods'
import { builtinClassMod, classUsage, sanitizeClassMod, type ClassMod } from '@/engine/classMods'
import { markUsage, sanitizeMarkMod, sanitizeMarkRules, sanitizeTattooMod, tattooUsage, type MarkMod, type MarkRulesMod, type TattooMod } from '@/engine/tattooMods'
import { itemRules, perkRules, shopRules, slaveryRules, type ItemCategory, type ShopType } from '@/engine/data'
import { sanitizeIcon, withoutIcons } from '@/engine/itemIcons'
import { npcModFromState } from '@/engine/promoteNpc'
import { builtinLandmark, landmarkSpotProblem, landmarkUsage, sanitizeLandmarkMod, type LandmarkMod } from '@/engine/landmarkMods'
import { builtinSpecialMap, sanitizeSpecialMapMod, specialMapUsage, type SpecialMapMod } from '@/engine/specialMapMods'
import { dungeonUsage, enemyInDungeons, sanitizeDungeonMod, withoutEnemy, type DungeonMod } from '@/engine/dungeonMods'
import { pruneSpecialMaps } from '@/engine/specialMaps'
import { pruneParasites, refreshParasiteMarks, takeParasiteNotice } from '@/engine/parasites'
import { pruneLocations, takeLocationNotice } from '@/engine/pruneLocations'
import { pruneRoadEvent } from '@/engine/road'
import { makeWorldPackage, parseWorldFile } from '@/engine/worldPackage'
import { usePrompts } from './prompts'
import { pruneTownEvent } from '@/engine/townEvents'
import { pruneDungeonEvent } from '@/engine/dungeonEvents'
import { pruneLeadEvent } from '@/engine/leadEvents'
import { pruneParasiteEvent } from '@/engine/parasiteEvents'
import { prunePregnancyEvent } from '@/engine/pregnancyEvents'
import { builtinCounter, counterUsage, sanitizeCounter, type CounterMod } from '@/engine/counterMods'
import { cleanCounterId } from '@/engine/mods'
import { sanitizeBindRules, type BindRulesMod } from '@/engine/bindRulesMods'
import { builtinTravelEvent, sanitizeEventRules, sanitizeTravelEvent, type EventRulesMod, type TravelEventMod } from '@/engine/travelEventMods'
import { builtinMasterEvent, sanitizeMasterEvent, type MasterEventMod } from '@/engine/masterEventMods'
import { computePlacements, sanitizeShopMod, shopUsage, type ShopMod } from '@/engine/shopMods'
import { enterLocation, settlementArea } from '@/engine/grid'
import type { GameState } from '@/engine/types'
import { pruneAbilities, prunePerks, pruneStatuses } from '@/engine/state'
import { pruneStories } from '@/engine/story'
import { enemyUsage, gearUsage, itemUsage, npcUsage, perkUsage, renameItemInState, storyUsage } from '@/engine/usage'
import { useGame } from './game'
import { storyReach } from '@/engine/storyReach'
import { GEN_KINDS, genFlagPrefix, type GenKind } from '@/engine/questGen'
import { buildRefs, closure, contentKeys, fingerprint, pickMods, REF_SECTIONS, splitKey, type RefGraph, type RefKey } from '@/engine/contentRefs'
import { buildPackage, compareRows, type ImportChoice, type ImportPackage, type ImportRow } from '@/engine/contentImport'
import { buildBuiltinWorldZip, builtinWorldEntries, diffBuiltinWorld, hasChanges, importReport, readBuiltinWorldZip, type BuiltinImportReport, type BuiltinWorldDiff } from '@/engine/builtinWorld'
import { builtinWorldReadme } from '@/engine/builtinWorldReadme'

/** 舊版只有一套自訂內容 */
const LEGACY_KEY = 'elondia.content'
const WORLDS_KEY = 'elondia.worlds'
/** 原版世界：沒有任何自訂內容，不能修改 */
export const VANILLA = 'vanilla'
export const VANILLA_NAME = '原版世界'
/** 在原版世界修改內容時，自動建立的世界的名字 */
export const FORK_NAME = '我的世界'

export interface World {
  id: string
  name: string
  mods: ContentMods
  /** 最後修改的時間（毫秒） */
  updated: number
  /** 綁定的提示詞組：切換到這個世界時一起切換（世界包匯入時綁定，也可以在世界管理改） */
  promptSet?: string
  /** 局部匯入的紀錄：每一項匯入時的指紋（之後再匯入同一項時，看得出是不是新版本、這裡有沒有改過） */
  imported?: Record<string, string>
  /** 從「匯入內建世界」建立的：當時的匯入結果（世界管理可以再看一次） */
  importReport?: BuiltinImportReport
}

interface WorldsFile {
  active: string
  worlds: World[]
}

/** 存檔記住的世界 */
export interface WorldRef { id: string; name: string }

type Section = Exclude<keyof ContentMods, 'version'>
const MOD_SECTIONS: Section[] = ['statuses', 'conditions', 'tattoos', 'marks', 'parasites', 'markRules', 'dungeons', 'landmarks', 'specialMaps', 'shops', 'abilities', 'perks', 'materials', 'bases', 'items', 'enemies', 'npcs', 'stories', 'travelEvents', 'eventRules', 'bindRules', 'family', 'homes', 'masterEvents', 'categoryIcons', 'counters', 'npcTags', 'classes']
export const MOD_SECTION_NAMES: Record<Section, string> = {
  statuses: '狀態', conditions: '非戰鬥狀態', tattoos: '刺青圖樣', parasites: '寄生物', marks: '奴隸印記', markRules: '印記設定', landmarks: '地標', specialMaps: '特殊地圖', shops: '商店', abilities: '技能', perks: '特質', materials: '材料', bases: '底材', items: '物品', enemies: '怪物', npcs: '固定 NPC', stories: '特殊任務', travelEvents: '事件', eventRules: '事件設定', bindRules: '雙面效應設定', family: '懷孕與泌乳設定', homes: '房屋設定', masterEvents: '主奴與娼館的事件', categoryIcons: '類別圖示', counters: '劇情計數器', dungeons: '地下城', npcTags: '身分標籤', classes: '職業',
}

export interface ModsDiffEntry {
  key: string
  section: Section
  id: string
  label: string
}

export interface ModsDiff {
  incoming: ContentMods
  added: ModsDiffEntry[]
  changed: ModsDiffEntry[]
  same: number
}

export function modLabel(section: Section, id: string, v: unknown): string {
  const o = v as { name?: string; title?: string }
  if (section === 'markRules' || section === 'eventRules' || section === 'bindRules' || section === 'family' || section === 'homes') return MOD_SECTION_NAMES[section]
  if (section === 'categoryIcons') return `${MOD_SECTION_NAMES[section]}「${itemRules.categories[id as ItemCategory] ?? id}」`
  if (section === 'shops') return `${MOD_SECTION_NAMES[section]}「${shopRules.types[id as ShopType]?.name ?? id}」`
  const name = section === 'items' ? id : o.title ?? o.name ?? id
  return `${MOD_SECTION_NAMES[section]}「${name}」`
}

/** 讀出所有世界；舊版的自訂內容（有內容時）變成「我的世界」 */
function loadWorlds(): WorldsFile {
  try {
    const raw = localStorage.getItem(WORLDS_KEY)
    if (raw) {
      const f = JSON.parse(raw) as Partial<WorldsFile>
      const worlds = (Array.isArray(f.worlds) ? f.worlds : [])
        .filter((w): w is World => !!w && typeof w.id === 'string' && w.id !== VANILLA)
        .map((w) => ({
          id: w.id, name: String(w.name || '未命名的世界').slice(0, 30), mods: normalizeMods(w.mods), updated: Number(w.updated) || 0,
          // 綁定的提示詞組與匯入紀錄（以前讀回來時漏掉 promptSet：重新整理後綁定就不見了）
          ...(typeof w.promptSet === 'string' ? { promptSet: w.promptSet } : {}),
          ...(w.imported && typeof w.imported === 'object' ? { imported: w.imported } : {}),
          ...(w.importReport && typeof w.importReport === 'object' && Array.isArray(w.importReport.lines) ? { importReport: w.importReport } : {}),
        }))
      return { active: worlds.some((w) => w.id === f.active) ? f.active! : VANILLA, worlds }
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    const mods = legacy ? normalizeMods(JSON.parse(legacy)) : emptyMods()
    if (modTotal(mods)) return { active: 'w-mine', worlds: [{ id: 'w-mine', name: '我的世界', mods, updated: Date.now() }] }
  } catch {
    // 讀不了：從原版開始
  }
  return { active: VANILLA, worlds: [] }
}

/** 一套自訂內容有幾項 */
export function modTotal(m: ContentMods): number {
  return MOD_SECTIONS.reduce((n, k) => n + Object.keys(m[k] ?? {}).length, 0)
}

function activeMods(f: WorldsFile): ContentMods {
  return f.worlds.find((w) => w.id === f.active)?.mods ?? emptyMods()
}

/** 啟動時（建立其他 store 之前）先套用目前的世界，讀檔與開新遊戲才會看到自訂內容 */
export function initContent(): string[] {
  return applyContent(activeMods(loadWorlds()))
}

export const useContent = defineStore('content', () => {
  const initial = loadWorlds()
  const worlds = ref<World[]>(initial.worlds)
  const active = ref(initial.active)
  const mods = ref<ContentMods>(activeMods(initial))
  const problems = ref<string[]>([])
  /** 遊戲資料不是響應式的：每次套用後加一，讓畫面重新計算 */
  const version = ref(0)
  const readOnly = computed(() => active.value === VANILLA)
  const activeName = computed(() => worldName(active.value))

  function worldName(id: string): string {
    return id === VANILLA ? VANILLA_NAME : worlds.value.find((w) => w.id === id)?.name ?? '（已刪除的世界）'
  }

  /** 上次寫進瀏覽器失敗（通常是上傳的圖示太多，超過 localStorage 的容量） */
  const persistFailed = ref(false)

  function persist() {
    try {
      localStorage.setItem(WORLDS_KEY, JSON.stringify({ active: active.value, worlds: worlds.value }))
      persistFailed.value = false
    } catch {
      // 寫不進去時只在本次有效
      persistFailed.value = true
    }
  }

  /** 套用目前世界的內容（不存檔） */
  function apply() {
    problems.value = applyContent(mods.value)
    version.value++
  }

  /** 自動建立的世界的名字：「我的世界」，同名時加數字 */
  function forkName(): string {
    const names = new Set(worlds.value.map((w) => w.name))
    if (!names.has(FORK_NAME)) return FORK_NAME
    for (let i = 2; ; i++) if (!names.has(`${FORK_NAME} ${i}`)) return `${FORK_NAME} ${i}`
  }

  /**
   * 原版世界不能直接修改：把這次的修改存成一個新的世界（原版的複本加上這次的修改）並切換過去。
   * 進行中的遊戲也改用這個世界（除了這次的修改，內容和原版一樣），之後的存檔記住它；原版世界的其他存檔不受影響。
   */
  function forkVanilla() {
    const id = createWorld(forkName(), undefined, mods.value)
    useWorld(id)
    const game = useGame()
    if (game.state) game.state.world = { id, name: worldName(id) }
    game.flash(`原版世界不能直接修改：已自動建立「${worldName(id)}」並切換過去，這次的修改存在那裡${game.state ? '（進行中的遊戲也改用它）' : ''}。`)
  }

  function save() {
    // 原版世界不能直接改：有修改時自動複製成新的世界（沒有修改就什麼都不做）
    if (readOnly.value) {
      if (!modTotal(mods.value)) {
        apply()
        return
      }
      forkVanilla()
    }
    const w = worlds.value.find((x) => x.id === active.value)
    if (w) {
      w.mods = mods.value
      w.updated = Date.now()
    }
    problems.value = applyContent(mods.value)
    // 被拿掉的能力（匯入、全部恢復預設）：從目前存檔的角色身上拿掉
    const game = useGame()
    if (game.state) {
      pruneStatuses(game.state)
      pruneAbilities(game.state)
      prunePerks(game.state)
      pruneStories(game.state)
      pruneSpecialMaps(game.state)
      takeParasiteNotice()
      if (pruneParasites(game.state.party)) game.flash(takeParasiteNotice() ?? '', 8000)
      // 身上的淫紋照改過的寄生物更新名稱與外觀
      refreshParasiteMarks(game.state.party)
      // 拿掉的自建地下城（匯入、全部恢復預設）：人在裡面時送回聚落
      if (pruneLocations(game.state)) {
        enterLocation(game.state)
        const moved = takeLocationNotice()
        if (moved) game.flash(moved, 8000)
      }
      pruneRoadEvent(game.state)
      pruneTownEvent(game.state)
      pruneDungeonEvent(game.state)
      pruneLeadEvent(game.state)
      pruneParasiteEvent(game.state)
      prunePregnancyEvent(game.state)
    }
    version.value++
    persist()
  }

  // ---- 世界 ----

  /** 切到另一個世界（遊戲進行中不能切換） */
  function switchWorld(id: string) {
    if (useGame().state) throw new Error('遊戲進行中不能切換世界：回到首頁再切換')
    useWorld(id)
  }

  function useWorld(id: string) {
    const w = worlds.value.find((x) => x.id === id)
    active.value = w ? w.id : VANILLA
    mods.value = w ? w.mods : emptyMods()
    apply()
    persist()
    // 綁定的提示詞組跟著切換（那一組被刪掉時不動）
    const prompts = usePrompts()
    if (w?.promptSet && prompts.sets.some((x) => x.id === w.promptSet)) prompts.switchSet(w.promptSet)
  }

  /** 世界綁定（或解除）提示詞組 */
  function linkPromptSet(worldId: string, setId: string | undefined) {
    const w = worlds.value.find((x) => x.id === worldId)
    if (!w) throw new Error('原版世界不能綁定提示詞組')
    if (setId) w.promptSet = setId
    else delete w.promptSet
    persist()
  }

  /**
   * 匯入世界包或內容檔，建立成新的世界（worldgen/README.md）：世界包帶著提示詞時，另外建立一組提示詞並綁定。
   * 有錯誤的特殊任務不匯入（和匯入內容檔一樣）。回傳新世界的 id 與說明
   */
  function importWorld(text: string, fallbackName: string): { id: string; promptSet?: string; dropped: string[] } {
    const file = parseWorldFile(JSON.parse(text))
    const name = file.name || fallbackName || '匯入的世界'
    const incoming = normalizeFresh(file.content)
    const dropped = dropBrokenStories(incoming)
    const notes = locationNotes(emptyMods(), file.content, incoming)
    const id = createWorld(name, undefined, incoming)
    problems.value = [...problems.value, ...dropped, ...notes]
    if (!file.prompts) return { id, dropped }
    const setId = usePrompts().createSetFrom(worldName(id), file.prompts)
    linkPromptSet(id, setId)
    return { id, promptSet: setId, dropped }
  }

  /** 目前世界的世界包：內容，加上綁定的提示詞組（沒有綁定時用目前用的那一組） */
  function exportWorld(desc?: string): string {
    const prompts = usePrompts()
    const w = worlds.value.find((x) => x.id === active.value)
    const config = (w?.promptSet && prompts.setConfig(w.promptSet)) || prompts.config
    return JSON.stringify(makeWorldPackage(activeName.value, mods.value, config, desc), null, 2)
  }

  /** 新的世界：複製另一個世界的內容（不給時是空的，等於從原版開始） */
  function createWorld(name: string, copyFrom?: string, content?: ContentMods): string {
    const from = content ?? worlds.value.find((w) => w.id === copyFrom)?.mods
    const id = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    worlds.value.push({ id, name: name.trim().slice(0, 30) || '新的世界', mods: from ? normalizeMods(JSON.parse(JSON.stringify(from))) : emptyMods(), updated: Date.now() })
    // normalizeMods 會先登錄自建的能力與底材：恢復成目前的內容
    apply()
    persist()
    return id
  }

  function renameWorld(id: string, name: string) {
    const w = worlds.value.find((x) => x.id === id)
    if (!w || !name.trim()) return
    w.name = name.trim().slice(0, 30)
    persist()
  }

  function deleteWorld(id: string) {
    if (id === VANILLA) throw new Error('原版世界不能刪除')
    if (useGame().state && id === active.value) throw new Error('進行中的遊戲正在用這個世界')
    worlds.value = worlds.value.filter((w) => w.id !== id)
    if (active.value === id) useWorld(VANILLA)
    else persist()
  }

  /**
   * 讀檔、繼續時切到存檔的世界（不檢查遊戲是否進行中）。存檔沒有記世界（舊存檔）時沿用目前的；
   * 世界被刪掉了，存檔附有當時的內容時還原成一個新的世界，否則改用原版世界。回傳實際用的世界與說明
   */
  function enterWorld(ref: WorldRef | undefined, snapshot?: ContentMods): WorldRef & { note?: string } {
    if (!ref) return { id: active.value, name: activeName.value }
    if (ref.id === VANILLA || worlds.value.some((w) => w.id === ref.id)) {
      if (ref.id !== active.value) useWorld(ref.id)
      return { id: ref.id, name: worldName(ref.id) }
    }
    if (snapshot && modTotal(normalizeMods(snapshot))) {
      const id = createWorld(`${ref.name}（從存檔還原）`, undefined, snapshot)
      useWorld(id)
      return { id, name: worldName(id), note: `存檔用的世界「${ref.name}」已經不在了，用存檔附上的內容還原成「${worldName(id)}」` }
    }
    useWorld(VANILLA)
    return { id: VANILLA, name: VANILLA_NAME, note: `存檔用的世界「${ref.name}」已經不在了，改用原版世界` }
  }

  /**
   * 首頁匯入存檔時，存檔要用哪個世界：附了自訂內容、而且它的世界在這個瀏覽器不存在或內容不同時，
   * 用附帶的內容建立一個新的世界（名稱用存檔世界的名字，同名時後面加 4 位數字），存檔改指向它。
   * - 已經有內容完全相同的世界（例如同一個檔案匯入第二次）：沿用那個世界（reused），不再建立。
   * - 沒有記世界的舊匯出檔、但附了自訂內容：一樣建立新的世界（名稱「匯入的世界」）。
   * - 沒有附內容、原版世界、或世界相同時照舊。
   * 尾碼依內容固定算出來（不是亂數），dryRun（只算出結果、不建立）和正式匯入的名稱一樣。
   */
  function worldForImport(ref: WorldRef | undefined, content: ContentMods | undefined, dryRun = false): { ref?: WorldRef; created?: string; reused?: string } {
    if (!content || ref?.id === VANILLA) return { ref }
    const incoming = normalizeMods(JSON.parse(JSON.stringify(content)))
    // normalizeMods 會先登錄自建的能力與底材：比較完恢復成目前的內容
    apply()
    if (!modTotal(incoming)) return { ref }
    // 存檔不帶上傳的圖示：比較時不看圖示（同一個世界有圖示也算相同）
    const text = JSON.stringify(withoutIcons(incoming))
    const same = (w: { mods: ContentMods }) => JSON.stringify(withoutIcons(w.mods)) === text
    const existing = ref && worlds.value.find((w) => w.id === ref.id)
    if (existing && same(existing)) return { ref }
    const twin = worlds.value.find(same)
    if (twin) return { ref: { id: twin.id, name: twin.name }, reused: twin.name }
    const taken = new Set([VANILLA_NAME, ...worlds.value.map((w) => w.name)])
    const base = (ref?.name || '匯入的世界').slice(0, 25)
    let name = base
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
    for (let n = 0; taken.has(name); n++) name = `${base}${1000 + ((h + n) % 9000)}`
    if (dryRun) return { ref, created: name }
    const id = createWorld(name, undefined, incoming)
    return { ref: { id, name }, created: name }
  }

  // ---- 引用檢查：還有地方用到的自建項目不能刪 ----

  type Kind = 'enemy' | 'item' | 'base' | 'material' | 'npc' | 'story' | 'ability' | 'perk' | 'status' | 'condition' | 'tattoo' | 'mark' | 'shop' | 'landmark' | 'specialMap' | 'dungeon' | 'parasite' | 'npcTag' | 'class'
  /** 哪些地方用到這一項（其他內容與目前載入的存檔） */
  function usageOf(kind: Kind, key: string): string[] {
    const state = useGame().state
    switch (kind) {
      // 自建地下城的遭遇表記在地下城上：用到的怪物不能刪（docs/CONTENT_DEPENDENCIES.md）
      case 'enemy': return [...enemyUsage(key, state), ...enemyInDungeons(key, mods.value.dungeons ?? {})]
      case 'item': return itemUsage(key, state)
      case 'base': return gearUsage('base', key, state, Object.keys(mods.value.items))
      case 'material': return gearUsage('material', key, state, Object.keys(mods.value.items))
      case 'npc': return npcUsage(key, state)
      case 'story': return storyUsage(key, state)
      case 'ability': return abilityUsage(key, state)
      case 'perk': return perkUsage(key, state)
      case 'status': return statusUsage(key, state)
      case 'condition': return conditionUsage(key, state)
      case 'tattoo': return tattooUsage(key)
      case 'mark': return markUsage(key)
      case 'shop': return shopUsage(key)
      case 'landmark': return landmarkUsage(key)
      case 'specialMap': return specialMapUsage(key)
      case 'dungeon': return dungeonUsage(key, state)
      case 'parasite': return parasiteUsage(key, state)
      case 'npcTag': return npcTagUsage(key, state)
      case 'class': return classUsage(key, state)
    }
  }
  function assertUnused(kind: Kind, key: string) {
    const used = usageOf(kind, key)
    if (used.length) throw new Error(`還有地方用到，不能刪除：${used.slice(0, 3).join('、')}${used.length > 3 ? ` 等 ${used.length} 處` : ''}`)
  }

  // ---- 怪物 ----

  function saveEnemy(id: string, draft: Partial<EnemyMod>) {
    const custom = !builtinEnemy(id)
    mods.value.enemies[id] = sanitizeEnemy(id, draft, custom)
    save()
  }

  /** 自建的怪物才能刪 */
  function deleteEnemy(id: string) {
    if (!mods.value.enemies[id]?.custom) throw new Error('內建的怪物不能刪除')
    assertUnused('enemy', id)
    delete mods.value.enemies[id]
    save()
  }

  /** 內建怪物恢復預設 */
  function restoreEnemy(id: string) {
    if (mods.value.enemies[id]?.custom) return
    delete mods.value.enemies[id]
    save()
  }

  // ---- 物品 ----

  function saveItem(name: string, draft: Partial<ItemMod>, rename?: string) {
    const existing = mods.value.items[name]
    const custom = existing ? !!existing.custom : !!draft.custom
    if (!existing && custom && itemDef(name)) throw new Error(`已經有叫「${name}」的物品`)
    const target = custom && rename?.trim() ? cleanItemName(rename) || name : name
    // AI 生成或打造時登錄在目前存檔的物品也算（同名會蓋掉它的類別、價格與裝備組成）
    const taken = (n: string) => !!mods.value.items[n] || !!itemDef(n) || !!useGame().state?.customItems?.[n]
    if (!existing && custom && useGame().state?.customItems?.[name]) throw new Error(`目前的存檔已經有叫「${name}」的物品`)
    if (target !== name) {
      if (taken(target)) throw new Error(`已經有叫「${target}」的物品`)
      delete mods.value.items[name]
      renameRefs(name, target)
      // 目前存檔裡的同名物品一起改名（其他存檔裡的會變成無法使用的雜物）
      const game = useGame()
      if (game.state) renameItemInState(game.state, name, target)
    }
    mods.value.items[target] = sanitizeItem(target, draft, custom)
    save()
    return target
  }

  function deleteItem(name: string) {
    if (!mods.value.items[name]?.custom) throw new Error('內建的物品不能刪除')
    assertUnused('item', name)
    delete mods.value.items[name]
    renameRefs(name, null)
    save()
  }

  function restoreItem(name: string) {
    if (mods.value.items[name]?.custom) return
    delete mods.value.items[name]
    save()
  }

  /** 改名或刪除時更新怪物掉落與特殊任務獎勵裡的參照 */
  function renameRefs(from: string, to: string | null) {
    for (const e of Object.values(mods.value.enemies)) {
      if (!e.loot?.some((l) => l.item === from)) continue
      e.loot = to ? e.loot.map((l) => (l.item === from ? { ...l, item: to } : l)) : e.loot.filter((l) => l.item !== from)
      if (!e.loot.length) delete e.loot
    }
    // 其他物品的配方材料與種子長出的作物
    for (const it of Object.values(mods.value.items)) {
      if (it.recipe?.inputs.some((x) => x.name === from)) {
        it.recipe.inputs = to ? it.recipe.inputs.map((x) => (x.name === from ? { ...x, name: to } : x)) : it.recipe.inputs.filter((x) => x.name !== from)
        if (!it.recipe.inputs.length) delete it.recipe
      }
      if (it.seed?.yields.includes(from)) {
        it.seed.yields = to ? it.seed.yields.map((y) => (y === from ? to : y)) : it.seed.yields.filter((y) => y !== from)
        if (!it.seed.yields.length) delete it.seed
      }
      // 工具的燃料（例如油燈的燈油）
      if (to && it.tool?.fuel === from) it.tool.fuel = to
    }
    // 商店的固定清單
    for (const m of Object.values(mods.value.shops ?? {})) {
      if (!m.fixed?.some((f) => f.item === from)) continue
      m.fixed = to ? m.fixed.map((f) => (f.item === from ? { ...f, item: to } : f)) : m.fixed.filter((f) => f.item !== from)
      if (!m.fixed.length) delete m.fixed
    }
    if (!to) return
    // 寄生物寄生的物品與馴服後的物品
    for (const p of Object.values(mods.value.parasites ?? {})) {
      if (p.item === from) p.item = to
      if (p.tamed?.item === from) p.tamed.item = to
    }
    for (const s of Object.values(mods.value.stories)) {
      const lists = [s.rewards, ...s.nodes.flatMap((n) => [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])]).map((o) => o?.effects)]
      for (const list of lists) for (const e of list ?? []) if (e.type === 'item' && e.name === from) e.name = to
    }
  }

  /** 在物品這邊設定掉落：改的是怪物的 loot（沒改過的內建怪物會先複製一份） */
  function setItemDrops(name: string, drops: { enemy: string; chance: number; qty: number }[]) {
    const wanted = new Map(drops.filter((d) => enemies[d.enemy] && d.chance > 0).map((d) => [d.enemy, d]))
    for (const e of Object.values(enemies)) {
      const has = (e.loot ?? []).some((l) => l.item === name)
      const want = wanted.get(e.id)
      if (!has && !want) continue
      const current = mods.value.enemies[e.id] ?? (JSON.parse(JSON.stringify(e)) as EnemyMod)
      const loot = (current.loot ?? []).filter((l) => l.item !== name)
      if (want) loot.push({ item: name, chance: want.chance, ...(want.qty > 1 ? { qty: want.qty } : {}) })
      const before = JSON.stringify((e.loot ?? []).filter((l) => l.item === name))
      const after = JSON.stringify(loot.filter((l) => l.item === name))
      if (before === after && !mods.value.enemies[e.id]) continue
      mods.value.enemies[e.id] = sanitizeEnemy(e.id, { ...current, loot }, !builtinEnemy(e.id))
    }
    save()
  }

  // ---- 底材與材料 ----

  function saveBase(id: string, draft: Partial<BaseMod>, custom: boolean) {
    mods.value.bases[id] = sanitizeBase(draft, custom, id)
    save()
  }
  function deleteBase(id: string) {
    if (!mods.value.bases[id]?.custom) throw new Error('內建的底材不能刪除')
    assertUnused('base', id)
    delete mods.value.bases[id]
    save()
  }
  function restoreBase(id: string) {
    if (!mods.value.bases[id]?.custom) delete mods.value.bases[id]
    save()
  }
  function saveMaterial(id: string, draft: Partial<MaterialMod>, custom: boolean) {
    mods.value.materials[id] = sanitizeMaterial(draft, custom, id)
    save()
  }
  function deleteMaterial(id: string) {
    if (!mods.value.materials[id]?.custom) throw new Error('內建的材料不能刪除')
    assertUnused('material', id)
    delete mods.value.materials[id]
    save()
  }
  function restoreMaterial(id: string) {
    if (!mods.value.materials[id]?.custom) delete mods.value.materials[id]
    save()
  }

  // ---- 固定 NPC ----

  /** 把存檔裡生成的人存成固定 NPC（同一個 id，關係與記憶延續；存檔的紀錄由呼叫的地方改，見 game.promoteNpc） */
  function promoteNpc(state: GameState, id: string) {
    // 原版世界時 save() 會自動建立自己的世界（進行中的遊戲跟著改用它）
    mods.value.npcs[id] = npcModFromState(state, id)
    save()
  }

  function saveNpc(id: string, draft: Partial<NpcMod>) {
    mods.value.npcs[id] = sanitizeNpc(id, draft, !builtinNpc(id))
    save()
  }
  function deleteNpc(id: string) {
    if (!mods.value.npcs[id]?.custom) throw new Error('內建的角色不能刪除')
    assertUnused('npc', id)
    delete mods.value.npcs[id]
    save()
  }
  function restoreNpc(id: string) {
    if (!mods.value.npcs[id]?.custom) delete mods.value.npcs[id]
    save()
  }

  // ---- 特殊任務 ----

  /**
   * 儲存特殊任務。有錯誤（storyCheck 的 errors）時不存；目前的存檔正在進行這個任務、
   * 而這次修改會弄壞它的進度時（progressBreaks）也不存——先在編輯器選「複製成新任務」或「放棄這個存檔的任務進度」。
   */
  function saveStory(id: string, draft: Partial<StoryMod>) {
    const next = sanitizeStory(id, draft, !builtinStory(id))
    const check = storyCheck(next)
    if (check.errors.length) throw new Error(`特殊任務有錯誤，不能儲存：${check.errors.join('；')}`)
    const state = useGame().state
    const breaks = state ? progressBreaks(state, stories.find((s) => s.id === id), next) : []
    if (breaks.length) throw new Error(`目前的存檔正在進行這個任務，這次修改會弄壞它的進度：${breaks.join('；')}`)
    mods.value.stories[id] = next
    save()
  }
  function deleteStory(id: string) {
    if (!mods.value.stories[id]?.custom) throw new Error('內建的特殊任務不能刪除')
    assertUnused('story', id)
    delete mods.value.stories[id]
    save()
  }
  function restoreStory(id: string) {
    if (!mods.value.stories[id]?.custom) delete mods.value.stories[id]
    save()
  }

  // ---- 能力 ----

  function saveAbility(id: string, draft: Partial<AbilityMod>) {
    mods.value.abilities[id] = sanitizeAbility(id, draft, !builtinAbility(id))
    save()
  }
  /** 自建、而且沒有被任何地方用到的能力才能刪 */
  function deleteAbility(id: string) {
    if (!mods.value.abilities[id]?.custom) throw new Error('內建的能力不能刪除')
    assertUnused('ability', id)
    delete mods.value.abilities[id]
    save()
  }
  function restoreAbility(id: string) {
    if (!mods.value.abilities[id]?.custom) delete mods.value.abilities[id]
    save()
  }

  // ---- 狀態（BUFF／DEBUFF） ----

  function saveStatus(id: string, draft: Partial<StatusMod>) {
    mods.value.statuses[id] = sanitizeStatus(id, draft, !builtinStatus(id))
    save()
  }
  /** 自建、而且沒有被任何地方用到的狀態才能刪 */
  function deleteStatus(id: string) {
    if (!mods.value.statuses[id]?.custom) throw new Error('內建的狀態不能刪除')
    assertUnused('status', id)
    delete mods.value.statuses[id]
    save()
  }
  function restoreStatus(id: string) {
    if (!mods.value.statuses[id]?.custom) delete mods.value.statuses[id]
    save()
  }

  // ---- 非戰鬥狀態（用餐、喝酒……）：內建的改回跟內建一樣時不留紀錄 ----

  function saveCondition(id: string, draft: Partial<ConditionMod>) {
    const base = builtinCondition(id)
    const m = sanitizeCondition(id, draft, !base)
    mods.value.conditions ??= {}
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeCondition(id, base))) delete mods.value.conditions[id]
    else mods.value.conditions[id] = m
    save()
  }
  /** 自建、而且沒有被任何地方用到的非戰鬥狀態才能刪 */
  function deleteCondition(id: string) {
    if (!mods.value.conditions?.[id]?.custom) throw new Error('內建的狀態不能刪除')
    assertUnused('condition', id)
    delete mods.value.conditions[id]
    save()
  }
  function restoreCondition(id: string) {
    if (!mods.value.conditions?.[id]?.custom) delete mods.value.conditions?.[id]
    save()
  }

  // ---- 劇情計數器 ----

  function saveCounter(id: string, draft: Partial<CounterMod>) {
    const key = cleanCounterId(id)
    if (!key) throw new Error('計數器的 id 只能用小寫英文、數字與底線')
    const base = builtinCounter(key)
    const m = sanitizeCounter(draft, !base)
    mods.value.counters ??= {}
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeCounter(base, false))) delete mods.value.counters[key]
    else mods.value.counters[key] = m
    save()
  }
  /** 自建、而且沒有被任何地方用到的計數器才能刪 */
  function deleteCounter(id: string) {
    if (!mods.value.counters?.[id]?.custom) throw new Error('內建的計數器不能刪除')
    const used = counterUsage(id)
    if (used.length) throw new Error(`還有地方用到這個計數器：${used.join('、')}`)
    delete mods.value.counters[id]
    save()
  }
  function restoreCounter(id: string) {
    if (!mods.value.counters?.[id]?.custom) delete mods.value.counters?.[id]
    save()
  }

  // ---- 身分標籤（R20 的 C6） ----

  /** 存一個身分標籤：內建的和內建一樣時不另外存 */
  function saveNpcTag(id: string, draft: Partial<NpcTagMod>) {
    const base = builtinNpcTag(id)
    const t = sanitizeNpcTagMod(draft, !base)
    mods.value.npcTags ??= {}
    if (base && JSON.stringify(t) === JSON.stringify(sanitizeNpcTagMod(editableOf(base), false))) delete mods.value.npcTags[id]
    else mods.value.npcTags[id] = t
    save()
  }
  function deleteNpcTag(id: string) {
    if (!mods.value.npcTags?.[id]?.custom) throw new Error('內建的身分標籤不能刪除')
    assertUnused('npcTag', id)
    delete mods.value.npcTags[id]
    save()
  }
  function restoreNpcTag(id: string) {
    if (!mods.value.npcTags?.[id]?.custom) delete mods.value.npcTags?.[id]
    save()
  }

  // ---- 職業 ----

  /** 存一個職業：內建的和內建一樣時不另外存 */
  function saveClass(id: string, draft: Partial<ClassMod>) {
    const base = builtinClassMod(id)
    const c = sanitizeClassMod(draft, !base)
    mods.value.classes ??= {}
    if (base && JSON.stringify(c) === JSON.stringify(sanitizeClassMod(base, false))) delete mods.value.classes[id]
    else mods.value.classes[id] = c
    save()
  }
  function deleteClass(id: string) {
    if (!mods.value.classes?.[id]?.custom) throw new Error('內建的職業不能刪除')
    assertUnused('class', id)
    delete mods.value.classes[id]
    save()
  }
  /**
   * 職業編輯器的批次勾選：讓 ids 這些能力（而且只有這些）能被這個職業學到，一次存檔。
   * 內建能力改完和內建一樣時不另外存；職業要先存好（整理能力時會檢查職業存不存在）
   */
  function setClassAbilities(classId: string, ids: string[]) {
    const want = new Set(ids)
    let changed = false
    for (const a of Object.values(abilities)) {
      if (a.classes.includes('monster') || a.classes.includes('lewd')) continue
      const has = a.classes.includes(classId)
      if (has === want.has(a.id)) continue
      const src = JSON.parse(JSON.stringify(mods.value.abilities[a.id] ?? a)) as AbilityMod
      src.classes = has ? src.classes.filter((c) => c !== classId) : [...src.classes, classId]
      const base = builtinAbility(a.id)
      const next = sanitizeAbility(a.id, src, !base)
      if (base && JSON.stringify(next) === JSON.stringify(sanitizeAbility(a.id, base, false))) delete mods.value.abilities[a.id]
      else mods.value.abilities[a.id] = next
      changed = true
    }
    if (changed) save()
  }
  function restoreClass(id: string) {
    if (!mods.value.classes?.[id]?.custom) delete mods.value.classes?.[id]
    save()
  }

  // ---- 刺青圖樣、奴隸印記與印記設定 ----

  function saveTattoo(id: string, draft: Partial<TattooMod>) {
    const t = sanitizeTattooMod(draft, !builtinTattoo(id))
    if (!t) throw new Error('誓約的加減不合規則（有加有減、加總為 0）')
    ;(mods.value.tattoos ??= {})[id] = t
    save()
  }
  function deleteTattoo(id: string) {
    if (!mods.value.tattoos?.[id]?.custom) throw new Error('內建的刺青圖樣不能刪除')
    assertUnused('tattoo', id)
    delete mods.value.tattoos[id]
    save()
  }
  function restoreTattoo(id: string) {
    if (!mods.value.tattoos?.[id]?.custom) delete mods.value.tattoos?.[id]
    save()
  }
  // ---- 寄生物 ----

  /** 存一種寄生物：內建的照內建的種類；寄生裝備沒有物品或欄位時丟出錯誤 */
  function saveParasite(id: string, draft: Partial<ParasiteMod>) {
    const p = sanitizeParasiteMod(id, draft)
    const base = builtinParasite(id)
    // 和內建一模一樣：不記（之後遊戲更新時跟著更新）
    if (base && JSON.stringify(sanitizeParasiteMod(id, base)) === JSON.stringify(p)) delete mods.value.parasites?.[id]
    else (mods.value.parasites ??= {})[id] = p
    save()
  }
  function deleteParasite(id: string) {
    if (!mods.value.parasites?.[id]?.custom) throw new Error('內建的寄生物不能刪除')
    assertUnused('parasite', id)
    delete mods.value.parasites[id]
    save()
  }
  function restoreParasite(id: string) {
    if (!mods.value.parasites?.[id]?.custom) delete mods.value.parasites?.[id]
    save()
  }

  function saveMark(id: string, draft: Partial<MarkMod>) {
    ;(mods.value.marks ??= {})[id] = sanitizeMarkMod(draft, !builtinMark(id))
    save()
  }
  function deleteMark(id: string) {
    if (!mods.value.marks?.[id]?.custom) throw new Error('內建的奴隸印記不能刪除')
    assertUnused('mark', id)
    delete mods.value.marks[id]
    save()
  }
  function restoreMark(id: string) {
    if (!mods.value.marks?.[id]?.custom) delete mods.value.marks?.[id]
    save()
  }
  function saveMarkRules(draft: Partial<MarkRulesMod>) {
    ;(mods.value.markRules ??= {}).rules = sanitizeMarkRules(draft, new Set(Object.keys(slaveryRules.contracts)), builtinMarkRules())
    save()
  }
  function restoreMarkRules() {
    delete mods.value.markRules?.rules
    save()
  }

  // ---- 商店 ----

  /** 存商店：位置要擺得上去（空地、沒有別的店），擺不上去就不存 */
  function saveShop(id: string, draft: Partial<ShopMod>) {
    const m = sanitizeShopMod(id, draft)
    const next = { ...(mods.value.shops ?? {}), [id]: m }
    if (!m.custom && !Object.keys(m).length) delete next[id]
    const bad = computePlacements(next).rejected.find((r) => r.shop === id)
    if (bad) throw new Error(`${settlementArea(bad.at.area)?.name ?? bad.at.area}（${bad.at.x}, ${bad.at.y}）擺不上去：${bad.reason}`)
    mods.value.shops = next
    save()
  }
  /** 內建的店恢復預設（位置也回到原處） */
  function restoreShop(id: string) {
    if (mods.value.shops?.[id]?.custom) return
    delete mods.value.shops?.[id]
    save()
  }
  /** 自建、而且沒有固定 NPC 擔任店主的商店才能刪；在這裡受訓的特質一起拿掉這個地點 */
  function deleteShop(id: string) {
    if (!mods.value.shops?.[id]?.custom) throw new Error('內建的商店不能刪除')
    assertUnused('shop', id)
    setShopTraining(id, [])
    delete mods.value.shops[id]
    save()
  }

  /**
   * 這種店的受訓清單：存在各特質的受訓地點（train.cells）上。拿掉最後一個地點的特質不再能受訓；
   * 加回去時沿用內建的受訓設定（價格、時數、檢定）。和內建一樣的特質不另外存。
   */
  function setShopTraining(cell: string, perkIds: string[]) {
    const want = new Set(perkIds)
    for (const p of perkRules.perks) {
      if (p.race) continue
      const train = p.train ?? builtinPerk(p.id)?.train
      if (!train) continue
      const has = !!p.train?.cells.includes(cell)
      if (has === want.has(p.id)) continue
      const next = JSON.parse(JSON.stringify(mods.value.perks[p.id] ?? p)) as PerkMod
      const cells = (p.train?.cells ?? []).filter((c) => c !== cell)
      if (want.has(p.id)) cells.push(cell)
      // 照內建的順序排（加回去的和內建一樣時不另外存）
      const order = builtinPerk(p.id)?.train?.cells ?? []
      const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length)
      cells.sort((a, b) => rank(a) - rank(b))
      next.train = { ...train, cells }
      if (!cells.length) delete next.train
      const custom = !builtinPerk(p.id)
      const clean = sanitizePerkMod(p.id, next, custom)
      if (!clean) continue
      if (!custom && JSON.stringify(clean) === JSON.stringify(sanitizePerkMod(p.id, builtinPerk(p.id)!, false))) delete mods.value.perks[p.id]
      else mods.value.perks[p.id] = clean
    }
    save()
  }

  // ---- 地標 ----

  /** 存地標：位置要是那個聚落的一格空地（道路），或這個地標現在的格子 */
  function saveLandmark(id: string, draft: Partial<LandmarkMod>) {
    const m = sanitizeLandmarkMod(id, draft)
    const why = landmarkSpotProblem(id, m.at)
    if (why) throw new Error(`${settlementArea(m.at.area)?.name ?? m.at.area}（${m.at.x}, ${m.at.y}）${why}`)
    mods.value.landmarks ??= {}
    const base = builtinLandmark(id)
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeLandmarkMod(id, base))) delete mods.value.landmarks[id]
    else mods.value.landmarks[id] = m
    save()
  }
  function restoreLandmark(id: string) {
    if (mods.value.landmarks?.[id]?.custom) return
    delete mods.value.landmarks?.[id]
    save()
  }
  /** 自建、而且沒有被用到的地標才能刪；在這裡受訓的特質一起拿掉這個地點 */
  function deleteLandmark(id: string) {
    if (!mods.value.landmarks?.[id]?.custom) throw new Error('內建的地標不能刪除')
    assertUnused('landmark', id)
    setShopTraining(id, [])
    delete mods.value.landmarks[id]
    save()
  }

  // ---- 特殊地圖 ----

  function saveSpecialMap(id: string, draft: Partial<SpecialMapMod>) {
    const m = sanitizeSpecialMapMod(id, draft, { ...specialMaps, ...(mods.value.specialMaps ?? {}) })
    mods.value.specialMaps ??= {}
    const base = builtinSpecialMap(id)
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeSpecialMapMod(id, base))) delete mods.value.specialMaps[id]
    else mods.value.specialMaps[id] = m
    save()
  }
  function restoreSpecialMap(id: string) {
    if (mods.value.specialMaps?.[id]?.custom) return
    delete mods.value.specialMaps?.[id]
    save()
  }
  /** 自建、而且沒有被用到的地圖才能刪 */
  function deleteSpecialMap(id: string) {
    if (!mods.value.specialMaps?.[id]?.custom) throw new Error('內建的特殊地圖不能刪除')
    assertUnused('specialMap', id)
    delete mods.value.specialMaps[id]
    save()
  }

  // ---- 自建地下城 ----

  /** 名稱不能和其他地點重複；至少要有一條路線 */
  function saveDungeon(id: string, draft: Partial<DungeonMod>) {
    const m = sanitizeDungeonMod(id, draft, (x) => !!enemies[x])
    if (geography.locations.some((l) => l.id !== id && l.name === m.name)) throw new Error(`已經有叫「${m.name}」的地點`)
    if (!m.routes.length) throw new Error('地下城至少要有一條路線（接到一個聚落）')
    mods.value.dungeons ??= {}
    mods.value.dungeons[id] = m
    save()
  }
  /** 沒有被用到的地下城才能刪（遭遇表一起拿掉） */
  function deleteDungeon(id: string) {
    if (!mods.value.dungeons?.[id]) throw new Error('只有自建的地下城可以刪除')
    assertUnused('dungeon', id)
    delete mods.value.dungeons[id]
    save()
  }
  /** 「從這些地下城拿掉」：把這隻怪物從所有自建地下城的遭遇與層主拿掉 */
  function removeEnemyFromDungeons(enemyId: string) {
    let changed = false
    for (const [id, m] of Object.entries(mods.value.dungeons ?? {})) {
      const next = withoutEnemy(m, enemyId)
      if (next) {
        mods.value.dungeons[id] = next
        changed = true
      }
    }
    if (changed) save()
  }

  // ---- 旅途與城鎮事件 ----

  function saveTravelEvent(id: string, draft: Partial<TravelEventMod>) {
    const base = builtinTravelEvent(id)
    const m = sanitizeTravelEvent(id, draft, !base)
    mods.value.travelEvents ??= {}
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeTravelEvent(id, base, false))) delete mods.value.travelEvents[id]
    else mods.value.travelEvents[id] = m
    save()
  }
  function restoreTravelEvent(id: string) {
    if (mods.value.travelEvents?.[id]?.custom) return
    delete mods.value.travelEvents?.[id]
    save()
  }
  /** 自建的事件隨時可以刪（等待中的事件作廢） */
  function deleteTravelEvent(id: string) {
    if (!mods.value.travelEvents?.[id]?.custom) throw new Error('內建的事件不能刪除')
    delete mods.value.travelEvents[id]
    save()
  }
  function saveEventRules(draft: Partial<EventRulesMod>) {
    ;(mods.value.eventRules ??= {}).rules = sanitizeEventRules(draft)
    save()
  }
  function restoreEventRules() {
    delete mods.value.eventRules?.rules
    save()
  }
  /** 懷孕與泌乳設定（docs/FAMILY.md 第 12 節） */
  function saveFamilyRules(draft: FamilyRulesMod) {
    ;(mods.value.family ??= {}).rules = sanitizeFamilyRules(draft)
    save()
  }
  function restoreFamilyRulesMod() {
    delete mods.value.family?.rules
    save()
  }
  /** 房屋設定（家僕與舒適度，docs/HOMES.md 第 8 節） */
  function saveHomeRules(draft: HomeRulesMod) {
    ;(mods.value.homes ??= {}).rules = sanitizeHomeRules(draft)
    save()
  }
  function restoreHomeRulesMod() {
    delete mods.value.homes?.rules
    save()
  }
  function saveBindRules(draft: Partial<BindRulesMod>) {
    ;(mods.value.bindRules ??= {}).rules = sanitizeBindRules(draft)
    save()
  }
  function restoreBindRules() {
    delete mods.value.bindRules?.rules
    save()
  }

  // ---- 主奴與娼館的事件（主人事件格式） ----

  function saveMasterEvent(id: string, draft: Partial<MasterEventMod>) {
    const base = builtinMasterEvent(id)
    const m = sanitizeMasterEvent(id, draft, !base)
    mods.value.masterEvents ??= {}
    if (base && JSON.stringify(m) === JSON.stringify(sanitizeMasterEvent(id, base, false))) delete mods.value.masterEvents[id]
    else mods.value.masterEvents[id] = m
    save()
  }
  function restoreMasterEvent(id: string) {
    if (mods.value.masterEvents?.[id]?.custom) return
    delete mods.value.masterEvents?.[id]
    save()
  }
  /** 自建的事件隨時可以刪（等待回應中的作廢） */
  function deleteMasterEvent(id: string) {
    if (!mods.value.masterEvents?.[id]?.custom) throw new Error('內建的事件不能刪除')
    delete mods.value.masterEvents[id]
    save()
  }

  // ---- 類別圖示 ----

  /** 換一個類別的圖示（沒有 icon 時換回內建的） */
  function saveCategoryIcon(category: ItemCategory, icon: string | undefined) {
    const clean = sanitizeIcon(icon)
    if (icon && !clean) throw new Error('圖示太大或格式不對')
    const map = (mods.value.categoryIcons ??= {})
    if (clean) map[category] = { icon: clean }
    else delete map[category]
    save()
  }
  function restoreCategoryIcons() {
    mods.value.categoryIcons = {}
    save()
  }

  // ---- 特質 ----

  function savePerk(id: string, draft: Partial<PerkMod>) {
    const p = sanitizePerkMod(id, draft, !builtinPerk(id))
    if (!p) throw new Error('特質的內容不完整')
    mods.value.perks[id] = p
    save()
  }
  /** 自建、而且沒有被任何地方用到的特質才能刪 */
  function deletePerk(id: string) {
    if (!mods.value.perks[id]?.custom) throw new Error('內建的特質不能刪除')
    assertUnused('perk', id)
    delete mods.value.perks[id]
    save()
  }
  function restorePerk(id: string) {
    if (!mods.value.perks[id]?.custom) delete mods.value.perks[id]
    save()
  }

  /** 內容頁籤裡用過的劇情旗標（自動完成用） */
  function knownFlags(): string[] {
    const set = new Set<string>()
    for (const n of namedNpcs) {
      for (const f of [...(n.requires?.flags ?? []), ...(n.requires?.flags_none ?? [])]) set.add(f)
      // 「依劇情旗標改變出沒」的每一組條件
      for (const st of n.stages ?? []) for (const f of [...(st.requires?.flags ?? []), ...(st.requires?.flags_none ?? [])]) set.add(f)
    }
    for (const s of stories) for (const u of flagUsage(s)) set.add(u.flag)
    return [...set].sort()
  }

  // ---- 匯出、匯入、重設 ----

  function exportMods(): string {
    return JSON.stringify({ type: 'elondia-content', ...mods.value }, null, 2)
  }

  // ---- 匯出、匯入內建世界（engine/builtinWorld.ts） ----

  /** 匯出內建世界：原版的全部可編輯內容，一種一個 JSON 檔，附 README，包成 zip */
  function exportBuiltinWorld(date = new Date()): Uint8Array {
    try {
      applyContent(emptyMods())
      const entries = builtinWorldEntries()
      const day = date.toISOString().slice(0, 10)
      return buildBuiltinWorldZip(entries, builtinWorldReadme(entries, day), date)
    } finally {
      apply()
    }
  }

  /**
   * 匯入內建世界：和內建比較，只留改過的與新增的，建立成新的世界（不動原版與其他世界）。
   * 回傳新世界的 id 與匯入結果（改了哪些、新增哪些、被調整的欄位、整筆略過的、有錯誤沒匯入的特殊任務）；
   * 匯入結果也記在新世界上。什麼都沒改時（或 dryRun）不建立世界（id 是 undefined）
   */
  function importBuiltinWorld(bytes: Uint8Array, name: string, file = '', o: { dryRun?: boolean } = {}): { id?: string; diff: BuiltinWorldDiff; report: BuiltinImportReport } {
    const read = readBuiltinWorldZip(bytes)
    let diff: BuiltinWorldDiff
    let incoming: ContentMods
    let found: string[]
    try {
      applyContent(emptyMods())
      diff = diffBuiltinWorld(read.content, builtinWorldEntries())
      incoming = normalizeMods(diff.mods)
      // 有錯誤的特殊任務不匯入（和其他匯入一樣）；套用一次，看看還有什麼問題（引用不存在的東西……）
      found = [...dropBrokenStories(incoming), ...applyContent(incoming)]
    } finally {
      // 整理時自建的狀態、特質會暫時登錄進遊戲資料：恢復成目前的世界
      apply()
    }
    const report = importReport(file, diff, read.errors, [...new Set(found)])
    // dryRun：只檢查（匯入前先看有沒有改動，有才問世界的名字），不建立世界
    if (!hasChanges(diff) || o.dryRun) return { diff, report }
    const id = createWorld(name.trim() || '匯入的內建世界', undefined, incoming)
    const w = worlds.value.find((x) => x.id === id)!
    w.importReport = report
    persist()
    return { id, diff, report }
  }

  /**
   * 整理要取代全部內容（或建立新世界）的內容：先還原成原版再整理，舊世界的自建項目（例如被拿掉的地下城）
   * 才不會被當成還存在。整理失敗時恢復目前的內容。
   */
  function normalizeFresh(raw: unknown): ContentMods {
    applyContent(emptyMods())
    try {
      return normalizeMods(JSON.parse(JSON.stringify(raw ?? {})))
    } catch (e) {
      apply()
      throw e
    }
  }

  /**
   * 匯入時（取代全部內容、匯入成新的世界）整理掉的地點引用：不在新內容裡的自建地下城，
   * 以及所屬地點不存在、被改到別的地點的特殊地圖（docs/CONTENT_DEPENDENCIES.md 第 2 節）。只是提醒：存檔與遊戲都不會壞。
   */
  function locationNotes(before: ContentMods, raw: unknown, incoming: ContentMods): string[] {
    const out: string[] = []
    for (const d of Object.values(before.dungeons ?? {})) {
      if (!incoming.dungeons?.[d.id]) out.push(`自建地下城「${d.name}」不在匯入的內容裡，已經拿掉（用到它的特殊任務不匯入、事件與情報物品的引用拿掉；存檔裡人在裡面或在往返的路上時送回聚落）`)
    }
    const rawMaps = ((raw ?? {}) as { specialMaps?: Record<string, { name?: string; location?: string } | undefined> }).specialMaps ?? {}
    for (const [id, m] of Object.entries(rawMaps)) {
      const now = incoming.specialMaps?.[id]?.location
      if (m?.location && now && m.location !== now) out.push(`特殊地圖「${m.name ?? id}」原本屬於「${m.location}」（這個世界沒有這個地點），改成屬於「${locationName(now)}」`)
    }
    return out
  }

  /** 匯入內容檔：asNew 時建立成新的世界，否則取代目前世界的內容 */
  function importMods(text: string, asNew?: string): string | undefined {
    // 世界包也收：只取內容（提示詞要用「匯入世界包」）
    const raw = parseWorldFile(JSON.parse(text)).content
    const incoming = normalizeFresh(raw)
    // 有錯誤的特殊任務不匯入（dropBrokenStories 會套用 incoming：之後一定要重新套用）
    const dropped = dropBrokenStories(incoming)
    const notes = locationNotes(asNew !== undefined ? emptyMods() : mods.value, raw, incoming)
    if (asNew !== undefined) {
      const id = createWorld(asNew || '匯入的世界', undefined, incoming)
      problems.value = [...problems.value, ...dropped, ...notes]
      return id
    }
    mods.value = incoming
    try {
      save()
    } finally {
      problems.value = [...problems.value, ...dropped, ...notes]
    }
    return undefined
  }

  /**
   * 和匯入存檔附上的自訂內容比較：新增的、和這個瀏覽器不同的、相同的。
   * 每一項的 key 是「區塊:id」（例如 stories:lost_ring）
   */
  function diffMods(raw: unknown): ModsDiff {
    const incoming = normalizeMods(raw)
    // normalizeMods 會先登錄自建的能力與底材：比較完恢復成目前的內容
    problems.value = applyContent(mods.value)
    const diff: ModsDiff = { incoming, added: [], changed: [], same: 0 }
    for (const section of MOD_SECTIONS) {
      // 選填的區塊（懷孕與泌乳設定……）兩邊都可能沒有
      const mine = (mods.value[section] ?? {}) as Record<string, unknown>
      for (const [id, v] of Object.entries((incoming[section] ?? {}) as Record<string, unknown>)) {
        const entry = { key: `${section}:${id}`, section, id, label: modLabel(section, id, v) }
        if (!(id in mine)) diff.added.push(entry)
        else if (JSON.stringify(mine[id]) !== JSON.stringify(v)) diff.changed.push(entry)
        else diff.same++
      }
    }
    return diff
  }

  /** 合併：加入新增的，take 裡的（和這個瀏覽器不同的項目）換成檔案的；這個瀏覽器其他的內容不動 */
  function mergeMods(diff: ModsDiff, take: string[] = []): number {
    const want = new Set([...diff.added.map((e) => e.key), ...take])
    let n = 0
    const merged = new Set<string>()
    const before: Record<string, StoryMod> = {}
    for (const e of [...diff.added, ...diff.changed]) {
      if (!want.has(e.key)) continue
      if (e.section === 'stories') {
        merged.add(e.id)
        if (mods.value.stories[e.id]) before[e.id] = mods.value.stories[e.id]!
      }
      ;((mods.value as unknown as Record<string, Record<string, unknown>>)[e.section] ??= {})[e.id] = (diff.incoming[e.section] as Record<string, unknown>)[e.id]
      n++
    }
    // 合併進來的特殊任務有錯誤時不收：保留這個瀏覽器原本的版本
    const dropped = merged.size ? dropBrokenStories(mods.value, merged) : []
    for (const id of merged) if (!mods.value.stories[id] && before[id]) mods.value.stories[id] = before[id]!
    if (n) save()
    problems.value = [...problems.value, ...dropped]
    return n
  }

  // ---- 局部匯入、匯出（docs/plan/WORLD_EDITOR_PLAN.md E1、E2） ----

  /** 讀局部匯入的來源：內容檔、世界包（只取內容），或這個瀏覽器的另一個世界 */
  function importSource(from: { text: string } | { world: string }): { name: string; mods: ContentMods; picked: RefKey[] } {
    if ('world' in from) {
      const w = worlds.value.find((x) => x.id === from.world)
      if (!w) throw new Error('找不到那個世界')
      return { name: w.name, mods: normalizeMods(JSON.parse(JSON.stringify(w.mods))), picked: [] }
    }
    const raw = JSON.parse(from.text) as { meta?: { picked?: unknown } }
    const file = parseWorldFile(raw)
    const { meta, ...content } = file.content as Partial<ContentMods> & { meta?: { picked?: unknown } }
    const picked = Array.isArray(meta?.picked) ? meta!.picked.filter((k): k is string => typeof k === 'string') : []
    const out = { name: file.name ?? '檔案', mods: normalizeMods(content), picked }
    // normalizeMods 會先登錄自建的內容：恢復成目前的世界
    apply()
    return out
  }

  /** 來源的關聯（制式裝備的名稱要用來源的內容查：先在沙盒裡套用來源，算完恢復） */
  function analyzeSource(source: ContentMods): RefGraph {
    try {
      applyContent(source)
      return buildRefs(source)
    } finally {
      apply()
    }
  }

  /** 和目前的世界比較：新增、一樣、衝突（含是不是上次匯入之後沒改過的新版本） */
  function compareImport(source: ContentMods, keys: Iterable<RefKey>): ImportRow[] {
    const w = worlds.value.find((x) => x.id === active.value)
    return compareRows(mods.value, source, keys, w?.imported ?? {})
  }

  function packageFor(source: ContentMods, rows: ImportRow[], choices: Record<RefKey, ImportChoice>): ImportPackage {
    return buildPackage(mods.value, source, rows, choices)
  }

  /** 把包裡的項目疊到一份內容上（不改傳進來的） */
  function withPackage(base: ContentMods, pkg: ImportPackage): ContentMods {
    const out = JSON.parse(JSON.stringify(base)) as ContentMods
    for (const section of REF_SECTIONS) {
      const add = pkg.mods[section] as Record<string, unknown> | undefined
      if (add) Object.assign(((out as unknown as Record<string, Record<string, unknown>>)[section] ??= {}), JSON.parse(JSON.stringify(add)))
    }
    return out
  }

  /**
   * 預檢查（沙盒，不改目前的世界）：
   * - changed：整理之後和包裡不一樣的項目（多半是引用拿不到被拿掉：照理不會有，有就是關聯漏了）
   * - errors：有錯誤的特殊任務（整包不能匯入）
   * - problems：套用時新出現的問題（例如地標、商店擺不上去）
   */
  function precheckImport(pkg: ImportPackage): { changed: RefKey[]; errors: string[]; problems: string[] } {
    try {
      const before = new Set(applyContent(mods.value))
      const merged = normalizeMods(withPackage(mods.value, pkg))
      const keys = contentKeys(pkg.mods as ContentMods)
      const changed = keys.filter((k) => {
        const [section, id] = splitKey(k)
        const a = (merged[section] as Record<string, unknown> | undefined)?.[id]
        const b = (pkg.mods[section] as Record<string, unknown> | undefined)?.[id]
        return JSON.stringify(a) !== JSON.stringify(b)
      })
      const storyIds = new Set(Object.keys(pkg.mods.stories ?? {}))
      const errors = storyIds.size ? dropBrokenStories(merged, storyIds) : []
      const problems = applyContent(merged).filter((p) => !before.has(p))
      return { changed, errors, problems }
    } finally {
      apply()
    }
  }

  /**
   * 特殊任務生成器（E4）的檢查（沙盒，不改目前的世界）：整理後疊到目前的世界上，跑任務檢查與可達性。
   * - mods：整理過的內容（之後照這份寫入）
   * - errors：要交回 AI 修的（任務檢查的錯誤、到不了的任務點、走不到完成、整理時不見的項目）
   * - warnings：只提醒的（任務檢查的提醒、可能卡住的結果、套用時的問題）
   */
  function checkGenerated(pkgMods: Partial<ContentMods>, storyId: string): { mods: Partial<ContentMods>; errors: string[]; warnings: string[] } {
    try {
      const before = new Set(applyContent(mods.value))
      const merged = normalizeMods(withPackage(mods.value, { mods: pkgMods, renamed: [], skipped: [], fingerprints: {} }))
      const problems = applyContent(merged).filter((p) => !before.has(p))
      const errors: string[] = []
      const warnings: string[] = []
      const keys = contentKeys(pkgMods as ContentMods)
      for (const k of keys) {
        const [section, id] = splitKey(k)
        if (!(merged[section] as Record<string, unknown> | undefined)?.[id]) errors.push(`${GEN_KINDS[section as GenKind] ?? section} ${id} 整理後不見了（id、位置或必填的欄位不對）`)
      }
      const def = stories.find((s) => s.id === storyId)
      if (!def) errors.push('任務整理後不見了')
      else {
        const c = storyCheck(def)
        errors.push(...c.errors)
        // 可達性的前兩項（到不了、走不到完成）對生成的任務算錯誤：一定要修
        const reach = storyReach(def)
        for (const id of reach.unreachable) errors.push(`任務點「${def.nodes.find((n) => n.id === id)?.title ?? id}」（${id}）不會解鎖：需要的旗標在這個任務裡怎麼走都設定不到`)
        if (!reach.canComplete) errors.push('沒有任何一條路走得到「完成任務」')
        // 這個任務自己的旗標（程式加了前綴的）沒有地方設定：AI 寫錯了名字或漏了設定
        const own = genFlagPrefix(storyId)
        for (const u of flagUsage(def)) if (u.flag.startsWith(own) && u.requiredBy.length && !u.setBy.length) errors.push(`旗標 🚩${u.flag} 沒有任何結果設定，需要它的「${u.requiredBy.join('」「')}」不會出現`)
        warnings.push(...c.warnings.filter((w) => !w.includes('不會解鎖：') && !w.startsWith('沒有任何一條路')), ...problems)
      }
      const out = pickMods(merged, new Set(keys.filter((k) => {
        const [section, id] = splitKey(k)
        return !!(merged[section] as Record<string, unknown> | undefined)?.[id]
      })))
      return { mods: out, errors, warnings }
    } finally {
      apply()
    }
  }

  /** 寫進目前的世界（原版世界時 save() 自動建立自己的世界），記下匯入紀錄 */
  function importPackage(pkg: ImportPackage): number {
    const keys = contentKeys(pkg.mods as ContentMods)
    if (!keys.length) return 0
    mods.value = withPackage(mods.value, pkg)
    save()
    const w = worlds.value.find((x) => x.id === active.value)
    if (w) {
      w.imported = { ...(w.imported ?? {}), ...pkg.fingerprints }
      persist()
    }
    return keys.length
  }

  /** 局部匯出：選的項目加上它們用到的全部（目前的世界），存成一般的內容檔 */
  function exportPicked(picked: RefKey[]): { text: string; count: number } {
    const graph = buildRefs(mods.value)
    const keys = closure(graph, picked)
    const content = pickMods(mods.value, keys)
    const fingerprints = Object.fromEntries([...keys].map((k) => [k, fingerprint(entryOfMods(k))]))
    return { text: JSON.stringify({ type: 'elondia-content', meta: { picked, fingerprints }, ...content }, null, 2), count: keys.size }
  }
  function entryOfMods(k: RefKey) {
    const [section, id] = splitKey(k)
    return (mods.value[section] as Record<string, unknown> | undefined)?.[id]
  }

  function resetAll() {
    mods.value = emptyMods()
    save()
  }

  return {
    mods, problems, version, usageOf,
    worlds, active, activeName, readOnly, forkName, worldName, switchWorld, createWorld, linkPromptSet, importWorld, exportWorld, renameWorld, deleteWorld, enterWorld, worldForImport,
    saveEnemy, deleteEnemy, restoreEnemy,
    saveItem, deleteItem, restoreItem, setItemDrops,
    saveBase, deleteBase, restoreBase, saveMaterial, deleteMaterial, restoreMaterial,
    saveNpc, deleteNpc, restoreNpc, promoteNpc, saveStory, deleteStory, restoreStory, savePerk, deletePerk, restorePerk, knownFlags,
    saveAbility, deleteAbility, restoreAbility, saveStatus, deleteStatus, restoreStatus, saveCondition, deleteCondition, restoreCondition,
    saveShop, setShopTraining, restoreShop, deleteShop, saveLandmark, restoreLandmark, deleteLandmark, saveSpecialMap, restoreSpecialMap, deleteSpecialMap, saveDungeon, deleteDungeon, removeEnemyFromDungeons, saveTattoo, deleteTattoo, restoreTattoo, saveNpcTag, deleteNpcTag, restoreNpcTag, saveClass, deleteClass, restoreClass, setClassAbilities, saveParasite, deleteParasite, restoreParasite, saveMark, deleteMark, restoreMark, saveMarkRules, restoreMarkRules,
    saveTravelEvent, restoreTravelEvent, deleteTravelEvent, saveMasterEvent, restoreMasterEvent, deleteMasterEvent, saveCounter, deleteCounter, restoreCounter, saveEventRules, restoreEventRules, saveFamilyRules, restoreFamilyRules: restoreFamilyRulesMod, saveHomeRules, restoreHomeRules: restoreHomeRulesMod, saveBindRules, restoreBindRules, saveCategoryIcon, restoreCategoryIcons, persistFailed,
    exportMods, importMods, resetAll, diffMods, mergeMods, exportBuiltinWorld, importBuiltinWorld,
    importSource, analyzeSource, compareImport, packageFor, precheckImport, checkGenerated, importPackage, exportPicked,
  }
})
