// 待在地標的固定 NPC：冒險者不是「店主與職員」，可以雇用、偷襲（玩家回報：玄霜、青蘿沒有雇用與偷襲的按鈕）
import { describe, expect, it } from 'vitest'
import { npcs as namedNpcs } from '@/engine/data'
import { npcRecord } from '@/engine/npcs'
import { isStaffNpc } from '@/engine/population'
import { newGame } from '@/engine/state'

describe('NPCs who stay at a landmark', () => {
  const s = newGame({ name: '北眺', race: 'human', classId: 'fighter', seed: 4 })

  it('are not staff when they are adventurers', () => {
    expect(isStaffNpc(npcRecord(s, 'npc_yh_xuanshuang')!)).toBe(false)
    expect(isStaffNpc(npcRecord(s, 'npc_yh_qingluo')!)).toBe(false)
    for (const d of namedNpcs.filter((n) => n.landmark && n.kind === 'adventurer')) expect(isStaffNpc(npcRecord(s, d.id)!), d.id).toBe(false)
  })

  it('keeps commoners at a landmark and fixed NPCs without a place where they were', () => {
    const commoner = namedNpcs.find((n) => n.landmark && n.kind === 'commoner')!
    expect(isStaffNpc(npcRecord(s, commoner.id)!)).toBe(true)
    // 有活躍地點的人不是職員；沒有活躍地點、也沒有固定位置的固定 NPC 照舊待在酒館
    const roaming = namedNpcs.find((n) => n.haunts?.length && n.kind === 'adventurer')!
    expect(isStaffNpc(npcRecord(s, roaming.id)!)).toBe(false)
    const rec = { ...npcRecord(s, 'npc_yh_xuanshuang')!, landmark: undefined, fixed: undefined }
    expect(isStaffNpc(rec)).toBe(true)
  })
})
