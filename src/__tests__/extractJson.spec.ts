import { describe, expect, it } from 'vitest'
import { extractJson } from '@/narrator/judge'
import { joinError, splitError } from '@/narrator/errorText'

describe('reading JSON out of the AI reply', () => {
  it('accepts fenced blocks, surrounding text and think blocks', () => {
    expect(extractJson('好的：\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('<think>{x}</think>結果 {"news":[]} 完')).toEqual({ news: [] })
  })

  it('says what went wrong instead of a bare "no JSON"', () => {
    expect(() => extractJson('   ')).toThrow(/空白/)
    expect(() => extractJson('抱歉，我不能協助這個要求。')).toThrow(/沒照格式[\s\S]*抱歉/)
    expect(() => extractJson('{"news":[{"id":"a","day":3,"story":"她在酒館裡')).toThrow(/截斷/)
    expect(() => extractJson('{"news": [ {"id": "a",, } ]}')).toThrow(/格式不對/)
    // 都還是以「AI 沒有回傳 JSON」或「AI 回傳的 JSON」開頭，方便辨認
    expect(() => extractJson('')).toThrow('AI 沒有回傳 JSON')
  })

  it('puts a short summary on the first line and the details after it', () => {
    let msg = ''
    try {
      extractJson(`{"news":[{"id":"a","story":"${'很長的近況'.repeat(40)}`)
    } catch (e) {
      msg = (e as Error).message
    }
    const { summary, detail } = splitError(msg)
    expect(summary).toBe('AI 沒有回傳 JSON（回應被截斷）')
    expect(detail).toMatch(/開頭[\s\S]*結尾/)
  })
})

describe('splitting error messages for the toast', () => {
  it('uses the first line as the summary', () => {
    expect(splitError('連不上\n詳細的原因')).toEqual({ summary: '連不上', detail: '詳細的原因' })
  })
  it('keeps short messages whole', () => {
    expect(splitError('錢不夠')).toEqual({ summary: '錢不夠' })
  })
  it('cuts a long single-line message at its first sentence', () => {
    const long = '連線失敗：連不上 revnovel.org：確認網址正確、服務正常。也可能是這個服務不允許從瀏覽器直接連（CORS），請服務開啟 CORS，或改用本機版的轉送。'
    const p = splitError(long)
    expect(p.summary).toBe('連線失敗：連不上 revnovel.org：確認網址正確、服務正常')
    expect(p.detail).toBe(long)
  })
  it('joins back into one message', () => {
    expect(joinError('摘要', '細節')).toBe('摘要\n細節')
    expect(joinError('摘要')).toBe('摘要')
  })
})
