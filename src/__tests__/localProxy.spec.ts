import { describe, expect, it } from 'vitest'
import { onLocalhost, proxiedURL } from '@/narrator/localProxy'

describe('local relay (本機版轉送)', () => {
  it('rewrites a service URL to go through the launcher', () => {
    const o = 'http://localhost:8473'
    expect(proxiedURL('https://revnovel.org/v1', o)).toBe('http://localhost:8473/proxy/https/revnovel.org/v1')
    expect(proxiedURL('https://revnovel.org/v1/', o)).toBe('http://localhost:8473/proxy/https/revnovel.org/v1')
    expect(proxiedURL('http://127.0.0.1:8011/v1', o)).toBe('http://localhost:8473/proxy/http/127.0.0.1:8011/v1')
    expect(proxiedURL('https://api.example.com/v1?x=1', o)).toBe('http://localhost:8473/proxy/https/api.example.com/v1?x=1')
    // 格式不對的照原樣（交給連線錯誤的說明處理）
    expect(proxiedURL('revnovel.org/v1', o)).toBe('revnovel.org/v1')
  })

  it('only counts as local when the game itself is opened from this computer', () => {
    expect(onLocalhost({ hostname: 'localhost' })).toBe(true)
    expect(onLocalhost({ hostname: '127.0.0.1' })).toBe(true)
    expect(onLocalhost({ hostname: 'yellow630914.github.io' })).toBe(false)
  })
})
