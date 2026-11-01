// 報酬／後果模板：事件、委託與主動行動的結果都用同一組效果描述，可以任意組合。
//
// 例：委託報酬「80 白鸛＋傷藥 2 瓶＋委託人好感 +5＋獵戶自願入隊」
//   [{ type: 'money', amount: 80 }, { type: 'item', name: '傷藥', qty: 2 },
//    { type: 'affinity', npc: 'gen_3', delta: 5 }, { type: 'companion', npc: 'gen_3', mode: 'voluntary' }]
//
// applyEffects 在報告提交前呼叫：金錢、物品、親密度、聲望、經驗、旗標寫進 report.changes，由 commitReport 套用；
// 入隊、離隊、狀態、生命值等直接修改狀態，並記錄在 report.changes。數值上限由呼叫端（例如主動行動）負責夾住。

import { attachParasite, changeCorruption, detachParasite, tameParasite } from './parasites'
import { pcBodyAllowed, tagsAllowed } from './content'
import { characterBody } from './look'
import { addItem } from './state'
import { abilities, classAbilities, classes, enemies, locationById, masterEventPool, perkDef, slaveryRules, type AbilityDef, type AttrId, type LewdKey, type LockGrade, type MasterEventPool } from './data'
import { grantPerk, losePerk, offerPerks } from './perks'
import { abilityChoices, abilityQuality, carryLearned, learnable, learnAbility, maxCircle, recalc } from './character'
import { formatMoney } from './money'
import { npcRecord, generateNpc, type NpcSpec } from './npcs'
import { changeHitDice, changeSlots } from './resources'
import {
  addAffinity, addCondition, changeMaster, enslavePlayer, followRoom, freePlayer, freeSlave, isBound, joinParty, leaderOf, leaveParty, partyRoom, pcOf, removeCondition, setHp,
} from './party'
import { addMemory, addSuggestions, ensureRelationship } from './social'
import { withRng } from './state'
import { gearKnown, registerGear, syncGear } from './gear'
import type { Character, GameState, GearSpec, Intel, NpcRecord, Report, TattooPlace } from './types'
import { addIntel } from './intel'
import { hearOf } from './bestiary'
import { inActiveSquad } from './squads'
import { joinGroup, queueJoin } from './away'
import { startStory, storyDef } from './story'
import { contractKind, randomMaster } from './slavery'
import { forceEquip, restrainPc } from './forcedGear'
import { addStrict, extendDeadline, sendToMasterHome } from './masterHome'
import { addTattoo, contractOf, freePlaces, oathText, placeName, removeTattoo, tattooFromTemplate, tattooKindName, tattoosOf, type NewTattoo } from './tattoos'
import { gameRule, rewardMoney } from './gameRules'
import { addLewd, lewdName } from './lewd'

export type NpcRef = string | NpcSpec

export type RewardEffect =
  | { type: 'money'; amount: number }
  | { type: 'item'; name: string; qty: number; quality?: string }
  | { type: 'affinity'; npc: string; delta: number; reason?: string }
  | { type: 'reputation'; faction: string; delta: number }
  | { type: 'xp'; amount: number; target?: string }
  | { type: 'flag'; key: string; value: unknown }
  /** 新增夥伴：自願、雇傭或以奴隸身分入隊 */
  | { type: 'companion'; npc: NpcRef; mode: 'voluntary' | 'hired' | 'slave'; contract?: string }
  /** 主角加入別人的隊伍（被動邀請），對方可能付錢 */
  | { type: 'join_party'; leader: NpcRef; members?: NpcRef[]; pay_cc?: number }
  | { type: 'leave'; npc: string; reason?: string }
  /** 人際關係文字：預設是提議（玩家確認後才寫入） */
  | { type: 'relationship_text'; npc: string; text: string; apply?: boolean }
  | { type: 'memory'; summary: string; importance?: 1 | 2 | 3 }
  | { type: 'condition'; target: string; condition: string; add: boolean }
  /** 生命值：amount 為加減的點數，ratio 為最大生命值的比例（不會因此倒下，至少留 1 點） */
  | { type: 'hp'; target: string; amount?: number; ratio?: number }
  /** 法術環：delta < 0 花掉（至少 circle 環），> 0 回復（不超過 circle 環） */
  | { type: 'slot'; target: string; delta: number; circle?: number }
  /** 生命骰：delta < 0 花掉，> 0 回復 */
  | { type: 'hit_dice'; target: string; delta: number }
  /**
   * 主角淪為奴隸（只有特殊任務可以用）：master 指定主人（固定 NPC 的 id 或規格）；沒有時 random 生成一位隨機的主人
   * （tag：主人的身分標籤，不寫＝依公開市場的權重抽）。主角已經是奴隸時改成換主人，印記沿用。
   */
  | { type: 'enslave_player'; master?: NpcRef; random?: { tag?: string }; contract: string; members?: NpcRef[] }
  /** 刻印時提議的印記名稱與描述（只是文字，數值依模板） */
  | { type: 'mark'; name?: string; text?: string }
  /** 解除契約：npc 為 pc 時是主角獲釋 */
  | { type: 'free'; npc: string }
  /** 替換主角的主人（印記沿用）；master 為 null 時變成無主 */
  | { type: 'change_master'; master: NpcRef | null; reason?: string }
  /** 委託報酬按百分比調整（談判的結果） */
  | { type: 'quest_reward'; quest: string; percent: number }
  /** 任務旗標，例如 lead（委託檢定 +5，情報商與情報物品給的線索） */
  | { type: 'quest_flag'; quest: string; key: string; value: unknown }
  /**
   * 技能報酬：學會新能力。ability 指定能力（id 或名稱，必須是目前可以學的）；沒指定或不能學時隨機挑一項。
   * choices 有值時改成給一次「N 選一」的學習機會（和升級一樣在隊伍視窗選）。chance 為取得的機率。
   */
  | { type: 'ability'; target?: string; ability?: string; choices?: number; chance?: number }
  /**
   * 裝備（打造或事件生成）：spec 為底材 × 材料＋稀有度與附魔（已經整理過），name 沒有時用制式名稱或「稀有度＋制式名稱」。
   * 新的裝備登錄在 state.customItems。
   */
  | { type: 'gear'; spec: GearSpec; name?: string; desc?: string }
  /** 認識新的人（例如同旅館的旅客）：登錄 NPC、建立人際關係，平常待在 spot */
  | { type: 'meet'; npc: NpcSpec; affinity?: number; to_player?: string; spot?: string }
  /** 情報：在近郊或地下城的某一層放一個事件點（戰鬥、寶物、流浪商人），記在冒險筆記 */
  | { type: 'intel'; intel: Omit<Intel, 'id' | 'from' | 'time' | 'status' | 'kind'> }
  /**
   * 向人打聽到的傳聞（AI 判定的 rumor，程式驗證過地點與怪物）：記在冒險筆記的情報頁；
   * point 是驗證過、可以放事件點的傳聞（某處盤踞著某種怪物）；monster 點亮怪物圖鑑
   */
  | { type: 'rumor'; title: string; text: string; npc?: string; location?: string; monster?: string; point?: Omit<Intel, 'id' | 'from' | 'time' | 'status' | 'kind'> }
  /** 開始一個特殊任務（情報商賣的任務消息） */
  | { type: 'start_story'; story: string }
  /** 主人把主角帶回主人的家（主人的事件用） */
  | { type: 'master_home' }
  /** 嚴加看管的點數（正數加重，負數放寬；主人的事件用） */
  | { type: 'strict'; delta: number }
  /** 離家期限延長幾小時（主人的事件用） */
  | { type: 'home_extend'; hours: number }
  /**
   * 特質：給一次取得的機會（從 perk 與 options 選一個，也可以寫說法交給 AI）。target 預設主角；source 是機會的來源說明。
   * direct：直接學會 perk，不給選擇。
   */
  | { type: 'perk'; perk?: string; options?: string[]; target?: string; source?: string; direct?: boolean }
  /** 失去特質 */
  | { type: 'lose_perk'; perk: string; target?: string }
  /**
   * 刺青（主角）：圖樣（tattoos.json 的 templates），或自己描述（kind、name、text；誓約要 attrs）。
   * place 沒寫時挑圖樣建議的部位裡空著的（都滿了就任何空的部位）；部位已經有刺青、誓約不合規則或太多時不刺。by 是誰刺的
   */
  | { type: 'tattoo'; template?: string; kind?: 'plain' | 'oath'; name?: string; text?: string; attrs?: Partial<Record<AttrId, number>>; place?: TattooPlace; by?: string }
  /** 洗掉主角的刺青：指定部位，或某一種（plain / oath）全部；奴隸印記不能用這個（解除契約用 free） */
  | { type: 'remove_tattoo'; place?: TattooPlace; kind?: 'plain' | 'oath' }
  /** 主人強制主角裝上一件裝備並鎖住（npc 是主人；item 沒寫時從主人會用的裡面隨機挑，見 forcedGear.ts） */
  | { type: 'force_equip'; npc: string; item?: string }
  /** 陷阱鎖：把一件拘束具戴到主角身上、用 lock 等級（預設白鐵）的鎖鎖住；脫縛、鑰匙或鐵匠剪鎖才拿得下（docs/LEWD_STATS.md 第 27 節） */
  | { type: 'restrain'; item: string; lock?: LockGrade }
  /** 主角的寄生物（parasites.json）：寄生（add）、馴服（tame）、拿掉（remove） */
  | { type: 'parasite'; parasite: string; op: 'add' | 'tame' | 'remove' }
  /** 寄生物的侵蝕度加減 */
  | { type: 'corruption'; parasite: string; delta: number }
  /** 慾望指標的加減（docs/LEWD_STATS.md）：target 預設主角；曝露名聲記在目前的地區 */
  | { type: 'lewd'; stat: LewdKey; delta: number; target?: string }
  /**
   * 從事件庫（主人事件、調教、娼館的打工與受訓）掛的技能（teaches）裡，抽一個 target 還沒學、等級也夠的色情技能學會；
   * 全部學過時套用 fallback。target 預設主角
   */
  | { type: 'ability_pool'; pool: MasterEventPool; target?: string; fallback?: RewardEffect[] }

export const EFFECT_TYPES: RewardEffect['type'][] = [
  'money', 'item', 'affinity', 'reputation', 'xp', 'flag', 'companion', 'join_party', 'leave',
  'relationship_text', 'memory', 'condition', 'hp', 'enslave_player', 'free', 'change_master', 'quest_reward', 'quest_flag', 'meet', 'ability', 'slot', 'hit_dice', 'mark', 'gear',
  'intel', 'start_story', 'master_home', 'strict', 'home_extend', 'perk', 'lose_perk', 'tattoo', 'remove_tattoo', 'force_equip', 'restrain',
  'parasite', 'corruption', 'lewd', 'ability_pool', 'rumor',
]

/** NPC 參照：已登場的 id，或是一份規格（生成新角色）。 */
export function resolveNpc(state: GameState, ref: NpcRef, prefix = 'evt'): NpcRecord {
  if (typeof ref === 'string') {
    const rec = npcRecord(state, ref)
    if (!rec) throw new Error(`unknown npc: ${ref}`)
    return rec
  }
  if (ref.id) {
    const rec = npcRecord(state, ref.id)
    if (rec) return rec
  }
  return withRng(state, (rng) => generateNpc(state, rng, ref, prefix))
}

function memberOrPc(state: GameState, id: string) {
  return id === 'pc' ? pcOf(state) : state.party.find((m) => m.id === id)
}

/** 錢不夠時只付得出身上有的（扣到 0 為止）：事件與主人的要求用；同一份報告裡已經算進的錢也算 */
export function affordable(state: GameState, effects: RewardEffect[], report?: Report): RewardEffect[] {
  let left = Math.max(0, state.money_cc + (report?.changes.money_cc ?? 0))
  return effects
    .map((x) => {
      if (x.type !== 'money' || x.amount >= 0) return x
      const paid = Math.min(-x.amount, left)
      left -= paid
      return { ...x, amount: -paid }
    })
    .filter((x) => x.type !== 'money' || x.amount !== 0)
}


/** 學會一個色情技能（事件、受訓、光顧娼婦、調教）：記進報告、能帶就帶上；回傳日誌的一句 */
export function teachAbility(state: GameState, report: Report, who: Character, id: string): string {
  const a = learnAbility(who, id)
  ;(report.changes.skills_gained ??= []).push({ actor: who.id, skill: a.name, quality: abilityQuality(a), source: 'insight' })
  const carried = carryLearned(who, a.id, gameRule(state, 'skillLoadout'))
  return `${who.name}學會了【${a.name}】${carried ? '' : '（攜帶已滿，先放進技能庫）'}`
}

/** 事件庫掛的技能裡，這個人還沒學、等級也夠的色情技能，隨機抽一個（ability_pool） */
export function poolAbility(state: GameState, who: Character, pool: MasterEventPool): AbilityDef | undefined {
  const ids = [...new Set(masterEventPool(pool).flatMap((e) => e.teaches ?? []))]
  const open = ids.map((id) => abilities[id]).filter((a): a is AbilityDef => !!a && a.classes.includes('lewd') && !who.abilities.includes(a.id) && (a.unlock ?? 1) <= who.level)
  return open.length ? withRng(state, (rng) => rng.pick(open)) : undefined
}

/** 套用效果，回傳每個效果的簡短說明（無法套用的會註明原因）。 */
export function applyEffects(state: GameState, report: Report, effects: RewardEffect[]): string[] {
  const notes: string[] = []
  const c = report.changes
  for (const e of effects) {
    switch (e.type) {
      case 'money':
        if (!e.amount) break
        // 事件與任務給的錢照存檔規則的倍率（付出去的不變）
        c.money_cc = (c.money_cc ?? 0) + rewardMoney(state, Math.round(e.amount))
        break
      case 'item':
        if (e.qty > 0) (c.items_gained ??= []).push({ name: e.name, qty: e.qty, ...(e.quality ? { quality: e.quality } : {}), owner: 'pc' })
        else if (e.qty < 0) (c.items_lost ??= []).push({ name: e.name, qty: -e.qty })
        break
      case 'gear': {
        // 底材或材料被刪掉的裝備獎勵：略過
        if (!gearKnown(e.spec)) {
          notes.push('（有一件裝備獎勵已經不存在）')
          break
        }
        const name = registerGear(state, e.spec, e.name, e.desc)
        ;(c.items_gained ??= []).push({ name, qty: 1, owner: 'pc' })
        notes.push(`得到【${name}】`)
        break
      }
      case 'affinity': {
        const rec = npcRecord(state, e.npc)
        if (rec) ensureRelationship(state, rec)
        addAffinity(state, report, e.npc, e.delta, e.reason)
        break
      }
      case 'reputation':
        // local：所在地的勢力（和商店交易的 expandTokens 同一條規則），沒有勢力的地方算冒險者公會
        if (e.delta) (c.reputation ??= []).push({ faction: e.faction === 'local' ? locationById(state.location).faction ?? 'guild' : e.faction, delta: Math.round(e.delta) })
        break
      case 'xp': {
        const targets = e.target ? state.party.filter((m) => m.id === e.target) : state.party
        for (const m of targets) (c.xp ??= []).push({ actor: m.id, amount: Math.round(e.amount) })
        break
      }
      case 'flag':
        ;(c.flags ??= {})[e.key] = e.value
        break
      case 'companion': {
        // 指定的固定 NPC 已經不存在（自訂內容刪掉了），或已經在隊伍裡：略過
        if (typeof e.npc === 'string' && !npcRecord(state, e.npc)) {
          notes.push('（要加入的角色已經不存在）')
          break
        }
        const rec = resolveNpc(state, e.npc)
        if (state.party.some((m) => m.id === rec.id)) {
          notes.push(`${rec.name}已經在隊伍裡了`)
          break
        }
        // 已經死了、被制伏等你處置的人：不能入隊（被制伏的人要在戰後處置收為奴隸）
        if (rec.dead) {
          notes.push(`（${rec.name}已經不在人世，沒辦法入隊）`)
          break
        }
        if (state.captives?.npcs.includes(rec.id)) {
          notes.push(`（${rec.name}被制伏了，要先在戰後處置決定怎麼對待）`)
          break
        }
        if (e.mode === 'slave' && contractOf(pcOf(state))) {
          notes.push(`身為奴隸，無法擁有奴隸`)
          break
        }
        // 小隊的人自願或受雇入隊：整隊一起來。隊伍放不下時等主角決定（騰出位子或放棄），不會只進來一部分
        const { people, squad } = joinGroup(state, rec, e.mode)
        if (partyRoom(state) < people.length) {
          ensureRelationship(state, rec)
          queueJoin(state, { kind: 'join', npcs: people.map((r) => r.id), mode: e.mode, ...(e.contract ? { contract: e.contract } : {}), ...(squad ? { squad } : {}), ...(report.outcome.summary ? { source: report.outcome.summary } : {}) })
          notes.push(`${people.map((r) => r.name).join('、')}想加入，但隊伍放不下：騰出位子或放棄`)
          break
        }
        const [first, ...mates] = people
        const joined = joinParty(state, first!, e.mode, report, { ...(e.contract ? { contract: e.contract } : {}), reason: '事件' })
        if (squad) joined.squad = squad
        for (const r of mates) joinParty(state, r, e.mode, report, { reason: `跟著${rec.name}入隊` }).squad = squad!
        notes.push(`${people.map((r) => r.name).join('、')}加入了隊伍`)
        break
      }
      case 'join_party': {
        // 被主人帶著時跟不了別人的隊伍（主人才是隊長）
        if (isBound(state)) {
          notes.push('身為奴隸，跟不了別人的隊伍')
          break
        }
        if (leaderOf(state)) {
          notes.push('你已經跟著別人的隊伍了')
          break
        }
        const leader = resolveNpc(state, e.leader)
        // 帶隊的是固定 NPC 小隊的隊長、又沒指定隊員：整支小隊一起
        const sq = !e.members?.length ? inActiveSquad(state, leader.id) : undefined
        const members = sq?.leader === leader.id
          ? sq.members.map((id) => npcRecord(state, id)).filter((r): r is NpcRecord => !!r && !r.dead && !state.party.some((m) => m.id === r.id))
          : (e.members ?? []).map((m) => resolveNpc(state, m))
        if (followRoom(state) < 1 + members.length) {
          queueJoin(state, { kind: 'follow', npcs: [leader.id, ...members.map((m) => m.id)], ...(e.pay_cc ? { pay_cc: Math.round(e.pay_cc) } : {}), ...(report.outcome.summary ? { source: report.outcome.summary } : {}) })
          notes.push(`${leader.name}的隊伍帶不下你們這麼多人：騰出位子或放棄`)
          break
        }
        joinParty(state, leader, 'leader', report, { group: leader.id })
        for (const m of members) joinParty(state, m, 'ally', report, { group: leader.id })
        if (e.pay_cc) c.money_cc = (c.money_cc ?? 0) + Math.round(e.pay_cc)
        notes.push(`加入了${leader.name}的隊伍`)
        break
      }
      case 'leave':
        if (state.party.some((m) => m.id === e.npc && !m.isPlayer)) leaveParty(state, e.npc, report, e.reason)
        break
      case 'relationship_text':
        if (!state.relationships?.[e.npc]) break
        if (e.apply) state.relationships[e.npc]!.toPlayer = e.text
        else addSuggestions(state, [{ id: e.npc, to_player: e.text }], report.report_id)
        break
      case 'memory':
        addMemory(state, {
          time: { ...report.time.start }, location: report.location.at,
          participants: report.party.map((p) => p.id), summary: e.summary, importance: e.importance ?? 2,
        })
        break
      case 'condition': {
        const who = memberOrPc(state, e.target)
        if (!who) break
        if (e.add) addCondition(who, e.condition, report)
        else removeCondition(who, e.condition, report)
        break
      }
      case 'hp': {
        const who = memberOrPc(state, e.target)
        if (!who) break
        const delta = e.amount ?? Math.round((e.ratio ?? 0) * who.maxHp)
        setHp(state, who, who.hp + delta, report)
        break
      }
      case 'slot': {
        const who = memberOrPc(state, e.target)
        if (!who || !e.delta) break
        const n = changeSlots(who, e.delta, e.circle, report)
        if (n) notes.push(`${who.name}${e.delta < 0 ? '用掉' : '回復'} ${n} 個法術環`)
        break
      }
      case 'hit_dice': {
        const who = memberOrPc(state, e.target)
        if (!who || !e.delta) break
        const n = changeHitDice(who, e.delta, report)
        if (n) notes.push(`${who.name}${n > 0 ? '回復' : '用掉'} ${Math.abs(n)} 顆生命骰`)
        break
      }
      case 'enslave_player': {
        const master = e.master ? resolveNpc(state, e.master) : randomMaster(state, e.random?.tag)
        if (contractOf(pcOf(state))) {
          // 已經是奴隸：換主人，印記沿用
          changeMaster(state, master, report, '特殊任務')
          notes.push(`${master.name}成為主角的新主人`)
          break
        }
        const members = (e.members ?? []).map((m) => resolveNpc(state, m))
        const contract = contractKind(master.tags?.includes('prostitute') ? slaveryRules.roles.madam : e.contract)
        enslavePlayer(state, master, contract, report, members)
        // 刻印前還有一次檢定：主角的表現決定最後刻上哪一種印記
        state.pendingMark = { intended: contract }
        notes.push(`主角成為${master.name}的奴隸`)
        break
      }
      case 'mark': {
        if (state.pendingMark) state.pendingMark.suggestion = { ...(e.name ? { name: e.name } : {}), ...(e.text ? { mark: e.text } : {}) }
        break
      }
      case 'change_master': {
        const master = e.master === null ? null : resolveNpc(state, e.master)
        changeMaster(state, master, report, e.reason)
        notes.push(master ? `${master.name}成為主角的新主人` : '主角變成無主的奴隸')
        break
      }
      case 'master_home': {
        const line = sendToMasterHome(state, report)
        if (line) notes.push(line.replace(/。$/, ''))
        break
      }
      case 'strict':
        addStrict(state, e.delta)
        if (e.delta > 0) notes.push('之後被看得更緊')
        else if (e.delta < 0) notes.push('看管放寬了一些')
        break
      case 'perk': {
        const who = memberOrPc(state, e.target ?? 'pc')
        if (!who) break
        // 缺陷不是機會：直接染上
        if (e.perk && (e.direct || perkDef(e.perk)?.flaw)) {
          const got = grantPerk(who, e.perk, report)
          if (got) notes.push(got.flaw ? `${who.name}多了一個缺陷【${got.name}】` : `${who.name}學會了特質【${got.name}】`)
          break
        }
        const options = [...(e.perk ? [e.perk] : []), ...(e.options ?? [])]
        const offer = offerPerks(who, e.source ?? '事件', options)
        if (offer) notes.push(offer.options.length ? `${who.name}有機會學會特質：${offer.options.map((id) => perkDef(id)?.name ?? id).join('、')}` : `${who.name}有機會學會一個特質`)
        break
      }
      case 'lose_perk': {
        const who = memberOrPc(state, e.target ?? 'pc')
        const lost = who && losePerk(who, e.perk, report)
        if (lost) notes.push(lost.flaw ? `${who!.name}克服了缺陷【${lost.name}】` : `${who!.name}失去了特質【${lost.name}】`)
        break
      }
      case 'tattoo': {
        const pc = pcOf(state)
        try {
          const t: NewTattoo = e.template
            ? tattooFromTemplate(e.template, pc, e.place)
            : { kind: e.kind ?? 'plain', place: e.place ?? freePlaces(pc)[0]!, name: e.name || '刺青', desc: e.text ?? '', ...(e.attrs ? { attrs: e.attrs } : {}) }
          const added = addTattoo(pc, { ...t, ...(e.by ? { by: e.by } : {}) }, state.time)
          recalc(pc)
          setHp(state, pc, pc.hp, report)
          ;(report.changes.tattoos ??= []).push({ actor: 'pc', place: added.place, kind: added.kind, name: added.name ?? '', added: true })
          notes.push(`主角的${placeName(added.place)}多了${tattooKindName(added.kind)}【${added.name}】${added.attrs ? `（${oathText(added.attrs)}）` : ''}`)
        } catch (err) {
          notes.push(`沒有刺上刺青（${err instanceof Error ? err.message : String(err)}）`)
        }
        break
      }
      case 'parasite': {
        const pc = pcOf(state)
        if (e.op === 'add') {
          const r = attachParasite(pc, e.parasite, state.time)
          if (r.removed) addItem(state.inventory, r.removed, 1)
          syncGear(pc, classes[pc.class]?.weapon)
          recalc(pc)
          if (r.note) notes.push(r.note)
        } else {
          const line = e.op === 'tame' ? tameParasite(pc, e.parasite) : detachParasite(pc, e.parasite)
          syncGear(pc, classes[pc.class]?.weapon)
          recalc(pc)
          setHp(state, pc, pc.hp, report)
          if (line) notes.push(line)
        }
        break
      }
      case 'corruption': {
        const line = changeCorruption(pcOf(state), e.parasite, e.delta)
        if (line) notes.push(line)
        break
      }
      case 'ability_pool': {
        const who = e.target ? state.party.find((m) => m.id === e.target) ?? pcOf(state) : pcOf(state)
        const pick = poolAbility(state, who, e.pool)
        if (pick) notes.push(teachAbility(state, report, who, pick.id))
        else if (e.fallback?.length) notes.push(...applyEffects(state, report, e.fallback.filter((x) => x.type !== 'ability_pool')))
        break
      }
      case 'lewd': {
        const who = e.target ? state.party.find((m) => m.id === e.target) ?? pcOf(state) : pcOf(state)
        const d = addLewd(state, who, e.stat, e.delta, report)
        if (d) notes.push(`${who.name}的${lewdName(e.stat)} ${d > 0 ? '+' : ''}${d}`)
        break
      }
      case 'force_equip': {
        const line = forceEquip(state, report, e.npc, e.item)
        notes.push(line || '主人沒有挑到要你戴的東西')
        break
      }
      case 'restrain': {
        const line = restrainPc(state, report, e.item, e.lock)
        if (line) notes.push(line)
        break
      }
      case 'remove_tattoo': {
        const pc = pcOf(state)
        const places = e.place ? [e.place] : tattoosOf(pc).filter((t) => t.kind === e.kind).map((t) => t.place)
        for (const place of places) {
          const t = removeTattoo(pc, place)
          if (!t) continue
          recalc(pc)
          setHp(state, pc, pc.hp, report)
          ;(report.changes.tattoos ??= []).push({ actor: 'pc', place, kind: t.kind, name: t.name ?? '', added: false })
          notes.push(`主角${placeName(place)}的${tattooKindName(t.kind)}【${t.name}】被洗掉了`)
        }
        break
      }
      case 'home_extend':
        extendDeadline(state, e.hours)
        notes.push(`離家的期限多了 ${Math.round((e.hours / 24) * 10) / 10} 天`)
        break
      case 'free':
        if (e.npc === 'pc') freePlayer(state, report)
        else freeSlave(state, e.npc, report)
        break
      case 'quest_reward': {
        const q = state.quests.find((x) => x.id === e.quest)
        if (!q) break
        const before = q.reward_cc
        q.reward_cc = Math.max(0, Math.round(q.reward_cc * (1 + e.percent / 100)))
        notes.push(`「${q.title}」的報酬從 ${formatMoney(before)} 調整為 ${formatMoney(q.reward_cc)}`)
        break
      }
      case 'ability': {
        const who = memberOrPc(state, e.target ?? 'pc')
        if (!who) break
        if (e.chance !== undefined && e.chance < 1 && !withRng(state, (rng) => rng.chance(e.chance!))) break
        if (e.choices) {
          const choices = withRng(state, (rng) => abilityChoices(who, rng, Math.max(1, Math.min(5, e.choices!))))
          if (!choices.length) {
            notes.push(`${who.name}沒有可以學的新能力`)
            break
          }
          who.pendingAbilityChoices = [...(who.pendingAbilityChoices ?? []), choices]
          notes.push(`${who.name}得到一次學習新能力的機會（${choices.length} 選一）`)
          break
        }
        const wanted = e.ability?.trim()
        // 指定的能力：是這個職業的、法術的環階夠就直接學會（不受等級的品質與解鎖限制）；學不了時改成三選一並說明，不隨機換成別的
        const named = wanted ? abilities[wanted] ?? Object.values(abilities).find((a) => a.name === wanted) : undefined
        if (named) {
          if (who.abilities.includes(named.id)) {
            notes.push(`${who.name}已經會【${named.name}】了`)
            break
          }
          const own = classAbilities(who.class).some((a) => a.id === named.id) || named.classes.includes('lewd')
          if (own && (named.type !== 'spell' || (named.circle ?? 1) <= maxCircle(who))) {
            learnAbility(who, named.id)
            ;(report.changes.skills_gained ??= []).push({ actor: who.id, skill: named.name, quality: abilityQuality(named), source: 'insight' })
            const carried = carryLearned(who, named.id, gameRule(state, 'skillLoadout'))
            notes.push(`${who.name}領悟了【${named.name}】${carried ? '' : '（攜帶已滿，先放進技能庫）'}`)
            break
          }
          const choices = withRng(state, (rng) => abilityChoices(who, rng, 3))
          const why = own ? '環階不夠' : '不是這個職業的能力'
          if (choices.length) {
            who.pendingAbilityChoices = [...(who.pendingAbilityChoices ?? []), choices]
            notes.push(`${who.name}學不了【${named.name}】（${why}），改成一次學習新能力的機會（${choices.length} 選一）`)
          } else notes.push(`${who.name}學不了【${named.name}】（${why}），也沒有其他可以學的新能力`)
          break
        }
        // 沒有指定：從可以學的能力裡隨機領悟一項
        const pool = learnable(who)
        const def = pool.length ? withRng(state, (rng) => rng.pick(pool)) : undefined
        if (!def) {
          notes.push(`${who.name}沒有可以學的新能力`)
          break
        }
        learnAbility(who, def.id)
        ;(report.changes.skills_gained ??= []).push({ actor: who.id, skill: def.name, quality: abilityQuality(def), source: 'insight' })
        notes.push(`${who.name}領悟了【${def.name}】`)
        break
      }
      case 'meet': {
        const rec = resolveNpc(state, e.npc, 'met')
        if (e.spot) rec.spot = e.spot
        const rel = ensureRelationship(state, rec)
        if (e.to_player) rel.toPlayer = e.to_player
        if (e.affinity) addAffinity(state, report, rec.id, e.affinity, '初次相識')
        ;(report.others ??= []).push({ id: rec.id, name: rec.name, race: rec.race, class: rec.class, level: rec.level, personality: rec.personality })
        notes.push(`認識了${rec.name}`)
        break
      }
      case 'quest_flag': {
        const q = state.quests.find((x) => x.id === e.quest)
        if (q) (q.flags ??= {})[e.key] = e.value
        break
      }
      case 'intel': {
        const it = addIntel(state, { ...e.intel, kind: 'point' })
        notes.push(`記下情報「${it.title}」`)
        break
      }
      case 'rumor': {
        const extra = { ...(e.npc ? { npc: e.npc } : {}), ...(e.monster ? { monster: e.monster } : {}) }
        const it = e.point
          ? addIntel(state, { ...e.point, title: e.title || e.point.title, text: e.text || e.point.text, kind: 'point', ...extra })
          : addIntel(state, { kind: 'rumor', title: e.title, text: e.text, ...(e.location ? { location: e.location } : {}), ...extra })
        notes.push(e.point ? `記下情報「${it.title}」（地圖上會出現事件點）` : `記下傳聞「${it.title}」`)
        if (e.monster && hearOf(state, e.monster, e.npc)) notes.push(`怪物圖鑑點亮：${enemies[e.monster]?.name ?? e.monster}`)
        break
      }
      case 'start_story': {
        const def = storyDef(e.story)
        if (!def) {
          notes.push('（要開始的特殊任務已經不存在）')
          break
        }
        if (state.stories?.[e.story]) {
          notes.push(`特殊任務「${def.title}」已經開始過了`)
          break
        }
        // 設定關掉的內容（成人向、NTR……）：不開始
        if (!tagsAllowed(def.tags) || !pcBodyAllowed(def.start.pc_body, characterBody(pcOf(state)))) {
          notes.push(`（特殊任務「${def.title}」的內容在設定裡關閉了）`)
          break
        }
        // 特殊任務的結果接著開始另一個任務：另外一則日誌（這一則是原本任務的經過）
        if (report.story) {
          startStory(state, e.story)
          notes.push(`開始特殊任務「${def.title}」`)
          break
        }
        // 情報商賣的任務消息：記在冒險筆記的情報
        startStory(state, e.story, { report })
        addIntel(state, { kind: 'story', story: e.story, title: def.title, text: report.outcome.summary ?? '' })
        break
      }
    }
  }
  return notes
}
