import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { generateNpc, registerNpc } from '@/engine/npcs'
import { ensureRelationship } from '@/engine/social'
import { withRng } from '@/engine/state'
import type { GameState } from '@/engine/types'
import { useGame } from '@/stores/game'
import { useImageSettings } from '@/stores/image'

/** 認識一個新的人（人際關係多一筆） */
function meet(s: GameState): string {
  const rec = registerNpc(s, withRng(s, (rng) => generateNpc(s, rng, { level: 2, location: s.location, class: 'fighter' })))
  ensureRelationship(s, rec)
  return rec.id
}

describe('第一次產生關係時自動畫形象圖', () => {
  let fetchMock: MockInstance<typeof fetch>
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: btoa('PNG!') }] }), { status: 200 }))
  })
  afterEach(() => vi.restoreAllMocks())

  const imageCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('images')).length

  it('draws once for each newly met person when switched on, in a queue', async () => {
    const image = useImageSettings()
    image.service = 'openai'
    image.configs.openai.apiKey = 'k'
    image.portraitAuto = true
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    game.runAction((s) => { meet(s); meet(s) })
    await vi.waitFor(() => expect(imageCalls()).toBe(2))
    // 已經認識的人：再有互動也不會再畫
    game.runAction(() => {})
    await new Promise((r) => setTimeout(r, 50))
    expect(imageCalls()).toBe(2)
  })

  it('does nothing when switched off or when the image service is not set up', async () => {
    const image = useImageSettings()
    image.service = 'openai'
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    image.portraitAuto = true
    image.configs.openai.apiKey = ''
    game.runAction((s) => { meet(s) })
    image.configs.openai.apiKey = 'k'
    image.portraitAuto = false
    game.runAction((s) => { meet(s) })
    await new Promise((r) => setTimeout(r, 50))
    expect(imageCalls()).toBe(0)
  })
})
