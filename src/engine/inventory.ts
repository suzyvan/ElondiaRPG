// 行囊：使用消耗品、更換裝備（戰鬥以外）。

import { PARASITE_LOCK } from './parasites'
import { hasPerk, offerPerks } from './perks'
import { abilityQuality, carryLearned, learnAbility, nextBookAbility, recalc, snapshot } from './character'
import { gameRule } from './gameRules'
import {
  abilities, attrName, classDef, companionRules, conditionName, damageTypeName, itemDef, itemRules, locationById, perkDef, regionById, shopRules, statusDef, stories, townQuestTemplates, TRAP_LOCK,
  type ItemIntel, type ItemUse, type LockGrade,
} from './data'
import { gearKnown, gearRules, gearSpecOf, gearStats, missingWear, slotName, slotsFor, syncGear, wearName } from './gear'
import { addIntel, intelPlace, makePoint, nearbyPlaces, placesAt } from './intel'
import { openFor } from './storyFlags'
import { gainCondition, pcOf } from './party'
import { toolDef } from './tools'
import { roll } from './rng'
import { addHours, commitReport, newReportId, withRng } from './state'
import { startStory } from './story'
import type { Character, EquippedGear, GameState, GearSlot, GearSpec, Report } from './types'
import { contractOf } from './tattoos'
import { openWithKey } from './restraints'

function itemReport(state: GameState, hours: number): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    kind: 'trade',
    time: { start, end: addHours(start, hours) },
    location: { at: state.location, region: loc.region, scene: loc.name },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'success' },
    changes: {},
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

function member(state: GameState, id: string): Character {
  const m = state.party.find((x) => x.id === id)
  if (!m) throw new Error('隊伍中沒有這位角色')
  return m
}

function take(state: GameState, name: string) {
  if (!state.inventory.some((i) => i.name === name && i.qty > 0)) throw new Error(`沒有${name}`)
  if (state.combat) throw new Error('戰鬥中不能這麼做')
}

/** 情報物品：可以解讀（目錄裡的，或 AI 生成、登錄在存檔的） */
export function isIntelItem(state: Pick<GameState, 'customItems'> | undefined, name: string): boolean {
  return (itemDef(name)?.category ?? state?.customItems?.[name]?.category) === 'info'
}

/** 情報物品解讀之後的內容（一行說明） */
export function intelSummary(intel: ItemIntel | undefined): string {
  if (!intel || intel.kind === 'point') {
    const ev = intel?.event ? EVENT_NAME[intel.event] : '強敵、藏寶處或流浪商人'
    const loc = intel?.location ? locationById(intel.location) : undefined
    const where = !loc ? '附近' : intel?.layer ? intelPlace({ location: loc.id, layer: intel.layer }) : loc.type === 'dungeon' ? `${loc.name}的某一層` : `${loc.name}近郊`
    return `解讀：${where}的事件點（${ev}）`
  }
  if (intel.kind === 'story') return `解讀：特殊任務「${stories.find((s) => s.id === intel.story)?.title ?? intel.story}」的消息`
  return '解讀：進行中委託的線索（檢定 +5）'
}
const EVENT_NAME: Record<NonNullable<ItemIntel['event']>, string> = { combat: '盤踞的強敵', chest: '藏寶處', merchant: '流浪商人' }

/**
 * 解讀情報物品：和向情報商買情報一樣，記進冒險筆記（事件點）、開始特殊任務，或給進行中的委託線索。
 * 用掉這件物品；沒有用處時（任務已經開始、沒有要檢定的委託）不會用掉。
 */
export function readIntelItem(state: GameState, name: string): Report {
  take(state, name)
  if (!isIntelItem(state, name)) throw new Error('這不是情報')
  const spec: ItemIntel = itemDef(name)?.intel ?? { kind: 'point' }
  const report = itemReport(state, 0.25)
  report.kind = 'event'
  report.outcome.tags = ['情報']
  let text = ''
  if (spec.kind === 'story') {
    const def = stories.find((s) => s.id === spec.story)
    if (!def) throw new Error('消息裡說的事已經不存在了')
    if (state.stories?.[def.id]) throw new Error(`「${def.title}」的事你已經知道了`)
    startStory(state, def.id)
    addIntel(state, { kind: 'story', story: def.id, title: def.title, text: def.start.text ?? def.summary, source: name })
    text = `得知「${def.title}」的消息，開始了這個特殊任務`
  } else if (spec.kind === 'lead') {
    const quests = state.quests.filter((q) => q.status === 'accepted' && !q.flags?.lead && q.template && townQuestTemplates[q.template]?.dc !== undefined)
    const q = quests.find((x) => x.giver === state.location) ?? quests[0]
    if (!q) throw new Error('目前沒有用得到這條線索的委託')
    q.flags = { ...(q.flags ?? {}), lead: true }
    text = `找到委託「${q.title}」的線索（委託的檢定 +5）`
  } else {
    const places = spec.location ? placesAt(spec.location, spec.layer) : nearbyPlaces(state.location, openFor(state))
    if (!places.length) throw new Error('看不出這份情報說的是哪裡')
    const it = withRng(state, (rng) => {
      const p = rng.pick(places)
      const event = spec.event ?? rng.pick(['combat', 'combat', 'chest', 'chest', 'merchant'] as const)
      return addIntel(state, { ...makePoint(state, p, event, spec.days ?? shopRules.types.informant.info?.valid_days ?? 5), kind: 'point', source: name })
    })
    text = `記下情報「${it.title}」：${it.text}（第 ${it.until} 天前有效，見冒險筆記）`
  }
  report.changes.items_lost = [{ name, qty: 1 }]
  report.outcome.summary = `解讀了${name}，${text}。`
  return commitReport(state, report)
}

export function canUse(name: string): boolean {
  const use = itemDef(name)?.use
  return (!!use && !use.combat_only && (!!use.heal || !!use.slot || !!use.condition || !!use.perks?.length || !!use.abilities?.length)) || !!toolDef(itemDef(name)?.tool)?.condition
}

/** 消耗品效果的一行說明 */
export function useSummary(use?: ItemUse): string {
  if (!use) return ''
  const parts: string[] = []
  if (use.condition) parts.push(`「${conditionName(use.condition)}」：${companionRules.conditions[use.condition]?.desc ?? ''}`)
  if (use.perks?.length) parts.push(`讀了有機會學會特質：${use.perks.map((id) => perkDef(id)?.name ?? id).join('、')}`)
  if (use.abilities?.length) parts.push(`每讀一次學會下一個能力：${use.abilities.map((id) => `${abilities[id]?.name ?? id}（${abilities[id]?.unlock ?? 1} 級）`).join('、')}`)
  if (use.revive) parts.push(`救起倒下的隊友（${Math.round(use.revive * 100)}% 生命）`)
  if (use.heal) parts.push(`回復 ${use.heal} HP`)
  if (use.slot) parts.push(`回復 ${use.slot} 環以下的法術環`)
  if (use.cleanse) parts.push(`解除${use.cleanse.map((id) => statusDef(id).name).join('、')}`)
  if (use.status) parts.push(`${statusDef(use.status.id).name} ${use.status.turns} 回合`)
  if (use.temp_hp) parts.push(`暫時生命 ${use.temp_hp}`)
  if (use.ap) parts.push(`行動點 +${use.ap}`)
  const area = use.area === 'all' ? '所有敵人' : '一名敵人'
  if (use.damage) parts.push(`${area} ${use.damage.dice} ${damageTypeName(use.damage.type)}傷害`)
  if (use.apply) parts.push(`${use.damage ? '' : area}${statusDef(use.apply.status).name} ${use.apply.turns} 回合${use.apply.save ? `（${attrName(use.apply.save)}豁免 DC ${use.apply.dc}）` : ''}`)
  if (use.save) parts.push(`${attrName(use.save.attr)}豁免 DC ${use.save.dc}（成功減半）`)
  if (use.escape) parts.push('全隊脫離戰鬥')
  return parts.join('、') + (use.combat_only ? '・戰鬥中' : '')
}

export function canEquip(state: Pick<GameState, 'customItems'>, name: string): boolean {
  return !!gearSpecOf(state, name)
}

/** 使用消耗品（戰鬥以外）：回復生命值或法術環、吃喝；保養類的工具（磨刀石）用了不會消耗。其他效果只能在戰鬥中使用。 */
export function useItem(state: GameState, name: string, memberId: string): Report {
  take(state, name)
  const def = itemDef(name)
  const toolCondition = toolDef(def?.tool)?.condition
  if (!def?.use && !toolCondition) throw new Error('這個東西不能使用')
  if (!canUse(name)) throw new Error('這個東西只能在戰鬥中使用')
  const m = member(state, memberId)
  const report = itemReport(state, toolCondition ? 0.25 : 0.1)
  const snap = report.party.find((p) => p.id === m.id)!
  let text = ''
  // 工具：得到狀態，東西留著
  if (toolCondition) {
    if (!gainCondition(m, toolCondition, report)) throw new Error(`${m.name}已經是「${conditionName(toolCondition)}」了`)
    report.outcome.summary = `${m.name}用了${name}，得到「${conditionName(toolCondition)}」（${name}還留著）。`
    return commitReport(state, report)
  }
  if (!def?.use) throw new Error('這個東西不能使用')
  if (def.use.perks?.length) {
    // 書籍：讀完得到一次學特質的機會（從書裡的特質選一個，或寫說法交給 AI）
    const options = def.use.perks.filter((id) => !hasPerk(m, id))
    if (!options.length) throw new Error(`${m.name}已經學會書裡的特質了`)
    offerPerks(m, `讀了「${name}」`, options)
    report.time.end = addHours(report.time.start, 4)
    text = `讀完之後，有機會學會：${options.map((id) => perkDef(id)?.name ?? id).join('、')}`
  } else if (def.use.abilities?.length) {
    // 技能書：學會下一個還沒學、等級也夠的能力
    const next = nextBookAbility(m, def.use.abilities)
    if (!next.ability) throw new Error(next.reason)
    const a = learnAbility(m, next.ability.id)
    const carried = carryLearned(m, a.id, gameRule(state, 'skillLoadout'))
    report.time.end = addHours(report.time.start, 4)
    report.changes.skills_gained = [{ actor: m.id, skill: a.name, quality: abilityQuality(a), source: 'study' }]
    text = `學會了【${a.name}】${carried ? '' : '（攜帶的技能已滿，先放進技能庫）'}`
  } else if (def.use.condition) {
    const got = gainCondition(m, def.use.condition, report)
    if (!got) throw new Error(`${m.name}${companionRules.conditions[def.use.condition]?.group === 'meal' ? '已經吃得比這更好了' : '已經喝不下了'}`)
    text = `得到「${conditionName(got)}」`
  } else if (def.use.heal) {
    if (m.hp >= m.maxHp) throw new Error(`${m.name}沒有受傷`)
    const before = m.hp
    const healed = withRng(state, (rng) => roll(rng, def.use!.heal!).total)
    snap.hp = [before, Math.min(m.maxHp, before + healed), m.maxHp]
    text = `回復 ${snap.hp[1] - before} 點生命值`
  } else if (def.use.slot) {
    const circle = [...m.slotsUsed.keys()].filter((i) => i < def.use!.slot! && (m.slotsUsed[i] ?? 0) > 0).pop()
    if (circle === undefined) throw new Error(`${m.name}沒有可以回復的法術環`)
    m.slotsUsed[circle]! -= 1
    text = `回復一個 ${circle + 1} 環法術環`
  }
  report.changes.items_lost = [{ name, qty: 1 }]
  report.outcome.summary = `${m.name}使用了${name}，${text}。`
  return commitReport(state, report)
}

/**
 * 穿上裝備：放進指定的欄位（沒指定時挑第一個空的、可以放的欄位）。
 * 雙手武器會空出副手；換下來的裝備放回行囊。
 */
/** 不能拿下的裝備：主人強制裝上的（契約還在時）、陷阱鎖住的、寄生裝備（馴服或解咒之前） */
export function lockedGear(m: Character, slot: GearSlot): EquippedGear | undefined {
  const g = m.gear?.[slot]
  if (!g?.locked) return undefined
  return g.locked.startsWith(PARASITE_LOCK) || g.locked.startsWith(TRAP_LOCK) || contractOf(m) ? g : undefined
}

/**
 * 限定穿著（任務點、地標場景的 wear）裡，因為欄位被鎖住（寄生裝備、主人強制戴上的）而穿不上的：回傳提醒的句子。
 * 已經穿著符合的就不算
 */
export function wearLocks(m: Character, wear: string[] | undefined): string[] {
  const out: string[] = []
  for (const w of missingWear(m, wear)) {
    const base = gearRules.bases[w] ? w : itemDef(w)?.gear?.base
    const slot = base ? gearRules.bases[base]?.slot : undefined
    if (!slot) continue
    const group = gearRules.slot_groups[slot] ?? [slot as GearSlot]
    const locks = group.map((x) => lockedGear(m, x))
    if (locks.length && locks.every(Boolean)) out.push(`${locks[0]!.name}脫不下來，穿不上【${wearName(w)}】`)
  }
  return [...new Set(out)]
}

function assertUnlocked(m: Character, slot: GearSlot) {
  const g = lockedGear(m, slot)
  if (g?.locked?.startsWith(PARASITE_LOCK)) throw new Error(`${g.name}緊緊貼在身上，脫不下來（寄生裝備：馴服或解咒之後才能拿下）`)
  if (g?.locked?.startsWith(TRAP_LOCK)) throw new Error(`${g.name}被鎖住了，自己打不開（要脫縛、用鑰匙或找鐵匠剪鎖）`)
  if (g) throw new Error(`${g.name}是主人強制戴上的，契約還在時不能拿下`)
}

/** 這件裝備能放的欄位（種族封住的、被主人鎖住的不算） */
export function freeSlotsFor(m: Character, spec: GearSpec): GearSlot[] {
  return slotsFor(spec).filter((x) => !(gearRules.races[m.race]?.blocked ?? []).includes(x) && !lockedGear(m, x))
}

/**
 * 把裝備穿到角色身上（不經過行囊）：回傳穿上的欄位與換下來的裝備名稱（放回行囊由呼叫的地方處理）。
 * locked：主人強制裝上的（主人的 id）。換了裝備之後重算生命值上限（裝備可能有屬性加減）
 */
export function putOn(m: Character, name: string, spec: GearSpec, slot?: GearSlot, locked?: string): { target: GearSlot; back: string[] } {
  const all = slotsFor(spec).filter((x) => !(gearRules.races[m.race]?.blocked ?? []).includes(x))
  if (!all.length) throw new Error(`${m.name}無法使用這個欄位`)
  if (slot && !all.includes(slot)) throw new Error(`${name}不能放在${slotName(slot)}`)
  if (slot) assertUnlocked(m, slot)
  const options = freeSlotsFor(m, spec)
  if (!options.length) assertUnlocked(m, all[0]!)
  const gear = (m.gear ??= {})
  const target = slot ?? options.find((x) => !gear[x]) ?? options[0]!
  const stats = gearStats(spec)
  const main = gear.main_hand
  if (target === 'off_hand' && main && gearKnown(main.spec) && gearStats(main.spec).two_handed) throw new Error(`${main.name}要用雙手，副手空不出來`)
  if (target === 'main_hand' && stats.two_handed && gear.off_hand) assertUnlocked(m, 'off_hand')
  const back: string[] = []
  const removed = gear[target]
  if (removed) back.push(removed.name)
  if (target === 'main_hand' && stats.two_handed && gear.off_hand) {
    back.push(gear.off_hand.name)
    delete gear.off_hand
  }
  gear[target] = { name, spec, ...(locked ? { locked } : {}) }
  syncGear(m, classDef(m.class).weapon)
  recalc(m)
  return { target, back }
}

export function equipItem(state: GameState, name: string, memberId: string, slot?: GearSlot): Report {
  take(state, name)
  const spec = gearSpecOf(state, name)
  if (!spec) throw new Error('這個東西不能裝備')
  if (!gearKnown(spec)) throw new Error('這件裝備的底材或材料已經不存在，不能裝備')
  const m = member(state, memberId)
  const report = itemReport(state, 0.1)
  const { target, back } = putOn(m, name, spec, slot)
  report.changes.items_lost = [{ name, qty: 1 }]
  if (back.length) report.changes.items_gained = back.map((n) => ({ name: n, qty: 1, owner: 'pc' }))
  report.outcome.summary = `${m.name}在${slotName(target)}裝上了${name}${back.length ? `，把${back.join('、')}收進行囊` : ''}。`
  return commitReport(state, report)
}

/** 卸下裝備，放回行囊 */
export function unequipItem(state: GameState, memberId: string, slot: GearSlot): Report {
  if (state.combat) throw new Error('戰鬥中不能這麼做')
  const m = member(state, memberId)
  const g = m.gear?.[slot]
  if (!g) throw new Error(`${slotName(slot)}沒有裝備`)
  assertUnlocked(m, slot)
  delete m.gear![slot]
  syncGear(m, classDef(m.class).weapon)
  recalc(m)
  const report = itemReport(state, 0.1)
  // 自己裝的鎖：打開，鎖放回行囊
  const lock = g.lock && !g.locked ? lockItemName(g.lock) : undefined
  report.changes.items_gained = [{ name: g.name, qty: 1, owner: 'pc' }, ...(lock ? [{ name: lock, qty: 1, owner: 'pc' }] : [])]
  report.outcome.summary = `${m.name}${lock ? `打開${lock}，` : ''}卸下了${g.name}。`
  return commitReport(state, report)
}

// ---- 鎖（雙面效應，docs/LEWD_STATS.md 第 7 節） ----

/** 這個等級的鎖是哪一件物品（打開時放回行囊） */
export function lockItemName(grade: LockGrade): string | undefined {
  return itemRules.items.find((i) => i.lock === grade)?.name
}

/** 行囊裡的鎖 */
export function lockItems(state: GameState): { name: string; grade: LockGrade }[] {
  return state.inventory.filter((i) => i.qty > 0 && itemDef(i.name)?.lock).map((i) => ({ name: i.name, grade: itemDef(i.name)!.lock! }))
}

/** 誰鎖上的（別人的鎖）：陷阱或主人 */
export function lockerOf(g: EquippedGear): string {
  return g.locked?.startsWith(TRAP_LOCK) ? '陷阱' : '主人'
}

/** 這一格的裝備能不能上鎖：拘束具（底材有 bind）、還沒上鎖、沒有自帶的鎖、不是別人鎖上的 */
export function lockable(g: EquippedGear | undefined): boolean {
  return !!g && !!gearRules.bases[g.spec.base]?.bind && !g.lock && !g.spec.lock && !g.locked
}

/** 用行囊裡的鎖替身上的拘束具上鎖（自己有鑰匙，隨時可以打開） */
export function lockGear(state: GameState, memberId: string, slot: GearSlot, lockName: string): Report {
  take(state, lockName)
  const grade = itemDef(lockName)?.lock
  if (!grade) throw new Error(`${lockName}不是鎖`)
  const m = member(state, memberId)
  const g = m.gear?.[slot]
  if (!g || !gearRules.bases[g.spec.base]?.bind) throw new Error('這一格沒有可以上鎖的拘束具')
  if (g.locked) throw new Error(`${g.name}是${lockerOf(g)}鎖上的`)
  if (g.lock || g.spec.lock) throw new Error(`${g.name}已經上鎖了`)
  g.lock = grade
  const report = itemReport(state, 0.1)
  report.changes.items_lost = [{ name: lockName, qty: 1 }]
  report.outcome.summary = `${m.name}用${lockName}鎖上了${g.name}，鑰匙收在身上。`
  return commitReport(state, report)
}

/** 用鑰匙打開別人鎖上的拘束具（docs/LEWD_STATS.md 第 16 節）：鑰匙用掉，鎖歸自己 */
export function useKey(state: GameState, memberId: string, slot: GearSlot, key: string): Report {
  take(state, key)
  const m = member(state, memberId)
  const { text, lock } = openWithKey(m, slot, key)
  const report = itemReport(state, 0.1)
  report.changes.items_lost = [{ name: key, qty: 1 }]
  if (lock) report.changes.items_gained = [{ name: lock, qty: 1, owner: 'pc' }]
  report.outcome.summary = text
  return commitReport(state, report)
}

/** 打開自己裝的鎖，鎖放回行囊 */
export function unlockGear(state: GameState, memberId: string, slot: GearSlot): Report {
  if (state.combat) throw new Error('戰鬥中不能這麼做')
  const m = member(state, memberId)
  const g = m.gear?.[slot]
  if (!g?.lock) throw new Error('這一格沒有上鎖')
  if (g.locked) throw new Error(`${g.name}是${lockerOf(g)}鎖上的，鑰匙不在你身上`)
  const name = lockItemName(g.lock)
  delete g.lock
  const report = itemReport(state, 0.1)
  if (name) report.changes.items_gained = [{ name, qty: 1, owner: 'pc' }]
  report.outcome.summary = `${m.name}打開了${g.name}上的${name ?? '鎖'}。`
  return commitReport(state, report)
}
