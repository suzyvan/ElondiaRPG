// 需要玩家回應的事件，用同一個格式排成佇列，在事件視窗（EventCenter.vue）裡一件一件處理：
// - 擋住行動的（戰敗後的處境、對峙、刻印、主人的要求、地下城事件、寄生物的發作、旅途事件、特殊任務的任務點、隊伍滿了的入隊、城鎮事件）：不處理就不能移動、休息；排在前面
// - 可以晚點處理的（AI 提議的關係變化、升級、取得特質的機會）：可以按「稍後」
// 有新的事件時事件視窗自動打開；關掉之後畫面上方顯示「🔔 N 件待處理」。

import { sinkPending } from '@/engine/xpSinks'
import { ref } from 'vue'
import { roadTemplate } from '@/engine/road'
import { blockingNode } from '@/engine/story'
import { pendingTownEvent } from '@/engine/townEvents'
import { pendingDungeonEvent } from '@/engine/dungeonEvents'
import { pendingLeadEvent } from '@/engine/leadEvents'
import { pendingParasiteEvent } from '@/engine/parasiteEvents'
import { pendingPregnancyEvent } from '@/engine/pregnancyEvents'
import type { GameState } from '@/engine/types'
import { contractOf } from '@/engine/tattoos'

export type GameEventKind = 'defeat' | 'standoff' | 'captives' | 'mark' | 'master' | 'road' | 'town' | 'dungeon' | 'lead' | 'lure' | 'parasite' | 'pregnancy' | 'birth' | 'brood' | 'story' | 'join' | 'suggestion' | 'family' | 'levelup' | 'perk' | 'classes'

export interface GameEvent {
  /** 同一件事一直是同一個 id（用來判斷是不是新的事件、記住「稍後」） */
  id: string
  kind: GameEventKind
  icon: string
  title: string
  /** 不處理就不能移動、休息 */
  blocking: boolean
  /** 關係變化：哪一則提議；升級：哪一位隊員；特質：「隊員 id:機會 id」 */
  ref?: string
}

/** 事件視窗開著嗎 */
export const eventDialogOpen = ref(false)
/** 按了「稍後」的事件（這次開啟頁面內有效；玩家自己按「待處理」打開視窗時清掉，見 openEvents） */
export const snoozed = ref(new Set<string>())

/** 玩家自己打開事件視窗（「待處理」的鈴鐺）：按過「稍後」的事件也一起列出來 */
export function openEvents() {
  snoozed.value = new Set()
  eventDialogOpen.value = true
}

function hash(v: unknown): string {
  const text = JSON.stringify(v) ?? ''
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 目前所有要回應的事件（擋住行動的在前）；戰鬥中、正在判定行動時不列出擋住行動的事件 */
export function pendingEvents(state: GameState | null): GameEvent[] {
  if (!state || state.combat) return []
  const out: GameEvent[] = []
  // 正在判定的主動行動（例如回應主人的要求）：判定完再說
  if (!state.pendingAction) {
    if (state.pendingDefeat) out.push({ id: `defeat:${hash(state.pendingDefeat)}`, kind: 'defeat', icon: '⚠️', title: '倒下之後', blocking: true })
    if (state.standoff) out.push({ id: `standoff:${hash(state.standoff)}`, kind: 'standoff', icon: '⚠️', title: '對峙', blocking: true })
    if (state.captives?.npcs.length) out.push({ id: `captives:${hash(state.captives)}`, kind: 'captives', icon: '⛓️', title: '戰後處置', blocking: true })
    if (state.pendingMark) out.push({ id: `mark:${hash(state.pendingMark)}`, kind: 'mark', icon: '🔥', title: '刻下契約印記', blocking: true })
    if (state.pendingMasterEvent) {
      const pm = state.pendingMasterEvent
      const actor = state.party.find((m) => m.id === pm.actor)?.name
      const title = pm.pool === 'owner' ? `調教${actor ?? ''}` : pm.pool === 'slave' ? `${actor ?? '奴隸'}來找你` : pm.pool === 'brothel_work' ? `${actor ?? ''}在娼館接客` : pm.pool === 'brothel_train' ? `${actor ?? ''}在娼館受訓`
        : `${contractOf(state.party.find((m) => m.isPlayer))?.masterName || '主人'}的要求`
      out.push({ id: `master:${hash(pm)}`, kind: 'master', icon: pm.pool?.startsWith('brothel') ? '🌹' : pm.pool === 'slave' ? '💞' : '⛓️', title, blocking: true })
    }
    if (state.dungeonEvent) out.push({ id: `dungeon:${state.dungeonEvent.template}:${state.dungeonEvents?.last ?? 0}`, kind: 'dungeon', icon: '⚠️', title: pendingDungeonEvent(state)?.title ?? '眼前的處境', blocking: true })
    if (state.leadEvent) out.push({ id: `lead:${state.leadEvent.lead}`, kind: 'lead', icon: '🔎', title: pendingLeadEvent(state)?.title ?? '線索', blocking: true })
    if (state.trapLure) out.push({ id: `lure:${state.trapLure.area}:${state.time.day}:${state.time.hour}:${state.time.minute ?? 0}`, kind: 'lure', icon: '⚠️', title: '察覺到的陷阱', blocking: true })
    if (state.parasiteEvent) out.push({ id: `parasite:${state.parasiteEvent.template}:${state.parasiteEvents?.last ?? 0}`, kind: 'parasite', icon: '💗', title: pendingParasiteEvent(state)?.title ?? '身上的寄生物', blocking: true })
    if (state.pregnancyEvent) {
      // 懷孕、泌乳、苗床的事件都在這裡（pregnancyEvents.ts）
      const t = pendingPregnancyEvent(state)
      const icon = t?.scope === 'lactation' ? '💧' : t?.scope === 'brood' ? '🪺' : '🍼'
      out.push({ id: `pregnancy:${state.pregnancyEvent.template}:${state.pregnancyEvents?.last ?? 0}`, kind: 'pregnancy', icon, title: t?.title ?? '身體的變化', blocking: true })
    }
    if (state.pendingBirth) {
      const pb = state.pendingBirth
      const who = state.party.find((m) => (pb.mother === 'pc' ? m.isPlayer : m.id === pb.mother))
      out.push({ id: `birth:${pb.mother}:${pb.wild ? 1 : 0}`, kind: 'birth', icon: '🍼', title: who?.isPlayer ? '要生了' : `${who?.name ?? ''}要生了`, blocking: true })
    }
    if (state.pendingBroodBirth) out.push({ id: `brood:${state.pendingBroodBirth.parasite}`, kind: 'brood', icon: '🪺', title: '體內的東西要出來了', blocking: true })
    if (state.roadEvent) out.push({ id: `road:${state.roadEvent.x}:${state.roadEvent.template}`, kind: 'road', icon: '🧭', title: roadTemplate(state.roadEvent.template)?.title ?? '旅途上的事', blocking: true })
    // 走到特殊任務的任務點：處理、稍候（不緊急的）或放棄（緊急的）
    const story = blockingNode(state)
    if (story) out.push({ id: `story:${story.ref}`, kind: 'story', icon: '⭐', title: `${story.def.title}：${story.node.title}`, blocking: true, ref: story.ref })
    // 事件或 AI 讓人入隊時隊伍滿了：騰出位子或放棄
    for (const j of state.pendingJoins ?? []) {
      const name = state.npcs?.[j.npcs[0]!]?.name ?? state.relationships?.[j.npcs[0]!]?.name ?? '有人'
      out.push({ id: `join:${j.id}`, kind: 'join', icon: '🤝', title: j.kind === 'follow' ? `${name}邀請你同行` : `${name}${j.npcs.length > 1 ? `等 ${j.npcs.length} 人` : ''}想加入隊伍`, blocking: true, ref: j.id })
    }
    if (state.townEvent) {
      // 家裡的事（homeEvents.ts）也走城鎮事件的視窗
      const ev = pendingTownEvent(state)
      const home = ev?.scope === 'home'
      out.push({ id: `town:${state.townEvent.template}:${(home ? state.homeEvents?.last : state.townEvents?.last) ?? 0}`, kind: 'town', icon: home ? '🏠' : '🏘️', title: ev?.title ?? (home ? '家裡的事' : '城裡的事'), blocking: true })
    }
  }
  // 新職業（武夫、仙術師）之前的存檔：要不要把炎華之地的一批冒險者改成新職業（只問一次，可以稍後）
  if (state.classRebalance?.offer && !state.classRebalance.done) out.push({ id: 'classes:rebalance', kind: 'classes', icon: '🎓', title: '炎華之地的新職業', blocking: false })
  // 懷孕的通知（察覺、陣痛、不在隊上的人生下的孩子）：按「知道了」寫成一筆日誌
  if (state.familyNotices?.length) out.push({ id: `family:${hash(state.familyNotices)}`, kind: 'family', icon: '🍼', title: '家人的消息', blocking: false })
  for (const s of state.suggestions ?? []) {
    const name = state.relationships?.[s.npc]?.name ?? s.npc
    out.push({ id: `suggestion:${s.id}`, kind: 'suggestion', icon: '💞', title: `${name}和你的關係有了變化`, blocking: false, ref: s.id })
  }
  for (const m of state.party) {
    const choices = m.pendingAbilityChoices?.length ?? 0
    if (!choices && !(m.attrPoints > 0)) continue
    const what = [choices ? `選擇 ${choices} 項能力` : '', m.attrPoints > 0 ? `分配 ${m.attrPoints} 點屬性` : ''].filter(Boolean).join('、')
    // 全部是用經驗換來的（鑽研技能、苦練屬性）時不寫成升級
    const sink = sinkPending(m)
    // 神殿洗點退回來的點（respec.ts）不寫成升級
    const respec = Math.min(m.respecPoints ?? 0, Math.max(0, m.attrPoints - sink.attr))
    const fromLevel = choices > sink.ability || m.attrPoints > sink.attr + respec
    const title = fromLevel ? `${m.name}升級了：${what}` : respec ? `${m.name}在神殿洗點：${what}` : `${m.name}用經驗換來的成長：${what}`
    out.push({ id: `levelup:${m.id}:${m.level}:${choices}:${m.attrPoints}`, kind: 'levelup', icon: '⬆️', title, blocking: false, ref: m.id })
  }
  for (const m of state.party) {
    for (const o of m.perkOffers ?? []) {
      out.push({ id: `perk:${m.id}:${o.id}:${o.pitched ? 1 : 0}`, kind: 'perk', icon: '🌟', title: `${m.name}有機會學會特質（${o.source}）`, blocking: false, ref: `${m.id}:${o.id}` })
    }
  }
  return out
}

/** 還沒按「稍後」的事件（擋住行動的不能稍後） */
export function activeEvents(state: GameState | null): GameEvent[] {
  return pendingEvents(state).filter((e) => e.blocking || !snoozed.value.has(e.id))
}
