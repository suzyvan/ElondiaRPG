// 隊伍成員的進出：入隊（雇傭、自願、奴隸、跟著別人的隊伍）、離隊、成為奴隸與獲釋、非戰鬥狀態與懲罰。
// 這些函式直接修改狀態，並把變化記在報告的 changes 裡；報告由呼叫端提交。

import { PARASITE_LOCK } from './parasites'
import { snapshot } from './character'
import { attrName, classes, combatRules, companionRules, locationById, npcs as namedNpcs, slaveryRules, lockedByThing, type AttrId, type Bond } from './data'
import { characterFor, npcRecord, registerNpc } from './npcs'
import { startCrafts } from './crafting'
import { ensureRelationship, setAffinity } from './social'
import { reachable } from './world'
import { tavernSpot } from './grid'
import { contractTerms, makeContract, type MarkChoice } from './slavery'
import { clearContract, contractOf, setContract } from './tattoos'
import type { Character, CompanionChange, ContractRef, GameState, MarkTerms, NpcRecord, Report } from './types'
import { addStrict, sendToMasterHome, syncMasterHome } from './masterHome'
import { enforceClassWeapons, enforceExtraSlots } from './inventory'

const JOIN_TEXT: Record<Bond, string> = {
  hired: '在酒館受雇加入隊伍的冒險夥伴。',
  voluntary: '自願加入隊伍的同伴。',
  slave: '被主角買下的奴隸。',
  leader: '帶著主角一起冒險的隊長。',
  ally: '同一支隊伍的隊員。',
  guest: '因為任務暫時同行的夥伴。',
}

/** 隊伍上限：跟著別人的隊伍（有隊長，包括主人）時放寬（combat.json 的 party_max_following），別人的小隊才帶得上主角 */
export function partyMax(state: GameState): number {
  return state.party.some((m) => m.bond === 'leader') ? Math.max(combatRules.party_max, combatRules.party_max_following ?? combatRules.party_max) : combatRules.party_max
}

/** 隊伍還有幾個名額（任務同行的夥伴不佔名額） */
export function partyRoom(state: GameState): number {
  return partyMax(state) - state.party.filter((m) => m.bond !== 'guest').length
}

/** 加入別人的隊伍時還有幾個名額（以放寬後的上限計）：對方的隊長和隊員要放得進來 */
export function followRoom(state: GameState): number {
  return Math.max(combatRules.party_max, combatRules.party_max_following ?? combatRules.party_max) - state.party.filter((m) => m.bond !== 'guest').length
}

export function pcOf(state: GameState): Character {
  const pc = state.party.find((m) => m.isPlayer)
  if (!pc) throw new Error('no player character')
  return pc
}

/** 主角目前跟著的隊長（加入了別人的隊伍，或身為奴隸被主人帶著） */
export function leaderOf(state: GameState): Character | undefined {
  return state.party.find((m) => m.bond === 'leader')
}

export function isEnslaved(state: GameState): boolean {
  return !!contractOf(pcOf(state))
}

export function isFugitive(state: GameState): boolean {
  return pcOf(state).status.includes('fugitive')
}

/** 主角被主人帶著（有契約、有主人、沒有逃亡） */
export function isBound(state: GameState): boolean {
  return isEnslaved(state) && !!contractOf(pcOf(state))!.master && !isFugitive(state)
}

export function assertFree(state: GameState, what = '這麼做') {
  if (isBound(state)) throw new Error(`身為奴隸，不能${what}`)
}

function recordChange(report: Report | undefined, change: CompanionChange) {
  if (report) (report.changes.companions ??= []).push(change)
}

export interface JoinOptions {
  /** 奴隸的印記：模板 id 或自訂的條款 */
  contract?: MarkChoice
  group?: string
  reason?: string
  /** 取代預設的關係文字（例如戰後收為奴隸，不是買來的） */
  toPlayer?: string
  /** 隊員是別人（主人）的奴隸：契約屬於這個人（bond 是 ally） */
  ownedBy?: { id: string; name: string }
}

/** NPC 入隊。新認識的角色依入隊方式設定初始親密度。 */
export function joinParty(state: GameState, rec: NpcRecord, bond: Bond, report?: Report, opts: JoinOptions = {}): Character {
  if (state.party.some((m) => m.id === rec.id)) throw new Error(`${rec.name}已經在隊伍裡了`)
  if (bond === 'guest') {
    if (state.party.filter((m) => m.bond === 'guest').length >= companionRules.guest_max) throw new Error(`任務同行的夥伴最多 ${companionRules.guest_max} 人`)
  } else if (partyRoom(state) < 1 && bond !== 'leader') throw new Error(`隊伍最多 ${partyMax(state)} 人`)
  const known = !!state.relationships?.[rec.id]
  const rel = ensureRelationship(state, rec)
  if (!known) setAffinity(state, rec.id, companionRules.initial_affinity[bond])
  if (opts.toPlayer) rel.toPlayer = opts.toPlayer
  else if (rel.toPlayer === '初次見面。') rel.toPlayer = JOIN_TEXT[bond]
  const member = characterFor(state, rec)
  // 第一次入隊的人工藝從 0 級開始（工匠身分那一門 Lv.2）；離隊再回來的照原本的
  if (!rec.character && !member.crafts) member.crafts = startCrafts(rec.tags, rec.crafts)
  delete member.group
  clearContract(member)
  member.status = member.status.filter((s) => s !== 'slave_mark')
  member.bond = bond
  member.affinity = rel.affinity
  member.joined = { ...state.time }
  if (opts.group) member.group = opts.group
  if (bond === 'slave') {
    setContract(member, makeContract(opts.contract ?? slaveryRules.roles.default, 'pc', pcOf(state).name, state.time), state.time, pcOf(state).name)
    member.status.push('slave_mark')
  } else if (opts.ownedBy) {
    // 主人買下的奴隸：跟著主人的隊伍，契約屬於主人
    setContract(member, makeContract(opts.contract ?? slaveryRules.roles.default, opts.ownedBy.id, opts.ownedBy.name, state.time), state.time, opts.ownedBy.name)
    member.status.push('slave_mark')
  }
  const stored = state.npcs?.[rec.id]
  if (stored) {
    delete stored.character
    // 剛離隊時在酒館待著的格子、留守與寄放：回到隊伍就不算了
    delete stored.at
    delete stored.staying
    delete stored.stayingSince
    // 被打過、放過的對手：入隊之後就不再敵對
    delete stored.hostile
  }
  state.party.push(member)
  // 存檔規則「職業武器限制」：帶著職業不能用的武器入隊時，武器收進行囊
  const stowed = [...enforceClassWeapons(state, [member]), ...enforceExtraSlots(state, [member])]
  if (report && stowed.length) (report.stowed ??= []).push(...stowed)
  if (namedNpcs.some((n) => n.id === rec.id) && !state.recruited.includes(rec.id)) state.recruited.push(rec.id)
  if (report && !report.party.some((p) => p.id === member.id)) report.party.push(snapshot(member, undefined, pcOf(state)))
  recordChange(report, { npc: rec.id, name: rec.name, change: 'joined', bond, ...(opts.reason ? { reason: opts.reason } : {}) })
  return member
}

/** NPC 離隊：角色資料存回 NPC 登錄，留在目前的地點。 */
export function leaveParty(state: GameState, id: string, report?: Report, reason?: string): Character {
  const i = state.party.findIndex((m) => m.id === id && !m.isPlayer)
  if (i < 0) throw new Error('隊伍中沒有這位角色')
  const member = state.party.splice(i, 1)[0]!
  const rec = npcRecord(state, id) ?? { id, name: member.name, race: member.race, class: member.class, level: member.level, location: state.location, hire_cc: 0, personality: member.personality ?? '' }
  const stored: Character = JSON.parse(JSON.stringify(member)) as Character
  delete stored.bond
  delete stored.group
  // 離隊的人回到這座城鎮的酒館；在冒險區域離隊則回到最近的聚落
  const home = locationById(state.location).type === 'dungeon'
    ? reachable(state.location).find((r) => locationById(r.id).type !== 'dungeon')?.id ?? rec.location
    : state.location
  // 在那座城的酒館待幾天（companions.json 的 leave_stay_days），之後才照自己的活動範圍走動
  const at = tavernSpot(home)
  const base: NpcRecord = { ...rec }
  delete base.staying
  delete base.stayingSince
  delete base.at
  registerNpc(state, {
    ...base, level: member.level, location: home, spot: 'tavern', character: stored,
    ...(at ? { at: { ...at, until: state.time.day + companionRules.leave_stay_days } } : {}),
  })
  recordChange(report, { npc: id, name: member.name, change: 'left', ...(member.bond ? { bond: member.bond } : {}), ...(reason ? { reason } : {}) })
  // 隊長（主人）離開：留在酒館、主人家裡等他的隊員不再等（masterRoster.ts），回到各自的生活
  if (member.bond === 'leader') releaseWaiting(state, id)
  return member
}

/** 主人留在酒館、主人家裡等他帶上的隊員（masterRoster.ts）不再等，回到各自的生活（主人離隊、主角獲釋時） */
export function releaseWaiting(state: GameState, master: string) {
  for (const r of Object.values(state.npcs ?? {})) {
    if (!r.staying || !r.character || r.character.group !== master) continue
    delete r.staying
    delete r.stayingSince
    delete r.at
    delete r.character.bond
    delete r.character.group
  }
}

/** 隊長和他帶來的隊員 */
export function leaderGroup(state: GameState): Character[] {
  const leader = leaderOf(state)
  return leader ? state.party.filter((m) => m.id === leader.id || m.group === leader.id) : []
}

/**
 * 在報告裡記一筆親密度變化（提交報告時才寫入）。同一份報告對同一人的多次變化會累加。
 */
export function addAffinity(state: GameState, report: Report, npc: string, delta: number, reason?: string) {
  const rel = state.relationships?.[npc]
  if (!rel || delta === 0) return
  const list = (report.changes.affinity ??= [])
  const prev = [...list].reverse().find((a) => a.npc === npc)
  const base = prev ? prev.after : rel.affinity
  const after = Math.max(-100, Math.min(100, base + Math.round(delta)))
  list.push({ npc, delta: after - base, after, ...(reason ? { reason } : {}) })
}

// ---- 非戰鬥狀態 ----

export function addCondition(c: Character, id: string, report?: Report) {
  if (c.status.includes(id)) return
  c.status.push(id)
  if (report) (report.changes.conditions ??= []).push({ actor: c.id, condition: id, added: true })
}

export function removeCondition(c: Character, id: string, report?: Report) {
  if (!c.status.includes(id)) return
  c.status = c.status.filter((s) => s !== id)
  if (report) (report.changes.conditions ??= []).push({ actor: c.id, condition: id, added: false })
}

/** 非戰鬥狀態造成的檢定懲罰（受罰等；負數是加值）。attr：這次檢定的屬性（只影響某些屬性的狀態要對上才算） */
export function conditionPenalty(c: Character, attr?: AttrId): number {
  return conditionModifiers(c, attr).reduce((sum, x) => sum - x.value, 0)
}

/** 非戰鬥狀態對這次檢定的修正（每個狀態一行，正數是加值） */
export function conditionModifiers(c: Character, attr?: AttrId): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = []
  for (const s of c.status) {
    const def = companionRules.conditions[s]
    if (!def?.check_penalty) continue
    if (def.check_attrs?.length && (!attr || !def.check_attrs.includes(attr))) continue
    out.push({ label: def.check_attrs?.length ? `${def.name}（${def.check_attrs.map(attrName).join('、')}）` : def.name, value: -def.check_penalty })
  }
  return out
}

/**
 * 獲得一個非戰鬥狀態，照狀態的規則處理：
 * 同一組（用餐）只留 rank 最高的；已經有了再獲得一次會變成 stacks_to（喝酒 → 微醺）；replaces 會拿掉的狀態。
 * 回傳實際得到的狀態（沒有變化時為 undefined）。
 */
export function gainCondition(c: Character, id: string, report?: Report, seen = new Set<string>()): string | undefined {
  const def = companionRules.conditions[id]
  // seen：自訂內容把 stacks_to 接成一圈時不要無限遞迴
  if (!def || seen.has(id)) return undefined
  seen.add(id)
  if (def.stacks_to && (c.status.includes(id) || c.status.includes(def.stacks_to))) {
    return id === def.stacks_to ? undefined : gainCondition(c, def.stacks_to, report, seen)
  }
  if (c.status.includes(id)) return undefined
  if (def.group) {
    const same = c.status.filter((s) => s !== id && companionRules.conditions[s]?.group === def.group)
    if (same.some((s) => (companionRules.conditions[s]!.rank ?? 0) >= (def.rank ?? 0))) return undefined
    for (const s of same) removeCondition(c, s, report)
  }
  for (const s of def.replaces ?? []) removeCondition(c, s, report)
  addCondition(c, id, report)
  return id
}

// ---- 主角成為奴隸、獲釋、逃亡 ----

/** 無法戰鬥的隊員（普通人）：同行但不參與戰鬥、不分經驗 */
export function isNoncombatant(c: Pick<Character, 'class'>): boolean {
  return !!classes[c.class]?.noncombat
}

/**
 * 主角成為奴隸：原本的同伴與主角分開（離隊），主人與他的隊員入隊。
 * 主角身上刻下契約印記（部位依條款）。
 */
export function enslavePlayer(state: GameState, master: NpcRecord | null, contract: MarkChoice, report?: Report, members: NpcRecord[] = []) {
  const pc = pcOf(state)
  if (contractOf(pc)) throw new Error('主角已經是奴隸了')
  for (const m of [...state.party]) if (!m.isPlayer) leaveParty(state, m.id, report, '與主角分開')
  delete state.pendingLeave
  state.partyOffers = []
  if (master && !state.npcs?.[master.id]) registerNpc(state, master)
  if (master) {
    joinParty(state, master, 'leader', report, { group: master.id })
    for (const m of members) if (partyRoom(state) > 0) joinParty(state, m, 'ally', report, { group: master.id })
  }
  // 無主：契約印記還在，但沒有人帶著主角
  const made = makeContract(contract, master?.id ?? '', master?.name ?? '', state.time)
  setContract(pc, made, state.time, master?.name)
  addCondition(pc, 'slave_mark', report)
  recordChange(report, { npc: 'pc', name: pc.name, change: 'enslaved', reason: `${contractTerms(made).name}，${master ? `主人：${master.name}` : '無主'}` })
  // 主人在自己的城市有一棟房子（離家期限從現在算起）
  syncMasterHome(state)
}

/**
 * 解除主角的契約（談判成功、事件獎勵）。主人仍在隊伍中，關係變成普通的隊長與隊員；
 * 主人留在酒館、主人家裡的隊員不再等（主角不能再向主人提議帶上）。
 */
export function freePlayer(state: GameState, report?: Report, reason?: string) {
  const pc = pcOf(state)
  const master = contractOf(pc)?.master
  if (!clearContract(pc)) return
  if (master) releaseWaiting(state, master)
  // 主人強制裝上的東西：契約解除後可以拿下了
  for (const g of Object.values(pc.gear ?? {})) {
    if (!g?.locked || g.locked.startsWith(PARASITE_LOCK) || lockedByThing(g.locked)) continue
    // 主人的鎖跟著主人走（陷阱鎖不受契約影響）
    delete g.locked
    delete g.lock
  }
  removeCondition(pc, 'slave_mark', report)
  removeCondition(pc, 'fugitive', report)
  recordChange(report, { npc: 'pc', name: pc.name, change: 'freed', ...(reason ? { reason } : {}) })
  // 不再是主人的家：拿掉（人在裡面時站到門口）
  syncMasterHome(state)
}

/** 解除 NPC 奴隸的契約：變成自願同行的同伴，親密度上升。 */
export function freeSlave(state: GameState, id: string, report: Report) {
  const m = state.party.find((x) => x.id === id && x.bond === 'slave')
  if (!m) throw new Error('隊伍中沒有這位奴隸')
  clearContract(m)
  m.bond = 'voluntary'
  removeCondition(m, 'slave_mark', report)
  addAffinity(state, report, id, slaveryRules.release_affinity, '解除契約')
  recordChange(report, { npc: id, name: m.name, change: 'freed', bond: 'voluntary' })
}

/** 主角逃離主人：主人與他的隊員離隊，主角成為逃亡奴隸，契約仍在。 */
export function playerEscapes(state: GameState, report?: Report) {
  const pc = pcOf(state)
  if (!contractOf(pc)) throw new Error('主角不是奴隸')
  for (const m of leaderGroup(state)) leaveParty(state, m.id, report, '主角逃走了')
  addCondition(pc, 'fugitive', report)
  recordChange(report, { npc: 'pc', name: pc.name, change: 'escaped', reason: `逃離${contractOf(pc)!.masterName}` })
}

/**
 * 逃亡奴隸被主人找到（或自己回去）：主人回到隊伍（隊伍滿了就讓最後入隊的同伴離開），把主角帶回主人的家。
 * strict：之後嚴加看管的點數（出門與出城更難）。回傳被帶回家的說明。
 */
export function recapturePlayer(state: GameState, report?: Report, strict = 0): string {
  const pc = pcOf(state)
  const contract = contractOf(pc)
  if (!contract) return ''
  const master = npcRecord(state, contract.master)
  removeCondition(pc, 'fugitive', report)
  if (!master) return ''
  while (partyRoom(state) < 1) {
    const last = [...state.party].reverse().find((m) => !m.isPlayer)
    if (!last) break
    leaveParty(state, last.id, report, '主角被抓回去，被迫分開')
  }
  joinParty(state, master, 'leader', report, { group: master.id })
  recordChange(report, { npc: 'pc', name: pc.name, change: 'recaptured', reason: `被${master.name}找到` })
  addStrict(state, strict)
  return report ? sendToMasterHome(state, report) : ''
}

/**
 * 替換主角的主人：印記（條款與服從懲罰）沿用，主人換人；master 為 null 時變成無主。
 * 原本帶著主角的主人與他的隊員離隊，新主人以隊長身分入隊（隊伍滿了就讓最後入隊的同伴離開），逃亡狀態解除。
 * 事件、AI（change_master 效果）與「投靠新主人」都走這裡。
 */
/** 跟著別人的隊伍時的人數上限（主人帶著主角時也是這個） */
function followingMax(): number {
  return Math.max(combatRules.party_max, combatRules.party_max_following ?? combatRules.party_max)
}

/**
 * 換主人時，為了讓新主人（與他帶著的 followers 位隊員）加入、超過跟隨時的上限而得離開的同伴（從隊伍最後面算起）。
 * 新主人原本就在隊上、原主人的隊伍會先離開，都不佔位子。確認視窗用來先寫出誰會離開
 */
export function masterBumped(state: GameState, master: Pick<NpcRecord, 'id'> | null, followers = 0): Character[] {
  if (!master) return []
  const gone = new Set<string>([master.id, ...(isBound(state) ? leaderGroup(state).map((m) => m.id) : [])])
  const stay = state.party.filter((m) => !gone.has(m.id) && m.bond !== 'guest')
  const over = stay.length + 1 + followers - followingMax()
  return over > 0 ? stay.filter((m) => !m.isPlayer).slice(-over) : []
}

export function changeMaster(state: GameState, master: NpcRecord | null, report?: Report, reason?: string, followers: NpcRecord[] = []) {
  const pc = pcOf(state)
  const c = contractOf(pc)
  if (!c) throw new Error('主角不是奴隸')
  if (master?.id === c.master && isBound(state)) return
  // 主人帶著主角時，隊伍上限是跟隨時的上限：只有真的放不下（新主人與他的隊員加入後超過）才請最後面的同伴離開
  const bumped = masterBumped(state, master, followers.length)
  // 新主人原本就在隊伍裡（同伴、原主人的隊員）：先離隊，再以隊長身分回來
  if (master && state.party.some((m) => m.id === master.id)) leaveParty(state, master.id, report, '成為主角的主人')
  if (isBound(state)) {
    for (const m of leaderGroup(state)) leaveParty(state, m.id, report, master ? `把${pc.name}交給了${master.name}` : `放棄了${pc.name}`)
  }
  removeCondition(pc, 'fugitive', report)
  const old = c.masterName || '無主'
  // 新主人有自己的家與規矩：許可（離家期限）、嚴加看管重新算
  delete c.home
  delete c.homeAt
  delete c.permit
  delete c.strict
  // 前一位主人「今天不准」的紀錄（出城、出門）與舊存檔當天的同意也一起清掉
  delete state.masterRefuse
  delete state.masterHouseRefuse
  delete state.masterPass
  delete state.masterHousePass
  // 主僕關係是兩個人之間的事：換了主人重新開始
  delete c.style
  Object.assign(c, { master: master?.id ?? '', masterName: master?.name ?? '', since: { ...state.time } })
  if (master && !state.npcs?.[master.id]) registerNpc(state, master)
  if (master) {
    for (const m of bumped) if (state.party.includes(m)) leaveParty(state, m.id, report, '主角換了主人，隊伍放不下，被迫分開')
    // 剛離隊的人用登錄裡的資料（保留等級、經驗與能力）
    joinParty(state, npcRecord(state, master.id) ?? master, 'leader', report, { group: master.id })
    // 新主人帶著自己的小隊：隊員跟著入隊（和請小隊帶主角同行一樣）
    for (const f of followers) if (!state.party.some((m) => m.id === f.id)) joinParty(state, npcRecord(state, f.id) ?? f, 'ally', report, { group: master.id })
  }
  if (master) {
    // 原本對主角的看法留著，接上「主角的主人」
    const rel = ensureRelationship(state, master)
    const was = rel.toPlayer?.trim()
    rel.toPlayer = !was || was === '初次見面。' ? '主角的主人。' : was.includes('主角的主人') ? was : `${was}現在是主角的主人。`
  }
  recordChange(report, { npc: 'pc', name: pc.name, change: 'transferred', reason: `${old} → ${master?.name ?? '無主'}${reason ? `（${reason}）` : ''}` })
  syncMasterHome(state)
}

/** 懲罰：扣生命值、親密度，重罰時服從懲罰加重。 */
export function punish(state: GameState, severity: 'light' | 'heavy', report: Report): string {
  const pc = pcOf(state)
  const p = slaveryRules.freedom.punishment[severity]
  const loss = Math.max(1, Math.ceil(pc.maxHp * p.hp_ratio))
  setHp(state, pc, pc.hp - loss, report)
  addCondition(pc, 'punished', report)
  const contract = contractOf(pc)
  if (contract) {
    if (state.relationships?.[contract.master]) addAffinity(state, report, contract.master, p.affinity, '受罰')
    if (p.obedience) contract.obedience = Math.min(slaveryRules.freedom.obedience_max, contract.obedience + p.obedience)
  }
  return `受到${severity === 'heavy' ? '嚴厲的' : ''}懲罰，失去 ${loss} 點生命值${p.obedience ? '，契約的束縛更緊了' : ''}。`
}

/** 改變生命值（不會因此倒下，至少留 1 點），同步報告快照 */
export function setHp(state: GameState, c: Character, hp: number, report?: Report) {
  const before = c.hp
  c.hp = Math.max(1, Math.min(c.maxHp, Math.round(hp)))
  if (!report) return
  const snap = report.party.find((p) => p.id === c.id)
  if (snap) snap.hp = [snap.hp?.[0] ?? before, c.hp, c.maxHp]
}

/** 可以受訓的人（學特質、克服缺陷、學工藝）：主角，與自己的夥伴（任務同行、跟著別人的隊伍、主人與他的隊員不算） */
export function trainees(state: GameState): Character[] {
  return state.party.filter((m) => m.isPlayer || (m.bond !== 'guest' && m.bond !== 'leader' && !m.group))
}
