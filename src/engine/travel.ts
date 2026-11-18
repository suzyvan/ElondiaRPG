// 旅行共用的常數與工具：路線方式的名稱、官道食宿與船資、路程天數、天候類的旅途事件（road.ts 的自動事件用），
// 以及抵達聚落時的處理。旅途本身（一格一天的路、沿途事件與遭遇戰）在 road.ts。

import type { RouteMode } from './data'
import type { Rng } from './rng'
import type { GameState } from './types'
import type { Leg } from './world'
import { enterLocation, placeOutside } from './grid'
import { arrivalCheck } from './security'
import { rejoinAway } from './companions'
import { syncMasterHome } from './masterHome'
import { ensureRoster, pruneNpcs, refreshRosters } from './population'

/** 官道沿途有旅店：每人每天食宿 */
export const ROAD_DAILY_CC = 15
/** 海路船資：每人每段（路線有 fare 時用路線的） */
export const SEA_FARE_CC = 50

/** 這段路每人的船資 */
export function legFare(leg: Pick<Leg, 'mode' | 'fare'>): number {
  return leg.fare ?? (leg.mode === 'sea' ? SEA_FARE_CC : 0)
}

export const MODE_NAME: Record<RouteMode, string> = {
  road: '官道', trail: '山道', wild: '荒野', sea: '海路', dive: '潛水', underground: '地底',
}

export interface TravelEvent {
  action: string
  /** 有 dc 時進行求生檢定，失敗則受傷 */
  dc?: number
  failDamage?: string
  failText?: string
  text: string
}

export const EVENTS: Record<RouteMode, TravelEvent[]> = {
  road: [
    { action: '遭遇・行商隊伍', text: '與往來的商隊同行一段路，交換了沿途見聞' },
    { action: '遭遇・巡邏騎士', text: '被巡邏騎士盤查身分後放行' },
    { action: '天候・驟雨', dc: 10, failDamage: '1d2', text: '及時找到屋簷避雨', failText: '被淋得全身濕透' },
  ],
  trail: [
    { action: '天候・山間濃霧', dc: 12, failDamage: '1d4', text: '在濃霧中穩步前進', failText: '在濃霧中失足擦傷' },
    { action: '發現・野獸足跡', text: '發現新鮮的野獸足跡，繞道避開' },
    { action: '天候・風雪', dc: 13, failDamage: '1d4', text: '找到避風處熬過風雪', failText: '在風雪中受凍' },
  ],
  wild: [
    { action: '天候・酷熱', dc: 13, failDamage: '1d6', text: '節省飲水撐過最熱的時段', failText: '因酷熱而虛脫' },
    { action: '發現・古戰場殘骸', text: '經過一片散落著鏽蝕兵器的古戰場' },
    { action: '天候・腐化瘴氣', dc: 14, failDamage: '1d6', text: '屏息穿過瘴氣帶', failText: '吸入瘴氣而頭暈目眩' },
  ],
  sea: [
    { action: '航行・浪湧', dc: 11, failDamage: '1d2', text: '穩住身子撐過浪湧', failText: '暈船嘔吐了半天' },
    { action: '航行・海豚群', text: '一群海豚在船邊並游了好一段距離' },
  ],
  dive: [{ action: '潛行・暗流', dc: 12, failDamage: '1d4', text: '順著暗流的縫隙下潛', failText: '被暗流捲得撞上礁石' }],
  underground: [{ action: '地下・落石', dc: 12, failDamage: '1d4', text: '避開了落石', failText: '被落石擦傷' }],
}

export function rollLegDays(rng: Rng, [min, max]: [number, number]): number {
  if (min === max) return min
  const steps = Math.round((max - min) * 2)
  return min + rng.int(0, steps) / 2
}

/**
 * 路程天數換成小時：整天算 24 小時（含夜宿），半天只算 6 小時——
 * 不能要人一天趕 24 小時的路，半天的路程就是白天走一段（刻意的，不是 Bug）。
 */
export function daysToHours(days: number): number {
  return Math.floor(days) * 24 + (days % 1) * 12
}

/** 抵達 state.location：建立地圖與名單，進城盤查，逃開的同伴歸隊；gate 為 false 時不經過城門（傳送陣直接到家裡） */
export function arrive(state: GameState, opts: { gate?: boolean } = {}) {
  enterLocation(state)
  ensureRoster(state, state.location)
  refreshRosters(state)
  pruneNpcs(state)
  // 進城的盤查：付不出罰金就被擋在城外
  if (opts.gate !== false && !arrivalCheck(state)) placeOutside(state)
  // 戰敗時逃開的同伴在聚落等著
  rejoinAway(state)
  // 主人的家（主角有主人時；舊存檔第一次抵達時建立）
  syncMasterHome(state)
}
