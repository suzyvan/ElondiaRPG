// 繁簡不分的名字比對：AI 照簡體的提示詞回傳物品、能力的名稱時，換回資料裡的寫法（見 docs/I18N.md 第 4 節）。
// 只逐字轉換（OpenCC 台灣字形 → 大陸簡體），不換用語。

import { Converter } from 'opencc-js/t2cn'
import { fixChainChar } from './chainChar'
import { itemLabel } from './itemKey'

const toHans = Converter({ from: 'tw', to: 'cn' })

/** 逐字轉成簡體（提示詞與名字比對共用） */
export function toSimplifiedText(text: string): string {
  return /[㐀-鿿豈-﫿]/.test(text) ? toHans(fixChainChar(text)) : text
}

/**
 * 在候選的名字裡找同一個名字（寫法一樣優先，再來繁簡不分）；找不到時原樣傳回。
 * 候選是自訂裝備的鍵（名字＋看不見的雜湊，itemKey.ts）時比對顯示的名字：AI 只看得到顯示的名字，
 * 同名的好幾件取候選裡的第一件（呼叫的地方把行囊排在前面）
 */
export function canonicalName(name: string, candidates: Iterable<string>): string {
  const list = [...candidates]
  if (list.includes(name)) return name
  const plain = itemLabel(name)
  const same = list.find((c) => itemLabel(c) === plain)
  if (same) return same
  const key = toSimplifiedText(plain)
  return list.find((c) => toSimplifiedText(itemLabel(c)) === key) ?? name
}

// ---- 搜尋框：繁簡不分（介面用簡體時，畫面上的名字是簡體，資料是繁體）----
const simpCache = new Map<string, string>()
function simpKey(t: string): string {
  if (t.length > 200) return toSimplifiedText(t)
  let v = simpCache.get(t)
  if (v === undefined) {
    v = toSimplifiedText(t)
    if (simpCache.size > 20000) simpCache.clear()
    simpCache.set(t, v)
  }
  return v
}

/** 搜尋：hay 裡有沒有 q（寫法一樣，或換成簡體之後一樣：輸入簡體也找得到繁體的資料） */
export function textHas(hay: string | null | undefined, q: string): boolean {
  if (!q) return true
  if (!hay) return false
  return hay.includes(q) || simpKey(hay).includes(simpKey(q))
}
