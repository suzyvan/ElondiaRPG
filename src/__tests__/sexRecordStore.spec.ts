// 性經歷：親密場景寫完經過之後另外請 AI 記下（stores/game.ts 的 recordSex；docs/LEWD_STATS.md 第 29 節）
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { addHours, commitReport } from '@/engine/state'
import type { GameState, Report } from '@/engine/types'

let reply = '{"records":[]}'
let story = ['兩人在旅店的房間裡度過了第一夜。']
vi.mock('@/narrator/providers', () => ({
  completeText: vi.fn(async () => reply),
  streamNarration: vi.fn(async function* () {
    for (const chunk of story) yield chunk
  }),
}))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  reply = '{"records":[]}'
  story = ['兩人在旅店的房間裡度過了第一夜。']
})

function scene(state: GameState, adult = '在旅店的房間裡共度一夜'): Report {
  return commitReport(state, {
    schema_version: '0.1', report_id: `r-test-${state.nextReportNo++}`, kind: 'event',
    time: { start: { ...state.time }, end: addHours(state.time, 1) },
    location: { at: state.location }, party: [{ id: 'pc', name: '艾倫' }], others: [{ id: 'npc_lina', name: '莉娜' }],
    outcome: { result: 'success', summary: '和莉娜過夜' }, changes: {}, narration: { adult_scene: adult },
  })
}

async function setup() {
  const { useSettings } = await import('@/stores/settings')
  const { useGame } = await import('@/stores/game')
  const providers = await import('@/narrator/providers')
  const settings = useSettings()
  settings.sources[0]!.configs.anthropic = { apiKey: 'x', model: 'claude-opus-5-5' }
  const g = useGame()
  g.start('艾倫', 'human', 'fighter')
  vi.mocked(providers.completeText).mockClear()
  return { g, settings, providers }
}

describe('record sex after an intimate scene', () => {
  it('writes the narration first, then sends it to the sexlog source and applies the records once', async () => {
    const { g, providers } = await setup()
    const { sexRecordOf, sexLogged } = await import('@/engine/sexRecord')
    const r = scene(g.state!)
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜","first_time":"和莉娜，在旅店"}]}'
    await g.narrate(r)
    await vi.waitFor(() => expect(sexLogged(g.state!, r.report_id)).toBe(true))
    const prompt = vi.mocked(providers.completeText).mock.calls.at(-1)![2] as { system: string; user: string }
    expect(prompt.user).toContain('兩人在旅店的房間裡度過了第一夜。')
    expect(sexRecordOf(g.state!, 'pc')).toMatchObject({ virgin: false, partners: 1, times: 1, first: { with: '莉娜' } })
    // 重寫經過：已經記過，不再呼叫
    const calls = vi.mocked(providers.completeText).mock.calls.length
    await g.narrate(r)
    await g.recordSex(r, undefined, { manual: true })
    expect(vi.mocked(providers.completeText).mock.calls.length).toBe(calls)
    expect(sexRecordOf(g.state!, 'pc').times).toBe(1)
  })

  it('does nothing when switched off (unless asked by hand), or for scenes that are only teasing', async () => {
    const { g, settings, providers } = await setup()
    const { sexLogged } = await import('@/engine/sexRecord')
    settings.sexRecordAi = false
    const r = scene(g.state!)
    await g.recordSex(r, '……')
    expect(providers.completeText).not.toHaveBeenCalled()
    await g.recordSex(r, '……', { manual: true })
    expect(sexLogged(g.state!, r.report_id)).toBe(true)
    settings.sexRecordAi = true
    const t = scene(g.state!, '挑逗')
    t.narration!.tease = '挑逗'
    vi.mocked(providers.completeText).mockClear()
    await g.recordSex(t, '……')
    expect(providers.completeText).not.toHaveBeenCalled()
  })

  it('gives up after the judge timeout with no reply, so the heart can be pressed again', async () => {
    const { g, settings, providers } = await setup()
    const { sexLogged } = await import('@/engine/sexRecord')
    settings.judgeTimeoutMin = 1
    // 模型一直不回應：只在被中斷時結束
    vi.mocked(providers.completeText).mockImplementationOnce((_p, _c, _prompt, signal) => new Promise((_, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const r = scene(g.state!)
    vi.useFakeTimers()
    try {
      const done = g.recordSex(r, '……', { manual: true })
      await vi.waitFor(() => expect(g.recordingSex.has(r.report_id)).toBe(true))
      await vi.advanceTimersByTimeAsync(60_000)
      await done
    } finally {
      vi.useRealTimers()
    }
    expect(g.recordingSex.has(r.report_id)).toBe(false)
    expect(sexLogged(g.state!, r.report_id)).toBe(false)
    expect(g.error).toContain('記下性經歷逾時')
  })

  it('a report without adult_scene: the writer flags the scene, the tag is removed and the record is made', async () => {
    const { g, providers } = await setup()
    const { sexLogged, intimateReport } = await import('@/engine/sexRecord')
    const r = commitReport(g.state!, {
      schema_version: '0.1', report_id: `r-test-${g.state!.nextReportNo++}`, kind: 'rest',
      time: { start: { ...g.state!.time }, end: addHours(g.state!.time, 8) },
      location: { at: g.state!.location }, party: [{ id: 'pc', name: '艾倫' }], others: [{ id: 'npc_lina', name: '莉娜' }],
      outcome: { result: 'success', summary: '長休' }, changes: {},
    })
    story = ['夜裡，莉娜鑽進了你的被窩。', '\n<intimate_scene>艾倫與莉娜在營地發生關係</intimate_scene>']
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"營地的一夜"}]}'
    await g.narrate(r)
    // 寫經過的要求帶著標記的說明
    const sent = vi.mocked(providers.streamNarration).mock.calls.at(-1)![2] as { user: string }
    expect(sent.user).toContain('<intimate_scene>')
    expect(g.narrations[r.report_id]!.text).toBe('夜裡，莉娜鑽進了你的被窩。')
    const saved = g.state!.reports.find((x) => x.report_id === r.report_id)!
    expect(saved.narration?.intimate_note).toBe('艾倫與莉娜在營地發生關係')
    expect(intimateReport(saved)).toBe(true)
    await vi.waitFor(() => expect(sexLogged(g.state!, r.report_id)).toBe(true))
  })

  it('a report the writer did not flag is not recorded automatically, but the heart still works on it', async () => {
    const { g, providers } = await setup()
    const { sexLogged } = await import('@/engine/sexRecord')
    const r = commitReport(g.state!, {
      schema_version: '0.1', report_id: `r-test-${g.state!.nextReportNo++}`, kind: 'rest',
      time: { start: { ...g.state!.time }, end: addHours(g.state!.time, 8) },
      location: { at: g.state!.location }, party: [{ id: 'pc', name: '艾倫' }], outcome: { result: 'success', summary: '長休' }, changes: {},
    })
    story = ['一夜無事。']
    await g.narrate(r)
    expect(providers.completeText).not.toHaveBeenCalled()
    await g.recordSex(r, undefined, { manual: true })
    expect(providers.completeText).toHaveBeenCalledTimes(1)
    expect(sexLogged(g.state!, r.report_id)).toBe(true)
  })

  it('records again on request, replacing what this log added instead of adding twice', async () => {
    const { g, providers } = await setup()
    const { sexRecordOf, canRerecord, sexRecordToast } = await import('@/engine/sexRecord')
    const r = scene(g.state!)
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜","first_time":"和莉娜，在旅店"}]}'
    await g.narrate(r)
    await vi.waitFor(() => expect(sexRecordOf(g.state!, 'pc').times).toBe(1))
    expect(canRerecord(g.state!, r.report_id)).toBe(true)
    expect(sexRecordToast(g.state!, g.state!.sexLedger![r.report_id]!)).toBe('📒 記下性經歷：艾倫：性交 1 次（新對象 1 人）、初體驗')
    const logged = () => g.state!.reports.find((x) => x.report_id === r.report_id)!.sex_log
    expect(logged()).toEqual(['艾倫：性交 1 次（新對象 1 人）、初體驗'])
    // 續寫之後重記：兩次，一樣是初體驗、一樣只算莉娜一個人
    reply = '{"records":[{"id":"pc","sex":2,"service":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜，天亮前又一次","first_time":"和莉娜，在旅店"}]}'
    await g.recordSex(r, '兩人在旅店的房間裡度過了第一夜。天亮前又纏在一起。', { manual: true, rerecord: true })
    const rec = sexRecordOf(g.state!, 'pc')
    expect(rec).toMatchObject({ virgin: false, partners: 1, times: 2, serviceTimes: 1, first: { with: '莉娜' } })
    expect(rec.recent.filter((x) => x.report === r.report_id)).toHaveLength(1)
    expect(logged()).toEqual(['艾倫：性交 2 次（新對象 1 人）、性侍奉 1 次、初體驗'])
    expect(vi.mocked(providers.completeText).mock.calls.at(-1)![2]).toMatchObject({ user: expect.stringContaining('天亮前又纏在一起') })
    // 重記成「沒有發生」：拿掉這則記的，回到處子
    reply = '{"records":[]}'
    await g.recordSex(r, '……', { manual: true, rerecord: true })
    expect(sexRecordOf(g.state!, 'pc')).toMatchObject({ virgin: true, partners: 0, times: 0, serviceTimes: 0 })
    expect(sexRecordOf(g.state!, 'pc').first).toBeUndefined()
    expect(logged()).toEqual([])
    expect(canRerecord(g.state!, r.report_id)).toBe(true)
  })

  it('keeps the old record when the AI fails, and does not re-record old logs without a ledger', async () => {
    const { g, providers } = await setup()
    const { sexRecordOf, canRerecord, markSexLogged } = await import('@/engine/sexRecord')
    const r = scene(g.state!)
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜"}]}'
    await g.recordSex(r, '……', { manual: true })
    expect(sexRecordOf(g.state!, 'pc').times).toBe(1)
    vi.mocked(providers.completeText).mockRejectedValueOnce(new Error('連線失敗'))
    await g.recordSex(r, '……', { manual: true, rerecord: true })
    expect(sexRecordOf(g.state!, 'pc').times).toBe(1)
    // 這次改版之前記過的日誌：沒有帳本，不能重記（會重複加）
    const old = scene(g.state!)
    markSexLogged(g.state!, old.report_id)
    expect(canRerecord(g.state!, old.report_id)).toBe(false)
    vi.mocked(providers.completeText).mockClear()
    await g.recordSex(old, '……', { manual: true, rerecord: true })
    expect(providers.completeText).not.toHaveBeenCalled()
  })

  it('re-recording an earlier log keeps what a later log also had: still not a virgin, partner still known, first time moves and comes back', async () => {
    const { g } = await setup()
    const { sexRecordOf } = await import('@/engine/sexRecord')
    const first = scene(g.state!)
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜"}]}'
    await g.recordSex(first, '……', { manual: true })
    const second = scene(g.state!)
    reply = '{"records":[{"id":"pc","sex":2,"service":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第二夜"}]}'
    await g.recordSex(second, '……', { manual: true })
    expect(sexRecordOf(g.state!, 'pc')).toMatchObject({ virgin: false, times: 3, partners: 1, first: { note: '第一夜' } })
    // 第一則重記成只有侍奉：第二則還有性交，不會變回處子；莉娜算第二則認識的
    reply = '{"records":[{"id":"pc","service":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"只用手"}]}'
    await g.recordSex(first, '……', { manual: true, rerecord: true })
    let rec = sexRecordOf(g.state!, 'pc')
    expect(rec).toMatchObject({ virgin: false, times: 2, partners: 1, known: ['npc_lina'], serviceTimes: 2, servicePartners: 1, first: { note: '第二夜' } })
    expect(rec.recent.map((x) => x.report)).toEqual([second.report_id, first.report_id])
    expect(g.state!.reports.find((r) => r.report_id === second.report_id)!.sex_log![0]).toContain('初體驗')
    // 再重記回有性交：初體驗與新對象挪回第一則
    reply = '{"records":[{"id":"pc","sex":1,"with":[{"name":"莉娜","id":"npc_lina"}],"summary":"第一夜"}]}'
    await g.recordSex(first, '……', { manual: true, rerecord: true })
    rec = sexRecordOf(g.state!, 'pc')
    expect(rec).toMatchObject({ virgin: false, times: 3, partners: 1, first: { note: '第一夜' } })
    expect(g.state!.sexLedger![first.report_id]![0]).toMatchObject({ first: true, partners: 1 })
    expect(g.state!.sexLedger![second.report_id]![0]).toMatchObject({ first: false, partners: 0 })
    expect(g.state!.reports.find((r) => r.report_id === second.report_id)!.sex_log![0]).not.toContain('初體驗')
  })

  it('keeps as many logged reports as the log keeps, so an old log never turns back into "record" and adds twice', async () => {
    const { g } = await setup()
    const { sexLogged, canRerecord } = await import('@/engine/sexRecord')
    const first = scene(g.state!)
    await g.recordSex(first, '……', { manual: true })
    for (let i = 0; i < 60; i++) await g.recordSex(scene(g.state!), '……', { manual: true })
    expect(sexLogged(g.state!, first.report_id)).toBe(true)
    expect(canRerecord(g.state!, first.report_id)).toBe(true)
  })
})
