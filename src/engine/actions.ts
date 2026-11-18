// 主動行動：玩家用文字描述行為，擲骰先發生，再把完整資料與骰值交給 AI 直接寫出結果。
//
// 1. prepareAction：檢查能不能做、算出參考 DC、先擲 1d20（存進 state.pendingAction，重新整理也不會重擲）。
// 2. AI 判定（AI 關閉時略過）：AI 看到隊伍狀態、屬性、裝備、技能、人際關係、共同記憶、骰值與參考 DC，
//    自己決定成功與否（骰值只是參考，可以出乎預料），直接寫出結果的經過，並提出效果（封閉清單）
//    與人際關係文字的更新提議。屬性與 DC 只是給玩家看的判定依據（DC 夾在參考值 ±3）。
// 3. resolveAction：採用 AI 的成功程度，套用機制結果（雇傭、殺價、邀請、談判、逃離……）
//    與夾住上限的 AI 效果，產生報告；AI 寫的經過直接作為這份報告的敘事。
//    AI 關閉時依規則：預設屬性、參考 DC 與骰值決定成功程度。
// 說明見 docs/ACTIONS.md。

import { applyUnbind } from './restraints'
import { applyExplore, withLandmark } from './landmarks'
import { withHomeStorage } from './storage'
import { applyStaffInvite, withHomeStaff } from './staff'
import { applyCohabitInvite } from './cohabit'
import { applyPitch, applyTrain, pruneOffers } from './perkActions'
import { parsePitchTarget } from './perks'
import { checkModifiers, checkSkills, type CheckCtx } from './perks'
import { attrOf, mod, proficiency, snapshot } from './character'
import { clampDegree, computeDegree, DEGREE_NAME, naturalCritOnly } from './checks'
import {
  applyBlackMarket, applyEscape, applyPalaceGate, applyHaggle, applyHire, applyInvite, applyNegotiate, applyProposal, applySquadJoin, inviteDc, setupFor, validateInvite, type MarketKind,
} from './companions'
import {
  abilities, abilityDef, actionRules, ATTR_IDS, attrName, craftRules, SKILL_IDS, type SkillId, companionRules, geography, itemDef, itemRules, locationById, regionById, saveItems, slaveryRules, type ActionKind, type AttrId, type Degree, type EffectKind, type LewdKey,
} from './data'
import { applyEffects, type RewardEffect } from './effects'
import { applyStandoff } from './encounters'
import { applyLeave } from './masterHome'
import { applyExtend, applyMarking, applyMasterEventResponse, applyPermit, applyReturn, applySeekMaster, applyUnmark, masterEventDefaults } from './slavery'
import { applyInteraction } from './interactions'
import { applyPatron } from './brothel'
import { applyWork } from './work'
import { bandName, currentRegion, exposureAt, LEWD_KEYS, lewdPowerOf } from './lewd'
import { applyCraft, applyMake, craftPart, parseCraftTarget } from './craft'
import { applyProduce } from './recipes'
import { applyInvent } from './invention'
import { currentArea } from './grid'
import { memberOrResident } from './homes'
import type { AdultScene } from './content'
import { applyDefeatResponse } from './defeat'
import { rumorFrom } from './intel'
import { applyStoryCheck, refreshStoryMarkers } from './story'
import { applyPendingMove } from './road'
import { gearRules, sanitizeGearSpec, shiftRarity } from './gear'
import { npcRecord, type NpcSpec } from './npcs'
import { presentHere } from './population'
import { addAffinity, pcOf } from './party'
import { applyNegotiationOutcome } from './negotiation'
import { addSuggestions } from './social'
import { applyBargain } from './trade'
import { roll } from './rng'
import { addHours, commitReport, newReportId, withRng } from './state'
import { useAbilityOutOfCombat, type AbilityUse } from './resources'
import { applyFieldEffects, fieldCastable, prepareFieldCast, type FieldEffect } from './fieldCast'
import { formatMoney } from './money'
import type { Character, CheckInfo, GameState, GameTime, GearSpec, MarkTerms, Report, ResourceChange, RollPart } from './types'
import { applyResign } from './resign'
import { rollBreakdown } from './rollParts'
import { contractOf } from './tattoos'
import { canonicalName } from './script'

/** 對被制伏的人行動時給 AI 的提醒：人還在你手上，處置另外決定 */
export const CAPTIVE_NOTE = '對象在戰鬥中被主角制伏，倒在地上任主角處置，還沒決定放過、收為奴隸或處決（之後由主角另外決定）。這次行動結束時對方仍在主角手上：不要寫對方離開、被放走、逃走、死亡或加入隊伍'

export interface ActionInput {
  kind: ActionKind
  /** 玩家描述的行為 */
  text: string
  /** 對象：NPC id；殺價為 "public:npc" / "black:npc"。自由行動有多個對象時是主要對象 */
  target?: string
  /** 自由行動：同行的對象（主要對象之外的人，合計最多 actions.json 的 max_targets 人） */
  with?: string[]
  /** 雇傭談判的出價 */
  offer_cc?: number
  /** 搭配使用的能力（例如用魅惑術幫談判）：花資源換檢定加值 */
  use?: { member: string; ability: string }
  /** 送禮：送出的物品名稱 */
  item?: string
  /** 說服主人重簽契約：提出的新條款（resign.ts） */
  terms?: Partial<MarkTerms>
}

export interface ActionPending extends ActionInput {
  /** 耗時（小時；沒有時用 actions.json 的設定，例如工作的時數） */
  hours?: number
  /** 擲檢定的隊員（不是主角時；例如由夥伴動手製作） */
  actor?: string
  id: string
  natural: number
  /** 擲兩次取高（優勢）時的兩個骰值 */
  rolls?: number[]
  /** 優勢的原因 */
  advantage?: string
  base_dc: number
  /** 規則判定時使用的屬性 */
  attr: AttrId
  /** 各屬性的檢定修正 = mod + 熟練 */
  modifiers: Record<AttrId, number>
  situational: { label: string; value: number }[]
  /** 這次行動的檢定分類（actions.json 的 skill）；自由行動沒有，由 AI 判定時選 */
  skill?: SkillId
  /** 工藝檢定的算法（見 companions.ts 的 ActionSetup） */
  craftCheck?: 'self' | 'keeper'
  /** 自由行動：選了某個分類時額外的情境修正（特質、身分、裝備……寫在分類上的加值） */
  skillMods?: Partial<Record<SkillId, { label: string; value: number }[]>>
  outcomes: Partial<Record<Degree, string>>
  targetName?: string
  scene: string
  time: GameTime
  location: string
  /** 使用能力花掉的資源（擲骰時就已扣除） */
  spent?: ResourceChange[]
  /** 使用的能力，給 AI 參考 */
  usedAbility?: { member: string; name: string; desc: string; cost: string; effect?: string }
  /** 對夥伴使用治療、護盾類的能力：準備時擲好的效果，判定時套用（fieldCast.ts） */
  fieldEffects?: FieldEffect[]
  /** 成人向：可能進入的親密場景 */
  adultScene?: AdultScene
}

export interface RelationshipUpdate { id: string; to_player: string }

export interface Judgment {
  attr: AttrId
  /** 自由行動：AI 選的檢定分類（沒有時不分類） */
  skill?: SkillId
  dc: number
  rationale?: string
  /** AI 決定的成功程度（骰值只是參考）；沒有給時依骰值與 DC 計算 */
  degree?: Degree
  /** 出乎預料的轉折（AI 讓結果偏離骰值時說明） */
  twist?: string
  summary?: string
  /** AI 直接寫出的結果經過（作為報告的敘事） */
  narrative?: string
  /** 打聽、詢問得到的具體內容（寫手要讓角色把它說出來） */
  findings?: string
  /** AI 認為這次的經過包含親密場景：場景是什麼 */
  adult_scene?: string
  /** AI 判為日常小事（只有 actions.json 標了 trivial 的行動）：結果至少是成功 */
  trivial?: boolean
  /** AI 依經過填的花費時間（小時，只有標了 hours_range 的行動），已夾在範圍內 */
  hours?: number
  effects: RewardEffect[]
  relationship_updates: RelationshipUpdate[]
  /** 被程式截掉的數值（AI 提議的超過上限）：交給寫手，敘事照實際結算的數字寫 */
  adjusted?: string[]
  /** 自創配方：AI 設計的成品（程式在結算時夾進上限，見 invention.ts） */
  invention?: Record<string, unknown>
  /** 爭取特質：AI 設計的特質（程式依成功程度夾住強度，見 perkActions.ts） */
  perk?: Record<string, unknown>
  /** 沒有採用、要讓玩家看到原因的效果（例如入隊不符合邀請的條件）：寫進結果 */
  notes?: string[]
}

export { computeDegree, DEGREE_NAME }

/** 自由行動的所有對象：主要對象在前，接著是同行的對象 */
export function actionTargets(p: Pick<ActionInput, 'target' | 'with'>): string[] {
  return [...(p.target ? [p.target] : []), ...(p.with ?? [])]
}

/** 情境修正；自由行動選了分類時加上那個分類的修正 */
export function situationalFor(p: ActionPending, skill?: SkillId): { label: string; value: number }[] {
  return [...p.situational, ...(skill ? p.skillMods?.[skill] ?? [] : [])]
}

export function situationalTotal(p: ActionPending, skill?: SkillId): number {
  return situationalFor(p, skill).reduce((s, x) => s + x.value, 0)
}

/** 自由行動：每個檢定分類多出來的修正（選了這個分類時才算；同一個來源只算比不分類時多的部分） */
function freeSkillMods(pc: Character, ctx: CheckCtx, base: { label: string; value: number }[]): Partial<Record<SkillId, { label: string; value: number }[]>> {
  const before = new Map(base.map((x) => [x.label, x.value]))
  const out: Partial<Record<SkillId, { label: string; value: number }[]>> = {}
  for (const skill of SKILL_IDS) {
    const extra = checkModifiers(pc, { ...ctx, skill })
      .map((x) => ({ label: x.label, value: x.value - (before.get(x.label) ?? 0) }))
      .filter((x) => x.value !== 0)
    if (extra.length) out[skill] = extra
  }
  return out
}

export function prepareAction(state: GameState, input: ActionInput): ActionPending {
  if (state.combat) throw new Error('戰鬥中不能這麼做')
  if (state.pendingAction) throw new Error('還有一個行動等待判定')
  if (state.pendingMasterEvent && input.kind !== 'master_event') throw new Error('先回應主人的要求')
  if (state.dungeonEvent || state.parasiteEvent || state.leadEvent || state.trapLure || state.pregnancyEvent) throw new Error('先應付眼前的處境')
  if (state.pendingBirth) throw new Error('先處理生產')
  if (state.pendingBroodBirth) throw new Error('先處理體內的苗床')
  if (state.pendingDefeat && input.kind !== 'defeat_event') throw new Error('先應付眼前的處境')
  // 刻印之前只能做刻印本身
  if (state.pendingMark && input.kind !== 'marking') throw new Error('先完成契約印記的刻印')
  const kind = actionRules.kinds[input.kind]
  if (!kind) throw new Error('沒有這種行動')
  const text = input.text.trim().slice(0, 400)
  if (input.kind === 'free' && !text) throw new Error('請描述你要做什麼')
  // 同行的對象只有自由行動有
  const others = input.kind === 'free' ? (input.with ?? []).filter(Boolean) : []
  // 回應主人：對象一定是主人（判定看得到主人的身分與性格，主人的標籤也算進情境修正，和三選一的回應一樣）
  const master = input.kind === 'master_event' ? contractOf(pcOf(state))?.master : undefined
  input = { ...input, ...(others.length ? { with: others } : {}), ...(master ? { target: master } : {}) }
  if (!others.length) delete input.with
  const setup = setupFor(state, input.kind, input.target, input.offer_cc, input.item, others, input.terms)
  // 擲檢定的人：通常是主角；夥伴動手製作時是那位夥伴
  const pc = (setup.actor && memberOrResident(state, currentArea(state), setup.actor)) || pcOf(state)
  // 情境修正：這次行動的特殊情況，加上非戰鬥狀態與特質（對象的標籤也算，例如「對貴族 +1」）
  const vsTags = (input.target && npcRecord(state, input.target)?.tags) || undefined
  const ctx: CheckCtx = { context: setup.context ?? 'action', kind: input.kind, attr: setup.attr ?? kind.attr, ...(setup.skill ? { skill: setup.skill } : {}), ...(vsTags ? { vsTags } : {}) }
  // 委託打造由店主擲（craftCheck: 'keeper'）：主角的特質、身分、狀態都不算，只看店主的手藝
  const keeper = setup.craftCheck === 'keeper'
  const base = keeper ? [] : checkModifiers(pc, ctx)
  const situational = [...setup.situational, ...base, ...(keeper ? [] : lewdModifiers(state, pc, input.kind, vsTags))].filter((x) => x.value !== 0)
  // 自由行動：判定時才知道是哪個分類，先替每個分類算好多出來的修正（同一個來源只算差額）
  const skillMods = input.kind === 'free' ? freeSkillMods(pc, ctx, base) : undefined
  // 搭配能力：檢查並扣除資源（和擲骰一樣在判定前發生，判定失敗也不會退回）
  let used: AbilityUse | undefined
  let user: Character | undefined
  let fieldEffects: FieldEffect[] | undefined
  const targets = actionTargets(input)
  if (input.use) {
    user = state.party.find((m) => m.id === input.use!.member)
    if (!user) throw new Error('隊伍中沒有這位角色')
    // 對夥伴使用治療、護盾類的能力：和隊伍的「施放」同一條路（真的回血、上護盾），再加上行為的描述交給判定
    const ab = abilityDef(input.use.ability)
    // 沒有選任何對象時，對隊友的能力就是對施放者本人（例如主角替自己療傷）；對象只有隊伍外的人時照舊交給判定
    const mate = targets.map((id) => state.party.find((m) => m.id === id)).find((m): m is Character => !!m) ?? (targets.length ? undefined : user)
    if (ab && fieldCastable(ab) && (ab.target === 'self' || ab.target === 'all_allies' || mate)) {
      const cast = prepareFieldCast(state, user.id, ab.id, mate?.id)
      fieldEffects = cast.effects
      used = { ability: cast.ability, bonus: ab.type === 'spell' ? Math.min(6, 2 + (ab.circle ?? 1)) : ab.type === 'cantrip' ? 1 : 3, cost: cast.cost, change: cast.change }
    } else {
      used = useAbilityOutOfCombat(user, input.use.ability)
    }
    situational.push({ label: `${user.name}的【${used.ability.name}】`, value: used.bonus })
  }
  // 對自己的奴隸行動：奴隸抗拒時處於劣勢，主角擲兩次取較高的
  const ownSlave = targets.length > 0 && targets.every((id) => state.party.some((m) => m.id === id && m.bond === 'slave' && contractOf(m)?.master === 'pc'))
  const rolls = withRng(state, (rng) => (ownSlave ? [roll(rng, '1d20').total, roll(rng, '1d20').total] : [roll(rng, '1d20').total]))
  const natural = Math.max(...rolls)
  const pending: ActionPending = {
    ...input,
    text,
    id: `a-${state.nextReportNo}`,
    natural,
    ...(ownSlave ? { rolls, advantage: targets.length > 1 ? '對方都是主角的奴隸，抗拒時處於劣勢' : '對方是主角的奴隸，抗拒時處於劣勢' } : {}),
    base_dc: setup.dc,
    attr: setup.attr ?? kind.attr,
    ...(setup.hours ? { hours: setup.hours } : {}),
    // 工藝檢定：屬性的影響縮小、不加熟練（工藝等級 × 2 在情境修正）；委託打造由店主擲，屬性不算
    modifiers: Object.fromEntries(ATTR_IDS.map((a) => [a,
      setup.craftCheck === 'keeper' ? 0
        : setup.craftCheck === 'self' ? Math.trunc(mod(attrOf(pc, a)) / craftRules.attr_div)
        : mod(attrOf(pc, a)) + proficiency(pc.level)])) as Record<AttrId, number>,
    ...(setup.craftCheck ? { craftCheck: setup.craftCheck } : {}),
    ...(setup.actor && !pc.isPlayer ? { actor: pc.id } : {}),
    situational,
    // 顯示的分類：任務選項寫的、行動的，或照屬性推的（自由行動由 AI 選）
    ...(() => { const sk = input.kind === 'free' ? undefined : setup.skill ?? kind.skill ?? [...checkSkills(ctx)][0]; return sk ? { skill: sk } : {} })(),
    ...(skillMods && Object.keys(skillMods).length ? { skillMods } : {}),
    outcomes: setup.outcomes,
    ...(setup.targetName ? { targetName: setup.targetName } : {}),
    ...(setup.adultScene ? { adultScene: setup.adultScene } : {}),
    // 站在地標上：場景帶上地標的氛圍；在自己的房子裡：箱子裡收著什麼（storage.ts）、家裡的僕人（staff.ts）
    scene: withHomeStaff(state, withHomeStorage(state, withLandmark(state, setup.scene))),
    time: { ...state.time },
    location: state.location,
    ...(used?.change ? { spent: [used.change] } : {}),
    ...(used && user ? { usedAbility: { member: user.id, name: used.ability.name, desc: used.ability.desc, cost: used.cost, ...(fieldEffects ? { effect: fieldEffectText(fieldEffects) } : {}) } } : {}),
    ...(fieldEffects ? { fieldEffects } : {}),
  }
  state.pendingAction = pending
  return pending
}

// ---- 驗證 AI 的回傳 ----

const clipText = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** AI 回傳的物品名稱換成資料的寫法（繁簡不分；都不是時原樣，當成新的物品） */
function itemNameOf(state: GameState, name: string): string {
  if (!name || itemDef(name)) return name
  return canonicalName(name, [
    ...state.inventory.map((i) => i.name), ...itemRules.items.map((i) => i.name), ...saveItems().map((i) => i.name), ...Object.keys(state.customItems ?? {}),
  ])
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 慾望指標的情境修正（docs/LEWD_STATS.md）：淫亂高的人獻媚、誘惑比較容易（淫蕩 +1、淫亂 +2）；
 * 曝露名聲高（在這一帶遠近馳名以上）時，對貴族、皇族、神官唬騙比較難（-1、人盡皆知 -2）
 */
function lewdModifiers(state: GameState, c: Character, kind: string, vsTags?: string[]): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = []
  if (kind === 'flatter' || kind === 'seduce') {
    const v = lewdPowerOf(c).lewdness
    const bonus = v >= 80 ? 2 : v >= 60 ? 1 : 0
    if (bonus) out.push({ label: `淫亂（${bandName('lewdness', v)}）`, value: bonus })
  }
  if (kind === 'bluff' && vsTags?.some((t) => ['noble', 'royal', 'priest', 'bishop'].includes(t))) {
    const e = exposureAt(state, c.id, currentRegion(state))
    const pen = e >= 80 ? -2 : e >= 60 ? -1 : 0
    if (pen) out.push({ label: `曝露名聲（${bandName('exposure', e)}）`, value: pen })
  }
  return out
}

/** AI 回傳的效果種類（join 是入隊：通過檢查後變成 companion 效果） */
type JudgedEffect = RewardEffect['type'] | 'join'
const EFFECT_OF: Partial<Record<JudgedEffect, EffectKind>> = {
  join: 'join', affinity: 'affinity', relationship_text: 'relationship_text', flag: 'flag', reputation: 'reputation',
  money: 'money', item: 'item', xp: 'xp', meet: 'meet', ability: 'ability', hp: 'hp', mark: 'mark',
  free: 'release', change_master: 'change_master', gear: 'gear', lewd: 'lewd', rumor: 'rumor',
}

/**
 * 把 AI 回傳的 JSON 轉成判定：屬性不合法時用預設屬性，DC 夾在參考 DC ±dc_adjust，
 * 效果只保留這種行動允許的種類，數值夾在上限內。結構完全不對時丟出錯誤。
 */
export function sanitizeJudgment(state: GameState, p: ActionPending, raw: unknown): Judgment {
  if (!raw || typeof raw !== 'object') throw new Error('AI 回傳的不是 JSON 物件')
  const r = raw as Record<string, unknown>
  const caps = actionRules.caps
  const adj = actionRules.dc_adjust
  const attr = (ATTR_IDS as string[]).includes(String(r.attr)) ? (r.attr as AttrId) : p.attr
  // 檢定分類：只有自由行動由 AI 選，其他行動照行動本身的分類
  const skill = p.kind === 'free' && (SKILL_IDS as string[]).includes(String(r.skill)) ? (r.skill as SkillId) : undefined
  const dcRaw = num(r.dc)
  const dc = Number.isNaN(dcRaw) ? p.base_dc : clamp(Math.round(dcRaw), p.base_dc - adj, p.base_dc + adj)
  const kindDef = actionRules.kinds[p.kind]
  // 日常小事：結果至少是成功（骰值只決定過程順不順），效果的門檻也照成功看
  const aiDegree = (Object.keys(DEGREE_NAME) as Degree[]).includes(r.degree as Degree) ? (r.degree as Degree) : undefined
  // AI 自己判了失敗、大失敗時不算日常小事（例如荒唐的要求被拒絕）：照 AI 的結果，不把拒絕記成成功
  const trivial = !!kindDef.trivial && r.difficulty === 'trivial' && aiDegree !== 'fail' && aiDegree !== 'fumble'
  // AI 沒寫（或寫錯）成功程度時，用骰值對 DC 算出的參考結果（和結算時一樣），效果的門檻也照這個看
  // 存檔規則「只看骰面」：AI 給的大成功、大失敗也照骰面收斂
  const natOnly = naturalCritOnly(state)
  const judged = (Object.keys(DEGREE_NAME) as Degree[]).includes(r.degree as Degree)
    ? clampDegree(r.degree as Degree, p.natural, natOnly)
    : computeDegree(p.natural, p.natural + p.modifiers[attr] + situationalTotal(p, skill), dc, natOnly)
  const degree: Degree = trivial && judged !== 'critical' ? 'success' : judged
  const hoursRaw = num(r.hours)
  const range = kindDef.hours_range
  const hours = range && !Number.isNaN(hoursRaw) ? Math.round(clamp(hoursRaw, range[0], range[1]) * 4) / 4 : undefined
  const allowed = new Set(kindDef.effects)
  const pc = pcOf(state)
  const known = (id: string) => !!state.relationships?.[id]
  const effects: RewardEffect[] = []
  const affinitySeen = new Map<string, number>()
  let items = 0
  let flags = 0
  let money = 0
  const adjusted: string[] = []
  const notes: string[] = []
  let joinAsk: Record<string, unknown> | undefined
  // 同一樣物品這次已經給出去、拿到的數量（AI 可能分兩筆寫同一樣東西）
  const given = new Map<string, number>()
  const got = new Map<string, number>()
  // 這次有付錢（money 為負）：當成買來的東西，同一種可以拿到 item_qty_bought 個（白拿的照 item_qty）
  const paying = (Array.isArray(r.effects) ? r.effects : []).some((e) => !!e && typeof e === 'object' && (e as Record<string, unknown>).type === 'money' && num((e as Record<string, unknown>).amount) < 0)
  const itemQty = paying ? Math.max(caps.item_qty, caps.item_qty_bought ?? caps.item_qty) : caps.item_qty
  for (const e of Array.isArray(r.effects) ? r.effects : []) {
    if (!e || typeof e !== 'object') continue
    const x = e as Record<string, unknown>
    const type = String(x.type) as JudgedEffect
    const kind = EFFECT_OF[type]
    if (!kind || !allowed.has(kind)) continue
    switch (type) {
      case 'affinity': {
        const npc = String(x.npc ?? '')
        const delta = num(x.delta)
        if (!known(npc) || Number.isNaN(delta)) break
        const used = affinitySeen.get(npc) ?? 0
        const d = clamp(Math.round(delta), -caps.affinity - used, caps.affinity - used)
        if (d === 0) break
        affinitySeen.set(npc, used + d)
        effects.push({ type, npc, delta: d, ...(x.reason ? { reason: clipText(x.reason, 40) } : {}) })
        break
      }
      case 'relationship_text': {
        const npc = String(x.npc ?? '')
        const text = clipText(x.text, caps.relationship_text_chars)
        if (known(npc) && text) effects.push({ type, npc, text })
        break
      }
      case 'flag': {
        const key = clipText(x.key, 40).replace(/[^\w:\-\u4e00-\u9fff]/g, '_')
        if (!key || flags >= caps.flags || key.startsWith('black_market:') || key.startsWith('underworld:') || key.startsWith('invite_wait:') || key === 'negotiate_bonus') break
        const value = typeof x.value === 'boolean' || typeof x.value === 'number' ? x.value : clipText(x.value, 60) || true
        effects.push({ type, key: `ai:${key}`, value })
        flags++
        break
      }
      case 'reputation': {
        // 只認得遊戲裡的勢力（id 或名稱），亂填的名字不會變成讀不到的新聲望
        const name = clipText(x.faction, 30)
        const faction = geography.factions.find((f) => f.id === name || f.name === name)?.id
        const delta = num(x.delta)
        if (!faction || Number.isNaN(delta)) break
        const d = clamp(Math.round(delta), -caps.reputation, caps.reputation)
        if (d) effects.push({ type, faction, delta: d })
        break
      }
      case 'money': {
        const amount = num(x.amount)
        if (Number.isNaN(amount)) break
        const cap = caps.money_cc_per_level * pc.level
        // 只能賺取上限內的錢；花錢不能超過持有的金額（money 是這次前面幾筆的合計）
        const a = clamp(Math.round(amount), -Math.max(0, state.money_cc + money), cap - Math.max(0, money))
        if (a !== Math.round(amount)) {
          adjusted.push(amount > 0
            ? `金錢只拿到 ${formatMoney(a)}（提議的 ${formatMoney(Math.round(amount))} 超過上限）`
            : `只付得出 ${formatMoney(-a)}（提議付 ${formatMoney(-Math.round(amount))}，身上的錢不夠）`)
        }
        if (a) {
          money += a
          effects.push({ type, amount: a })
        }
        break
      }
      case 'item': {
        // 名字照資料的寫法（AI 照簡體的提示詞回傳時是簡體）：行囊、物品目錄、這個存檔自創的物品
        const name = itemNameOf(state, clipText(x.name, 20))
        const qty = num(x.qty)
        if (!name || Number.isNaN(qty)) break
        const q = Math.round(qty)
        if (!q) break
        if (items >= caps.items) {
          adjusted.push(`${name}沒有算進去（一次最多 ${caps.items} 筆物品）`)
          break
        }
        let n: number
        if (q > 0) {
          n = Math.min(q, Math.max(0, itemQty - (got.get(name) ?? 0)))
          if (n < q) adjusted.push(`${name}只得到 ${n} 個（提議的 ${q} 個超過上限）`)
        } else {
          const have = (state.inventory.find((i) => i.name === name)?.qty ?? 0) - (given.get(name) ?? 0)
          n = -Math.min(-q, Math.max(0, have))
          if (-n < -q) adjusted.push(`${name}只交得出 ${-n} 個（提議交出 ${-q} 個，身上不夠）`)
        }
        if (n) {
          if (n < 0) given.set(name, (given.get(name) ?? 0) - n)
          else got.set(name, (got.get(name) ?? 0) + n)
          effects.push({ type, name, qty: n })
          items++
        }
        break
      }
      case 'hp': {
        // 受傷或治療：每人最多失去 hp_loss_ratio、回復 hp_gain_ratio 的最大生命值，不會因此倒下
        const target = String(x.target ?? 'pc')
        const who = target === 'pc' ? pc : state.party.find((m) => m.id === target)
        const amount = num(x.amount)
        if (!who || Number.isNaN(amount) || effects.some((y) => y.type === 'hp' && y.target === who.id)) break
        const a = clamp(Math.round(amount), -Math.ceil(who.maxHp * caps.hp_loss_ratio), Math.ceil(who.maxHp * caps.hp_gain_ratio))
        if (a) effects.push({ type: 'hp', target: who.id, amount: a })
        break
      }
      case 'lewd': {
        // 慾望指標：每人每項一次，±caps.lewd；只在可能進入親密場景的行動
        // 隊友的戰敗事件：沒寫對象時是被圍住的那位隊友
        const target = String(x.target ?? (p.kind === 'defeat_event' && p.actor ? p.actor : 'pc'))
        const who = target === 'pc' ? pc : state.party.find((m) => m.id === target)
        const stat = String(x.stat ?? '') as LewdKey
        const delta = num(x.delta)
        if (!p.adultScene || !who || !LEWD_KEYS.includes(stat) || Number.isNaN(delta)) break
        if (effects.some((y) => y.type === 'lewd' && (y.target ?? pc.id) === who.id && y.stat === stat)) break
        const d = clamp(Math.round(delta), -caps.lewd, caps.lewd)
        if (d) effects.push({ type: 'lewd', stat, delta: d, target: who.id })
        break
      }
      case 'ability': {
        // 技能報酬只在 AI 判定為大成功時採用，最多一項
        if (degree !== 'critical' || effects.some((y) => y.type === 'ability')) break
        const target = String(x.target ?? 'pc')
        if (target !== 'pc' && !state.party.some((m) => m.id === target)) break
        const raw = clipText(x.ability, 30)
        const ability = raw ? canonicalName(raw, Object.values(abilities).map((a) => a.name)) : raw
        effects.push({ type: 'ability', target, ...(ability ? { ability } : {}) })
        break
      }
      case 'mark': {
        // 刻印時 AI 依主角的行為提議的印記名稱與描述（只是文字）
        if (effects.some((y) => y.type === 'mark')) break
        const name = clipText(x.name, slaveryRules.custom_mark.name_chars)
        const text = clipText(x.text ?? x.mark, slaveryRules.custom_mark.mark_chars)
        if (name || text) effects.push({ type: 'mark', ...(name ? { name } : {}), ...(text ? { text } : {}) })
        break
      }
      case 'free': {
        // 解除主角的契約：只在大成功時採用；自由行動要有對象（例如施術者、願意出手的大人物）
        if (degree !== 'critical' || !contractOf(pc) || state.pendingMark || effects.some((y) => y.type === 'free')) break
        if (p.kind === 'free' && !p.target) break
        effects.push({ type: 'free', npc: 'pc' })
        break
      }
      case 'change_master': {
        // 對象成為主角的新主人：成功以上、主角是奴隸、對象就是這次行動的對象而且在身邊
        if (!degree || !['critical', 'success'].includes(degree) || !contractOf(pc) || state.pendingMark || !p.target) break
        if (String(x.npc ?? p.target) !== p.target || p.target === contractOf(pc)!.master || effects.some((y) => y.type === 'change_master')) break
        const rec = npcRecord(state, p.target)
        if (!rec || rec.dead || !presentHere(state, rec.id)) break
        effects.push({ type: 'change_master', master: rec.id })
        break
      }
      case 'gear': {
        // 裝備：打造時是成品的名稱、描述與附魔（底材與材料固定，稀有度依成功程度）；
        // 自由行動時是事件得到的裝備：成功以上、材料不超過主角等級、稀有度不超過材料原本的（大成功可以高一級），最多一件
        if (effects.some((y) => y.type === 'gear')) break
        const name = clipText(x.name, 20) || undefined
        const desc = clipText(x.desc, 80) || undefined
        let spec: GearSpec | undefined
        if (p.kind === 'craft' || p.kind === 'make') {
          const { base, material } = parseCraftTarget(craftPart(p.target))
          spec = sanitizeGearSpec(x, { maxLevel: 99, maxRarity: 'legendary', base, material })
        } else {
          if (degree !== 'critical' && degree !== 'success') break
          const probe = sanitizeGearSpec({ ...x, rarity: undefined, enchants: undefined }, { maxLevel: pc.level })
          if (!probe) break
          const natural = gearRules.materials[probe.material]!.rarity
          spec = sanitizeGearSpec(x, { maxLevel: pc.level, maxRarity: degree === 'critical' ? shiftRarity(natural, 1) : natural })
        }
        if (spec) effects.push({ type: 'gear', spec, ...(name ? { name } : {}), ...(desc ? { desc } : {}) })
        break
      }
      case 'meet': {
        // 只有在旅店長休、對象是同旅館的人時才能認識新的人
        if (p.target !== 'guests' || effects.some((y) => y.type === 'meet')) break
        const spec = (x.npc && typeof x.npc === 'object' ? x.npc : {}) as Record<string, unknown>
        const str = (v: unknown, n: number) => clipText(v, n) || undefined
        const level = Math.max(1, Math.min(pc.level + 2, Math.round(num(spec.level) || pc.level)))
        const affinity = clamp(Math.round(num(x.affinity) || 0), -caps.meet_affinity, caps.meet_affinity)
        const npc: NpcSpec = { level, location: state.location }
        for (const [k, n] of [['name', 12], ['gender', 10], ['race', 12], ['class', 12], ['personality', 80], ['appearance', 120], ['background', 120]] as const) {
          const v = str(spec[k], n)
          if (v) npc[k] = v
        }
        effects.push({ type: 'meet', npc, spot: 'inn', ...(affinity ? { affinity } : {}), ...(str(x.to_player, caps.relationship_text_chars) ? { to_player: str(x.to_player, caps.relationship_text_chars)! } : {}) })
        break
      }
      case 'rumor': {
        // 每次最多一則；地點與怪物由程式驗證（intel.ts 的 rumorFrom）
        if (effects.some((y) => y.type === 'rumor')) break
        const informant = p.target ? npcRecord(state, p.target)?.name : undefined
        const rumor = rumorFrom(state, x, degree, informant)
        if (rumor) effects.push(rumor)
        break
      }
      case 'join':
        // 入隊在其他效果之後檢查（同一次判定的親密度變化要算進去）
        joinAsk ??= x
        break
      case 'xp': {
        const amount = num(x.amount)
        if (Number.isNaN(amount) || amount <= 0) break
        effects.push({ type, amount: clamp(Math.round(amount), 0, caps.xp_per_level * pc.level) })
        break
      }
    }
  }
  if (joinAsk) judgeJoin(state, p, joinAsk, degree, attr, skill, affinitySeen, effects, adjusted, notes)
  const updates: RelationshipUpdate[] = []
  for (const u of Array.isArray(r.relationship_updates) ? r.relationship_updates : []) {
    const id = String((u as Record<string, unknown>)?.id ?? '')
    const text = clipText((u as Record<string, unknown>)?.to_player, caps.relationship_text_chars)
    if (known(id) && text) updates.push({ id, to_player: text })
  }
  return {
    attr, dc,
    ...(skill ? { skill } : {}),
    ...(clipText(r.rationale, 200) ? { rationale: clipText(r.rationale, 200) } : {}),
    degree,
    ...(clipText(r.summary, caps.summary_chars) ? { summary: clipText(r.summary, caps.summary_chars) } : {}),
    ...(clipText(r.twist, 120) ? { twist: clipText(r.twist, 120) } : {}),
    ...(clipText(r.findings, caps.findings_chars) ? { findings: clipText(r.findings, caps.findings_chars) } : {}),
    ...(clipText(r.narrative, caps.narrative_chars) ? { narrative: clipText(r.narrative, caps.narrative_chars) } : {}),
    ...(clipText(r.adult_scene, 40) ? { adult_scene: clipText(r.adult_scene, 40) } : {}),
    ...(trivial ? { trivial } : {}),
    ...(hours !== undefined ? { hours } : {}),
    ...(p.kind === 'invent' && r.invention && typeof r.invention === 'object' ? { invention: r.invention as Record<string, unknown> } : {}),
    ...(p.kind === 'perk_pitch' && r.perk && typeof r.perk === 'object' ? { perk: r.perk as Record<string, unknown> } : {}),
    effects,
    relationship_updates: updates,
    ...(adjusted.length ? { adjusted } : {}),
    ...(notes.length ? { notes } : {}),
  }
}

/**
 * 行動的對象答應入隊：成功以上，而且要符合「邀請認識的人」的所有條件（人在身邊、親密度、冷卻、空位、小隊找隊長），
 * 檢定總值也要達到邀請的 DC。親密度用這次判定結算後的數字。不符合時不採用，寫進結果與交給寫手；
 * 對方真的拒絕（成功程度或檢定總值不夠）時和邀請一樣，下次長休前不能再邀請。
 * 對方先開口邀請、主角答應（offered）而且親密度到 invite.offered_min_affinity：不比邀請的 DC，沒成也不加冷卻
 */
function judgeJoin(
  state: GameState, p: ActionPending, x: Record<string, unknown>, degree: Degree, attr: AttrId, skill: SkillId | undefined,
  affinitySeen: Map<string, number>, effects: RewardEffect[], adjusted: string[], notes: string[],
) {
  const npc = String(x.npc ?? p.target ?? '')
  const who = npcRecord(state, npc)?.name ?? '對方'
  const refuse = (why: string, wait = false) => {
    const t = `${who}沒有入隊：${why}${wait ? '（下次長休前不能再邀請）' : ''}`
    adjusted.push(t)
    notes.push(`（${t}）`)
    if (wait) effects.push({ type: 'flag', key: `invite_wait:${npc}`, value: true })
  }
  if (!p.target || npc !== p.target) return refuse(p.with?.length ? '只有這次行動的主要對象能入隊' : '只有這次行動的對象能入隊')
  const rel = state.relationships?.[npc]
  const delta = affinitySeen.get(npc) ?? 0
  // 暫時套上這次的親密度變化來檢查（檢查完還原，實際的變化在結算時套用）
  if (rel) rel.affinity += delta
  try {
    try {
      validateInvite(state, npc)
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err))
    }
    const need = companionRules.invite.offered_min_affinity
    const affinity = rel?.affinity ?? 0
    const offered = x.offered === true && affinity >= need
    if (degree !== 'critical' && degree !== 'success') return refuse('入隊要成功以上', !offered)
    if (offered) {
      effects.push({ type: 'companion', npc, mode: 'voluntary' })
      return
    }
    const inv = inviteDc(state, npc)
    const total = p.natural + p.modifiers[attr] + situationalTotal(p, skill)
    const d = computeDegree(p.natural, total, inv, naturalCritOnly(state))
    if (d !== 'critical' && d !== 'success') {
      const why = x.offered === true ? `（對方主動提出，但親密度 ${affinity} 不到 ${need}，照邀請的檢定）` : ''
      return refuse(`檢定總值 ${total} 沒有達到邀請的 DC ${inv}${why}`, true)
    }
    effects.push({ type: 'companion', npc, mode: 'voluntary' })
  } finally {
    if (rel) rel.affinity -= delta
  }
}

// ---- 判定 ----

function actionReport(state: GameState, p: ActionPending, hours: number): Report {
  const start = { ...state.time }
  const loc = locationById(state.location)
  const pc = pcOf(state)
  return {
    schema_version: '0.1',
    report_id: newReportId(state),
    // 特殊任務的判定和任務的其他日誌一樣算事件
    kind: p.kind === 'free' || p.kind === 'craft' || p.kind === 'make' || p.kind === 'produce' || p.kind === 'invent' ? 'action' : p.kind === 'story' ? 'event' : 'social',
    time: { start, end: addHours(start, hours) },
    location: { at: state.location, region: loc.region, scene: p.scene },
    party: state.party.map((m) => snapshot(m, undefined, pc)),
    outcome: { result: 'neutral' },
    changes: {},
    // 自由行動是玩家自己描述的事，預設寫中等篇幅
    narration: { pov: 'second_person', length: p.kind === 'free' ? 'medium' : 'short', ...(p.text ? { player_intent: p.text } : {}) },
    lore_keys: [loc.name, regionById(loc.region).name],
  }
}

/** 依判定（AI 或規則）結算等待中的行動。 */
/**
 * 拆解等待中行動的屬性加值（modifiers[attr] 是屬性調整值 + 熟練）：分成「屬性」「熟練」兩項。
 * 工藝檢定只有縮小的屬性、委託打造由店主擲（屬性不算）；找不到擲骰的人時合成一項。
 */
function attrModParts(state: GameState, p: ActionPending, attr: AttrId): RollPart[] {
  const m = p.modifiers[attr]
  if (p.craftCheck === 'keeper') return []
  if (p.craftCheck === 'self') return [{ label: `${attrName(attr)}（工藝檢定）`, value: m }]
  const actor = p.actor ? memberOrResident(state, currentArea(state), p.actor) : pcOf(state)
  if (!actor) return [{ label: `${attrName(attr)}與熟練`, value: m }]
  const prof = proficiency(actor.level)
  return [{ label: attrName(attr), value: m - prof }, { label: '熟練', value: prof }]
}

/** 擲好的治療、護盾效果寫成一句（給判定的 AI 看） */
function fieldEffectText(effects: FieldEffect[]): string {
  return effects.map((e) => `${e.name}${[e.heal !== undefined ? `回復 ${e.heal} 點生命（超過上限的不算）` : '', e.shield ? `得到 ${e.shield} 點臨時生命` : ''].filter(Boolean).join('、')}`).join('；')
}

export function resolveAction(state: GameState, judgment: Judgment | null): Report {
  const p = state.pendingAction
  if (!p) throw new Error('沒有等待判定的行動')
  const kind = actionRules.kinds[p.kind]
  const attr = judgment?.attr ?? p.attr
  const dc = judgment?.dc ?? p.base_dc
  const skill = judgment?.skill ?? p.skill
  const situational = situationalFor(p, judgment?.skill)
  const modifier = p.modifiers[attr] + situationalTotal(p, judgment?.skill)
  const total = p.natural + modifier
  // 參考：骰值對 DC 算出的成功程度；實際結果由 AI 決定
  const natOnly = naturalCritOnly(state)
  const reference = computeDegree(p.natural, total, dc, natOnly)
  const degree = clampDegree(judgment?.degree ?? reference, p.natural, natOnly)
  delete state.pendingAction

  const report = actionReport(state, p, judgment?.hours ?? p.hours ?? kind.hours)
  const check: CheckInfo = {
    action: kind.name, attr, ...(p.craftCheck === 'keeper' ? { keeper: true } : {}), ...(skill ? { skill } : {}), base_dc: p.base_dc, dc, natural: p.natural, modifier, ...(situational.length ? { situational } : {}), total, degree,
    ...(judgment?.trivial ? { trivial: true } : {}),
    // 日常小事的骰值只決定過程順不順，不算「和骰值不同」
    ...(degree !== reference && !judgment?.trivial ? { reference_degree: reference } : {}),
    source: judgment ? 'ai' : 'rules',
    ...(judgment?.rationale ? { rationale: judgment.rationale } : {}),
    ...(judgment?.twist ? { twist: judgment.twist } : {}),
    ...(judgment?.findings ? { findings: judgment.findings } : {}),
  }
  report.check = check
  if (p.spent?.length) report.changes.resources = [...p.spent]
  if (p.usedAbility) {
    const who = state.party.find((m) => m.id === p.usedAbility!.member)?.name ?? ''
    // 治療、護盾類的能力：效果不看判定結果，照擲好的數字套用
    const lines = p.fieldEffects ? applyFieldEffects(state, report, p.fieldEffects) : []
    report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), `${who}使用了【${p.usedAbility.name}】${lines.length ? `：${lines.join('；')}` : ''}`] }
  }
  if (p.kind === 'rest_talk') {
    // 長休時的互動：把剛結束的長休一起交給 AI 描寫（長休本身不另外寫敘事）
    const restReport = [...state.reports].reverse().find((r) => r.kind === 'rest')
    if (restReport?.outcome.summary) {
      report.narration = { ...report.narration, length: 'medium', focus: [`長休的經過：${restReport.outcome.summary}`, '入睡前或清晨與對象的互動', ...(report.narration?.focus ?? [])] }
    }
  }
  const targets = actionTargets(p)
  for (const id of targets) {
    if (!state.captives?.npcs.includes(id)) continue
    const name = targets.length > 1 ? `${npcRecord(state, id)?.name ?? id}：` : ''
    report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), `${name}${CAPTIVE_NOTE}`] }
  }
  const others = targets.map((id) => state.relationships?.[id]).filter((rel) => !!rel && !report.party.some((x) => x.id === rel.id))
  if (others.length) report.others = others.map((rel) => ({ id: rel!.id, name: rel!.name }))
  report.timeline = [{
    seq: 1, time: report.time.start, actor: p.actor ?? 'pc', action: `${kind.name}（${attrName(attr)}${p.rolls ? `・優勢 ${p.rolls.join('、')}` : ''}）`,
    ...(p.target && !p.target.includes(':') ? { target: p.target } : {}),
    roll: {
      dice: `1d20${modifier >= 0 ? '+' : ''}${modifier}`, value: total, dc,
      ...rollBreakdown(p.natural, [...attrModParts(state, p, attr), ...situational], {
        ...(p.rolls ? { naturals: p.rolls } : {}),
        ...(dc !== p.base_dc ? { dcParts: [{ label: '參考 DC', value: p.base_dc }, { label: 'AI 調整', value: dc - p.base_dc }] } : {}),
      }),
    },
    result: degree === 'fail' ? 'fail' : degree,
  }]

  // 打造：AI 提出的成品交給打造的機制處理（不另外給一件）
  const crafted = p.kind === 'craft' || p.kind === 'make' ? judgment?.effects.find((e) => e.type === 'gear') : undefined
  if (crafted && judgment) judgment.effects = judgment.effects.filter((e) => e !== crafted)
  const moneyBefore = report.changes.money_cc ?? 0
  const partsBefore = report.changes.money_parts?.length ?? 0
  const mechanical = applyMechanics(state, report, p, degree, crafted as Extract<RewardEffect, { type: 'gear' }> | undefined, judgment?.invention ?? judgment?.perk)
  // 機制結算過金錢（工資、消費、雇用費……）而 AI 也給了金錢時，以 AI 的金額為準，取代機制那筆，不重複計算
  const mechanicalMoney = (report.changes.money_cc ?? 0) - moneyBefore
  const aiMoney = judgment?.effects.filter((e) => e.type === 'money').reduce((s, e) => s + Math.round(e.amount), 0) ?? 0
  const replaced = judgment && mechanicalMoney && judgment.effects.some((e) => e.type === 'money')
  if (replaced) {
    if (moneyBefore) report.changes.money_cc = moneyBefore
    else delete report.changes.money_cc
    report.changes.money_parts?.splice(partsBefore)
  }
  const notes = judgment ? applyEffects(state, report, judgment.effects) : defaultEffects(state, report, p, degree)
  if (judgment?.notes?.length) notes.push(...judgment.notes)
  if (replaced && aiMoney !== mechanicalMoney) notes.push(`金錢照判定結算為 ${formatMoney(aiMoney)}（規則原本是 ${formatMoney(mechanicalMoney)}）。`)
  if (judgment) addSuggestions(state, judgment.relationship_updates, report.report_id)
  if (judgment?.narrative) report.narration = { ...report.narration, focus: ['AI 已直接寫出經過'] }
  if (judgment?.adjusted?.length) report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), ...judgment.adjusted.map((t) => `${t}；經過要照實際結算的數字寫`)] }
  const stayed = withNotJoined(state, report, p, notes)
  if (stayed) report.narration = { ...report.narration, focus: [...(report.narration?.focus ?? []), stayed] }
  const scene = adultSceneFor(p, degree, judgment)
  if (scene) report.narration = { ...report.narration, length: report.narration?.length === 'long' ? 'long' : 'medium', adult_scene: scene }
  const success = degree === 'critical' || degree === 'success'
  const lead = `${kind.name}${p.targetName ? `（${p.targetName}）` : ''}：${DEGREE_NAME[degree]}。`
  report.outcome = {
    result: success ? 'success' : degree === 'partial' ? 'neutral' : 'failure',
    // 雇用、聊天、奉承：玩家打的字是說出口的話，放在結果前面（「你說：『……』」）；其他行動接在後面當「想做的事」
    summary: (judgment?.summary || !SPOKEN_KINDS.has(p.kind)
      ? [lead, mechanical, judgment?.summary ?? intentSummary(p), ...notes]
      : [lead, spokenSummary(p), mechanical, ...notes]).filter(Boolean).join(''),
    tags: [kind.name, DEGREE_NAME[degree], ...(judgment?.trivial ? ['日常小事'] : []), ...(judgment?.twist ? ['出乎預料'] : [])],
  }
  const committed = commitReport(state, report)
  // 特殊任務的判定：解鎖或結束的任務點，更新地圖上的 ⭐
  if (p.kind === 'story') {
    refreshStoryMarkers(state)
    applyPendingMove(state)
  }
  return committed
}

/**
 * 沒有 AI 判定的摘要時（規則判定、AI 漏寫）：用玩家描述的行動當摘要，冒險記憶才不會只剩「自由行動：成功」。
 * 只有自由行動與自己描述的行動才有玩家的文字；太長時截斷
 */
function intentSummary(p: ActionPending): string {
  const t = clipIntent(p)
  return t ? `想做的事：${t}。` : ''
}

/** 玩家打的字就是對對方說的話的行動（雇用、聊天、奉承） */
const SPOKEN_KINDS = new Set<string>(['hire', 'chat', 'flatter'])
function spokenSummary(p: ActionPending): string {
  const t = clipIntent(p)
  return t ? `你說：「${t}」` : ''
}
function clipIntent(p: ActionPending): string {
  const t = p.text?.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const max = 60
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * 這次的經過有沒有親密場景：行動本身會進入場景（娼館、戰敗事件沒能脫身），
 * 或 AI 判定認為有（主人的要求、自由行動、長休的互動……）。
 */
export function adultSceneFor(p: ActionPending, degree: Degree, judgment: Judgment | null): string | undefined {
  const s = p.adultScene
  if (s && (!s.on || s.on.includes(degree))) return s.label
  return judgment?.adult_scene
}

function applyMechanics(state: GameState, report: Report, p: ActionPending, degree: Degree, crafted?: Extract<RewardEffect, { type: 'gear' }>, invention?: unknown): string {
  switch (p.kind) {
    case 'hire': return applyHire(state, report, p.target!, p.offer_cc ?? 0, degree)
    case 'haggle': {
      const i = p.target!.indexOf(':')
      return applyHaggle(state, report, p.target!.slice(0, i) as MarketKind | 'curio', p.target!.slice(i + 1), degree)
    }
    case 'invite': return applyInvite(state, report, p.target!, degree)
    case 'squad_join': return applySquadJoin(state, report, p.target!, degree)
    case 'staff_invite': return applyStaffInvite(state, report, p.target!, degree)
    case 'cohabit_invite': return applyCohabitInvite(state, report, p.target!, degree)
    case 'propose': return applyProposal(state, report, p.target!, degree)
    case 'black_market': return applyBlackMarket(state, report, degree)
    case 'palace_gate': return applyPalaceGate(state, degree)
    case 'negotiate': return applyNegotiate(state, report, degree)
    case 'resign': return applyResign(state, report, degree, p.terms)
    case 'escape': return applyEscape(state, report, degree)
    case 'bargain': return applyBargain(state, report, p.target!, degree, p.offer_cc)
    case 'negotiation': return applyNegotiationOutcome(state, report, p.target!, degree)
    case 'chat':
    case 'gift':
    case 'flatter':
    case 'seduce':
    case 'steal':
    case 'attack': return applyInteraction(state, report, p.kind, p.target!, degree, p.item)
    case 'bluff':
    case 'intimidate': return applyStandoff(state, degree)
    case 'master_permit': return applyPermit(state, report, degree)
    case 'master_leave': return applyLeave(state, report, degree)
    case 'master_extend': return applyExtend(state, report, degree)
    case 'marking': return applyMarking(state, degree)
    case 'master_event': return applyMasterEventResponse(state, report, degree)
    case 'master_return': return applyReturn(state, report, degree)
    case 'seek_master': return applySeekMaster(state, report, p.target!, degree)
    case 'unmark': return applyUnmark(state, report, p.target!, degree)
    case 'unbind': return applyUnbind(state, report, p.target!, degree)
    case 'work': return applyWork(state, report, p.target!, degree)
    case 'patron': return applyPatron(state, report, p.target, degree)
    case 'craft': return applyCraft(state, report, p.target!, degree, crafted)
    case 'make': return applyMake(state, report, p.target!, degree, crafted)
    case 'produce': return applyProduce(state, report, p.target!, degree)
    case 'invent': return applyInvent(state, report, p.target!, degree, invention)
    case 'train': return applyTrain(state, report, p.target!, degree)
    case 'explore': return applyExplore(state, report, degree)
    case 'perk_pitch': {
      const text = applyPitch(state, report, p.target!, degree, invention)
      pruneOffers(state.party.find((m) => m.id === parsePitchTarget(p.target).member)!)
      return text
    }
    case 'defeat_event': return applyDefeatResponse(state, report, degree)
    case 'story': return applyStoryCheck(state, report, p.target!, degree)
    case 'free':
    case 'rest_talk': return ''
  }
}

/** 玩家邀請入隊、或這次有人入隊時，同行的對象（沒有入隊的）要寫明沒有跟來：AI 只對主要對象寫 join 時，經過可能把大家都寫成同行 */
function withNotJoined(state: GameState, report: Report, p: ActionPending, notes: string[]): string | undefined {
  if (p.kind !== 'free' || !p.with?.length) return undefined
  const joined = report.changes.companions?.some((c) => c.change === 'joined')
  if (!joined && !notes.some((n) => n.includes('入隊')) && !/入隊|加入|同行|跟我走|一起走/.test(p.text)) return undefined
  const names = p.with.filter((id) => !state.party.some((m) => m.id === id)).map((id) => npcRecord(state, id)?.name ?? id)
  return names.length ? `${names.join('、')}沒有加入隊伍，這次之後也不會跟著主角走：經過不要寫成同行或答應入隊` : undefined
}

/** 沒有 AI（或 AI 的判斷與骰值不符）時的預設效果：自由行動依成功程度小幅改變每位對象的親密度。 */
function defaultEffects(state: GameState, report: Report, p: ActionPending, degree: Degree): string[] {
  if (p.kind === 'rest_talk') return restTalkDefaults(state, report, p, degree)
  if (p.kind === 'master_event') return masterEventDefaults(state, report, degree)
  if (p.kind !== 'free') return []
  const delta = { critical: 4, success: 2, partial: 0, fail: -2, fumble: -4 }[degree]
  for (const id of actionTargets(p)) if (state.relationships?.[id]) addAffinity(state, report, id, delta, p.text.slice(0, 30))
  return []
}

/** 長休時的互動（依規則）：和隊友聊天親密度小幅變化；和同旅館的人相處愉快時會認識一位新朋友。 */
function restTalkDefaults(state: GameState, report: Report, p: ActionPending, degree: Degree): string[] {
  const delta = { critical: 3, success: 2, partial: 1, fail: -1, fumble: -3 }[degree]
  if (p.target === 'guests') {
    if (degree !== 'critical' && degree !== 'success') return []
    return applyEffects(state, report, [{ type: 'meet', npc: { level: pcOf(state).level, location: state.location }, spot: 'inn', affinity: delta * 3 }])
  }
  const targets = p.target ? [p.target] : state.party.filter((m) => !m.isPlayer).map((m) => m.id)
  for (const id of targets) addAffinity(state, report, id, delta, '長休時的相處')
  return []
}
