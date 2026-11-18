// 打贏冒險者之後被制伏的人：等主角處置（見 docs/NPC_SYSTEM.md 第 8.2 節）。
//
// 戰鬥結束時（combat.ts 的 settleNpcFoes）倒下的人不再直接死亡，而是記在 state.captives，擋住移動與休息，直到每個人都處置完：
// - 處決：死亡（從名單移除）
// - 放過：留在原地、敵對，今天不會再打起來；對方先動手時，對方欠你一份情（親密度上升）
// - 收為奴隸：以奴隸身分加入隊伍（要有空位），打上預設的契約，以 1 HP 加入
// - 處置時可以順便劫財、劫色，和處置寫成同一篇日誌
// - 也可以先用主動行動對他做任何事（審問、勸降……），交給 AI 判定，之後再處置
// 處置時也可以寫下怎麼做（例如怎麼處決、放過時說了什麼），記在報告的 player_intent 交給 AI 寫經過；結果不變
// 劫財、劫色、處決與收為奴隸有後果：依誰先動手（security.json 的 captives），有衛兵的聚落加警戒、所屬勢力扣聲望；
// 主角偷襲時沒有人看到，就不加警戒。

import { leaveHousehold } from './staff'
import { snapshot } from './character'
import { formatMoney } from './money'
import { locationById, npcTags, regionById } from './data'
import { currentArea, getArea } from './grid'
import { npcRecord, registerNpc } from './npcs'
import { addAffinity, isEnslaved, joinParty, partyRoom, pcOf } from './party'
import { alertLevel, consequences, isWanted, securityRules } from './security'
import { ensureRelationship } from './social'
import { addHours, commitReport, newReportId, withRng } from './state'
import { failStoriesOnDeath, refreshStoryMarkers } from './story'
import type { Captives, GameState, NpcRecord, Report } from './types'

export type CaptiveChoice = 'execute' | 'release' | 'enslave'
/** 處置時順便做的事：劫財、劫色 */
export type CaptiveDeed = 'rob' | 'violate'

type Cost = Record<Captives['aggressor'], { alert: number; reputation: number }>
interface CaptiveRules {
  enslave: Cost
  execute: Cost
  rob: Cost
  violate: Cost
  rob_money_per_level: number
  affinity: Record<CaptiveDeed, number>
  release_affinity: number
}
const rules = (securityRules as unknown as { captives: CaptiveRules }).captives

/** 還在等處置的人（已經不在了的略過） */
export function captiveRecords(state: GameState): NpcRecord[] {
  return (state.captives?.npcs ?? []).map((id) => npcRecord(state, id)).filter((r): r is NpcRecord => !!r && !r.dead)
}

export function isCaptive(state: GameState, id: string): boolean {
  return !!state.captives?.npcs.includes(id)
}

/**
 * 處置（連同順便做的事）會有什麼後果（給畫面顯示）：警戒只在有衛兵的聚落裡、而且偷襲有人看到時才加；
 * wanted = 這樣做會讓警戒到頂、被通緝
 */
export function captiveConsequence(state: GameState, choice: CaptiveChoice, deeds: CaptiveDeed[] = []): { alert: number; reputation: number; wanted: boolean } {
  const c = state.captives
  if (!c) return { alert: 0, reputation: 0, wanted: false }
  const acts = [...deeds, ...(choice === 'release' ? [] : [choice])]
  const sum = acts.reduce((s, a) => ({ alert: s.alert + rules[a][c.aggressor].alert, reputation: s.reputation + rules[a][c.aggressor].reputation }), { alert: 0, reputation: 0 })
  const alert = guarded(state) && !c.unseen ? sum.alert : 0
  const loc = locationById(c.location)
  const wanted = alert > 0 && !!loc.faction && !isWanted(state, loc.faction) && alertLevel(state, c.location) + alert >= securityRules.alert.max
  return { alert, reputation: sum.reputation, wanted }
}

function guarded(state: GameState): boolean {
  const c = state.captives
  if (!c) return false
  try {
    return getArea(state, c.area).kind === 'settlement'
  } catch {
    return false
  }
}

function report(state: GameState, rec: NpcRecord, tags: string[]): Report {
  const area = currentArea(state)
  const loc = locationById(area.location)
  const pc = pcOf(state)
  const start = { ...state.time }
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'event',
    time: { start, end: addHours(start, 10 / 60) },
    location: { at: area.location, region: loc.region, scene: area.name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    others: [{ id: rec.id, name: rec.name, level: rec.level }],
    outcome: { result: 'neutral', summary: '', tags: ['戰後處置', ...tags] },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name, rec.name],
  }
}

/** 對好人等的額外聲望（標籤的 crime_reputation）：只在主角先動手時算 */
function crimeReputation(state: GameState, rec: NpcRecord): number {
  if (state.captives?.aggressor !== 'party') return 0
  return (rec.tags ?? []).reduce((sum, t) => sum + (npcTags.tags[t]?.crime_reputation ?? 0), 0)
}

const DEED_TAG: Record<CaptiveDeed, string> = { rob: '劫財', violate: '劫色' }
const CHOICE_TAG: Record<CaptiveChoice, string> = { release: '放過', enslave: '奴隸', execute: '處決' }

/**
 * 處置一位被制伏的人，連同處置前順便做的事（劫財、劫色）寫成同一篇日誌。
 * text 是玩家描述的做法（怎麼搜身、怎麼處決、放過時說了什麼……），交給 AI 寫經過。
 */
export function resolveCaptive(state: GameState, id: string, choice: CaptiveChoice, text = '', deeds: CaptiveDeed[] = []): Report {
  const c = state.captives
  if (!c?.npcs.includes(id)) throw new Error('這個人不在你手上')
  if (state.combat) throw new Error('戰鬥中')
  if (state.pendingAction) throw new Error('還有一個行動等待判定')
  const rec = npcRecord(state, id)
  if (!rec) throw new Error('找不到這個人')
  const todo = [...new Set(deeds)]
  if (choice === 'enslave' && partyRoom(state) < 1) throw new Error('隊伍已滿，帶不走更多人')
  if (choice === 'enslave' && isEnslaved(state)) throw new Error('身上還有奴隸印記，不能擁有奴隸')
  const stored = state.npcs?.[rec.id] ?? registerNpc(state, { ...rec })
  // 家裡的人（家僕、幫忙做家務、同居）被制伏：不管怎麼處置，都不再是家裡的人
  leaveHousehold(state, stored)
  const pc = pcOf(state)
  const firstHand = c.aggressor === 'npc' ? '對方先動的手' : '你先動的手'
  const r = report(state, rec, [...todo.map((d) => DEED_TAG[d]), CHOICE_TAG[choice]])
  const lines: string[] = []

  // 處置之前：劫財、劫色
  if (todo.includes('rob')) {
    const money = withRng(state, (rng) => Math.round(rules.rob_money_per_level * rec.level * (0.5 + rng.next())))
    lines.push(`把被制伏的${rec.name}從頭到腳又搜了一遍，連藏起來的錢也翻了出來，拿走 ${formatMoney(money)}。`)
    r.changes.money_cc = money
  }
  if (todo.includes('violate')) {
    lines.push(`${pc.name}趁${rec.name}被制伏時強行佔有了對方。`)
    r.narration = { ...r.narration, length: 'medium', adult_scene: `${pc.name}在戰鬥中制伏了${rec.name}，趁對方無力反抗時強行與對方發生關係` }
  }
  // 處置
  if (choice === 'release') {
    stored.hostile = true
    ;(state.avoided ??= {})[rec.id] = state.time.day
    lines.push(`${todo.length ? '最後' : ''}放過了${rec.name}。`)
    // 對方攔路在先，你卻饒了他：欠你一份情（主角偷襲的話不算）
    if (c.aggressor === 'npc') {
      ensureRelationship(state, rec)
      addAffinity(state, r, rec.id, rules.release_affinity, '戰敗後被放過一馬')
    }
  } else if (choice === 'execute') {
    stored.dead = true
    delete stored.at
    for (const roster of Object.values(state.rosters ?? {})) roster.members = roster.members.filter((x) => x !== rec.id)
    lines.push(`處決了被制伏的${rec.name}（${firstHand}）。`)
    // 不該發生（被制伏的人不能入隊），保險起見：死人不留在隊伍裡
    state.party = state.party.filter((m) => m.id !== rec.id || m.isPlayer)
  } else {
    delete stored.hostile
    lines.push(`把被制伏的${rec.name}收為奴隸（${firstHand}）。`)
    const member = joinParty(state, rec, 'slave', r, { reason: '戰後收為奴隸', toPlayer: '戰敗被制伏後，被主角收為奴隸。' })
    // 剛被打倒：只剩一口氣
    member.hp = 1
    const i = r.party.findIndex((x) => x.id === member.id)
    if (i >= 0) r.party[i] = snapshot(member, undefined, pc)
  }

  // 劫財、劫色的親密度放在處置之後才算：收為奴隸時先照入隊方式給初始親密度；處決的人不留關係
  if (todo.length && choice !== 'execute') {
    ensureRelationship(state, rec)
    for (const d of todo) addAffinity(state, r, rec.id, rules.affinity[d], d === 'rob' ? '被制伏後遭到搜刮' : '被制伏後遭到侵犯')
  }

  const k = captiveConsequence(state, choice, todo)
  if (k.alert || k.reputation) {
    const notes = consequences(state, r, [{ location: c.location, alert: k.alert, reputation: k.reputation + crimeReputation(state, rec) }])
    lines.push(...notes)
  }
  r.outcome.summary = lines.join('')
  if (todo.length) r.narration = { ...r.narration, length: 'medium', focus: ['先後順序：先' + todo.map((d) => DEED_TAG[d]).join('、') + `，再${CHOICE_TAG[choice] === '奴隸' ? '收為奴隸' : CHOICE_TAG[choice]}`] }
  const how = text.trim().slice(0, 400)
  if (how) {
    r.narration = { ...r.narration, player_intent: how }
    r.outcome.summary += `（${how.length > 40 ? `${how.slice(0, 40)}…` : how}）`
  }
  c.npcs = c.npcs.filter((x) => x !== id)
  if (!captiveRecords(state).length) delete state.captives
  // 處決了任務需要的角色：那個任務失敗
  if (choice === 'execute') failStoriesOnDeath(state, r)
  const committed = commitReport(state, r)
  refreshStoryMarkers(state)
  return committed
}
