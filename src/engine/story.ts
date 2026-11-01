// 特殊任務：人工編寫的任務鏈（data/rules/stories.json，內容頁籤可以編輯；說明見 docs/STORY_QUESTS.md）。
//
// - 任務從公會、固定 NPC、旅途或情報商開始；開始時設定開頭的劇情旗標。
// - 任務點依劇情旗標解鎖、依序出現：在聚落裡、站在某種設施上、某位固定 NPC 在身邊，或是近郊、地下城某一層的任務點（⭐）。
// - 任務點是劇情（直接發生）、判定（擲骰，可以描述做法交給 AI 判定）、戰鬥或選擇；結果設定或清除旗標、給效果、
//   讓固定 NPC 以「任務同行」加入或離開，也可以完成或失敗整個任務。
// - 每次推進都產生一份報告（report.story），也記在任務的經過（冒險筆記）。

import { affinityStage, snapshot } from './character'
import { endpointsIn } from './specialMaps'
import { storySpotProblem } from './specialMapMods'
import { startCombat, type CombatState } from './combat'
import { playerRank, storyMerit } from './guild'
import { RANK_ORDER } from './materialQuests'
import {
  contentRevision, locationById, npcs as namedNpcs, regionById, specialMaps, stories, type Degree, type DungeonLayerId, type StoryAffinity, type StoryCheck, type StoryDef, type StoryNode, type StoryOutcome, DUNGEON_LAYER_NAME,
} from './data'
import { applyEffects, type RewardEffect } from './effects'
import { blockKeys, cellName, currentArea, currentCell, DUNGEON_LAYERS, getArea, position, type Area, type CellKind } from './grid'
import { wearNote } from './gear'
import { wearLocks } from './inventory'
import { formatMoney } from './money'
import { npcRecord, registerNpc } from './npcs'
import { joinParty, leaveParty, pcOf } from './party'
import { nearbyPeople, presentHere } from './population'
import type { Rng } from './rng'
import { addHours, commitReport, newReportId, withRng } from './state'
import { applyTimeJump, dayPartOk, DAY_PART_NAME, hoursUntil } from './timeOfDay'
import { addCounters, afterFrom, clampCounters, condMet, flagKey } from './storyFlags'
import { pcBodyAllowed, tagsAllowed } from './content'
import { characterBody } from './look'
import { applyPendingMove, queueMove } from './road'
import { restEventBlock } from './rest'
import type { GameState, GameTime, NpcRecord, Report, StoryProgress } from './types'

export function storyDef(id: string): StoryDef | undefined {
  return stories.find((s) => s.id === id)
}

export function storyProgress(state: GameState, id: string): StoryProgress | undefined {
  return state.stories?.[id]
}

/** 任務點的參照：任務 id:任務點 id */
export function nodeRef(story: string, node: string): string {
  return `${story}:${node}`
}

function parseRef(ref: string): { def: StoryDef; node: StoryNode } {
  const i = ref.lastIndexOf(':')
  const def = storyDef(ref.slice(0, i))
  const node = def?.nodes.find((n) => n.id === ref.slice(i + 1))
  if (!def || !node) throw new Error('找不到這個任務點')
  return { def, node }
}

// ---- 開始 ----

/** 建議的公會階級：和公會委託一樣，同級或更低，組隊（2 人以上）時可以高一級；沒寫時不限 */
export function storyRankOk(state: GameState, def: Pick<StoryDef, 'rank'>): boolean {
  if (!def.rank) return true
  const mine = RANK_ORDER.indexOf(playerRank(state))
  const target = RANK_ORDER.indexOf(def.rank)
  return target <= mine || (state.party.length > 1 && target === mine + 1)
}

/** 還沒開始、條件也符合（建議階級、等級、劇情旗標）。公會、固定 NPC、情報商、旅途的開頭都用這個檢查 */
export function canStart(state: GameState, def: StoryDef): boolean {
  if (state.stories?.[def.id]) return false
  if (!tagsAllowed(def.tags)) return false
  if (!pcBodyAllowed(def.start.pc_body, characterBody(pcOf(state)))) return false
  if (!storyRankOk(state, def)) return false
  if (def.start.min_level && pcOf(state).level < def.start.min_level) return false
  if (def.start.kind === 'npc' && def.start.npc && def.start.min_affinity !== undefined
    && (state.relationships?.[def.start.npc]?.affinity ?? 0) < def.start.min_affinity) return false
  // 任務要找、要同行的人已經死了：接了也做不完
  if (neededNpcs(def, { done: [] }).some((id) => npcRecord(state, id)?.dead)) return false
  return condMet(state, def.start.requires)
}

/** 這裡可以接的特殊任務：公會（站在這座城的公會）、固定 NPC（在身邊） */
export function storyOffersHere(state: GameState): StoryDef[] {
  const area = currentArea(state)
  const cell = currentCell(state)
  const present = presence(state)
  return stories.filter((def) => {
    if (!canStart(state, def)) return false
    const s = def.start
    if (s.kind === 'guild') return area.kind === 'settlement' && cell.kind === 'guild' && (!s.location || s.location === area.location)
    if (s.kind === 'npc') return !!s.npc && npcFree(state, s.npc) && !npcRecord(state, s.npc)!.hostile && present(s.npc)
    return false
  })
}

/**
 * 有沒有特殊任務要用到這個地標：進行中（沒暫停）的任務還沒做的任務點在這一格，或現在接得到的任務的任務點在這一格、委託人待在這個地標。
 * 只有場景的地標沒有場景可選時，靠這個決定要不要留在地圖上（例如打工線的委託人所在）
 */
export function storyNeedsLandmark(state: GameState, id: string): boolean {
  const atCell = (n: StoryNode) => n.at.where === 'cell' && n.at.cell === id
  // 只看用到這個地標的任務（每走一步、每個地標都會問一次，掃全部任務太慢）
  return storiesAtLandmark(id).some((def) => {
    const p = state.stories?.[def.id]
    if (p) return p.status === 'active' && !storyPaused(state, def) && def.nodes.some((n) => !p.done.includes(n.id) && atCell(n))
    return canStart(state, def)
  })
}

/** 地標 → 用到它的任務（任務點在這一格，或委託人待在這個地標）；內容改了（contentRevision）才重算 */
let landmarkStories: { rev: number; map: Map<string, StoryDef[]> } | undefined
function storiesAtLandmark(id: string): StoryDef[] {
  if (landmarkStories?.rev !== contentRevision()) {
    const npcLandmark = new Map(namedNpcs.filter((n) => n.landmark).map((n) => [n.id, n.landmark!]))
    const map = new Map<string, StoryDef[]>()
    for (const def of stories) {
      const ids = new Set(def.nodes.flatMap((n) => (n.at.where === 'cell' && n.at.cell ? [n.at.cell] : [])))
      const giver = def.start.kind === 'npc' && def.start.npc ? npcLandmark.get(def.start.npc) : undefined
      if (giver) ids.add(giver)
      for (const x of ids) map.set(x, [...(map.get(x) ?? []), def])
    }
    landmarkStories = { rev: contentRevision(), map }
  }
  return landmarkStories.map.get(id) ?? []
}

/** 被制伏、等你處置的人 */
export function isCaptive(state: GameState, id: string): boolean {
  return !!state.captives?.npcs.includes(id)
}

/** 這位角色還活著、沒有被制伏（任務可以找他、讓他加入、和他交手） */
export function npcFree(state: GameState, id: string): boolean {
  const rec = npcRecord(state, id)
  return !!rec && !rec.dead && !isCaptive(state, id)
}

function storyReport(state: GameState, def: StoryDef, status: NonNullable<Report['story']>['status'], hours: number, node?: StoryNode): Report {
  const start = { ...state.time }
  const area = currentArea(state)
  const loc = locationById(area.location)
  const pc = pcOf(state)
  const npcNames = [def.start.npc, node?.at.npc, ...(node?.foes ?? []), ...(node?.allies ?? [])].map((id) => (id ? npcRecord(state, id)?.name : undefined)).filter((n): n is string => !!n)
  const others = node ? presentOthers(state, node) : []
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'event',
    time: { start, end: addHours(start, hours) },
    location: { at: area.location, region: loc.region, scene: area.name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    ...(others.length ? { others } : {}),
    story: { id: def.id, title: def.title, ...(node ? { node: node.id } : {}), status },
    outcome: { result: 'neutral', tags: ['特殊任務'] },
    changes: {},
    narration: { pov: 'second_person', length: 'medium', focus: [`特殊任務「${def.title}」`] },
    lore_keys: [...new Set([loc.name, regionById(loc.region).name, ...npcNames])],
  }
}

/** 任務點在場的人（友方與身邊的固定 NPC）：記在報告的 others，AI 寫經過時會帶上他們的關係與記憶 */
function presentOthers(state: GameState, node: StoryNode): { id: string; name: string }[] {
  // 友方、身邊的固定 NPC、檢定參考好感的角色
  const affinityIds = [node.check?.affinity?.npc, ...(node.options ?? []).map((o) => o.check?.affinity?.npc)].filter((x): x is string => !!x)
  const ids = [...new Set([...(node.allies ?? []), ...(node.at.npc ? [node.at.npc] : []), ...affinityIds])]
  return ids
    .filter((id) => !state.party.some((m) => m.id === id))
    .map((id) => npcRecord(state, id))
    .filter((r): r is NonNullable<typeof r> => !!r && !r.dead)
    .map((r) => ({ id: r.id, name: r.name }))
}

/** 在場的友方的名字（判定的場景說明用） */
function allyNames(state: GameState, node: StoryNode): string {
  return (node.allies ?? []).map((id) => npcRecord(state, id)?.name).filter(Boolean).join('、')
}

/** 冒險筆記的經過：at 是這件事結束的時間（報告的結束時間，含結果推進的時間；沒有時是現在） */
function log(p: StoryProgress, state: GameState, text: string, node?: string, at?: GameTime) {
  p.log.push({ time: { ...(at ?? state.time) }, text, ...(node ? { node } : {}) })
}

function setFlags(report: Report, names: string[] | undefined, value: boolean) {
  for (const f of names ?? []) (report.changes.flags ??= {})[flagKey(f)] = value
}

/** 開始任務：設定開頭的旗標，記下任務的經過。text 是開頭的事件描述（旅途、情報商）。 */
export function startStory(state: GameState, id: string, opts: { text?: string; report?: Report } = {}): Report {
  const def = storyDef(id)
  if (!def) throw new Error('找不到這個特殊任務')
  if (state.stories?.[id]) throw new Error('這個任務已經開始過了')
  const progress: StoryProgress = { id, status: 'active', started: { ...state.time }, done: [], log: [] }
  ;(state.stories ??= {})[id] = progress
  const report = opts.report ?? storyReport(state, def, 'started', 0.5)
  report.story = { id, title: def.title, status: 'started' }
  setFlags(report, def.start_flags, true)
  // 接下任務時拿到的物品（例如打工的制服）
  if (def.start.items?.length) applyEffects(state, report, def.start.items.map((name) => ({ type: 'item' as const, name, qty: 1 })))
  const text = opts.text ?? def.start.text ?? def.summary
  log(progress, state, text)
  const locks = storyWearLocks(state, def)
  report.outcome = { result: 'success', summary: `接下特殊任務「${def.title}」：${def.summary}${locks ? `（${locks}）` : ''}`, tags: [...new Set([...(report.outcome.tags ?? []), '特殊任務'])] }
  report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), text] }
  if (def.start.pc_body?.length) report.narration = { ...report.narration, body_limited: true }
  if (opts.report) return report
  const committed = commitReport(state, report)
  refreshStoryMarkers(state)
  return committed
}

// ---- 任務點 ----

export interface ActiveNode { def: StoryDef; node: StoryNode; ref: string }

/**
 * 任務暫停的原因：內容標籤在設定裡被關掉（成人向、NTR、男性對象……），或主角的體型不符合任務的限定（pc_body：
 * 「陽剛體型也能遇到」的設定關掉了，或在角色設定改了體型）。任務點不出現、不擋人，重新開啟（改回來）後接著進行
 */
export function storyPauseReason(state: GameState, def: Pick<StoryDef, 'tags' | 'start'>): 'tags' | 'body' | undefined {
  if (!tagsAllowed(def.tags)) return 'tags'
  if (!pcBodyAllowed(def.start.pc_body, characterBody(pcOf(state)))) return 'body'
  return undefined
}

export function storyPaused(state: GameState, def: Pick<StoryDef, 'tags' | 'start'>): boolean {
  return !!storyPauseReason(state, def)
}

/** 進行中的任務裡已經解鎖、還沒結束的任務點 */
export function activeNodes(state: GameState): ActiveNode[] {
  const out: ActiveNode[] = []
  for (const p of Object.values(state.stories ?? {})) {
    if (p.status !== 'active') continue
    const def = storyDef(p.id)
    if (!def || storyPaused(state, def)) continue
    for (const node of def.nodes) {
      if (p.done.includes(node.id) || !condMet(state, node.requires)) continue
      out.push({ def, node, ref: nodeRef(def.id, node.id) })
    }
  }
  return out
}

/**
 * 只差「幾天之後」的任務點（其他條件都成立、時間還沒到）：冒險筆記寫「第幾天以後」，玩家知道什麼時候回來。
 * from 是開放的時間
 */
export function nodesWaitingForDays(state: GameState): (ActiveNode & { from: GameTime })[] {
  const out: (ActiveNode & { from: GameTime })[] = []
  for (const p of Object.values(state.stories ?? {})) {
    if (p.status !== 'active') continue
    const def = storyDef(p.id)
    if (!def || storyPaused(state, def)) continue
    for (const node of def.nodes) {
      const after = node.requires?.after
      if (!after || p.done.includes(node.id) || condMet(state, node.requires)) continue
      const { after: _, ...rest } = node.requires!
      const from = afterFrom(state, after)
      if (from && condMet(state, rest)) out.push({ def, node, ref: nodeRef(def.id, node.id), from })
    }
  }
  return out
}

/** 主角現在所在的地方有沒有這個任務點 */
export function nodeIsHere(state: GameState, n: ActiveNode, present: Presence = (id) => presentHere(state, id)): boolean {
  // 只在白天或夜裡的任務點：時段不對時不算在這裡（不跳出、不擋路），到了那個時段再來
  if (!dayPartOk(state.time, nodeHours(n.node))) return false
  return nodeIsHereAnyTime(state, n, present)
}

/** 某個角色在不在主角身邊 */
type Presence = (id: string) => boolean

/**
 * 一次查很多任務點時用：身邊的人只算一次（要用到時才算）。
 * 「這裡的人」每算一次要好幾毫秒，進行中的任務一多、每個「找某人」的任務點各算一次，走一步就會卡（docs/plan 的效能紀錄）
 */
function presence(state: GameState): Presence {
  let near: Set<string> | undefined
  return (id) => {
    if (state.party.some((m) => m.id === id)) return true
    if (state.captives?.npcs.includes(id) && state.captives.area === currentArea(state).key) return true
    near ??= new Set(nearbyPeople(state).map((p) => p.rec.id))
    return near.has(id)
  }
}

/** 任務點的時段；旅途上與臨時地圖裡的任務點不看時段（旅途不能停下來等、離開臨時地圖等於放棄，限定時段可能永遠遇不到） */
export function nodeHours(node: Pick<StoryNode, 'hours' | 'at'>): StoryNode['hours'] {
  return node.at.where === 'road' || node.at.where === 'side' ? undefined : node.hours
}

/** 主角在不在任務點上（不看時段） */
function nodeIsHereAnyTime(state: GameState, n: ActiveNode, present: Presence = (id) => presentHere(state, id)): boolean {
  const at = n.node.at
  // 檢定參考好感的角色被制伏了：等處置完再說
  const ref = n.node.check?.affinity?.npc
  if (ref && isCaptive(state, ref)) return false
  const area = currentArea(state)
  if (at.location && at.where !== 'npc' && at.where !== 'road' && at.where !== 'side' && at.where !== 'special' && area.location !== at.location) return false
  switch (at.where) {
    case 'road': return area.kind === 'road'
    case 'side':
    case 'special': return currentCell(state).kind === 'quest' && currentCell(state).storyNode === n.ref
    case 'settlement': return area.kind === 'settlement'
    case 'cell': return area.kind === 'settlement' && currentCell(state).kind === at.cell
    // 先看地點（便宜），再看身邊的人（要算「這裡的人」）
    case 'npc': return !!at.npc && (!at.location || area.location === at.location) && npcFree(state, at.npc) && present(at.npc)
    case 'outskirts':
    case 'dungeon': return currentCell(state).kind === 'quest' && currentCell(state).storyNode === n.ref
  }
  return false
}

export function nodesHere(state: GameState): ActiveNode[] {
  const present = presence(state)
  return activeNodes(state).filter((n) => nodeIsHere(state, n, present))
}

/** 站在任務點上、但時段不對的任務點（地點面板提醒要等到白天或夜裡） */
export function nodesWaitingForTime(state: GameState): ActiveNode[] {
  const present = presence(state)
  return activeNodes(state).filter((n) => !dayPartOk(state.time, nodeHours(n.node)) && nodeIsHereAnyTime(state, n, present))
}

/** 在原地等到這個任務點的時段（白天是早上 8 點，夜裡是 20 點）：記一則簡短的日誌 */
export function waitForNode(state: GameState, ref: string): Report {
  const n = activeNodes(state).find((x) => x.ref === ref)
  const part = n && nodeHours(n.node)
  if (!n || !part) throw new Error('這個任務點不用等')
  if (dayPartOk(state.time, part)) throw new Error('現在就可以進行')
  if (!nodeIsHereAnyTime(state, n)) throw new Error('要在任務點才能等')
  if (state.road) throw new Error('旅途中沒辦法停下來等')
  // 和休息一樣：俘虜、對峙、事件……要先處理
  const blocked = restEventBlock(state)
  if (blocked) throw new Error(blocked)
  const hours = hoursUntil(state.time, part === 'night' ? 'night' : 'morning')
  const report = storyReport(state, n.def, 'progress', hours, n.node)
  const name = DAY_PART_NAME[part]
  report.outcome = { result: 'neutral', summary: `在${currentArea(state).name}等到${name}，準備「${n.def.title}」的${n.node.title}。`, tags: ['等待'] }
  report.narration = { pov: 'second_person', length: 'short', focus: [`為了特殊任務「${n.def.title}」等到${name}`] }
  return commitReport(state, report)
}

function active(state: GameState, ref: string): ActiveNode & { progress: StoryProgress } {
  const { def, node } = parseRef(ref)
  const progress = state.stories?.[def.id]
  if (!progress || progress.status !== 'active' || storyPaused(state, def) || progress.done.includes(node.id) || !condMet(state, node.requires)) throw new Error('這個任務點現在沒辦法進行')
  return { def, node, ref, progress }
}

/** 地點的說明（冒險筆記用）；只在白天或夜裡的任務點加上時段 */
export function placeText(n: StoryNode, state?: GameState): string {
  const where = placeName(n, state)
  const part = nodeHours(n)
  return part ? `${where}・只在${DAY_PART_NAME[part]}` : where
}

function placeName(n: StoryNode, state?: GameState): string {
  const at = n.at
  const loc = at.location ? locationById(at.location).name : ''
  const LAYER = DUNGEON_LAYER_NAME
  switch (at.where) {
    case 'settlement': return loc
    case 'cell': return `${loc}的${at.cell ? cellName(at.cell as CellKind) : '某處'}`
    case 'npc': return `找${(at.npc && (state ? npcRecord(state, at.npc) : namedNpcs.find((x) => x.id === at.npc))?.name) || '某人'}${loc ? `（${loc}）` : ''}`
    case 'outskirts': return `${loc}近郊（⭐）`
    case 'dungeon': return `${loc}・${LAYER[at.layer ?? 'outskirts']}（⭐）`
    case 'road': return '旅途上'
    case 'side': return '臨時地圖裡（⭐）'
    case 'special': return `${specialMaps[at.special_map ?? '']?.name ?? '特殊地圖'}（⭐）`
  }
  return loc
}

/**
 * 進行沒有檢定的任務點：劇情直接發生，選擇的選項沒有檢定時也直接套用；戰鬥任務點開始戰鬥。
 * 有檢定的判定與選項要走主動行動 story（可以描述做法，交給 AI 判定）。
 */
export function playNode(state: GameState, ref: string, option?: number, intent?: string): Report | CombatState {
  const n = active(state, ref)
  if (!nodeIsHere(state, n)) throw new Error('要在任務點才能進行')
  const { def, node } = n
  const dress = wearGate(state, node)
  if (dress) throw new Error(dress)
  if (node.kind === 'combat') {
    // 已經死了、被制伏的角色不上場；對手都不在了就直接算勝利
    const foes = (node.foes ?? []).filter((id) => npcFree(state, id))
    const allies = (node.allies ?? []).filter((id) => npcFree(state, id))
    if (!node.enemies?.length && !foes.length) {
      const report = storyReport(state, def, 'progress', 0.5, node)
      if (intent) report.narration = { ...report.narration, player_intent: intent }
      const gone = (node.foes ?? []).map((id) => npcRecord(state, id)?.name).filter(Boolean).join('、')
      const lines = resolveOutcome(state, report, n.progress, def, node, node.success, true, '')
      report.outcome = { ...report.outcome, result: 'success', summary: `${gone ? `${gone}已經不在了，` : ''}沒有交手。${lines.join('')}` }
      report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), `${gone || '對手'}已經死了或被制伏，這場戰鬥沒有發生`] }
      const committed = commitReport(state, report)
      refreshStoryMarkers(state)
      applyPendingMove(state)
      return committed
    }
    return startCombat(state, node.enemies ?? [], {
      story: { id: def.id, node: node.id }, scene: `${currentArea(state).name}・${node.title}`,
      ...(node.rut ? { fieldRut: true } : {}),
      ...(foes.length ? { npcs: foes } : {}),
      ...(allies.length ? { allies } : {}),
      ...(intent ? { intent } : {}),
    })
  }
  let outcome: StoryOutcome | undefined
  let label = ''
  if (node.kind === 'choice') {
    const o = node.options?.[option ?? -1]
    if (!o) throw new Error('沒有這個選項')
    if (!optionOpen(state, node, option!)) throw new Error('這個選項現在不能選')
    if (o.check) throw new Error('這個選項要檢定')
    const gate = storyCostGate(state, node, option)
    if (gate) throw new Error(gate)
    outcome = o.success
    label = o.label
  } else if (node.kind === 'story') {
    const gate = storyCostGate(state, node)
    if (gate) throw new Error(gate)
    outcome = node.success
  } else {
    throw new Error('判定的任務點要擲骰')
  }
  const report = storyReport(state, def, 'progress', 1, node)
  if (intent) report.narration = { ...report.narration, player_intent: intent }
  const lines = resolveOutcome(state, report, n.progress, def, node, outcome, true, label)
  report.outcome = { ...report.outcome, result: 'success', summary: lines.join('') }
  const committed = commitReport(state, report)
  refreshStoryMarkers(state)
  applyPendingMove(state)
  return committed
}

// ---- 判定（主動行動 story） ----

/** target：任務 id:任務點 id，選擇的選項再加 :選項序號 */
function parseTarget(target: string | undefined): { ref: string; option?: number } {
  const parts = (target ?? '').split(':')
  if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1]!)) return { ref: parts.slice(0, -1).join(':'), option: Number(parts[parts.length - 1]) }
  return { ref: target ?? '' }
}

/** 結果裡要付的錢（扣款加總，沒有時 0） */
function outcomeCost(o: StoryOutcome | undefined): number {
  return (o?.effects ?? []).reduce((sum, e) => sum + (e.type === 'money' && e.amount < 0 ? -e.amount : 0), 0)
}

/** 任務點（或選項）成功、失敗時要付的錢；戰鬥不算（打輸的代價不用事先準備） */
export function storyCosts(node: StoryNode, option?: number): { success: number; fail: number } {
  const src = option !== undefined ? node.options?.[option] : node.kind === 'combat' ? undefined : node
  return { success: outcomeCost(src?.success), fail: outcomeCost(src?.fail) }
}

/** 任務要穿的（各任務點的 wear）有被鎖住的欄位擋住時的提醒（接任務的時候顯示）；沒有時是 undefined */
export function storyWearLocks(state: GameState, def: StoryDef): string | undefined {
  const locks = wearLocks(pcOf(state), [...new Set(def.nodes.flatMap((n) => n.wear ?? []))])
  return locks.length ? `提醒：${locks.join('；')}，要先拿下來才能進行這個任務` : undefined
}

/** 沒有穿上任務點的限定穿著（node.wear）時的說明；穿好了是 undefined */
export function wearGate(state: GameState, node: Pick<StoryNode, 'wear'>): string | undefined {
  return wearNote(pcOf(state), node.wear)
}

/** 錢不夠付這個任務點（或選項）可能要付的錢時的說明；付得起時是 undefined */
export function storyCostGate(state: GameState, node: StoryNode, option?: number): string | undefined {
  const c = storyCosts(node, option)
  const need = Math.max(c.success, c.fail)
  return need > state.money_cc ? `錢不夠：要準備 ${formatMoney(need)}，身上只有 ${formatMoney(state.money_cc)}` : undefined
}

/** 這條任務線途中最多一次要付多少錢（接任務前提醒；沒有要付錢的地方時 0） */
export function storyMaxCost(def: StoryDef): number {
  return Math.max(0, ...def.nodes.flatMap((n) => [storyCosts(n), ...(n.options ?? []).map((_, i) => storyCosts(n, i))]).map((c) => Math.max(c.success, c.fail)))
}

/** 這個選項現在能不能選（好感、旗標的條件） */
export function optionOpen(state: GameState, node: StoryNode, option: number): boolean {
  const o = node.options?.[option]
  if (o?.check?.affinity && isCaptive(state, o.check.affinity.npc)) return false
  return tagsAllowed(o?.tags) && condMet(state, o?.requires)
}

/** 檢定參考的好感：角色、目前的好感、加值（每 per 點 ±1，最多 ±max）、有沒有到門檻 */
export function storyAffinity(state: GameState, a: StoryAffinity): { name: string; affinity: number; bonus: number; blocked: boolean; min?: number } {
  const affinity = state.relationships?.[a.npc]?.affinity ?? 0
  const per = Math.max(1, a.per ?? 10)
  const max = Math.max(0, a.max ?? 5)
  const raw = Math.trunc(affinity / per)
  const bonus = Math.max(-max, Math.min(max, raw)) || 0
  const name = npcRecord(state, a.npc)?.name ?? a.npc
  return { name, affinity, bonus, blocked: a.min !== undefined && affinity < a.min, ...(a.min !== undefined ? { min: a.min } : {}) }
}

/** 檢定的好感門檻沒過時的說明（沒有門檻或過了是 undefined） */
export function storyCheckGate(state: GameState, target: string): string | undefined {
  const { ref, option } = parseTarget(target)
  const n = active(state, ref)
  const a = checkOf(n.node, option).check.affinity
  if (!a) return undefined
  const x = storyAffinity(state, a)
  return x.blocked ? `${x.name}的好感 ${x.affinity}，不到 ${x.min}` : undefined
}

function checkOf(node: StoryNode, option?: number): { check: StoryCheck; success?: StoryOutcome; fail?: StoryOutcome; label: string } {
  if (node.kind === 'choice') {
    const o = node.options?.[option ?? -1]
    if (!o?.check) throw new Error('這個選項不用檢定')
    return { check: o.check, success: o.success, fail: o.fail, label: o.label }
  }
  if (node.kind !== 'check' || !node.check) throw new Error('這個任務點不用檢定')
  return { check: node.check, success: node.success, fail: node.fail, label: node.title }
}

export function setupStoryCheck(state: GameState, target?: string) {
  const { ref, option } = parseTarget(target)
  const n = active(state, ref)
  if (!nodeIsHere(state, n)) throw new Error('要在任務點才能進行')
  const c = checkOf(n.node, option)
  if (option !== undefined && !optionOpen(state, n.node, option)) throw new Error('這個選項現在不能選')
  const gate = storyCheckGate(state, target ?? '')
  if (gate) throw new Error(`${gate}：沒辦法檢定`)
  const cost = wearGate(state, n.node) ?? storyCostGate(state, n.node, option)
  if (cost) throw new Error(cost)
  const ok = c.success?.text ?? '成功'
  const bad = c.fail?.text ?? '沒有成功（之後可以再試一次）'
  // 參考好感：加值放進情境修正（骰子明細看得到），對方的關係寫進場景給 AI
  const a = c.check.affinity ? storyAffinity(state, c.check.affinity) : undefined
  const rel = c.check.affinity ? state.relationships?.[c.check.affinity.npc] : undefined
  const relText = a ? `${a.name}對主角的好感 ${a.affinity}（${affinityStage(a.affinity)}）${rel?.toPlayer ? `，${a.name}眼中的主角：${rel.toPlayer}` : ''}。` : ''
  const targetName = (n.node.at.npc && npcRecord(state, n.node.at.npc)?.name) || a?.name
  return {
    attr: c.check.attr, dc: c.check.dc, hours: 1,
    situational: a?.bonus ? [{ label: `${a.name}的好感（${a.affinity}）`, value: a.bonus }] : [],
    ...(targetName ? { targetName } : {}),
    scene: `${currentArea(state).name}・特殊任務「${n.def.title}」：${n.node.title}（${c.label}）。${n.node.text}${allyNames(state, n.node) ? `在場的友方：${allyNames(state, n.node)}。` : ''}${relText}`,
    outcomes: { critical: ok, success: ok, partial: `勉強過關：${ok}`, fail: bad, fumble: bad } as Partial<Record<Degree, string>>,
  }
}

/** 結算判定：大成功、成功、部分成功算成功 */
export function applyStoryCheck(state: GameState, report: Report, target: string, degree: Degree): string {
  const { ref, option } = parseTarget(target)
  const n = active(state, ref)
  const c = checkOf(n.node, option)
  const success = degree === 'critical' || degree === 'success' || degree === 'partial'
  report.story = { id: n.def.id, title: n.def.title, node: n.node.id, status: 'progress' }
  report.outcome.tags = [...new Set([...(report.outcome.tags ?? []), '特殊任務'])]
  report.lore_keys = [...new Set([...(report.lore_keys ?? []), n.def.title])]
  const present = presentOthers(state, n.node).filter((o) => !report.others?.some((x) => x.id === o.id))
  if (present.length) report.others = [...(report.others ?? []), ...present]
  const lines = resolveOutcome(state, report, n.progress, n.def, n.node, success ? c.success : c.fail, success, n.node.kind === 'choice' ? c.label : '')
  return lines.join('')
}

/** 好感不到檢定的門檻：不擲骰，直接套用失敗的結果 */
export function failStoryCheck(state: GameState, target: string): Report {
  const gate = storyCheckGate(state, target)
  if (!gate) throw new Error('好感已經夠了，要擲骰')
  const { ref, option } = parseTarget(target)
  const n = active(state, ref)
  if (!nodeIsHere(state, n)) throw new Error('要在任務點才能進行')
  const c = checkOf(n.node, option)
  const report = storyReport(state, n.def, 'progress', 1, n.node)
  const lines = resolveOutcome(state, report, n.progress, n.def, n.node, c.fail, false, n.node.kind === 'choice' ? c.label : '')
  report.outcome = { ...report.outcome, result: 'failure', summary: `（${gate}，沒有擲骰）${lines.join('')}` }
  report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), `${gate}：對方的態度不夠親近，這件事談不成`] }
  const committed = commitReport(state, report)
  refreshStoryMarkers(state)
  applyPendingMove(state)
  return committed
}

/** 戰鬥任務點結束：勝利套用成功的結果，落敗或撤退套用失敗的結果（沒有失敗的結果時可以再挑戰） */
export function applyStoryCombat(state: GameState, report: Report, ref: { id: string; node: string }, status: CombatState['status']) {
  const progress = state.stories?.[ref.id]
  const def = storyDef(ref.id)
  const node = def?.nodes.find((x) => x.id === ref.node)
  if (!progress || progress.status !== 'active' || !def || !node || progress.done.includes(node.id)) return
  const won = status === 'victory'
  report.story = { id: def.id, title: def.title, node: node.id, status: 'progress' }
  report.outcome.tags = [...new Set([...(report.outcome.tags ?? []), '特殊任務'])]
  const lines = resolveOutcome(state, report, progress, def, node, won ? node.success : node.fail, won, '')
  report.outcome.summary = `${report.outcome.summary ?? ''}${lines.join('')}`
}

/**
 * 套用任務點的結果。失敗而且沒有寫失敗的結果時，任務點保持開放（可以再試）。
 * 回傳摘要的文字。
 */
function resolveOutcome(
  state: GameState, report: Report, progress: StoryProgress, def: StoryDef, node: StoryNode, outcome: StoryOutcome | undefined, success: boolean, label: string,
): string[] {
  const lines = [`「${def.title}」${node.title}${label ? `：${label}` : ''}。`]
  report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), node.text, ...(outcome?.text ? [outcome.text] : [])] }
  // 親密場景：依成人場景規則詳細描寫（交給成人場景正文）
  if (outcome?.scene) report.narration = { ...report.narration, length: report.narration?.length === 'long' ? 'long' : 'medium', adult_scene: outcome.scene }
  if (def.start.pc_body?.length) report.narration = { ...report.narration, body_limited: true }
  if (!outcome) {
    if (!success) {
      lines.push('這次沒有進展，之後可以再試一次。')
      log(progress, state, `${node.title}：沒有成功`, node.id)
      // 離開這裡之後再來才會再擋住你（不然一直被同一個任務點擋著）
      waitHere(state, nodeRef(def.id, node.id))
      return lines
    }
    outcome = {}
  }
  if (outcome.text) lines.push(outcome.text)
  setFlags(report, outcome.set_flags, true)
  setFlags(report, outcome.clear_flags, false)
  addCounters(state, report.changes, outcome.counters)
  for (const id of outcome.deaths ?? []) storyDeath(state, report, def, id, lines)
  // 特質的機會：來源寫成這個特殊任務
  const sourced = (list: RewardEffect[]) => list.map((e) => (e.type === 'perk' && !e.source ? { ...e, source: `特殊任務「${def.title}」` } : e))
  const notes = outcome.effects?.length ? applyEffects(state, report, sourced(outcome.effects)) : []
  if (notes.length) lines.push(notes.join('，') + '。')
  if (outcome.join) {
    const rec = npcRecord(state, outcome.join)
    if (rec && !npcFree(state, rec.id)) {
      lines.push(`（${rec.name}${rec.dead ? '已經不在人世' : '被制伏了'}，沒辦法同行）`)
    } else if (rec && !state.party.some((m) => m.id === rec.id)) {
      try {
        joinParty(state, rec, 'guest', report, { reason: `特殊任務「${def.title}」` })
        progress.guests = [...new Set([...(progress.guests ?? []), rec.id])]
        lines.push(`${rec.name}暫時和你們同行。`)
      } catch (e) {
        lines.push(`（${rec.name}沒辦法同行：${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }
  if (outcome.leave) leaveGuest(state, report, progress, outcome.leave, lines)
  // 結束時把時間往前推（推到夜裡、隔天早上）
  const later = applyTimeJump(state, report, outcome.time)
  if (later) lines.push(later)
  // 進入臨時地圖、改去別的地點：報告提交之後執行
  queueMove(state, outcome)
  if (state.pendingMove?.side_map) state.pendingMove.story = def.id
  if (!outcome.retry) progress.done = [...new Set([...progress.done, node.id])]
  else waitHere(state, nodeRef(def.id, node.id))
  log(progress, state, `${node.title}${label ? `（${label}）` : ''}：${outcome.text ?? (success ? '完成' : '失敗')}`, node.id, report.time.end)
  if (outcome.complete) finishStory(state, report, progress, def, 'completed', lines)
  else if (outcome.fail_quest) finishStory(state, report, progress, def, 'failed', lines)
  return lines
}

function leaveGuest(state: GameState, report: Report, progress: StoryProgress, id: string, lines: string[]) {
  const m = state.party.find((x) => x.id === id && x.bond === 'guest')
  if (!m) return
  leaveParty(state, id, report, '任務同行結束')
  progress.guests = (progress.guests ?? []).filter((g) => g !== id)
  lines.push(`${m.name}和你們分開了。`)
}

function finishStory(state: GameState, report: Report, progress: StoryProgress, def: StoryDef, status: 'completed' | 'failed', lines: string[]) {
  progress.status = status
  // 結束的時間是這份報告結束的時候（「結束後幾天」從這裡算）
  progress.ended = { ...report.time.end }
  report.story = { id: def.id, title: def.title, ...(report.story?.node ? { node: report.story.node } : {}), status }
  if (status === 'completed') report.changes.merit = (report.changes.merit ?? 0) + (def.merit ?? storyMerit())
  if (status === 'completed' && def.rewards?.length) {
    const notes = applyEffects(state, report, def.rewards.map((e) => (e.type === 'perk' && !e.source ? { ...e, source: `完成特殊任務「${def.title}」` } : e)))
    const money = def.rewards.filter((r) => r.type === 'money').reduce((s, r) => s + (r as { amount: number }).amount, 0)
    lines.push(`完成特殊任務「${def.title}」${money ? `，得到 ${formatMoney(money)}` : ''}${notes.length ? `：${notes.join('，')}` : ''}。`)
  } else {
    lines.push(status === 'completed' ? `完成特殊任務「${def.title}」。` : `特殊任務「${def.title}」失敗了。`)
  }
  for (const g of [...(progress.guests ?? [])]) leaveGuest(state, report, progress, g, lines)
  log(progress, state, status === 'completed' ? '任務完成' : '任務失敗', undefined, report.time.end)
  report.outcome.tags = [...new Set([...(report.outcome.tags ?? []), status === 'completed' ? '任務完成' : '任務失敗'])]
}

/**
 * 自訂內容刪掉的特殊任務：存檔裡進行中的算中斷，任務同行的夥伴離隊（不然會一直佔著同行的名額）。
 * 劇情計數器的上下限改了：夾回新的範圍。
 * 讀檔時與自訂內容改變之後呼叫。
 */
export function pruneStories(state: GameState) {
  clampCounters(state)
  for (const p of Object.values(state.stories ?? {})) {
    if (p.status !== 'active' || storyDef(p.id)) continue
    p.status = 'failed'
    p.ended = { ...state.time }
    for (const g of p.guests ?? []) if (state.party.some((m) => m.id === g && m.bond === 'guest')) leaveParty(state, g, undefined, '任務同行結束')
    p.guests = []
    p.log.push({ time: { ...state.time }, text: '這個特殊任務已經不存在，任務中斷' })
  }
  failStoriesOnDeath(state)
  // 舊存檔：臨時地圖裡的任務點，地圖已經不在了（以前離開就刪掉）
  for (const p of Object.values(state.stories ?? {})) {
    const def = p.status === 'active' ? storyDef(p.id) : undefined
    if (!def || state.side?.story === p.id) continue
    if (!sideNodesOpen(state, p.id)) continue
    endQuietly(state, p, '離開了任務的臨時地圖，任務中斷')
  }
}

/** 不經過日誌結束任務（讀檔時整理）：任務同行的夥伴離隊 */
function endQuietly(state: GameState, p: StoryProgress, text: string) {
  p.status = 'failed'
  p.ended = { ...state.time }
  for (const g of p.guests ?? []) if (state.party.some((m) => m.id === g && m.bond === 'guest')) leaveParty(state, g, undefined, '任務同行結束')
  p.guests = []
  p.log.push({ time: { ...state.time }, text })
}

// ---- 角色死亡 ----

/**
 * 任務需要的固定 NPC：開頭的角色、任務同行，還沒結束的任務點要找、要加入的人。
 * 敵對的角色除外（本來就可能被打倒），這個任務自己寫了會死去的角色也除外（故事裡的死亡，見 storyDeath）。
 */
function neededNpcs(def: StoryDef, p: Pick<StoryProgress, 'done' | 'guests'>): string[] {
  const outcomes = (n: StoryNode) => [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])]
  const foes = new Set([...def.nodes.flatMap((n) => n.foes ?? []), ...def.nodes.flatMap((n) => outcomes(n).flatMap((o) => o?.deaths ?? []))])
  const ids: (string | undefined)[] = [def.start.kind === 'npc' ? def.start.npc : undefined, ...(p.guests ?? [])]
  for (const n of def.nodes) {
    if (p.done.includes(n.id)) continue
    const outs = outcomes(n)
    ids.push(n.at.npc, ...outs.map((o) => o?.join))
    for (const o of outs) for (const e of o?.effects ?? []) if (e.type === 'companion' && typeof e.npc === 'string') ids.push(e.npc)
  }
  return [...new Set(ids.filter((x): x is string => !!x))].filter((id) => !foes.has(id))
}

/** 故事裡的死亡（結果的 deaths）：標記死亡、離開隊伍與名單；需要他的「其他」任務失敗（這個任務自己照常進行） */
function storyDeath(state: GameState, report: Report, def: StoryDef, id: string, lines: string[]) {
  const rec = npcRecord(state, id)
  if (!rec || rec.dead) return
  const stored = state.npcs?.[rec.id] ?? registerNpc(state, JSON.parse(JSON.stringify(rec)) as NpcRecord)
  stored.dead = true
  delete stored.at
  for (const r of Object.values(state.rosters ?? {})) r.members = r.members.filter((x) => x !== rec.id)
  if (state.party.some((m) => m.id === rec.id && !m.isPlayer)) leaveParty(state, rec.id, report, '死去')
  state.party = state.party.filter((m) => m.id !== rec.id || m.isPlayer)
  for (const p of Object.values(state.stories ?? {})) {
    const other = p.status === 'active' && p.id !== def.id ? storyDef(p.id) : undefined
    if (!other || !neededNpcs(other, p).includes(rec.id)) continue
    log(p, state, `${rec.name}死了，特殊任務「${other.title}」沒辦法繼續`)
    finishStory(state, report, p, other, 'failed', lines)
  }
}

/** 任務需要的角色死了：任務失敗。有報告時寫進報告（處決、戰鬥），沒有時（讀檔）直接結束 */
export function failStoriesOnDeath(state: GameState, report?: Report) {
  for (const p of Object.values(state.stories ?? {})) {
    const def = p.status === 'active' ? storyDef(p.id) : undefined
    if (!def) continue
    const dead = neededNpcs(def, p).map((id) => npcRecord(state, id)).find((r) => r?.dead)
    if (!dead) continue
    const why = `${dead.name}死了，特殊任務「${def.title}」沒辦法繼續`
    if (!report) {
      endQuietly(state, p, why)
      continue
    }
    const lines: string[] = []
    log(p, state, why)
    finishStory(state, report, p, def, 'failed', lines)
    report.outcome.summary = `${report.outcome.summary ?? ''}${why}。${lines.join('')}`
  }
}

/** 這個任務還有沒完成的臨時地圖任務點 */
export function sideNodesOpen(state: GameState, id: string): boolean {
  return activeNodes(state).some((n) => n.def.id === id && n.node.at.where === 'side')
}

/** 放棄進行中的任務（why：不是玩家自己放棄時的原因，例如離開了任務的臨時地圖） */
export function abandonStory(state: GameState, id: string, why?: string): Report {
  const progress = state.stories?.[id]
  const def = storyDef(id)
  if (!progress || progress.status !== 'active' || !def) throw new Error('沒有進行中的這個任務')
  const report = storyReport(state, def, 'failed', 0)
  const lines: string[] = []
  if (why) log(progress, state, why)
  finishStory(state, report, progress, def, 'failed', lines)
  report.outcome = { ...report.outcome, result: 'neutral', summary: `${why ? `${why}，` : ''}放棄了特殊任務「${def.title}」。${lines.slice(1).join('')}` }
  report.narration = { length: 'short' }
  const committed = commitReport(state, report)
  refreshStoryMarkers(state)
  return committed
}

/** 過了期限（time_limit）的任務：失敗（deadlines.ts） */
export function expireStory(state: GameState, id: string): Report {
  const progress = state.stories?.[id]
  const def = storyDef(id)
  if (!progress || progress.status !== 'active' || !def) throw new Error('沒有進行中的這個任務')
  const report = storyReport(state, def, 'failed', 0)
  const lines: string[] = []
  finishStory(state, report, progress, def, 'failed', lines)
  log(progress, state, '過了期限')
  report.outcome = { ...report.outcome, result: 'failure', summary: `特殊任務「${def.title}」過了期限，失敗了。${lines.slice(1).join('')}`, tags: [...new Set([...(report.outcome.tags ?? []), '任務逾期'])] }
  report.narration = { length: 'short' }
  const committed = commitReport(state, report)
  refreshStoryMarkers(state)
  return committed
}

// ---- 走到任務點：先處理（稍候或放棄） ----

/** 任務點所在的「這裡」：按了稍候之後，離開這裡再回來才會再觸發 */
function placeKey(state: GameState, n: ActiveNode): string {
  const area = currentArea(state)
  const p = position(state)
  switch (n.node.at.where) {
    case 'road': return state.road ? `road:${state.road.from}>${state.road.to}@${state.road.start.day}:${state.road.start.hour ?? 0}` : 'road'
    case 'settlement': return `town:${area.location}`
    case 'npc': return `npc:${area.key}`
    default: return `${area.key}@${p.x},${p.y}`
  }
}

/** 這個任務點在這裡按過稍候（或剛試過沒有進展） */
export function waitingHere(state: GameState, n: ActiveNode): boolean {
  return state.storyWaits?.[n.ref] === placeKey(state, n)
}

function waitHere(state: GameState, ref: string) {
  const n = activeNodes(state).find((x) => x.ref === ref)
  if (!n || !nodeIsHere(state, n)) return
  const open = new Set(activeNodes(state).map((x) => x.ref))
  // 結束的任務點不用記
  state.storyWaits = Object.fromEntries(Object.entries(state.storyWaits ?? {}).filter(([k]) => open.has(k)))
  state.storyWaits[ref] = placeKey(state, n)
}

/** 離開了按過稍候的地方：忘掉那次稍候，之後再來會再觸發（每個動作之後呼叫） */
export function forgetStoryWaits(state: GameState) {
  if (!state.storyWaits) return
  const here = new Map(nodesHere(state).map((n) => [n.ref, placeKey(state, n)]))
  for (const [ref, key] of Object.entries(state.storyWaits)) if (here.get(ref) !== key) delete state.storyWaits[ref]
  if (!Object.keys(state.storyWaits).length) delete state.storyWaits
}

/** 擋住移動、休息的任務點：在這裡、還沒按稍候的第一個 */
export function blockingNode(state: GameState): ActiveNode | undefined {
  if (state.combat || state.pendingAction) return undefined
  return nodesHere(state).find((n) => !waitingHere(state, n))
}

/** 不緊急的任務點：這次先略過（不記事件），離開這裡之後再來還會觸發 */
export function waitStory(state: GameState, ref: string) {
  const n = active(state, ref)
  if (n.node.urgent) throw new Error('這個任務點很緊急，不能稍候，只能處理或放棄')
  if (!nodeIsHere(state, n)) throw new Error('要在任務點才能進行')
  waitHere(state, ref)
}

// ---- 近郊與地下城的任務點（⭐） ----

function layerId(area: Area): DungeonLayerId | undefined {
  return area.kind === 'dungeon' ? DUNGEON_LAYERS[area.layer ?? 0]?.id as DungeonLayerId : undefined
}

/** 這一區該有哪些任務點 */
function markersFor(state: GameState, area: Area): string[] {
  return activeNodes(state)
    .filter(({ def, node }) => (node.at.where === 'side' && area.kind === 'side' && state.side?.area === area.key && state.side.story === def.id && (!node.at.side_map || node.at.side_map === area.template))
      || (node.at.where === 'special' && area.kind === 'special' && node.at.special_map === area.special) || (node.at.location === area.location && (
      (node.at.where === 'outskirts' && area.kind === 'wild') ||
      (node.at.where === 'dungeon' && area.kind === 'dungeon' && (node.at.layer ?? 'outskirts') === layerId(area)))))
    .map((n) => n.ref)
}

/** 在近郊或地下城的一層放上任務點（已經有的保留） */
export function ensureStoryMarkers(state: GameState, area: Area, rng: Rng) {
  if (area.kind === 'settlement' || area.kind === 'home' || area.kind === 'road') return
  const have = new Set(area.cells.map((c) => c.storyNode).filter(Boolean))
  const entry = area.cells.findIndex((c) => c.kind === 'exit' || c.kind === 'stairs_up')
  // 特殊地圖：通道的端點（關著時是空地）不放任務點
  const avoid = new Set(area.kind === 'special' ? endpointsIn(area.key).map((e) => e.y * area.width + e.x) : [])
  for (const ref of markersFor(state, area)) {
    if (have.has(ref)) continue
    // 固定地圖上指定了格子：放在那一格（不行的格子改成隨機）
    const at = activeNodes(state).find((n) => n.ref === ref)?.node.at
    if (area.kind === 'special' && at?.x !== undefined && at.y !== undefined && !storySpotProblem(area.special ?? '', at.x, at.y)) {
      const i = at.y * area.width + at.x
      if (!area.cells[i]?.storyNode) {
        area.cells[i] = { kind: 'quest' as CellKind, storyNode: ref }
        continue
      }
    }
    const free = area.cells.map((c, i) => (c.kind === 'floor' && i !== entry && i !== entry - area.width && !avoid.has(i) ? i : -1)).filter((i) => i >= 0)
    if (!free.length) return
    const i = free[rng.int(0, free.length - 1)]!
    area.cells[i] = { kind: 'quest' as CellKind, storyNode: ref }
  }
}

/** 重新整理已經生成的區域：補上新解鎖的任務點、拿掉結束的 */
export function refreshStoryMarkers(state: GameState) {
  for (const area of Object.values(state.areas ?? {})) {
    const want = new Set(markersFor(state, area))
    area.cells.forEach((c, i) => {
      if (c.storyNode && !want.has(c.storyNode)) area.cells[i] = { kind: 'floor' }
    })
    withRng(state, (rng) => ensureStoryMarkers(state, area, rng))
  }
}

// ---- 在場的友方站在哪裡 ----

/**
 * 任務點在場的友方固定 NPC 現在站在哪一格：近郊、地下城、臨時地圖的 ⭐ 旁邊，聚落裡任務點的設施上（任何區塊）。
 * 任務點還沒解鎖、已經結束，或那一區還沒生成時為 undefined（照平常的出沒）。
 */
export function allyPlacement(state: GameState, npcId: string): { area: string; x: number; y: number } | undefined {
  // 先便宜地看有沒有進行中的任務把這個人列為友方（每畫一次人群都會叫）
  if (!Object.values(state.stories ?? {}).some((p) => p.status === 'active' && storyDef(p.id)?.nodes.some((n) => n.allies?.includes(npcId)))) return undefined
  for (const n of activeNodes(state)) {
    if (!n.node.allies?.includes(npcId)) continue
    const at = n.node.at
    if (at.where === 'outskirts' || at.where === 'dungeon' || at.where === 'side' || at.where === 'special') {
      for (const area of Object.values(state.areas ?? {})) {
        const i = area.cells.findIndex((c) => c.storyNode === n.ref)
        if (i < 0) continue
        return { area: area.key, ...besideCell(area, i) }
      }
      continue
    }
    if ((at.where === 'cell' || at.where === 'settlement') && at.location) {
      const kind = (at.where === 'cell' ? at.cell : 'gate') as CellKind
      for (const key of blockKeys(at.location)) {
        const area = getArea(state, key)
        const i = area.cells.findIndex((c) => c.kind === kind)
        if (i >= 0) return { area: key, x: i % area.width, y: Math.floor(i / area.width) }
      }
    }
  }
  return undefined
}

/** ⭐ 旁邊一格可以站的地方（沒有時就是 ⭐ 本身） */
function besideCell(area: Area, i: number): { x: number; y: number } {
  const x = i % area.width
  const y = Math.floor(i / area.width)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]] as const) {
    const nx = x + dx
    const ny = y + dy
    const c = nx >= 0 && ny >= 0 && nx < area.width && ny < area.height ? area.cells[ny * area.width + nx] : undefined
    if (c && c.kind !== 'wall' && c.kind !== 'water') return { x: nx, y: ny }
  }
  return { x, y }
}
