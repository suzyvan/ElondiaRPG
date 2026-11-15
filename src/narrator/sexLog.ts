// I. 性經歷記錄（成人向；docs/PROMPTS.md 第 1 節、docs/LEWD_STATS.md 第 29 節）：
// 親密場景的日誌寫完經過之後，把報告與正文交給 AI，請它回傳這次誰和誰做了什麼（JSON），程式驗證後加進記錄。
// 判定時不記：這是另外一次呼叫，用「性經歷記錄」的來源。

import { genderPrompt, raceName } from '@/engine/data'
import { npcRecord } from '@/engine/npcs'
import { sexCandidates, sexRecordText } from '@/engine/sexRecord'
import type { GameState, Report } from '@/engine/types'
import type { Prompt } from './prompt'

/** 正文太長時保留開頭與結尾 */
const NARRATIVE_MAX = 6000

function clip(text: string): string {
  const t = text.trim()
  if (t.length <= NARRATIVE_MAX) return t
  const half = NARRATIVE_MAX / 2
  return `${t.slice(0, half)}\n……（中略）……\n${t.slice(-half)}`
}

function who(state: GameState, id: string): string {
  if (id === 'pc') {
    const pc = state.party.find((m) => m.isPlayer)!
    return `${pc.name}（id: pc，主角${pc.gender ? `，${genderPrompt(pc.gender)}` : ''}，${raceName(pc.race)}）`
  }
  const m = state.party.find((x) => x.id === id)
  const rec = npcRecord(state, id)
  const gender = m?.gender ?? rec?.gender
  const name = m?.name ?? rec?.name ?? id
  return `${name}（id: ${id}${gender ? `，${genderPrompt(gender)}` : ''}${m ? '，隊友' : ''}，${raceName(m?.race ?? rec?.race ?? 'human')}）`
}

/** 報告裡和這段經過有關的文字：摘要、親密場景、時間線 */
function reportText(report: Report): string {
  const lines = [
    report.outcome.summary ? `摘要：${report.outcome.summary}` : '',
    report.narration?.adult_scene ? `親密場景：${report.narration.adult_scene}` : '',
    report.narration?.intimate_note ? `正文寫到的親密場景：${report.narration.intimate_note}` : '',
    report.narration?.player_intent ? `主角想做的事：${report.narration.player_intent}` : '',
    ...(report.timeline ?? []).slice(-12).map((t) => `- ${t.actor}：${t.action}${t.target ? ` → ${t.target}` : ''}`),
    report.others?.length ? `在場的其他人：${report.others.map((o) => `${o.name}（${o.id}）`).join('、')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

/** 請 AI 記下性經歷的提示詞；沒有可以記的人時是 null */
export function buildSexLogPrompt(state: GameState, report: Report, narrative: string): { prompt: Prompt; candidates: string[] } | null {
  const candidates = sexCandidates(state, report)
  if (!candidates.length) return null
  const system = `你是奇幻 RPG《埃隆迪亞大陸》（成人向）的記錄員。下面是一段剛發生的親密場景（報告與寫好的經過）以及在場角色目前的性經歷。請讀完之後，記下這段經過裡，名單上的每個人實際做了什麼。不寫正文、不評論，只輸出 JSON。

規則：
1. 只記名單上的人（id 照名單寫）；沒有發生的事不要記。只是挑逗、愛撫、親吻、看著、被脫衣而沒有性交、性侍奉或自慰的人不要列出。
2. sex：這次「性交」（插入）的次數；service：這次「性侍奉」（口交、手交、乳交、足交……替對方服務）的次數；solo：這次「自慰」（自己弄到高潮或明顯在自慰）的次數。三項都沒有就不要列出這個人。次數看不出來時填 1。只有自慰時 with 留空。
3. with：這次的對象（每人一筆）：名單上或在場有 id 的人填 id 與名字；路人、客人、怪物、一群人照經過裡的稱呼寫名字（例如「酒館的客人」「哥布林」），不填 id，但要填 gender（female 女性、male 男性、futa 扶她、femboy 偽娘、ts；看不出來或一群人男女都有時填 unknown）。每一筆的 sex／service 寫這個人自己和這個對象性交、替這個對象性侍奉的次數（沒有就填 0），例如接了三位客人、只替其中一位口交時，只有那一位的 service 是 1。
4. 被強迫、被侵犯、不得不從（主人的命令、戰敗後的遭遇……）時 forced 填 true。
5. summary：這次的經過，一句話（≤ 60 字）。
6. first_time：只在這個人「目前是處子」而這次第一次性交時填：一句話記下初體驗（≤ 60 字）。
7. favorite：只在經過明顯表現出這個人最喜歡的對象改變時填（名字）；notes：只在出現新的性癖或偏好時填：更新後的一句話（≤ 60 字），會整個取代原本的。
8. 只記錄成年的角色。
只輸出 JSON：{"records":[{"id":"…","sex":0,"service":0,"solo":0,"with":[{"name":"…","id":"…","gender":"…","sex":0,"service":0}],"forced":false,"summary":"…","first_time":"","favorite":"","notes":""}]}；沒有可以記的就輸出 {"records":[]}`
  const people = candidates.map((id) => `- ${who(state, id)}\n  目前：${sexRecordText(state, id)}`).join('\n')
  const user = [
    `<people>\n${people}\n</people>`,
    `<report>\n第 ${report.time.end.day} 天\n${reportText(report)}\n</report>`,
    narrative.trim() ? `<narrative>\n${clip(narrative)}\n</narrative>` : '（這則日誌沒有寫出經過，照報告判斷）',
  ].join('\n\n')
  return { prompt: { system, user }, candidates }
}
