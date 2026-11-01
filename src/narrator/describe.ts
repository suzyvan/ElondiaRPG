// 不經 AI、直接把報告轉成可讀的文字戰報。AI 關閉或失敗時顯示這份。
// 也用來把 id 換成名稱，讓送給 AI 的報告更好讀。

import { abilities, attrName, className, companionRules, conditionName, geography, raceName, regionById, statuses, type LewdKey } from '@/engine/data'
import { lewdName } from '@/engine/lewd'
import { formatMoney } from '@/engine/money'
import { formatTime } from '@/engine/state'
import type { Effect, Report, TimelineEntry } from '@/engine/types'

export function locationName(id: string): string {
  return geography.locations.find((l) => l.id === id)?.name ?? id
}

export function actorNames(report: Report): Record<string, string> {
  return Object.fromEntries([...report.party, ...(report.others ?? [])].map((a) => [a.id, a.name]))
}

function describeEffect(e: Effect, names: Record<string, string>): string {
  const who = e.target ? (names[e.target] ?? e.target) : ''
  switch (e.type) {
    case 'damage': return `${who} 受到 ${e.amount} 點${e.element ? `${e.element}` : ''}傷害${e.text ? `（${e.text}）` : ''}`
    case 'heal': return `${who} 回復 ${e.amount} HP`
    case 'lust': return (e.amount ?? 0) >= 0 ? `${who} 慾望 +${e.amount}${e.text ? `（${e.text}）` : ''}` : `${who} 慾望 ${e.amount}`
    case 'status_add': {
      if (e.status === '死亡' || e.status === '倒下') return `${who} 倒下了`
      const buff = Object.values(statuses).find((s) => s.name === e.status)?.kind === 'buff'
      return buff ? `${who} 獲得「${e.status}」` : `${who} 陷入「${e.status}」`
    }
    case 'status_remove': return e.text ? `${who} ${e.text}` : `${who} 解除「${e.status}」`
    default: return e.text ? `${who ? `${who}：` : ''}${e.text}` : ''
  }
}

const RESULT_TEXT: Record<TimelineEntry['result'], string> = {
  success: '成功', critical: '幸運一擊！', fail: '失敗', fumble: '大失敗', partial: '部分成功', none: '',
}

export function describeEntry(t: TimelineEntry, names: Record<string, string>): string {
  const actor = names[t.actor] ?? t.actor
  const target = t.target ? ` → ${names[t.target] ?? t.target}` : ''
  // 豁免類的招式：數字是目標的豁免對施放者的 DC，寫清楚免得看起來勝負顛倒
  const rollText = t.roll?.value === undefined ? ''
    : t.roll.save && t.roll.dc !== undefined ? `（豁免 ${t.roll.value} / DC ${t.roll.dc}）`
    : `（${t.roll.value}${t.roll.dc !== undefined ? ` vs ${t.roll.dc}` : ''}）`
  const effects = (t.effects ?? []).map((e) => describeEffect(e, names)).filter(Boolean).join('，')
  const head = t.round ? `第${t.round}回合 ` : ''
  return `${head}${actor}：${t.action}${target}${rollText} ${RESULT_TEXT[t.result]}${effects ? `｜${effects}` : ''}`.trim()
}

/** 戰鬥畫面的紀錄行：主句、細節（滑過才看到的倍率與減傷），一個動作打到多個目標時每個目標一行 */
export interface CombatLogLine { text: string; detail?: string; targets?: { text: string; detail?: string }[] }

export function describeCombatLine(t: TimelineEntry, names: Record<string, string>): CombatLogLine {
  const actor = names[t.actor] ?? t.actor
  const target = t.target ? ` → ${names[t.target] ?? t.target}` : ''
  const rollText = t.roll?.value === undefined ? ''
    : t.roll.save && t.roll.dc !== undefined ? `（豁免 ${t.roll.value} / DC ${t.roll.dc}）`
    : `（${t.roll.value}${t.roll.dc !== undefined ? ` vs ${t.roll.dc}` : ''}）`
  const head = `${actor}：${t.action}${target}${rollText} ${RESULT_TEXT[t.result]}`.trim()
  // 傷害的倍率與減傷說明拿掉，放進滑鼠提示
  const plain = (e: Effect) => (e.type === 'damage' ? describeEffect({ ...e, text: undefined }, names) : describeEffect(e, names))
  const detailOf = (e: Effect) => (e.type === 'damage' && e.text ? `${names[e.target ?? ''] ?? e.target ?? ''}：${e.text}` : undefined)
  const effects = (t.effects ?? []).filter((e) => describeEffect(e, names))
  const ids = [...new Set(effects.map((e) => e.target ?? ''))]
  const joinDetail = (list: Effect[]) => list.map(detailOf).filter(Boolean).join('\n') || undefined
  if (ids.length > 1) {
    const targets = ids.map((id) => {
      const mine = effects.filter((e) => (e.target ?? '') === id)
      return { text: mine.map(plain).join('，'), detail: joinDetail(mine) }
    })
    return { text: head, targets }
  }
  const body = effects.map(plain).join('，')
  return { text: body ? `${head}｜${body}` : head, detail: joinDetail(effects) }
}

export function describeChanges(report: Report): string[] {
  const c = report.changes
  const names = actorNames(report)
  const lines: string[] = []
  if (c.money_cc) lines.push(`金錢 ${c.money_cc > 0 ? '+' : ''}${formatMoney(c.money_cc)}`)
  for (const x of c.xp ?? []) lines.push(`${names[x.actor] ?? x.actor} 經驗值 +${x.amount}`)
  for (const l of c.level_up ?? []) lines.push(`${names[l.actor] ?? l.actor} 升級！Lv.${l.from} → Lv.${l.to}`)
  for (const s of c.skills_gained ?? []) lines.push(`${names[s.actor] ?? s.actor} 習得技能【${s.skill}】`)
  for (const i of c.items_gained ?? []) lines.push(`獲得 ${i.name} ×${i.qty}`)
  for (const i of c.items_lost ?? []) lines.push(`消耗 ${i.name} ×${i.qty}`)
  for (const r of c.reputation ?? []) lines.push(`聲望（${factionLabel(r.faction)}）${r.delta > 0 ? '+' : ''}${r.delta}`)
  for (const r of c.resources ?? []) {
    const who = names[r.actor] ?? r.actor
    const what = { slot: '法術環', hit_dice: '生命骰', ability_use: '能力次數' }[r.kind]
    lines.push(`${who} ${r.delta < 0 ? '用掉' : '回復'}${what}${Math.abs(r.delta) > 1 ? ` ×${Math.abs(r.delta)}` : ''}${r.detail ? `（${r.detail}）` : ''}`)
  }
  if (c.master_share_cc) lines.push(`主人拿走 ${formatMoney(c.master_share_cc)}（收益歸屬）`)
  for (const h of c.hit_dice ?? []) {
    const who = names[h.actor] ?? h.actor
    if (h.spent) lines.push(`${who} 花費生命骰 ${h.spent} 顆，回復 ${h.healed ?? 0} HP`)
    if (h.regained) lines.push(`${who} 回復生命骰 ${h.regained} 顆`)
  }
  for (const x of c.companions ?? []) {
    const bond = x.bond ? `（${companionRules.bonds[x.bond]}）` : ''
    lines.push(`${x.name}${COMPANION_TEXT[x.change]}${bond}${x.reason ? `：${x.reason}` : ''}`)
  }
  for (const x of c.conditions ?? []) {
    lines.push(`${names[x.actor] ?? x.actor} ${x.added ? '獲得' : '解除'}「${conditionName(x.condition)}」`)
  }
  for (const x of c.lewd ?? []) {
    const where = x.region ? `（${regionById(x.region).name}）` : ''
    lines.push(`${names[x.actor] ?? x.actor} ${lewdName(x.stat as LewdKey)}${where} ${x.delta > 0 ? '+' : ''}${x.delta}（${x.after}）`)
  }
  return lines
}

const COMPANION_TEXT = {
  joined: '加入隊伍', left: '離開隊伍', freed: '獲得自由', enslaved: '成為奴隸', escaped: '逃離主人', recaptured: '被抓回', transferred: '換了主人',
} as const

/** 主動行動的檢定：「魅力檢定 DC 15：擲出 11 + 3 = 14，部分成功」 */
export function describeCheck(report: Report): string | null {
  const k = report.check
  if (!k) return null
  const degree = { critical: '大成功', success: '成功', partial: '部分成功', fail: '失敗', fumble: '大失敗' }[k.degree]
  const adjusted = k.dc !== k.base_dc ? `（參考 ${k.base_dc}）` : ''
  const sign = k.modifier >= 0 ? '+' : '-'
  const names = { critical: '大成功', success: '成功', partial: '部分成功', fail: '失敗', fumble: '大失敗' }
  const ref = k.reference_degree ? `（骰值參考：${names[k.reference_degree]}）` : ''
  return `${k.action}・${attrName(k.attr)}檢定 DC ${k.dc}${adjusted}：擲出 ${k.natural} ${sign} ${Math.abs(k.modifier)} = ${k.total}，${degree}${ref}${k.trivial ? '（日常小事）' : ''}${k.source === 'ai' ? '（AI 判定）' : ''}`
}

/** 送給 AI 前，把報告裡的 id 換成中文名稱。 */
export function humanizeReport(report: Report) {
  const names = actorNames(report)
  const actor = (a: Report['party'][number]) => ({
    ...a,
    ...(a.class ? { class: className(a.class) } : {}),
    ...(a.race ? { race: raceName(a.race) } : {}),
  })
  return {
    ...report,
    time: { start: formatTime(report.time.start), end: formatTime(report.time.end) },
    location: {
      ...report.location,
      at: locationName(report.location.at),
      ...(report.location.to ? { to: locationName(report.location.to) } : {}),
    },
    // 給敘事用的旗標，不用送出去
    ...(report.narration ? { narration: { ...report.narration, body_limited: undefined } } : {}),
    party: report.party.map(actor),
    others: report.others?.map(actor),
    // 旁邊的人另外放在 <bystanders>
    bystanders: undefined,
    timeline: report.timeline?.map((t) => ({
      ...t,
      actor: names[t.actor] ?? t.actor,
      ...(t.target ? { target: names[t.target] ?? t.target } : {}),
      effects: t.effects?.map((e) => ({ ...e, ...(e.target ? { target: names[e.target] ?? e.target } : {}) })),
    })),
    changes: {
      ...report.changes,
      ...(report.changes.money_cc ? { money: formatMoney(report.changes.money_cc) } : {}),
      xp: report.changes.xp?.map((x) => ({ ...x, actor: names[x.actor] ?? x.actor })),
      level_up: report.changes.level_up?.map((x) => ({ ...x, actor: names[x.actor] ?? x.actor })),
      affinity: report.changes.affinity?.map((a) => ({ ...a, npc: names[a.npc] ?? a.npc })),
      conditions: report.changes.conditions?.map((x) => ({ ...x, actor: names[x.actor] ?? x.actor, condition: conditionName(x.condition) })),
      lewd: report.changes.lewd?.map((x) => ({ ...x, actor: names[x.actor] ?? x.actor, stat: lewdName(x.stat as LewdKey), ...(x.region ? { region: regionById(x.region).name } : {}) })),
      companions: report.changes.companions?.map((x) => ({ ...x, ...(x.bond ? { bond: companionRules.bonds[x.bond] } : {}) })),
    },
    ...(report.check ? { check: { ...report.check, attr: attrName(report.check.attr) } } : {}),
  }
}

export function abilityName(id: string): string {
  return abilities[id]?.name ?? id
}

/** token 數的顯示：1234 → "1,234"，12345 → "1.2 萬" */
/** 勢力名稱（local 是這座城鎮的勢力，guild 是冒險者公會） */
function factionLabel(id: string): string {
  if (id === 'local') return '本地'
  return geography.factions.find((f) => f.id === id)?.name ?? id
}

export function formatTokens(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 萬` : n.toLocaleString('en-US')
}
