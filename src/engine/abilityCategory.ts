// 能力的分類：角色詳情的能力分頁、戰鬥中的技能選單用分類按鈕篩選。
// 依效果自動判斷，不用逐筆標；分錯的在能力資料（或世界編輯器）寫 category 指定。
import type { AbilityCategoryId, AbilityDef } from './data'

export const ABILITY_CATEGORIES: { id: AbilityCategoryId; name: string; hint: string }[] = [
  { id: 'attack', name: '單體攻擊', hint: '打一個敵人、有傷害' },
  { id: 'area', name: '範圍攻擊', hint: '打全體或隨機幾個敵人、有傷害' },
  { id: 'control', name: '控制・削弱', hint: '對敵人、沒有傷害：上狀態、要對方豁免' },
  { id: 'heal', name: '治療・護盾', hint: '治療、臨時生命、解除狀態、扶起倒下的人' },
  { id: 'buff', name: '增益', hint: '對自己或隊友的其他能力' },
  { id: 'lust', name: '慾望', hint: '加減慾望、清淨、苗床' },
]

const IDS = new Set<string>(ABILITY_CATEGORIES.map((c) => c.id))

export function isAbilityCategory(v: unknown): v is AbilityCategoryId {
  return typeof v === 'string' && IDS.has(v)
}

/** 依效果判斷的分類（不看 category） */
export function autoAbilityCategory(a: AbilityDef): AbilityCategoryId {
  if (a.lust_gain || a.lust_relief || a.lust_transfer || a.purity || a.brood) return 'lust'
  const foe = a.target === 'enemy' || a.target === 'all_enemies' || a.target === 'random_enemies'
  if (!foe && (a.heal || a.shield || a.cleanse || a.revive || a.target === 'ally_or_downed')) return 'heal'
  if (!foe) return 'buff'
  if (!a.damage?.length) return 'control'
  return a.target === 'enemy' ? 'attack' : 'area'
}

export function abilityCategory(a: AbilityDef): AbilityCategoryId {
  return isAbilityCategory(a.category) ? a.category : autoAbilityCategory(a)
}

export function abilityCategoryName(id: AbilityCategoryId): string {
  return ABILITY_CATEGORIES.find((c) => c.id === id)?.name ?? id
}
