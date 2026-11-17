// 擴建（docs/HOMES.md 第 3.1 節；規則在 homes.json 的 expand）：在自己的房子裡花錢、花時間改造房子。
// - 加蓋一層：生成新的頂樓，在原本頂樓找一格空的地板放往上的樓梯（新樓層同一位置放往下的樓梯）。
// - 挖地下室：生成地下室，在一樓（屋子裡）找一格空的地板放往下的樓梯。
// - 擴院子：完工時在一樓地圖下方加幾列（上面的格子座標不變），出口移到新的圍牆上。
// - 原本的樓層不重新生成：家具、作物、箱子、留守的人都不動。
// - 付錢後開工，until 那天完工（每天的推進 staffDaily 呼叫 settleConstruction）；施工期間新樓層的樓梯走不過去（grid.ts 的 crossLink）。
//   一次只能做一項。完工時記在「你不在的時候」（房子的 staffNotes）。

import { homeRules } from './data'
import { currentArea, type Area, type Cell } from './grid'
import { buildFloor, homeReport, ownHomeOfArea, stairSpots } from './homes'
import { formatMoney } from './money'
import { assertFree } from './party'
import { commitReport, withRng } from './state'
import { locationMult } from './trade'
import type { GameState, Home, Report } from './types'

export type ExpandKind = 'floor' | 'basement' | 'yard'
const rules = () => homeRules.expand
const FLOOR_NAMES = ['地下室', '一樓', '二樓', '三樓', '四樓', '五樓']

const groundOf = (home: Home) => home.areas[home.floors.find((k) => home.areas[k]?.homeFloor === 'ground')!]!
/** 地上幾層 */
export const floorsAbove = (home: Home) => Object.values(home.areas).filter((a) => a.homeFloor !== 'basement').length
export const hasBasement = (home: Home) => Object.values(home.areas).some((a) => a.homeFloor === 'basement')
/** 院子的深度（格；屋子下方、圍牆以上的列數） */
export function yardDepth(home: Home): number {
  const def = homeRules.districts[home.district]
  return Math.max(0, groundOf(home).height - def.size[1] - 1)
}

export interface ExpandOption {
  kind: ExpandKind
  label: string
  price: number
  days: number
  /** 做不了的原因（可以做時沒有） */
  blocked?: string
}

/** 樓梯可以放的格子：一般地板、沒有家具、不是通道，四周至少兩格地板；挖地下室時只看屋子裡（院子不行） */
function freeStairSpots(home: Home, area: Area): number[] {
  const def = homeRules.districts[home.district]
  const taken = new Set<number>()
  area.cells.forEach((c, i) => { if (c.furniture || c.kind !== 'floor' || Math.floor(i / area.width) >= def.size[1]) taken.add(i) })
  return stairSpots(area, taken)
}

/** 這棟房子能做的擴建：價格（乘這座城的物價）、工期與做不了的原因 */
export function expandOptions(state: GameState, home: Home): ExpandOption[] {
  const r = rules()
  const base = homeRules.districts[home.district].price_cc
  const mult = locationMult(state)
  const busy = home.construction ? '正在施工，一次只能做一項' : undefined
  const top = home.areas[home.floors.at(-1)!]!
  const maxFloors = r.floor.max_floors[home.district] ?? 2
  const nextFloor = FLOOR_NAMES[floorsAbove(home) + 1] ?? `${floorsAbove(home) + 1} 樓`
  return [
    {
      kind: 'floor', label: `加蓋一層（${nextFloor}）`, price: Math.round(base * r.floor.price_ratio * mult), days: r.floor.days,
      blocked: busy ?? (floorsAbove(home) >= maxFloors ? `這種房子最多蓋到地上 ${maxFloors} 層` : !freeStairSpots(home, top).length ? '頂樓沒有空間放樓梯，先收起一些家具' : undefined),
    },
    {
      kind: 'basement', label: '挖地下室', price: Math.round(base * r.basement.price_ratio * mult), days: r.basement.days,
      blocked: busy ?? (hasBasement(home) ? '已經有地下室了' : !freeStairSpots(home, groundOf(home)).length ? '一樓沒有空間放樓梯，先收起一些家具' : undefined),
    },
    {
      kind: 'yard', label: '院子擴大一格', price: Math.round(r.yard.price_cc * mult), days: r.yard.days,
      blocked: busy ?? (yardDepth(home) === 0 ? '這棟房子沒有院子' : yardDepth(home) >= r.yard.max ? `院子最深 ${r.yard.max} 格` : undefined),
    },
  ]
}

/** 把新樓層接到 from 那一層：從 from 的空地板挑一格放樓梯，新樓層同一位置放回去的樓梯 */
function linkFloors(from: Area, to: Area, dir: 'up' | 'down', spot: number) {
  const x = spot % from.width
  const y = Math.floor(spot / from.width)
  from.cells[spot] = { kind: 'link', dir, link: { area: to.key, x, y } }
  to.cells[spot] = { kind: 'link', dir: dir === 'up' ? 'down' : 'up', link: { area: from.key, x, y } }
}

/** 開工：付錢；加蓋與地下室現在就把新樓層生出來（施工期間走不過去），院子完工時才加 */
export function startExpansion(state: GameState, kind: ExpandKind): Report {
  assertFree(state, '擴建房子')
  const home = ownHomeOfArea(state, currentArea(state))
  if (!home) throw new Error('要在自己的房子裡才能擴建')
  const opt = expandOptions(state, home).find((o) => o.kind === kind)!
  if (opt.blocked) throw new Error(opt.blocked)
  if (state.money_cc < opt.price) throw new Error(`錢不夠（需要 ${formatMoney(opt.price)}）`)
  const until = state.time.day + opt.days
  if (kind === 'floor' || kind === 'basement') {
    const from = kind === 'floor' ? home.areas[home.floors.at(-1)!]! : groundOf(home)
    const level = kind === 'floor' ? floorsAbove(home) : -1
    const key = `home/${home.id}/${kind === 'basement' ? 'B1' : `F${level + 1}`}`
    const area = withRng(state, (rng) => {
      const spots = freeStairSpots(home, from)
      // 新樓層同一位置也要是地板：試幾次，不行就把那一格改成地板（和買房時一樣）
      for (let i = 0; i < 10; i++) {
        const a = buildFloor(home, key, kind === 'basement' ? 'basement' : 'upper', level, rng)
        const both = spots.filter((s) => a.cells[s]?.kind === 'floor')
        if (both.length) return { a, spot: rng.pick(both) }
      }
      const a = buildFloor(home, key, kind === 'basement' ? 'basement' : 'upper', level, rng)
      const spot = rng.pick(spots)
      a.cells[spot] = { kind: 'floor' } as Cell
      return { a, spot }
    })
    linkFloors(from, area.a, kind === 'floor' ? 'up' : 'down', area.spot)
    home.areas[key] = area.a
    if (kind === 'floor') home.floors.push(key)
    else home.floors.unshift(key)
    home.construction = { kind, until, area: key }
  } else {
    home.construction = { kind, until, rows: 1 }
  }
  const report = homeReport(state, 'trade', 1, home.name)
  report.changes.money_cc = -opt.price
  report.outcome = {
    result: 'success',
    summary: `請了工匠替「${home.name}」${opt.label}，付了 ${formatMoney(opt.price)}，${opt.days} 天後完工。`,
    tags: ['擴建'],
  }
  return commitReport(state, report)
}

/** 還要幾天完工（沒有施工時 0） */
export function constructionDaysLeft(state: GameState, home: Home): number {
  return home.construction ? Math.max(0, home.construction.until - state.time.day) : 0
}

/** 施工中走不過去的樓層：走樓梯時擋下來（grid.ts 的 crossLink）；可以走時是 undefined */
export function constructionBlock(state: GameState, target: Pick<Area, 'key' | 'kind'>): string | undefined {
  if (target.kind !== 'home') return undefined
  const home = Object.values(state.homes ?? {}).find((h) => h.construction?.area === target.key)
  if (!home) return undefined
  const left = constructionDaysLeft(state, home)
  return left > 0 ? `還在施工，再 ${left} 天才完工` : undefined
}

/** 院子往下加幾列：拿掉原本最下面的圍牆，接上新的院子列與新的圍牆（出口在同一欄，接回原本的街道）；上面的格子座標不變 */
function growYard(state: GameState, home: Home, rows: number) {
  const g = groundOf(home)
  const w = g.width
  const exitAt = g.cells.findIndex((c) => c.dir === 'out')
  const exitX = exitAt >= 0 ? exitAt % w : Math.floor(w / 2)
  const exit = exitAt >= 0 ? g.cells[exitAt]! : ({ kind: 'link', dir: 'out', link: { area: home.lot.area, ...home.lot.street } } as Cell)
  const body = g.cells.slice(0, (g.height - 1) * w)
  const yard = Array.from({ length: rows * w }, (_, i) => ({ kind: i % w === 0 || i % w === w - 1 ? 'wall' : 'yard' }) as Cell)
  const wall = Array.from({ length: w }, (_, x) => (x === exitX ? exit : ({ kind: 'wall' } as Cell)))
  g.cells = [...body, ...yard, ...wall]
  g.height = g.cells.length / w
  // 城裡已經載入的街道：門通往新的出口
  const street = state.areas?.[home.lot.area]
  const door = street?.cells[home.lot.y * street.width + home.lot.x]
  if (door?.link && door.home === home.id) door.link = { area: g.key, x: exitX, y: g.height - 1 }
}

/** 完工（每天的推進）：解除施工；院子在這時才加列；記在「你不在的時候」 */
export function settleConstruction(state: GameState) {
  for (const home of Object.values(state.homes ?? {})) {
    const c = home.construction
    if (!c || state.time.day < c.until) continue
    delete home.construction
    let what = ''
    if (c.kind === 'yard') {
      growYard(state, home, c.rows ?? 1)
      what = `院子擴大了，現在深 ${yardDepth(home)} 格`
    } else what = c.kind === 'basement' ? '地下室挖好了' : `${home.areas[c.area ?? '']?.name.split('・').at(-1) ?? '新的一層'}蓋好了`
    ;(home.staffNotes ??= []).push({ text: `擴建完工：${what}。`, tag: '擴建', day: state.time.day })
  }
}
