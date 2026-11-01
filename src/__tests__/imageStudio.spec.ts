import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildWorkflow, newPreset, type ComfyPreset } from '@/narrator/comfy'
import { IMAGE_SERVICES, type ImageServiceConfig, type ImageServiceId } from '@/narrator/imageInfo'
import { novelAIBody, openAIEditForm, renderImage } from '@/narrator/imageProviders'
import { composeScene, parseScenePlan, sceneCast, scenePrompt } from '@/narrator/sceneInfo'
import { enterLocation } from '@/engine/grid'
import { newGame } from '@/engine/state'
import { useImageSettings } from '@/stores/image'
import { builtinPortrait, currentPortraitBlob, MAX_VERSIONS, portraitKey, usePortraits } from '@/stores/portraits'

// 縮放底圖要用瀏覽器的 canvas：測試裡原樣回傳
vi.mock('@/narrator/imageUtils', async (orig) => ({
  ...(await orig<typeof import('@/narrator/imageUtils')>()),
  fitImage: async (b: Blob) => b,
  fitMask: async (b: Blob) => b,
}))

// fake-indexeddb 用 Node 的 structuredClone：happy-dom 的 Blob 存進去會變成普通物件，改用 Node 的 Blob
globalThis.Blob = NodeBlob as unknown as typeof Blob
// happy-dom 的 FormData 不收 Node 的 Blob：換成只記下欄位的版本（fetch 都是假的）
class TestFormData {
  private fields: [string, unknown][] = []
  append(k: string, v: unknown) { this.fields.push([k, v]) }
  get(k: string) { return this.fields.find(([x]) => x === k)?.[1] ?? null }
  getAll(k: string) { return this.fields.filter(([x]) => x === k).map(([, v]) => v) }
}
globalThis.FormData = TestFormData as unknown as typeof FormData

const cfg = (id: ImageServiceId, patch: Partial<ImageServiceConfig> = {}): ImageServiceConfig =>
  ({ apiKey: 'k', ...IMAGE_SERVICES.find((s) => s.id === id)!.defaults, ...patch })
const ck = (patch: Partial<ComfyPreset> = {}): ComfyPreset => ({ ...newPreset('c', 'SDXL'), checkpoint: 'x.safetensors', ...patch })
type Wf = Record<string, { class_type: string; inputs: Record<string, unknown> }>
const nodes = (wf: Wf, cls: string) => Object.values(wf).filter((n) => n.class_type === cls)

function game() {
  const state = newGame({ name: '艾倫', race: 'elf', classId: 'ranger', seed: 21, gender: '女性', appearance: '銀色長髮，綠色眼睛' } as never)
  enterLocation(state)
  return state
}

describe('img2img requests', () => {
  it('builds a ComfyUI img2img workflow from built-in nodes, with an optional mask', () => {
    const plain = buildWorkflow(ck({ hires: { on: true, scale: 1.5, method: 'bicubic', steps: 10, cfg: 5, denoise: 0.5 } }), { prompt: 'p', seed: 1 }) as Wf
    expect(nodes(plain, 'EmptyLatentImage')).toHaveLength(1)
    expect(nodes(plain, 'KSampler')).toHaveLength(2)

    const wf = buildWorkflow(ck({ hires: { on: true, scale: 1.5, method: 'bicubic', steps: 10, cfg: 5, denoise: 0.5 } }), { prompt: 'p', seed: 1, image: 'base.png', denoise: 0.4 }) as Wf
    expect(nodes(wf, 'EmptyLatentImage')).toHaveLength(0)
    expect(nodes(wf, 'LoadImage')[0]!.inputs.image).toBe('base.png')
    expect(nodes(wf, 'VAEEncode')).toHaveLength(1)
    // 以圖生圖不做高解析修復
    expect(nodes(wf, 'KSampler')).toHaveLength(1)
    expect(nodes(wf, 'KSampler')[0]!.inputs.denoise).toBe(0.4)

    const masked = buildWorkflow(ck(), { prompt: 'p', seed: 1, image: 'base.png', mask: 'mask.png', denoise: 0.6 }) as Wf
    expect(nodes(masked, 'LoadImageMask')[0]!.inputs).toMatchObject({ image: 'mask.png', channel: 'red' })
    const noise = nodes(masked, 'SetLatentNoiseMask')
    expect(noise).toHaveLength(1)
    const sampler = nodes(masked, 'KSampler')[0]!
    expect((sampler.inputs.latent_image as [string, number])[0]).toBe(Object.entries(masked).find(([, n]) => n === noise[0])![0])

    // 場景插圖用橫的尺寸
    const wide = buildWorkflow(ck(), { prompt: 'p', seed: 1, width: 1216, height: 832 }) as Wf
    expect(nodes(wide, 'EmptyLatentImage')[0]!.inputs).toMatchObject({ width: 1216, height: 832 })
  })

  it('needs %image% in a custom workflow and fills the img2img placeholders', () => {
    const plain = ck({ mode: 'custom', workflow: '{"1":{"class_type":"X","inputs":{"t":"%prompt%"}}}' })
    expect(() => buildWorkflow(plain, { prompt: 'p', seed: 1, image: 'a.png' })).toThrow('%image%')
    const custom = ck({ mode: 'custom', workflow: '{"1":{"class_type":"LoadImage","inputs":{"image":"%image%"}},"2":{"class_type":"KSampler","inputs":{"denoise":"%denoise%"}}}' })
    const wf = buildWorkflow(custom, { prompt: 'p', seed: 1, image: 'a.png', denoise: 0.3 }) as Wf
    expect(wf['1']!.inputs.image).toBe('a.png')
    expect(wf['2']!.inputs.denoise).toBe(0.3)
    expect(() => buildWorkflow(custom, { prompt: 'p', seed: 1, image: 'a.png', mask: 'm.png' })).toThrow('%mask%')
    // 一般生圖時 %denoise% 是 1
    expect((buildWorkflow(custom, { prompt: 'p', seed: 1 }) as Wf)['2']!.inputs.denoise).toBe(1)
  })

  it('asks NovelAI for img2img, infill with the inpainting model, and per-character prompts', () => {
    const init = { image: new Blob(['x']), strength: 0.45 }
    const i2i = novelAIBody(cfg('novelai'), { prompt: '1girl', seed: 5, init }, { image: 'BASE' }) as { action: string; model: string; parameters: Record<string, unknown> }
    expect(i2i.action).toBe('img2img')
    expect(i2i.model).toBe('nai-diffusion-4-5-full')
    expect(i2i.parameters).toMatchObject({ image: 'BASE', strength: 0.45, extra_noise_seed: 5 })
    const infill = novelAIBody(cfg('novelai'), { prompt: '1girl', seed: 5, init }, { image: 'BASE', mask: 'MASK' }) as typeof i2i
    expect(infill.action).toBe('infill')
    expect(infill.model).toBe('nai-diffusion-4-5-full-inpainting')
    expect(infill.parameters).toMatchObject({ mask: 'MASK', add_original_image: true })

    const scene = novelAIBody(cfg('novelai'), { prompt: '2girls, forest', seed: 1, width: 1216, height: 832, characters: [{ prompt: 'girl, red hair', x: 0.3, y: 0.5 }, { prompt: 'girl, black hair', x: 0.7, y: 0.5 }] }) as typeof i2i
    expect(scene.action).toBe('generate')
    expect(scene.parameters).toMatchObject({ width: 1216, height: 832 })
    const v4 = scene.parameters.v4_prompt as { caption: { char_captions: { char_caption: string; centers: { x: number }[] }[] }; use_coords: boolean }
    expect(v4.use_coords).toBe(true)
    expect(v4.caption.char_captions.map((c) => [c.char_caption, c.centers[0]!.x])).toEqual([['girl, red hair', 0.3], ['girl, black hair', 0.7]])
    expect((scene.parameters.v4_negative_prompt as { caption: { char_captions: unknown[] } }).caption.char_captions).toHaveLength(2)

    // V5 也用 v4_prompt 的格式（沒有時 NovelAI 回 500）；V3 以前的不帶
    const v5 = novelAIBody({ ...cfg('novelai'), model: 'nai-diffusion-5-full' }, { prompt: '1girl', seed: 1 }) as typeof i2i
    expect(v5.parameters.v4_prompt).toBeTruthy()
    const v3 = novelAIBody({ ...cfg('novelai'), model: 'nai-diffusion-3' }, { prompt: '1girl', seed: 1 }) as typeof i2i
    expect(v3.parameters.v4_prompt).toBeUndefined()
  })

  it('sends OpenAI edits as multipart with the base, references and mask', async () => {
    const one = openAIEditForm(cfg('openai'), { prompt: 'smile', init: { image: new Blob(['a']), strength: 0.5 } })
    expect(one.get('prompt')).toBe('smile')
    expect(one.get('size')).toBe('1024x1536')
    expect(one.getAll('image')).toHaveLength(1)
    const many = openAIEditForm(cfg('openai'), { prompt: 'scene', width: 1536, height: 1024, references: [new Blob(['a']), new Blob(['b'])] }, new Blob(['m']))
    expect(many.getAll('image[]')).toHaveLength(2)
    expect(many.get('size')).toBe('1536x1024')
    expect(many.get('mask')).toBeTruthy()

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: btoa('PNG!') }] })))
    const out = await renderImage('openai', cfg('openai'), { prompt: 'x', references: [new Blob(['a'])] })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.openai.com/v1/images/edits')
    expect(out.seed).toBeUndefined()
    fetchMock.mockRestore()
  })

  it('remembers the seed it used', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    const out = await renderImage('novelai', cfg('novelai'), { prompt: 'x', seed: 42 })
    expect(out.seed).toBe(42)
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as { parameters: { seed: number } }
    expect(body.parameters.seed).toBe(42)
    expect((await renderImage('novelai', cfg('novelai'), { prompt: 'x' })).seed).toEqual(expect.any(Number))
    fetchMock.mockRestore()
  })
})

describe('log illustrations', () => {
  it('lists who can appear and asks for a plan in the service format', () => {
    const state = game()
    const report = state.reports.at(-1) ?? {
      schema_version: '0.1', report_id: 'r1', kind: 'event', time: { start: { day: 1, hour: 20 }, end: { day: 1, hour: 20 } },
      location: { at: state.location }, party: [{ id: state.party[0]!.id, name: state.party[0]!.name }], outcome: { result: 'neutral', summary: '在營火旁休息' }, changes: {},
    }
    const cast = sceneCast(state, report as never)
    expect(cast[0]).toMatchObject({ name: '艾倫', player: true })
    expect(cast[0]!.description).toContain('銀色長髮')
    const image = (setActivePinia(createPinia()), useImageSettings())
    const p = scenePrompt(state, report as never, cast, { format: image.preprocessorFor('novelai'), multi: true })
    expect(p.system).toContain('Danbooru')
    expect(p.system).toContain('rating 一律 general')
    expect(p.user).toContain(cast[0]!.id)
  })

  it('reads the plan: drops unknown people, spreads two on one side, caps the rating', () => {
    const cast = [{ id: 'pc', name: '艾倫', player: true, description: '' }, { id: 'n1', name: '賈爾薩', player: false, description: '' }]
    const raw = { rating: 'explicit', scene: '2girls, forest', characters: [{ id: 'pc', position: 'left', prompt: 'girl, silver hair' }, { id: 'ghost', prompt: 'x' }, { id: '賈爾薩', position: 'left', prompt: 'girl, red hair' }] }
    const plan = parseScenePlan(raw, cast, false)
    expect(plan.rating).toBe('general')
    expect(plan.characters.map((c) => [c.id, c.position])).toEqual([['pc', 'left'], ['n1', 'right']])
    expect(parseScenePlan(raw, cast, true).rating).toBe('explicit')
    expect(() => parseScenePlan({ characters: [] }, cast, true)).toThrow('scene')

    const nai = composeScene(plan, 'novelai', true)
    expect(nai.prompt).toBe('2girls, forest')
    expect(nai.characters?.map((c) => c.x)).toEqual([0.3, 0.7])
    expect(composeScene(plan, 'comfyui', true).prompt).toBe('2girls, forest, girl, silver hair, girl, red hair')
    expect(composeScene(plan, 'openai', false).prompt).toContain('on the right: girl, red hair')
  })
})

describe('portrait versions', () => {
  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    await usePortraits().pruneExcept(new Set())
  })
  afterEach(() => vi.restoreAllMocks())

  function openai() {
    const image = useImageSettings()
    image.service = 'openai'
    image.configs.openai.apiKey = 'k'
    let n = 0
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: btoa(`IMG${++n}`) }] })))
  }

  it('keeps every generation as a version, at most the limit, never dropping the current one', async () => {
    openai()
    const state = game()
    const id = state.party[0]!.id
    const key = portraitKey(state, id)
    const portraits = usePortraits()
    await portraits.generate(state, id)
    const first = portraits.records[key]!.time
    // 進階的生成不換掉目前的圖
    for (let i = 0; i < MAX_VERSIONS + 2; i++) {
      await new Promise((r) => setTimeout(r, 2))
      await portraits.studioGenerate(key, { prompt: `p${i}` })
    }
    const list = await portraits.loadVersions(key)
    expect(list).toHaveLength(MAX_VERSIONS)
    expect(portraits.records[key]!.time).toBe(first)
    expect(list.some((v) => v.time === first)).toBe(true)
    expect(list.at(-1)!.prompt).toBe(`p${MAX_VERSIONS + 1}`)
    expect(list.at(-1)!.from).toBe('studio')
    // 換成某一版；目前的那版不能刪
    await portraits.useVersion(key, list.at(-1)!.vkey)
    expect(portraits.records[key]!.prompt).toBe(`p${MAX_VERSIONS + 1}`)
    await expect(portraits.removeVersion(key, list.at(-1)!.vkey)).rejects.toThrow('目前的形象圖')
    // 匯出只帶目前的圖
    expect(Object.keys(await portraits.exportFor(state.seed))).toEqual([id])
    expect(await portraits.countFor(state.seed)).toBe(1)
  })

  it('tweaks the current portrait as an edit and remembers an edited description', async () => {
    const fetchMock = openai()
    const state = game()
    const id = state.party[0]!.id
    const key = portraitKey(state, id)
    const portraits = usePortraits()
    await portraits.generate(state, id)
    await portraits.tweak(state, id, 'smile')
    expect(portraits.jobs[key]).toBeUndefined()
    const last = fetchMock.mock.calls.at(-1)!
    expect(last[0]).toBe('https://api.openai.com/v1/images/edits')
    expect(String((last[1]!.body as FormData).get('prompt'))).toContain('smile')
    expect(portraits.records[key]).toMatchObject({ from: 'tweak', note: '微笑' })
    expect(await portraits.loadVersions(key)).toHaveLength(2)

    await portraits.setDescription(key, '只畫一個戴面具的弓箭手')
    expect(portraits.describe(state, id)).toBe('只畫一個戴面具的弓箭手')
    await portraits.setDescription(key, null)
    expect(portraits.describe(state, id)).toContain('艾倫')
  })

  it('shows a fixed NPC\'s built-in portrait until the player has their own, and tweaks from it', async () => {
    const fetchMock = openai()
    const state = game()
    const id = 'npc_ren'
    const key = portraitKey(state, id)
    const portraits = usePortraits()
    const builtin = builtinPortrait(id)!
    expect(builtin).toMatch(/npc_ren.*\.webp/)
    await portraits.load(key)
    expect(portraits.urls[key]).toBe(builtin)
    expect(portraits.records[key]).toBeUndefined()
    // 生成的人沒有內建圖
    await portraits.load(portraitKey(state, state.party[0]!.id))
    expect(portraits.urls[portraitKey(state, state.party[0]!.id)]).toBeNull()
    expect(await currentPortraitBlob(key)).toBeDefined()
    // 微調：以內建圖為底，成為自己的第一版
    await portraits.tweak(state, id, 'smile')
    expect(portraits.jobs[key]).toBeUndefined()
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === builtin)).toBe(true)
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://api.openai.com/v1/images/edits')
    expect(portraits.records[key]).toMatchObject({ from: 'tweak' })
    expect(portraits.urls[key]).toMatch(/^blob:/)
    // 刪掉自己的圖：換回內建圖；內建圖不跟著存檔匯出
    await portraits.remove(key)
    expect(portraits.urls[key]).toBe(builtin)
    expect(Object.keys(await portraits.exportFor(state.seed))).not.toContain(id)
  })
})
