import { describe, expect, it } from 'vitest'
import { finishCombat, startCombat } from '@/engine/combat'
import { craftRules, dungeonEncounters, enemies, geography, itemDef, itemRules, lewdRules, specialMaps, stories } from '@/engine/data'
import { forgeItemFor, gearCost, gearSellCap, gearStats, gearName, gearRules, MATERIAL_KINDS, MAX_TIER, ordinaryBases, randomBases, randomGear, sanitizeGearSpec } from '@/engine/gear'
import { craftTarget, parseCraftTarget } from '@/engine/craft'
import { GEAR_SHOP } from '@/engine/mods'
import { Rng } from '@/engine/rng'
import { crossLink, currentArea, currentCell, enterLocation, findKind, generateLayer, layerKey, moveTo, placeAt, standOn, storeArea } from '@/engine/grid'
import { mimicFor, PARK_LINK } from '@/engine/park'
import { startJourney } from '@/engine/road'
import { connectionOpen, enterSpecial } from '@/engine/specialMaps'
import { addItem, newGame, withRng } from '@/engine/state'
import { sellPrice, shopKey } from '@/engine/trade'
import { condMet, hasFlag, locationOpen, openFor, setFlag } from '@/engine/storyFlags'
import { guildQuests } from '@/engine/town'
import { reachable, shortestPath } from '@/engine/world'
import type { GameState } from '@/engine/types'

// 高等級的地下城（docs/DUNGEON_DESIGN.md 第 8 節、docs/LUST_PARK.md 第 8 節）：
// 歷史裂縫、歷史迴廊（劇情條件成立才出現的地點）；禁果庭園、歡愉秘宮（緋夢樂園底下，入口廣場的鐵柵）。
const PLAZA = 'sm_lust_park'
const STAMPS = ['park_beast', 'park_insect', 'park_aquarium', 'park_garden', 'park_theater'].map((p) => `park_stamp_${p}`)
const story = (id: string) => stories.find((s) => s.id === id)!

function game(birthplace = 'rivervale'): GameState {
  const state = newGame({ name: '莉雅', race: 'human', classId: 'fighter', seed: 5, birthplace })
  enterLocation(state)
  return state
}

const levels = (id: string, layer: 'outskirts' | 'shallow' | 'middle' | 'deep') => dungeonEncounters[id]![layer].flat().map(([m]) => enemies[m]!.level)
const bossLevel = (id: string, layer: 'shallow' | 'middle' | 'deep') => enemies[dungeonEncounters[id]!.bosses![layer]![0]![0]]!.level

describe('高等級的地下城：資料', () => {
  it('填上 13～16、17～20 級：每一層的怪物與層主照等級帶往下加深', () => {
    for (const [id, base] of [['history_rift', 13], ['history_corridor', 17], ['forbidden_garden', 13], ['pleasure_palace', 17]] as const) {
      const park = !!geography.locations.find((l) => l.id === id)!.park
      if (!park) expect(levels(id, 'outskirts'), id).toEqual(expect.arrayContaining([base]))
      expect(Math.min(...levels(id, 'shallow')), id).toBe(base)
      expect(Math.max(...levels(id, 'deep')), id).toBe(base + 3)
      expect([bossLevel(id, 'shallow'), bossLevel(id, 'middle'), bossLevel(id, 'deep')], id).toEqual([base + 1, base + 2, base + 3])
    }
    // 歷史的兩座：最終層主會重新聚形，原因是阿契隆；緋夢樂園底下的兩座是莉薇婭的遺跡
    for (const id of ['history_rift', 'history_corridor']) expect(enemies[dungeonEncounters[id]!.bosses!.deep![0]![0]]!.desc, id).toContain('阿契隆')
    expect(enemies.fg_boss_forbidden_tree!.desc).toContain('莉薇婭')
    expect(enemies.pp_boss_succubus_mother!.desc).toContain('所有魅魔的源頭')
  })

  it('歷史裂縫在政治史詩開始時出現，歷史迴廊在政治史詩完成時出現', () => {
    const at = (id: string) => geography.locations.find((l) => l.id === id)!
    expect(at('history_rift').requires).toEqual({ flags: ['pol_start'] })
    expect(at('history_corridor').requires).toEqual({ flags: ['pol_done'] })
    expect(story('pol_storm_eve').start_flags).toContain('pol_start')
    expect(story('pol_acheron_gaze').nodes.find((n) => n.id === 'eye')!.options!.every((o) => o.success?.set_flags?.includes('pol_done'))).toBe(true)
  })
})

describe('劇情條件成立才出現的地點', () => {
  it('旅行的目的地、路徑與出發都看條件；成立之後才列出', () => {
    const state = game()
    const ids = () => reachable(state.location, openFor(state)).map((r) => r.id)
    expect(locationOpen(state, 'history_rift')).toBe(false)
    expect(ids()).not.toContain('history_rift')
    expect(ids()).not.toContain('history_corridor')
    expect(shortestPath('rivervale', 'history_rift', openFor(state))).toBeNull()
    // 沒有篩選時（舊的呼叫）照樣算得出路
    expect(shortestPath('rivervale', 'history_rift')?.days).toEqual([1, 1])
    expect(() => startJourney(state, 'history_rift')).toThrow()
    setFlag(state, 'pol_start')
    expect(ids()).toContain('history_rift')
    expect(ids()).not.toContain('history_corridor')
    setFlag(state, 'pol_done')
    expect(ids()).toContain('history_corridor')
  })

  it('公會不會發還沒出現的地下城的委託', () => {
    const state = game()
    state.party[0]!.level = 15
    const targets = (s: GameState) => guildQuests(s).filter((q) => q.area === 'dungeon').map((q) => q.target)
    expect(targets(state)).not.toContain('history_rift')
    const later = game()
    later.party[0]!.level = 15
    setFlag(later, 'pol_start')
    // 委託板每天擲一次：多看幾天，總會有歷史裂縫的委託
    let seen = false
    for (let d = 0; d < 20 && !seen; d++) {
      later.time.day += 1
      seen = targets(later).includes('history_rift')
    }
    expect(seen).toBe(true)
  })
})

describe('緋夢樂園底下的遺跡', () => {
  const gate = (park: string) => specialMaps[PLAZA]!.connections!.find((c) => c.to.area === `${PARK_LINK}${park}`)!

  it('集滿五個章打開禁果庭園的鐵柵；緋夢之下完成才打開歡愉秘宮', () => {
    const state = game('bloodplume')
    expect(connectionOpen(state, gate('forbidden_garden'))).toBe(false)
    for (const f of STAMPS.slice(0, 4)) setFlag(state, f)
    expect(connectionOpen(state, gate('forbidden_garden'))).toBe(false)
    setFlag(state, STAMPS[4]!)
    expect(connectionOpen(state, gate('forbidden_garden'))).toBe(true)
    expect(connectionOpen(state, gate('pleasure_palace'))).toBe(false)
    setFlag(state, 'lpe_done')
    expect(connectionOpen(state, gate('pleasure_palace'))).toBe(true)
    // 打開之後，廣場上那一格變成通道，走上去進到遺跡的淺層
    enterSpecial(state, PLAZA)
    const c = gate('forbidden_garden')
    expect(currentArea(state).cells[c.at.y * currentArea(state).width + c.at.x]!.kind).toBe('link')
    placeAt(state, currentArea(state), c.at.x, c.at.y)
    crossLink(state)
    expect(state.location).toBe('forbidden_garden')
    expect(currentArea(state).key).toBe(layerKey('forbidden_garden', 1))
  })

  it('關著的時候廣場上是普通的地板', () => {
    const state = game('bloodplume')
    enterSpecial(state, PLAZA)
    const c = gate('pleasure_palace')
    expect(currentArea(state).cells[c.at.y * currentArea(state).width + c.at.x]!.kind).toBe('floor')
  })

  it('有自己的擬態寶箱、自己的戰敗；打倒最終層主不蓋集章卡', () => {
    expect(lewdRules.park.defeats.forbidden_garden).toBeDefined()
    expect(lewdRules.park.defeats.pleasure_palace).toBeDefined()
    const state = game('bloodplume')
    for (const f of STAMPS) setFlag(state, f)
    enterSpecial(state, PLAZA)
    const c = gate('forbidden_garden')
    placeAt(state, currentArea(state), c.at.x, c.at.y)
    crossLink(state)
    const loc = geography.locations.find((l) => l.id === 'forbidden_garden')!
    const area = withRng(state, (rng) => generateLayer(state, loc, 3, rng))
    expect(mimicFor(area)).toBe('fg_mimic')
    storeArea(state, area)
    const b = findKind(area, 'boss')!
    state.position = { area: area.key, x: b.x, y: b.y }
    startCombat(state, area.cells[b.y * area.width + b.x]!.group!, { cell: { area: area.key, x: b.x, y: b.y } })
    for (const x of state.combat!.combatants) if (x.side === 'enemy') x.hp = 0
    state.combat!.status = 'victory'
    const report = finishCombat(state)
    expect(report.outcome.tags ?? []).not.toContain('集章')
    expect(hasFlag(state, 'park_stamp_forbidden_garden')).toBe(false)
    expect(currentCell(state)).toBeTruthy()
  })

  it('舊存檔沒有前綴的集章旗標照樣算數', () => {
    const state = game('bloodplume')
    for (const f of STAMPS) state.flags[f] = true
    expect(condMet(state, { flags: STAMPS })).toBe(true)
    expect(connectionOpen(state, gate('forbidden_garden'))).toBe(true)
  })
})

describe('緋夢之下與眾歡獨樂', () => {
  it('緋夢之下：五個章開頭，Lv.13、14、16，一路在禁果庭園，結局打開歡愉秘宮', () => {
    const ids = ['lpe_missing_guests', 'lpe_toy_box', 'lpe_forbidden_tree']
    expect(ids.map((id) => story(id).start.min_level)).toEqual([13, 14, 16])
    expect([...story(ids[0]!).start.requires!.flags!].sort()).toEqual([...STAMPS].sort())
    expect(story(ids[1]!).start.requires?.flags).toEqual(['lpe_1_done'])
    expect(story(ids[2]!).start.requires?.flags).toEqual(['lpe_2_done'])
    for (const id of ids) expect(story(id).tags, id).toContain('adult')
    const last = story(ids[2]!)
    expect(last.nodes.find((n) => n.id === 'door')!.options!.every((o) => o.success?.set_flags?.includes('lpe_done'))).toBe(true)
    const tree = last.nodes.find((n) => n.id === 'tree')!
    expect(tree.enemies?.[0]?.[0]).toBe('fg_boss_forbidden_tree')
    expect(tree.fail?.retry).toBe(true)
    expect(stories.flatMap((s) => s.nodes).filter((n) => n.at.where === 'dungeon' && n.at.location === 'forbidden_garden').length).toBeGreaterThanOrEqual(5)
  })

  it('眾歡獨樂：緋夢之下之後，Lv.18、20；莉薇婭的投影是頭目加一隻手下，輸了可以重試，祂不說話也不認得人', () => {
    expect(['livia_origin', 'livia_revel'].map((id) => story(id).start.min_level)).toEqual([18, 20])
    expect(story('livia_origin').start.requires?.flags).toEqual(['lpe_done'])
    expect(story('livia_revel').start.requires?.flags).toEqual(['livia_1_done'])
    const fight = story('livia_revel').nodes.find((n) => n.id === 'dragon')!
    expect(fight.at).toMatchObject({ where: 'dungeon', location: 'pleasure_palace', layer: 'deep' })
    expect(fight.enemies?.map(([e, n]) => [e, n])).toEqual([['livia_projection', 1], ['pp_first_succubus', 1]])
    expect(fight.fail?.retry).toBe(true)
    expect(enemies.livia_projection!.ability_hp_below).toBeTruthy()
    expect(enemies.livia_projection!.desc).toContain('不知道你在這裡')
    expect(story('livia_revel').nodes.find((n) => n.id === 'end')!.options!.every((o) => o.success?.set_flags?.includes('livia_done'))).toBe(true)
    // 刻文：觀者最在乎凡人，歡愉其次，歷史第三
    const text = story('livia_origin').nodes.find((n) => n.id === 'inscription')!.success!.text!
    expect(text.indexOf('觀者')).toBeLessThan(text.indexOf('歡愉'))
    expect(text.indexOf('歡愉')).toBeLessThan(text.indexOf('歷史'))
  })
})

describe('高等地下城的材料與底材', () => {
  const tierOf = (item: string) => {
    const m = itemDef(item)?.forge?.materials[0]
    return m ? { tier: gearRules.materials[m]!.tier, kind: gearRules.materials[m]!.kind } : undefined
  }
  const bossesOf = (d: string) => Object.values(dungeonEncounters[d]!.bosses!).map((g) => g![0]![0])

  it('第 6 級只從 Lv.13～16 的層主掉、第 7 級只從 Lv.17～20；歷史、歡愉各一套，每一座涵蓋自己那一套的五種類型', () => {
    const series = { history_rift: '時隙鋼', history_corridor: '編年鋼', forbidden_garden: '異鄉合金', pleasure_palace: '鱗光金' } as Record<string, string>
    const metal = (d: string) => bossesOf(d).flatMap((b) => enemies[b]!.loot ?? []).map((l) => itemDef(l.item)?.forge?.materials[0]).filter((m) => m && gearRules.materials[m]!.kind === 'metal' && gearRules.materials[m]!.tier >= 6)
    for (const [d, name] of Object.entries(series)) expect(new Set(metal(d).map((m) => gearRules.materials[m!]!.name)), d).toEqual(new Set([name]))
    expect(Object.values(gearRules.materials).filter((m) => m.tier >= 6).length).toBe(20)
    for (const [d, tier] of [['history_rift', 6], ['forbidden_garden', 6], ['history_corridor', 7], ['pleasure_palace', 7]] as const) {
      const drops = bossesOf(d).flatMap((b) => (enemies[b]!.loot ?? []).map((l) => ({ ...l, t: tierOf(l.item) }))).filter((l) => l.t && l.t.tier >= 6)
      expect(drops.every((l) => l.t!.tier === tier), d).toBe(true)
      expect(drops.every((l) => l.chance >= 0.8), d).toBe(true)
      expect(new Set(drops.map((l) => l.t!.kind)), d).toEqual(new Set(MATERIAL_KINDS))
    }
    // 其他怪物都不掉第 6、7 級
    const high = new Set(['history_rift', 'forbidden_garden', 'history_corridor', 'pleasure_palace'].flatMap(bossesOf))
    const others = Object.values(enemies).filter((e) => !high.has(e.id) && (e.loot ?? []).some((l) => (tierOf(l.item)?.tier ?? 0) >= 6))
    expect(others.map((e) => e.id)).toEqual([])
    // 每一種第 6、7 級的材料都有打造材料
    for (const [id, m] of Object.entries(gearRules.materials).filter(([, x]) => x.tier >= 6)) expect(forgeItemFor(m.kind, m.tier), id).toBeTruthy()
  })

  it('打造延伸到第 7 級：工錢、DC、工藝等級與工具都有第 7 級', () => {
    expect(MAX_TIER).toBe(7)
    expect(gearRules.craft.fee.length).toBe(MAX_TIER)
    expect(gearRules.craft.dc.length).toBe(MAX_TIER)
    expect(craftRules.max_level).toBe(MAX_TIER)
    expect(craftRules.tool_tier.length).toBe(MAX_TIER)
    expect(craftRules.xp_to_next.length).toBe(MAX_TIER - 1)
    expect(craftRules.shop_levels.capital![1]).toBe(MAX_TIER)
  })

  it('地下城專屬的底材只靠層主掉落：不在隨機裝備、AI 的清單與制式品裡，也不能打造', () => {
    const exclusive = Object.entries(gearRules.bases).filter(([, b]) => b.exclusive).map(([id]) => id)
    expect(exclusive.length).toBe(10)
    const random = new Set(randomBases())
    const ordinary = new Set(ordinaryBases())
    for (const id of exclusive) {
      expect(random.has(id), id).toBe(false)
      expect(ordinary.has(id), id).toBe(false)
      const items = itemRules.items.filter((i) => i.gear?.base === id)
      expect(items.length, id).toBe(1)
      const item = items[0]!
      expect(item.tags ?? [], id).not.toContain(GEAR_SHOP[gearRules.bases[id]!.kind]!)
      const droppers = Object.values(enemies).filter((e) => (e.loot ?? []).some((l) => l.item === item.name))
      expect(droppers.length, id).toBe(1)
      expect(gearRules.materials[item.gear!.material]!.tier, id).toBeGreaterThanOrEqual(6)
      expect(sanitizeGearSpec({ base: id, material: item.gear!.material }, { maxLevel: 20 }), id).toBeUndefined()
    }
    for (const id of exclusive) {
      const mat = Object.entries(gearRules.materials).find(([, m]) => m.kind === gearRules.bases[id]!.kind && m.tier === 6)![0]
      expect(() => parseCraftTarget(craftTarget(id, mat)), id).toThrow('不能打造')
    }
  })

  it('一般的新底材有七個等級（第 6、7 級兩套）的制式品，第四級以下在商店賣', () => {
    for (const id of ['greatsword', 'halberd', 'spear', 'crossbow', 'whip', 'tower_shield', 'parrying_dagger', 'grimoire', 'scale_mail']) {
      const b = gearRules.bases[id]!
      const mats = Object.entries(gearRules.materials).filter(([, m]) => m.kind === b.kind)
      expect(mats.length, id).toBe(9)
      for (const [mid, m] of mats) {
        const it = itemDef(gearName({ base: id, material: mid }))
        expect(it?.gear, `${id} ${mid}`).toEqual({ base: id, material: mid })
        expect((it!.tags ?? []).length > 0, `${id} ${mid}`).toBe(m.tier <= 4)
      }
    }
  })

  it('隨機裝備的第 5 級以上大多降回第 4 級，不會超過角色等級的建議材料', () => {
    const rng = new Rng(3)
    const tiers = Array.from({ length: 400 }, () => gearRules.materials[randomGear(rng, 20, ['longsword']).material]!.tier)
    expect(Math.max(...tiers)).toBeLessThanOrEqual(7)
    expect(tiers.filter((t) => t >= 5).length / tiers.length).toBeLessThan(0.3)
    const low = Array.from({ length: 200 }, () => gearRules.materials[randomGear(rng, 15, ['longsword']).material]!.tier)
    expect(Math.max(...low)).toBeLessThanOrEqual(5)
    // 第 6 級的建議等級 16：Lv.13～16 的地下城最深一層開得到
    const mid = Array.from({ length: 600 }, () => gearRules.materials[randomGear(rng, 16, ['longsword']).material]!.tier)
    expect(Math.max(...mid)).toBe(6)
  })
})

describe('緋夢樂園底下的寶箱開歡愉系列', () => {
  const seriesOf = (name: string) => {
    const g = itemDef(name)?.gear ?? undefined
    return g ? gearRules.materials[g.material] : undefined
  }

  it('材料標上系列，兩座遺跡指定歡愉系列；第 6 級的建議等級是 16', () => {
    const high = Object.values(gearRules.materials).filter((m) => m.tier >= 6)
    expect(high.filter((m) => m.series === 'history').length).toBe(10)
    expect(high.filter((m) => m.series === 'pleasure').length).toBe(10)
    expect(high.filter((m) => m.tier === 6).every((m) => m.level === 16)).toBe(true)
    const at = (id: string) => geography.locations.find((l) => l.id === id)!
    expect(at('forbidden_garden').material_series).toBe('pleasure')
    expect(at('pleasure_palace').material_series).toBe('pleasure')
    expect(at('history_corridor').material_series).toBeUndefined()
  })

  it('隨機裝備：指定歡愉系列時第 6、7 級用歡愉系列，沒指定時用歷史系列；打造材料也一樣', () => {
    const rng = new Rng(9)
    const pick = (series?: string) => Array.from({ length: 600 }, () => gearRules.materials[randomGear(rng, 20, ['longsword', 'leather_armor', 'robe', 'longbow', 'ring_guard'], series).material]!)
    const pleasure = pick('pleasure').filter((m) => m.tier >= 6)
    const plain = pick().filter((m) => m.tier >= 6)
    expect(pleasure.length).toBeGreaterThan(0)
    expect(pleasure.every((m) => m.series === 'pleasure')).toBe(true)
    expect(plain.every((m) => m.series === 'history')).toBe(true)
    // 第 5 級以下不受影響
    expect(pick('pleasure').filter((m) => m.tier <= 5).every((m) => !m.series)).toBe(true)
    expect(forgeItemFor('metal', 7, 'pleasure')).toBe('鱗光金塊')
    expect(forgeItemFor('metal', 7)).toBe('編年鋼塊')
    expect(forgeItemFor('metal', 5, 'pleasure')).toBe('星隕鐵塊')
  })

  it('在歡愉秘宮打開寶箱：開出來的第 6、7 級裝備是歡愉系列', () => {
    const state = game('bloodplume')
    for (const f of STAMPS) setFlag(state, f)
    setFlag(state, 'lpe_done')
    enterSpecial(state, PLAZA)
    const c = specialMaps[PLAZA]!.connections!.find((x) => x.to.area === `${PARK_LINK}pleasure_palace`)!
    placeAt(state, currentArea(state), c.at.x, c.at.y)
    crossLink(state)
    expect(state.location).toBe('pleasure_palace')
    const found: string[] = []
    for (let n = 0; n < 80 && found.length < 3; n++) {
      // 寶箱觸發的地下城事件不管它（這裡只看寶箱的內容）
      delete state.dungeonEvent
      delete state.parasiteEvent
      delete state.pendingDefeat
      if (state.combat) delete state.combat
      const area = currentArea(state)
      const here = currentCell(state)
      const at = area.cells.findIndex((cell, i) => i !== state.position!.y * area.width + state.position!.x && cell.kind !== 'wall'
        && Math.abs((i % area.width) - state.position!.x) + Math.abs(Math.floor(i / area.width) - state.position!.y) === 1)
      area.cells[at] = { kind: 'chest', level: 20 }
      storeArea(state, area)
      const step = moveTo(state, at % area.width, Math.floor(at / area.width))
      const names = (step.report?.changes.items_gained ?? []).map((i) => i.name)
      for (const name of names) {
        const m = seriesOf(name)
        if (m && m.tier >= 6) found.push(name)
      }
      void here
    }
    expect(found.length).toBeGreaterThan(0)
    for (const name of found) expect(seriesOf(name)!.series, name).toBe('pleasure')
  })
})

describe('高等地下城實測的修正（2026-11-01）', () => {
  it('禁果庭園、歡愉秘宮的怪（fg_、pp_）和緋夢樂園一樣不會擲到年幼', () => {
    const ids = ['fg_fruit_eater', 'fg_boss_forbidden_tree', 'fg_drowned_knight', 'pp_endless_guest', 'pp_ascetic', 'pp_lonely_fancy']
    for (let seed = 1; seed <= 150; seed++) {
      const state = newGame({ name: '莉雅', race: 'human', classId: 'fighter', seed, birthplace: 'bloodplume' })
      const combat = startCombat(state, ids.map((id) => [id, 1]) as never)
      for (const c of combat.combatants.filter((x) => x.side === 'enemy')) expect(c.traits ?? [], c.defId).not.toContain('young')
    }
  })

  it('底材的抗性（res）和附魔一樣最多 -0.5：第 6、7 級寶石不會讓單件到 ×0.25、×0.1', () => {
    expect(gearStats({ base: 'pendant_fire', material: 'dragon_eye' }).resist.fire).toBe(-0.5)
    expect(gearStats({ base: 'pendant_fire', material: 'chrono_crystal' }).resist.fire).toBe(-0.5)
    expect(gearStats({ base: 'pendant_fire', material: 'mithril_jewel' }).resist.fire).toBe(-0.45)
    expect(gearStats(itemDef('初啼耳墜')!.gear!).resist.lust).toBe(-0.5)
  })

  it('裝備最多賣到成本的 10 倍：成本＝工錢＋打造材料', () => {
    expect(gearCost({ base: 'longsword', material: 'riftsteel' })).toBe(gearRules.bases.longsword!.price * 6 + 2 * itemDef('時隙鋼塊')!.price_cc!)
    expect(gearCost({ base: 'longsword', material: 'iron' })).toBe(gearRules.bases.longsword!.price)
    const state = game('soriel')
    standOn(state, 'smithy')
    const key = shopKey(state, 'smithy')
    addItem(state.inventory, '回響鱗鎧', 1)
    const cap = gearSellCap(itemDef('回響鱗鎧')!.gear!)!
    expect(cap).toBe(10 * gearCost(itemDef('回響鱗鎧')!.gear!)!)
    expect(sellPrice(state, key, '回響鱗鎧')).toBe(cap)
    expect(sellPrice(state, key, '回響鱗鎧')!).toBeLessThan(itemDef('回響鱗鎧')!.price_cc! / 5)
    // 便宜的裝備不受影響：照原本的收購價
    addItem(state.inventory, '鐵長劍', 1)
    expect(sellPrice(state, key, '鐵長劍')!).toBeLessThan(gearSellCap({ base: 'longsword', material: 'iron' })!)
  })
})
