// 學工藝（docs/CRAFTING.md 1.1 節，R21 的 K5）：站在對應的店（crafts.json 的 skills.shop）付學費、花時間，工藝升一級。
// 主角或自己的夥伴可以學（學費由隊伍出）；任務同行、跟著別人的隊伍的人不行（和受訓學特質一樣，party.ts 的 trainees）。
// 店裡最多教到 tuition 的長度（Lv.2）；之後只能靠製作升級。不用擲骰，學會的那一級經驗從 0 起算。

import { craftRules, CRAFT_IDS, type CraftId } from './data'
import { currentCell } from './grid'
import { closedHere } from './landmarks'
import { formatMoney } from './money'
import { pcOf, trainees } from './party'
import { trainDays } from './perks'
import { commitReport } from './state'
import { shopKey, shopTypeForCell, tradeReport } from './trade'
import type { Character, GameState, Report } from './types'
import { craftName, skillOf } from './crafting'

export interface CraftLesson {
  craft: CraftId
  name: string
  /** 現在的等級與學完的等級 */
  from: number
  to: number
  price_cc: number
  /** 練習的總時數 */
  hours: number
  days: number
  blocked?: string
}

/** 學的人：自己的夥伴（沒給時是主角）；任務同行、跟著別人的隊伍的人不能學 */
function learnerOf(state: GameState, memberId?: string): Character | undefined {
  if (!memberId) return pcOf(state)
  return trainees(state).find((m) => m.id === memberId) ?? (state.party.some((m) => m.id === memberId) ? undefined : pcOf(state))
}

/** 這個人（預設主角）在這裡可以學的工藝（這一格的店教的、還沒到店裡教的上限） */
export function craftLessons(state: GameState, memberId?: string): CraftLesson[] {
  const type = shopTypeForCell(currentCell(state).kind)
  if (!type || closedHere(state)) return []
  const who = learnerOf(state, memberId)
  if (!who) return []
  return CRAFT_IDS.filter((id) => craftRules.skills[id].shop === type).flatMap((id) => {
    const from = skillOf(who, id).level
    const t = craftRules.tuition[from]
    if (!t) return []
    return [{
      craft: id, name: craftName(id), from, to: from + 1, price_cc: t.price_cc, hours: t.hours, days: trainDays(t.hours).days,
      ...(state.money_cc < t.price_cc ? { blocked: `錢不夠（要 ${formatMoney(t.price_cc)}）` } : {}),
    }]
  })
}

/** 學一級工藝：付學費、花時間（每天練 8 小時），等級 +1、經驗從 0 起算。memberId 是學的人（預設主角） */
export function learnCraft(state: GameState, id: CraftId, memberId?: string): Report {
  const who = learnerOf(state, memberId)
  if (!who) throw new Error('這個人不能在這裡受訓（任務同行、跟著別人的隊伍）')
  const lesson = craftLessons(state, memberId).find((l) => l.craft === id)
  if (!lesson) throw new Error(`這裡學不到${craftName(id)}（店裡最多教到 Lv.${craftRules.tuition.length}）`)
  if (lesson.blocked) throw new Error(lesson.blocked)
  const report = tradeReport(state, shopKey(state, shopTypeForCell(currentCell(state).kind)!), trainDays(lesson.hours).elapsed)
  // 學工藝是一則事件，不是交易（勾了「隱藏交易紀錄」也看得到）
  report.kind = 'event'
  report.changes.money_cc = -lesson.price_cc
  who.crafts = { ...who.crafts, [id]: { level: lesson.to, xp: 0 } }
  const time = lesson.days > 1 ? `花 ${lesson.days} 天練了 ${lesson.hours} 小時` : `練了 ${lesson.hours} 小時`
  report.outcome.summary = `${who.isPlayer ? '' : `替${who.name}`}付了 ${formatMoney(lesson.price_cc)}，${who.isPlayer ? '' : `${who.name}`}${time}，學會了${lesson.name}（Lv.${lesson.from} → Lv.${lesson.to}）。`
  report.outcome.tags = ['學工藝']
  return commitReport(state, report)
}
