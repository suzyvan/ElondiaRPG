// 內建的物品與怪物圖（玩家提供的圖鑑，tools/icons/import_icons.py 匯入）。
// 圖放在 public/icons/（照原樣複製、用網址載入，不打包進 JS）；這裡只有「哪些名稱、哪些怪物有圖」的對照表。
// 說明見 docs/ITEMS.md 第 8 節、docs/MONSTERS.md。

import itemIndex from '@/assets/icons/itemIcons.json'
import monsterList from '@/assets/icons/monsterIcons.json'

const ITEMS = itemIndex as Record<string, string>
const MONSTERS = new Set(monsterList as string[])
/** 網站的根目錄（vite.config 的 base；測試與工具裡沒有時用 /） */
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

/** 物品名稱的內建圖網址（沒有的回傳 undefined） */
export function builtinItemIcon(name: string): string | undefined {
  const h = Object.hasOwn(ITEMS, name) ? ITEMS[name] : undefined
  return h ? `${BASE}icons/items/${h}.webp` : undefined
}

/** 怪物 id 的內建圖網址（沒有的回傳 undefined） */
export function builtinMonsterIcon(id: string | undefined): string | undefined {
  return id && MONSTERS.has(id) ? `${BASE}icons/monsters/${id}.webp` : undefined
}
