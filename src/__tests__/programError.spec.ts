import { describe, expect, it } from 'vitest'
import { isProgramError, programErrorText, splitError, stackFrames } from '@/narrator/errorText'

describe('程式錯誤的回報訊息', () => {
  it('規則擋下來的一般錯誤不算程式錯誤', () => {
    expect(isProgramError(new Error('錢不夠'))).toBe(false)
    expect(isProgramError(new TypeError("Cannot read properties of undefined (reading 'cell')"))).toBe(true)
    expect(isProgramError('x')).toBe(false)
  })

  it('堆疊只留前幾層，網址只留檔名（Chrome 與 Firefox 的寫法）', () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'cell')")
    e.stack = [
      "TypeError: Cannot read properties of undefined (reading 'cell')",
      '    at Xe (https://example.github.io/ElondiaRPG/assets/index-AbC123.js:12:3456)',
      '    at https://example.github.io/ElondiaRPG/assets/index-AbC123.js:40:12',
      'foo@http://localhost:4180/src/engine/story.ts?t=123:88:9',
      ...Array.from({ length: 12 }, (_, i) => `    at f${i} (https://x.io/assets/a.js:1:${i})`),
    ].join('\n')
    const f = stackFrames(e)
    expect(f).toHaveLength(8)
    expect(f[0]).toBe('at Xe (assets/index-AbC123.js:12:3456)')
    expect(f[1]).toBe('at assets/index-AbC123.js:40:12')
    expect(f[2]).toBe('foo@src/engine/story.ts:88:9')
  })

  it('摘要是原本的訊息，細節有版本、當時、位置與出錯的地方', () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'cell')")
    e.stack = "TypeError: x\n    at Xe (https://h/assets/index-1.js:1:2)"
    const { summary, detail } = splitError(programErrorText(e, { version: '0.6.8', doing: '遊戲動作', where: 'rivervale・河谷鎮（rivervale，settlement）・3,4' }))
    expect(summary).toBe("Cannot read properties of undefined (reading 'cell')")
    expect(detail).toContain('版本：0.6.8')
    expect(detail).toContain('當時：遊戲動作')
    expect(detail).toContain('位置：rivervale')
    expect(detail).toContain('at Xe (assets/index-1.js:1:2)')
    expect(detail).toContain('複製訊息')
  })
})
