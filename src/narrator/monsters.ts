// 交給 AI 的「登場的怪物」（<monsters>）：每種怪物的外觀與習性（怪物資料的 desc）。
// 設定「魔物娘」打開、而且這段經過的主角符合設定時，換成魔物娘的名字與外觀（怪物資料的 girl）；
// 報告、戰鬥紀錄裡仍然是原本的名字，所以列成「原本的名字 → 魔物娘的名字」。見 docs/MONSTERS.md 的「魔物娘」。

import { monsterGirlsFor } from '@/engine/content'
import { enemies } from '@/engine/data'
import { characterBody } from '@/engine/look'
import type { GameState, Report } from '@/engine/types'

/** 報告裡登場的怪物（怪物資料的 id，不重複） */
export function reportMonsters(report: Report): string[] {
  return [...new Set((report.others ?? []).map((o) => o.monster).filter((m): m is string => !!m && !!enemies[m]))]
}

/**
 * 這段經過的怪物要不要以魔物娘的樣子交給 AI：看設定與這段經過的主角
 * （戰敗事件被圍住的隊友、親密場景的主角是隊友時是那位隊友，其他時候是主角）
 */
export function monsterGirlsIn(state: GameState | null, who?: string): boolean {
  if (!state) return false
  const m = (who && state.party.find((x) => x.id === who)) || state.party.find((x) => x.isPlayer)
  return !!m && monsterGirlsFor(characterBody(m))
}

/** 日誌的敘事：這則報告的主角是誰（被圍住的隊友、親密場景的主角） */
export function reportFocus(report: Report): string | undefined {
  return report.narration?.defeat_victim ?? report.narration?.adult_actor
}

/** 一行一種怪物；girls：有魔物娘形態的換成魔物娘 */
export function monsterLines(ids: string[], girls: boolean): string[] {
  return ids.flatMap((id) => {
    const def = enemies[id]
    if (!def) return []
    if (girls && def.girl) return [`- ${def.name} → ${def.girl.name}：${def.girl.desc}`]
    return def.desc ? [`- ${def.name}：${def.desc}`] : []
  })
}

/** <monsters> 區塊；沒有怪物（或都沒有描述）時是空字串 */
export function monstersText(ids: string[], girls: boolean): string {
  const lines = monsterLines(ids, girls)
  if (!lines.length) return ''
  const anyGirl = girls && ids.some((id) => !!enemies[id]?.girl)
  const head = anyGirl
    ? '登場的怪物。標了「→」的以魔物娘的樣子出現：成年女性的身體，保留原本種族的特徵（耳朵、尾巴、鱗片、翅膀、觸手……）。報告與戰鬥紀錄用的是原本的名字（→ 左邊），正文照右邊的稱呼與外觀寫；招式的名稱照舊，動作改成符合她們身體的寫法。沒有標「→」的照原本的樣子寫。'
    : '登場的怪物（外觀與習性）：'
  return `<monsters>\n${head}\n${lines.join('\n')}\n</monsters>`
}
