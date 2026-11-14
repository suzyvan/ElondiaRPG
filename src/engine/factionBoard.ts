// 冒險筆記的「勢力」分頁（docs/NPC_SYSTEM.md 第 9 節）：每個勢力的聲望、聲望對價格與罰金的影響、
// 屬於這個勢力的城鎮（警戒、通緝、去過沒有）、要聲望才能進的地方（王城、地標、神殿洗刺青）。
// 「接觸過的」：聲望不是 0、去過他們的城、或正被他們通緝；冒險者公會一直列。

import { geography, landmarks, locationById } from './data'
import { landmarkHidden, palaceName, zonesOf } from './grid'
import { alertLevel, factionName, isWanted, meetsReputation, reputationOf, securityRules, wantedFine } from './security'
import { visitedTown } from './storyBoard'
import { tattooShop } from './tattooShop'
import type { GameState } from './types'

export interface FactionTown { id: string; name: string; capital: boolean; alert: number; visited: boolean }
export interface FactionUnlock { name: string; need: number; ok: boolean }
export interface FactionEntry {
  id: string
  name: string
  rep: number
  band: { buy: number; sell: number; fine: number }
  /** 主角現在在這個勢力的城裡 */
  here: boolean
  wanted: boolean
  /** 通緝時的罰金 */
  fine?: number
  capital?: string
  towns: FactionTown[]
  unlocks: FactionUnlock[]
  met: boolean
}

export function bandOf(rep: number) {
  return securityRules.reputation_bands.find((b) => rep >= b.min) ?? securityRules.reputation_bands.at(-1)!
}

/** 所有勢力（接觸過的在前；同樣接觸過的照聲望由高到低） */
export function factionBoard(state: GameState): FactionEntry[] {
  const here = (() => {
    try { return locationById(state.location).faction } catch { return undefined }
  })()
  const wash = tattooShop('temple')?.min_reputation
  const out = geography.factions.map((f): FactionEntry => {
    const rep = reputationOf(state, f.id)
    const locs = geography.locations.filter((l) => l.faction === f.id && l.type !== 'dungeon')
    const towns = locs.map((l) => ({ id: l.id, name: l.name, capital: f.capital === l.id || l.type === 'capital', alert: alertLevel(state, l.id), visited: visitedTown(state, l.id) }))
    const unlocks: FactionUnlock[] = []
    const ok = (n: number) => meetsReputation(state, f.id, n)
    for (const l of locs) if (zonesOf(l).includes('palace')) unlocks.push({ name: `${l.name}的${palaceName(l)}`, need: securityRules.palace_reputation, ok: ok(securityRules.palace_reputation) })
    for (const lm of Object.values(landmarks)) {
      const need = lm.open?.min_reputation
      if (!need || !locs.some((l) => l.id === lm.location) || landmarkHidden(state, lm)) continue
      unlocks.push({ name: `${locationById(lm.location).name}的${lm.name}`, need, ok: ok(need) })
    }
    if (wash && locs.some((l) => zonesOf(l).includes('temple'))) unlocks.push({ name: '神殿洗刺青', need: wash, ok: ok(wash) })
    const wanted = isWanted(state, f.id)
    const capital = f.capital ? geography.locations.find((l) => l.id === f.capital)?.name : undefined
    return {
      id: f.id, name: factionName(f.id), rep, band: bandOf(rep), here: here === f.id, wanted,
      ...(wanted ? { fine: wantedFine(state, f.id) } : {}), ...(capital ? { capital } : {}),
      towns, unlocks, met: f.id === 'guild' || rep !== 0 || wanted || towns.some((t) => t.visited || t.alert > 0),
    }
  })
  return out.sort((a, b) => Number(b.met) - Number(a.met) || Number(b.here) - Number(a.here) || b.rep - a.rep)
}
