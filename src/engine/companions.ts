// 新增夥伴的五種方式與主角的奴隸身分。說明見 docs/COMPANIONS.md。
//
// 1. 酒館雇傭：候選名單受魅力、等級影響；玩家可自訂出價與談判方式，出價的權重最高，也可能免費雇到人。
// 2. 加入隊伍：在酒館等待別的隊伍邀請（或由事件邀請），魅力與等級加權，對方可能付錢給主角。
// 3. 買入奴隸：公開或不公開（黑市）的奴隸市場，主要看價格；殺價、魅惑等主動行動會影響價格。
// 4. 作為奴隸：主角在市場登記出售自己，被別人買入隊伍；主要看魅力與等級，很難主動影響。
// 5. 事件入隊：事件報酬（效果 companion，自願或奴隸），或主動邀請認識的人（需要親密度與魅力檢定）。
//
// 需要檢定的部分（雇傭談判、殺價、邀請、打聽地下街、談判解除契約、逃離）走主動行動（actions.ts），
// 這裡提供參考 DC、各成功程度的機制結果，以及套用結果的函式。

import { pcTagMult } from './pcTags'
import { setupPitch, setupTrain } from './perkActions'
import { setupLeave } from './masterHome'
import { applyRosterProposal, rosterBlocked, rosterDc, rosterOutcomes, rosterScene, ROSTER_KINDS, type RosterKind } from './masterRoster'
import type { AdultScene } from './content'
import { setupCraft, setupMake } from './craft'
import { setupProduce } from './recipes'
import { setupInvent } from './invention'
import { isShopStaff } from './crafting'
import { setupStoryCheck } from './story'
import { setupDefeatEvent } from './defeat'
import { attrOf, lifeTier, mod, snapshot } from './character'
import {
  actionRules, combatRules, companionRules, contractDef, itemDef, itemRules, locationById, npcPool, npcs as namedNpcs, regionById, slaveryRules, lewdRules,
  tagDcMod, tagDef, type ActionKind, type AttrId, type CheckContext, type SkillId, type Degree, type MarketDef, type NpcKind,
} from './data'
import type { Rng } from './rng'
import { formatMoney } from './money'
import { generateNpc, npcRecord, slavePrice, weightedPick } from './npcs'
import { hireable, isUnhireable, presentHere } from './population'
import { setupStandoff } from './encounters'
import {
  atSafeSpot, contractTerms, masterNearby, remarkByMadam, setupMarking, setupExtend, setupMasterEvent, setupPermit, setupReturn, setupSeekMaster, setupUnmark, startMarking, termsFromTemplate, contractKind,
  type MarkChoice,
} from './slavery'
import { setupInteraction } from './interactions'
import { setupUnbind } from './restraints'
import {
  addAffinity, assertFree, enslavePlayer, freePlayer, freeSlave, changeMaster, isBound, isEnslaved, isFugitive, joinParty,
  followRoom, leaderOf, partyMax, partyRoom, pcOf, playerEscapes, punish, recapturePlayer, removeCondition, setHp,
} from './party'
import { negotiationSetup } from './negotiation'
import { setupPatron } from './brothel'
import { setupResign } from './resign'
import { setupWork } from './work'
import { setupExplore } from './landmarks'
import { currentArea, currentCell, palaceGateName } from './grid'
import { assertMayPersuadePalace, palacePersuadeDc, settlePalacePersuasion } from './security'
import { ensureRelationship } from './social'
import { bargainSetup } from './trade'
import { addHours, commitReport, masterTake, newReportId, withRng } from './state'
import type { Character, CurioListing, GameState, MarkTerms, NpcRecord, PartyOffer, Report, SlaveListing, TavernCandidate } from './types'
import { contractOf, placeName } from './tattoos'
import { lewdPowerOf, npcLewd, slaveValueMult, slaveValueOf } from './lewd'
import { sexValueOf } from './sexRecord'
import { gameRule, parasiteLuresOn } from './gameRules'
import { tagsAllowed } from './content'
import { lureTemplate } from './dungeonEvents'
import { blackMarketHere, underworldAskBlocked, underworldEscorted, underworldEscortFlag, underworldFlag, underworldLandmarks, underworldOf } from './underworld'
import { inActiveSquad, squadActive, squadIds, squadJoinDc, squadMissing, squads, squadWithLeader, type Squad } from './squads'
import { setupStaffInvite } from './staff'
import { setupCohabitInvite } from './cohabit'

function socialReport(state: GameState, hours: number, scene: string, kind: Report['kind'] = 'social'): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind,
    time: { start, end: addHours(start, hours) },
    location: { at: state.location, region: loc.region, scene },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'success' },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

function tavernScene(state: GameState) {
  return `${locationById(state.location).name}的酒館`
}

// ---- 1. 酒館雇傭 ----

/** 今天這座城鎮酒館的候選人（第一次查看時生成）。 */
export function tavernCandidates(state: GameState): TavernCandidate[] {
  const loc = state.location
  const today = state.time.day
  const taverns = (state.taverns ??= {})
  const existing = taverns[loc]?.day === today ? taverns[loc]!.candidates : []
  // 今天在城裡的冒險者（名單上的人與具名 NPC），保留今天談判過的狀態（拒絕、還價）
  const candidates = hireable(state).map((rec) => existing.find((c) => c.npc === rec.id) ?? { npc: rec.id, asking_cc: rec.hire_cc })
  // 名單沒變就不寫回存檔：畫面算 DC 時也會呼叫這裡（向主人提議雇人的參考 DC），每次都寫一個新物件會讓畫面一直重畫、卡死
  if (taverns[loc]?.day === today && candidates.length === existing.length && candidates.every((c, i) => c === existing[i])) return existing
  taverns[loc] = { day: today, candidates, ...(taverns[loc]?.day === today && taverns[loc]?.flavored ? { flavored: true } : {}) }
  return candidates
}

export function candidate(state: GameState, npcId: string): TavernCandidate {
  const c = tavernCandidates(state).find((x) => x.npc === npcId)
  if (!c) throw new Error('酒館裡沒有這位冒險者')
  return c
}

/** 要價：部分成功後的還價優先 */
export function askingFor(c: TavernCandidate): number {
  return c.counter_cc ?? c.asking_cc
}

/** 雇傭談判的參考 DC：出價越低越難，對方等級比主角高也更難。 */
export function hireDc(state: GameState, npcId: string, offer: number): number {
  const c = candidate(state, npcId)
  const rec = npcRecord(state, npcId)!
  const h = companionRules.tavern.hire
  const asking = askingFor(c)
  const ratio = asking > 0 ? Math.max(0, Math.min(1, offer / asking)) : 1
  const dc = h.base + Math.ceil(h.fee_weight * (1 - ratio)) + h.level_gap * Math.max(0, rec.level - pcOf(state).level) + tagDcMod(rec, 'hire')
  return Math.max(h.min, Math.min(h.max, dc))
}

function assertCanHire(state: GameState, npcId: string, offer: number) {
  assertFree(state, '雇人')
  if (isUnhireable(npcId)) throw new Error('對方不會受雇於人')
  if (state.captives?.npcs.includes(npcId)) throw new Error('對方被你制伏在地上，先決定怎麼處置')
  const c = candidate(state, npcId)
  if (c.declined) throw new Error('對方今天不想再談了')
  if (partyRoom(state) < 1) throw new Error(`隊伍最多 ${partyMax(state)} 人`)
  if (offer < 0 || !Number.isFinite(offer)) throw new Error('出價錯誤')
  if (state.money_cc < offer) throw new Error('錢不夠')
}

/** 出價不低於要價：直接成交，不需檢定。 */
export function hireAtAsking(state: GameState, npcId: string, offer?: number): Report {
  const c = candidate(state, npcId)
  const fee = offer ?? askingFor(c)
  assertCanHire(state, npcId, fee)
  if (fee < askingFor(c)) throw new Error('出價低於要價，需要談判')
  const rec = npcRecord(state, npcId)!
  const report = socialReport(state, 1, tavernScene(state))
  joinParty(state, rec, 'hired', report, { reason: '雇傭' })
  report.changes.money_cc = -fee
  report.outcome.summary = `在酒館雇用了${rec.name}，支付 ${formatMoney(fee)}。`
  report.narration = { pov: 'second_person', length: 'short', focus: [`${rec.name}的第一印象與性格`] }
  return commitReport(state, report)
}

export function validateHire(state: GameState, npcId: string, offer: number) {
  assertCanHire(state, npcId, offer)
}

/** 雇傭談判的結果：成功以出價成交；部分成功對方還價；失敗今天不再談。 */
export function applyHire(state: GameState, report: Report, npcId: string, offer: number, degree: Degree): string {
  const c = candidate(state, npcId)
  const rec = npcRecord(state, npcId)!
  // 談過話就算認識了
  ensureRelationship(state, rec)
  switch (degree) {
    case 'critical':
    case 'success':
      if (state.money_cc < offer) return `${rec.name}答應了，但你已經付不出 ${formatMoney(offer)}。`
      joinParty(state, rec, 'hired', report, { reason: offer === 0 ? '免費同行' : '談判雇傭' })
      if (offer > 0) report.changes.money_cc = (report.changes.money_cc ?? 0) - offer
      if (degree === 'critical') addAffinity(state, report, npcId, 5, '談得很投機')
      return offer > 0 ? `${rec.name}接受了 ${formatMoney(offer)} 的報酬，加入隊伍。` : `${rec.name}答應不收錢同行。`
    case 'partial': {
      const counter = Math.max(offer, Math.round((offer + askingFor(c)) / 2 / 5) * 5)
      c.counter_cc = counter
      return `${rec.name}沒有答應，但願意以 ${formatMoney(counter)} 成交。`
    }
    case 'fail':
      c.declined = true
      addAffinity(state, report, npcId, -3, '出價太低')
      return `${rec.name}婉拒了，今天不想再談。`
    case 'fumble':
      c.declined = true
      addAffinity(state, report, npcId, -8, '覺得被羞辱')
      return `${rec.name}覺得被羞辱，冷著臉走開了。`
  }
}

// ---- 2. 加入別人的隊伍 ----

/** 等待組隊的機率 */
export function waitChance(state: GameState): number {
  const w = companionRules.wait_party
  const pc = pcOf(state)
  return Math.max(0.05, Math.min(w.max, w.base + w.per_cha_mod * mod(attrOf(pc, 'cha')) + w.per_level * pc.level))
}

export function partyOffersHere(state: GameState): PartyOffer[] {
  return (state.partyOffers ?? []).filter((o) => o.location === state.location && o.day === state.time.day)
}

/** 在酒館等別的隊伍來邀請。 */
export function waitForParty(state: GameState): Report {
  assertFree(state, '自己找隊伍')
  if (leaderOf(state)) throw new Error('你已經在別人的隊伍裡了')
  if (followRoom(state) < 1) throw new Error('隊伍已滿，沒有人能帶上你們')
  const w = companionRules.wait_party
  const pc = pcOf(state)
  const report = socialReport(state, w.hours, tavernScene(state))
  const offer = withRng(state, (rng): PartyOffer | null => {
    if (!rng.chance(waitChance(state))) return null
    const level = Math.min(20, pc.level + rng.int(w.leader_level[0], w.leader_level[1]))
    const leader = generateNpc(state, rng, { level }, 'pty')
    const memberCount = rng.int(0, Math.max(0, Math.min(2, followRoom(state) - 1)))
    const members = Array.from({ length: memberCount }, () => generateNpc(state, rng, { level: Math.max(1, level - rng.int(0, 2)) }, 'pty'))
    const payChance = w.pay_chance + w.pay_chance_per_cha_mod * Math.max(0, mod(attrOf(pc, 'cha')))
    const pay = rng.chance(payChance) ? Math.round((w.pay_per_level * pc.level * (1 + Math.max(0, mod(attrOf(pc, 'cha'))) * 0.25)) / 5) * 5 : 0
    // 邀請在等完的那一天有效（等到跨過午夜時，記開始那天會一出現就失效）
    return { id: `po-${leader.id}`, leader: leader.id, members: members.map((m) => m.id), pay_cc: pay, location: state.location, day: report.time.end.day }
  })
  if (offer) {
    ;(state.partyOffers ??= []).push(offer)
    const leader = npcRecord(state, offer.leader)!
    report.others = [leader, ...offer.members.map((id) => npcRecord(state, id)!)].map((r) => ({ id: r.id, name: r.name, race: r.race, class: r.class, level: r.level, personality: r.personality }))
    report.outcome.summary = `在酒館等了 ${w.hours} 小時，${leader.name}的隊伍${offer.members.length ? `（${offer.members.length + 1} 人）` : ''}邀請你同行${offer.pay_cc ? `，願意付 ${formatMoney(offer.pay_cc)}` : ''}。`
  } else {
    report.outcome = { result: 'neutral', summary: `在酒館等了 ${w.hours} 小時，沒有隊伍來搭話。` }
  }
  return commitReport(state, report)
}

export function acceptPartyOffer(state: GameState, offerId: string): Report {
  assertFree(state, '自己找隊伍')
  const offer = partyOffersHere(state).find((o) => o.id === offerId)
  if (!offer) throw new Error('邀請已經失效')
  if (leaderOf(state)) throw new Error('你已經在別人的隊伍裡了')
  if (followRoom(state) < 1 + offer.members.length) throw new Error('隊伍人數太多，對方帶不下')
  const leader = npcRecord(state, offer.leader)!
  const report = socialReport(state, 0.5, tavernScene(state))
  joinParty(state, leader, 'leader', report, { group: leader.id, reason: '邀請主角同行' })
  for (const id of offer.members) joinParty(state, npcRecord(state, id)!, 'ally', report, { group: leader.id })
  if (offer.pay_cc) report.changes.money_cc = offer.pay_cc
  state.partyOffers = (state.partyOffers ?? []).filter((o) => o.id !== offerId)
  report.outcome.summary = `加入了${leader.name}的隊伍${offer.pay_cc ? `，收下 ${formatMoney(offer.pay_cc)}` : ''}。`
  report.narration = { pov: 'second_person', length: 'short', focus: [`${leader.name}與隊員的第一印象`] }
  return commitReport(state, report)
}

export function declinePartyOffer(state: GameState, offerId: string) {
  state.partyOffers = (state.partyOffers ?? []).filter((o) => o.id !== offerId)
}

/** 主角打算離開別人的隊伍：在下一次休息時進行。 */
export function requestLeave(state: GameState, mode: 'sneak' | 'formal' | null) {
  if (mode === null) {
    delete state.pendingLeave
    return
  }
  if (isBound(state)) throw new Error('身為奴隸，不能自行離隊；只能談判或逃離')
  if (!leaderOf(state)) throw new Error('你沒有跟著別人的隊伍')
  state.pendingLeave = { mode }
}

// ---- 5. 邀請認識的人 ----

/** 可以邀請的人：認識、不在隊伍、親密度足夠、今天人就在這座城鎮。小隊只能透過隊長整隊邀請 */
export function invitable(state: GameState): NpcRecord[] {
  return Object.values(state.relationships ?? {})
    .filter((r) => !inviteRefusal(state, r.id))
    .map((r) => npcRecord(state, r.id))
    .filter((rec): rec is NpcRecord => !!rec)
    .filter((rec) => {
      const sq = inActiveSquad(state, rec.id)
      return !sq || sq.leader === rec.id
    })
}

/** 這個人現在不能邀請的原因（可以時為 undefined；小隊與隊伍空位另外看，見 validateInvite） */
export function inviteRefusal(state: GameState, npcId: string): string | undefined {
  const rec = npcRecord(state, npcId)
  const rel = state.relationships?.[npcId]
  if (!rec || !rel) return '你不認識這個人'
  const min = companionRules.invite.min_affinity
  if (state.party.some((m) => m.id === npcId)) return `${rec.name}已經在隊伍裡了`
  if (rec.dead) return `${rec.name}已經不在人世`
  // 被制伏、等你處置的人：要在戰後處置決定（收為奴隸、放過……）
  if (state.captives?.npcs.includes(npcId)) return `${rec.name}被制伏了，要先在戰後處置決定怎麼對待`
  if (rel.affinity < min) return `${rec.name}的親密度不夠（${rel.affinity}，至少要 ${min}）`
  if (state.flags[`invite_wait:${npcId}`]) return `${rec.name}說要再考慮，下次長休後再邀請`
  if (rec.staying) return `${rec.name}留在別處，要到那裡帶人`
  if (!presentHere(state, npcId)) return `${rec.name}不在身邊`
  // 開店中的店主、公會職員：得顧店，不能邀請入隊
  if (isShopStaff(rec)) return `${rec.name}得顧店，不能邀請入隊`
  return undefined
}

/** 整隊邀請時一起入隊的隊員（不是小隊的隊長時為空） */
function squadFollowers(state: GameState, npcId: string): NpcRecord[] {
  const sq = inActiveSquad(state, npcId)
  return sq && sq.leader === npcId ? squadWithLeader(state, sq) : []
}

export function inviteDc(state: GameState, npcId: string): number {
  const rel = state.relationships?.[npcId]
  const rec = npcRecord(state, npcId)
  if (!rel || !rec) throw new Error('你不認識這個人')
  const i = companionRules.invite
  const extra = companionRules.squad.invite_per_member * squadFollowers(state, npcId).length
  const ruler = isUnhireable(npcId) ? i.unhireable ?? 0 : 0
  return i.base - Math.floor(rel.affinity / i.affinity_step) + i.level_gap * Math.max(0, rec.level - pcOf(state).level) + tagDcMod(rec, 'invite') + ruler + extra
}

/** ignoreRoom：只看能不能邀請，不看隊伍有沒有空位（介面會先請玩家騰出位子） */
export function validateInvite(state: GameState, npcId: string, ignoreRoom = false) {
  assertFree(state, '邀請別人入隊')
  const sq = inActiveSquad(state, npcId)
  if (sq && sq.leader !== npcId) throw new Error(`${npcRecord(state, npcId)?.name ?? '對方'}是${sq.name}的隊員，要整隊邀請，請找隊長`)
  const why = inviteRefusal(state, npcId)
  if (why) throw new Error(why)
  if (!invitable(state).some((r) => r.id === npcId)) throw new Error('現在無法邀請這個人')
  if (sq) {
    const missing = squadMissing(state, sq)
    if (missing.length) throw new Error(`${missing.join('、')}今天不在，等人到齊再整隊邀請`)
  }
  const size = 1 + squadFollowers(state, npcId).length
  if (!ignoreRoom && partyRoom(state) < size) throw new Error(size > 1 ? `${sq!.name}有 ${size} 人，隊伍放不下` : `隊伍最多 ${partyMax(state)} 人`)
}

export function applyInvite(state: GameState, report: Report, npcId: string, degree: Degree): string {
  const rec = npcRecord(state, npcId)!
  const sq = inActiveSquad(state, npcId)
  const followers = squadFollowers(state, npcId)
  for (const f of followers) ensureRelationship(state, f)
  if (degree === 'critical' || degree === 'success') {
    // 小隊整隊入隊：身上記著小隊（離隊、遣散時一起走）
    const m = joinParty(state, rec, 'voluntary', report, { reason: followers.length ? '整隊受邀' : '受邀' })
    // 隊員已經先跟著主角（單獨帶上的）：隊長入隊後又是同一隊
    if (sq && state.party.some((x) => x !== m && x.squad === sq.leader)) m.squad = sq.leader
    if (followers.length) {
      m.squad = rec.id
      for (const f of followers) joinParty(state, f, 'voluntary', report, { reason: `跟著${rec.name}入隊` }).squad = rec.id
    }
    if (degree === 'critical') addAffinity(state, report, npcId, 5, '很高興受到邀請')
    return followers.length ? `${rec.name}答應了，${sq!.name}（${[rec, ...followers].map((r) => r.name).join('、')}）整隊加入隊伍。` : `${rec.name}答應加入隊伍。`
  }
  // 被拒絕後，下次長休前不能再邀請
  ;(report.changes.flags ??= {})[`invite_wait:${npcId}`] = true
  if (degree === 'partial') return `${rec.name}有些心動，但說要${followers.length ? '和隊員商量' : '再考慮'}一下。`
  addAffinity(state, report, npcId, degree === 'fumble' ? -8 : -3, '邀請被拒')
  return degree === 'fumble' ? `${rec.name}覺得被冒犯，斷然拒絕。` : `${rec.name}婉拒了邀請。`
}

// ---- 5b. 請固定 NPC 的小隊帶主角同行 ----

/** 這裡可以請求同行的小隊：認識隊長、隊長就在身邊、親密度足夠、隊員到齊 */
export function joinableSquads(state: GameState): Squad[] {
  if (isBound(state) || leaderOf(state)) return []
  const min = companionRules.invite.min_affinity
  return squads().filter((sq) => {
    if (!squadActive(state, sq) || state.party.some((m) => squadIds(sq).includes(m.id))) return false
    const rel = state.relationships?.[sq.leader]
    return !!rel && rel.affinity >= min && presentHere(state, sq.leader)
  })
}

function joinTarget(state: GameState, leaderId: string | undefined): Squad {
  const sq = squads().find((x) => x.leader === leaderId)
  if (!sq) throw new Error('沒有這支小隊')
  return sq
}

export function validateSquadJoin(state: GameState, leaderId: string, ignoreRoom = false): Squad {
  assertFree(state, '自己找隊伍')
  if (leaderOf(state)) throw new Error('你已經在別人的隊伍裡了')
  const sq = joinTarget(state, leaderId)
  if (state.flags[`invite_wait:${sq.leader}`]) throw new Error(`${npcRecord(state, sq.leader)?.name ?? '隊長'}說要再想想，下次長休後再問`)
  if (!joinableSquads(state).some((x) => x.leader === sq.leader)) throw new Error('現在沒辦法請他們帶你同行')
  const missing = squadMissing(state, sq)
  if (missing.length) throw new Error(`${missing.join('、')}今天不在，等人到齊再說`)
  const size = 1 + squadWithLeader(state, sq).length
  if (!ignoreRoom && followRoom(state) < size) throw new Error(`加上${sq.name}的 ${size} 人，隊伍會超過上限，先讓同伴離隊`)
  return sq
}

export function applySquadJoin(state: GameState, report: Report, leaderId: string, degree: Degree): string {
  const sq = joinTarget(state, leaderId)
  const leader = npcRecord(state, sq.leader)!
  const members = squadWithLeader(state, sq)
  report.others = [leader, ...members].map((r) => ({ id: r.id, name: r.name, race: r.race, class: r.class, level: r.level, personality: r.personality }))
  if (degree === 'critical' || degree === 'success') {
    joinParty(state, leader, 'leader', report, { group: leader.id, reason: '帶主角同行' })
    for (const m of members) joinParty(state, m, 'ally', report, { group: leader.id })
    if (degree === 'critical') addAffinity(state, report, leader.id, 3, '很歡迎你同行')
    return `${leader.name}答應帶你同行，你跟著${sq.name}行動。`
  }
  ;(report.changes.flags ??= {})[`invite_wait:${sq.leader}`] = true
  if (degree === 'partial') return `${leader.name}說要和隊員商量一下（下次長休後再問）。`
  addAffinity(state, report, leader.id, degree === 'fumble' ? -6 : -2, '請求同行被拒')
  return degree === 'fumble' ? `${leader.name}覺得你只是想沾光，冷冷地拒絕了。` : `${leader.name}婉拒了，說現在不方便多帶人。`
}

/** 長休時清掉「再考慮一下」的冷卻 */
export function clearInviteCooldowns(state: GameState) {
  for (const k of Object.keys(state.flags)) if (k.startsWith('invite_wait:')) delete state.flags[k]
}

/**
 * 介面用：對小隊隊長能不能整隊邀請、請他們帶主角同行，參考 DC（不能時附原因），以及各要幾個位子。
 * 空位不夠不算「不能」：介面會先請玩家騰出位子（MakeRoomDialog）
 */
export function squadOptions(state: GameState, leaderId: string): { size: number; invite: { dc?: number; why?: string; need: number }; join: { dc?: number; why?: string; need: number } } {
  const sq = joinTarget(state, leaderId)
  const tryDc = (check: () => void, dc: () => number) => {
    try {
      check()
      return { dc: dc() }
    } catch (e) {
      return { why: e instanceof Error ? e.message : String(e) }
    }
  }
  return {
    size: 1 + sq.members.length,
    invite: { ...tryDc(() => validateInvite(state, leaderId, true), () => inviteDc(state, leaderId)), need: 1 + squadFollowers(state, leaderId).length },
    join: { ...tryDc(() => validateSquadJoin(state, leaderId, true), () => squadJoinDc(state, sq)), need: 1 + squadWithLeader(state, sq).length },
  }
}

// ---- 3. 奴隸市場 ----

export type MarketKind = 'public' | 'black'

export function marketsHere(state: GameState): { kind: MarketKind; def: MarketDef }[] {
  const m = slaveryRules.markets[state.location]
  const list: { kind: MarketKind; def: MarketDef }[] = []
  if (m?.public) list.push({ kind: 'public', def: m.public })
  // 黑市在地下街裡：站在黑市的地標上才找得到（underworld.ts）
  if (m?.black && blackMarketHere(state)) list.push({ kind: 'black', def: m.black })
  return list
}

function marketDef(state: GameState, kind: MarketKind): MarketDef {
  const def = marketsHere(state).find((m) => m.kind === kind)?.def
  if (!def) throw new Error(kind === 'black' ? '黑市在地下街裡' : '這裡沒有奴隸市場')
  return def
}

export function marketStock(state: GameState, kind: MarketKind): SlaveListing[] {
  const def = marketDef(state, kind)
  const key = `${state.location}/${kind}`
  const markets = (state.markets ??= {})
  const cur = markets[key]
  if (cur && cur.day === state.time.day) return cur.stock
  const pc = pcOf(state)
  const stock = withRng(state, (rng) => {
    const n = rng.int(def.stock[0], def.stock[1])
    return Array.from({ length: n }, (): SlaveListing => {
      let race = weightedPick(rng, def.races)
      if (kind === 'public' && slaveryRules.black_market_only.includes(race)) race = 'human'
      const level = Math.max(1, Math.min(20, pc.level + rng.int(-2, 1)))
      const rec = generateNpc(state, rng, { race, level, tags: ['slave'], background: rng.pick(npcPool.slave_backgrounds) }, 'slv')
      const contract = contractKind(weightedPick(rng, slaveryRules.market_contracts[kind]))
      // 身價：指標與性經歷（處子加價、經驗多的扣一點、侍奉熟練的加一點）
      return { npc: rec.id, price_cc: slavePrice(rec, def.price_mult, rng, slaveValueMult(npcLewd(rec), 0) * sexValueOf(state, rec.id).mult), contract }
    })
  })
  markets[key] = { day: state.time.day, stock }
  return stock
}

function listing(state: GameState, kind: MarketKind, npcId: string): SlaveListing {
  const l = marketStock(state, kind).find((x) => x.npc === npcId)
  if (!l) throw new Error('市場上沒有這個人')
  return l
}

/** 買下奴隸；可以選擇要刻的印記（模板或自訂），沒選時用市場原本的 */
export function buySlave(state: GameState, kind: MarketKind, npcId: string, mark?: MarkChoice): Report {
  assertFree(state, '買奴隸')
  // 無主、逃亡中身上也還有印記：奴隸不能擁有奴隸
  if (isEnslaved(state)) throw new Error('身上還有奴隸印記，不能擁有奴隸')
  const l = listing(state, kind, npcId)
  if (partyRoom(state) < 1) throw new Error(`隊伍最多 ${partyMax(state)} 人`)
  if (state.money_cc < l.price_cc) throw new Error('錢不夠')
  const def = marketDef(state, kind)
  const rec = npcRecord(state, npcId)!
  const report = socialReport(state, 1, def.name)
  const member = joinParty(state, rec, 'slave', report, { contract: mark ?? l.contract, reason: '買下' })
  report.changes.money_cc = -l.price_cc
  const markets = state.markets![`${state.location}/${kind}`]!
  markets.stock = markets.stock.filter((x) => x.npc !== npcId)
  const c = contractTerms(contractOf(member)!)
  report.outcome.summary = `在${def.name}以 ${formatMoney(l.price_cc)} 買下${rec.name}，在${placeName(c.place)}刻下${c.name}的印記：${c.mark}`
  report.narration = { pov: 'second_person', length: 'short', focus: [`${rec.name}的身世與第一印象`, '契約印記'] }
  if (kind === 'black') report.outcome.tags = ['黑市']
  return commitReport(state, report)
}

// ---- 黑市的珍品（獨特裝備） ----

/**
 * 寄生物的引子在黑市上架（docs/ADULT_EVENTS.md 第 6 節）：勾了「也會出現在黑市」、使用效果是引子的物品；
 * 存檔規則「黑市賣寄生物的引子」關掉、內容篩選擋掉物品或它引來的事件時不上架
 */
export function curioListed(state: GameState, name: string): boolean {
  const i = itemDef(name)
  if (!i?.use?.lure?.length) return true
  return parasiteLuresOn(state) && tagsAllowed(i.content_tags) && !!lureTemplate(state, i.use.lure)
}

/** 今天黑市的珍品（第一次查看時刷新）：勾了「也會出現在黑市」的獨特裝備，件數是存檔規則；另外每天各一份寄生物的引子（照物品的價錢，不加成；買走就沒了，隔天補） */
export function curioStock(state: GameState): CurioListing[] {
  marketDef(state, 'black')
  const curios = (state.curios ??= {})
  const cur = curios[state.location]
  if (cur && cur.day === state.time.day) return cur.stock.filter((c) => curioListed(state, c.item))
  const n = gameRule(state, 'blackMarketGear')
  const pool = itemRules.items.filter((i) => i.black_market && i.gear?.unique).map((i) => i.name)
  const stock = n && pool.length ? withRng(state, (rng) => {
    const picked = [...pool].sort(() => rng.next() - 0.5).slice(0, n)
    return picked.map((name): CurioListing => ({ item: name, price_cc: Math.max(10, Math.round((itemDef(name)!.price_cc * slaveryRules.curios.price_mult) / 10) * 10) }))
  }) : []
  // 引子一律記進今天的貨，看的時候才照規則與內容篩選擋掉（當天改了規則、篩選也馬上生效）
  for (const i of itemRules.items) if (i.black_market && i.use?.lure?.length) stock.push({ item: i.name, price_cc: i.price_cc })
  curios[state.location] = { day: state.time.day, stock }
  return stock.filter((c) => curioListed(state, c.item))
}

function curio(state: GameState, item: string): CurioListing {
  const c = curioStock(state).find((x) => x.item === item)
  if (!c) throw new Error('黑市今天沒有這件東西')
  return c
}

/** 買下黑市的珍品 */
export function buyCurio(state: GameState, item: string): Report {
  // 被主人帶著也能用自己的錢買（和一般商店一樣）
  const c = curio(state, item)
  if (state.money_cc < c.price_cc) throw new Error('錢不夠')
  const def = marketDef(state, 'black')
  const report = socialReport(state, 0.5, def.name)
  report.kind = 'trade'
  report.changes.money_cc = -c.price_cc
  report.changes.items_gained = [{ name: item, qty: 1, owner: 'pc' }]
  state.curios![state.location]!.stock = state.curios![state.location]!.stock.filter((x) => x.item !== item)
  report.outcome.summary = `在${def.name}以 ${formatMoney(c.price_cc)} 買下【${item}】。`
  report.outcome.tags = ['黑市']
  return commitReport(state, report)
}

export function haggleDc(state: GameState, kind: MarketKind | 'curio', npcId: string): number {
  if (kind === 'curio') {
    if (curio(state, npcId).haggled) throw new Error('今天已經殺過價了')
    return slaveryRules.haggle.base + slaveryRules.haggle.black_market_bonus
  }
  const l = listing(state, kind, npcId)
  if (l.haggled) throw new Error('今天已經殺過價了')
  const h = slaveryRules.haggle
  return h.base + (kind === 'black' ? h.black_market_bonus : 0)
}

export function applyHaggle(state: GameState, report: Report, kind: MarketKind | 'curio', npcId: string, degree: Degree): string {
  const l = kind === 'curio' ? curio(state, npcId) : listing(state, kind, npcId)
  const before = l.price_cc
  l.price_cc = Math.max(10, Math.round((l.price_cc * slaveryRules.haggle.price_factor[degree]) / 10) * 10)
  l.haggled = true
  report.location.scene = marketDef(state, kind === 'curio' ? 'black' : kind).name
  if (l.price_cc < before) return `價格從 ${formatMoney(before)} 降到 ${formatMoney(l.price_cc)}。`
  if (l.price_cc > before) return `商人被惹惱了，價格漲到 ${formatMoney(l.price_cc)}。`
  return '商人不肯讓價。'
}

/** 說服王城的衛兵（行動判定）：成功、大成功當天放行；其餘當天不再聽，大失敗另外提高警戒 */
export function applyPalaceGate(state: GameState, degree: Degree): string {
  return settlePalacePersuasion(state, degree === 'critical' || degree === 'success', degree === 'fumble', palaceGateName(state))
}

/** 在酒館打聽地下街（主動行動 black_market）：這座城有地下街才能打聽（underworld.ts）；成功以上知道入口 */
export function applyBlackMarket(state: GameState, report: Report, degree: Degree): string {
  const map = underworldOf(state.location)
  if (degree === 'critical' || degree === 'success') {
    if (!map) return '問了一圈，這裡似乎真的沒有見不得光的買賣。'
    ;(report.changes.flags ??= {})[underworldFlag(state.location)] = true
    const inside = underworldLandmarks(map).filter((l) => !l.open?.hidden).map((l) => l.name)
    return `打聽到了進${map.name}的路（從酒館進去）${inside.length ? `：裡面有${inside.join('、')}` : ''}。`
  }
  if (degree === 'partial') return '有人暗示了幾句，但還不夠找到地方。'
  if (degree === 'fumble') {
    ;(report.changes.reputation ??= []).push({ faction: locationById(state.location).faction ?? 'guild', delta: -1 })
    return '問得太露骨，被衛兵盯上了。'
  }
  return '沒人願意透露。'
}

// ---- 4. 主角作為奴隸 ----

export function selfSaleChance(state: GameState): number {
  const s = slaveryRules.self_sale
  const pc = pcOf(state)
  return Math.max(0.05, Math.min(s.max, s.base + s.per_cha_mod * mod(attrOf(pc, 'cha')) + s.per_level * pc.level))
}

/** 戰敗時逃開的隊員：回到聚落或安全房時，在這裡等著你，重新歸隊（生命值維持戰敗時的一半） */
export function rejoinAway(state: GameState): Report | undefined {
  const away = state.party.filter((m) => m.status.includes('away'))
  if (!away.length || state.combat) return undefined
  const area = currentArea(state)
  if (area.kind !== 'settlement' && area.kind !== 'home' && currentCell(state).kind !== 'safe') return undefined
  const report = socialReport(state, 0, area.name, 'event')
  for (const m of away) removeCondition(m, 'away', report)
  report.outcome = { result: 'neutral', summary: `${away.map((m) => m.name).join('、')}在這裡等著你，重新歸隊。`, tags: ['歸隊'] }
  report.narration = { pov: 'second_person', length: 'short', focus: ['重逢'] }
  return commitReport(state, report)
}

/** 市場上出價的買家是哪一種人：依市場的標籤權重，再挑這個標籤可能的 NPC 種類 */
export function pickBuyer(rng: Rng, kind: MarketKind): { tag: string; kind: NpcKind } {
  const t = slaveryRules.master_tags
  const tag = weightedPick(rng, Object.fromEntries(Object.entries(t.tags).map(([id, x]) => [id, x[kind]])))
  const kinds = (tagDef(tag)?.kinds ?? ['adventurer']) as NpcKind[]
  const npcKind = weightedPick(rng, Object.fromEntries(kinds.map((k) => [k, t.kinds[k].market]))) as NpcKind
  return { tag, kind: npcKind }
}

/**
 * 主角在市場登記出售自己。隊伍必須只剩主角。
 * 已經是奴隸（無主或逃亡）時也可以：買下的人成為新主人，印記沿用。
 * 買家的身分（標籤）影響成交機率（slavery.json 的 master_tags）。
 */
export function offerSelf(state: GameState, kind: MarketKind): Report {
  const def = marketDef(state, kind)
  if (isBound(state)) throw new Error('你已經有主人帶著了')
  if (state.pendingMark) throw new Error('先完成契約印記的刻印')
  if (state.party.length > 1) throw new Error('要先讓同伴離隊，才能登記出售自己')
  const s = slaveryRules.self_sale
  const pc = pcOf(state)
  const marked = isEnslaved(state)
  const report = socialReport(state, s.hours, def.name)
  const deal = withRng(state, (rng) => {
    const buyer = pickBuyer(rng, kind)
    const chance = Math.max(0.05, Math.min(s.max, selfSaleChance(state) + slaveryRules.master_tags.tags[buyer.tag]!.chance))
    if (!rng.chance(chance)) return null
    // 娼妓標籤的買家是老鴇（店主兼娼妓）
    const madam = buyer.tag === 'prostitute'
    const master = generateNpc(state, rng, {
      level: Math.min(20, pc.level + rng.int(1, 4)), kind: buyer.kind,
      tags: madam ? ['prostitute', 'merchant'] : [buyer.tag], ...(madam ? { occupation: '老鴇' } : {}),
    }, 'mst')
    const contract = contractKind(madam ? slaveryRules.roles.madam : weightedPick(rng, s.contract_weights))
    // 主角出售自己：指標、色情技能與性經歷讓身價變高
    const price = slavePrice(pc, def.price_mult, rng, slaveValueOf(pc) * sexValueOf(state, 'pc').mult * pcTagMult(pc, 'slave_price_mult'))
    return { master, contract, price }
  })
  if (!deal) {
    report.outcome = { result: 'neutral', summary: `在${def.name}站了 ${s.hours} 小時，沒有人出價。` }
    return commitReport(state, report)
  }
  const share = Math.round(deal.price * s.share)
  const who = `${tagDef(deal.master.tags?.[0] ?? '')?.name ?? ''}${deal.master.name}`
  if (marked) {
    // 已經刻著印記：買家成為新主人，印記沿用
    changeMaster(state, deal.master, report, `在${def.name}被買下`)
    remarkByMadam(state, deal.master)
    report.changes.money_cc = share
    // 身上已經有印記：賣身錢照新主人契約的「收益歸屬」被抽走一部分，當作被奴隸商人抽走了（摘要寫實際拿到的）
    const kept = share - masterTake(state, share)
    report.outcome = {
      result: 'success',
      summary: `${who}以 ${formatMoney(deal.price)} 買下了你，成為你的新主人。成交價 ${formatMoney(deal.price)}，你只拿到 ${formatMoney(kept)}，其餘被抽走了。身上的印記沿用。`,
      tags: ['換了主人'],
    }
    report.narration = { pov: 'second_person', length: 'medium', focus: ['新主人的模樣與態度'] }
    return commitReport(state, report)
  }
  enslavePlayer(state, deal.master, deal.contract, report)
  // 刻印前還有一次檢定：主角的表現決定最後刻上哪一種印記
  startMarking(state, deal.contract)
  report.changes.money_cc = share
  report.outcome = {
    result: 'success',
    summary: `${who}以 ${formatMoney(deal.price)} 買下了你，你拿到 ${formatMoney(share)} 的賣身錢。${deal.master.name}打算在你${placeName(contractDef(deal.contract).place)}刻下${contractDef(deal.contract).name}。`,
    tags: ['成為奴隸'],
  }
  report.narration = { pov: 'second_person', length: 'medium', focus: ['主人的模樣與態度', '即將刻下契約印記'] }
  return commitReport(state, report)
}

/** 主角的談判 DC：契約越強越難，主人的親密度越高越容易。 */
export function negotiateDc(state: GameState): number {
  const pc = pcOf(state)
  const contract = contractOf(pc)
  const fugitive = isFugitive(state) && !!contract?.master
  if (!contract || (!isBound(state) && !fugitive)) throw new Error('你不是被主人帶著的奴隸')
  const def = contractTerms(contract)
  const masterAff = state.relationships?.[contract.master]?.affinity ?? 0
  const bonus = state.flags['negotiate_bonus'] ? 2 : 0
  // 逃亡後當面談判：主人還在氣頭上
  const angry = fugitive ? slaveryRules.fugitive_master.negotiate_dc_bonus : 0
  // 主人的身分：好人比較願意放手，惡人不肯
  const tags = npcRecord(state, contract.master)?.tags ?? []
  const who = tags.reduce((sum, t) => sum + (slaveryRules.master_tags.tags[t]?.negotiate ?? 0), 0)
  return def.negotiate_dc - Math.floor(masterAff / slaveryRules.freedom.negotiate.affinity_step) - bonus + angry + who + submissionDc(pc)
}

/** 順從（慾望指標）讓人更難離開主人：每 master_tool.submission_dc_per 點，逃離與談判解約的 DC +1 */
export function submissionDc(c: Character): number {
  return Math.floor(lewdPowerOf(c).submission / lewdRules.master_tool.submission_dc_per)
}

export function escapeDc(state: GameState): number {
  const pc = pcOf(state)
  const contract = contractOf(pc)
  if (!contract || !isBound(state)) throw new Error('你不是被主人帶著的奴隸')
  return contractTerms(contract).escape_dc + submissionDc(pc)
}

/** 對主人的檢定都受到服從懲罰 */
export function obediencePenalty(state: GameState): number {
  const pc = pcOf(state)
  const contract = contractOf(pc)
  return contract && isBound(state) ? contract.obedience : 0
}

export function applyNegotiate(state: GameState, report: Report, degree: Degree): string {
  const pc = pcOf(state)
  const master = contractOf(pc)!.masterName
  switch (degree) {
    case 'critical':
    case 'success':
      if (degree === 'critical') addAffinity(state, report, contractOf(pc)!.master, 5, '被說服')
      freePlayer(state, report, '談判成功')
      delete state.flags['negotiate_bonus']
      ;(report.changes.flags ??= {}).negotiate_bonus = false
      return `${master}抹去了你身上的契約印記，你恢復了自由。`
    case 'partial':
      ;(report.changes.flags ??= {}).negotiate_bonus = true
      return `${master}沒有答應，但似乎有些動搖（下次談判較容易）。`
    case 'fail':
      if (isFugitive(state)) {
        addAffinity(state, report, contractOf(pc)!.master, -5, '逃跑後還想談條件')
        return `${master}拒絕了，轉身離開。`
      }
      return `${master}拒絕了。${punish(state, 'light', report)}`
    case 'fumble':
      if (isFugitive(state)) {
        const sent = recapturePlayer(state, report, slaveryRules.master_home.strict.found)
        return `${master}一把抓住了你。${punish(state, 'heavy', report)}${sent}`
      }
      return `${master}勃然大怒。${punish(state, 'heavy', report)}`
  }
}

export function applyEscape(state: GameState, report: Report, degree: Degree): string {
  const pc = pcOf(state)
  const def = contractTerms(contractOf(pc)!)
  const master = contractOf(pc)!.masterName
  if (degree === 'critical' || degree === 'success' || degree === 'partial') {
    const mult = degree === 'critical' ? 0.5 : degree === 'partial' ? 2 : 1
    const loss = Math.ceil(pc.maxHp * def.escape_hp_ratio * mult)
    playerEscapes(state, report)
    if (loss > 0) setHp(state, pc, pc.hp - loss, report)
    const pain = def.functions.includes('tether') ? '鎖鏈紋收緊，勒得你幾乎無法呼吸' : '印記一陣灼痛'
    return `你逃離了${master}${degree === 'partial' ? '，但付出了不小的代價' : ''}。${loss > 0 ? `${pain}，失去 ${loss} 點生命值。` : ''}契約仍在，你現在是逃亡奴隸。`
  }
  if (degree === 'fail') return `逃跑被${master}發現。${punish(state, 'light', report)}`
  return `逃跑被${master}當場抓住。${punish(state, 'heavy', report)}`
}

// ---- 主角的奴隸 ----

export function releaseSlave(state: GameState, npcId: string): Report {
  const m = state.party.find((x) => x.id === npcId && x.bond === 'slave')
  if (!m) throw new Error('隊伍中沒有這位奴隸')
  const report = socialReport(state, 0.5, locationById(state.location).name)
  freeSlave(state, npcId, report)
  report.outcome.summary = `解除了${m.name}的奴隸契約，抹去身上的印記。`
  report.narration = { pov: 'second_person', length: 'short', focus: [`${m.name}的反應`] }
  return commitReport(state, report)
}

// ---- 6. 被主人帶著時，向主人提議雇人、買奴隸 ----
// 主人出錢；入隊後是主人的隊員（ally，跟著主人的隊伍），買下的奴隸契約屬於主人。見 docs/COMPANIONS.md 第 2.4 節

export type ProposalTarget = { kind: 'hire'; npc: string } | { kind: 'buy'; market: MarketKind; npc: string } | { kind: 'underworld' } | { kind: RosterKind; npc: string }
type PersonProposal = Extract<ProposalTarget, { kind: 'hire' | 'buy' }>

/**
 * target：hire:<npc id>、buy:<public|black>:<npc id>，或 underworld（請主人帶你去這座城的地下街）；
 * 安排隊伍（masterRoster.ts）：dismiss / lodge / home / take:<npc id>
 */
export function parseProposal(target: string | undefined): ProposalTarget {
  if (target === 'underworld') return { kind: 'underworld' }
  const [k, a, b] = (target ?? '').split(':')
  if (a && ROSTER_KINDS.includes(k as RosterKind)) return { kind: k as RosterKind, npc: a }
  if (k === 'hire' && a) return { kind: 'hire', npc: a }
  if (k === 'buy' && (a === 'public' || a === 'black') && b) return { kind: 'buy', market: a, npc: b }
  throw new Error('要向主人提議雇誰、買誰？')
}

/** 帶著主角的主人（隊伍裡的隊長，也是契約的主人） */
function masterOf(state: GameState): { member: Character; rec?: NpcRecord } {
  const m = leaderOf(state)
  if (!isBound(state) || !m || m.id !== contractOf(pcOf(state))?.master) throw new Error('你沒有被主人帶著')
  const rec = npcRecord(state, m.id)
  return { member: m, ...(rec ? { rec } : {}) }
}

/** 提議的花費：雇用照要價，買奴隸照市價；去地下街不花錢 */
export function proposalCost(state: GameState, t: ProposalTarget): number {
  if (t.kind !== 'hire' && t.kind !== 'buy') return 0
  return t.kind === 'hire' ? askingFor(candidate(state, t.npc)) : listing(state, t.market, t.npc).price_cc
}

/** 主人的財力（願意為這種事花的錢）：每級 budget_per_level × 財富倍率（依標籤取最高；普通人較低；都沒有是 1） */
export function masterBudget(state: GameState): number {
  const p = slaveryRules.propose
  const { member, rec } = masterOf(state)
  const mults = [...(rec?.tags ?? []).map((t) => p.wealth[t]), rec?.kind === 'commoner' ? p.wealth.commoner : undefined].filter((x): x is number => typeof x === 'number')
  return Math.round(p.budget_per_level * member.level * (mults.length ? Math.max(...mults) : 1))
}

/** 向主人提議的參考 DC：主人親密度高比較容易；花費相對主人的財力越高越難；主人的身分（好人不愛買奴隸、惡人愛） */
export function proposeDc(state: GameState, t: ProposalTarget): number {
  if (t.kind !== 'hire' && t.kind !== 'buy' && t.kind !== 'underworld') return rosterDc(state, t.kind)
  const p = slaveryRules.propose
  const { member, rec } = masterOf(state)
  const affinity = state.relationships?.[member.id]?.affinity ?? 0
  const costDc = Math.min(p.cost_dc_max, Math.round((proposalCost(state, t) / Math.max(1, masterBudget(state))) * p.cost_dc))
  const tagDc = (rec?.tags ?? []).reduce((s, tag) => s + (p.tag_dc[t.kind][tag] ?? 0), 0)
  return Math.max(5, p.base - Math.floor(affinity / p.affinity_step) + costDc + tagDc)
}

const proposeFlag = (npc: string) => `propose_no:${npc}`

/** 為什麼現在不能向主人提議去地下街（可以時是 undefined）：被主人帶著、站在有地下街的城的酒館、今天還沒答應過也還沒拒絕過 */
export function underworldProposalBlocked(state: GameState): string | undefined {
  if (!isBound(state)) return '你沒有被主人帶著'
  if (!underworldOf(state.location)) return '這座城沒有地下街'
  if (currentArea(state).kind !== 'settlement' || currentCell(state).kind !== 'tavern') return '要在酒館才能提議'
  if (underworldEscorted(state)) return '主人今天已經答應帶你去了'
  if (state.flags[proposeFlag('underworld')] === state.time.day) return '主人今天不想再聽你提這件事'
  return undefined
}

/** 結算向主人提議去地下街：成功時主人今天帶你去（也記住入口）；部分成功主人帶你去但不讓你記路；失敗今天不再提；大失敗主人不高興 */
function applyUnderworldProposal(state: GameState, report: Report, degree: Degree): string {
  const p = slaveryRules.propose
  const why = underworldProposalBlocked(state)
  if (why) throw new Error(why)
  const { member: master } = masterOf(state)
  const map = underworldOf(state.location)!
  if (degree === 'fail' || degree === 'fumble') {
    ;(report.changes.flags ??= {})[proposeFlag('underworld')] = state.time.day
    if (degree === 'fumble') addAffinity(state, report, master.id, p.fumble_affinity, '奴隸想去見不得光的地方')
    return degree === 'fumble' ? `${master.name}沉下臉：奴隸不該打聽那種地方。` : `${master.name}不答應帶你去${map.name}。`
  }
  const flags = (report.changes.flags ??= {})
  flags[underworldEscortFlag(state.location)] = state.time.day
  if (degree !== 'partial') flags[underworldFlag(state.location)] = true
  if (degree === 'critical') addAffinity(state, report, master.id, p.critical_affinity, '提議得體')
  return degree === 'partial'
    ? `${master.name}答應今天帶你去${map.name}，但一路讓你低著頭跟在後面，不讓你記路。從酒館就能跟著主人走進去。`
    : `${master.name}答應今天帶你去${map.name}，入口你也記住了。從酒館就能跟著主人走進去。`
}

/** 能不能提議：被主人帶著、隊伍還有空位、對象在酒館或市場上、今天還沒被主人拒絕過 */
export function validateProposal(state: GameState, t: PersonProposal): NpcRecord {
  masterOf(state)
  const rec = npcRecord(state, t.npc)
  if (!rec) throw new Error('找不到這個人')
  if (state.flags[proposeFlag(t.npc)] === state.time.day) throw new Error('主人今天不想再聽你提這個人')
  if (partyRoom(state) < 1) throw new Error('隊伍已滿，主人帶不了更多人')
  if (t.kind === 'hire') {
    if (isUnhireable(t.npc)) throw new Error('對方不會受雇於人')
    if (state.captives?.npcs.includes(t.npc)) throw new Error('對方被制伏在地上')
    candidate(state, t.npc)
  } else listing(state, t.market, t.npc)
  return rec
}

/** 結算：主人答應就出錢讓對方入隊（部分成功要主角出一半）；失敗今天不再提這個人；大失敗主人不高興 */
export function applyProposal(state: GameState, report: Report, target: string, degree: Degree): string {
  const p = slaveryRules.propose
  const t = parseProposal(target)
  if (t.kind === 'underworld') return applyUnderworldProposal(state, report, degree)
  if (t.kind !== 'hire' && t.kind !== 'buy') return applyRosterProposal(state, report, t.kind, t.npc, degree)
  const rec = validateProposal(state, t)
  const { member: master } = masterOf(state)
  const cost = proposalCost(state, t)
  const what = t.kind === 'hire' ? `雇用${rec.name}` : `買下${rec.name}`
  // 提到的人也寫進日誌（AI 寫經過時知道是誰）
  if (!report.others?.some((o) => o.id === rec.id)) report.others = [...(report.others ?? []), { id: rec.id, name: rec.name, race: rec.race, class: rec.class, level: rec.level }]
  if (degree === 'fail' || degree === 'fumble') {
    ;(report.changes.flags ??= {})[proposeFlag(t.npc)] = state.time.day
    if (degree === 'fumble') addAffinity(state, report, master.id, p.fumble_affinity, '奴隸多管閒事')
    return degree === 'fumble' ? `${master.name}覺得你多管閒事，臉色很難看。` : `${master.name}不答應${what}。`
  }
  let share = 0
  if (degree === 'partial') {
    share = Math.round((cost * p.partial_share) / 5) * 5
    if (state.money_cc < share) return `${master.name}說可以${what}，但要你出 ${formatMoney(share)}；你的錢不夠，只好作罷。`
    report.changes.money_cc = (report.changes.money_cc ?? 0) - share
  }
  if (t.kind === 'hire') {
    joinParty(state, rec, 'ally', report, { group: master.id, reason: '主人雇用' })
  } else {
    const l = listing(state, t.market, t.npc)
    joinParty(state, rec, 'ally', report, { group: master.id, ownedBy: { id: master.id, name: master.name }, contract: l.contract, reason: '主人買下' })
    const market = state.markets![`${state.location}/${t.market}`]!
    market.stock = market.stock.filter((x) => x.npc !== t.npc)
  }
  if (degree === 'critical') addAffinity(state, report, master.id, p.critical_affinity, '提議得體')
  const paid = share ? `，你出了 ${formatMoney(share)}，其餘由主人付` : `，${master.name}付了 ${formatMoney(cost)}`
  return `${master.name}答應${what}${paid}；${rec.name}以${master.name}的${t.kind === 'hire' ? '隊員' : '奴隸'}身分加入隊伍。`
}

// ---- 給主動行動用：參考 DC 與各成功程度的機制結果 ----

export interface ActionSetup {
  dc: number
  targetName?: string
  /** 檢定的額外修正（負數為懲罰） */
  situational: { label: string; value: number }[]
  /** 各成功程度的機制結果（給 AI 與玩家參考） */
  outcomes: Partial<Record<Degree, string>>
  scene: string
  /** 預設屬性（沒有時用 actions.json 的設定） */
  attr?: AttrId
  /** 耗時（沒有時用 actions.json 的設定） */
  hours?: number
  /** 成人向：可能進入的親密場景（content.ts 的 adultScene） */
  adultScene?: AdultScene
  /** 擲檢定的人（沒有時是主角；例如由夥伴動手製作） */
  actor?: string
  /**
   * 工藝檢定（docs/CRAFTING.md 1.1 節）：'self' 屬性調整值 ÷ crafts.json 的 attr_div、不加熟練加值（工藝等級在 situational）；
   * 'keeper' 委託打造由店主擲，屬性不算（店主的等級在 situational）
   */
  craftCheck?: 'self' | 'keeper'
  /** 檢定分類（特殊任務選項寫的 skill）；沒有時照行動、情境，再沒有照屬性推（perks.ts 的 checkSkills） */
  skill?: SkillId
  /** 檢定的情境（預設 action；王城大門是 gate） */
  context?: CheckContext
}

export function setupFor(state: GameState, kind: ActionKind, target?: string, offer?: number, item?: string, others: string[] = [], terms?: Partial<MarkTerms>): ActionSetup {
  const pc = pcOf(state)
  switch (kind) {
    case 'chat':
    case 'gift':
    case 'flatter':
    case 'seduce':
    case 'steal':
    case 'attack':
      return setupInteraction(state, kind, target, item)
    case 'bluff':
    case 'intimidate':
      return setupStandoff(state, kind, actionRulesBase(kind))
    case 'hire': {
      const rec = npcRecord(state, target ?? '')
      if (!rec) throw new Error('酒館裡沒有這位冒險者')
      const o = offer ?? 0
      validateHire(state, rec.id, o)
      const c = candidate(state, rec.id)
      return {
        dc: hireDc(state, rec.id, o), targetName: rec.name, situational: [], scene: tavernScene(state),
        outcomes: {
          critical: `以 ${formatMoney(o)} 加入，對主角印象很好`,
          success: `以 ${formatMoney(o)} 加入`,
          partial: `還價到 ${formatMoney(Math.round((o + askingFor(c)) / 2 / 5) * 5)}`,
          fail: '婉拒，今天不再談（親密度 -3）',
          fumble: '覺得被羞辱（親密度 -8）',
        },
      }
    }
    case 'haggle': {
      // 奴隸「public:npc」「black:npc」，黑市的珍品「curio:物品名稱」
      const i = (target ?? '').indexOf(':')
      const mk = (target ?? '').slice(0, i) as MarketKind | 'curio'
      const id = (target ?? '').slice(i + 1)
      const rec = mk === 'curio' ? undefined : npcRecord(state, id)
      if (mk !== 'curio' && !rec) throw new Error('市場上沒有這個人')
      const f = slaveryRules.haggle.price_factor
      const pct = (x: number) => `${Math.round((x - 1) * 100)}%`
      return {
        dc: haggleDc(state, mk, id), targetName: rec ? `${rec.name}的賣家` : `【${id}】的賣家`, situational: [], scene: marketDef(state, mk === 'curio' ? 'black' : mk).name,
        outcomes: { critical: `價格 ${pct(f.critical)}`, success: `價格 ${pct(f.success)}`, partial: `價格 ${pct(f.partial)}`, fail: '不讓價', fumble: `價格 +${Math.round((f.fumble - 1) * 100)}%` },
      }
    }
    case 'invite': {
      const rec = npcRecord(state, target ?? '')
      if (!rec) throw new Error('你不認識這個人')
      validateInvite(state, rec.id)
      return {
        dc: inviteDc(state, rec.id), targetName: rec.name, situational: [], scene: locationById(state.location).name,
        outcomes: { critical: '自願加入，親密度 +5', success: '自願加入', partial: '要再考慮（下次長休後才能再邀請）', fail: '婉拒（親密度 -3）', fumble: '被冒犯（親密度 -8）' },
      }
    }
    case 'staff_invite': return setupStaffInvite(state, target)
    case 'cohabit_invite': return setupCohabitInvite(state, target)
    case 'squad_join': {
      const sq = validateSquadJoin(state, target ?? '')
      const leader = npcRecord(state, sq.leader)!
      return {
        dc: squadJoinDc(state, sq), targetName: leader.name, situational: [], scene: locationById(state.location).name,
        outcomes: { critical: `跟著${sq.name}同行，親密度 +3`, success: `跟著${sq.name}同行`, partial: '要商量（下次長休後才能再問）', fail: '婉拒（親密度 -2）', fumble: '被當成想沾光（親密度 -6）' },
      }
    }
    case 'black_market': {
      assertFree(state, '自己打聽地下街')
      const why = underworldAskBlocked(state)
      if (why) throw new Error(why)
      const r = slaveryRules.black_market_search
      return {
        dc: r.dc, situational: [], scene: tavernScene(state),
        outcomes: { critical: '知道地下街的入口', success: '知道地下街的入口', partial: '得到一點線索', fail: '沒人透露', fumble: '被衛兵盯上（聲望 -1）' },
      }
    }
    case 'palace_gate': {
      const palace = palaceGateName(state)
      assertMayPersuadePalace(state)
      return {
        dc: palacePersuadeDc(state), targetName: `${palace}的衛兵`, attr: 'cha', hours: 0.25,
        // 特質、身分在 prepareAction 照「城門盤查」情境與說服分類算（不在這裡另外加，免得重複）
        situational: [], context: 'gate',
        scene: `${locationById(state.location).name}・${palace}的大門`,
        outcomes: { critical: '今天放行', success: '今天放行', partial: '不放行，今天不會再聽你說', fail: '不放行，今天不會再聽你說', fumble: '起了疑心，這裡的警戒上升' },
      }
    }
    case 'master_permit':
      return setupPermit(state)
    case 'master_leave':
      return setupLeave(state)
    case 'master_extend':
      return setupExtend(state)
    case 'marking':
      return setupMarking(state)
    case 'master_event':
      return setupMasterEvent(state)
    case 'master_return':
      return setupReturn(state)
    case 'propose': {
      const t = parseProposal(target)
      if (t.kind === 'underworld') {
        const why = underworldProposalBlocked(state)
        if (why) throw new Error(why)
        const { member: master } = masterOf(state)
        const map = underworldOf(state.location)!
        return {
          attr: slaveryRules.propose.attr,
          dc: proposeDc(state, t), targetName: master.name, situational: [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }],
          scene: `${tavernScene(state)}・向${master.name}提議去${map.name}（這座城見不得光的買賣：黑市、淫鬥場、地下俱樂部）`,
          outcomes: {
            critical: `${master.name}答應今天帶你去${map.name}，你也記住了入口（親密度 +${slaveryRules.propose.critical_affinity}）`,
            success: `${master.name}答應今天帶你去${map.name}，你也記住了入口`,
            partial: `${master.name}答應今天帶你去，但不讓你記路`,
            fail: '主人不答應，今天不再提這件事',
            fumble: `主人覺得奴隸不該打聽那種地方（親密度 ${slaveryRules.propose.fumble_affinity}）`,
          },
        }
      }
      if (t.kind !== 'hire' && t.kind !== 'buy') {
        const why = rosterBlocked(state, t.kind, t.npc)
        if (why) throw new Error(why)
        return {
          attr: slaveryRules.propose.attr,
          dc: rosterDc(state, t.kind), targetName: masterOf(state).member.name, situational: [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }],
          scene: rosterScene(state, t.kind, t.npc),
          outcomes: rosterOutcomes(state, t.kind, t.npc),
        }
      }
      const rec = validateProposal(state, t)
      const { member: master } = masterOf(state)
      const cost = proposalCost(state, t)
      const what = t.kind === 'hire' ? `雇用${rec.name}` : `買下${rec.name}`
      const share = Math.round((cost * slaveryRules.propose.partial_share) / 5) * 5
      return {
        attr: slaveryRules.propose.attr,
        dc: proposeDc(state, t), targetName: master.name, situational: [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }],
        scene: t.kind === 'hire' ? `${tavernScene(state)}・向${master.name}提議${what}（要價 ${formatMoney(cost)}）` : `${marketDef(state, t.market).name}・向${master.name}提議${what}（售價 ${formatMoney(cost)}）`,
        outcomes: {
          critical: `${master.name}出錢${what}，對你的提議很滿意（親密度 +${slaveryRules.propose.critical_affinity}）`,
          success: `${master.name}出錢${what}`,
          partial: `${master.name}答應，但要你出 ${formatMoney(share)}`,
          fail: '主人不答應，今天不再提這個人',
          fumble: `主人覺得你多管閒事（親密度 ${slaveryRules.propose.fumble_affinity}）`,
        },
      }
    }
    case 'seek_master':
      return setupSeekMaster(state, target)
    case 'unmark':
      return setupUnmark(state, target)
    case 'unbind':
      return setupUnbind(state, target)
    case 'work':
      return setupWork(state, target)
    case 'train':
      return setupTrain(state, target)
    case 'explore':
      return setupExplore(state)
    case 'perk_pitch':
      return setupPitch(state, target)
    case 'patron':
      return setupPatron(state, target)
    case 'craft':
      return setupCraft(state, target)
    case 'make':
      return setupMake(state, target)
    case 'produce':
      return setupProduce(state, target)
    case 'invent':
      return setupInvent(state, target)
    case 'story':
      return setupStoryCheck(state, target)
    case 'defeat_event':
      return setupDefeatEvent(state, target)
    case 'resign': return setupResign(state, terms)
    case 'negotiate': {
      if (isFugitive(state)) {
        // 逃亡奴隸找到了主人：當面談判，不必在安全的地方，但 DC 較高
        if (!masterNearby(state)) throw new Error(`${contractOf(pc)?.masterName ?? '主人'}不在你身邊`)
        return {
          dc: negotiateDc(state), targetName: contractOf(pc)!.masterName, situational: [],
          scene: `${locationById(state.location).name}・找到逃離的主人`,
          outcomes: { critical: '主人抹去契約，恢復自由（主人親密度 +5）', success: '主人抹去契約，恢復自由', partial: '主人動搖（下次談判 DC -2）', fail: '主人拒絕（親密度 -5）', fumble: '被主人當場抓回去，嚴厲懲罰' },
        }
      }
      if (!atSafeSpot(state)) throw new Error('和主人談判要在安全的地方（旅店、安全房或神殿）')
      const master = contractOf(pc)?.masterName
      return {
        dc: negotiateDc(state), targetName: master, situational: [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }],
        scene: locationById(state.location).name,
        outcomes: { critical: '主人抹去契約，恢復自由（主人親密度 +5）', success: '主人抹去契約，恢復自由', partial: '主人動搖（下次談判 DC -2）', fail: '輕度懲罰', fumble: '嚴厲懲罰，契約束縛加重' },
      }
    }
    case 'escape': {
      const def = contractTerms(contractOf(pc) ?? { terms: termsFromTemplate(slaveryRules.roles.default) })
      return {
        dc: escapeDc(state), targetName: contractOf(pc)?.masterName, situational: [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }],
        scene: locationById(state.location).name,
        outcomes: {
          critical: `逃走，契約仍在（成為逃亡奴隸）；印記反噬減半`,
          success: `逃走，契約仍在（成為逃亡奴隸）；印記反噬 ${Math.round(def.escape_hp_ratio * 100)}% 生命值`,
          partial: `逃走但受重傷（印記反噬加倍）`,
          fail: '被發現，輕度懲罰',
          fumble: '當場被抓，嚴厲懲罰，契約束縛加重',
        },
      }
    }
    case 'bargain': {
      const b = bargainSetup(state, target ?? '', offer)
      return { dc: b.dc, targetName: `${b.keeper.name}（${b.deal.title}）`, situational: [], scene: `${locationById(state.location).name}・${b.deal.title}`, outcomes: b.outcomes }
    }
    case 'negotiation': {
      const n = negotiationSetup(state, target ?? '')
      return { dc: n.dc, targetName: n.targetName, situational: [], scene: n.scene, outcomes: n.outcomes }
    }
    case 'rest_talk': {
      const last = state.lastLongRest
      const t = state.time
      if (!last || last.day !== t.day || last.hour !== t.hour || last.minute !== t.minute) throw new Error('要在長休時才能這麼做')
      const atInn = currentCell(state).kind === 'inn'
      if (target === 'guests' && !atInn) throw new Error('只有在旅店才有其他旅客')
      if (target && target !== 'guests' && !state.party.some((m) => m.id === target && !m.isPlayer)) throw new Error('隊伍裡沒有這個人')
      const rec = target && target !== 'guests' ? npcRecord(state, target) : undefined
      const rel = rec ? state.relationships?.[rec.id] : undefined
      const where = atInn ? `${locationById(state.location).name}的旅店` : currentArea(state).kind === 'home' ? `自己的房子（${currentArea(state).name}）` : `${currentArea(state).name}的安全房`
      return {
        dc: (actionRulesBase('rest_talk')) - (rel ? Math.floor(rel.affinity / 25) : 0),
        targetName: target === 'guests' ? '同旅館的旅客' : rec?.name ?? '夥伴們',
        situational: [],
        scene: `${where}・長休`,
        outcomes: target === 'guests'
          ? { critical: '和旅客相談甚歡，結識新朋友', success: '認識一位新朋友', partial: '聊了幾句', fail: '沒什麼交集', fumble: '起了點口角' }
          : { critical: '關係明顯拉近', success: '相處愉快', partial: '平淡地度過', fail: '有點尷尬', fumble: '鬧得不愉快' },
      }
    }
    case 'free': {
      // 對象：主要對象加上同行的對象（最多 max_targets 人），每個人都要在身邊
      const def = actionRules.kinds.free
      const ids = target ? [target, ...others] : others
      if (others.length && !target) throw new Error('先選主要對象')
      if (new Set(ids).size !== ids.length) throw new Error('同一個人選了兩次')
      if (ids.length > (def.max_targets ?? 1)) throw new Error(`一次最多 ${def.max_targets ?? 1} 個對象`)
      const recs = ids.map((id) => {
        const rec = npcRecord(state, id)
        if (!presentHere(state, id)) throw new Error(`${rec?.name ?? '對方'}不在這裡`)
        return rec
      })
      // 對認識之前的人（例如店主）行動，就算認識了
      for (const rec of recs) if (rec) ensureRelationship(state, rec)
      const base = def.base ?? 12
      const dcOf = (id: string, rec: NpcRecord | undefined) => {
        const rel = state.relationships?.[id]
        return base + (rec ? 2 * Math.max(0, lifeTier(rec.level) - lifeTier(pc.level)) : 0) - (rel ? Math.floor(rel.affinity / 25) : 0)
      }
      // 多人時 DC 取最難的那位，每多一人再加一點
      const dc = ids.length ? Math.max(...ids.map((id, i) => dcOf(id, recs[i]))) + (def.extra_target_dc ?? 0) * (ids.length - 1) : base
      const master = isBound(state) ? contractOf(pc)?.master : undefined
      const situational = master && ids.includes(master) ? [{ label: '契約的服從懲罰', value: -obediencePenalty(state) }] : []
      const names = recs.map((r, i) => r?.name ?? ids[i]!)
      return { dc, ...(names.length ? { targetName: names.join('、') } : {}), situational, scene: locationById(state.location).name, outcomes: {} }
    }
  }
}

function actionRulesBase(kind: ActionKind): number {
  return actionRules.kinds[kind].base ?? 12
}
