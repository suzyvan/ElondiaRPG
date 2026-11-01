// 城鎮行動：旅店休息、酒館招募、公會委託、補給、升級選技能。

import { tagsAllowed } from './content'
import { condMet } from './storyFlags'
import { checkBonus } from './perks'
import { abilityQuality, carryLearned, proficiency, rerollAbilityChoices, setCarried, snapshot } from './character'
import { setQuestDeadline } from './deadlines'
import { acceptExam, dropExam, examQuest, isExam, playerRank, postExam, promotionStatus, questMerit, questXp } from './guild'
import { startCombat, type CombatState } from './combat'
import {
  craftRules, abilityDef, attributeRules, combatRules, dungeonEncounters, economy, itemDef, landmarkDef, landmarksIn, locationById, npcs, regionById,
  townQuestsPerTown, townQuestsRefreshDays, townQuestTemplates, type NpcDef, type TownQuestTemplate,
} from './data'
import { roll, withBonus } from './rng'
import { isFugitive, joinParty, leaveParty, partyMax, partyRoom } from './party'
import { npcRecord } from './npcs'
import { clearQuestMarkers, landmarkHidden } from './grid'
import { innCost, longRest } from './rest'
import { applyEffects, type RewardEffect } from './effects'
import {
  canTurnIn, deliverable, isCollectQuest, isMaterialQuest, layerName, layerRanks, postDungeonQuests, postWildQuests, RANK_ORDER, rewardFor,
  rewardRange,
} from './materialQuests'
import { formatMoney } from './money'
import { addHours, commitReport, newReportId, player, withRng } from './state'
import type { GameState, GuildRank, Quest, Report } from './types'
import { shortestPath } from './world'
import { gameRule, rewardMoney } from './gameRules'
import { squadMates } from './squads'

export { INN_CC_PER_PERSON } from './rest'
export const RATION_CC = 5
/** 公會只發布這個天數內可到達的冒險區域委託 */
export const QUEST_RANGE_DAYS = 7


export function baseReport(state: GameState, kind: Report['kind'], hours: number): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = player(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind,
    time: { start, end: addHours(start, hours) },
    location: { at: state.location, region: loc.region, scene: loc.name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'success' },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

// ---- 旅店 ----

export function restCost(state: GameState): number {
  return innCost(state)
}

/** 在旅店住一晚（長休）：見 rest.ts。 */
export function rest(state: GameState): Report {
  return longRest(state, 'inn')
}

/** 逃亡奴隸身上的印記會被官方機構認出 */
function assertNotFugitive(state: GameState, place: string) {
  if (isFugitive(state)) throw new Error(`${place}的人認出了你身上的契約印記，拒絕接待`)
}

// ---- 神殿 ----

/** 神殿治療的費用：每位受傷的隊員 TEMPLE_CC（世界書：普通醫師診療 2 銀幣）。 */
export const TEMPLE_CC = 20

export function templeCost(state: GameState): number {
  return state.party.filter((m) => m.hp < m.maxHp).length * TEMPLE_CC
}

/** 在神殿接受治療：受傷的隊員 HP 回滿，不推進到隔天，也不回復法術環。 */
export function templeHeal(state: GameState): Report {
  assertNotFugitive(state, '神殿')
  const cost = templeCost(state)
  if (cost === 0) throw new Error('沒有需要治療的隊員')
  if (state.money_cc < cost) throw new Error('金錢不足')
  const report = baseReport(state, 'action', 1)
  report.location.scene = `${locationById(state.location).name}的神殿`
  report.party = state.party.map((m) => {
    const snap = snapshot(m, undefined, player(state))
    snap.hp = [m.hp, m.maxHp, m.maxHp]
    return snap
  })
  report.outcome.summary = `在神殿接受治療，奉獻 ${formatMoney(cost)}。`
  report.changes.money_cc = -cost
  report.narration = { pov: 'second_person', length: 'short' }
  return commitReport(state, report)
}

// ---- 補給 ----

export function buyRations(state: GameState, qty: number): Report {
  // 價格跟著目錄（自訂內容可能改過乾糧的價格；不然低買高賣）
  const cost = (itemDef('乾糧')?.price_cc ?? RATION_CC) * qty
  if (qty <= 0) throw new Error('數量錯誤')
  if (state.money_cc < cost) throw new Error('金錢不足')
  const report = baseReport(state, 'trade', 0.5)
  report.outcome.summary = `購買乾糧 ${qty} 份，花費 ${formatMoney(cost)}。`
  report.changes = { money_cc: -cost, items_gained: [{ name: '乾糧', qty }] }
  report.narration = { length: 'short' }
  return commitReport(state, report)
}

// ---- 酒館招募 ----

/** 這座城鎮的具名 NPC（data/world/npcs.json），不含隊伍裡的 */
export function recruitableHere(state: GameState): NpcDef[] {
  const inParty = new Set(state.party.map((m) => m.id))
  return npcs.filter((n) => !inParty.has(n.id) && !n.unhireable && (npcRecord(state, n.id)?.location ?? n.location) === state.location)
}

/** 以要價雇用具名 NPC（酒館候選名單另見 companions.ts）。 */
export function recruit(state: GameState, npcId: string): Report {
  const def = recruitableHere(state).find((n) => n.id === npcId)
  if (!def) throw new Error('這裡沒有這位角色')
  if (partyRoom(state) < 1) throw new Error(`隊伍最多 ${partyMax(state)} 人`)
  if (state.money_cc < def.hire_cc) throw new Error('招募費用不足')
  const report = baseReport(state, 'social', 1)
  const met = !!state.relationships?.[npcId]
  const npc = joinParty(state, npcRecord(state, npcId)!, 'hired', report, { reason: met ? '再次同行' : '初次結識' })
  report.location.scene = `${locationById(state.location).name}的酒館`
  report.outcome.summary = `在酒館招募了${npc.name}加入隊伍，支付 ${formatMoney(def.hire_cc)}。`
  report.changes.money_cc = -def.hire_cc
  report.changes.affinity = [{ npc: npc.id, delta: 0, after: npc.affinity ?? 0, reason: met ? '再次同行' : '初次結識' }]
  report.narration = { pov: 'second_person', length: 'short', focus: [`${npc.name}的第一印象與性格`] }
  report.lore_keys!.push(attributeRules.races[npc.race]?.name ?? npc.race)
  return commitReport(state, report)
}

/** 請同伴離隊。跟著的隊伍不能「請走」（要在休息時自己離開），奴隸要先解除契約。 */
export function dismiss(state: GameState, npcId: string): Report {
  const npc = state.party.find((m) => m.id === npcId && !m.isPlayer)
  if (!npc) throw new Error('隊伍中沒有這位角色')
  if (npc.bond === 'leader' || npc.group) throw new Error('這是你跟著的隊伍；要離開請在休息時離隊')
  if (npc.bond === 'slave') throw new Error('奴隸不能遣散，請先解除契約')
  if (npc.bond === 'guest') throw new Error('任務同行的夥伴會在任務的進展中離開')
  const report = baseReport(state, 'social', 0.5)
  // 整隊入隊的小隊：整隊一起離開
  const group = [npc, ...squadMates(state, npc).filter((m) => m !== npc)]
  for (const m of group) leaveParty(state, m.id, report, m === npc ? '遣散' : `跟著${npc.name}離開`)
  report.outcome.summary = `${group.map((m) => m.name).join('、')}離開了隊伍。`
  report.outcome.tags = ['離隊']
  // 入隊沒多久就遣散：對方覺得被利用，消息傳開，這座城的物價上漲一陣子
  const pen = craftRules.dismiss_penalty
  if (npc.joined && hoursBetween(npc.joined, state.time) < pen.days * 24) {
    for (const m of group) {
      const rel = state.relationships?.[m.id]
      if (!rel) continue
      const after = Math.max(-100, rel.affinity + pen.affinity)
      ;(report.changes.affinity ??= []).push({ npc: m.id, delta: after - rel.affinity, after, reason: '才入隊沒多久就被遣散' })
    }
    state.flags[`notoriety:${state.location}`] = state.time.day + pen.notoriety_days
    report.outcome.summary += `才入隊沒幾天就被遣散，${group.map((m) => m.name).join('、')}覺得被利用了；這件事在${locationById(state.location).name}傳開，商店對你的開價高了一些。`
    report.outcome.tags.push('用完就丟')
  }
  return commitReport(state, report)
}

function hoursBetween(a: { day: number; hour?: number }, b: { day: number; hour?: number }): number {
  return (b.day - a.day) * 24 + (b.hour ?? 0) - (a.hour ?? 0)
}

// ---- 冒險者公會 ----

function townText(text: string, townId: string): string {
  return text.split('{town}').join(locationById(townId).name)
}

export function questTemplate(quest: Quest): TownQuestTemplate | undefined {
  return quest.template ? townQuestTemplates[quest.template] : undefined
}

/** 城內委託的執行地點：地標（還在的話），否則是範本的設施 */
export function questSpot(quest: Quest): string {
  if (quest.landmark && landmarkDef(quest.landmark)) return quest.landmark
  return questTemplate(quest)?.spot ?? 'guild'
}

/** 委託的場景：{town} 換成城鎮，{landmark} 換成地標的名字 */
export function questScene(quest: Quest): string {
  const tpl = questTemplate(quest)
  const name = (quest.landmark && landmarkDef(quest.landmark)?.name) || '城裡'
  return townText(tpl?.scene ?? '{town}', quest.target).split('{landmark}').join(name)
}

/** 這座城裡符合類型的地標（還沒出現的除外） */
function landmarksFor(state: GameState, townId: string, types: string[]) {
  // 成人向的場所（解鎖的特殊區域）不當委託地點
  return landmarksIn(townId).filter((l) => l.types.some((t) => types.includes(t)) && !l.open?.adult && !landmarkHidden(state, l))
}

export function canAcceptRank(state: GameState, rank: GuildRank, quest?: Pick<Quest, 'flags'>): boolean {
  // 晉升考核本來就是下一階的委託
  if (quest && isExam(quest)) return true
  const mine = RANK_ORDER.indexOf(playerRank(state))
  const target = RANK_ORDER.indexOf(rank)
  // 只能接同級或更低；組隊時可接高一級
  return target <= mine || (state.party.length > 1 && target === mine + 1)
}

/**
 * 公會委託列表；若這座城鎮沒有可接的委託就產生新的：
 * F 級城內／近郊委託若干個、近郊的採集與掉落委託，加上附近每個冒險區域各一個 E 級以上的清剿委託，
 * 再挑幾座地下城發採集、掉落或討伐層主的委託（materialQuests.ts）。
 */
/** 這座城的委託板：這裡發的委託，加上在別的公會接的晉升考核（階級各地通用，在這裡也能交付） */
function boardQuests(state: GameState): Quest[] {
  const exam = examQuest(state)
  return state.quests.filter((q) => (q.giver === state.location || q === exam) && q.status !== 'completed')
}

export function guildQuests(state: GameState): Quest[] {
  if (locationById(state.location).type === 'dungeon') return []
  const boardKey = `guild_board:${state.location}`
  const posted = Number(state.flags[boardKey] ?? 0)
  // 功績與等級夠了：公會發晉升考核（不會被委託板的更新撤下）
  postExam(state)
  if (posted && state.time.day - posted < townQuestsRefreshDays) {
    return boardQuests(state)
  }
  // 委託板更新：沒人接的舊委託撤下（談過報酬與晉升考核的保留），談到一半的談判也一併結束
  const expired = new Set(
    state.quests.filter((q) => q.giver === state.location && q.status === 'available' && q.flags?.negotiated === undefined && !isExam(q)).map((q) => q.id),
  )
  state.quests = state.quests.filter((q) => !expired.has(q.id))
  for (const n of state.negotiations ?? []) if (n.quest && expired.has(n.quest)) n.status = 'done'
  state.flags[boardKey] = state.time.day
  withRng(state, (rng) => {
    // 以地標為標的的範本：城裡要有符合類型的地標
    // 有條件的範本（成人向的委託要曝露名聲或淫亂）：條件成立、內容篩選允許才發布
    const pool = Object.values(townQuestTemplates).filter((t) => (!t.landmark || landmarksFor(state, state.location, t.landmark).length)
      && condMet(state, t.requires) && tagsAllowed(t.tags))
    for (let i = 0; i < townQuestsPerTown && pool.length > 0; i++) {
      const tpl = pool.splice(rng.int(0, pool.length - 1), 1)[0]!
      const lm = tpl.landmark ? rng.pick(landmarksFor(state, state.location, tpl.landmark)) : undefined
      state.quests.push({
        id: `q-${state.location}-${state.time.day}-${tpl.id}`,
        title: townText(tpl.title, state.location).split('{landmark}').join(lm?.name ?? ''),
        rank: 'F', kind: tpl.kind, area: tpl.area, template: tpl.id,
        ...(lm ? { landmark: lm.id } : {}),
        giver: state.location, target: state.location, goal: 1, progress: 0,
        reward_cc: rng.int(tpl.reward_cc[0], tpl.reward_cc[1]),
        status: 'available',
      })
    }
    const targets = Object.keys(dungeonEncounters).filter((id) => {
      const path = shortestPath(state.location, id)
      return path !== null && path.days[1] <= QUEST_RANGE_DAYS
    })
    // 清剿委託指定一層：階級看那一層的怪物（layerRank），在那一層或更深處獲勝都算
    for (const target of targets) {
      const layers = layerRanks(target)
      if (!layers.length) continue
      const { layer, rank } = rng.pick(layers)
      const goal = rng.int(1, 3)
      const [lo, hi] = rewardRange(rank)
      state.quests.push({
        id: `q-${state.location}-${state.time.day}-${target}`,
        title: `清剿${locationById(target).name}${layerName(layer)}的魔物（${goal} 次）`,
        rank, kind: 'clear_dungeon', area: 'dungeon', layer,
        giver: state.location, target, goal, progress: 0,
        reward_cc: Math.round(rng.int(lo, hi) * (1 + (goal - 1) * 0.5)),
        status: 'available',
      })
    }
    state.quests.push(...postWildQuests(state, rng), ...postDungeonQuests(state, rng, targets))
  })
  return boardQuests(state)
}

export function acceptQuest(state: GameState, questId: string): Report {
  assertNotFugitive(state, '公會')
  const quest = state.quests.find((q) => q.id === questId && q.status === 'available')
  if (!quest) throw new Error('找不到這個委託')
  if (!canAcceptRank(state, quest.rank, quest)) throw new Error('公會階級不足，無法接取')
  if (isExam(quest)) acceptExam(state, quest)
  quest.status = 'accepted'
  setQuestDeadline(state, quest)
  const report = baseReport(state, 'quest', 0.5)
  report.location.scene = `${locationById(state.location).name}的冒險者公會`
  report.quest = { id: quest.id, title: quest.title, rank: quest.rank, status: 'accepted' }
  report.outcome.summary = `接下 ${quest.rank} 級委託「${quest.title}」，報酬 ${formatMoney(quest.reward_cc)}${quest.deadline ? `，期限到第 ${quest.deadline.day} 天 ${quest.deadline.hour} 時` : ''}。`
  report.lore_keys!.push(locationById(quest.target).name, '冒險者公會')
  return commitReport(state, report)
}

/**
 * 執行城內／近郊委託。戰鬥類委託（或檢定前遭遇敵人）會開始戰鬥並回傳戰鬥狀態，
 * 戰報在戰鬥結束後產生；其餘直接產生委託報告。
 */
export function doTownQuest(state: GameState, questId: string, intent?: string): Report | CombatState {
  const quest = state.quests.find((q) => q.id === questId && q.status === 'accepted')
  const tpl = quest && questTemplate(quest)
  if (!quest || !tpl) throw new Error('找不到這個委託')
  if (quest.giver !== state.location) throw new Error(`這是${locationById(quest.giver).name}的委託`)
  const scene = questScene(quest)

  if (tpl.kind === 'pest' || tpl.kind === 'hunt') {
    return startCombat(state, tpl.encounter, { questId: quest.id, scene, ...(intent ? { intent } : {}) })
  }
  const ambushed = tpl.encounter && withRng(state, (rng) => rng.chance(tpl.encounter_chance ?? 0))
  if (ambushed) {
    // 遭遇戰打贏就算完成委託（找到東西、趕跑了搗亂的人）；打輸可以再試一次
    return startCombat(state, tpl.encounter, { questId: quest.id, scene, ...(intent ? { intent } : {}) })
  }

  const report = baseReport(state, 'quest', tpl.hours)
  report.location.scene = scene
  report.quest = { id: quest.id, title: quest.title, rank: quest.rank, status: 'progress' }
  report.narration = { pov: 'second_person', length: 'short', ...(intent ? { player_intent: intent } : {}) }
  let success = true
  // 檢定最多失敗一次：上次失敗摸清了門路，這次一定成功
  const retried = !!quest.flags?.failed_once
  if (tpl.dc !== undefined && !retried) {
    const pc = player(state)
    // 任務旗標：打聽到線索 +5，消息走漏 -2
    const bonus = (quest.flags?.lead ? 5 : 0) + checkBonus(pc, { context: 'quest' })
    const dice = withBonus('1d20', proficiency(pc.level) + bonus)
    const r = withRng(state, (rng) => roll(rng, dice))
    success = r.total >= tpl.dc
    report.timeline = [{
      seq: 1, time: report.time.start, actor: pc.id, action: quest.title,
      roll: { dice, value: r.total, dc: tpl.dc }, result: success ? 'success' : 'fail',
    }]
  }
  if (success) {
    quest.progress = quest.goal
    quest.status = 'ready'
    clearQuestMarkers(state)
    if (tpl.item) report.changes.items_gained = [{ name: tpl.item, qty: tpl.qty ?? 1, owner: 'pc' }]
    report.outcome = { result: 'success', summary: `${retried ? '上次摸清了門路，這次順利' : ''}完成「${quest.title}」，可以回公會交付了。` }
  } else {
    quest.flags = { ...(quest.flags ?? {}), failed_once: true }
    report.outcome = { result: 'failure', summary: `「${quest.title}」這次沒有進展，花了 ${tpl.hours} 小時；摸清了門路，下次一定能完成。` }
  }
  return commitReport(state, report)
}

/**
 * 交付委託。材料委託交 count 份（預設：能交的全部，不超過上限），討伐委託依打倒的次數；
 * 超過要求的部分依比例增加報酬。
 */
export function turnInQuest(state: GameState, questId: string, count?: number): Report {
  assertNotFugitive(state, '公會')
  const quest = state.quests.find((q) => q.id === questId && canTurnIn(state, q))
  if (!quest) throw new Error('委託尚未完成')
  // 晉升考核：階級各地通用，在任何一座公會都可以交付
  if (quest.giver !== state.location && !isExam(quest)) throw new Error(`請回到${locationById(quest.giver).name}交付`)
  const material = isMaterialQuest(quest)
  const most = material ? deliverable(state, quest) : quest.goal
  const n = material ? Math.max(quest.goal, Math.min(most, Math.round(count ?? most))) : quest.goal
  if (material && n > most) throw new Error('數量不夠')
  const pay = rewardMoney(state, material ? rewardFor(quest, n) : quest.reward_cc)
  quest.status = 'completed'
  if (material) quest.delivered = n
  const report = baseReport(state, 'quest', 0.5)
  report.location.scene = `${locationById(state.location).name}的冒險者公會`
  report.quest = { id: quest.id, title: quest.title, rank: quest.rank, status: 'completed' }
  const extra = n > quest.goal ? `（多交了 ${n - quest.goal} ${isCollectQuest(quest) ? '份' : '次'}）` : ''
  report.outcome.summary = `交付委託「${quest.title}」${extra}，獲得報酬 ${formatMoney(pay)}。`
  const tpl = questTemplate(quest)
  // 報酬模板：金錢、聲望、交付物品，加上範本額外的報酬（物品、親密度、夥伴……）
  const effects: RewardEffect[] = [
    { type: 'money', amount: pay },
    ...(isCollectQuest(quest) && quest.item ? [{ type: 'item' as const, name: quest.item, qty: -n }] : []),
    { type: 'reputation', faction: 'guild', delta: RANK_ORDER.indexOf(quest.rank) + 1 },
    ...(tpl?.item ? [{ type: 'item' as const, name: tpl.item, qty: -(tpl.qty ?? 1) }] : []),
    ...(tpl?.rewards ?? []),
  ]
  // 不用打怪的委託（送貨、尋物、採集……）給經驗；打怪的委託已經有戰鬥經驗
  const xp = questXp(quest, n)
  if (xp > 0) effects.push({ type: 'xp', amount: xp })
  const notes = applyEffects(state, report, effects)
  if (notes.length) report.outcome.summary += notes.join('；')
  if (isExam(quest)) {
    // 通過晉升考核：升階
    const from = playerRank(state)
    report.changes.rank_up = { from, to: quest.rank }
    report.outcome.summary += `通過晉升考核，成為 ${quest.rank} 級冒險者。`
    report.outcome.tags = [...(report.outcome.tags ?? []), '晉升']
  } else {
    report.changes.merit = questMerit(quest.rank)
    report.outcome.summary += `公會功績 +${report.changes.merit}。`
  }
  report.lore_keys!.push('冒險者公會')
  const committed = commitReport(state, report)
  if (!isExam(quest) && promotionStatus(state).eligible && !examQuest(state)) {
    committed.outcome.summary += `功績已經足夠，公會願意讓你參加 ${promotionStatus(state).next} 級的晉升考核（各城鎮的公會都有，挑方便的一個接）。`
  }
  return committed
}

/**
 * 放棄接下的委託（在哪裡都可以）：委託從清單拿掉，公會聲望 -1。
 * 目標怪物或物品被自訂內容刪掉時，這是唯一能脫身的辦法。
 */
export function abandonQuest(state: GameState, questId: string): Report {
  if (state.combat) throw new Error('戰鬥中不能這麼做')
  const quest = state.quests.find((q) => q.id === questId && (q.status === 'accepted' || q.status === 'ready'))
  if (!quest) throw new Error('沒有進行中的這個委託')
  state.quests = state.quests.filter((q) => q !== quest)
  dropExam(state, quest.id)
  const report = baseReport(state, 'quest', 0)
  report.quest = { id: quest.id, title: quest.title, rank: quest.rank, status: 'abandoned' }
  report.outcome = { result: 'neutral', summary: `放棄了委託「${quest.title}」，公會對你的評價稍微下降。`, tags: ['放棄委託'] }
  report.changes.reputation = [{ faction: 'guild', delta: -1 }]
  report.narration = { length: 'short' }
  report.lore_keys!.push('冒險者公會')
  return commitReport(state, report)
}

// ---- 升級 ----

/** 學會新能力時攜帶已滿的提示 */
export const LIBRARY_NOTE = '攜帶的技能已滿，先放進技能庫（角色詳情的「能力」頁可以替換）。'

/** 把學會的技能或法術帶上，或放回技能庫（存檔規則 skillLoadout；戰鬥中不能換） */
export function setAbilityCarried(state: GameState, memberId: string, abilityId: string, on: boolean) {
  if (state.combat) throw new Error('戰鬥中不能更換攜帶的技能')
  const member = state.party.find((m) => m.id === memberId)
  if (!member) throw new Error('隊伍中沒有這位角色')
  setCarried(member, abilityId, on, gameRule(state, 'skillLoadout'))
}

/** 重抽升級時的能力選項（不推進時間，也不產生報告） */
export function rerollAbility(state: GameState, memberId: string, max?: number): string[] {
  const member = state.party.find((m) => m.id === memberId)
  if (!member) throw new Error('隊伍中沒有這位角色')
  return withRng(state, (rng) => rerollAbilityChoices(member, rng, max))
}

export function chooseAbility(state: GameState, memberId: string, abilityId: string): Report {
  const member = state.party.find((m) => m.id === memberId)
  const choices = member?.pendingAbilityChoices?.[0]
  if (!member || !choices?.includes(abilityId)) throw new Error('沒有這個能力選項')
  member.pendingAbilityChoices!.shift()
  delete member.abilityRerollsUsed
  if (member.pendingAbilityChoices!.length === 0) delete member.pendingAbilityChoices
  member.abilities.push(abilityId)
  const carried = carryLearned(member, abilityId, gameRule(state, 'skillLoadout'))
  const a = abilityDef(abilityId)
  const report = baseReport(state, 'action', 0)
  const kind = a.type === 'spell' ? `${a.circle} 環法術` : a.type === 'cantrip' ? '戲法' : '技能'
  report.outcome.summary = `${member.name}習得${kind}【${a.name}】。${carried ? '' : LIBRARY_NOTE}`
  report.changes.skills_gained = [{ actor: member.id, skill: a.name, quality: abilityQuality(a), source: 'level_up' }]
  report.narration = { length: 'short' }
  return commitReport(state, report)
}
