// 日誌插圖（一般模式）：日誌底下的插圖按鈕一鍵完成，或在正文第一次寫完時自動生成（設定的「自動生成」）：
// 請「插圖提示詞預處理」的模型整理分鏡 → 依分級選服務（成人場景可以另外指定）→ 生圖 → 掛在那則日誌下面。
// 圖片和形象圖存在同一個 IndexedDB（key 是 `種子:@scene:日誌id`），匯出存檔時跟著形象圖一起帶。見 docs/PORTRAITS.md 第 7 節。

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GameState, Report } from '@/engine/types'
import { extractJson } from '@/narrator/judge'
import { composeScene, parseScenePlan, sceneCast, sceneMulti, scenePrompt, type ScenePlan } from '@/narrator/sceneInfo'
import { useGame } from './game'
import { useImageSettings } from './image'
import { currentPortraitBlob, idbDelete, idbGet, idbKeys, idbPut, portraitKey, usePortraits, type PortraitRecord } from './portraits'
import { useSettings } from './settings'

export interface SceneRecord extends PortraitRecord {
  plan?: ScenePlan
}

export interface SceneJob {
  stage: 'plan' | 'image' | 'error'
  error?: string
}

export const sceneKey = (state: Pick<GameState, 'seed'>, reportId: string) => `${state.seed}:@scene:${reportId}`

export const useScenes = defineStore('scenes', () => {
  /** key → 圖片網址 */
  const urls = ref<Record<string, string>>({})
  const plans = ref<Record<string, ScenePlan | undefined>>({})
  const jobs = ref<Record<string, SceneJob>>({})
  /** 已經查過有哪些插圖的局（種子；匯入存檔還原圖片後重新查） */
  let scanned = ''
  const controllers = new Map<string, AbortController>()

  function show(key: string, rec: SceneRecord | undefined) {
    if (urls.value[key]) URL.revokeObjectURL(urls.value[key]!)
    if (rec?.blob) {
      urls.value[key] = URL.createObjectURL(rec.blob)
      plans.value[key] = rec.plan
    } else {
      delete urls.value[key]
      delete plans.value[key]
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

  /** 生成（或重新生成）這則日誌的插圖 */
  async function generate(state: GameState, report: Report) {
    const key = sceneKey(state, report.report_id)
    if (jobs.value[key] && jobs.value[key]!.stage !== 'error') return
    const image = useImageSettings()
    const settings = useSettings()
    const game = useGame()
    const portraits = usePortraits()
    const controller = new AbortController()
    controllers.set(key, controller)
    jobs.value[key] = { stage: 'plan' }
    try {
      // 分流：帶親密場景的日誌才是成人場景（插圖服務、分級）
      const adult = !!report.narration?.adult_scene
      const cast = sceneCast(state, report)
      const narration = game.narrations[report.report_id]?.text
      const src = settings.sourceFor('tags')
      if (!settings.sourceReady(src.index)) throw new Error(`整理插圖的分鏡要用「插圖提示詞預處理」的模型來源（${src.name}），還沒設定好`)
      const { completeText } = await import('@/narrator/providers')

      /** 用這個服務的寫法請 AI 整理分鏡；用量記在這則日誌 */
      const plan = async (service: typeof image.service): Promise<ScenePlan> => {
        const format = image.preprocessorFor(service)
        const collector = game.usageCollector(game.originOf('tags', src))
        const text = await completeText(src.provider, src.config, scenePrompt(state, report, cast, {
          ...(format ? { format } : {}), multi: sceneMulti(service, image.configs[service].model), ...(narration ? { narration } : {}), style: image.style,
        }), controller.signal, collector.onUsage)
        collector.flush(report.report_id)
        return parseScenePlan(extractJson(text), cast, adult)
      }

      // 先猜是不是成人場景（日誌標了成人場景）來選服務；分鏡判定是成人場景、但服務是 ChatGPT 時換成成人場景用的服務再整理一次
      let service = image.sceneService(adult)
      let p = await plan(service)
      if (p.rating === 'explicit' && service === 'openai') {
        const alt = image.sceneService(true)
        if (alt === 'openai') throw new Error('這段是成人場景，ChatGPT 畫不出來：到「⚙️ 設定 → 🎨 插圖生成 → 日誌插圖」指定成人場景用 NovelAI 或 ComfyUI')
        service = alt
        p = await plan(service)
      }
      if (!image.ready(service)) throw new Error('插圖生成還沒設定好（⚙️ 設定 → 🎨 插圖生成）')

      jobs.value[key] = { stage: 'image' }
      const tags = image.preprocessorFor(service)?.output === 'tags'
      const composed = composeScene(p, service, tags, sceneMulti(service, image.configs[service].model), image.style)
      // ChatGPT：登場角色有形象圖時當參考圖，人物長得比較一致
      let references: Blob[] = []
      if (service === 'openai') {
        for (const c of p.characters) {
          const blob = await currentPortraitBlob(portraitKey(state, c.id)).catch(() => undefined)
          if (blob) references.push(blob)
        }
        references = references.slice(0, 4)
      }
      const prompt = references.length
        ? `${composed.prompt}\n\nUse the reference images for the characters' faces, hair and outfits, in this order: ${p.characters.map((c) => c.position).join(', ')}.`
        : composed.prompt
      const size = image.sizeFor(service, true)
      const out = await portraits.render(service, {
        prompt, signal: controller.signal, ...size,
        ...(composed.characters ? { characters: composed.characters } : {}), ...(references.length ? { references } : {}),
      })
      const rec: SceneRecord = {
        blob: out.blob, prompt, service, plan: p, ...(out.seed !== undefined ? { seed: out.seed } : {}), from: 'generate', time: Date.now(),
      }
      await idbPut(key, rec)
      show(key, rec)
      delete jobs.value[key]
    } catch (e) {
      if (controller.signal.aborted) delete jobs.value[key]
      else jobs.value[key] = { stage: 'error', error: e instanceof Error ? e.message : String(e) }
    } finally {
      controllers.delete(key)
    }
  }

  /**
   * 正文第一次寫完時自動生成（⚙️ 設定 → 圖像 → 日誌插圖的「自動生成」）。
   * 沒有設定好、已經有圖或正在畫時什麼都不做，也不顯示錯誤；沒有正文的日誌不會走到這裡。
   */
  async function auto(state: GameState, report: Report) {
    const image = useImageSettings()
    const adult = !!report.narration?.adult_scene
    if (image.sceneAuto === 'off' || (image.sceneAuto === 'adult' && !adult)) return
    const service = image.sceneService(adult)
    // 成人場景 ChatGPT 畫不出來：沒指定成人場景用的服務時不自動畫，免得白花整理分鏡的 token
    if (adult && service === 'openai') return
    const settings = useSettings()
    if (!image.ready(service) || !settings.sourceReady(settings.sourceFor('tags').index)) return
    const key = sceneKey(state, report.report_id)
    if (jobs.value[key]) return
    await scan(state.seed)
    if (urls.value[key]) return
    await generate(state, report)
  }

  return { urls, plans, jobs, scan, generate, auto, remove, cancel, clearError }
})
