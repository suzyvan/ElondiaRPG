// 物品圖示的資料面：玩家在世界裡上傳的圖（data URL）與查找順序。說明見 docs/ITEMS.md 第 8 節。
// 內建的像素圖（類別、底材）在 components/items/itemArt.ts，這裡只決定「用哪一個」。
//
// 查找順序：
// 1. 物品自己上傳的圖（物品目錄的 icon）
// 2. 這個名稱的內建圖（玩家提供的圖鑑，engine/builtinIcons.ts）
// 3. 裝備：底材上傳的圖 → 內建的底材圖
// 4. 打造材料（寫了 forge 的材料類物品）：第一個對應材料的內建圖（components/icons/materialArt.ts）
// 5. 類別上傳的圖 → 內建的類別圖

import { builtinItemIcon } from './builtinIcons'
import { itemDef, type ItemCategory } from './data'
import { gearRules, gearSpecOf } from './gear'
import type { GameState, GearSpec } from './types'
import type { ContentMods } from './mods'

/** 上傳的圖縮到這個邊長以內 */
export const ICON_PX = 48
/** data URL 的長度上限（48×48 的 PNG 通常 2～8 KB） */
export const ICON_MAX_CHARS = 16_000
const DATA_URL = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/

/** 整理上傳的圖：只收圖片的 data URL，太大的不收 */
export function sanitizeIcon(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= ICON_MAX_CHARS && DATA_URL.test(v) ? v : undefined
}

/** 世界裡上傳的類別圖示（applyContent 套用；沒有的用內建的） */
export const categoryIcons: Partial<Record<ItemCategory, string>> = {}

export function setCategoryIcons(icons: Partial<Record<ItemCategory, string>>) {
  for (const k of Object.keys(categoryIcons) as ItemCategory[]) delete categoryIcons[k]
  Object.assign(categoryIcons, icons)
}

/** 要顯示的圖示：上傳的圖、內建的圖（smooth：畫的圖，縮放時平滑）、內建的底材圖、內建的材料圖（打造材料）或內建的類別圖 */
export type IconSource =
  | { kind: 'image'; src: string; smooth?: boolean }
  | { kind: 'base'; base: string }
  | { kind: 'category'; category?: ItemCategory }
  | { kind: 'material'; material: string }

export function categoryIconSource(category: ItemCategory | undefined): IconSource {
  const src = category ? categoryIcons[category] : undefined
  return src ? { kind: 'image', src } : { kind: 'category', category }
}

export function gearIconSource(spec: Pick<GearSpec, 'base'>): IconSource {
  const src = gearRules.bases[spec.base]?.icon
  return src ? { kind: 'image', src } : { kind: 'base', base: spec.base }
}

/** 物品的圖示；spec 是身上裝備的組成（物品目錄裡沒有的裝備也找得到底材） */
export function itemIconSource(state: Pick<GameState, 'customItems'> | undefined, name: string, spec?: GearSpec): IconSource {
  const def = itemDef(name)
  if (def?.icon) return { kind: 'image', src: def.icon }
  const builtin = builtinItemIcon(name)
  if (builtin) return { kind: 'image', src: builtin, smooth: true }
  const gear = spec ?? gearSpecOf(state, name)
  if (gear && gearRules.bases[gear.base]) return gearIconSource(gear)
  // 打造材料：用第一個對應材料的內建圖（依材料的類型、等級與稀有度）
  const forge = def?.category === 'material' ? def.forge?.materials.find((m) => !!gearRules.materials[m]) : undefined
  if (forge) return { kind: 'material', material: forge }
  return categoryIconSource(def?.category ?? (state?.customItems?.[name]?.category as ItemCategory | undefined))
}

/**
 * 自訂內容去掉上傳的圖示（物品、底材、類別、怪物）：存檔欄位與匯出的存檔不帶圖示，免得每個存檔都變大。
 * 圖示只存在世界裡（世界包會帶著）；存檔的世界不在了、用存檔附的內容還原時，就沒有圖示（用內建的圖）。回傳新的物件
 */
export function withoutIcons(mods: ContentMods): ContentMods {
  const out = JSON.parse(JSON.stringify(mods)) as ContentMods
  for (const v of Object.values(out.items ?? {})) delete v.icon
  for (const v of Object.values(out.bases ?? {})) delete v.icon
  for (const v of Object.values(out.enemies ?? {})) delete v.icon
  out.categoryIcons = {}
  return out
}
