import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cellAt, currentArea, enterLocation, goOutskirts, isRevealed, pathTo, position, type Area } from '@/engine/grid'
import { newGame } from '@/engine/state'
import type { GameState, Report } from '@/engine/types'
import { useGame } from '@/stores/game'
import { narrateKindOf } from '@/stores/settings'

function outskirts(seed = 2): GameState {
  const state = newGame({ name: '測試者', race: 'human', classId: 'fighter', seed })
  enterLocation(state)
  goOutskirts(state)
  return state
}

/** 把整張地圖揭開（測試用） */
function revealAll(area: Area) {
  area.revealed = area.cells.map((_, i) => i)
}

const DANGER = ['encounter', 'elite', 'boss', 'chest', 'resource', 'quest', 'link', 'exit', 'stairs_down', 'stairs_up']

describe('點地圖上的格子走過去：找路', () => {
  it('only walks over revealed cells and steps around things on the way', () => {
    const state = outskirts()
    const area = currentArea(state)
    const from = position(state)
    // 還沒揭開的格子：不走
    const hidden = area.cells.findIndex((c, i) => c.kind === 'floor' && !isRevealed(area, i % area.width, Math.floor(i / area.width)))
    if (hidden >= 0) expect(pathTo(state, hidden % area.width, Math.floor(hidden / area.width))).toBeNull()

    revealAll(area)
    // 走到最遠的一塊空地：路上不經過遭遇、寶箱、採集點、出入口
    const floors = area.cells.map((c, i) => ({ c, x: i % area.width, y: Math.floor(i / area.width) })).filter((f) => f.c.kind === 'floor')
    const far = floors.sort((a, b) => (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)) - (Math.abs(a.x - from.x) + Math.abs(a.y - from.y)))
    const target = far.find((f) => pathTo(state, f.x, f.y))!
    const path = pathTo(state, target.x, target.y)!
    expect(path.at(-1)).toEqual({ x: target.x, y: target.y })
    let p: { x: number; y: number } = from
    for (const step of path) {
      expect(Math.abs(step.x - p.x) + Math.abs(step.y - p.y)).toBe(1)
      p = step
    }
    for (const step of path.slice(0, -1)) {
      const c = cellAt(area, step.x, step.y)!
      expect(DANGER.includes(c.kind) && !c.done).toBe(false)
    }
    // 牆、原地：不行
    const wall = area.cells.findIndex((c) => c.kind === 'wall')
    if (wall >= 0) expect(pathTo(state, wall % area.width, Math.floor(wall / area.width))).toBeNull()
    expect(pathTo(state, from.x, from.y)).toBeNull()
  })

  it('may end on an encounter, but never passes through one', () => {
    const state = outskirts(5)
    const area = currentArea(state)
    revealAll(area)
    const enc = area.cells.findIndex((c) => c.kind === 'encounter' && !c.done)
    if (enc < 0) return
    const path = pathTo(state, enc % area.width, Math.floor(enc / area.width))
    if (!path) return
    expect(path.slice(0, -1).every((s) => cellAt(area, s.x, s.y)!.kind !== 'encounter')).toBe(true)
  })
})

describe('點地圖上的格子走過去：一格一格走', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('walks step by step to the target in town, and stops when asked', () => {
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const s = game.state!
    const area = currentArea(s)
    const from = position(s)
    const floors = area.cells.map((c, i) => ({ c, x: i % area.width, y: Math.floor(i / area.width) }))
      .filter((f) => f.c.kind === 'floor' && Math.abs(f.x - from.x) + Math.abs(f.y - from.y) >= 3)
    const target = floors.find((f) => pathTo(s, f.x, f.y))!
    const steps = pathTo(s, target.x, target.y)!.length
    game.walkTo(target.x, target.y)
    expect(game.walkTarget).toEqual({ x: target.x, y: target.y })
    // 第一步馬上走
    expect(position(game.state!)).not.toEqual(from)
    vi.advanceTimersByTime(140 * steps + 50)
    expect(position(game.state!)).toMatchObject({ x: target.x, y: target.y })
    expect(game.walkTarget).toBeNull()

    // 走到一半按方向鍵（或改點別的地方）：停下來
    game.walkTo(from.x, from.y)
    game.move(0, 0)
    const stopped = { ...position(game.state!) }
    vi.advanceTimersByTime(140 * steps + 50)
    expect(position(game.state!)).toMatchObject({ x: stopped.x, y: stopped.y })
    expect(game.walkTarget).toBeNull()
  })
})

describe('採集算「事件與委託」', () => {
  it('auto-narrates gathering under 事件與委託, not 主動行動', () => {
    const report = { kind: 'action', outcome: { result: 'success', tags: ['採集'] } } as unknown as Report
    expect(narrateKindOf(report)).toBe('event')
    expect(narrateKindOf({ kind: 'action', outcome: { result: 'success' } } as unknown as Report)).toBe('action')
  })

  it('puts every step of a special quest under ⭐ 特殊任務: story points, checks and battles', () => {
    const story = { id: 'x', title: 'X', status: 'progress' }
    expect(narrateKindOf({ kind: 'event', story, outcome: { result: 'neutral' } } as unknown as Report)).toBe('story')
    expect(narrateKindOf({ kind: 'action', story, check: { source: 'ai' }, outcome: { result: 'success' } } as unknown as Report)).toBe('story')
    expect(narrateKindOf({ kind: 'combat', story, outcome: { result: 'victory' } } as unknown as Report)).toBe('story')
    expect(narrateKindOf({ kind: 'event', outcome: { result: 'neutral' } } as unknown as Report)).toBe('event')
  })
})
