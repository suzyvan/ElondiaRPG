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
