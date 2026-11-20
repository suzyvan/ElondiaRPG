// 日誌插圖：日誌底下的插圖按鈕一鍵完成，或在正文第一次寫完時自動生成（設定的「自動生成」）。
// 分段插圖：請「插圖提示詞預處理」的模型一次整理好幾張分鏡，每張插在正文的某一段之後 → 依分級選服務（成人場景可以另外指定）→ 依序生圖。
//   自動分段：交給 AI 挑段落，張數照設定（1 張／依長度／最多 N 張）；手動分段：玩家在對話框選位置，每個位置一張。
// 圖片和形象圖存在同一個 IndexedDB：分段插圖的 key 是 `種子:@scene:日誌id#n`，以前的整則插圖是 `種子:@scene:日誌id`（顯示在最後）。
// 每張記著插在第幾段之後與那一段開頭的字；正文重寫過、對不上的收到最後，標「舊的經過畫的」。匯出存檔時跟著形象圖一起帶。見 docs/PORTRAITS.md 第 7 節。

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GameState, Report } from '@/engine/types'
import type { SceneCharacter } from '@/narrator/imageProviders'
import { anchorMatches, narrationParagraphs, paragraphAnchor } from '@/narrator/paragraphs'
import {
  adultScene, autoSceneCount, composeScene, extractSceneJson, GIRL_SCENE_NEGATIVE, parseScenePlan, parseScenePlans, sceneCast, sceneHasGirls, sceneMulti, scenePrompt,
  type ScenePlan, type SceneSegments, type SegmentPlan,
} from '@/narrator/sceneInfo'
import { useGame } from './game'
import { useImageSettings } from './image'
import { currentPortraitBlob, idbDelete, idbGet, idbKeys, idbPut, portraitKey, usePortraits, type PortraitRecord } from './portraits'
import { useSettings } from './settings'
import type { ImageServiceId } from '@/narrator/imageInfo'

export interface SceneRecord extends PortraitRecord {
  plan?: ScenePlan
  /** 分段插圖：插在第幾段之後（從 0 起算）與那一段開頭的字（paragraphAnchor）；以前的整則插圖沒有 */
  after?: number
  anchor?: string
  /** NovelAI 的多角色提示（重畫這一張時照用） */
  characters?: SceneCharacter[]
  /** 有魔物娘登場：負面提示詞補上 GIRL_SCENE_NEGATIVE（重畫這一張時照用） */
  girls?: boolean
}

export interface SceneJob {
  stage: 'plan' | 'image' | 'error'
  error?: string
  /** stage 是 error 時：只是提醒（例如手動分段有位置沒畫出來），不是失敗 */
  notice?: boolean
  /** 生圖的進度：畫好幾張、共幾張 */
  done?: number
  total?: number
}

/** 一則日誌的插圖的 key（以前的整則插圖就是這個；分段插圖在後面加 #n） */
export const sceneKey = (state: Pick<GameState, 'seed'>, reportId: string) => `${state.seed}:@scene:${reportId}`
export const segmentKey = (state: Pick<GameState, 'seed'>, reportId: string, n: number) => `${sceneKey(state, reportId)}#${n}`

/** 插圖在正文裡的位置：inline[段落索引] 是插在那一段之後的插圖；tail 是放在最後的（以前的整則插圖、正文改過對不上的） */
export interface SceneLayout {
  inline: Record<number, string[]>
  tail: { key: string; stale: boolean }[]
}

export const useScenes = defineStore('scenes', () => {
  /** key → 圖片網址 */
  const urls = ref<Record<string, string>>({})
  const plans = ref<Record<string, ScenePlan | undefined>>({})
  /** key → 位置（分段插圖才有） */
  const spots = ref<Record<string, { after: number; anchor: string } | undefined>>({})
  /** 一則日誌的工作（key 是 sceneKey）與重畫單張（key 是那一張） */
  const jobs = ref<Record<string, SceneJob>>({})
  /** 已經查過有哪些插圖的局（種子；匯入存檔還原圖片後重新查） */
  let scanned = ''
  const controllers = new Map<string, AbortController>()

  function show(key: string, rec: SceneRecord | undefined) {
    if (urls.value[key]) URL.revokeObjectURL(urls.value[key]!)
    if (rec?.blob) {
      urls.value[key] = URL.createObjectURL(rec.blob)
      plans.value[key] = rec.plan
      spots.value[key] = rec.after !== undefined && rec.anchor !== undefined ? { after: rec.after, anchor: rec.anchor } : undefined
    } else {
      delete urls.value[key]
      delete plans.value[key]
      delete spots.value[key]
    }
  }

  /** 讀出這一局所有的日誌插圖（每一局只讀一次） */
  async function scan(seed: number) {
    const stamp = `${seed}#${usePortraits().imported}`
    if (scanned === stamp) return
    scanned = stamp
    for (const k of Object.keys(urls.value)) show(k, undefined)
    try {
      for (const key of (await idbKeys()).filter((k) => k.startsWith(`${seed}:@scene:`))) show(key, await idbGet<SceneRecord>(key))
    } catch {
      // 讀不到就當作沒有
    }
  }

  /** 這則日誌現有的插圖（以前的整則插圖在前，分段的照編號） */
  function keysOf(base: string): string[] {
    const n = (k: string) => (k === base ? 0 : Number(k.slice(base.length + 1)) || 0)
    return Object.keys(urls.value).filter((k) => k === base || k.startsWith(`${base}#`)).sort((a, b) => n(a) - n(b))
  }

  /** 插圖放在哪裡：對得上的插在那一段之後，其他的放最後（showInline 關掉時全部放最後，例如沒有顯示正文） */
  function layout(base: string, paragraphs: string[], showInline = true): SceneLayout {
    const out: SceneLayout = { inline: {}, tail: [] }
    for (const key of keysOf(base)) {
      const s = spots.value[key]
      if (!s) out.tail.push({ key, stale: false })
      else if (showInline && anchorMatches(paragraphs, s.after, s.anchor)) (out.inline[s.after] ??= []).push(key)
      else out.tail.push({ key, stale: showInline })
    }
    return out
  }

  /** 對得上現在正文的分段插圖：段落索引 → key */
  function validSpots(base: string, paragraphs: string[]): Map<number, string> {
    const m = new Map<number, string>()
    for (const key of keysOf(base)) {
      const s = spots.value[key]
      if (s && anchorMatches(paragraphs, s.after, s.anchor) && !m.has(s.after)) m.set(s.after, key)
    }
    return m
  }

  async function remove(key: string) {
    await idbDelete(key)
    show(key, undefined)
  }

  function cancel(key: string) {
    controllers.get(key)?.abort()
  }

  function clearError(key: string) {
    if (jobs.value[key]?.stage === 'error') delete jobs.value[key]
  }

  /** ChatGPT：登場角色有形象圖時當參考圖，人物長得比較一致 */
  async function referencesFor(state: GameState, service: ImageServiceId, plan: ScenePlan): Promise<Blob[]> {
    if (service !== 'openai') return []
    const out: Blob[] = []
    for (const c of plan.characters) {
      const blob = await currentPortraitBlob(portraitKey(state, c.id)).catch(() => undefined)
      if (blob) out.push(blob)
    }
    return out.slice(0, 4)
  }

  /** 畫一張、存起來 */
  async function renderOne(state: GameState, key: string, service: ImageServiceId, plan: ScenePlan, spot: { after: number; anchor: string } | undefined, girls: boolean, signal: AbortSignal) {
    const image = useImageSettings()
    const portraits = usePortraits()
    const tags = image.preprocessorFor(service)?.output === 'tags'
    const composed = composeScene(plan, service, tags, sceneMulti(service, image.configs[service].model), image.style)
    const references = await referencesFor(state, service, plan)
    // 有魔物娘登場時，負面提示詞補上血腥、屍體（分鏡不寫否定句）
    const negative = girls ? [image.negativeFor(service), GIRL_SCENE_NEGATIVE].filter((x) => x?.trim()).join(', ') : undefined
    const prompt = references.length
      ? `${composed.prompt}\n\nUse the reference images for the characters' faces, hair and outfits, in this order: ${plan.characters.map((c) => c.position).join(', ')}.`
      : composed.prompt
    const out = await portraits.render(service, {
      prompt, signal, ...image.sizeFor(service, true), ...(negative ? { negative } : {}),
      ...(composed.characters ? { characters: composed.characters } : {}), ...(references.length ? { references } : {}),
    })
    const rec: SceneRecord = {
      blob: out.blob, prompt, service, plan, ...(spot ?? {}), ...(composed.characters ? { characters: composed.characters } : {}), ...(girls ? { girls } : {}),
      ...(out.seed !== undefined ? { seed: out.seed } : {}), from: 'generate', time: Date.now(),
    }
    await idbPut(key, rec)
    show(key, rec)
  }

  /**
   * 生成這則日誌的插圖。
   *   不給 after：自動分段（AI 挑段落，張數照設定），換掉這則全部的插圖
   *   after：手動分段（段落索引）：已經在那些位置、對得上的插圖留著，只畫新的位置；取消勾選的位置的插圖刪掉
   * 沒有正文時照以前畫一張整則插圖。
   */
  /** 這則日誌（或其中一張）有插圖工作在跑 */
  function busy(base: string): boolean {
    return [base, ...keysOf(base)].some((k) => !!jobs.value[k] && jobs.value[k]!.stage !== 'error')
  }

  async function generate(state: GameState, report: Report, opts: { after?: number[]; from?: number } = {}) {
    const base = sceneKey(state, report.report_id)
    if (busy(base)) return
    const image = useImageSettings()
    const settings = useSettings()
    const game = useGame()
    const controller = new AbortController()
    controllers.set(base, controller)
    jobs.value[base] = { stage: 'plan' }
    try {
      // 分流：帶親密場景的日誌才是成人場景（插圖服務、分級）
      const adult = adultScene(report)
      const cast = sceneCast(state, report)
      const narration = game.narrations[report.report_id]?.text
      const paragraphs = narration ? narrationParagraphs(narration) : []
      const src = settings.sourceFor('tags')
      if (!settings.sourceReady(src.index)) throw new Error(`整理插圖的分鏡要用「插圖提示詞預處理」的模型來源（${src.name}），還沒設定好`)
      const { completeText } = await import('@/narrator/providers')

      // 要畫的位置：手動分段時扣掉已經有、對得上的
      const keep = validSpots(base, paragraphs)
      const manual = opts.after ? [...new Set(opts.after)].filter((a) => Number.isInteger(a) && a >= 0 && a < paragraphs.length).sort((a, b) => a - b) : undefined
      const todo = manual?.filter((a) => !keep.has(a))
      const segments: SceneSegments | undefined = !paragraphs.length
        ? undefined
        : manual ? {
          paragraphs, after: todo!, kept: [...keep.keys()].filter((a) => manual.includes(a)).sort((a, b) => a - b),
          ...(opts.from && opts.from > 0 && opts.from < paragraphs.length ? { from: opts.from } : {}),
        } : { paragraphs, count: autoSceneCount(image.sceneCount, paragraphs) }

      /** 用這個服務的寫法請 AI 整理分鏡；用量記在這則日誌 */
      const plan = async (service: typeof image.service): Promise<SegmentPlan[]> => {
        const format = image.preprocessorFor(service)
        const collector = game.usageCollector(game.originOf('tags', src))
        const text = await completeText(src.provider, src.config, scenePrompt(state, report, cast, {
          ...(format ? { format } : {}), multi: sceneMulti(service, image.configs[service].model), ...(narration ? { narration } : {}), style: image.style,
          ...(segments ? { segments } : {}),
        }), controller.signal, collector.onUsage)
        collector.flush(report.report_id)
        const raw = extractSceneJson(text)
        // 沒有正文：以前的整則插圖（after 用 -1 表示放最後）
        return segments ? parseScenePlans(raw, cast, adult, segments) : [{ after: -1, plan: parseScenePlan(raw, cast, adult) }]
      }

      let plans: SegmentPlan[] = []
      let service = image.sceneService(adult)
      if (!segments || !segments.after || segments.after.length) {
        // 先猜是不是成人場景（日誌標了成人場景）來選服務；分鏡判定有成人場景、但服務是 ChatGPT 時換成成人場景用的服務再整理一次
        plans = await plan(service)
        if (plans.some((p) => p.plan.rating === 'explicit') && service === 'openai') {
          const alt = image.sceneService(true)
          if (alt === 'openai') throw new Error('這段是成人場景，ChatGPT 畫不出來：到「⚙️ 設定 → 🎨 插圖生成 → 日誌插圖」指定成人場景用 NovelAI 或 ComfyUI')
          service = alt
          plans = await plan(service)
        }
        if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
      }

      // 換掉的插圖：自動分段是這則全部；手動分段是對得上、但這次沒勾的位置
      const drop = manual ? [...keep].filter(([a]) => !manual.includes(a)).map(([, k]) => k) : keysOf(base)
      for (const k of drop) await remove(k)

      const girls = sceneHasGirls(state, report)
      // 依序畫（NovelAI 有頻率限制、ComfyUI 是排隊的）；畫好一張就先顯示一張
      let n = Math.max(0, ...keysOf(base).map((k) => (k === base ? 0 : Number(k.slice(base.length + 1)) || 0)))
      jobs.value[base] = { stage: 'image', done: 0, total: plans.length }
      for (const p of plans) {
        const spot = p.after >= 0 ? { after: p.after, anchor: paragraphAnchor(paragraphs[p.after]!) } : undefined
        await renderOne(state, spot ? segmentKey(state, report.report_id, ++n) : base, service, p.plan, spot, girls, controller.signal)
        jobs.value[base] = { stage: 'image', done: (jobs.value[base]?.done ?? 0) + 1, total: plans.length }
      }
      // 手動分段：AI 漏掉的位置
      const missing = todo?.filter((a) => !plans.some((p) => p.after === a)) ?? []
      if (missing.length) jobs.value[base] = { stage: 'error', notice: true, error: `有 ${missing.length} 個位置 AI 沒有畫出來（${missing.map((a) => `第 ${a + 1} 段之後`).join('、')}），可以再用手動分段補畫` }
      else delete jobs.value[base]
    } catch (e) {
      if (controller.signal.aborted) delete jobs.value[base]
      else jobs.value[base] = { stage: 'error', error: e instanceof Error ? e.message : String(e) }
    } finally {
      controllers.delete(base)
    }
  }

  /** 重畫這一張：分鏡照舊（不再請 AI 整理），換一個種子 */
  async function redraw(state: GameState, key: string) {
    if (jobs.value[key] && jobs.value[key]!.stage !== 'error') return
    // 整則的插圖正在生成時不重畫單張（整則的工作會換掉這些圖）
    const base = key.split('#')[0]!
    if (base !== key && jobs.value[base] && jobs.value[base]!.stage !== 'error') return
    const controller = new AbortController()
    controllers.set(key, controller)
    jobs.value[key] = { stage: 'image' }
    try {
      const rec = await idbGet<SceneRecord>(key)
      if (!rec?.plan || !rec.service) throw new Error('這張插圖沒有記下分鏡，請用日誌底下的插圖按鈕重新生成')
      const service = rec.service as ImageServiceId
      if (!useImageSettings().ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')
      const spot = rec.after !== undefined && rec.anchor !== undefined ? { after: rec.after, anchor: rec.anchor } : undefined
      await renderOne(state, key, service, rec.plan, spot, !!rec.girls, controller.signal)
      delete jobs.value[key]
    } catch (e) {
      if (controller.signal.aborted) delete jobs.value[key]
      else jobs.value[key] = { stage: 'error', error: e instanceof Error ? e.message : String(e) }
    } finally {
      controllers.delete(key)
    }
  }

  /**
   * 正文第一次寫完時自動生成（⚙️ 設定 → 圖像 → 日誌插圖的「自動生成」）：自動分段。
   * 沒有設定好、已經有圖或正在畫時什麼都不做，也不顯示錯誤；沒有正文的日誌不會走到這裡。
   */
  async function auto(state: GameState, report: Report) {
    if (!autoAllowed(report)) return
    const base = sceneKey(state, report.report_id)
    if (jobs.value[base]) return
    await scan(state.seed)
    if (keysOf(base).length) return
    await generate(state, report)
  }

  /** 自動生成的設定與服務都好了嗎（這則是不是成人場景會影響要不要畫、用哪個服務） */
  function autoAllowed(report: Report): boolean {
    const image = useImageSettings()
    const adult = adultScene(report)
    if (image.sceneAuto === 'off' || (image.sceneAuto === 'adult' && !adult)) return false
    const service = image.sceneService(adult)
    // 成人場景 ChatGPT 畫不出來：沒指定成人場景用的服務時不自動畫，免得白花整理分鏡的 token
    if (adult && service === 'openai') return false
    const settings = useSettings()
    return image.ready(service) && settings.sourceReady(settings.sourceFor('tags').index)
  }

  /**
   * 續寫之後自動生成（玩家回報：續寫不會自動畫，想接著看就只能重新行動）：替續寫的段落畫一張，插在最後一段之後，
   * 原本的插圖照舊（照手動分段的做法：已經在的位置留著，畫「上一張之後到最後一段」）。
   * from 是續寫的段落從第幾段開始：只畫續寫的內容（這則還沒有插圖時也一樣，例如「只畫成人場景」時續寫成親密場景，
   * 不會畫到前面一般的段落）。設定沒開、服務沒設定好、正在畫、最後一段已經有圖時什麼都不做
   */
  async function autoContinued(state: GameState, report: Report, from?: number) {
    if (!autoAllowed(report)) return
    const base = sceneKey(state, report.report_id)
    if (jobs.value[base]) return
    await scan(state.seed)
    const text = useGame().narrations[report.report_id]?.text
    const paragraphs = text ? narrationParagraphs(text) : []
    if (!paragraphs.length) return
    const keep = validSpots(base, paragraphs)
    const last = paragraphs.length - 1
    if (keep.has(last)) return
    await generate(state, report, { after: [...keep.keys(), last], ...(from !== undefined ? { from } : {}) })
  }

  return { urls, plans, spots, jobs, busy, scan, keysOf, layout, validSpots, generate, redraw, auto, autoContinued, remove, cancel, clearError }
})
