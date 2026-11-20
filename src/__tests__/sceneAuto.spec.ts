import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Report } from '@/engine/types'
import ReportCard from '@/components/ReportCard.vue'
import { useGame } from '@/stores/game'
import { useImageSettings } from '@/stores/image'
import { sceneKey, useScenes } from '@/stores/scenes'
import { paragraphAnchor } from '@/narrator/paragraphs'
import { useSettings } from '@/stores/settings'

// 日誌插圖的自動生成：正文第一次寫完時才畫，沒有正文、重寫、沒設定好都不畫
vi.mock('@/narrator/providers', () => ({
  // 整理分鏡一律失敗：只看有沒有開始畫，不真的送出
  completeText: vi.fn(async () => { throw new Error('測試不送出') }),
  streamNarration: vi.fn(async function* () { yield '溶洞裡的水聲忽然停了。' }),
}))

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

function setup(auto: 'off' | 'adult' | 'all', opts: { imageReady?: boolean } = {}) {
  // 上一次 setup 的設定會存進 localStorage，先清掉
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettings()
  settings.sources[0]!.configs.anthropic = { apiKey: 'x', model: 'claude-opus-5-5' }
  const image = useImageSettings()
  image.service = 'openai'
  if (opts.imageReady !== false) image.configs.openai.apiKey = 'sk-test'
  image.sceneAuto = auto
  const game = useGame()
  game.start('艾倫', 'human', 'fighter')
  const report: Report = {
    schema_version: '0.1', report_id: 'r-scene-1', kind: 'event',
    time: { start: { ...game.state!.time }, end: { ...game.state!.time } },
    location: { at: game.state!.location }, party: [], outcome: { result: 'success', summary: '事件' }, changes: {},
  }
  game.state!.reports.push(report)
  return { game, scenes: useScenes(), image, report, key: sceneKey(game.state!, report.report_id) }
}

describe('scene auto-generation', () => {
  beforeEach(() => localStorage.clear())

  it('is off by default and keeps the saved choice', () => {
    setActivePinia(createPinia())
    expect(useImageSettings().sceneAuto).toBe('off')
    localStorage.setItem('elondia.image', JSON.stringify({ sceneAuto: 'adult' }))
    setActivePinia(createPinia())
    expect(useImageSettings().sceneAuto).toBe('adult')
    localStorage.setItem('elondia.image', JSON.stringify({ sceneAuto: 'sometimes' }))
    setActivePinia(createPinia())
    expect(useImageSettings().sceneAuto).toBe('off')
  })

  it('draws after the first narration, not when it is off or the narration is rewritten', async () => {
    let t = setup('off')
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()

    t = setup('all')
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]?.error).toContain('測試不送出')
    // 重寫經過：不自動重畫
    t.scenes.clearError(t.key)
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()
  })

  it('skips logs without narration, non-adult logs in adult mode, and unready services', async () => {
    const providers = await import('@/narrator/providers')
    let t = setup('all')
    vi.mocked(providers.streamNarration).mockImplementationOnce(async function* () { yield '  ' })
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()

    t = setup('adult')
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()
    // 成人場景：ChatGPT 畫不出來，沒指定成人場景用的服務時不畫
    t.report.narration = { adult_scene: '共度一夜' }
    delete t.game.narrations[t.report.report_id]
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()

    t = setup('all', { imageReady: false })
    await t.game.narrate(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]).toBeUndefined()
  })

  it('draws one more image for the continued paragraphs, keeping the old ones', async () => {
    const t = setup('all')
    t.game.narrations[t.report.report_id] = { text: '你推開酒館的門。', status: 'done' }
    // 原本第一段之後有一張插圖
    await t.scenes.scan(t.game.state!.seed)
    t.scenes.urls[`${t.key}#1`] = 'blob:old'
    t.scenes.spots[`${t.key}#1`] = { after: 0, anchor: paragraphAnchor('你推開酒館的門。') }
    useSettings().aiNarration = true
    await t.game.continueNarration(t.report)
    await flush()
    expect(t.game.narrations[t.report.report_id]!.text).toContain('溶洞裡的水聲忽然停了。')
    // 開始畫續寫的那一張（測試裡整理分鏡一律失敗），原本的插圖沒有被換掉
    expect(t.scenes.jobs[t.key]?.error).toContain('測試不送出')
    expect(t.scenes.urls[`${t.key}#1`]).toBe('blob:old')

    // 最後一段已經有圖：不再畫
    t.scenes.clearError(t.key)
    t.scenes.urls[`${t.key}#2`] = 'blob:new'
    t.scenes.spots[`${t.key}#2`] = { after: 1, anchor: paragraphAnchor('溶洞裡的水聲忽然停了。') }
    await t.scenes.autoContinued(t.game.state!, t.report)
    expect(t.scenes.jobs[t.key]).toBeUndefined()
  })

  it('draws only the continued paragraphs when the log has no image yet', async () => {
    const providers = await import('@/narrator/providers')
    const t = setup('all')
    t.game.narrations[t.report.report_id] = { text: '你推開酒館的門。', status: 'done' }
    useSettings().aiNarration = true
    vi.mocked(providers.completeText).mockClear()
    await t.game.continueNarration(t.report)
    await flush()
    expect(t.scenes.jobs[t.key]?.error).toContain('測試不送出')
    // 手動分段：只畫最後一段之後，告訴 AI 從第 2 段（續寫）開始
    const prompt = vi.mocked(providers.completeText).mock.calls.at(-1)![2] as { system: string }
    expect(prompt.system).toContain('第 2 段之後')
    expect(prompt.system).toContain('最有代表性的瞬間。第 2 段起是這次續寫的段落')
  })

  it('does not draw when the continuation is stopped (the OpenAI stream ends without an error)', async () => {
    const providers = await import('@/narrator/providers')
    const t = setup('all')
    t.game.narrations[t.report.report_id] = { text: '你推開酒館的門。', status: 'done' }
    useSettings().aiNarration = true
    vi.mocked(providers.streamNarration).mockImplementationOnce(async function* () {
      yield '溶洞裡的水聲'
      useGame().cancelNarration(t.report.report_id)
    })
    await t.game.continueNarration(t.report)
    await flush()
    expect(t.game.narrations[t.report.report_id]!.text).toContain('溶洞裡的水聲')
    expect(t.scenes.jobs[t.key]).toBeUndefined()
  })

  it('does not draw after continuing when auto-generation is off', async () => {
    const t = setup('off')
    t.game.narrations[t.report.report_id] = { text: '你推開酒館的門。', status: 'done' }
    useSettings().aiNarration = true
    await t.game.continueNarration(t.report)
    await flush()
    expect(t.game.narrations[t.report.report_id]!.text).toContain('溶洞裡的水聲忽然停了。')
    expect(t.scenes.jobs[t.key]).toBeUndefined()
  })

  it('puts the rewrite and illustrate buttons under the log instead of the ⋯ menu', () => {
    const t = setup('off')
    t.game.narrations[t.report.report_id] = { text: '溶洞裡的水聲忽然停了。', status: 'done' }
    useSettings().aiNarration = true
    const wrapper = mount(ReportCard, { props: { report: t.report } })
    const tools = wrapper.findAll('.tools button').map((b) => b.attributes('aria-label'))
    // 最新一則有經過的日誌另外有「續寫」
    expect(tools).toEqual(['重新寫出經過', '玩家的行動與要求', '記下性經歷', '續寫', '生成插圖', '手動分段插圖'])
    expect(wrapper.find('.menu-list').text()).not.toContain('插圖')
    expect(wrapper.find('.menu-list').text()).not.toContain('經過')
  })
})
