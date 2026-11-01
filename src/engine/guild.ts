// 冒險者公會的階級（見 docs/GUILD.md）：主角累積功績（交付委託、打倒層主、完成特殊任務），
// 功績與等級都夠了，公會發晉升考核委託；通過考核才升階。隊友的階級仍依等級換算。

import { guildRankFor } from './character'
import { dungeonEncounters, enemies, locationById, parkPlaza, progression, questXpRules, BOSS_LAYER_IDS, type BossLayerId } from './data'
import { layerName, layerRanks, RANK_ORDER, rewardRange } from './materialQuests'
import { shortestPath } from './world'
import type { GameState, GuildRank, GuildState, Quest } from './types'

const merit = () => progression.guild_merit

/** 主角在公會的階級與功績（舊存檔讀入前沒有時依等級換算） */
export function guildOf(state: GameState): GuildState {
  if (!state.guild) {
    const pc = state.party.find((m) => m.isPlayer) ?? state.party[0]!
    state.guild = { rank: guildRankFor(pc.level), merit: 0 }
  }
  return state.guild
}

export function playerRank(state: GameState): GuildRank {
  return guildOf(state).rank
}

export function rankInfo(rank: GuildRank) {
  return progression.guild_ranks.find((r) => r.rank === rank)!
}

/** 下一階（已經是 S 時沒有） */
export function nextRank(rank: GuildRank): GuildRank | undefined {
  return RANK_ORDER[RANK_ORDER.indexOf(rank) + 1]
}

/** 交付這個階級的委託得到的功績 */
export function questMerit(rank: GuildRank): number {
  return merit().quest[RANK_ORDER.indexOf(rank)] ?? 0
}

/** 交付委託的經驗（每位隊員）：只有不用打怪的委託有；材料委託交了 delivered 份時依比例增加 */
export function questXp(quest: Pick<Quest, 'kind' | 'rank' | 'goal' | 'flags'>, delivered = quest.goal): number {
  const r = questXpRules
  if (!r || isExam(quest) || !r.kinds.includes(quest.kind)) return 0
  return Math.round((r.per_rank_level * rankInfo(quest.rank).levels[0] * delivered) / Math.max(1, quest.goal))
}

export const bossMerit = () => merit().boss
export const storyMerit = () => merit().story

export interface PromotionStatus {
  rank: GuildRank
  merit: number
  next?: GuildRank
  /** 下一階需要的功績與等級 */
  needMerit?: number
  needLevel?: number
  /** 功績與等級都夠了：可以參加晉升考核 */
  eligible: boolean
}

export function promotionStatus(state: GameState): PromotionStatus {
  const g = guildOf(state)
  const next = nextRank(g.rank)
  if (!next) return { rank: g.rank, merit: g.merit, eligible: false }
  const info = rankInfo(next)
  const level = state.party.find((m) => m.isPlayer)?.level ?? 1
  return {
    rank: g.rank, merit: g.merit, next, needMerit: info.merit, needLevel: info.levels[0],
    eligible: g.merit >= info.merit && level >= info.levels[0],
  }
}

/** 接下的晉升考核（進行中或完成了、還沒交付的；同時只能接一個） */
export function examQuest(state: GameState): Quest | undefined {
  const id = guildOf(state).exam
  return id ? state.quests.find((q) => q.id === id && (q.status === 'accepted' || q.status === 'ready')) : undefined
}

/** 這座城的公會發出、還沒接的晉升考核（目前要考的階級） */
export function examOffer(state: GameState, location = state.location): Quest | undefined {
  const next = promotionStatus(state).next
  return state.quests.find((q) => isExam(q) && q.giver === location && q.rank === next && q.status === 'available')
}

/**
 * 在這座城的公會發晉升考核（符合資格、這裡還沒有時）：討伐階級相符的層主，優先找離這座城近的地下城；
 * 找不到時改成清剿階級最接近的某座地下城的某一層。
 * 冒險者的階級各地通用：每座城的公會各發一個（目標在各自附近），玩家選一個接；交付在任何一座公會都可以
 */
export function postExam(state: GameState): Quest | undefined {
  const status = promotionStatus(state)
  if (!status.eligible || !status.next) return undefined
  const here = examOffer(state) ?? state.quests.find((q) => isExam(q) && q.giver === state.location && q.rank === status.next && q.status !== 'completed')
  if (here) return here
  const target = status.next
  const want = RANK_ORDER.indexOf(target)
  const distance = (id: string) => shortestPath(state.location, id)?.days[1] ?? 999
  // 園區（主題地下城）不出考核：不能直接旅行到
  const bosses = Object.entries(dungeonEncounters).filter(([loc]) => !parkPlaza(loc)).flatMap(([loc, enc]) =>
    BOSS_LAYER_IDS.map((layer) => {
      const id = (enc.bosses?.[layer] ?? (layer === 'deep' ? enc.boss : undefined))?.[0]?.[0]
      return id && enemies[id] ? { loc, layer, id, gap: Math.abs(RANK_ORDER.indexOf(guildRankFor(enemies[id]!.level)) - want) } : undefined
    }).filter((b): b is { loc: string; layer: BossLayerId; id: string; gap: number } => !!b))
  bosses.sort((a, b) => a.gap - b.gap || distance(a.loc) - distance(b.loc))
  const reward = rewardRange(target)[0]
  const id = `exam-${target}-${state.time.day}-${state.nextReportNo}`
  const common = { id, rank: target, giver: state.location, progress: 0, reward_cc: reward, status: 'available' as const, flags: { exam: true } }
  const best = bosses[0]
  let quest: Quest
  if (best && best.gap <= 1) {
    quest = {
      ...common, kind: 'boss_hunt', area: 'dungeon', target: best.loc, goal: 1, layer: best.layer, monster: best.id,
      title: `晉升考核（${target} 級）：討伐${locationById(best.loc).name}的${enemies[best.id]!.name}`,
    }
  } else {
    // 沒有相符的層主：清剿階級最接近的某座地下城的某一層
    const layers = Object.keys(dungeonEncounters).filter((loc) => !parkPlaza(loc))
      .flatMap((loc) => layerRanks(loc).map((r) => ({ loc, layer: r.layer, gap: Math.abs(RANK_ORDER.indexOf(r.rank) - want) })))
      .sort((a, b) => a.gap - b.gap || distance(a.loc) - distance(b.loc))
    const pick = layers[0]
    if (!pick) return undefined
    quest = {
      ...common, kind: 'clear_dungeon', area: 'dungeon', target: pick.loc, layer: pick.layer, goal: merit().exam_clears,
      title: `晉升考核（${target} 級）：清剿${locationById(pick.loc).name}${layerName(pick.layer)}的魔物（${merit().exam_clears} 次）`,
    }
  }
  state.quests.push(quest)
  return quest
}

/** 接下晉升考核：同時只能接一個（換一個要先放棄原本的） */
export function acceptExam(state: GameState, quest: Quest) {
  const current = examQuest(state)
  if (current && current.id !== quest.id) throw new Error(`已經接了「${current.title}」，要換一個先放棄原本的考核`)
  guildOf(state).exam = quest.id
}

export const isExam = (q: Pick<Quest, 'flags'>) => !!q.flags?.exam

/** 委託清單的順序：晉升考核置頂，其他照原本的順序 */
export function examsFirst<T extends Pick<Quest, 'flags'>>(quests: T[]): T[] {
  return [...quests.filter(isExam), ...quests.filter((q) => !isExam(q))]
}

/** 功績寫進狀態（commitReport 時） */
export function addMerit(state: GameState, n: number) {
  if (!n) return
  guildOf(state).merit = Math.max(0, guildOf(state).merit + n)
}

/** 通過考核：升階（commitReport 時）；各地還沒接的舊考核撤下 */
export function applyRankUp(state: GameState, to: GuildRank) {
  const g = guildOf(state)
  if (RANK_ORDER.indexOf(to) > RANK_ORDER.indexOf(g.rank)) g.rank = to
  delete g.exam
  state.quests = state.quests.filter((q) => !(isExam(q) && q.status === 'available' && RANK_ORDER.indexOf(q.rank) <= RANK_ORDER.indexOf(g.rank)))
}

/** 放棄考核：之後回公會可以再考 */
export function dropExam(state: GameState, questId: string) {
  const g = guildOf(state)
  if (g.exam === questId) delete g.exam
}
