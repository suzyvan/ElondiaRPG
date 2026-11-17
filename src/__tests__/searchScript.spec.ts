import { describe, expect, it } from 'vitest'

describe('搜尋繁簡不分', () => {
  it('輸入簡體也找得到繁體的名字，寫法一樣的照舊', async () => {
    const { textHas } = await import('@/engine/script')
    expect(textHas('共鳴晶體', '共鸣晶体')).toBe(true)
    expect(textHas('共鳴晶體', '晶體')).toBe(true)
    expect(textHas('共鳴晶體', '晶体')).toBe(true)
    expect(textHas('共鳴晶體', '水晶')).toBe(false)
    expect(textHas(undefined, '晶')).toBe(false)
    expect(textHas('任何', '')).toBe(true)
  })
})
