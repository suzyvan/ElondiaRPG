// 內建的物品圖示：類別與底材各對到一張圖（itemArt.ts 自己畫的，或介面圖示 iconPaths.ts）。
// 玩家上傳的圖與查找順序在 engine/itemIcons.ts。

import type { ItemCategory } from '@/engine/data'
import { equipment, type WeaponDef } from '@/engine/data'
import { gearRules, type BaseDef, type BaseSlot, type MaterialKind } from '@/engine/gear'
import type { IconSource } from '@/engine/itemIcons'
import { ICON_PATHS, type IconName } from '../ui/iconPaths'
import { materialDraw } from '../icons/materialArt'
import { artPath, type ArtName } from './itemArt'

/** 一張內建的圖：自己畫的或介面圖示 */
export type IconRef = { art: ArtName } | { ui: IconName }

export const CATEGORY_ART: Record<ItemCategory, IconRef> = {
  food: { art: 'bread' }, consumable: { ui: 'potion' }, scroll: { ui: 'scroll' }, gear: { art: 'pouch' },
  material: { art: 'ore' }, equipment: { ui: 'sword' }, info: { ui: 'file' }, furniture: { ui: 'sofa' },
}
/** 不知道類別的物品 */
const UNKNOWN: IconRef = { ui: 'question' }

/** 內建底材的圖（好幾種底材可以共用一張） */
const BASE_ART: Record<string, IconRef> = {
  slave_collar: { art: 'collar' }, manacles: { art: 'manacles' }, shackles: { art: 'manacles' }, spiked_collar: { art: 'spiked_collar' }, choker: { art: 'choker' },
  dagger: { art: 'dagger' }, shortsword: { art: 'shortsword' }, scimitar: { art: 'scimitar' }, rapier: { art: 'rapier' }, longsword: { art: 'longsword' },
  mace: { art: 'mace' }, warhammer: { art: 'warhammer' }, greataxe: { art: 'greataxe' }, quarterstaff: { art: 'quarterstaff' }, spellstaff: { art: 'spellstaff' },
  longbow: { art: 'longbow' }, shield: { ui: 'shield' }, buckler: { art: 'buckler' }, focus: { art: 'focus' },
  helm: { art: 'helm' }, leather_cap: { art: 'leather_cap' }, hood: { art: 'hood' },
  plate: { art: 'plate' }, chain: { art: 'chain' }, leather_armor: { art: 'leather_armor' }, robe: { art: 'robe' }, monk_robe: { art: 'monk_robe' },
  greaves: { art: 'greaves' }, leather_leggings: { art: 'trousers' }, trousers: { art: 'trousers' },
  vambraces: { art: 'vambraces' }, bracers: { art: 'bracers' }, wraps: { art: 'wraps' },
  sabatons: { art: 'sabatons' }, boots: { art: 'boots' }, shoes: { art: 'shoes' },
  girdle: { art: 'girdle' }, belt: { art: 'belt' }, sash: { art: 'sash' },
  ring_precision: { art: 'ring' }, ring_guard: { art: 'ring' }, ring_fortune: { art: 'ring' }, ring_swift: { art: 'ring' },
  amulet_ward: { art: 'amulet' }, amulet_iron: { art: 'amulet' },
  pendant_fire: { art: 'pendant' }, pendant_cold: { art: 'pendant' }, pendant_lightning: { art: 'pendant' },
  pendant_poison: { art: 'pendant' }, pendant_shadow: { art: 'pendant' }, pendant_mind: { art: 'pendant' },
  earring_hawk: { art: 'earring' }, earring_calm: { art: 'earring' }, navel_ember: { art: 'navel' }, navel_vigor: { art: 'navel' },
  anklet_wind: { art: 'anklet' }, anklet_bell: { art: 'anklet' }, thigh_band: { art: 'thigh_band' }, thigh_sheath: { art: 'thigh_band' },
}

/** 武器類型 → 圖（自建底材沿用內建武器類型時） */
const WEAPON_ART: Record<string, ArtName> = {
  dagger: 'dagger', shortsword: 'shortsword', scimitar: 'scimitar', rapier: 'rapier', longsword: 'longsword',
  mace: 'mace', warhammer: 'warhammer', greataxe: 'greataxe', quarterstaff: 'quarterstaff', longbow: 'longbow',
}

/** 自建底材：依欄位與材料類型挑一張相近的圖 */
const SLOT_ART: Record<BaseSlot, Partial<Record<MaterialKind, IconRef>> & { any: IconRef }> = {
  main_hand: { any: { art: 'longsword' }, wood: { art: 'quarterstaff' }, jewel: { art: 'spellstaff' } },
  off_hand: { any: { ui: 'shield' }, leather: { art: 'buckler' }, wood: { art: 'buckler' }, jewel: { art: 'focus' } },
  head: { any: { art: 'helm' }, leather: { art: 'leather_cap' }, cloth: { art: 'hood' } },
  body: { any: { art: 'plate' }, leather: { art: 'leather_armor' }, cloth: { art: 'robe' } },
  legs: { any: { art: 'greaves' }, leather: { art: 'trousers' }, cloth: { art: 'trousers' } },
  wrists: { any: { art: 'vambraces' }, leather: { art: 'bracers' }, cloth: { art: 'wraps' } },
  feet: { any: { art: 'sabatons' }, leather: { art: 'boots' }, cloth: { art: 'shoes' } },
  belt: { any: { art: 'girdle' }, leather: { art: 'belt' }, cloth: { art: 'sash' } },
  accessory: { any: { art: 'amulet' }, leather: { art: 'collar' }, cloth: { art: 'choker' } },
  ring: { any: { art: 'ring' } }, ring_1: { any: { art: 'ring' } }, ring_2: { any: { art: 'ring' } },
  piercing: { any: { art: 'earring' } }, piercing_1: { any: { art: 'earring' } }, piercing_2: { any: { art: 'earring' } },
  leg_accessory: { any: { art: 'anklet' } },
  extra_1: { any: { art: 'earring' } },
  extra_2: { any: { art: 'earring' } },
  extra_3: { any: { art: 'earring' } },
  extra_4: { any: { art: 'earring' } },
  extra_5: { any: { art: 'earring' } },
  extra_6: { any: { art: 'earring' } },
  extra_7: { any: { art: 'earring' } },
  extra_8: { any: { art: 'earring' } },
  underwear_top: { any: { art: 'camisole' }, metal: { art: 'camisole' }, leather: { art: 'camisole' } },
  underwear_bottom: { any: { art: 'briefs' }, metal: { art: 'briefs' } },
}

/** 武器的圖：內建的武器類型有自己的圖；自建底材複製來的武器（登錄成 w_<底材>）找骰子與傷害類型相同的內建武器 */
function weaponArt(w: Pick<WeaponDef, 'dice' | 'type'> | undefined, id?: string): ArtName | undefined {
  if (id && WEAPON_ART[id]) return WEAPON_ART[id]
  if (!w) return undefined
  const same = Object.keys(WEAPON_ART).find((k) => equipment.weapons[k]?.dice === w.dice && equipment.weapons[k]?.type === w.type)
  return same ? WEAPON_ART[same] : undefined
}

/** 底材的內建圖：內建底材有自己的圖；自建的依武器類型、欄位與材料類型挑（傳 def 時用它，例如編輯中的草稿） */
export function baseArt(
  id: string, def: (Pick<BaseDef, 'slot' | 'kind' | 'weapon'> & { weaponDef?: Pick<WeaponDef, 'dice' | 'type'> }) | undefined = gearRules.bases[id],
): IconRef {
  const builtin = BASE_ART[id]
  if (builtin) return builtin
  if (!def) return UNKNOWN
  const weapon = weaponArt(def.weaponDef ?? (def.weapon ? equipment.weapons[def.weapon] : undefined), def.weapon)
  if (weapon && def.slot === 'main_hand') return { art: weapon }
  const s = SLOT_ART[def.slot]
  return s?.[def.kind] ?? s?.any ?? UNKNOWN
}

export function categoryArt(category: ItemCategory | undefined): IconRef {
  return category ? CATEGORY_ART[category] : UNKNOWN
}

/** 內建圖的 SVG path（24×24） */
export function refPath(ref: IconRef): string {
  return 'art' in ref ? artPath(ref.art) : ICON_PATHS[ref.ui]
}

/** 要畫的圖示：IconSource，或直接給內建圖的 path（編輯器預覽還沒儲存的草稿） */
export type DrawSource = IconSource | { kind: 'path'; path: string; color?: string }

/** 圖示來源要畫的東西：圖片網址或 SVG path（color 沒給時用文字顏色） */
export function sourceDraw(src: DrawSource): { img: string; smooth?: boolean } | { path: string; color?: string } {
  if (src.kind === 'image') return src.smooth ? { img: src.src, smooth: true } : { img: src.src }
  if (src.kind === 'path') return { path: src.path, color: src.color }
  if (src.kind === 'material') {
    const m = gearRules.materials[src.material]
    if (m) return materialDraw(m)
  }
  return { path: refPath(src.kind === 'base' ? baseArt(src.base) : categoryArt(src.kind === 'category' ? src.category : 'material')) }
}
