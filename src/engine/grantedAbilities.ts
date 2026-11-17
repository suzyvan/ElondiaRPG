// 不在角色自己的能力清單（Character.abilities）、卻會出現在戰鬥選單的能力：寄生物（魅魔淫紋……）的階段能力、
// 流派的能力、泌乳的能力。戰鬥時由 combat.ts 加進去；這裡另外列出來源，讓角色詳情看得到、也能在戰鬥選單隱藏。
import { abilities } from './data'
import { lactationAbilities } from './lactation'
import { parasiteAbilities, parasiteDef, parasitesOf } from './parasites'
import { schoolAbilities, schoolDef, schoolsOf } from './schools'
import type { Character } from './types'

export interface GrantedAbility { id: string; from: string }

/** 這個人現在多出來的能力與來源（同一個能力只列一次） */
export function grantedAbilities(c: Character): GrantedAbility[] {
  const out: GrantedAbility[] = []
  const seen = new Set<string>()
  const add = (ids: string[], from: (id: string) => string) => {
    for (const id of ids) {
      if (seen.has(id) || !abilities[id]) continue
      seen.add(id)
      out.push({ id, from: from(id) })
    }
  }
  add(parasiteAbilities(c), (id) => {
    const names = parasitesOf(c)
      .map((p) => parasiteDef(p.id))
      .filter((d) => !!d && ((d.stage_abilities ?? []).some((s) => s.includes(id)) || d.tamed?.ability === id))
      .map((d) => d!.name)
    return names.length ? names.join('、') : '寄生物'
  })
  add(schoolAbilities(c), (id) => schoolsOf(c).map(schoolDef).find((d) => d?.abilities?.some((a) => a.id === id))?.name ?? (c.hatched?.includes(id) ? '孵化的蟲' : '流派'))
  add(lactationAbilities(c), () => '泌乳')
  return out
}

/** 可以在戰鬥選單隱藏的能力：自己的，加上多出來的 */
export function hideableAbilities(c: Character): Set<string> {
  return new Set([...c.abilities, ...grantedAbilities(c).map((g) => g.id)])
}
