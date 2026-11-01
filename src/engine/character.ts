// 角色：屬性、三資源（生命值、行動點、法術環）的推導、升級與能力學習。
// 公式說明見 docs/COMBAT_SYSTEM.md，數值在 data/rules/combat.json。

import { pcTagSummary } from './pcTags'
import { parasiteSummary, parasitesOf } from './parasites'
import { levelUpPerkOffer, npcPerksOf, perkCombat, perksOf } from './perks'
import {
  abilities as abilityTable, ATTR_IDS, armorDef, attributeRules, classAbilities, classDef, classes, combatRules, genderPrompt, progression, weaponDef,
  type AbilityDef, type AffinityMap, type AttrId, type Attrs, type Mods, type NpcDef, type WeaponDef,
  mulResist,
} from './data'
import { gearBonuses, gearName, gearRules, generateLoadout, startingGear, syncGear, wearDefaultUnderwear } from './gear'
import { bodyOf } from './traits'
import { dressNpc } from './outfits'
import { tattoosOf, tattooSummary } from './tattoos'
import { npcLewd } from './lewd'
import type { Rng } from './rng'
import type { ActorState, Character, GuildRank, SkillQuality } from './types'

const QUALITY_ORDER: SkillQuality[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']

// ---- 基本換算 ----

/** 屬性調整值 = floor((屬性值 - 10) / 2) */
export function mod(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function proficiency(level: number): number {
  const { base, every_levels } = combatRules.proficiency
  return base + Math.floor((level - 1) / every_levels)
}

export function lifeTier(level: number): number {
  return progression.life_tiers.find((t) => level >= t.levels[0] && level <= t.levels[1])?.tier ?? 1
}

export function maxSkillQuality(level: number): SkillQuality {
  return progression.life_tiers.find((t) => t.tier === lifeTier(level))?.max_skill_quality ?? 'common'
}

export function guildRankFor(level: number): GuildRank {
  const ranks = progression.guild_ranks
  return ranks.find((r) => level >= r.levels[0] && level <= r.levels[1])?.rank ?? ranks[ranks.length - 1]!.rank
}

export function xpToNext(level: number): number {
  return combatRules.xp_to_next_level_per_level * level
}

export function affinityStage(value: number): string {
  return progression.affinity.stages.find((s) => value >= s.range[0] && value <= s.range[1])?.name ?? ''
}

/** 角色扮演指導第一層：觀察者對目標的基準態度（以生命層級差計算）。 */
export function powerGapAttitude(observerLevel: number, targetLevel: number): string {
  const { by_diff, clamp } = progression.power_gap_attitude
  const diff = Math.max(clamp[0], Math.min(clamp[1], lifeTier(observerLevel) - lifeTier(targetLevel)))
  return by_diff[String(diff)] ?? '對等'
}

// ---- 有效屬性 ----
//
// c.attrs 是基礎屬性：建角與升級時分配、受 attributes.json 的上限限制，配點與升級只改它。
// 其他地方（檢定、戰鬥、生命值、行動點、法術環）一律讀 attrsOf(c)：基礎屬性加上各種來源的加減
// （誓約印記，以及用 addAttrProvider 登記的），夾在 score.min～score.max。來源移除時不需要把加減扣回去。

/** 屬性加減的一個來源：名稱與各屬性的加減 */
export interface AttrSource { label: string; attrs: Partial<Attrs> }
export type AttrProvider = (c: Character) => AttrSource[]

const attrProviders: AttrProvider[] = []

/** 登記一種屬性加減的來源（回傳取消登記的函式） */
export function addAttrProvider(p: AttrProvider): () => void {
  attrProviders.push(p)
  return () => {
    const i = attrProviders.indexOf(p)
    if (i >= 0) attrProviders.splice(i, 1)
  }
}

/** 裝備給的屬性加減：每件一個來源；同一項合計超過上限（gear.json 的 attrs.cap）時加一項扣回來 */
function gearAttrSources(c: Character): AttrSource[] {
  const list = Object.values(c.gear ?? {}).filter((g) => g?.spec.attrs).map((g) => ({ label: `裝備【${g!.name}】`, attrs: g!.spec.attrs! }))
  const cap = gearRules.attrs.cap
  const over: Partial<Attrs> = {}
  for (const a of ATTR_IDS) {
    const sum = list.reduce((s, x) => s + (x.attrs[a] ?? 0), 0)
    if (Math.abs(sum) > cap) over[a] = Math.sign(sum) * cap - sum
  }
  return Object.keys(over).length ? [...list, { label: `裝備的加減上限 ±${cap}`, attrs: over }] : list
}

/** 角色身上所有的屬性加減（給畫面與 AI 說明來源）：誓約印記、裝備，加上登記的來源 */
export function attrSources(c: Character): AttrSource[] {
  const oaths = (c.tattoos ?? []).filter((t) => (t.kind === 'oath' || (t.kind === 'curse' && t.tamed)) && t.attrs)
    .map((t) => ({ label: `${t.kind === 'oath' ? '誓約印記' : '印記'}【${t.name ?? ''}】`, attrs: t.attrs! }))
  return [...oaths, ...gearAttrSources(c), ...attrProviders.flatMap((p) => p(c))].filter((s) => ATTR_IDS.some((a) => s.attrs[a]))
}

/** 有效屬性：基礎屬性加上所有來源的加減 */
export function attrsOf(c: Character): Attrs {
  const out = { ...c.attrs }
  const { min, max } = attributeRules.score
  for (const s of attrSources(c)) for (const a of ATTR_IDS) out[a] += s.attrs[a] ?? 0
  for (const a of ATTR_IDS) out[a] = Math.max(min, Math.min(max, out[a]))
  return out
}

/** 一項屬性的有效值 */
export function attrOf(c: Character, a: AttrId): number {
  return attrsOf(c)[a]
}

// ---- 三資源 ----

/** 生命值 = base + 等級 × max(下限, per_level + mod(力量) + mod(信仰)) */
export function maxHpFor(level: number, attrs: Attrs): number {
  const r = combatRules.hp
  return r.base + level * Math.max(r.min_per_level, r.per_level + mod(attrs.str) + mod(attrs.fai))
}

/** 行動點上限 = base + floor(等級 / 5) + floor((mod(靈巧) + mod(魅力)) / 2)，至少 min */
export function apMaxFor(level: number, attrs: Attrs): number {
  const r = combatRules.ap
  return Math.max(r.min, r.base + Math.floor(level / r.every_levels) + Math.floor((mod(attrs.dex) + mod(attrs.cha)) / 2))
}

/** 每回合回復的行動點 */
export function apRegenFor(level: number): number {
  const r = combatRules.ap
  return r.regen + Math.floor(level / r.regen_every_levels)
}

/** 法術環上限（索引 0 = 1 環）。依職業的施法者類型查表，再加上智力與信仰帶來的額外法術環。 */
export function slotMaxFor(classId: string, level: number, attrs: Attrs): number[] {
  const cls = classDef(classId)
  if (cls.caster === 'none') return []
  const table = combatRules.spell_slots
  const casterLevel = cls.caster === 'full' ? level : Math.ceil(level / 2)
  let slots = [...(table.full[String(Math.max(1, Math.min(20, casterLevel)))] ?? [])]
  if (cls.caster === 'half') slots = slots.slice(0, table.half_max_circle)
  const s = mod(attrs.int) + mod(attrs.fai)
  for (let c = 1; c <= table.bonus_max_circle; c++) {
    if ((slots[c - 1] ?? 0) > 0 && s >= 2 * c) slots[c - 1]! += 1
  }
  return slots
}

export function maxCircle(c: Character): number {
  return slotMaxFor(c.class, c.level, attrsOf(c)).length
}

export function slotsLeft(c: Character): number[] {
  return slotMaxFor(c.class, c.level, attrsOf(c)).map((n, i) => Math.max(0, n - (c.slotsUsed[i] ?? 0)))
}

export function maxCantrips(level: number): number {
  const r = combatRules.cantrip
  return r.known_base + Math.floor(level / r.known_every_levels)
}

// ---- 戰鬥屬性 ----

export function castingAttr(classId: string): AttrId {
  return classDef(classId).casting ?? classDef(classId).priority[0]!
}

/** 幸運一擊閾值（自然骰 ≥ 此值）。屬性造成的下限為 attr_floor；crit 修正另外扣除，最低到 floor。 */
export function luckyThreshold(attrs: Attrs, critBonus = 0): number {
  const r = combatRules.lucky
  const fromAttrs = Math.max(r.attr_floor, r.base - Math.floor((mod(attrs.dex) + mod(attrs.cha)) / 3))
  return Math.max(r.floor, fromAttrs - critBonus)
}

/** 迴避骰的下限：1 + max(0, mod(靈巧)) */
export function evadeFloor(attrs: Attrs): number {
  return combatRules.hit.evade_floor_base + Math.max(0, mod(attrs.dex))
}

export function weaponFor(c: Pick<Character, 'weapon' | 'level'>): WeaponDef {
  const w = weaponDef(c.weapon)
  if (!w.scale) return w
  let dice = w.dice
  for (const [lvl, d] of Object.entries(w.scale)) if (c.level >= Number(lvl)) dice = d
  return { ...w, dice }
}

/** 防具類型 + 身上所有裝備（材料、附魔）+ 特質（包括種族特質）+ 職業（武僧的卸力）帶來的傷害倍率加減與戰鬥修正 */
export function gearAffinities(c: Pick<Character, 'race' | 'class' | 'armor' | 'gear' | 'perks' | 'customPerks'>): { resist: AffinityMap; offense: AffinityMap; mods: Mods } {
  const armor = armorDef(c.armor)
  const gear = gearBonuses(c)
  // 特質（包括依種族自動擁有的種族特質）：一直生效的戰鬥修正、抗性與增傷
  const perks = perkCombat(c)
  const resist: AffinityMap = {}
  const offense: AffinityMap = {}
  for (const src of [armor.resist, gear.resist, perks.resist, classes[c.class]?.resist]) mulResist(resist, src)
  for (const src of [armor.offense, gear.offense, perks.offense]) {
    for (const [k, v] of Object.entries(src ?? {})) offense[k] = (offense[k] ?? 0) + (v ?? 0)
  }
  const mods: Mods = {}
  for (const src of [gear.mods, perks.mods]) {
    for (const [k, v] of Object.entries(src)) mods[k as keyof Mods] = (mods[k as keyof Mods] ?? 0) + (v ?? 0)
  }
  return { resist, offense, mods }
}

// ---- 建立角色 ----

/** 職業基礎陣列依優先順序分配，再加種族加值。 */
export function baseAttrs(classId: string, race: string): Attrs {
  const array = attributeRules.creation.array
  const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, 10])) as Attrs
  classDef(classId).priority.forEach((a, i) => (attrs[a] = array[i] ?? 10))
  for (const [a, v] of Object.entries(attributeRules.races[race]?.bonus ?? {})) attrs[a as AttrId] += v ?? 0
  return attrs
}

/** 依等級與屬性重算推導值（目前只有最大生命值），生命值不超過上限。 */
export function recalc(c: Character): Character {
  const before = c.maxHp
  c.maxHp = maxHpFor(c.level, attrsOf(c))
  if (c.maxHp > before) c.hp += c.maxHp - before
  c.hp = Math.min(c.hp, c.maxHp)
  return c
}

function baseCharacter(id: string, name: string, race: string, classId: string, attrs: Attrs): Character {
  const cls = classDef(classId)
  const maxHp = maxHpFor(1, attrs)
  return {
    id, name, race, class: classId, level: 1, xp: 0,
    attrs, attrPoints: 0,
    hp: maxHp, maxHp,
    slotsUsed: [], usesPerRest: {},
    abilities: [...cls.start],
    weapon: cls.weapon, armor: cls.armor,
    status: [],
  }
}

/** bonus：建角時自由分配的屬性點（合計不超過 creation.bonus_points，單項不超過 max_score）。 */
export function createPlayer(name: string, race: string, classId: string, bonus: Partial<Attrs> = {}): Character {
  const attrs = baseAttrs(classId, race)
  const { bonus_points, max_score } = attributeRules.creation
  let budget = bonus_points
  for (const a of ATTR_IDS) {
    const add = Math.max(0, Math.min(bonus[a] ?? 0, budget, max_score - attrs[a]))
    attrs[a] += add
    budget -= add
  }
  const c: Character = { ...baseCharacter('pc', name, race, classId, attrs), isPlayer: true }
  // 主角從職業的基本配備開始（第一級材料）
  c.gear = startingGear(classId)
  syncGear(c, classDef(classId).weapon)
  return c
}

/** NPC 依等級自動成長：屬性點加在主屬性，能力依名字決定的固定順序挑選。 */
export function createNpc(def: NpcDef, rng: Rng): Character {
  const c: Character = {
    ...baseCharacter(def.id, def.name, def.race, def.class, baseAttrs(def.class, def.race)),
    personality: def.personality,
    ...(def.faction ? { faction: def.faction } : {}),
    ...(def.gender ? { gender: def.gender } : {}),
    affinity: progression.affinity.initial,
  }
  while (c.level < def.level) {
    c.level += 1
    c.attrs[classDef(c.class).priority[0]!] += attributeRules.level_up_points
    const choice = abilityChoices(c, rng)[0]
    if (choice) c.abilities.push(choice)
  }
  // 夥伴與敵對冒險者：依等級即時生成裝備
  c.gear = generateLoadout(c.class, c.level, rng, c.race)
  // 固定 NPC：內容頁籤設定的屬性、能力與裝備取代生成的
  for (const a of ATTR_IDS) {
    const v = def.attrs?.[a]
    if (v) c.attrs[a] = v
  }
  if (def.abilities?.length) c.abilities = [...new Set(def.abilities.filter((id) => !!abilityTable[id]))]
  if (def.gear) {
    c.gear = {}
    for (const [slot, spec] of Object.entries(def.gear)) {
      if (spec && gearRules.bases[spec.base] && gearRules.materials[spec.material]) c.gear[slot as keyof typeof c.gear] = { name: gearName(spec), spec: { ...spec } }
    }
  }
  // 依身分補上服裝（頭、鞋、腿飾、內衣褲……空著的欄位），再依性別穿上預設的內衣、內褲；固定 NPC 指定了的欄位不動
  dressNpc(c, def)
  wearDefaultUnderwear(c, bodyOf(def.race, def.gender))
  if (def.appearance) c.appearance = def.appearance
  if (def.background) c.background = def.background
  // 特質：資料裡指定的，沒有時依 id 固定地抽
  const perks = npcPerksOf(def)
  if (perks.length) c.perks = [...new Set(perks)]
  // 慾望指標：依標籤與 id 固定地擲（固定 NPC 寫了的優先）
  c.lewd = npcLewd(def)
  syncGear(c, classDef(c.class).weapon)
  recalc(c)
  c.hp = c.maxHp
  return c
}

// ---- 能力學習 ----

export function abilityQuality(a: AbilityDef): SkillQuality {
  if (a.type === 'cantrip') return 'common'
  if (a.type === 'spell') return combatRules.quality_by_circle[(a.circle ?? 1) - 1] ?? 'legendary'
  const lvl = a.unlock ?? 1
  return combatRules.quality_by_level.find((q) => lvl >= q.levels[0] && lvl <= q.levels[1])?.quality ?? 'legendary'
}

/** 目前可以學的能力：技能看解鎖等級、法術看是否擁有該環、戲法看可學數量；品質不超過生命層級上限。 */
export function learnable(c: Character): AbilityDef[] {
  const cap = QUALITY_ORDER.indexOf(maxSkillQuality(c.level))
  const circles = maxCircle(c)
  const cantripsKnown = c.abilities.filter((id) => classAbilities(c.class).find((a) => a.id === id)?.type === 'cantrip').length
  return classAbilities(c.class).filter((a) => {
    if (c.abilities.includes(a.id)) return false
    if (QUALITY_ORDER.indexOf(abilityQuality(a)) > cap) return false
    if (a.type === 'skill') return (a.unlock ?? 1) <= c.level
    if (a.type === 'spell') return (a.circle ?? 1) <= circles
    return cantripsKnown < maxCantrips(c.level)
  })
}

/** 升級時的能力三選一 */
export function abilityChoices(c: Character, rng: Rng, count = 3): string[] {
  const pool = learnable(c)
  const picked: string[] = []
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!.id)
  }
  return picked
}

/** 這組能力選項還能重抽幾次。max 為每組的重抽上限（玩家可在設定中調整，預設見 progression.json）。 */
export function rerollsLeft(c: Character, max = progression.ability_rerolls): number {
  return c.pendingAbilityChoices?.length ? Math.max(0, max - (c.abilityRerollsUsed ?? 0)) : 0
}

/** 重抽升級時的能力三選一：盡量換成目前沒出現的能力。 */
export function rerollAbilityChoices(c: Character, rng: Rng, max = progression.ability_rerolls): string[] {
  const current = c.pendingAbilityChoices?.[0]
  if (!current) throw new Error('沒有待選的能力')
  if (rerollsLeft(c, max) <= 0) throw new Error('這次升級已經不能再重抽了')
  const fresh = learnable(c).filter((a) => !current.includes(a.id))
  if (!fresh.length) throw new Error('沒有其他可以學的能力了')
  const picked: string[] = []
  while (picked.length < current.length && fresh.length) picked.push(fresh.splice(rng.int(0, fresh.length - 1), 1)[0]!.id)
  // 新的能力不夠三個時，用原本的選項補上
  for (const id of current) if (picked.length < current.length && !picked.includes(id)) picked.push(id)
  c.pendingAbilityChoices![0] = picked
  c.abilityRerollsUsed = (c.abilityRerollsUsed ?? 0) + 1
  return picked
}

/** 學會一項能力（事件、任務的技能報酬、技能書）。必須是這個職業的能力或不分職業的色情技能，且尚未學會。 */
export function learnAbility(c: Character, id: string): AbilityDef {
  const a = classAbilities(c.class).find((x) => x.id === id) ?? (abilityTable[id]?.classes.includes('lewd') ? abilityTable[id] : undefined)
  if (!a) throw new Error('這個職業學不了這項能力')
  if (c.abilities.includes(id)) throw new Error('已經學會了')
  c.abilities.push(id)
  return a
}

/** 技能書下一個能學的能力：還沒學、學得了（自己職業的或色情技能）的第一個；等級不夠時回傳原因 */
export function nextBookAbility(c: Character, list: string[]): { ability?: AbilityDef; reason?: string } {
  const open = list.map((id) => abilityTable[id]).filter((a): a is AbilityDef => !!a && !c.abilities.includes(a.id)
    && (a.classes.includes('lewd') || classAbilities(c.class).some((x) => x.id === a.id)))
  if (!open.length) return { reason: `${c.name}已經學會書裡能學的能力了` }
  const ready = open.find((a) => (a.unlock ?? 1) <= c.level)
  if (ready) return { ability: ready }
  const next = open[0]!
  return { reason: `等級不夠：書裡下一個能力【${next.name}】要 ${next.unlock} 級` }
}

// ---- 技能攜帶上限（存檔規則 skillLoadout）：學會的能力都在技能庫，戰鬥只帶攜帶中的；戲法不算 ----

/** 這項能力算不算進攜帶上限（戲法有自己的上限，一直都帶著） */
export function countsForLoadout(id: string): boolean {
  return abilityTable[id]?.type !== 'cantrip'
}

/**
 * 攜帶中、算進上限的能力（依學會的順序）。cap 為 0 表示不限。
 * 沒選過時（以及上限調低、選的比上限多時）自動挑：先帶職業的起始能力（重擊、偷襲、治療術這類核心技能），其他帶最近學會的。
 */
function carriedCounted(c: Pick<Character, 'abilities' | 'loadout' | 'class'>, cap: number): string[] {
  const counted = c.abilities.filter(countsForLoadout)
  if (cap <= 0) return counted
  const picked = c.loadout ? counted.filter((id) => c.loadout!.includes(id)) : counted
  if (picked.length <= cap) return picked
  const core = new Set((classDef(c.class)?.start ?? []).filter((id) => picked.includes(id)).slice(0, cap))
  const room = cap - core.size
  const rest = room > 0 ? picked.filter((id) => !core.has(id)).slice(-room) : []
  const keep = new Set([...core, ...rest])
  return picked.filter((id) => keep.has(id))
}

/** 戰鬥時帶上的能力：攜帶中的技能與法術，加上所有戲法 */
export function carriedAbilities(c: Character, cap: number): string[] {
  const keep = new Set(carriedCounted(c, cap))
  return c.abilities.filter((id) => !countsForLoadout(id) || keep.has(id))
}

/** 攜帶了幾個、技能庫還有幾個（都不算戲法） */
export function loadoutUsage(c: Character, cap: number): { carried: number; library: number } {
  const carried = carriedCounted(c, cap).length
  return { carried, library: c.abilities.filter(countsForLoadout).length - carried }
}

/** 剛學會一項能力（已經放進 abilities）：還有空位就帶上，滿了就留在技能庫。回傳有沒有帶上 */
export function carryLearned(c: Character, id: string, cap: number): boolean {
  if (cap <= 0 || !countsForLoadout(id)) return true
  const before = carriedCounted({ abilities: c.abilities.filter((x) => x !== id), loadout: c.loadout, class: c.class }, cap)
  if (before.length < cap) {
    if (c.loadout) c.loadout = [...before, id]
    return true
  }
  // 帶滿了：記下原本帶的，新學的留在技能庫（不擠掉舊的）
  c.loadout = before
  return false
}

/** 把一項學會的技能或法術帶上，或放回技能庫 */
export function setCarried(c: Character, id: string, on: boolean, cap: number) {
  if (!c.abilities.includes(id)) throw new Error('還沒學會這項能力')
  if (!countsForLoadout(id)) throw new Error('戲法不算在攜帶上限裡，一直都帶著')
  if (cap <= 0) throw new Error('目前不限攜帶數量，全部都帶著')
  const now = carriedCounted(c, cap)
  if (on) {
    if (now.includes(id)) return
    if (now.length >= cap) throw new Error(`已經帶滿 ${cap} 個，先放回一個`)
    c.loadout = [...now, id]
  } else c.loadout = now.filter((x) => x !== id)
}

/** 加經驗值並處理升級；回傳升了幾級。會直接修改角色。 */
export function gainXp(c: Character, amount: number, rng: Rng): number {
  c.xp += amount
  let gained = 0
  while (c.level < 20 && c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level)
    c.level += 1
    gained += 1
    c.attrPoints += attributeRules.level_up_points
    recalc(c)
    const choices = abilityChoices(c, rng)
    if (choices.length > 0) c.pendingAbilityChoices = [...(c.pendingAbilityChoices ?? []), choices]
    // 特質：到了特定等級多一次三選一（perks.json 的 levelup）
    levelUpPerkOffer(c, c.level, rng)
  }
  return gained
}

/** 分配一點屬性點 */
export function spendAttrPoint(c: Character, attr: AttrId): void {
  if (c.attrPoints <= 0) throw new Error('沒有可分配的屬性點')
  if (c.attrs[attr] >= attributeRules.score.max) throw new Error('屬性已達上限')
  c.attrs[attr] += 1
  c.attrPoints -= 1
  recalc(c)
}

// ---- 報告 ----

/**
 * 報告用的角色快照。player 傳入時，NPC 隊友會附上對主角的態度
 * （角色扮演指導：實力差 → 親密值；立場與性格交給 AI 依 personality 演繹）。
 */
export function snapshot(c: Character, before?: Character, player?: Character): ActorState {
  const b = before ?? c
  const state: ActorState = {
    id: c.id,
    name: c.name,
    race: c.race,
    class: c.class,
    level: c.level,
    rank: guildRankFor(c.level),
    hp: [b.hp, c.hp, c.maxHp],
    status: [...c.status],
    equipment: c.gear ? Object.values(c.gear).filter((g) => !!g).map((g) => g!.name) : [weaponDef(c.weapon).name, armorDef(c.armor).name],
  }
  if (c.personality) state.personality = c.personality
  // 報告的角色快照交給 AI：偽娘、TS、扶她附上身體的說明
  if (c.gender) state.gender = genderPrompt(c.gender)
  if (player && !c.isPlayer && c.affinity !== undefined) {
    state.attitude = `${powerGapAttitude(c.level, player.level)} / ${affinityStage(c.affinity)}`
  }
  return state
}

/** 主角的設定（性別、出身、外貌、背景），交給 AI 參考。 */
export function protagonistText(c: Character, birthplaceName?: string): string {
  const lines = [
    `${c.name}｜${c.gender ? `${genderPrompt(c.gender)}｜` : ''}${attributeRules.races[c.race]?.name ?? c.race}・${classDef(c.class).name} Lv.${c.level}${birthplaceName ? `｜出身：${birthplaceName}` : ''}`,
    c.tags?.length ? `身分：${pcTagSummary(c)}` : '',
    c.appearance ? `外貌：${c.appearance}` : '',
    c.background ? `背景：${c.background}` : '',
    perksOf(c).length ? `特質：${perksOf(c).map((p) => (p.flaw ? `${p.name}（缺陷）` : p.name)).join('、')}` : '',
    tattoosOf(c).length ? `刺青：\n${tattooSummary(c)}` : '',
    parasitesOf(c).length ? `寄生物：\n${parasiteSummary(c)}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export type ProfilePatch = Partial<Pick<Character, 'gender' | 'appearance' | 'background'>> & {
  /** 體型（裝備欄、刺青的人形圖）；空字串＝依種族與性別 */
  body?: Character['body'] | ''
}

/** 修改主角設定（名字以外的文字欄位與體型） */
export function editProfile(c: Character, patch: ProfilePatch) {
  if (patch.body !== undefined) {
    if (patch.body === 'masc' || patch.body === 'fem' || patch.body === 'andro') c.body = patch.body
    else delete c.body
  }
  for (const k of ['gender', 'appearance', 'background'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    const t = v.trim().slice(0, k === 'background' ? 800 : k === 'appearance' ? 600 : 20)
    if (t) c[k] = t
    else delete c[k]
  }
}
