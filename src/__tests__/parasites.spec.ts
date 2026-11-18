import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { attrSources } from '@/engine/character'
import { setContentFilters } from '@/engine/content'
import { itemDef, stories } from '@/engine/data'
import { applyEffects } from '@/engine/effects'
import { enterLocation, standOn } from '@/engine/grid'
import { unequipItem } from '@/engine/inventory'
import { pcOf } from '@/engine/party'
import {
  answerParasiteEvent, cureOffers, cureParasite, maybeParasiteEvent, parasiteCandidates, parasiteTemplates, pendingParasiteEvent, pruneParasiteEvent,
  flaresOn, reinkAtCarver, reinkOffers, triggerBlock, triggerTamed,
} from '@/engine/parasiteEvents'
import { activeParasites, attachParasite, growParasites, parasiteDef, parasiteOf, parasiteRules, parasiteSummary, removalTerms, stageOf, tameParasite } from '@/engine/parasites'
import { checkModifiers } from '@/engine/perks'
import { eventBaseDc } from '@/engine/dungeonEvents'
import { travelEvents } from '@/engine/road'
import { newGame } from '@/engine/state'
import { condMet, setFlag } from '@/engine/storyFlags'
import { addTattoo, setContract, tattooAt, tattooFromTemplate } from '@/engine/tattoos'
import { washTattoo } from '@/engine/tattooShop'
import { sanitizeTravelEvent } from '@/engine/travelEventMods'
import type { GameState, Report } from '@/engine/types'

const LIN = 'hungry_lingerie'
const MARK = 'succubus_mark'
const SEED = 'parasite_seed'
const keep = { step: parasiteRules.step_chance, travel: parasiteRules.travel_chance, cooldown: parasiteRules.cooldown_hours }

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  setContentFilters({ pc_unwilling: true })
  parasiteRules.step_chance = keep.step
  parasiteRules.travel_chance = keep.travel
  parasiteRules.cooldown_hours = keep.cooldown
})

function game(): GameState {
  const state = newGame({ name: '艾琳', race: 'human', classId: 'rogue', seed: 3, gender: '女', body: 'fem', birthplace: 'rhineburg' })
  enterLocation(state)
  state.money_cc = 100000
  return state
}

function blank(state: GameState): Report {
  return {
    schema_version: '0.1', report_id: `r-${state.nextReportNo++}`, kind: 'event',
    time: { start: { ...state.time }, end: { ...state.time } }, location: { at: state.location }, party: [], outcome: { result: 'neutral' }, changes: {},
  }
}

describe('parasites', () => {
  it('ship three parasites whose items, quest lines and flare events all exist', () => {
    for (const [id, def] of Object.entries(parasiteRules.parasites)) {
      if (def.item) expect(itemDef(def.item), def.item).toBeTruthy()
      if (def.tamed?.item) expect(itemDef(def.tamed.item)?.gear?.unique, def.tamed.item).toBeTruthy()
      for (const sid of def.stories ?? []) expect(stories.some((s) => s.id === sid), sid).toBe(true)
      // 苗床沒有發作事件（brood.spec.ts）
      if (def.category !== 'brood') expect(parasiteTemplates().filter((t) => t.parasite === id).length, id).toBeGreaterThanOrEqual(def.kind === 'seed' ? 3 : 10)
    }
    for (const t of parasiteTemplates()) {
      expect(t.tags, t.id).toContain('adult')
      expect(sanitizeTravelEvent(t.id, t, false), t.id).toEqual(t)
      // 每個發作都有一個抵抗的選項（檢定）與一個屈服的選項（一定進入親密場景）
      expect(t.options!.some((o) => o.check), t.id).toBe(true)
      expect(t.options!.some((o) => o.adult_scene === 'always'), t.id).toBe(true)
    }
  })

  it('lock the lingerie onto the hero; taming swaps it for the unlocked unique piece', () => {
    const state = game()
    const pc = pcOf(state)
    const old = pc.gear?.underwear_top?.name
    applyEffects(state, blank(state), [{ type: 'parasite', parasite: LIN, op: 'add' }])
    expect(pc.gear!.underwear_top).toMatchObject({ name: '渴求的魔導衣', locked: `parasite:${LIN}` })
    if (old) expect(state.inventory.some((i) => i.name === old)).toBe(true)
    expect(() => unequipItem(state, pc.id, 'underwear_top')).toThrow()
    // 同一種只會有一個
    expect(attachParasite(pc, LIN, state.time).note).toContain('已經有')
    applyEffects(state, blank(state), [{ type: 'parasite', parasite: LIN, op: 'tame' }])
    expect(pc.gear!.underwear_top).toEqual({ name: '馴服的魔導衣', spec: itemDef('馴服的魔導衣')!.gear })
    expect(parasiteOf(pc, LIN)).toMatchObject({ tamed: true, corruption: 0 })
    expect(activeParasites(pc)).toEqual([])
  })

  it('carve the mark over a plain tattoo, refuse a slave mark, and go dormant when a slave mark takes the place', () => {
    const state = game()
    const pc = pcOf(state)
    addTattoo(pc, tattooFromTemplate('lotus', pc, 'belly'), state.time)
    expect(attachParasite(pc, MARK, state.time).note).toContain('蓋掉了')
    expect(tattooAt(pc, 'belly')).toMatchObject({ kind: 'curse', parasite: MARK })
    expect(parasiteOf(pc, MARK)!.covered).toMatchObject({ kind: 'plain', place: 'belly' })
    // 未馴服的淫紋洗不掉
    standOn(state, 'carver')
    expect(() => washTattoo(state, 'belly')).toThrow('解咒')
    // 奴隸印記頂掉：沉睡、記下來；刻印師等部位空了才能紋回來
    setContract(pc, { kind: 'labor', master: 'm', masterName: '主人', obedience: 0, since: { ...state.time }, terms: { place: 'belly' } } as never)
    expect(parasiteOf(pc, MARK)).toMatchObject({ dormant: true, stored: { kind: 'curse' } })
    expect(activeParasites(pc)).toEqual([])
    expect(reinkOffers(state)).toEqual([])
    pc.tattoos = (pc.tattoos ?? []).filter((t) => t.kind !== 'slave')
    expect(reinkOffers(state).map((o) => o.kind).sort()).toEqual(['covered', 'curse'])
    reinkAtCarver(state, MARK, 'curse')
    expect(tattooAt(pc, 'belly')).toMatchObject({ kind: 'curse' })
    expect(parasiteOf(pc, MARK)!.dormant).toBeUndefined()
    // 小腹已經是奴隸印記時刻不上去
    const other = game()
    const pc2 = pcOf(other)
    setContract(pc2, { kind: 'labor', master: 'm', masterName: '主人', obedience: 0, since: { ...other.time }, terms: { place: 'belly' } } as never)
    expect(attachParasite(pc2, MARK, other.time).note).toContain('奴隸印記')
    expect(parasiteOf(pc2, MARK)).toBeUndefined()
  })

  it('give the tamed mark its attributes and check bonus; a tamed mark can be washed and re-inked', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, MARK, state.time)
    tameParasite(pc, MARK)
    expect(tattooAt(pc, 'belly')).toMatchObject({ name: '主宰之紋', tamed: true, attrs: { cha: 2, fai: 1 } })
    expect(attrSources(pc).find((x) => x.label.includes('主宰之紋'))?.attrs).toEqual({ cha: 2, fai: 1 })
    expect(checkModifiers(pc, { context: 'action', attr: 'cha' }).some((x) => x.value === 3)).toBe(true)
    standOn(state, 'carver')
    washTattoo(state, 'belly')
    expect(tattooAt(pc, 'belly')).toBeUndefined()
    expect(parasiteOf(pc, MARK)!.stored).toMatchObject({ name: '主宰之紋' })
    reinkAtCarver(state, MARK, 'curse')
    expect(tattooAt(pc, 'belly')).toMatchObject({ name: '主宰之紋' })
  })

  it('stage effects, story conditions and daily growth follow corruption', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, SEED, state.time)
    const p = parasiteOf(pc, SEED)!
    expect(condMet(state, { parasites: { [SEED]: { min: 30 } } })).toBe(false)
    state.time = { ...state.time, day: state.time.day + 2 }
    growParasites(pc, state.time)
    expect(p.corruption).toBe(60)
    expect(stageOf(p.corruption)).toBe(2)
    expect(condMet(state, { parasites: { [SEED]: { min: 30, tamed: false } } })).toBe(true)
    expect(checkModifiers(pc, { context: 'action', attr: 'dex' }).some((x) => x.value === -1)).toBe(true)
    expect(removalTerms(p)).toEqual({ dc: parasiteDef(SEED)!.remove!.dc + 6, price: Math.round(parasiteDef(SEED)!.remove!.price * 1.6) })
  })

  it('do not show the same flare-up again within three days, even when it is the only one that fits', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, MARK, state.time)
    // 支配階段、旅途上：只有「夜營的低語」一件
    parasiteOf(pc, MARK)!.corruption = 100
    parasiteRules.travel_chance = 1
    parasiteRules.cooldown_hours = 0
    expect(parasiteCandidates(state, parasiteOf(pc, MARK)!, 'travel').map((t) => t.id)).toEqual(['pe_mark_camp'])
    const days: number[] = []
    for (let d = 0; d < 7; d++) {
      if (maybeParasiteEvent(state, 'travel')) {
        days.push(d)
        delete state.parasiteEvent
      }
      state.time = { ...state.time, day: state.time.day + 1 }
      parasiteOf(pc, MARK)!.corruption = 100
    }
    expect(days).toEqual([0, 3, 6])
  })

  it('flare up on a step, wait for an answer and move corruption by the choice', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, LIN, state.time)
    parasiteRules.step_chance = 1
    parasiteRules.cooldown_hours = 0
    state.options!.parasiteMult = 0
    expect(maybeParasiteEvent(state, 'step')).toBe(false)
    state.options!.parasiteMult = 2
    expect(maybeParasiteEvent(state, 'step')).toBe(true)
    const t = pendingParasiteEvent(state)!
    expect(parasiteCandidates(state, parasiteOf(pc, LIN)!, 'step').map((x) => x.id)).toContain(t.id)
    // 等待回應時不會再發作
    expect(maybeParasiteEvent(state, 'step')).toBe(false)
    const give = t.options!.findIndex((o) => o.adult_scene === 'always')
    const r = answerParasiteEvent(state, give)
    expect(state.parasiteEvent).toBeUndefined()
    expect(parasiteOf(pc, LIN)!.corruption).toBeGreaterThan(0)
    expect(r.narration?.adult_scene).toBe(t.scene)
    // 寄生物不在了：等待中的事件作廢
    maybeParasiteEvent(state, 'step')
    pc.parasites = []
    pruneParasiteEvent(state)
    expect(state.parasiteEvent).toBeUndefined()
  })

  it('let a tamed parasite be awakened once between long rests', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, LIN, state.time)
    expect(triggerBlock(state, LIN)).toBe('還沒有馴服')
    tameParasite(pc, LIN)
    const r = triggerTamed(state, LIN)
    expect(r.narration?.adult_scene).toBe(parasiteDef(LIN)!.tamed!.scene)
    expect(pc.status).toContain('parasite_glow')
    expect(triggerBlock(state, LIN)).toContain('長休')
    state.lastLongRest = { day: state.time.day + 1, hour: 8, minute: 0 }
    expect(triggerBlock(state, LIN)).toBeUndefined()
  })

  it('cure at the temple or the carver: pay, roll, and the quest line ends with it', () => {
    const state = game()
    const pc = pcOf(state)
    applyEffects(state, blank(state), [{ type: 'parasite', parasite: LIN, op: 'add' }])
    state.stories = { par_lin_look: { status: 'active', started: { ...state.time }, log: [] } as never }
    setFlag(state, 'par_lin_look_start')
    standOn(state, 'carver')
    const offer = cureOffers(state).find((o) => o.id === LIN)!
    expect(offer).toMatchObject({ attr: 'int', dc: removalTerms(parasiteOf(pc, LIN)!)!.dc })
    // 擲到成功為止（失敗時侵蝕度上升）
    for (let i = 0; i < 30 && parasiteOf(pc, LIN); i++) cureParasite(state, LIN)
    expect(parasiteOf(pc, LIN)).toBeUndefined()
    expect(pc.gear?.underwear_top?.name).not.toBe('渴求的魔導衣')
    // 任務線中止，紀錄與旗標清掉：之後再被寄生可以重來
    expect(state.stories!.par_lin_look).toBeUndefined()
    expect(Object.keys(state.flags).some((k) => k.includes('par_lin_'))).toBe(false)
  })

  it('freeze corruption while paused instead of catching up afterwards', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, SEED, state.time)
    attachParasite(pc, MARK, state.time)
    parasiteOf(pc, MARK)!.corruption = 40
    // 發作的機率調成 0 五天再調回來：種子不會一口氣長滿
    state.options = { ...state.options!, parasiteMult: 0 }
    state.time = { ...state.time, day: state.time.day + 5 }
    maybeParasiteEvent(state, 'step')
    delete state.options!.parasiteMult
    maybeParasiteEvent(state, 'step')
    expect(parasiteOf(pc, SEED)!.corruption).toBe(0)
    // 契紋被奴隸印記頂掉二十天，紋回來之後還是 40
    setContract(pc, { kind: 'labor', master: 'm', masterName: '主人', obedience: 0, since: { ...state.time }, terms: { place: 'belly' } } as never)
    state.time = { ...state.time, day: state.time.day + 20 }
    maybeParasiteEvent(state, 'step')
    pc.tattoos = (pc.tattoos ?? []).filter((t) => t.kind !== 'slave')
    standOn(state, 'carver')
    reinkAtCarver(state, MARK, 'curse')
    growParasites(pc, state.time)
    expect(parasiteOf(pc, MARK)!.corruption).toBe(40)
  })

  it('treat a parasite as a plain curse when its flare-ups are filtered out', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, SEED, state.time)
    const p = parasiteOf(pc, SEED)!
    expect(flaresOn(state, p)).toBe(true)
    setContentFilters({ pc_unwilling: false })
    expect(flaresOn(state, p)).toBe(false)
    state.time = { ...state.time, day: state.time.day + 3 }
    parasiteRules.step_chance = 1
    expect(maybeParasiteEvent(state, 'step')).toBe(false)
    expect(p.corruption).toBe(0)
    // 被動效果還在（潛伏階段沒有減值；手動推到支配看靈巧 −2）
    p.corruption = 95
    expect(checkModifiers(pc, { context: 'action', attr: 'dex' }).some((x) => x.value === -2)).toBe(true)
    // 打開之後從今天起才長
    setContentFilters({ pc_unwilling: true })
    maybeParasiteEvent(state, 'step')
    expect(p.corruption).toBe(95)
  })

  it('keep the tattoo a removed mark covered, so the carver can ink it back', () => {
    const state = game()
    const pc = pcOf(state)
    addTattoo(pc, tattooFromTemplate('lotus', pc, 'belly'), state.time)
    attachParasite(pc, MARK, state.time)
    applyEffects(state, blank(state), [{ type: 'parasite', parasite: MARK, op: 'remove' }])
    expect(parasiteOf(pc, MARK)).toBeUndefined()
    expect(tattooAt(pc, 'belly')).toBeUndefined()
    standOn(state, 'carver')
    expect(reinkOffers(state).map((o) => o.kind)).toEqual(['covered'])
    reinkAtCarver(state, MARK, 'covered')
    expect(tattooAt(pc, 'belly')).toMatchObject({ kind: 'plain', template: 'lotus' })
    expect(pc.coveredTattoos).toEqual([])
    expect(reinkOffers(state)).toEqual([])
  })

  it('describe a tamed parasite to the AI as waiting for orders', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, LIN, state.time)
    tameParasite(pc, LIN)
    expect(parasiteSummary(pc)).toContain('蠢蠢欲動，但乖乖地在等待你的指令')
    expect(parasiteSummary(pc)).not.toContain('會餓')
  })

  it('hook the yielding answers of the dungeon events', () => {
    const give = (id: string) => travelEvents.templates.find((t) => t.id === id)!.options!.find((o) => o.adult_scene === 'always')!
    expect(give('dg_cursed_lingerie').success!.effects).toContainEqual({ type: 'parasite', parasite: LIN, op: 'add' })
    expect(give('dg_succubus_box').success!.effects).toContainEqual({ type: 'parasite', parasite: MARK, op: 'add' })
    expect(give('dg_seed_plant').success!.effects).toContainEqual({ type: 'parasite', parasite: SEED, op: 'add' })
    // 抵抗成功不會寄生
    for (const id of ['dg_cursed_lingerie', 'dg_succubus_box', 'dg_seed_plant']) {
      const t = travelEvents.templates.find((x) => x.id === id)!
      for (const o of t.options!.filter((x) => x.check)) expect(JSON.stringify(o.success ?? {}), id).not.toContain('"parasite"')
    }
  })

  it('open the mark line at either partner, but only one of them', () => {
    const state = game()
    attachParasite(pcOf(state), MARK, state.time)
    const help = stories.find((s) => s.id === 'par_mark_help')!
    const cas = stories.find((s) => s.id === 'par_mark_help_cas')!
    expect(condMet(state, help.start.requires)).toBe(true)
    expect(condMet(state, cas.start.requires)).toBe(true)
    setFlag(state, 'par_mark_help_cas_start')
    expect(condMet(state, help.start.requires)).toBe(false)
  })

  it('scale flare-up DCs with the hero level and the stage', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, LIN, state.time)
    const t = { scope: 'parasite' as const, parasite: LIN }
    expect(eventBaseDc(state, t)).toBe(12 + Math.round(pc.level * 0.4))
    pc.level = 10
    parasiteOf(pc, LIN)!.corruption = 95
    expect(eventBaseDc(state, t)).toBe(12 + 4 + 2)
  })
})

describe('parasite flare time of day', () => {
  it('uses the sleep time on a rest and ignores hours on the road', () => {
    const state = game()
    const pc = pcOf(state)
    attachParasite(pc, LIN, state.time)
    const base = parasiteTemplates().find((t) => t.parasite === LIN)!
    const night = { ...base, id: 'zz_night_flare', tags: [], pc_body: undefined, stages: undefined, requires: undefined, moments: ['rest', 'travel'] as never, hours: 'night' as const }
    travelEvents.templates.push(night)
    try {
      const p = parasiteOf(pc, LIN)!
      const ids = (trigger: 'rest' | 'travel', at = state.time) => parasiteCandidates(state, p, trigger, at).map((t) => t.id)
      state.time = { ...state.time, hour: 8, minute: 0 }
      expect(ids('rest')).not.toContain(night.id)
      expect(ids('rest', { ...state.time, hour: 23 })).toContain(night.id)
      expect(ids('travel')).toContain(night.id)
    } finally {
      travelEvents.templates.splice(travelEvents.templates.indexOf(night), 1)
    }
  })
})

describe('階段的顯示', () => {
  it('苗床標成第幾階段（沒有「發作」），其他寄生物用階段名稱', async () => {
    const { stageLabel, stageName } = await import('@/engine/parasites')
    expect(stageLabel({ id: 'brood_wasp_egg', corruption: 30 })).toBe('第 2 階段')
    expect(stageLabel({ id: 'brood_goblin', corruption: 0 })).toBe('第 1 階段')
    expect(stageLabel({ id: 'parasite_seed', corruption: 30 })).toBe(stageName(30))
  })
})

