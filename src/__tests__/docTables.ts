// 資料整理型文件的產生器（docs/README.md 第 6 節；做成時的紀錄見 docs/plan/roadmap/COMPLETED.md 的 R7）：MONSTERS、ITEMS、COMBAT_SYSTEM 第 9 節裡照資料檔整理的表格。
// 文件裡用 <!-- gen:名稱 --> 和 <!-- /gen:名稱 --> 包住產生的部分，中間的內容每次重新產生；其他文字照常手寫。
// `npm run docs:gen` 重寫文件，docTables.spec.ts 檢查文件和資料檔一致（改了資料忘記重跑就會失敗）。
import { abilityApCost } from '@/engine/combat'
import { castingAttr } from '@/engine/character'
import { formatMoney } from '@/engine/money'
import { cellName, type CellKind } from '@/engine/grid'
import { baseSlots, gearRules, gearSummary, MOD_NAME, slotName } from '@/engine/gear'
import type { GearSlot } from '@/engine/types'
import { notForSale } from '@/engine/trade'
import { useSummary } from '@/engine/inventory'
import { bindLabel, lockName, schoolDef, schoolIds } from '@/engine/schools'
import { abilities, attrName, classes, itemRules, lewdRules, LOCK_GRADES, perkDef, shopRules, type ItemDef, damageTypeName, dungeonEncounters, enemies, geography, locationById, regionById, stories, wildEncounterTables, type AbilityDef, type AttrId, type EnemyDef } from '@/engine/data'

export interface GenBlock {
  file: string
  name: string
  render: () => string
}

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`
const table = (head: string[], rows: (string | number)[][]) => [row(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(row)].join('\n')

// ---- COMBAT_SYSTEM 第 9 節：各職業能力清單 ----

const CASTER: Record<string, string> = { none: '不施法', half: '半施法者', full: '全施法者' }

function abilityAttr(a: AbilityDef, classId: string): string {
  if (!a.attr) return '—'
  return attrName((a.attr === 'casting' ? castingAttr(classId) : a.attr) as AttrId)
}

function classSection(id: string): string {
  const c = classes[id]!
  const own = Object.values(abilities).filter((a) => a.classes.includes(id))
  const skills = own.filter((a) => a.type === 'skill').sort((a, b) => (a.unlock ?? 1) - (b.unlock ?? 1))
  const spells = own.filter((a) => a.type === 'spell').sort((a, b) => (a.circle ?? 1) - (b.circle ?? 1))
  const cantrips = own.filter((a) => a.type === 'cantrip')
  const caster = c.caster === 'none' ? CASTER.none : `${CASTER[c.caster]}（${attrName(castingAttr(id))}）`
  const out = [`### ${c.name}`, '', `${c.role}。施法：${caster}。初始能力：${c.start.map((s) => abilities[s]?.name ?? s).join('、')}。`]
  if (skills.length) out.push('', '**技能**', '', table(['等級', '名稱', 'AP', '屬性', '效果'], skills.map((a) => [a.unlock ?? 1, a.name, abilityApCost(a), abilityAttr(a, id), a.desc])))
  if (spells.length) out.push('', '**法術**', '', table(['環', '名稱', 'AP', '屬性', '效果'], spells.map((a) => [a.circle ?? 1, a.name, abilityApCost(a), abilityAttr(a, id), a.desc])))
  if (cantrips.length) out.push('', '**戲法**', '', table(['名稱', '屬性', '效果'], cantrips.map((a) => [a.name, abilityAttr(a, id), a.desc])))
  return out.join('\n')
}

function classAbilityLists(): string {
  return Object.entries(classes).filter(([, c]) => !c.noncombat).map(([id]) => classSection(id)).join('\n\n')
}

function monsterAbilities(): string {
  const list = Object.values(abilities).filter((a) => a.classes.includes('monster'))
  // 每場一次的限制寫在資料的 uses，說明文字沒寫
  const desc = (a: AbilityDef) => (a.uses?.per_combat === 1 && !a.desc.includes('每場') ? `${a.desc}每場一次。` : a.desc)
  return table(['名稱', 'AP', '效果'], list.map((a) => [a.name, abilityApCost(a), desc(a)]))
}

// ---- COMBAT_SYSTEM 第 8.5 節：色情技能（不分職業） ----

function lewdAbilities(): string {
  const list = Object.values(abilities).filter((a) => a.classes.includes('lewd')).sort((a, b) => (a.unlock ?? 1) - (b.unlock ?? 1))
  const book = (id: string) => itemRules.items.filter((i) => i.use?.abilities?.includes(id)).map((i) => i.name).join('、') || '—'
  return table(['等級', '名稱', 'AP', '效果', '技能書'], list.map((a) => [a.unlock ?? 1, a.name, abilityApCost(a), a.desc, book(a.id)]))
}

// ---- LEWD_STATS：流派特質、拘束具與鎖 ----

function lewdSchoolTable(): string {
  return table(['流派', '偏向', '定位', '入門', '進階', '受訓（設施、學費）'], schoolIds().map((id) => {
    const d = schoolDef(id)!
    const p = (x: string) => perkDef(x)
    const where = (x: string) => { const t = p(x)?.train; return t ? `${t.cells.map((c) => cellName(c as CellKind) || c).join('、')} ${formatMoney(t.price_cc)}` : '—' }
    return [d.name, d.group, d.role, `**${p(d.entry)?.name}**：${p(d.entry)?.desc}`, `**${p(d.advanced)?.name}**：${p(d.advanced)?.desc}`, `${where(d.entry)}／${where(d.advanced)}`]
  }))
}

/** 拘束具：一件物品一列（程度、自帶的鎖照物品自己的），列出哪裡拿得到與多的加成 */
function restraintTable(): string {
  const SHOP: Record<string, string> = { tailor: '裁縫店', smith: '鐵匠鋪', jeweler: '珠寶店', magic: '魔法物品店', general: '雜貨店' }
  const LAYER: Record<string, string> = { outskirts: '近郊', shallow: '淺層', middle: '中層', deep: '深層', abyss: '底層' }
  const slots = baseSlots()
  const rows = itemRules.items.filter((i) => i.gear && gearRules.bases[i.gear.base]?.bind_kind && !i.gear.fused).map((i) => {
    const b = gearRules.bases[i.gear!.base]!
    const where: string[] = []
    const shops = i.tags.filter((t) => SHOP[t]).map((t) => SHOP[t])
    if (shops.length && !notForSale(i)) {
      const cond = [i.min_location === 'city' ? '城市以上' : i.min_location === 'capital' ? '王都' : '', i.charm_min ? `魅氣 ${i.charm_min} 以上` : ''].filter(Boolean).join('、')
      where.push(`${shops.join('、')}${cond ? `（${cond}）` : ''}`)
    }
    if (i.master_force) where.push(`主人強制${i.master_force.tags?.length ? `（${i.master_force.tags.map((t) => ({ villain: '惡人', noble: '貴族', royal: '皇族' } as Record<string, string>)[t] ?? t).join('、')}）` : ''}`)
    const chests = Object.entries(gearRules.chests).filter(([k, c]) => k !== '$comment' && c.items.some(([n]) => n === i.name)).map(([k]) => LAYER[k] ?? k)
    if (chests.length) where.push(`地下城寶箱（${chests.join('、')}）`)
    if (lewdRules.park.chest_items.some(([n]) => n === i.name)) where.push('園區寶箱')
    if (lewdRules.auction.pool.some(([n]) => n === i.name)) where.push('拍賣會')
    if (Object.values(lewdRules.arena.rings).some((r) => r.rare?.items.includes(i.name))) where.push('淫鬥場的稀有獎品')
    const drop = Object.values(enemies).filter((e) => e.loot?.some((l) => l.item === i.name)).map((e) => e.name)
    if (drop.length) where.push(`擊敗${drop.join('、')}`)
    const g = i.gear!
    const extra = [
      g.lock ? `自帶${lockName(g.lock)}` : '',
      ...Object.entries(g.attrs ?? {}).map(([k, v]) => `${attrName(k as AttrId)} ${v! > 0 ? '+' : ''}${v}`),
      ...Object.entries(g.enchants?.mods ?? {}).map(([k, v]) => `${MOD_NAME[k] ?? k} ${v! > 0 ? '+' : ''}${v}`),
      g.unique ? gearSummary({ base: g.base, material: g.material, unique: g.unique }).split('・').find((x) => x.startsWith('獨特'))?.replace('獨特：', '') ?? '' : '',
    ].filter(Boolean).join('、')
    return [i.name, slots[b.slot] ?? slotName(b.slot as GearSlot), bindLabel(b.bind_kind!, g.bind ?? b.bind!), formatMoney(i.price_cc), where.join('；') || '—', extra || '—']
  })
  return table(['物品', '欄位', '拘束', '價格', '哪裡拿', '另外的加成'], rows)
}

function lockTable(): string {
  return table(['鎖', '倍率', '物品', '價格'], LOCK_GRADES.map((g) => {
    const item = itemRules.items.find((i) => i.lock === g)
    return [lockName(g), `×${lewdRules.locks.grades[g].mult}`, item?.name ?? '—', item ? formatMoney(item.price_cc) : '—']
  }))
}

// ---- MONSTERS：各區域的怪物表 ----

const num = (n: number) => String(Math.round(n * 100) / 100)

function resistText(r: EnemyDef['resist']): string {
  const e = Object.entries(r ?? {}) as [string, number][]
  const imm = e.filter(([, v]) => v <= -1).map(([k]) => damageTypeName(k))
  const res = e.filter(([, v]) => v > -1 && v < 0).map(([k, v]) => `${damageTypeName(k)}×${num(1 + v)}`)
  const weak = e.filter(([, v]) => v > 0).map(([k, v]) => `${damageTypeName(k)}×${num(1 + v)}`)
  const out = [imm.length ? `免疫 ${imm.join('、')}` : '', res.length ? `抵抗 ${res.join('、')}` : '', weak.length ? `弱點 ${weak.join('、')}` : ''].filter(Boolean)
  return out.join('、') || '—'
}

function monsterRow(m: EnemyDef, where: string): (string | number)[] {
  const off = m.offense?.all
  const attack = `${damageTypeName(m.weapon.type)} ${m.weapon.dice}${off !== undefined ? `（傷害 ×${num(1 + off)}）` : ''}`
  const skills = (m.abilities ?? []).map((id) => {
    const below = m.ability_hp_below?.[id]
    return `${abilities[id]?.name ?? id}${below !== undefined ? `（生命 ≤${below}%）` : ''}`
  }).join('、') || '—'
  const loot = [...new Set((m.loot ?? []).map((l) => `${l.item}${l.qty && l.qty > 1 ? `×${l.qty}` : ''}`))].join('、') || '—'
  return [m.name, where, m.level, m.hp, attack, skills, resistText(m.resist), m.rut === 'field' ? '野外' : m.rut ? '✓' : '', m.girl?.name ?? '', `${loot}${m.armed ? '；可能掉裝備' : ''}`, m.desc ?? '']
}

const MONSTER_HEAD = ['怪物', '位置', '等級', '生命', '普通攻擊', '技能', '抗性', '發情', '魔物娘', '掉落', '描述']
const LAYERS = ['outskirts', 'shallow', 'middle', 'deep', 'abyss'] as const
const BOSS_LAYERS = ['shallow', 'middle', 'deep', 'abyss'] as const
const LAYER_NAME: Record<string, string> = { outskirts: '周邊', shallow: '淺層', middle: '中層', deep: '深層', abyss: '底層' }
const regionIds = () => new Set(geography.regions.map((r) => r.id))

/** 城郊遭遇表的怪物：habitats 沒寫地區的是到處都有 */
function wildMonsters(common: boolean): EnemyDef[] {
  const inTables = new Set(Object.values(wildEncounterTables).flatMap((t) => (Array.isArray(t) ? t.flat().map(([id]) => id) : [])))
  const regions = regionIds()
  return Object.values(enemies).filter((m) => inTables.has(m.id) && (m.habitats ?? []).some((h) => regions.has(h)) !== common)
}

function commonTable(): string {
  return table(MONSTER_HEAD, wildMonsters(true).map((m) => monsterRow(m, '各地城郊')))
}

function wildTable(): string {
  const regions = regionIds()
  return table(MONSTER_HEAD, wildMonsters(false).map((m) => monsterRow(m, (m.habitats ?? []).filter((h) => regions.has(h)).map((h) => regionById(h).name).join('、'))))
}

function dungeonTable(id: string): string {
  const enc = dungeonEncounters[id]!
  const seen = new Set<string>()
  const rows: (string | number)[][] = []
  for (const layer of LAYERS) {
    for (const group of enc[layer] ?? []) {
      for (const [mid] of group) {
        if (seen.has(mid) || !enemies[mid]) continue
        seen.add(mid)
        rows.push(monsterRow(enemies[mid]!, LAYER_NAME[layer]!))
      }
    }
  }
  for (const layer of BOSS_LAYERS) {
    const boss = enc.bosses?.[layer]?.[0]?.[0]
    if (boss && enemies[boss]) rows.push(monsterRow(enemies[boss]!, `${LAYER_NAME[layer]}層主`))
  }
  return table(MONSTER_HEAD, rows)
}

/** 特殊任務的替身怪物：不在任何遭遇表裡、只出現在特殊任務的戰鬥 */
function storyTable(): string {
  const used = new Set<string>()
  for (const t of Object.values(wildEncounterTables)) if (Array.isArray(t)) for (const g of t) for (const [id] of g) used.add(id)
  for (const enc of Object.values(dungeonEncounters)) {
    for (const layer of LAYERS) for (const g of enc[layer] ?? []) for (const [id] of g) used.add(id)
    for (const g of Object.values(enc.bosses ?? {})) for (const [id] of g ?? []) used.add(id)
  }
  const titles = new Map<string, string[]>()
  for (const s of stories) {
    for (const n of s.nodes) {
      for (const [id] of n.enemies ?? []) {
        const list = titles.get(id) ?? []
        if (!list.includes(s.title)) list.push(s.title)
        titles.set(id, list)
      }
    }
  }
  const head = MONSTER_HEAD.map((h) => (h === '位置' ? '任務' : h))
  const rows = Object.values(enemies).filter((m) => !used.has(m.id) && titles.has(m.id)).map((m) => {
    const r = monsterRow(m, titles.get(m.id)!.join('、'))
    if (m.ability_hp_below) r[0] = `${m.name}（頭目）`
    // 說明文字最後的「（特殊任務「…」）」和任務欄重複
    r[9] = String(r[9]).replace(/（特殊任務[^）]*）$/, '')
    return r
  })
  return table(head, rows)
}

function monsterBlocks(): GenBlock[] {
  const file = 'docs/MONSTERS.md'
  const dungeons = geography.locations.filter((l) => l.type === 'dungeon' && dungeonEncounters[l.id]).map((l) => l.id)
  return [
    { file, name: 'monsters-common', render: commonTable },
    { file, name: 'monsters-wild', render: wildTable },
    ...dungeons.map((id) => ({ file, name: `monsters-${id}`, render: () => dungeonTable(id) })),
    { file, name: 'monsters-story', render: storyTable },
  ]
}

// ---- ITEMS 4.3：制式裝備（不是獨特、沒有屬性加減、主人不會強制裝備的裝備；多半就是材料＋底材） ----

const STANDARD_SLOTS: [string, string[]][] = [
  ['主手', ['main_hand']], ['副手', ['off_hand']], ['頭部', ['head']], ['上身', ['body']], ['下身', ['legs']], ['手腕', ['wrists']], ['鞋子', ['feet']],
  ['腰帶', ['belt']], ['戒指（兩格）', ['ring']], ['首飾', ['accessory']], ['穿孔飾品（兩格）', ['piercing']], ['腿部飾品', ['leg_accessory']],
  ['內衣、內褲', ['underwear_top', 'underwear_bottom']],
]
const MIN_LOCATION: Record<string, string> = { town: '（城鎮以上）', port: '（城鎮以上）', city: '（城市以上）', capital: '（王都）' }

/** 賣這件東西的店（流浪商人不算：他的貨是隨機的） */
function soldAt(i: ItemDef): string {
  if (notForSale(i)) return '不在商店販售'
  const shops = Object.entries(shopRules.types).filter(([id, t]) => id !== 'wanderer' && i.tags.includes(t.catalog_tag)).map(([, t]) => t.name)
  if (!shops.length) return '不在商店販售'
  return `${[...new Set(shops)].join('、')}${MIN_LOCATION[i.min_location ?? ''] ?? ''}`
}

function standardGear(): string {
  const bases = Object.keys(gearRules.bases)
  const std = itemRules.items.filter((i) => i.category === 'equipment' && i.gear && !notForSale(i) && gearRules.bases[i.gear.base])
  const out: string[] = []
  for (const [title, slots] of STANDARD_SLOTS) {
    const list = std.filter((i) => slots.includes(gearRules.bases[i.gear!.base]!.slot))
      .sort((a, b) => bases.indexOf(a.gear!.base) - bases.indexOf(b.gear!.base))
    if (!list.length) continue
    out.push(`#### ${title}`, '', table(['裝備', '數值', '價格', '販售'], list.map((i) => [i.name, gearSummary(i.gear!), formatMoney(i.price_cc), soldAt(i)])), '')
  }
  return out.join('\n').trimEnd()
}

// ---- ITEMS 第 6 節：消耗品、卷軸、書籍 ----

function usableTable(category: string): string {
  const list = itemRules.items.filter((i) => i.category === category && !i.use?.perks && !i.use?.abilities)
  return table(['物品', '效果', '價格', '販售', '說明'], list.map((i) => [i.name, useSummary(i.use), formatMoney(i.price_cc), soldAt(i), i.desc ?? '']))
}

function skillBookTable(): string {
  const list = itemRules.items.filter((i) => i.use?.abilities)
  return table(['書', '價格', '販售', '依序學會'], list.map((i) => [i.name, formatMoney(i.price_cc), soldAt(i), i.use!.abilities!.map((id) => `${abilities[id]?.name ?? id}（${abilities[id]?.unlock ?? 1} 級）`).join('、')]))
}

function bookTable(): string {
  const list = itemRules.items.filter((i) => i.use?.perks)
  return table(['書', '價格', '販售', '特質'], list.map((i) => [i.name, formatMoney(i.price_cc), soldAt(i), i.use!.perks!.map((p) => perkDef(p)?.name ?? p).join('、')]))
}

export const BLOCKS: GenBlock[] = [
  { file: 'docs/COMBAT_SYSTEM.md', name: 'class-abilities', render: classAbilityLists },
  { file: 'docs/COMBAT_SYSTEM.md', name: 'monster-abilities', render: monsterAbilities },
  { file: 'docs/COMBAT_SYSTEM.md', name: 'lewd-abilities', render: lewdAbilities },
  { file: 'docs/LEWD_STATS.md', name: 'lewd-schools', render: lewdSchoolTable },
  { file: 'docs/LEWD_STATS.md', name: 'restraints', render: restraintTable },
  { file: 'docs/LEWD_STATS.md', name: 'locks', render: lockTable },
  ...monsterBlocks(),
  { file: 'docs/ITEMS.md', name: 'items-standard', render: standardGear },
  { file: 'docs/ITEMS.md', name: 'items-consumables', render: () => usableTable('consumable') },
  { file: 'docs/ITEMS.md', name: 'items-scrolls', render: () => usableTable('scroll') },
  { file: 'docs/ITEMS.md', name: 'items-books', render: bookTable },
  { file: 'docs/ITEMS.md', name: 'items-skill-books', render: skillBookTable },
]

/** 把文件裡每個產生區塊換成新的內容；回傳新的全文 */
export function fill(text: string, blocks: GenBlock[]): string {
  let out = text
  for (const b of blocks) {
    const begin = `<!-- gen:${b.name} -->`
    const end = `<!-- /gen:${b.name} -->`
    const i = out.indexOf(begin)
    const j = out.indexOf(end)
    if (i < 0 || j < i) throw new Error(`${b.file} 找不到產生區塊 ${b.name}`)
    out = `${out.slice(0, i + begin.length)}\n\n${b.render()}\n\n${out.slice(j)}`
  }
  return out
}
