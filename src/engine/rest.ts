// 短休與長休（依 D&D 5e）。
//
// - 短休：1 小時，戰鬥以外幾乎都可以。每位隊員可以花生命骰回復生命值（每顆 = 生命骰 + mod(力量) + mod(信仰)，至少 1）。
//   荒野與地下城（安全房以外）有機率在休息時被襲擊。
// - 長休：8 小時，只能在旅店或安全點（地下城的安全房）。生命值與法術環全滿、每次休息的能力重置、
//   回復一半的生命骰（至少 1），解除「受罰」。兩次長休至少隔 long_rest_gap_hours 小時（預設 16，設定裡可以改）。
// - 每次休息結束時進行離隊檢查（見 restChecks）。

import { maybeDungeonEvent } from './dungeonEvents'
import { maybeParasiteEvent } from './parasiteEvents'
import { perksOf } from './perks'
import { attrOf, mod, snapshot } from './character'
import { encounterFor, startCombat, type CombatState } from './combat'
import { abilities, classDef, companionRules, conditionName, homeRules, lewdRules, locationById, regionById, slaveryRules, specialMaps, wildEncounters, type DungeonLayerId } from './data'
import { charmLevel } from './charm'
import { tagsAllowed } from './content'
import { teachAbility } from './effects'
import { addLewd } from './lewd'
import { currentArea, currentCell, DUNGEON_LAYERS } from './grid'
import { comfortOf, comfortTier, hasBed, homeOfArea } from './homes'
import { serveBreakfast } from './staff'
import { maybeHomeEvent } from './homeEvents'
import { morningSickness } from './pregnancy'
import { maybePregnancyEvent } from './pregnancyEvents'
import { formatMoney } from './money'
import { clearInviteCooldowns } from './companions'
import { addAffinity, addCondition, gainCondition, isBound, isFugitive, leaderGroup, leaderOf, leaveParty, pcOf, punish, recapturePlayer, removeCondition } from './party'
import { roll, withBonus, type Rng } from './rng'
import { contractTerms } from './slavery'
import { bestTool } from './tools'
import { addHours, commitReport, newReportId, withRng } from './state'
import type { Character, GameState, GameTime, Report } from './types'
import { contractOf } from './tattoos'
import { gameRule } from './gameRules'
import { squadMates } from './squads'
import { blockingNode } from './story'
import { checkParts, rollBreakdown, sumParts } from './rollParts'

export const INN_CC_PER_PERSON = 15

export function innCost(state: GameState): number {
  const mult = isFugitive(state) ? 2 : 1
  return INN_CC_PER_PERSON * state.party.length * mult
}

// ---- 驛站的奴房（成人向，docs/LEWD_STATS.md 第 20 節） ----

/** 這間旅店有沒有奴房：魅氣濃度夠高、內容篩選沒有關掉「主角非自願」 */
export function slaveRoomOpen(state: GameState): boolean {
  return charmLevel(state.location) >= lewdRules.slave_room.charm_min && tagsAllowed(['pc_unwilling'])
}

/** 奴房的房錢：旅店的 cost_ratio */
export function slaveRoomCost(state: GameState): number {
  return Math.max(1, Math.round(innCost(state) * lewdRules.slave_room.cost_ratio))
}

export function hitDie(c: Character): number {
  return classDef(c.class).hit_die
}

export function hitDiceLeft(c: Character): number {
  return Math.max(0, c.level - (c.hitDiceUsed ?? 0))
}

function hitDieBonus(c: Character): number {
  return mod(attrOf(c, 'str')) + mod(attrOf(c, 'fai'))
}

function minutesBetween(a: GameTime, b: GameTime): number {
  const t = (x: GameTime) => ((x.day - 1) * 24 + (x.hour ?? 0)) * 60 + (x.minute ?? 0)
  return t(b) - t(a)
}

// 兩次長休的最短間隔（小時）：預設 companions.json 的 long_rest_gap_hours，設定的「遊戲規則」可以改（引擎不讀設定，由畫面呼叫）
let longRestGap = companionRules.rest.long_rest_gap_hours

export function setLongRestGap(hours: number | string | null | undefined) {
  // 設定欄清空時（v-model.number 給的是空字串）用預設，不要當成 0 小時
  const h = hours === '' || hours === null || hours === undefined ? NaN : Number(hours)
  longRestGap = Number.isFinite(h) ? Math.max(0, Math.min(24, h)) : companionRules.rest.long_rest_gap_hours
}

export function longRestGapHours(): number {
  return longRestGap
}

/** 還要幾分鐘才能再長休（0＝現在就可以） */
export function longRestWait(state: GameState): number {
  if (!state.lastLongRest) return 0
  return Math.max(0, Math.ceil(longRestGap * 60 - minutesBetween(state.lastLongRest, state.time)))
}

/** 「還要 X 小時 Y 分」 */
export function waitText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} 小時` : '', m ? `${m} 分` : ''].filter(Boolean).join(' ') || '0 分'
}

/** 擋住休息（短休、長休）的事件：對峙、刻印、主人的要求、旅途與城鎮的選擇、戰敗事件；沒有時回傳 null */
export function restEventBlock(state: GameState): string | null {
  if (state.standoff) return '先處理眼前的對峙'
  if (state.pendingMark) return '先完成契約印記的刻印'
  if (state.pendingMasterEvent) return '先回應主人的要求'
  if (state.dungeonEvent || state.parasiteEvent || state.leadEvent || state.pregnancyEvent) return '先應付眼前的處境'
  if (state.trapLure) return '先決定要不要觸發察覺到的陷阱'
  if (state.townEvent || state.roadEvent) return '先決定怎麼應付眼前的事'
  if (state.pendingDefeat) return '先應付眼前的處境'
  if (state.pendingBirth) return '先處理生產'
  if (state.pendingBroodBirth) return '先處理體內的苗床'
  if (state.captives?.npcs.length) return '先決定怎麼處置被制伏的人'
  if (state.pendingJoins?.length) return '先決定要不要讓想入隊的人加入（騰出位子或放棄）'
  const story = blockingNode(state)
  if (story) return `先處理特殊任務「${story.def.title}」：${story.node.title}`
  return null
}

/** 可以紮營長休的地方：近郊的野外、旅途的道路、旅途中的臨時地圖（城裡有旅店，地下城有安全房） */
export const CAMP_AREAS = ['wild', 'road', 'side'] as const

/** 隊伍裡有人會在野外紮營（特質的 camp，例如【星夜露宿】） */
export function partyCamps(state: GameState): boolean {
  return state.party.some((m) => perksOf(m).some((p) => p.camp))
}

/** 這裡能不能紮營長休（不看長休的間隔）：在野外或旅途上、隊伍裡有人會紮營 */
export function canCampHere(state: GameState): boolean {
  return (CAMP_AREAS as readonly string[]).includes(currentArea(state).kind) && partyCamps(state)
}

/** 不能長休的原因；可以時回傳 null */
export function longRestBlocked(state: GameState, place: RestPlace): string | null {
  if (state.combat) return '戰鬥中'
  const event = restEventBlock(state)
  if (event) return event
  const cell = currentCell(state)
  if (place === 'camp') {
    if (!(CAMP_AREAS as readonly string[]).includes(currentArea(state).kind)) return '要在城外的野外或旅途上才能紮營'
    if (!partyCamps(state)) return '隊伍裡要有人懂得在野外紮營（特質【星夜露宿】）'
  }
  if (place === 'home') {
    const home = homeOfArea(state, currentArea(state))
    if (!home) return '要在自己的房子裡'
    // 主人的家：睡在下人房，不用自己的床
    if (!home.master && !hasBed(home)) return '家裡還沒有床'
  }
  if ((place === 'inn' || place === 'slave_room') && cell.kind !== 'inn') return '要在旅店才能長休'
  if (place === 'slave_room' && !slaveRoomOpen(state)) return '這裡的旅店沒有奴房'
  if (place === 'safe' && cell.kind !== 'safe') return '要在安全房才能長休'
  if (place === 'safe' && cell.done) return '這間安全房已經長休過了'
  const wait = longRestWait(state)
  if (wait > 0) return `還要 ${waitText(wait)}才能再長休（兩次長休至少隔 ${longRestGap} 小時）`
  return null
}

function restReport(state: GameState, hours: number, scene: string): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'rest',
    time: { start, end: addHours(start, hours) },
    location: { at: state.location, region: loc.region, scene },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'success' },
    changes: {},
    narration: { pov: 'second_person', length: 'short' },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

/** 在這裡休息被襲擊的機率（安全房、安全的室內 0；帳篷減半；套用存檔規則） */
export function ambushChance(state: GameState): number {
  const area = currentArea(state)
  if (currentCell(state).kind === 'safe') return 0
  if (area.kind === 'special' && specialMaps[area.special ?? '']?.peaceful) return 0
  // 存檔規則的倍率
  const base = Math.min(1, (companionRules.rest.ambush[area.kind] ?? 0) * gameRule(state, 'ambushMult'))
  // 露營類的工具（帳篷）：在城外紮營休息，被襲擊的機率減半
  return area.kind !== 'settlement' && area.kind !== 'home' && bestTool(state, 'camp') ? base / 2 : base
}

/** 休息時襲擊的怪：地下城與洞窟類的臨時地圖用那一層的遭遇，其他用這個地區的野外遭遇 */
function ambushGroup(state: GameState) {
  const area = currentArea(state)
  const layer = area.layer !== undefined ? (DUNGEON_LAYERS[area.layer]?.id as DungeonLayerId) : undefined
  return withRng(state, (rng) => (layer ? encounterFor(state.location, rng, layer) : rng.pick(wildEncounters(locationById(state.location).region))))
}

/** 自動決定要花幾顆生命骰：有受傷就至少花一顆；之後還差半顆骰以上的傷才繼續花（不浪費） */
export function autoHitDice(c: Character): number {
  if (c.hp <= 0) return 0
  const avg = Math.floor(hitDie(c) / 2) + 1 + hitDieBonus(c)
  let missing = c.maxHp - c.hp
  let n = 0
  while (n < hitDiceLeft(c) && missing > 0 && (n === 0 || missing >= Math.max(1, Math.ceil(avg / 2)))) {
    missing -= Math.max(1, avg)
    n++
  }
  return n
}

/** 短休會怎樣（休息面板的按鈕，要短）：自動花幾顆生命骰；沒有要花時說明原因（生命全滿、受傷的人生命骰用完了） */
export function shortRestPreview(state: GameState): { dice: number; note: string } {
  const dice = state.party.reduce((s, m) => s + autoHitDice(m), 0)
  if (dice) return { dice, note: `用 ${dice} 顆骰` }
  const hurt = state.party.filter((m) => m.hp > 0 && m.hp < m.maxHp)
  return { dice: 0, note: hurt.length ? '骰用完了' : '生命全滿' }
}

/**
 * 短休。spend 指定每位隊員花幾顆生命骰（不指定則自動）。
 * 被襲擊時開始戰鬥並回傳戰鬥狀態（沒有休息效果）。
 */
export function shortRest(state: GameState, spend?: Record<string, number>): Report | CombatState {
  if (state.combat) throw new Error('戰鬥中不能休息')
  const event = restEventBlock(state)
  if (event) throw new Error(event)
  const area = currentArea(state)
  const ambushed = withRng(state, (rng) => rng.chance(ambushChance(state)))
  if (ambushed) return startCombat(state, ambushGroup(state), { scene: `${area.name}（短休時遭到襲擊）`, intent: '短休時遭到襲擊' })
  const report = restReport(state, gameRule(state, 'shortRestHours'), `${area.name}・短休`)
  const lines: string[] = []
  withRng(state, (rng) => {
    for (const m of state.party) {
      const n = Math.max(0, Math.min(hitDiceLeft(m), Math.floor(spend?.[m.id] ?? autoHitDice(m))))
      if (n === 0 || m.hp <= 0) {
        // 沒回血時寫明原因（受傷的人才寫）
        if (m.hp > 0 && m.hp < m.maxHp) lines.push(hitDiceLeft(m) ? `${m.name}這次沒有用生命骰` : `${m.name}的生命骰用完了，要長休才會恢復`)
        continue
      }
      const before = m.hp
      for (let i = 0; i < n; i++) m.hp = Math.min(m.maxHp, m.hp + Math.max(1, roll(rng, `1d${hitDie(m)}`).total + hitDieBonus(m)))
      m.hitDiceUsed = (m.hitDiceUsed ?? 0) + n
      ;(report.changes.hit_dice ??= []).push({ actor: m.id, spent: n, healed: m.hp - before })
      const snap = report.party.find((p) => p.id === m.id)
      if (snap) snap.hp = [before, m.hp, m.maxHp]
      lines.push(`${m.name}花了 ${n} 顆生命骰，回復 ${m.hp - before} 點生命值`)
    }
  })
  const checks = restChecks(state, report, 'short')
  report.outcome = {
    result: 'success',
    summary: [`在${area.name}短暫休息了一會兒。`, lines.length ? `${lines.join('；')}。` : state.party.every((m) => m.hp >= m.maxHp) ? '大家的生命都是滿的。' : '', ...checks].filter(Boolean).join(''),
    tags: ['短休'],
  }
  return commitReport(state, report)
}

/** 長休：旅店（付費，到隔天早上）或安全房（每人 1 份乾糧，8 小時）。 */
/** 長休的地方：旅店、地下城的安全房、自己的房子（要有床）、奴房、野外紮營（要有會紮營的人，經過 campRest） */
export type RestPlace = 'inn' | 'safe' | 'home' | 'slave_room' | 'camp'

/**
 * 在野外紮營長休：每人 1 份乾糧，照這裡的機率可能被襲擊（帶帳篷減半）。
 * 被襲擊就開始戰鬥、這次沒睡成（乾糧不扣）；沒事就長休 longRestHours 小時。
 */
export function campRest(state: GameState): Report | CombatState {
  const blocked = longRestBlocked(state, 'camp')
  if (blocked) throw new Error(blocked)
  const need = state.party.length
  if ((state.inventory.find((i) => i.name === '乾糧')?.qty ?? 0) < need) throw new Error(`需要 ${need} 份乾糧`)
  const area = currentArea(state)
  if (withRng(state, (rng) => rng.chance(ambushChance(state)))) {
    // 洞窟、遺跡類的臨時地圖：和短休一樣用那張地圖對應的地下城層
    return startCombat(state, ambushGroup(state), { scene: `${area.name}（紮營時遭到襲擊）`, intent: '紮營過夜時遭到襲擊' })
  }
  return longRest(state, 'camp')
}

export function longRest(state: GameState, place: RestPlace): Report {
  const blocked = longRestBlocked(state, place)
  if (blocked) throw new Error(blocked)
  const area = currentArea(state)
  let hours = gameRule(state, 'longRestHours')
  let scene = `${area.name}的安全房`
  let costText = ''
  const report = restReport(state, hours, scene)
  if (place === 'inn' || place === 'slave_room') {
    const cost = place === 'slave_room' ? slaveRoomCost(state) : innCost(state)
    if (state.money_cc < cost) throw new Error('旅費不足')
    hours = Math.max(hours, (24 - state.time.hour + 8) % 24 || 24)
    scene = `${locationById(state.location).name}的旅店${place === 'slave_room' ? '（奴房）' : ''}`
    report.changes.money_cc = -cost
    costText = `，花費 ${formatMoney(cost)}${isFugitive(state) ? '（身上的印記讓老闆加了價）' : ''}`
  } else if (place === 'home') {
    const home = homeOfArea(state, area)!
    hours = Math.max(hours, (24 - state.time.hour + 8) % 24 || 24)
    scene = home.master ? `主人的家「${home.name}」` : `自己的房子「${home.name}」`
  } else {
    // 安全房與野外紮營：每人 1 份乾糧
    const need = state.party.length
    const have = state.inventory.find((i) => i.name === '乾糧')?.qty ?? 0
    if (have < need) throw new Error(`需要 ${need} 份乾糧`)
    report.changes.items_lost = [{ name: '乾糧', qty: need }]
    if (place === 'safe') currentCell(state).done = true
    else scene = `${area.name}的營地`
    costText = `，消耗乾糧 ${need} 份`
  }
  report.time.end = addHours(report.time.start, hours)
  report.location.scene = scene
  for (const m of state.party) {
    const snap = report.party.find((p) => p.id === m.id)
    if (snap) snap.hp = [m.hp, m.maxHp, m.maxHp]
    m.hp = m.maxHp
    m.slotsUsed = []
    m.usesPerRest = {}
    delete m.tempHp
    const regained = Math.min(m.hitDiceUsed ?? 0, Math.max(1, Math.floor(m.level / 2)))
    if (regained > 0) {
      m.hitDiceUsed = (m.hitDiceUsed ?? 0) - regained
      ;(report.changes.hit_dice ??= []).push({ actor: m.id, regained })
    }
    for (const id of [...m.status]) {
      if (companionRules.conditions[id]?.clears === 'long_rest') removeCondition(m, id, report)
    }
  }
  // 在舒適的家裡睡：睡得香甜
  const home = place === 'home' ? homeOfArea(state, area) : undefined
  // 舒適度分段：全隊得到達到的最高一段（睡得香甜、精神飽滿、神采奕奕；同一組只留最高的）
  const tier = home ? comfortTier(comfortOf(home, state)).tier : undefined
  const rested = !!tier
  if (tier) for (const m of state.party) gainCondition(m, tier.condition, report)
  // 家裡的廚師：醒來有早餐（staff.ts）
  const breakfast = home && !home.master ? serveBreakfast(state, home, report) : ''
  // 懷孕初期：一早起來可能孕吐（docs/FAMILY.md）
  morningSickness(state, report)
  clearInviteCooldowns(state)
  const room = place === 'slave_room' ? slaveRoomNight(state, report) : []
  const checks = restChecks(state, report, place)
  state.lastLongRest = { ...report.time.end }
  report.outcome = {
    result: 'success',
    summary: [place === 'slave_room' ? `大家在${scene}過了一夜${costText}。` : `在${scene}好好睡了一覺${costText}。`, ...(rested ? [`家裡佈置得很舒服，大家都${conditionName(tier!.condition)}。`] : []), ...(breakfast ? [breakfast] : []), ...room, ...checks].join(''),
    tags: ['長休', ...(place === 'safe' ? ['安全房'] : place === 'home' ? ['在家'] : place === 'slave_room' ? ['奴房'] : place === 'camp' ? ['紮營'] : [])],
  }
  const committed = commitReport(state, report)
  // 安全房醒來之前：夜襲、淫夢（地下城事件）
  // 時段看入睡的時間（事件在醒來之後才抽，這時時間已經推到早上了）
  const slept = report.time.start
  if (place === 'safe') maybeDungeonEvent(state, 'rest', slept)
  // 醒來的時候：寄生物可能發作
  maybeParasiteEvent(state, 'rest', slept)
  // 懷孕的事件（察覺、孕期）：時段看入睡的時間
  maybePregnancyEvent(state, 'rest', slept)
  // 家裡的事（家僕，homeEvents.ts）：在自己家醒來時；時段看入睡的時間
  if (place === 'home') maybeHomeEvent(state, 'rest', slept)
  return committed
}

/** 奴房的一夜：主角順從上升、可能學會一個色情技能，醒來時虛脫；敘事交給成人場景的寫手 */
function slaveRoomNight(state: GameState, report: Report): string[] {
  const r = lewdRules.slave_room
  const pc = pcOf(state)
  const lines = ['主角被鎖在奴房的床頭過了一夜，路過的客人都能推門進來。']
  addLewd(state, pc, 'submission', r.submission, report)
  const open = r.abilities.filter((id) => abilities[id] && !pc.abilities.includes(id))
  const learn = open.length && withRng(state, (rng) => rng.chance(r.learn_chance)) ? withRng(state, (rng) => rng.pick(open)) : undefined
  if (learn) lines.push(`${teachAbility(state, report, pc, learn)}。`)
  if (companionRules.conditions[r.condition]) addCondition(pc, r.condition, report)
  report.narration = { ...report.narration, length: 'medium', adult_scene: r.scene }
  return lines
}

// ---- 休息時的離隊檢查 ----

/**
 * 每次短休、長休都會檢查：
 * 1. 親密度 ≤ -20 的同伴離隊（奴隸除外）。若是主角跟著的隊長，整支隊伍丟下主角離開。
 * 2. 主角打算離開別人的隊伍：正式道別或偷偷離開（靈巧檢定）。
 * 3. 逃亡奴隸：契約有追蹤功能時，有機率被主人找到。
 * 回傳要加進報告簡述的句子。
 */
export function restChecks(state: GameState, report: Report, place: 'short' | RestPlace): string[] {
  const lines: string[] = []
  const threshold = companionRules.leave_threshold
  const leader = leaderOf(state)

  if (leader && !isBound(state) && (leader.affinity ?? 0) <= threshold) {
    const names = leaderGroup(state).map((m) => m.name).join('、')
    for (const m of leaderGroup(state)) leaveParty(state, m.id, report, '對主角不滿，丟下主角離開')
    lines.push(`${names}對你積怨已深，趁休息時收拾行李離開了。`)
    delete state.pendingLeave
  }
  for (const m of [...state.party]) {
    if (m.isPlayer || m.bond === 'slave' || m.bond === 'leader' || m.bond === 'guest') continue
    if ((m.affinity ?? 0) > threshold || !state.party.includes(m)) continue
    // 整隊入隊的小隊：一個人受夠了，整隊一起走
    const mates = squadMates(state, m).filter((x) => x !== m)
    leaveParty(state, m.id, report, '親密度過低')
    for (const x of mates) leaveParty(state, x.id, report, `跟著${m.name}離開`)
    lines.push(mates.length ? `${m.name}受夠了，在休息時帶著${mates.map((x) => x.name).join('、')}離開了隊伍。` : `${m.name}受夠了，在休息時離開了隊伍。`)
  }

  if (state.pendingLeave) {
    const mode = state.pendingLeave.mode
    delete state.pendingLeave
    const group = leaderGroup(state)
    const head = leaderOf(state)
    if (head && !isBound(state)) {
      lines.push(withRng(state, (rng) => leaveOthersParty(state, report, head, group, mode, rng)))
    }
  }

  const pc = pcOf(state)
  const contract = contractOf(pc)
  if (contract && isFugitive(state)) {
    const def = contractTerms(contract)
    if (def.functions.includes('tracking')) {
      // 被找到的機率依休息的地方（slavery.json 的 track_place_mult）：旅店高、自己的房子低
      const mult = slaveryRules.track_place_mult[place] ?? 1
      const caught = withRng(state, (rng) => rng.chance(def.recapture_chance * mult))
      if (caught) {
        // 被找到：直接帶回主人的家，之後嚴加看管
        const sent = recapturePlayer(state, report, slaveryRules.master_home.strict.found)
        lines.push(`${contract.masterName}循著契約印記找到了你。`, punish(state, 'heavy', report), sent)
      }
    }
  }
  return lines
}

function leaveOthersParty(state: GameState, report: Report, head: Character, group: Character[], mode: 'sneak' | 'formal', rng: Rng): string {
  const pc = pcOf(state)
  const rules = companionRules.leave_party
  let line: string
  let delta: number
  if (mode === 'formal') {
    delta = rules.affinity.formal
    line = `你向${head.name}正式道別，離開了這支隊伍。`
  } else {
    const parts = checkParts(pc, { context: 'stealth', attr: 'dex' })
    const dice = withBonus('1d20', sumParts(parts))
    const r = roll(rng, dice)
    const dc = rules.sneak_base + Math.floor(head.level / 2)
    const ok = r.total >= dc
    ;(report.timeline ??= []).push({
      seq: (report.timeline?.length ?? 0) + 1, time: report.time.end, actor: pc.id, action: '趁夜偷偷離開',
      target: head.id,
      roll: { dice, value: r.total, dc, ...rollBreakdown(r.rolls[0]!, parts, { dcParts: [{ label: '基礎', value: rules.sneak_base }, { label: `${head.name}的等級 ÷ 2`, value: Math.floor(head.level / 2) }] }) },
      result: ok ? 'success' : 'fail',
    })
    delta = ok ? rules.affinity.sneak_success : rules.affinity.sneak_fail
    line = ok ? `你趁著${head.name}睡著，悄悄離開了隊伍。` : `你想偷偷離開，卻被${head.name}撞見，只好在尷尬中分道揚鑣。`
  }
  for (const m of group) {
    addAffinity(state, report, m.id, delta, mode === 'formal' ? '正式道別' : '不告而別')
    leaveParty(state, m.id, report, mode === 'formal' ? '主角正式道別' : '主角偷偷離開')
  }
  report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), mode === 'formal' ? '主角與隊伍的道別' : '主角偷偷離開隊伍'] }
  return line
}
