import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../../schemas/report.schema.json'
import { computeDegree, prepareAction, resolveAction, sanitizeJudgment } from '@/engine/actions'
import { startCombat } from '@/engine/combat'
import {
  acceptPartyOffer, buySlave, hireAtAsking, marketStock, offerSelf, requestLeave, releaseSlave,
  partyOffersHere, tavernCandidates, waitForParty,
} from '@/engine/companions'
import { contractDef, population, slaveryRules } from '@/engine/data'
import { mod, proficiency } from '@/engine/character'
import { checkBonus } from '@/engine/perks'
import { withBonus } from '@/engine/rng'
import { applyEffects } from '@/engine/effects'
import { currentArea, enterLocation, standOn, type CellKind } from '@/engine/grid'
import { enterUnderworld, underworldEntryBlocked } from '@/engine/underworld'
import { generateNpc, npcKind, npcRecord, slavePrice } from '@/engine/npcs'
import { isFugitive, leaderOf } from '@/engine/party'
import { autoHitDice, hitDiceLeft, longRest, shortRest, shortRestPreview } from '@/engine/rest'
import { acceptSuggestion, addMemory, addSuggestions, compactMemories, editMemory, ensureRelationship, setAffinity } from '@/engine/social'
import { applyRosterFlavor, outsideQuota } from '@/engine/population'
import { chooseMark, termsFromTemplate } from '@/engine/slavery'
import { addHours, commitReport, migrate, newGame, withRng } from '@/engine/state'
import { acceptQuest, guildQuests, recruit } from '@/engine/town'
import type { GameState, Report } from '@/engine/types'
import { buildActionPrompt, buildRosterPrompt, extractJson, splitSuggestions, visibleNarration } from '@/narrator/judge'
import { contractOf } from '@/engine/tattoos'

const ajv = new Ajv2020({ strict: false })
const validate = ajv.compile(schema)
function expectValid(report: Report) {
  const ok = validate(report)
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
}

function game(seed = 1, opts: { classId?: string; cha?: number; location?: string } = {}): GameState {
  const state = newGame({ name: '艾倫', race: 'human', classId: opts.classId ?? 'fighter', seed })
  if (opts.cha) state.party[0]!.attrs.cha = opts.cha
  if (opts.location) state.location = opts.location
  enterLocation(state)
  return state
}

function blankReport(state: GameState): Report {
  return {
    schema_version: '0.1', report_id: `r-test-${state.nextReportNo++}`, kind: 'event',
    time: { start: { ...state.time }, end: addHours(state.time, 1) },
    location: { at: state.location }, party: [], outcome: { result: 'success', summary: '測試事件' }, changes: {},
  }
}

/** 擲完骰後把自然骰改成指定值（測試用） */
function forceRoll(state: GameState, natural: number) {
  state.pendingAction!.natural = natural
}

describe('reward template', () => {
  it('combines money, items, affinity, xp and a new companion in one report', () => {
    const state = game(1)
    recruit(state, 'npc_lina')
    const money = state.money_cc
    const report = blankReport(state)
    const notes = applyEffects(state, report, [
      { type: 'money', amount: 80 },
      { type: 'item', name: '傷藥', qty: 2 },
      { type: 'affinity', npc: 'npc_lina', delta: 5, reason: '一起救了人' },
      { type: 'xp', amount: 10 },
      { type: 'companion', npc: { name: '獵戶托比', race: 'human', class: 'ranger', level: 2 }, mode: 'voluntary' },
      { type: 'flag', key: 'saved_village', value: true },
    ])
    commitReport(state, report)
    expectValid(report)
    expect(notes).toContain('獵戶托比加入了隊伍')
    expect(state.money_cc).toBe(money + 80)
    expect(state.inventory.find((i) => i.name === '傷藥')?.qty).toBe(2)
    expect(state.relationships!.npc_lina!.affinity).toBe(5)
    const toby = state.party.find((m) => m.name === '獵戶托比')!
    expect(toby.bond).toBe('voluntary')
    expect(state.relationships![toby.id]!.affinity).toBe(10)
    expect(report.changes.companions?.[0]).toMatchObject({ change: 'joined', bond: 'voluntary' })
    expect(state.flags.saved_village).toBe(true)
  })

  it('can give a companion as a slave with a contract mark', () => {
    const state = game(2)
    const report = blankReport(state)
    applyEffects(state, report, [{ type: 'companion', npc: { name: '俘虜', race: 'demon', level: 1 }, mode: 'slave', contract: 'combat' }])
    commitReport(state, report)
    const slave = state.party.find((m) => m.name === '俘虜')!
    expect(slave.bond).toBe('slave')
    expect(contractOf(slave)).toMatchObject({ kind: 'combat', master: 'pc', obedience: contractDef('combat').obedience_penalty })
    expect(slave.status).toContain('slave_mark')
    expect(state.relationships![slave.id]!.affinity).toBe(-10)
  })

  it('queues a join for the player to decide when the party is full instead of throwing', () => {
    const state = game(3)
    const report = blankReport(state)
    const effects = Array.from({ length: 4 }, (_, i) => ({ type: 'companion' as const, npc: { name: `路人${i}` }, mode: 'voluntary' as const }))
    const notes = applyEffects(state, report, effects)
    expect(state.party).toHaveLength(4)
    expect(notes.at(-1)).toContain('騰出位子或放棄')
    expect(state.pendingJoins).toHaveLength(1)
  })
})

describe('short and long rests', () => {
  it('spends a hit die for any wound, says so on the button, and explains a rest that heals nothing', () => {
    const state = game(4)
    const pc = state.party.find((m) => m.isPlayer)!
    // 只少 2 點也會花一顆（以前要少半顆骰以上）
    pc.hp = pc.maxHp - 2
    expect(autoHitDice(pc)).toBe(1)
    expect(shortRestPreview(state).note).toBe('用 1 顆骰')
    const r = shortRest(state) as Report
    expect(pc.hp).toBe(pc.maxHp)
    expect(r.outcome.summary).toContain('花了 1 顆生命骰')
    // 生命骰用完了：按鈕與日誌都說明
    pc.hp = pc.maxHp - 2
    expect(shortRestPreview(state).note).toBe('骰用完了')
    const r2 = shortRest(state) as Report
    expect(r2.outcome.summary).toContain('生命骰用完了，要長休才會恢復')
    // 生命是滿的
    pc.hp = pc.maxHp
    expect(shortRestPreview(state).note).toBe('生命全滿')
    expect((shortRest(state) as Report).outcome.summary).toContain('生命都是滿的')
  })

  it('spends hit dice on a short rest and regains half of them on a long rest', () => {
    const state = game(4)
    const pc = state.party[0]!
    pc.hp = 1
    const report = shortRest(state) as Report
    expectValid(report)
    expect(report.kind).toBe('rest')
    expect(pc.hp).toBeGreaterThan(1)
    expect(pc.hitDiceUsed).toBe(1)
    expect(hitDiceLeft(pc)).toBe(0)
    expect(report.changes.hit_dice?.[0]).toMatchObject({ actor: 'pc', spent: 1 })

    expect(() => longRest(state, 'inn')).toThrow('要在旅店')
    standOn(state, 'inn')
    pc.hp = 1
    const night = longRest(state, 'inn')
    expectValid(night)
    expect(pc.hp).toBe(pc.maxHp)
    expect(pc.hitDiceUsed).toBe(0)
    expect(() => longRest(state, 'inn')).toThrow('還要 16 小時才能再長休')
  })

  it('can be ambushed while resting in the wild', () => {
    let ambushed = false
    for (let seed = 1; seed < 40 && !ambushed; seed++) {
      const state = game(seed)
      standOn(state, 'gate')
      state.position!.area = `${state.location}/outskirts`
      state.areas![`${state.location}/outskirts`] = {
        key: `${state.location}/outskirts`, location: state.location, name: '近郊', kind: 'wild', width: 1, height: 1, cells: [{ kind: 'floor' }],
      }
      state.position = { area: `${state.location}/outskirts`, x: 0, y: 0 }
      const r = shortRest(state)
      if ('combatants' in r) {
        ambushed = true
        expect(state.combat?.scene).toContain('短休時遭到襲擊')
      }
    }
    expect(ambushed).toBe(true)
  })

  it('lets companions with low affinity leave at a rest, except slaves', () => {
    const state = game(5)
    recruit(state, 'npc_lina')
    const report = blankReport(state)
    applyEffects(state, report, [{ type: 'companion', npc: { name: '奴隸甲' }, mode: 'slave' }])
    commitReport(state, report)
    const slave = state.party.find((m) => m.name === '奴隸甲')!
    setAffinity(state, 'npc_lina', -25)
    setAffinity(state, slave.id, -80)
    const rest = shortRest(state) as Report
    expect(state.party.map((m) => m.id)).toEqual(['pc', slave.id])
    expect(rest.outcome.summary).toContain('莉娜受夠了')
    expect(rest.changes.companions?.[0]).toMatchObject({ npc: 'npc_lina', change: 'left' })
    // 離隊的角色資料保存下來，再次入隊時沿用
    expect(state.npcs!.npc_lina!.character?.level).toBe(2)
  })
})

describe('tavern hiring', () => {
  it('offers the adventurers who are in town today, from the roster', () => {
    const state = game(6)
    const list = tavernCandidates(state)
    expect(list.length).toBeGreaterThan(0)
    for (const c of list) expect(npcKind(npcRecord(state, c.npc)!)).toBe('adventurer')
    // 名單相對固定：同一天再問一次是同一批人，不會新增 NPC
    const count = Object.keys(state.npcs!).length
    expect(tavernCandidates(state).map((c) => c.npc)).toEqual(list.map((c) => c.npc))
    expect(Object.keys(state.npcs!).length).toBe(count)
    // 王都 12 + 12 人（不受雇用的固定 NPC 不佔名額），有娼館所以再補到至少 3 位娼妓（補的人數依抽到的身分而定）
    const members = state.rosters!.soriel!.members
    const size = population.roster.capital!
    const extra = members.slice(size.adventurer + size.commoner + members.filter((id) => outsideQuota(id)).length)
    expect(extra.every((id) => npcRecord(state, id)!.tags?.includes('prostitute'))).toBe(true)
    expect(members.filter((id) => npcRecord(state, id)!.tags?.includes('prostitute')).length).toBeGreaterThanOrEqual(population.brothel_workers)
    expect(extra.length).toBeLessThanOrEqual(population.brothel_workers)
  })

  it('hires at the asking price without a check', () => {
    // 種子要讓今天的酒館有生成的冒險者（具名 NPC 佔了索里耶爾的一部分名額）
    const state = game(8)
    state.money_cc = 5000
    const c = tavernCandidates(state).find((x) => x.npc.startsWith('adv_'))!
    hireAtAsking(state, c.npc)
    expect(state.party.find((m) => m.id === c.npc)?.bond).toBe('hired')
    expect(state.money_cc).toBe(5000 - c.asking_cc)
  })

  it('negotiates a lower fee with a check, and can even hire for free', () => {
    const state = game(8)
    const c = tavernCandidates(state).find((x) => x.npc.startsWith('adv_'))!
    const p = prepareAction(state, { kind: 'hire', target: c.npc, offer_cc: 0, text: '請他喝一杯，說明這趟冒險的意義' })
    expect(p.base_dc).toBeGreaterThanOrEqual(22)
    expect(() => prepareAction(state, { kind: 'free', text: '再試一次' })).toThrow('等待判定')
    forceRoll(state, 20)
    const report = resolveAction(state, null)
    expectValid(report)
    expect(report.check).toMatchObject({ natural: 20, degree: 'critical', source: 'rules' })
    expect(state.party.some((m) => m.id === c.npc)).toBe(true)
    expect(state.money_cc).toBe(500)
  })

  it('keeps what the player tried in the summary (and the memory) when there is no AI summary', () => {
    const state = game(8)
    prepareAction(state, { kind: 'free', text: '把磨鈍的短劍拿去鐵匠鋪重新開鋒' })
    forceRoll(state, 15)
    const report = resolveAction(state, null)
    expect(report.outcome.summary).toContain('想做的事：把磨鈍的短劍拿去鐵匠鋪重新開鋒。')
    expect(state.memories?.at(-1)?.summary).toContain('重新開鋒')
  })

  it('puts what was said to the other person before the result for hire (rules judging)', () => {
    const state = game(8)
    const c = tavernCandidates(state).find((x) => x.npc.startsWith('adv_'))!
    prepareAction(state, { kind: 'hire', target: c.npc, offer_cc: 0, text: '我們一起去北方礦坑吧' })
    forceRoll(state, 1)
    const report = resolveAction(state, null)
    expect(report.outcome.summary).toMatch(/^雇傭談判（[^）]+）：大失敗。你說：「我們一起去北方礦坑吧」/)
    expect(report.outcome.summary).not.toContain('想做的事')
  })

  it('makes a counter-offer on a partial success and refuses on a failure', () => {
    const state = game(9)
    // 等級低的人比較好談（參考 DC 不會高到只有大成功才過）
    const [a, b] = tavernCandidates(state).filter((x) => x.npc.startsWith('adv_')).sort((x, y) => x.asking_cc - y.asking_cc)
    const p = prepareAction(state, { kind: 'hire', target: a!.npc, offer_cc: Math.floor(a!.asking_cc / 2), text: '' })
    forceRoll(state, Math.max(2, p.base_dc - p.modifiers.cha - 1))
    resolveAction(state, null)
    expect(tavernCandidates(state).find((x) => x.npc === a!.npc)?.counter_cc).toBeGreaterThan(Math.floor(a!.asking_cc / 2))

    prepareAction(state, { kind: 'hire', target: b!.npc, offer_cc: 0, text: '' })
    forceRoll(state, 1)
    resolveAction(state, null)
    expect(tavernCandidates(state).find((x) => x.npc === b!.npc)?.declined).toBe(true)
    expect(state.relationships![b!.npc]!.affinity).toBe(-8)
  })

  it('accepts AI flavor text for unknown generated residents only', () => {
    const state = game(10)
    tavernCandidates(state)
    const [gen, known] = state.rosters!.soriel!.members.filter((id) => id.startsWith('cmn_'))
    ensureRelationship(state, npcRecord(state, known!)!)
    const before = npcRecord(state, known!)!.name
    expect(buildRosterPrompt(state, 'soriel')!.user).toContain(gen!)
    applyRosterFlavor(state, 'soriel', [
      { id: gen!, name: '星落', appearance: '披著星紋斗篷', personality: '愛看星星', occupation: '占星師' },
      { id: known!, name: '冒牌貨' },
      { id: 'npc_lina', name: '冒牌貨' },
    ])
    expect(state.npcs![gen!]).toMatchObject({ name: '星落', occupation: '占星師', class: '' })
    expect(state.npcs![known!]!.name).toBe(before)
    expect(state.npcs!.npc_lina).toBeUndefined()
    expect(state.npcs![gen!]!.flavored).toBe(true)
    expect(buildRosterPrompt(state, 'soriel')).toBeNull()
  })

  it('flavors newcomers who moved in later, and keeps old flavored rosters as they are (L8)', () => {
    const state = game(10)
    tavernCandidates(state)
    const roster = state.rosters!.soriel!
    applyRosterFlavor(state, 'soriel', [])
    expect(buildRosterPrompt(state, 'soriel')).toBeNull()
    // 名單變動搬來一位新居民：只問他
    const newcomer = roster.members.find((id) => id.startsWith('cmn_'))!
    delete state.npcs![newcomer]!.flavored
    const prompt = buildRosterPrompt(state, 'soriel')!
    expect(prompt.user).toContain(newcomer)
    expect(prompt.user.match(/- id: /g)).toHaveLength(1)
    // AI 回應之前又搬來一位：只標記送出去的人，新來的留到下次
    const late = roster.members.find((id) => id.startsWith('cmn_') && id !== newcomer)!
    const sent = [newcomer]
    delete state.npcs![late]!.flavored
    applyRosterFlavor(state, 'soriel', [], sent)
    expect(state.npcs![newcomer]!.flavored).toBe(true)
    expect(state.npcs![late]!.flavored).toBeUndefined()
    expect(buildRosterPrompt(state, 'soriel')!.user).toContain(late)
    applyRosterFlavor(state, 'soriel', [])
    // 舊存檔：整份名單潤飾過 → 上面的人都算潤飾過
    for (const id of roster.members) delete state.npcs![id]?.flavored
    roster.flavored = true
    state.schema = 4
    const loaded = migrate(JSON.parse(JSON.stringify(state)))
    expect(loaded.rosters!.soriel!.flavored).toBeUndefined()
    expect(buildRosterPrompt(loaded, 'soriel')).toBeNull()
  })
})

describe('joining another party', () => {
  function offered(maxMembers = 2): GameState {
    for (let seed = 1; seed < 80; seed++) {
      const state = game(seed, { cha: 16 })
      waitForParty(state)
      if (state.partyOffers?.length && state.partyOffers[0]!.members.length <= maxMembers) return state
    }
    throw new Error('no offer')
  }

  it('keeps an invitation that arrives after midnight', () => {
    for (let seed = 1; seed < 80; seed++) {
      const state = game(seed, { cha: 16 })
      state.time = { ...state.time, hour: 23, minute: 0 }
      const day = state.time.day
      waitForParty(state)
      if (!state.partyOffers?.length) continue
      expect(state.time.day).toBe(day + 1)
      expect(partyOffersHere(state)).toHaveLength(1)
      return
    }
    throw new Error('no offer')
  })

  it('waits in the tavern for an invitation and joins the leader', () => {
    const state = offered()
    const offer = state.partyOffers![0]!
    const money = state.money_cc
    const report = acceptPartyOffer(state, offer.id)
    expectValid(report)
    const leader = leaderOf(state)!
    expect(leader.id).toBe(offer.leader)
    expect(leader.group).toBe(leader.id)
    expect(state.party.filter((m) => m.group === leader.id)).toHaveLength(1 + offer.members.length)
    expect(state.money_cc).toBe(money + offer.pay_cc)
  })

  it('leaves the party at the next rest with a formal farewell', () => {
    const state = offered(1)
    acceptPartyOffer(state, state.partyOffers![0]!.id)
    const leader = leaderOf(state)!
    expect(() => recruit(state, 'npc_lina')).not.toThrow()
    requestLeave(state, 'formal')
    const r = shortRest(state) as Report
    expect(leaderOf(state)).toBeUndefined()
    expect(r.outcome.summary).toContain('正式道別')
    expect(state.relationships![leader.id]!.affinity).toBe(5 - 3)
    // 主角自己的同伴留下
    expect(state.party.map((m) => m.id)).toEqual(['pc', 'npc_lina'])
  })

  it('sneaks away with a dexterity check', () => {
    const state = offered()
    acceptPartyOffer(state, state.partyOffers![0]!.id)
    requestLeave(state, 'sneak')
    const me = state.party.find((m) => m.isPlayer)!
    me.level = 5
    const r = shortRest(state) as Report
    expect(r.timeline?.[0]?.action).toBe('趁夜偷偷離開')
    expect(r.timeline?.[0]?.roll?.dice).toBe(withBonus('1d20', mod(me.attrs.dex) + proficiency(5) + checkBonus(me, { context: 'stealth', attr: 'dex' })))
    expect(leaderOf(state)).toBeUndefined()
  })
})

describe('slave markets', () => {
  it('prices slaves by the worldbook table and sells them with a contract', () => {
    expect(slavePrice({ race: 'human', class: 'fighter', level: 1 })).toBe(800)
    expect(slavePrice({ race: 'human', class: 'fighter', level: 4 })).toBe(8000)
    expect(slavePrice({ race: 'elf', class: 'fighter', level: 6 })).toBeGreaterThan(200000)

    const state = game(11, { location: 'albena' })
    expect(() => marketStock(state, 'black')).toThrow('黑市')
    const stock = marketStock(state, 'public')
    expect(stock.length).toBeGreaterThanOrEqual(3)
    for (const l of stock) expect(slaveryRules.black_market_only).not.toContain(state.npcs![l.npc]!.race)

    const l = stock[0]!
    state.money_cc = l.price_cc * 2
    const p = prepareAction(state, { kind: 'haggle', target: `public:${l.npc}`, text: '指出他手上的舊傷，說這會影響工作' })
    forceRoll(state, 20)
    const before = l.price_cc
    resolveAction(state, null)
    expect(l.price_cc).toBe(Math.round((before * 0.7) / 10) * 10)
    expect(() => prepareAction(state, { kind: 'haggle', target: `public:${l.npc}`, text: '' })).toThrow('殺過價')
    expect(p.base_dc).toBe(12)

    const money = state.money_cc
    const report = buySlave(state, 'public', l.npc)
    expectValid(report)
    expect(state.money_cc).toBe(money - l.price_cc)
    const slave = state.party.find((m) => m.id === l.npc)!
    expect(slave.bond).toBe('slave')

    releaseSlave(state, slave.id)
    expect(slave.bond).toBe('voluntary')
    expect(contractOf(slave)).toBeUndefined()
    expect(state.relationships![slave.id]!.affinity).toBe(-10 + 15)
  })

  it('finds the underworld by asking around in the tavern, and the black market inside it', () => {
    const state = game(12, { location: 'albena' })
    expect(() => prepareAction(state, { kind: 'black_market', text: '' })).toThrow('酒館')
    standOn(state, 'tavern')
    expect(underworldEntryBlocked(state)).toContain('不知道')
    prepareAction(state, { kind: 'black_market', text: '找看起來最不老實的商人搭話' })
    forceRoll(state, 20)
    resolveAction(state, null)
    expect(state.flags['underworld:albena']).toBe(true)
    expect(() => marketStock(state, 'black')).toThrow('地下街')
    enterUnderworld(state)
    expect(currentArea(state).key).toBe('sm/sm_uw_albena')
    expect(standOn(state, 'lm_uw_black_albena' as CellKind)).toBe(true)
    expect(marketStock(state, 'black').length).toBeGreaterThan(0)
  })
})

describe('the player as a slave', () => {
  function enslaved(): GameState {
    for (let seed = 1; seed < 60; seed++) {
      const state = game(seed, { location: 'rhineburg', cha: 16 })
      offerSelf(state, 'public')
      // 這些測試要的是會帶著主角行動的主人（普通人主人留在城裡，見 slavery.spec）
      if (contractOf(state.party[0]!) && leaderOf(state)) {
        // 刻印檢定：部分成功 = 主人原本打算的印記
        prepareAction(state, { kind: 'marking', text: '' })
        forceRoll(state, 10)
        resolveAction(state, null)
        chooseMark(state, state.pendingMark!.allowed![0]!)
        return state
      }
    }
    throw new Error('nobody bought')
  }

  it('is bought by a master who leads the party; income goes to the master', () => {
    const state = enslaved()
    const pc = state.party[0]!
    const master = leaderOf(state)!
    expect(contractOf(pc)?.master).toBe(master.id)
    expect(pc.status).toContain('slave_mark')
    expect(state.money_cc).toBeGreaterThan(500)
    expect(() => tavernCandidates(state) && hireAtAsking(state, tavernCandidates(state)[0]!.npc)).toThrow('身為奴隸')

    const report = blankReport(state)
    applyEffects(state, report, [{ type: 'money', amount: 100 }])
    const money = state.money_cc
    commitReport(state, report)
    const share = contractDef(contractOf(pc)!.kind).income_share
    expect(state.money_cc).toBe(money + 100 - Math.floor(100 * share))
    expect(report.changes.master_share_cc).toBe(Math.floor(100 * share))
  })

  it('negotiates freedom: the master erases the contract', () => {
    const state = enslaved()
    expect(() => prepareAction(state, { kind: 'negotiate', text: '' })).toThrow('安全的地方')
    standOn(state, 'inn')
    const p = prepareAction(state, { kind: 'negotiate', text: '提出用三次委託的報酬換取自由' })
    expect(p.situational[0]?.value).toBeLessThan(0)
    forceRoll(state, 20)
    const report = resolveAction(state, null)
    expectValid(report)
    expect(contractOf(state.party[0]!)).toBeUndefined()
    expect(state.party[0]!.status).not.toContain('slave_mark')
    expect(report.changes.companions?.some((c) => c.npc === 'pc' && c.change === 'freed')).toBe(true)
    // 主人還在，變成普通的隊長
    expect(leaderOf(state)).toBeTruthy()
  })

  it('escapes as a fugitive whom official institutions refuse, and may be recaptured at rests', () => {
    const state = enslaved()
    const pc = state.party[0]!
    Object.assign(contractOf(pc)!, { kind: 'arcane', terms: termsFromTemplate('arcane') })
    prepareAction(state, { kind: 'escape', text: '趁主人喝醉時從後門溜走' })
    forceRoll(state, 20)
    resolveAction(state, null)
    expect(isFugitive(state)).toBe(true)
    expect(leaderOf(state)).toBeUndefined()
    expect(contractOf(pc)).toBeTruthy()
    standOn(state, 'guild')
    expect(() => acceptQuest(state, guildQuests(state)[0]!.id)).toThrow('契約印記')

    let caught = false
    for (let i = 0; i < 40 && !caught; i++) {
      shortRest(state)
      caught = !isFugitive(state)
    }
    expect(caught).toBe(true)
    expect(leaderOf(state)?.id).toBe(contractOf(pc)!.master)
    expect(pc.status).toContain('punished')
  })

  it('is punished when an escape fails', () => {
    const state = enslaved()
    const pc = state.party[0]!
    const hp = pc.hp
    prepareAction(state, { kind: 'escape', text: '硬闖' })
    forceRoll(state, 1)
    const report = resolveAction(state, null)
    expect(report.check?.degree).toBe('fumble')
    expect(pc.hp).toBeLessThan(hp)
    expect(pc.status).toContain('punished')
    expect(contractOf(pc)!.obedience).toBe(contractDef(contractOf(pc)!.kind).obedience_penalty + 1)
  })

  it('does not seal spells under the arcane contract any more', () => {
    const state = game(13, { classId: 'wizard' })
    const pc = state.party[0]!
    pc.level = 5
    const master = withRng(state, (rng) => generateNpc(state, rng, { level: 6 }))
    applyEffects(state, blankReport(state), [{ type: 'enslave_player', master: master.id, contract: 'arcane' }])
    startCombat(state, [['giant_rat', 1]])
    const me = state.combat!.combatants.find((c) => c.id === 'pc')!
    // 魔導束縛契約以前封印到 1 環（2026-11 拿掉）
    expect(me.slots.length).toBeGreaterThan(1)
  })
})

describe('AI judgment', () => {
  it('computes degrees from the roll and DC', () => {
    expect(computeDegree(20, 5, 15)).toBe('critical')
    expect(computeDegree(10, 25, 15)).toBe('critical')
    expect(computeDegree(10, 15, 15)).toBe('success')
    expect(computeDegree(10, 12, 15)).toBe('partial')
    expect(computeDegree(10, 9, 15)).toBe('fail')
    expect(computeDegree(1, 30, 15)).toBe('fumble')
  })

  it('clamps the DC to ±3, drops disallowed effects and caps the rest', () => {
    const state = game(14)
    recruit(state, 'npc_lina')
    const p = prepareAction(state, { kind: 'free', target: 'npc_lina', text: '給莉娜買了甜點' })
    const j = sanitizeJudgment(state, p, {
      attr: 'cha', dc: p.base_dc - 10, rationale: '莉娜喜歡甜食',
      effects: [
        { type: 'affinity', npc: 'npc_lina', delta: 50 },
        { type: 'affinity', npc: 'npc_lina', delta: 5 },
        { type: 'affinity', npc: 'nobody', delta: 5 },
        { type: 'money', amount: 999999 },
        { type: 'companion', npc: 'npc_lina', mode: 'slave' },
        { type: 'item', name: '神器', qty: 10 },
      ],
      relationship_updates: [{ id: 'npc_lina', to_player: '會分你甜點的朋友' }, { id: 'nobody', to_player: 'x' }],
    })
    expect(j.dc).toBe(p.base_dc - 3)
    expect(j.effects).toEqual([
      { type: 'affinity', npc: 'npc_lina', delta: 8 },
      { type: 'money', amount: 30 },
      { type: 'item', name: '神器', qty: 1 },
    ])
    expect(j.relationship_updates).toEqual([{ id: 'npc_lina', to_player: '會分你甜點的朋友' }])
  })

  it('lets the AI decide the outcome, write the result and queue relationship suggestions', () => {
    const state = game(15)
    recruit(state, 'npc_lina')
    const p = prepareAction(state, { kind: 'free', target: 'npc_lina', text: '聊起沙痕部落' })
    forceRoll(state, 15)
    const judgment = sanitizeJudgment(state, p, {
      attr: 'cha', dc: p.base_dc, degree: 'success', summary: '莉娜難得地聊起了家鄉。', narrative: '營火劈啪作響……',
      effects: [{ type: 'affinity', npc: 'npc_lina', delta: 6 }],
      relationship_updates: [{ id: 'npc_lina', to_player: '願意聊起家鄉的同伴' }],
    })
    expect(judgment.narrative).toBe('營火劈啪作響……')
    const report = resolveAction(state, judgment)
    expectValid(report)
    expect(report.check).toMatchObject({ source: 'ai', degree: 'success', dc: p.base_dc })
    expect(state.relationships!.npc_lina!.affinity).toBe(6)
    expect(state.suggestions).toHaveLength(1)
    acceptSuggestion(state, state.suggestions![0]!.id)
    expect(state.relationships!.npc_lina!.toPlayer).toBe('願意聊起家鄉的同伴')

    // 骰出 1，AI 仍可以讓結果出乎預料地成功；參考結果會記錄下來
    prepareAction(state, { kind: 'free', target: 'npc_lina', text: '笨手笨腳地遞上甜點' })
    forceRoll(state, 1)
    const twist = sanitizeJudgment(state, state.pendingAction!, {
      attr: 'dex', dc: 10, degree: 'success', twist: '甜點掉在地上，莉娜反而笑出聲來',
      effects: [{ type: 'affinity', npc: 'npc_lina', delta: 3 }],
    })
    const r2 = resolveAction(state, twist)
    expectValid(r2)
    expect(r2.check).toMatchObject({ degree: 'success', reference_degree: 'fumble', twist: '甜點掉在地上，莉娜反而笑出聲來' })
    expect(r2.outcome.tags).toContain('出乎預料')
    expect(state.relationships!.npc_lina!.affinity).toBe(9)
  })

  it('follows the dice when the rules decide', () => {
    const state = game(20)
    recruit(state, 'npc_lina')
    prepareAction(state, { kind: 'free', target: 'npc_lina', text: '再聊一次' })
    forceRoll(state, 1)
    const r = resolveAction(state, null)
    expect(r.check).toMatchObject({ degree: 'fumble', source: 'rules' })
    expect(r.check!.reference_degree).toBeUndefined()
    expect(state.relationships!.npc_lina!.affinity).toBe(-4)
  })

  it('lets the AI outcome drive the mechanics, e.g. a hire succeeding on a low roll', () => {
    const state = game(21)
    const c = tavernCandidates(state).find((x) => x.npc.startsWith('adv_'))!
    const p = prepareAction(state, { kind: 'hire', target: c.npc, offer_cc: 10, text: '說起自己在故鄉救過他的妹妹' })
    forceRoll(state, 2)
    resolveAction(state, sanitizeJudgment(state, p, { degree: 'success', twist: '他認出了主角', effects: [] }))
    expect(state.party.some((m) => m.id === c.npc)).toBe(true)
    expect(state.money_cc).toBe(490)
  })

  it('shows the dice and the ±3 window to the AI', () => {
    const state = game(16)
    recruit(state, 'npc_lina')
    const p = prepareAction(state, { kind: 'free', target: 'npc_lina', text: '我說服了她，她立刻答應' })
    const prompt = buildActionPrompt(state, p, '')
    expect(prompt.user).toContain(`自然骰：${p.natural}`)
    expect(prompt.user).toContain(`${p.base_dc - 3}～${p.base_dc + 3}`)
    expect(prompt.system).not.toContain(`參考 DC：${p.base_dc}`)
    expect(prompt.system).toContain('宣稱的結果')
    expect(prompt.system).toContain('出乎預料')
    expect(prompt.system).toContain('narrative')
    expect(prompt.user).toContain('npc_lina')
    expect(extractJson('好的：\n```json\n{"attr":"cha","dc":12}\n```')).toEqual({ attr: 'cha', dc: 12 })
  })
})

describe('relationship suggestions from narration', () => {
  it('splits the suggestion block from the story text', () => {
    const text = '莉娜笑了。\n<relationship_updates>[{"id":"npc_lina","to_player":"信任的同伴"}]</relationship_updates>'
    expect(splitSuggestions(text)).toEqual({ text: '莉娜笑了。', updates: [{ id: 'npc_lina', to_player: '信任的同伴' }] })
    expect(visibleNarration('前文<relationship_upd')).toBe('前文')
    const state = game(17)
    recruit(state, 'npc_lina')
    addSuggestions(state, [{ id: 'npc_lina', to_player: '信任的同伴' }, { id: 'nobody', to_player: 'x' }])
    expect(state.suggestions).toHaveLength(1)
  })
})

describe('memory cap', () => {
  it('merges old daily memories into summaries when there are more than 200', () => {
    const state = game(18)
    for (let i = 0; i < 260; i++) {
      addMemory(state, { time: { day: 1 + Math.floor(i / 10), hour: i % 10 }, location: 'soriel', participants: ['pc'], summary: `日常 ${i}`, importance: 1 })
    }
    addMemory(state, { time: { day: 2, hour: 23 }, location: 'soriel', participants: ['pc'], summary: '重要的事', importance: 3 })
    expect(state.memories!.length).toBeLessThanOrEqual(200)
    expect(state.memories!.some((m) => m.summary === '重要的事')).toBe(true)
    const merged = state.memories!.filter((m) => m.merged)
    expect(merged.length).toBeGreaterThan(0)
    expect(merged[0]!.summary).toContain('的日常：')
    expect(compactMemories(state)).toBe(0)
  })

  it('keeps pinned memories', () => {
    const state = game(19)
    addMemory(state, { time: { day: 1 }, location: 'soriel', participants: ['pc'], summary: '釘選的日常', importance: 1 })
    editMemory(state, state.memories![0]!.id, { pinned: true })
    for (let i = 0; i < 230; i++) addMemory(state, { time: { day: 1 + Math.floor(i / 5) }, location: 'soriel', participants: ['pc'], summary: `x${i}`, importance: 1 })
    expect(state.memories!.some((m) => m.summary === '釘選的日常')).toBe(true)
  })
})
