// 冒險筆記的收藏：玩家把正在追的特殊任務標起來，筆記最前面的「★ 收藏」頁只列這些，進行中的清單也排在最前面。
// 存在存檔裡（GameState.pinnedStories），跟著存檔走。
import { npcRecord } from './npcs'
import type { StoryDef } from './data'
import type { GameState } from './types'

export function isStoryPinned(state: GameState, id: string): boolean {
  return !!state.pinnedStories?.includes(id)
}

/** 收藏或取消收藏；收藏的放在最後（照收藏的順序列） */
export function toggleStoryPin(state: GameState, id: string, on = !isStoryPinned(state, id)) {
  if (!state.stories?.[id]) throw new Error('還沒有接這個特殊任務')
  const rest = (state.pinnedStories ?? []).filter((x) => x !== id)
  if (on) rest.push(id)
  if (rest.length) state.pinnedStories = rest
  else delete state.pinnedStories
}

/** 特殊任務的分類（冒險筆記的「分類」選單）：角色線、公會的委託、情報商的消息、其他 */
export type StoryCategory = 'npc' | 'guild' | 'informant' | 'other'
export const STORY_CATEGORY_NAME: Record<StoryCategory, string> = { npc: '角色線', guild: '公會的委託', informant: '情報商的消息', other: '其他' }

export function storyCategory(def: Pick<StoryDef, 'start'>): StoryCategory {
  const k = def.start.kind
  return k === 'npc' || k === 'guild' || k === 'informant' ? k : 'other'
}

const npcName = (state: GameState, id: string) => state.party.find((m) => m.id === id)?.name ?? npcRecord(state, id)?.name ?? id

/** 卡片上的小標：角色線寫是誰的線 */
export function storyCategoryLabel(state: GameState, def: Pick<StoryDef, 'start'>): string {
  const c = storyCategory(def)
  return c === 'npc' && def.start.npc ? `${npcName(state, def.start.npc)}的線` : STORY_CATEGORY_NAME[c]
}
