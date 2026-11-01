import { afterEach, describe, expect, it } from 'vitest'
import { specialMaps, stories, type SpecialMapDef, type StoryDef } from '@/engine/data'
import { afterDefeat, cellAt, crossLink, currentArea, currentCell, enterLocation, getArea, move, placeAt, position } from '@/engine/grid'
import { applyPendingMove, queueMove } from '@/engine/road'
import { enterSpecial, leaveSpecial, pruneSpecialMaps } from '@/engine/specialMaps'
import { sanitizeSpecialMapMod, specialMapUsage, storySpotProblem } from '@/engine/specialMapMods'
import { sanitizeStory, storyCheck } from '@/engine/storyMods'
import { applyContent, emptyMods, sanitizeNpc } from '@/engine/mods'
import { shopUsage } from '@/engine/shopMods'
import { shopTypeForCell } from '@/engine/trade'
import { npcRecord } from '@/engine/npcs'
import { areaOf, npcCell } from '@/engine/population'
import { commitReport, newGame, newReportId } from '@/engine/state'
import { nodesHere, refreshStoryMarkers, startStory } from '@/engine/story'
import { setFlag } from '@/engine/storyFlags'
import type { GameState, Report } from '@/engine/types'

const SEWER = 'sm/sm_rhineburg_sewer'
const CISTERN = 'sm/sm_rhineburg_cistern'

function inRhineburg(): GameState {
  return newGame({ name: '測試者', race: 'human', classId: 'fighter', seed: 3, birthplace: 'rhineburg' })
}

/** 站在 (x, y) 旁邊，往那一格走一步；是通道就走過去（按 E） */
function stepOnto(state: GameState, area: string, x: number, y: number, from: [number, number]) {
  placeAt(state, getArea(state, area), from[0], from[1])
  const r = move(state, x - from[0], y - from[1])
  return currentCell(state).kind === 'link' ? crossLink(state) : r
}

const extra: string[] = []
afterEach(() => {
  for (const id of extra.splice(0)) delete specialMaps[id]
})
function addMap(def: SpecialMapDef) {
  specialMaps[def.id] = def
  extra.push(def.id)
}

describe('special maps', () => {
  it('builds a fixed map from its grid with dark lighting and its fixed content', () => {
    const state = inRhineburg()
    const sewer = getArea(state, SEWER)
    expect(sewer).toMatchObject({ kind: 'special', special: 'sm_rhineburg_sewer', location: 'rhineburg', width: 11, height: 7, lighting: 'dark' })
    expect(cellAt(sewer, 1, 1)?.kind).toBe('encounter')
    expect(cellAt(sewer, 2, 2)?.kind).toBe('water')
    expect(sewer.cells.some((c) => c.kind === 'resource')).toBe(true)
  })

  it('opens a wall of a town block into the map, both ways, and leaves by walking back out', () => {
    const state = inRhineburg()
    const lower = getArea(state, 'rhineburg/lower')
    expect(cellAt(lower, 5, 6)).toMatchObject({ kind: 'link', link: { area: SEWER, x: 4, y: 0 } })
    stepOnto(state, 'rhineburg/lower', 5, 6, [5, 5])
    expect(currentArea(state).key).toBe(SEWER)
    expect(state.location).toBe('rhineburg')
    expect(state.special?.back).toEqual({ area: 'rhineburg/lower', x: 5, y: 6 })
    // 從通道走回城裡
    stepOnto(state, SEWER, 4, 0, [4, 1])
    expect(currentArea(state).key).toBe('rhineburg/lower')
    expect(state.special).toBeUndefined()
  })

  it('links special maps together and keeps the persistent one while the refreshing one resets', () => {
    const state = inRhineburg()
    stepOnto(state, 'rhineburg/lower', 5, 6, [5, 5])
    const sewer = currentArea(state)
    sewer.cells[1 * sewer.width + 1]!.done = true
    stepOnto(state, SEWER, 8, 6, [8, 5])
    expect(currentArea(state).key).toBe(CISTERN)
    const cistern = currentArea(state)
    expect(cellAt(cistern, 1, 0)).toMatchObject({ kind: 'link', link: { area: SEWER, x: 8, y: 6 } })
    const chest = cistern.cells.findIndex((c) => c.kind === 'chest')
    cistern.cells[chest]!.done = true
    // 出口不在這兩張圖上：走回城裡離開這片特殊地圖
    stepOnto(state, CISTERN, 1, 0, [1, 1])
    stepOnto(state, SEWER, 4, 0, [4, 1])
    expect(state.areas?.[SEWER]).toBeUndefined()
    expect(state.areas?.[CISTERN]?.cells[chest]?.done).toBe(true)
    // 旅行、重新進入地點時保留
    enterLocation(state)
    expect(state.areas?.[CISTERN]?.cells[chest]?.done).toBe(true)
  })

  it('keeps a flag-gated connection closed until the flag is set', () => {
    addMap({ id: 'sm_test_gate', name: '暗門後', location: 'rhineburg', desc: '測試', grid: ['#.#', '#E#'], connections: [{ at: { x: 1, y: 0 }, to: { area: 'rhineburg/lower', x: 4, y: 1 }, requires: { flags: ['test_gate'] } }] })
    const state = inRhineburg()
    expect(cellAt(getArea(state, 'rhineburg/lower'), 4, 1)?.kind).toBe('wall')
    setFlag(state, 'test_gate')
    expect(cellAt(getArea(state, 'rhineburg/lower'), 4, 1)).toMatchObject({ kind: 'link', link: { area: 'sm/sm_test_gate', x: 1, y: 0 } })
    // 城鎮那一端只會打開牆或水
    specialMaps.sm_test_gate!.connections![0]!.to = { area: 'rhineburg/lower', x: 2, y: 1 }
    expect(cellAt(getArea(state, 'rhineburg/lower'), 2, 1)?.kind).not.toBe('link')
  })

  it('teleports in from an event and leaves through the exit back to where it started', () => {
    addMap({ id: 'sm_test_cave', name: '測試洞窟', location: 'soriel', desc: '測試用的洞窟', size: [7, 7], encounters: [1, 1] })
    const state = inRhineburg()
    const before = { ...position(state) }
    queueMove(state, { special_map: 'sm_test_cave' })
    applyPendingMove(state)
    expect(currentArea(state).key).toBe('sm/sm_test_cave')
    expect(currentCell(state).kind).toBe('exit')
    expect(state.location).toBe('soriel')
    leaveSpecial(state)
    expect(state.location).toBe('rhineburg')
    expect(state.position).toMatchObject({ area: before.area, x: before.x, y: before.y })
    // 沒有設定刷新：離開之後還留著
    expect(state.areas?.['sm/sm_test_cave']).toBeDefined()
  })

  it('sends a defeated party back to the map\'s own location', () => {
    addMap({ id: 'sm_test_far', name: '遠方的地窖', location: 'soriel', desc: '測試', grid: ['#E#', '#.#'] })
    const state = inRhineburg()
    enterSpecial(state, 'sm_test_far')
    afterDefeat(state)
    expect(state.location).toBe('soriel')
    expect(currentArea(state).kind).toBe('settlement')
    expect(currentCell(state).kind).toBe('gate')
    expect(state.special).toBeUndefined()
  })

  it('places story points inside a special map and tells the AI where the party is', () => {
    const state = inRhineburg()
    const story: StoryDef = {
      id: 'test_sewer', title: '下水道的委託', summary: '', rank: 'F', start: { kind: 'manual' },
      nodes: [{ id: 'n1', title: '找到失物', text: '', kind: 'story', at: { where: 'special', special_map: 'sm_rhineburg_cistern' } }],
    } as StoryDef
    stories.push(story)
    try {
      startStory(state, 'test_sewer')
      refreshStoryMarkers(state)
      enterSpecial(state, 'sm_rhineburg_cistern')
      const area = currentArea(state)
      const i = area.cells.findIndex((c) => c.storyNode === 'test_sewer:n1')
      expect(i).toBeGreaterThanOrEqual(0)
      placeAt(state, area, i % area.width, Math.floor(i / area.width))
      expect(nodesHere(state).map((n) => n.ref)).toEqual(['test_sewer:n1'])
      const report: Report = {
        schema_version: '0.1', report_id: newReportId(state), kind: 'event', time: { start: state.time, end: state.time },
        location: { at: state.location, scene: area.name }, party: [], outcome: { result: 'neutral' }, changes: {},
      }
      expect(commitReport(state, report).location.scene).toContain('帝國時代的地下蓄水池')
    } finally {
      stories.splice(stories.indexOf(story), 1)
    }
  })

  it('puts a story point on the exact cell of a fixed map', () => {
    expect(storySpotProblem('sm_rhineburg_cistern', 4, 4)).toBeUndefined()
    expect(storySpotProblem('sm_rhineburg_cistern', 2, 2)).toContain('不是空地')
    expect(storySpotProblem('sm_rhineburg_cistern', 1, 0)).toContain('通道')
    expect(storySpotProblem('sm_rhineburg_sewer', 4, 0)).toBeTruthy()
    expect(storySpotProblem('sm_rhineburg_cistern', 9, 0)).toContain('超出')
    const nodes = (at: object) => [{ id: 'n1', title: '找到失物', text: '', kind: 'story', at: { where: 'special', special_map: 'sm_rhineburg_cistern', ...at }, success: { complete: true } }]
    const raw = { title: '蓄水池的寶箱', summary: '', rank: 'F', start: { kind: 'manual' } }
    // 整理：範圍內的格子留下，超出的拿掉；走不到的格子只提醒
    expect(sanitizeStory('t', { ...raw, nodes: nodes({ x: 4, y: 4 }) } as never, true).nodes[0]!.at).toMatchObject({ x: 4, y: 4 })
    expect(sanitizeStory('t', { ...raw, nodes: nodes({ x: 40, y: 4 }) } as never, true).nodes[0]!.at.x).toBeUndefined()
    const water = sanitizeStory('t', { ...raw, nodes: nodes({ x: 2, y: 2 }) } as never, true)
    expect(storyCheck(water).errors).toEqual([])
    expect(storyCheck(water).warnings.join()).toContain('隨機')
    const state = inRhineburg()
    const story = { ...sanitizeStory('test_spot', { ...raw, nodes: nodes({ x: 4, y: 4 }) } as never, true), id: 'test_spot' } as StoryDef
    const bad = { ...water, id: 'test_spot2' } as StoryDef
    stories.push(story, bad)
    try {
      startStory(state, 'test_spot')
      startStory(state, 'test_spot2')
      enterSpecial(state, 'sm_rhineburg_cistern')
      const area = currentArea(state)
      expect(area.cells[4 * area.width + 4]).toMatchObject({ kind: 'quest', storyNode: 'test_spot:n1' })
      // 走不到的格子：改成隨機的一格空地
      const i = area.cells.findIndex((c) => c.storyNode === 'test_spot2:n1')
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).not.toBe(2 * area.width + 2)
    } finally {
      stories.splice(stories.indexOf(story), 1)
      stories.splice(stories.indexOf(bad), 1)
    }
  })

  it('regenerates a stored map when its layout changed', () => {
    const state = inRhineburg()
    const first = getArea(state, CISTERN)
    first.cells[0]!.done = true
    const def = specialMaps.sm_rhineburg_cistern!
    // 和世界設定一樣換成一份新的定義（版本依定義記住，不會偵測原地修改）
    specialMaps.sm_rhineburg_cistern = { ...def, grid: def.grid!.map((r, y) => (y === 3 ? '#..R....#' : r)) }
    try {
      expect(getArea(state, CISTERN).cells[0]?.done).toBeUndefined()
      expect(cellAt(getArea(state, CISTERN), 3, 3)?.kind).toBe('resource')
    } finally {
      specialMaps.sm_rhineburg_cistern = def
    }
  })
})

describe('special map mods', () => {
  it('cleans a custom map: unknown characters become walls, bad connections are dropped', () => {
    const m = sanitizeSpecialMapMod('sm_test_a', {
      name: '測試', location: 'rhineburg', desc: '說明', grid: ['#?.#', '#.E'],
      connections: [
        { at: { x: 2, y: 0 }, to: { area: 'rhineburg/lower', x: 5, y: 6 } },
        { at: { x: 1, y: 1 }, to: { area: 'rhineburg/lower', x: 5, y: 5 } },
        { at: { x: 9, y: 9 }, to: { area: 'rhineburg/lower', x: 4, y: 1 } },
        { at: { x: 1, y: 0 }, to: { area: 'sm/sm_test_b', x: 0, y: 0 } },
      ],
    }, { sm_test_b: { grid: ['.#', '##'] } })
    expect(m.grid).toEqual(['##.#', '#.E#', '####'])
    expect(m.connections).toEqual([
      { at: { x: 2, y: 0 }, to: { area: 'rhineburg/lower', x: 5, y: 6 } },
      { at: { x: 1, y: 0 }, to: { area: 'sm/sm_test_b', x: 0, y: 0 } },
    ])
    expect(m.custom).toBe(true)
    expect(() => sanitizeSpecialMapMod('bad id', {})).toThrow('sm_')
  })

  it('applies custom maps from content mods and sends a player out of a removed one', () => {
    const state = inRhineburg()
    const mods = { ...emptyMods(), specialMaps: { sm_test_mod: { id: 'sm_test_mod', name: '自建的地窖', location: 'rhineburg', desc: '測試', grid: ['#E#', '#.#'], custom: true } } }
    try {
      expect(applyContent(mods)).toEqual([])
      expect(specialMaps.sm_test_mod?.name).toBe('自建的地窖')
      enterSpecial(state, 'sm_test_mod')
      expect(currentArea(state).key).toBe('sm/sm_test_mod')
      applyContent(emptyMods())
      expect(specialMaps.sm_test_mod).toBeUndefined()
      pruneSpecialMaps(state)
      expect(currentArea(state).kind).toBe('settlement')
      expect(state.areas?.['sm/sm_test_mod']).toBeUndefined()
    } finally {
      applyContent(emptyMods())
    }
  })

  it('lists story points, teleports and connections that use a map', () => {
    expect(specialMapUsage('sm_rhineburg_cistern')).toContain('特殊地圖「萊茵堡下水道」的通道')
    expect(specialMapUsage('sm_rhineburg_sewer')).toEqual(['特殊任務「鐵十字會」的任務點「在萊茵堡下水道找到鐵十字的軍火庫」', '固定 NPC「「老鼠」洛克」待在這裡'])
  })
})

describe('shops and fixed NPCs on special maps', () => {
  it('places shops on a fixed map, keeps only known shops and lists the map as using the shop', () => {
    const m = sanitizeSpecialMapMod('sm_test_market', {
      name: '地下市集', location: 'rhineburg', desc: '', grid: ['#####', '#...#', '##E##'],
      shops: [{ shop: 'smithy', x: 1, y: 1 }, { shop: 'nope', x: 2, y: 1 }, { shop: 'wanderer', x: 3, y: 1 }, { shop: 'general', x: 1, y: 1 }, { shop: 'magic', x: 9, y: 9 }],
    })
    expect(m.shops).toEqual([{ shop: 'smithy', x: 1, y: 1 }])
    addMap({ ...m, shops: [{ shop: 'smithy', x: 1, y: 1 }, { shop: 'general', x: 3, y: 1 }] })
    const state = inRhineburg()
    enterSpecial(state, 'sm_test_market')
    const area = currentArea(state)
    expect(cellAt(area, 1, 1)?.kind).toBe('smithy')
    expect(shopTypeForCell(cellAt(area, 3, 1)!.kind)).toBe('general')
    expect(shopUsage('smithy')).toContain('特殊地圖「地下市集」擺了這家店')
  })

  it('lets a fixed NPC stand on a cell of a fixed special map', () => {
    const npc = sanitizeNpc('npc_test_sewer', { name: '下水道的老人', location: 'rhineburg', fixed: { area: CISTERN, x: 2, y: 1 } }, true)
    expect(npc.fixed).toEqual({ area: CISTERN, x: 2, y: 1 })
    // 牆不能站
    expect(sanitizeNpc('npc_test_sewer', { name: '下水道的老人', location: 'rhineburg', fixed: { area: CISTERN, x: 0, y: 0 } }, true).fixed).toBeUndefined()
    const state = inRhineburg()
    const rec = npcRecord(state, 'npc_lina')!
    rec.fixed = { area: CISTERN, x: 2, y: 1 }
    expect(areaOf(state, rec)).toBe(CISTERN)
    enterSpecial(state, 'sm_rhineburg_cistern')
    expect(npcCell(state, rec, currentArea(state))).toEqual({ x: 2, y: 1 })
  })
})
