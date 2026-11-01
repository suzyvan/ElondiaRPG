import { describe, expect, it } from 'vitest'
import {
  act, applyTraits, chooseAction, combatant, rollTraits, startCombat, unusableReason, wantsToFlee, type Combatant,
} from '@/engine/combat'
import { abilities, dungeonEncounters, enemies, geography, itemDef, monsterTraits, wildEncounters } from '@/engine/data'
import { afterCombat, cellAt, currentArea, descend } from '@/engine/grid'
import { Rng } from '@/engine/rng'
import { newGame } from '@/engine/state'
import { arriveAt } from './helpers/travel'
import type { GameState, Report } from '@/engine/types'

function fightWith(group: [string, number][]): GameState {
  const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 1 })
  startCombat(state, group)
  return state
}

const foe = (state: GameState, defId: string): Combatant => state.combat!.combatants.find((c) => c.defId === defId)!

describe('monster data', () => {
  it('gives every region outskirt monsters, dungeon pools and a boss on each layer', () => {
    const dungeons = geography.locations.filter((l) => l.type === 'dungeon')
    expect(Object.keys(enemies).length).toBeGreaterThanOrEqual(80)
    for (const d of dungeons) {
      const t = dungeonEncounters[d.id]
      expect(t, d.id).toBeTruthy()
      for (const layer of ['shallow', 'middle', 'deep'] as const) expect(t!.bosses?.[layer]?.length, `${d.id} ${layer}`).toBeGreaterThan(0)
    }
    for (const region of geography.regions) expect(wildEncounters(region.id).length, region.id).toBeGreaterThanOrEqual(4)
  })

  it('gives every dungeon its own two monsters per layer and its own three layer bosses', () => {
    const seen = new Set<string>()
    for (const d of geography.locations.filter((l) => l.type === 'dungeon')) {
      const t = dungeonEncounters[d.id]!
      const own: string[] = []
      for (const layer of ['outskirts', 'shallow', 'middle', 'deep'] as const) {
        const ids = new Set(t[layer].flat().map(([id]) => id))
        // 每層的遭遇只用到這一層與上一層的怪物；這一層自己的兩種一定都會出現
        own.push(...[...ids].filter((id) => !own.includes(id)))
      }
      const bosses = (['shallow', 'middle', 'deep'] as const).map((l) => t.bosses![l]![0]![0])
      expect(new Set(bosses).size, d.id).toBe(3)
      const all = [...own, ...bosses]
      // 主題地下城的園區沒有周邊：淺層、中層、深層各兩種，加三隻層主
      expect(all.length, d.id).toBe(d.park ? 9 : 11)
      for (const id of all) {
        expect(seen.has(id), `${id} 出現在兩座地下城`).toBe(false)
        seen.add(id)
      }
    }
  })

  it('catalogues every loot item and uses only monster abilities', () => {
    for (const e of Object.values(enemies)) {
      for (const l of e.loot ?? []) expect(itemDef(l.item), `${e.id} → ${l.item}`).toBeTruthy()
      for (const a of e.abilities ?? []) expect(abilities[a]?.classes, `${e.id} → ${a}`).toContain('monster')
      expect(e.traits?.every((t) => monsterTraits.traits[t]) ?? true, e.id).toBe(true)
    }
  })
})

describe('monster traits', () => {
  it('only lets monsters flagged with rut roll the rut trait', () => {
    const rng = new Rng(3)
    let ruts = 0
    for (let i = 0; i < 300; i++) {
      expect(rollTraits(rng, enemies.skeleton!, 1)).not.toContain('rut')
      if (rollTraits(rng, enemies.wolf!, 1).includes('rut')) ruts++
    }
    expect(enemies.wolf!.rut).toBe(true)
    expect(ruts).toBeGreaterThan(0)
  })

  it('never rolls mutually exclusive traits together', () => {
    const rng = new Rng(9)
    for (let i = 0; i < 300; i++) {
      const t = rollTraits(rng, enemies.wolf!, 1)
      for (const id of t) for (const x of monsterTraits.traits[id]!.excludes ?? []) expect(t, `${id} + ${x}`).not.toContain(x)
      expect(t.length).toBeLessThanOrEqual(monsterTraits.roll.max)
    }
  })

  it('changes stats, behaviour and name', () => {
    const state = fightWith([['wolf', 1]])
    const wolf = foe(state, 'wolf')
    wolf.traits = undefined
    wolf.name = '灰狼'
    wolf.maxHp = 20
    wolf.hp = 20
    applyTraits(wolf, ['huge', 'wounded'])
    expect(wolf.maxHp).toBe(30)
    expect(wolf.hp).toBe(18)
    expect(wolf.baseMods.damage).toBe(2)
    expect(wolf.ai?.flee_below).toBe(0.3)
    expect(wolf.name).toBe('巨大・受傷的灰狼')
    wolf.hp = 5
    expect(wantsToFlee(wolf)).toBe(true)
    applyTraits(wolf, ['enraged'])
    expect(wantsToFlee(wolf)).toBe(false)
  })
})

describe('enemy AI', () => {
  it('heals the most hurt ally instead of healing someone at full health', () => {
    const state = fightWith([['crypt_necromancer', 1], ['skeleton', 2]])
    const combat = state.combat!
    const necro = foe(state, 'crypt_necromancer')
    const pc = combatant(combat, 'pc')
    const skeletons = combat.combatants.filter((c) => c.defId === 'skeleton')
    const rng = new Rng(1)
    for (let i = 0; i < 30; i++) {
      const plan = chooseAction(combat, rng, necro, pc, false)
      expect(plan?.ability.id).not.toBe('dark_mend')
    }
    skeletons[1]!.hp = 1
    let heals = 0
    for (let i = 0; i < 60; i++) {
      const plan = chooseAction(combat, rng, necro, pc, false)
      if (plan?.ability.id === 'dark_mend') {
        heals++
        expect(plan.target).toBe(skeletons[1]!.id)
      }
    }
    expect(heals).toBeGreaterThan(30)
  })

  it('does not re-apply a buff it already has', () => {
    const state = fightWith([['reef_crab', 1]])
    const crab = foe(state, 'reef_crab')
    crab.statuses.push({ id: 'stoneskin', turns: 2, source: crab.id })
    const rng = new Rng(2)
    for (let i = 0; i < 30; i++) expect(chooseAction(state.combat!, rng, crab, combatant(state.combat!, 'pc'), false)?.ability.id).not.toBe('harden')
  })

  it('keeps an HP-gated skill locked until the monster is hurt enough', () => {
    const def = enemies.crypt_general!
    def.ability_hp_below = { wraith_wail: 50 }
    try {
      const state = fightWith([['crypt_general', 1]])
      const general = foe(state, 'crypt_general')
      general.hp = general.maxHp
      general.ap = general.apMax
      expect(general.hpGates).toEqual({ wraith_wail: 50 })
      expect(unusableReason(state.combat!, general, 'wraith_wail')).toBe('生命降到 50% 以下才能用')
      const rng = new Rng(3)
      for (let i = 0; i < 30; i++) expect(chooseAction(state.combat!, rng, general, combatant(state.combat!, 'pc'), false)?.ability.id).not.toBe('wraith_wail')
      general.hp = Math.floor(general.maxHp / 2)
      expect(unusableReason(state.combat!, general, 'wraith_wail')).toBeNull()
    } finally {
      delete def.ability_hp_below
    }
  })
})

describe('every encounter', () => {
  it('fights to the end without errors or stalls', () => {
    const groups: [string, number][][] = []
    for (const t of Object.values(dungeonEncounters)) {
      groups.push(...t.outskirts, ...t.shallow, ...t.middle, ...t.deep, ...(t.abyss ?? []), ...Object.values(t.bosses ?? {}))
    }
    for (const region of geography.regions) groups.push(...wildEncounters(region.id))
    for (const [n, group] of groups.entries()) {
      const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: n + 1 })
      const pc = state.party[0]!
      pc.level = 10
      pc.maxHp = pc.hp = 200
      startCombat(state, group)
      const combat = state.combat!
      for (let i = 0; i < 400 && combat.status === 'ongoing'; i++) {
        const target = combat.combatants.find((c) => c.side === 'enemy' && c.hp > 0 && !c.fled)
        const me = combatant(combat, 'pc')
        if (target && me.ap >= 2) act(state, { type: 'attack', target: target.id })
        else act(state, { type: 'end_turn' })
      }
      expect(combat.status, JSON.stringify(group)).not.toBe('ongoing')
    }
  })
})

describe('layer bosses', () => {
  it('turn into the stairs down once defeated', () => {
    const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 5 })
    arriveAt(state, 'snake_creek')
    // 從周邊走到往下的階梯，進入淺層
    const outskirts = currentArea(state)
    const j = outskirts.cells.findIndex((c) => c.kind === 'stairs_down')
    state.position = { area: outskirts.key, x: j % outskirts.width, y: Math.floor(j / outskirts.width) }
    descend(state)
    const area = currentArea(state)
    const i = area.cells.findIndex((c) => c.kind === 'boss')
    expect(area.cells[i]!.then).toBe('stairs_down')
    expect(area.cells.some((c) => c.kind === 'stairs_down')).toBe(false)
    const x = i % area.width
    const y = Math.floor(i / area.width)
    state.position = { area: area.key, x, y }
    const report = { outcome: { result: 'victory' }, changes: { flags: { [`cleared:${area.key}:${x},${y}`]: true } } } as unknown as Report
    afterCombat(state, report)
    expect(cellAt(area, x, y)!.kind).toBe('stairs_down')
  })
})
