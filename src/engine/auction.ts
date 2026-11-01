// 拍賣會（成人向，docs/LEWD_STATS.md 第 26 節；規則在 lewd.json 的 auction，地標的 auction）：
// 每天上幾件拍品（色情技能書、稀有的淫具……），每件每天出一次價；出價高過對手看不到的最高價就得標，付對手的最高價多一點。
// 也收寄賣：成人向的物品與色情技能書照行情賣掉，扣手續費。得標之後可能被盯上（城鎮事件）。

import { abilities, itemDef, lewdRules } from './data'
import { landmarkClosed, landmarkHere } from './landmarks'
import { formatMoney } from './money'
import { hashString } from './npcs'
import { Rng } from './rng'
import { commitReport, withRng } from './state'
import { flagKey } from './storyFlags'
import { baseReport } from './town'
import { itemValue } from './interactions'
import { capSale, isUniqueItem } from './trade'
import type { GameState, Report } from './types'

export const auctionRules = () => lewdRules.auction

export interface AuctionLot {
  name: string
  /** 起標價 */
  start: number
  /** 對手的最高出價（畫面上看不到） */
  rival: number
  /** 今天的結果：得標的價錢，或沒標到 */
  won?: number
  lost?: boolean
}

/** 站在開放的拍賣會 */
export function auctionBlocked(state: GameState): string | undefined {
  const l = landmarkHere(state)
  if (!l?.auction) return '這裡沒有拍賣會'
  return landmarkClosed(state, l) ?? (state.combat || state.pendingAction ? '現在不能這麼做' : undefined)
}

/** 今天的拍品：同一天、同一個地方固定（依存檔的種子），不動遊戲本身的亂數；只讀不寫（畫面會一直呼叫） */
export function auctionLots(state: GameState): AuctionLot[] {
  const cur = state.auction
  if (cur && cur.day === state.time.day && cur.location === state.location) return cur.lots
  const r = auctionRules()
  const rng = new Rng(hashString(`${state.seed}:${state.location}:${state.time.day}:auction`))
  const pool = r.pool.filter(([n]) => !!itemDef(n))
  const lots: AuctionLot[] = []
  while (lots.length < r.lots && pool.length) {
    let roll = rng.next() * pool.reduce((s, [, w]) => s + w, 0)
    const i = Math.max(0, pool.findIndex(([, w]) => (roll -= w) < 0))
    const [name] = pool.splice(i, 1)[0]!
    const price = itemValue(state, name)
    lots.push({ name, start: Math.round(price * r.start_ratio), rival: Math.round(price * (r.rival_ratio[0] + rng.next() * (r.rival_ratio[1] - r.rival_ratio[0]))) })
  }
  return lots
}

/** 出價時才把今天的拍品記進存檔（記下出過價的結果） */
function todayLots(state: GameState): AuctionLot[] {
  const lots = auctionLots(state)
  if (state.auction?.lots !== lots) state.auction = { day: state.time.day, location: state.location, lots }
  return lots
}

/** 出價：高過對手的最高價就得標，付對手的最高價 + 一口（不超過自己的出價） */
export function placeBid(state: GameState, index: number, amount: number): Report {
  const why = auctionBlocked(state)
  if (why) throw new Error(why)
  const lot = todayLots(state)[index]
  if (!lot) throw new Error('沒有這件拍品')
  if (lot.won !== undefined || lot.lost) throw new Error('這件今天已經出過價了')
  const bid = Math.floor(amount)
  if (bid < lot.start) throw new Error(`要從起標價 ${formatMoney(lot.start)} 起跳`)
  if (bid > state.money_cc) throw new Error('出價不能超過身上的錢')
  const r = auctionRules()
  const report = baseReport(state, 'trade', 1)
  report.outcome.tags = ['拍賣會']
  if (bid <= lot.rival) {
    lot.lost = true
    report.outcome = { result: 'failure', summary: `「${lot.name}」你出到 ${formatMoney(bid)}，包廂裡有人一路跟到更高，最後不是你的。`, tags: ['拍賣會'] }
    return commitReport(state, report)
  }
  const pay = Math.min(bid, lot.rival + Math.max(1, Math.round(itemValue(state, lot.name) * r.step)))
  lot.won = pay
  report.changes.money_cc = -pay
  report.changes.items_gained = [{ name: lot.name, qty: 1, owner: 'pc' }]
  const watched = withRng(state, (rng) => rng.chance(r.watch_chance))
  if (watched) report.changes.flags = { [flagKey(r.watch_flag)]: true }
  report.outcome.summary = `拍賣官的槌子落下：「${lot.name}」以 ${formatMoney(pay)} 成交。${watched ? '離場時，你注意到有人一直盯著你手上的東西。' : ''}`
  return commitReport(state, report)
}

/** 可以寄賣的：成人向的物品與色情技能書（行囊裡的） */
export function consignable(state: GameState): string[] {
  return state.inventory.filter((i) => {
    const d = itemDef(i.name)
    // 獨特裝備和商店一樣不收
    if (!d || i.qty <= 0 || !d.price_cc || isUniqueItem(state, i.name)) return false
    return !!d.adult || !!d.use?.abilities?.some((id) => abilities[id]?.classes.includes('lewd'))
  }).map((i) => i.name)
}

/** 寄賣：照行情（起伏不定）賣掉一件，扣手續費 */
export function consign(state: GameState, name: string): Report {
  const why = auctionBlocked(state)
  if (why) throw new Error(why)
  if (!consignable(state).includes(name)) throw new Error(`拍賣會不收「${name}」`)
  const r = auctionRules()
  const price = capSale(state, name, itemValue(state, name))
  const sold = withRng(state, (rng) => Math.round(price * (r.consign_ratio[0] + rng.next() * (r.consign_ratio[1] - r.consign_ratio[0]))))
  const fee = Math.round(sold * r.consign_fee)
  const report = baseReport(state, 'trade', 1)
  report.changes.items_lost = [{ name, qty: 1 }]
  report.changes.money_cc = sold - fee
  report.outcome.summary = `「${name}」在拍賣會上以 ${formatMoney(sold)} 賣出，扣掉手續費 ${formatMoney(fee)}，拿到 ${formatMoney(sold - fee)}。`
  report.outcome.tags = ['拍賣會']
  return commitReport(state, report)
}
