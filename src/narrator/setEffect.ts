// 自建成套家具的效果（docs/HOMES.md 第 4.1 節）：依套組的名稱、主題與家具，請「世界設計」的 AI 在上限內決定在家長休後的狀態。
// 上限與整理在 engine/homeMods.ts（sanitizeSetEffect）：AI 回的超出範圍的部分照樣被夾掉。

import { ATTR_IDS, attrName } from '@/engine/data'
import { SET_LIMITS, sanitizeSetEffect, type SetEffect } from '@/engine/homeMods'
import { extractJson } from './judge'
import type { Prompt } from './prompt'

export interface SetEffectInput {
  name: string
  theme?: string
  /** 屬於這一套的家具 */
  pieces: string[]
  need: number
}

export function buildSetEffectPrompt(input: SetEffectInput): Prompt {
  const attrs = ATTR_IDS.map((a) => `${a}（${attrName(a)}）`).join('、')
  const system = [
    '你是奇幻角色扮演遊戲「艾隆迪亞」的設計師。玩家在自己的房子裡湊齊一套成套家具之後，在家長休醒來時全隊會得到一個小小的好狀態（下次長休前有效）。',
    '請依套組的名稱、主題與家具，替這個好狀態取名、寫一句氣氛描寫，並從下面的好處中挑選最貼近主題的，**最多兩項**：',
    `- check_attrs：一到兩個屬性的檢定 +1（算一項）。屬性只能是：${attrs}`,
    '- save：1 表示豁免 +1（算一項）',
    '- evade：1 表示迴避 +1（算一項）',
    `- temp_hp：每場戰鬥開始時的暫時生命，1～${SET_LIMITS.temp_hp}（算一項）`,
    `名稱最多 ${SET_LIMITS.effect_name_chars} 個字（例如「茶香的餘韻」「獵人的晨起」），描寫最多 ${SET_LIMITS.desc_chars} 個字、用繁體中文、不要寫數值。`,
    '只回 JSON，不要其他文字：{"name":"…","desc":"…","check_attrs":["int"],"save":0,"evade":0,"temp_hp":0}',
  ].join('\n')
  const user = [
    `套組：${input.name}（湊齊 ${input.need} 件）`,
    ...(input.theme ? [`主題：${input.theme}`] : []),
    `家具：${input.pieces.length ? input.pieces.join('、') : '（還沒有家具指定到這一套）'}`,
  ].join('\n')
  return { system, user }
}

/** 整理 AI 的回應；沒有可用的好處時丟錯 */
export function parseSetEffect(text: string): SetEffect {
  const effect = sanitizeSetEffect(extractJson(text))
  if (!effect) throw new Error('AI 回的效果沒有名稱或沒有任何好處，請再試一次或手動設定')
  return effect
}
