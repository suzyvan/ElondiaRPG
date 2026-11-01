// 世界檢查（worldgen/balance/README.md）：讀一個世界包或內容檔，檢查能不能匯入、引用對不對、數值平衡在不在範圍內，
// 產出一份 Markdown 報告。給生成世界的 Agent 自我檢查用；`worldCheck.spec.ts` 在 WORLD=路徑 時執行。
//
// 1. 整理：匯入時每一項都會整理（數值夾在範圍、拿掉不存在的引用）；列出整理前後不同的欄位＝寫錯的地方。
// 2. 套用：套用時出錯的項目、有錯誤的特殊任務（匯入時不收）與提醒。
// 3. 一致性：名稱重複、沒有出現地點的怪物、沒有出沒地點的固定 NPC……
// 4. 平衡：怪物的耐打度與戰鬥模擬、技能的傷害、物品的價格、特質強度、特殊任務的報酬。
// 5. 提示詞：世界書的修改與新增條目。
import { abilities, dungeonEncounters, enemies, specialMaps, isLayerBoss, itemDef, itemRules, locationById, npcs as namedNpcs, perkRules, stories, type AbilityDef, type DamagePart, type ItemDef } from '@/engine/data'
import { blockKeys, settlementArea } from '@/engine/grid'
import { rewardRange } from '@/engine/materialQuests'
import type { GuildRank } from '@/engine/types'
import { gearPrice } from '@/engine/gear'
import { applyContent, dropBrokenStories, emptyMods, normalizeMods, type ContentMods } from '@/engine/mods'
import { perkPower } from '@/engine/perks'
import { abilityApCost } from '@/engine/combat'
import { storyCheck } from '@/engine/storyMods'
import { parseWorldFile } from '@/engine/worldPackage'
import { bossFights, bossIds, durability, minionArea, minionFight, type MinionArea } from './balanceSim'

export type Level = 'error' | 'warn' | 'info'
export interface Finding { level: Level; section: string; text: string }
export interface WorldCheckResult { name: string; findings: Finding[]; tables: { title: string; rows: string[][]; head: string[] }[] }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const SECTIONS = ['statuses', 'tattoos', 'marks', 'markRules', 'landmarks', 'specialMaps', 'shops', 'abilities', 'perks', 'materials', 'bases', 'items', 'enemies', 'npcs', 'stories', 'travelEvents', 'eventRules', 'categoryIcons'] as const
const SECTION_NAME: Record<string, string> = {
  statuses: '狀態', tattoos: '刺青圖樣', marks: '奴隸印記', markRules: '印記設定', landmarks: '地標', specialMaps: '特殊地圖', shops: '商店', abilities: '技能',
  perks: '特質', materials: '材料', bases: '底材', items: '物品', enemies: '怪物', npcs: '固定 NPC', stories: '特殊任務', travelEvents: '事件', eventRules: '事件設定', categoryIcons: '類別圖示',
}

/** 小怪每場掉的生命（依出現的最淺區域）與層主的目標勝率：docs/MONSTERS.md */
export const MINION_LOSS: Record<MinionArea, [number, number]> = { wild: [0.25, 0.35], outskirts: [0.2, 0.3], shallow: [0.15, 0.2], full: [0.1, 0.15] }
export const BOSS_WIN: Record<string, number> = { shallow: 0.85, middle: 0.85, deep: 0.85, abyss: 0.85 }
/** 層主戰至少跑幾場 */
export const BOSS_TRIALS = 40

// ---- 1. 整理前後的差異 ----

const isEmptyValue = (v: unknown): boolean =>
  v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEmptyValue))

function diffPaths(a: unknown, b: unknown, path: string, out: string[]) {
  if (out.length > 40) return
  if (JSON.stringify(a) === JSON.stringify(b)) return
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'custom') continue
      diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffPaths(x, b[i], `${path}[${i}]`, out))
    return
  }
  // 沒寫、整理時補上的預設值不算；寫成預設值（false、0、空的、事件的 scope: road）被拿掉也不算
  if (a === undefined) return
  if (b === undefined && (isEmptyValue(a) || (path.endsWith('scope') && a === 'road'))) return
  const show = (v: unknown) => (v === undefined ? '（沒有）' : JSON.stringify(v).slice(0, 80))
  out.push(`\`${path || '（整筆）'}\`：${show(a)} → ${show(b)}`)
}

// ---- 4. 平衡的工具 ----

/** 骰子的平均值（2d6+1 → 8） */
export function diceAvg(dice: string | undefined): number {
  if (!dice) return 0
  let total = 0
  for (const m of dice.replace(/\s/g, '').matchAll(/([+-]?)(\d*)d(\d+)|([+-]?\d+)/g)) {
    if (m[4]) total += Number(m[4])
    else total += (m[1] === '-' ? -1 : 1) * Number(m[2] || 1) * (Number(m[3]) + 1) / 2
  }
  return total
}

/** 技能一次的期望傷害（不含屬性調整值、武器骰算 1d8）：比較用的粗略指標 */
export function abilityDamage(a: AbilityDef, level = a.unlock ?? (a.circle ? a.circle * 2 - 1 : 1)): number {
  const part = (p: DamagePart) => (p.weapon ? 4.5 : diceAvg(p.dice)) + (p.scale ? diceAvg(p.scale.dice) * Math.floor(level / Math.max(1, p.scale.per)) : 0)
  const one = (a.damage ?? []).reduce((s, p) => s + part(p), 0) * (a.mult ?? 1)
  const targets = a.target === 'all_enemies' ? 2 : a.target === 'random_enemies' ? Math.min(a.count ?? 2, 3) : 1
  return one * (a.hits ?? 1) * targets
}

const tierOf = (a: AbilityDef) => (a.type === 'spell' ? `${a.circle ?? 1} 環法術` : a.type === 'skill' ? `${Math.ceil((a.unlock ?? 1) / 2) * 2 - 1}～${Math.ceil((a.unlock ?? 1) / 2) * 2} 級技能` : a.type)

/** 內建能力（同種類、同等級帶）每行動點傷害的最大值 */
function abilityBaseline(builtin: Record<string, AbilityDef>): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of Object.values(builtin)) {
    if (!a.damage?.length || a.classes.includes('monster')) continue
    const per = abilityDamage(a) / Math.max(1, abilityApCost(a))
    const k = tierOf(a)
    out.set(k, Math.max(out.get(k) ?? 0, per))
  }
  return out
}

/** 內建物品每個種類的價格範圍 */
function priceRanges(items: ItemDef[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  for (const i of items) {
    if (i.gear) continue
    const r = out.get(i.category) ?? [Infinity, 0]
    out.set(i.category, [Math.min(r[0], i.price_cc), Math.max(r[1], i.price_cc)])
  }
  return out
}

const pct = (n: number) => `${Math.round(n * 100)}%`

// ---- 主程式 ----

export function checkWorld(raw: unknown, opts: { trials?: number } = {}): WorldCheckResult {
  const trials = opts.trials ?? 20
  const findings: Finding[] = []
  const tables: WorldCheckResult['tables'] = []
  const add = (level: Level, section: string, text: string) => findings.push({ level, section, text })

  const file = parseWorldFile(raw)
  const name = file.name ?? '（內容檔）'
  // 先記下內建的樣子（比較用）
  applyContent(emptyMods())
  const builtinAbilities = clone(abilities)
  const builtinPrices = priceRanges(itemRules.items)
  const builtinPerkPower = Math.max(...perkRules.perks.filter((p) => !p.race && !p.flaw).map((p) => perkPower(p)))
  const builtinNpcNames = new Set(namedNpcs.map((n) => n.name))
  const builtinEnemyNames = new Set(Object.values(enemies).map((e) => e.name))

  // 1. 整理
  const rawContent = clone(file.content) as Record<string, Record<string, unknown> | undefined>
  let mods: ContentMods
  try {
    mods = normalizeMods(clone(file.content))
  } catch (e) {
    add('error', '整理', `內容整理失敗：${e instanceof Error ? e.message : String(e)}`)
    return { name, findings, tables }
  }
  for (const s of SECTIONS) {
    const before = rawContent[s] ?? {}
    const after = (mods as unknown as Record<string, Record<string, unknown>>)[s] ?? {}
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        add('error', '整理', `${SECTION_NAME[s]}「${id}」整筆被拿掉（id 或必要欄位不對）`)
        continue
      }
      const out: string[] = []
      diffPaths(before[id], after[id], '', out)
      if (out.length) add('warn', '整理', `${SECTION_NAME[s]}「${id}」整理時改了：${out.join('；')}`)
    }
  }
  for (const k of Object.keys(rawContent)) if (k !== 'version' && !(SECTIONS as readonly string[]).includes(k)) add('warn', '整理', `不認得的欄位「${k}」（會被忽略）`)
  // 整理時加上去的限制（差異只比寫了的欄位，這些要另外說）
  for (const [nm, it] of Object.entries(rawContent.items ?? {})) {
    const use = (it as { use?: { combat_only?: boolean } }).use
    if (use && !use.combat_only && mods.items[nm]?.use?.combat_only) add('info', '整理', `物品「${nm}」的使用效果只能在戰鬥中用（戰鬥外只支援治療、法術位、狀況與特質），整理時加上了 combat_only`)
  }
  // 特殊任務與事件不支援的效果：整理時會拿掉，說明替代的寫法
  const ALT: Record<string, string> = {
    flag: '用結果的 set_flags／clear_flags', meet: '用 affinity 效果或 npc 任務點（認識那位 NPC）', intel: '用情報商（start.kind: informant）或旅途事件開頭',
    join_party: '任務中用結果的 join（任務同行），結束後用 companion 效果正式入隊', enslave_player: '事件不能讓主角淪為奴隸，只有特殊任務可以',
  }
  const unsupported = (where: string, v: unknown, event: boolean) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach((x) => unsupported(where, x, event))
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'effects' || k === 'rewards') && Array.isArray(x)) {
        for (const e of x as { type?: string }[]) {
          const t = e?.type ?? ''
          if (ALT[t] && (t !== 'enslave_player' || event)) add('warn', '整理', `${where}的效果「${t}」不支援，整理時拿掉了：${ALT[t]}`)
        }
      } else unsupported(where, x, event)
    }
  }
  for (const [id, s] of Object.entries(rawContent.stories ?? {})) unsupported(`特殊任務「${id}」`, s, false)
  for (const [id, e] of Object.entries(rawContent.travelEvents ?? {})) unsupported(`事件「${id}」`, e, true)

  // 2. 套用：有錯誤的特殊任務匯入時不收
  const dropped = dropBrokenStories(mods)
  for (const d of dropped) add('error', '特殊任務', d)
  const problems = applyContent(mods)
  for (const p of problems) add('error', '套用', p)
  for (const id of Object.keys(mods.stories)) {
    const def = stories.find((s) => s.id === id)
    if (!def) continue
    for (const w of storyCheck(def).warnings) add('warn', '特殊任務', `「${def.title}」：${w}`)
  }

  // 3. 一致性
  const npcNames = new Map<string, string[]>()
  for (const n of namedNpcs) npcNames.set(n.name, [...(npcNames.get(n.name) ?? []), n.id])
  for (const [n, ids] of npcNames) if (ids.length > 1) add('warn', '固定 NPC', `名字重複：「${n}」（${ids.join('、')}）`)
  for (const [id, n] of Object.entries(mods.npcs)) {
    if (n.custom && builtinNpcNames.has(n.name)) add('warn', '固定 NPC', `「${n.name}」和內建角色同名`)
    if (!n.fixed && !n.landmark && !n.keeper && !n.haunts?.length && !n.stages?.length) add('info', '固定 NPC', `「${n.name}」（${id}）沒有活躍地點、固定格子、地標或店：要認識之後才找得到`)
    if (!(rawContent.npcs?.[id] as { personality?: string } | undefined)?.personality) add('warn', '固定 NPC', `「${n.name}」沒有寫性格（整理時補上預設的，AI 寫不出他的樣子）`)
  }
  const enemyNames = new Map<string, number>()
  for (const e of Object.values(enemies)) enemyNames.set(e.name, (enemyNames.get(e.name) ?? 0) + 1)
  const placed = new Set<string>()
  for (const v of Object.values(dungeonEncounters)) for (const t of Object.values(v)) for (const g of (Array.isArray(t) ? t : Object.values(t ?? {})) as unknown[]) for (const x of (g as [string, number][] | undefined) ?? []) if (Array.isArray(x)) placed.add(x[0])
  const storyFoes = new Set(stories.flatMap((s) => s.nodes.flatMap((n) => (n.enemies ?? []).map(([id]) => id))))
  for (const m of Object.values(specialMaps)) for (const g of m.table ?? []) for (const [id] of g) placed.add(id)
  for (const [id, e] of Object.entries(mods.enemies)) {
    if (e.custom && builtinEnemyNames.has(e.name)) add('warn', '怪物', `「${e.name}」和內建怪物同名`)
    if ((enemyNames.get(e.name) ?? 0) > 1 && e.custom) add('warn', '怪物', `名字重複：「${e.name}」`)
    if (e.custom && !e.spawns?.length && !storyFoes.has(id) && !placed.has(id)) add('warn', '怪物', `「${e.name}」沒有出現地點，也沒有特殊任務用到：遊戲裡遇不到`)
  }

  // 引用的物品與商店（整理時不拿掉，以免之後的版本新增的東西被誤刪；這裡套用之後檢查，同一包的新物品算數）
  for (const id of Object.keys(mods.enemies)) {
    for (const l of enemies[id]?.loot ?? []) if (!itemDef(l.item)) add('warn', '怪物', `「${enemies[id]!.name}」的掉落「${l.item}」不存在：打贏後會拿到沒有定義的物品`)
  }
  for (const [nm, it] of Object.entries(mods.items)) {
    for (const x of it.recipe?.inputs ?? []) if (!itemDef(x.name)) add('warn', '物品', `「${nm}」的配方材料「${x.name}」不存在：永遠做不出來`)
  }
  for (const [id, n] of Object.entries(mods.npcs)) {
    if (!n.keeper) continue
    const here = blockKeys(n.location).some((k) => settlementArea(k)?.cells.some((c) => c.kind === n.keeper))
    if (!here) add('warn', '固定 NPC', `「${n.name}」（${id}）顧的店「${n.keeper}」不在${locationById(n.location).name}：他不會出現`)
  }

  // 4. 平衡：怪物
  const bosses = bossIds()
  const monsterRows: string[][] = []
  for (const id of Object.keys(mods.enemies)) {
    const e = enemies[id]
    if (!e) continue
    const boss = bosses.has(id) || isLayerBoss(id)
    const d = durability(id, Math.max(6, Math.round(trials / 2)), boss)
    if (boss) {
      const ok = d.roundsToKill >= 3.7 && d.roundsToKill <= 5.9
      if (!ok) add('error', '平衡：怪物', `層主「${e.name}」要 ${d.roundsToKill} 回合才打得倒（目標 4～5.5 回合）：調整生命 hp`)
      monsterRows.push([e.name, String(e.level), '層主', `${d.roundsToKill} 回合`, '', '', ok ? '✅' : '❌'])
      continue
    }
    const hitsOk = d.hitsToKill >= 2.7 && d.hitsToKill <= 5.4
    if (!hitsOk) add('error', '平衡：怪物', `「${e.name}」要挨 ${d.hitsToKill} 下（目標 3～5 下）：調整生命 hp`)
    const area = minionArea(id)
    const f = minionFight(id, Math.max(10, trials))
    const loss = 1 - f.hpLeft
    const [lo, hi] = MINION_LOSS[area]
    const lossOk = loss >= lo - 0.03 && loss <= hi + 0.03 && f.win >= 0.85
    if (!lossOk) add('error', '平衡：怪物', `「${e.name}」兩隻一組每場讓隊伍掉 ${pct(loss)}、勝率 ${pct(f.win)}（${area} 的目標 ${pct(lo)}～${pct(hi)}、勝率 85% 以上）：調整攻擊加成 offense.all`)
    monsterRows.push([e.name, String(e.level), area, `${d.hitsToKill} 下`, pct(loss), pct(f.win), hitsOk && lossOk ? '✅' : '❌'])
  }
  if (monsterRows.length) tables.push({ title: '怪物', head: ['怪物', '等級', '區域', '耐打度', '每場掉的生命', '勝率', ''], rows: monsterRows })

  // 層主戰：這個世界改過或新增的層主，打它那一層的完整遭遇
  const bossRows: string[][] = []
  for (const [dungeon, enc] of Object.entries(dungeonEncounters)) {
    for (const [layer, group] of Object.entries(enc.bosses ?? {})) {
      const boss = group?.[0]?.[0]
      if (!boss || !mods.enemies[boss]) continue
      // 勝率的雜訊大（20 場的標準誤差約 9%）：至少跑 40 場；快速模式（場數少於 20）只提醒、不算錯誤
      const rows = bossFightRows(dungeon, layer, Math.max(trials, BOSS_TRIALS))
      for (const r of rows) {
        const target = BOSS_WIN[layer] ?? 0.85
        const ok = Math.abs(r.win - target) <= 0.1
        if (!ok) add(trials < 20 ? 'warn' : 'error', '平衡：層主戰', `${dungeon} ${layer} 的層主「${r.name}」勝率 ${pct(r.win)}（目標 ${pct(target)} ±10%）：調整 offense.all${trials < 20 ? '（快速模式：交付前用預設場數再確認）' : ''}`)
        bossRows.push([r.name, `${dungeon} / ${layer}`, pct(r.win), pct(target), String(r.rounds), ok ? '✅' : '❌'])
      }
    }
  }
  if (bossRows.length) tables.push({ title: '層主戰', head: ['層主', '位置', '勝率', '目標', '回合數', ''], rows: bossRows })

  // 技能：每行動點的傷害不超過內建同級最強的 1.25 倍
  const baseline = abilityBaseline(builtinAbilities)
  for (const [id, a0] of Object.entries(mods.abilities)) {
    const a = abilities[id]
    if (!a?.damage?.length || a.classes.includes('monster')) continue
    const per = abilityDamage(a) / Math.max(1, abilityApCost(a))
    const base = baseline.get(tierOf(a))
    if (base && per > base * 1.25) add('error', '平衡：技能', `「${a0.name}」每行動點約 ${per.toFixed(1)} 傷害，內建同級（${tierOf(a)}）最強 ${base.toFixed(1)}：降低骰子、倍率或提高行動點`)
  }

  // 物品：裝備依組成定價；其他依種類的內建價格範圍（0.5～2 倍）
  for (const [nm, it] of Object.entries(mods.items)) {
    if (it.gear) {
      const p = gearPrice(it.gear)
      if (it.price_cc < p * 0.6 || it.price_cc > p * 1.6) add('warn', '平衡：物品', `「${nm}」價格 ${it.price_cc}，依組成約 ${p}（差太多會被拿來套利）`)
      continue
    }
    const r = builtinPrices.get(it.category)
    if (r && (it.price_cc < r[0] * 0.5 || it.price_cc > r[1] * 2)) add('warn', '平衡：物品', `「${nm}」價格 ${it.price_cc}，內建的同種類在 ${r[0]}～${r[1]}`)
  }

  // 特質：強度不超過內建最強
  for (const [id, p] of Object.entries(mods.perks)) {
    if (p.race || p.flaw) continue
    const power = perkPower(p)
    if (power > builtinPerkPower) add('error', '平衡：特質', `「${p.name}」（${id}）強度 ${power}，內建最強 ${builtinPerkPower}`)
  }

  // 特殊任務：完成報酬的金錢在階級的報酬範圍 1～3 倍
  for (const [id, s] of Object.entries(mods.stories)) {
    const money = (s.rewards ?? []).filter((e) => e.type === 'money').reduce((t, e) => t + ((e as { amount: number }).amount ?? 0), 0)
    const r = rewardRange((s.rank ?? 'F') as GuildRank)
    if (r && money > r[1] * 3) add('warn', '平衡：特殊任務', `「${s.title}」（${id}）完成報酬 ${money} 白鸛，${s.rank ?? 'F'} 級的委託報酬是 ${r[0]}～${r[1]}（特殊任務建議 1～3 倍）`)
    if (r && money > 0 && money < r[0]) add('info', '平衡：特殊任務', `「${s.title}」完成報酬 ${money} 白鸛，比 ${s.rank ?? 'F'} 級的一般委託（${r[0]} 起）還少`)
  }

  // 5. 提示詞
  if (file.prompts) {
    const p = file.prompts as { lore?: Record<string, unknown>; customLore?: { uid?: unknown; comment?: string; keys?: string[]; mode?: string }[] }
    const custom = p.customLore ?? []
    for (const e of custom) if (typeof e.uid !== 'number' || e.uid < 100000) add('error', '提示詞', `新增的條目「${e.comment ?? '（無標題）'}」的 uid 要是 100000 以上的數字（不然匯入時會被丟掉）`)
    const uids = custom.map((e) => e.uid)
    if (new Set(uids).size !== uids.length) add('error', '提示詞', '新增的條目 uid 重複')
    add('info', '提示詞', `世界書：修改內建條目 ${Object.keys(p.lore ?? {}).length} 條、新增 ${custom.length} 條`)
    for (const e of custom) if (e.mode !== 'constant' && !e.keys?.length) add('warn', '提示詞', `新增的條目「${e.comment ?? '（無標題）'}」不是常駐、也沒有關鍵字：永遠不會注入`)
  } else if (file.kind === 'package') add('info', '提示詞', '世界包沒有提示詞：匯入後沿用目前的提示詞組')

  // 還原成內建的樣子
  applyContent(emptyMods())
  return { name, findings, tables }
}

/** 一座地下城一層的層主戰（balanceSim 的 bossFights 跑全部，這裡只取用到的那一層） */
function bossFightRows(dungeon: string, layer: string, trials: number) {
  return bossFights(trials, 0, { dungeon, layer })
}

/** 報告（Markdown） */
export function reportMarkdown(r: WorldCheckResult): string {
  const count = (l: Level) => r.findings.filter((f) => f.level === l).length
  const lines = [
    `# 世界檢查：${r.name}`,
    '',
    `錯誤 ${count('error')}、提醒 ${count('warn')}、說明 ${count('info')}。錯誤要修到 0（見 worldgen/balance/README.md）。`,
    '',
  ]
  for (const level of ['error', 'warn', 'info'] as const) {
    const list = r.findings.filter((f) => f.level === level)
    if (!list.length) continue
    lines.push(`## ${level === 'error' ? '❌ 錯誤' : level === 'warn' ? '⚠️ 提醒' : 'ℹ️ 說明'}`, '')
    for (const f of list) lines.push(`- **${f.section}**：${f.text}`)
    lines.push('')
  }
  for (const t of r.tables) {
    lines.push(`## ${t.title}`, '', `| ${t.head.join(' | ')} |`, `|${t.head.map(() => '---').join('|')}|`)
    for (const row of t.rows) lines.push(`| ${row.join(' | ')} |`)
    lines.push('')
  }
  return lines.join('\n')
}
