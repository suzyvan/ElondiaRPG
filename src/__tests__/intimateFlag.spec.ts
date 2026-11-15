// 沒經過判定的日誌寫出了性愛場景：寫手在正文後標出 <intimate_scene>，程式拿掉標籤、記在日誌上，之後就算親密場景、可以記性經歷
import { describe, expect, it } from 'vitest'
import { splitSuggestions, visibleNarration } from '@/narrator/judge'
import { buildPrompt, INTIMATE_FLAG_NOTE } from '@/narrator/prompt'
import { intimateReport } from '@/engine/sexRecord'
import { buildSexLogPrompt } from '@/narrator/sexLog'
import { newGame } from '@/engine/state'
import { baseReport } from '@/engine/town'

describe('寫手標出的親密場景', () => {
  it('從正文後面取出標籤，和人際關係的提議一起時兩個都拿掉', () => {
    expect(splitSuggestions('兩人在火堆旁相擁入眠。\n<intimate_scene>主角與莉娜在帳篷裡發生關係</intimate_scene>'))
      .toEqual({ text: '兩人在火堆旁相擁入眠。', updates: [], intimate: '主角與莉娜在帳篷裡發生關係' })
    const both = splitSuggestions('正文。\n<relationship_updates>[{"id":"npc_lina","to_player":"戀人"}]</relationship_updates>\n<intimate_scene>主角與莉娜</intimate_scene>')
    expect(both).toEqual({ text: '正文。', updates: [{ id: 'npc_lina', to_player: '戀人' }], intimate: '主角與莉娜' })
    // 順序反過來、提議沒有結尾標籤
    const reversed = splitSuggestions('正文。\n<intimate_scene>主角與莉娜</intimate_scene>\n<relationship_updates>[{"id":"npc_lina","to_player":"戀人"}]')
    expect(reversed).toEqual({ text: '正文。', updates: [{ id: 'npc_lina', to_player: '戀人' }], intimate: '主角與莉娜' })
    expect(splitSuggestions('沒有標籤的正文')).toEqual({ text: '沒有標籤的正文', updates: [] })
  })

  it('串流中不顯示標籤（寫到一半的也藏起來）', () => {
    expect(visibleNarration('正文。\n<intimate_scene>主角')).toBe('正文。')
    expect(visibleNarration('正文。\n<intim')).toBe('正文。')
  })

  it('本次要求只在要標的時候、而且不是已知的親密場景時加上說明', () => {
    const state = newGame({ name: '莉雅', race: 'human', classId: 'bard', seed: 5 })
    const r = baseReport(state, 'rest', 1)
    const user = (o: { flagIntimate?: boolean }) => buildPrompt(r, [], { playerName: '莉雅', language: 'zh-Hant', ...o }).user
    expect(user({ flagIntimate: true })).toContain('<intimate_scene>')
    expect(user({})).not.toContain('<intimate_scene>')
    r.narration = { adult_scene: '在旅店的房間裡共度一夜' }
    expect(user({ flagIntimate: true })).not.toContain(INTIMATE_FLAG_NOTE)
  })

  it('標出的日誌算親密場景，記錄的提示詞寫上標出的內容', () => {
    const state = newGame({ name: '莉雅', race: 'human', classId: 'bard', seed: 5 })
    const r = baseReport(state, 'rest', 1)
    expect(intimateReport(r)).toBe(false)
    r.narration = { intimate_note: '主角與莉娜在帳篷裡發生關係' }
    expect(intimateReport(r)).toBe(true)
    expect(buildSexLogPrompt(state, r, '')!.prompt.user).toContain('正文寫到的親密場景：主角與莉娜在帳篷裡發生關係')
  })
})
