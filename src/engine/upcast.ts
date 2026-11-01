// 升環：用比法術本身高的法術環施放（docs/COMBAT_SYSTEM.md 第 7 節「升環」）。
// 法術的 upcast 寫「每高一環多什麼」，數值照 D&D 5e 的升環規則；沒寫 upcast 的法術用高環施放效果不變。

import type { AbilityDef } from './data'

const DICE = /^(\d*)d(\d+)([+-]\d+)?$/

function parse(dice: string) {
  const m = DICE.exec(dice.replace(/\s+/g, ''))
  return m ? { count: Number(m[1]) || 1, sides: Number(m[2]), flat: Number(m[3] ?? 0) } : null
}

/** 骰子乘上次數：1d6 × 3 → 3d6（有固定加值的也一起乘） */
export function timesDice(dice: string, n: number): string {
  const d = parse(dice)
  if (!d) return dice
  const flat = d.flat * n
  return `${d.count * n}d${d.sides}${flat > 0 ? `+${flat}` : flat < 0 ? flat : ''}`
}

/** 把 extra（已經乘過次數的骰子）加進 base；骰子面數不同時回傳 null */
export function addDice(base: string, extra: string): string | null {
  const a = parse(base)
  const b = parse(extra)
  if (!a || !b || a.sides !== b.sides) return null
  const flat = a.flat + b.flat
  return `${a.count + b.count}d${a.sides}${flat > 0 ? `+${flat}` : flat < 0 ? flat : ''}`
}

/** 這個法術用 circle 環施放時，比原本高幾環 */
export function upcastLevels(a: AbilityDef, circle: number): number {
  return a.type === 'spell' ? Math.max(0, circle - (a.circle ?? 1)) : 0
}

/** 升了 n 環之後的法術（n ≤ 0 或沒有 upcast 時回傳原本的那一份） */
export function upcastAbility(a: AbilityDef, n: number): AbilityDef {
  const up = a.upcast
  if (!up || n <= 0) return a
  const out: AbilityDef = { ...a }
  if (up.dice && a.damage?.length) {
    const i = Math.min(up.part ?? 0, a.damage.length - 1)
    const extra = timesDice(up.dice, n)
    const part = a.damage[i]!
    const merged = part.dice && !part.weapon ? addDice(part.dice, extra) : null
    out.damage = a.damage.map((p, k) => (k === i && merged ? { ...p, dice: merged } : p))
    // 面數不同（或是武器傷害）：另外擲一筆同屬性的
    if (!merged) out.damage.push({ dice: extra, ...(part.type ? { type: part.type } : {}) })
  }
  if ((up.heal || up.heal_flat) && a.heal && !a.heal.full) {
    const heal = { ...a.heal }
    if (up.heal) {
      const extra = timesDice(up.heal, n)
      heal.dice = heal.dice ? addDice(heal.dice, extra) ?? heal.dice : extra
      if (a.heal.dice && heal.dice === a.heal.dice) heal.flat = (heal.flat ?? 0) + Math.round(averageDice(extra))
    }
    if (up.heal_flat) heal.flat = (heal.flat ?? 0) + up.heal_flat * n
    out.heal = heal
  }
  if (up.count && a.target === 'random_enemies') out.count = (a.count ?? 1) + up.count * n
  if (up.hits) out.hits = (a.hits ?? 1) + up.hits * n
  if (up.shield) out.shield = { ...a.shield, flat: (a.shield?.flat ?? 0) + up.shield * n }
  return out
}

function averageDice(dice: string): number {
  const d = parse(dice)
  return d ? (d.count * (d.sides + 1)) / 2 + d.flat : 0
}

/** 施加的持續傷害、每回合攻擊的狀態（月華光束、靈體武器……）升了 n 環多擲的骰子 */
export function upcastStatusDice(a: AbilityDef, n: number): string | undefined {
  return a.upcast?.status_dice && n > 0 ? timesDice(a.upcast.status_dice, n) : undefined
}

/** 「每高一環」的說明，例如「傷害 +1d6」「多 1 枚」；n 給了就寫成升 n 環的總量。沒有效果時回傳空字串 */
export function upcastText(a: AbilityDef, n = 1): string {
  const up = a.upcast
  if (!up || a.type !== 'spell') return ''
  const parts: string[] = []
  if (up.dice) parts.push(`傷害 +${timesDice(up.dice, n)}`)
  if (up.heal) parts.push(`治療 +${timesDice(up.heal, n)}`)
  if (up.heal_flat) parts.push(`治療 +${up.heal_flat * n}`)
  if (up.count) parts.push(`次數 +${up.count * n}`)
  if (up.hits) parts.push(`攻擊次數 +${up.hits * n}`)
  if (up.shield) parts.push(`臨時生命 +${up.shield * n}`)
  if (up.status_dice) parts.push(`每回合的傷害 +${timesDice(up.status_dice, n)}`)
  return parts.join('、')
}
