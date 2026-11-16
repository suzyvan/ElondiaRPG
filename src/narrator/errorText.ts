// 錯誤訊息分成摘要與細節（右上角的錯誤泡泡：先只顯示摘要，打開摺疊才看細節；components/ToastHost.vue）。
// 寫法：第一行是摘要，換行之後是細節。沒有換行的長訊息，摘要取到第一個句號或括號為止（太長時截斷），整段放進細節。

export interface ErrorParts { summary: string; detail?: string }

const MAX_SUMMARY = 60

export function splitError(text: string): ErrorParts {
  const t = text.trim()
  const nl = t.indexOf('\n')
  if (nl > 0) {
    const detail = t.slice(nl + 1).trim()
    return { summary: t.slice(0, nl).trim(), ...(detail ? { detail } : {}) }
  }
  if (t.length <= MAX_SUMMARY) return { summary: t }
  // 第一句（句號、或第一個全形括號之前）夠短就當摘要
  const cut = [t.indexOf('。'), t.indexOf('（')].filter((i) => i >= 8).sort((a, b) => a - b)[0]
  const summary = cut !== undefined && cut <= MAX_SUMMARY ? t.slice(0, cut) : `${t.slice(0, MAX_SUMMARY)}…`
  return { summary, detail: t }
}

/** 摘要與細節合成一則訊息（第一行摘要） */
export function joinError(summary: string, detail?: string): string {
  return detail ? `${summary}\n${detail}` : summary
}

// ---- 程式錯誤（不是規則擋下來的）：細節附上版本、當時在哪裡、出錯的位置，玩家按「複製訊息」就能整段回報 ----

/** 遊戲規則擋下來的錯誤是一般的 Error（「錢不夠」「這裡沒有工作可做」）；這幾種是程式本身的錯（讀到空的東西、寫錯名字……） */
export function isProgramError(e: unknown): boolean {
  return e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError
}

const MAX_FRAMES = 8

/** 出錯的位置：錯誤堆疊的前幾層，網址只留檔名（assets/index-xxxx.js:行:欄） */
export function stackFrames(e: Error): string[] {
  return (e.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    // Chrome、Edge：「at 函式 (網址:行:欄)」；Firefox、Safari：「函式@網址:行:欄」
    .filter((l) => l.startsWith('at ') || /@\S+:\d+:\d+$/.test(l))
    .slice(0, MAX_FRAMES)
    .map((l) => l.replace(/(?:https?|file|blob):\/\/[^\s()@]*?\/((?:assets|src)\/)/g, '$1').replace(/\?[^\s():]*(?=:\d+:\d+)/g, ''))
}

export interface BugContext {
  /** 遊戲版本 */
  version?: string
  /** 當時在做什麼（「動作」「畫面顯示」……） */
  doing?: string
  /** 當時在哪裡（地點、區域、座標） */
  where?: string
}

/** 程式錯誤的訊息：第一行是原本的訊息，細節寫這是程式錯誤、請整段回報，附上版本、在哪裡與出錯的位置 */
export function programErrorText(e: Error, ctx: BugContext = {}): string {
  const frames = stackFrames(e)
  const lines = [
    '這是遊戲程式的錯誤（不是規則限制）。回報時請按「複製訊息」，把整段貼給我們。',
    ...(ctx.version ? [`版本：${ctx.version}`] : []),
    ...(ctx.doing ? [`當時：${ctx.doing}`] : []),
    ...(ctx.where ? [`位置：${ctx.where}`] : []),
    `錯誤：${e.name}: ${e.message}`,
    ...(frames.length ? ['出錯的地方：', ...frames.map((f) => `  ${f}`)] : []),
  ]
  return joinError(e.message, lines.join('\n'))
}
