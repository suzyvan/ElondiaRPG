// 刺青（docs/TATTOOS.md）：身上 11 個部位各一個，分成奴隸印記、誓約印記、普通刺青。
//
// - 奴隸印記：契約（ContractRef）掛在刺青上，用 contractOf / setContract / clearContract 存取；條款在刻印時存一份。
// - 誓約印記：屬性有加有減、加總為 0（tattoos.json 的 oath），由 character.ts 的 attrsOf 算進有效屬性。
// - 普通刺青：只是外觀，寫進給 AI 的主角資料。

import { displaceCurse, storeTamedCurse } from './parasites'
import tattooJson from '@data/rules/tattoos.json'
import { ATTR_IDS, attrName, type AttrId } from './data'
import type { Character, ContractRef, GameTime, Tattoo, TattooKind, TattooPlace } from './types'

export interface TattooTemplate {
  kind: 'plain' | 'oath'
  name: string
  desc: string
  /** 建議的部位（沒有時任何部位都可以） */
  places?: TattooPlace[]
  /** 誓約印記的屬性加減 */
  attrs?: Partial<Record<AttrId, number>>
  /** 淫紋（成人向）：慾望戰鬥的效果，max 慾望上限的比例、bonus 造成的慾望 +N（docs/LEWD_STATS.md 第 14 節） */
  lust?: { max?: number; bonus?: number }
  /** 刺這個圖樣另外加的價錢 */
  price?: number
  adult?: boolean
  /** 紋著的時候泌乳（淫紋・乳泉；docs/FAMILY.md 第 10 節） */
  lactation?: boolean
  /** 受孕倍率（淫紋・子宮 1.5；docs/FAMILY.md 第 3 節） */
  fertility?: number
  /** 內容標籤（content.ts）：內容篩選關掉時刺青店不列出 */
  content_tags?: string[]
}

export const tattooRules = tattooJson as unknown as {
  places: Record<TattooPlace, string>
  kinds: Record<TattooKind, string>
  oath: { max_attrs: number; max_change: number; max_per_character: number }
  /** 替隊伍裡的人刺青：自由的夥伴要多少親密度（或淫亂）才肯（tattooShop.ts 的 inkConsent） */
  companion: { min_affinity: number; oath_min_affinity: number; adult_min_affinity: number; adult_min_lewdness: number }
  templates: Record<string, TattooTemplate>
}

export const TATTOO_PLACES = Object.keys(tattooRules.places) as TattooPlace[]

export function isTattooPlace(x: unknown): x is TattooPlace {
  return typeof x === 'string' && TATTOO_PLACES.includes(x as TattooPlace)
}

export function placeName(p: TattooPlace): string {
  return tattooRules.places[p] ?? p
}

export function tattooKindName(k: TattooKind): string {
  return tattooRules.kinds[k] ?? k
}

export function tattooTemplate(id: string): TattooTemplate | undefined {
  return tattooRules.templates[id]
}

// ---- 身上的刺青 ----

export function tattoosOf(c: Pick<Character, 'tattoos'> | undefined): Tattoo[] {
  return c?.tattoos ?? []
}

/** 身上淫紋的慾望效果（依圖樣，加總） */
export function tattooLust(c: Pick<Character, 'tattoos'> | undefined): { max: number; bonus: number } {
  let max = 0
  let bonus = 0
  for (const t of tattoosOf(c)) {
    const l = t.template ? tattooTemplate(t.template)?.lust : undefined
    max += l?.max ?? 0
    bonus += l?.bonus ?? 0
  }
  return { max, bonus }
}

export function tattooAt(c: Pick<Character, 'tattoos'>, place: TattooPlace): Tattoo | undefined {
  return tattoosOf(c).find((t) => t.place === place)
}

/** 還沒有刺青的部位 */
export function freePlaces(c: Pick<Character, 'tattoos'>): TattooPlace[] {
  return TATTOO_PLACES.filter((p) => !tattooAt(c, p))
}

/** 刺青的名稱與外觀（奴隸印記看契約的條款） */
export function tattooName(t: Tattoo): string {
  return t.kind === 'slave' ? t.contract?.terms.name ?? '' : t.name ?? ''
}

export function tattooDesc(t: Tattoo): string {
  return t.kind === 'slave' ? t.contract?.terms.mark ?? '' : t.desc ?? ''
}

/** 給畫面與 AI 的一行說明：部位、種類、名稱、外觀（誓約印記加上屬性） */
export function tattooLine(t: Tattoo): string {
  const attrs = t.kind === 'oath' && t.attrs ? `（${oathText(t.attrs)}）` : ''
  return `${placeName(t.place)}：${tattooKindName(t.kind)}【${tattooName(t)}】${attrs}${tattooDesc(t) ? `——${tattooDesc(t)}` : ''}`
}

// ---- 奴隸印記 ----

export function slaveMarkOf(c: Pick<Character, 'tattoos'> | undefined): Tattoo | undefined {
  return tattoosOf(c).find((t) => t.kind === 'slave')
}

/** 奴隸契約（沒有奴隸印記時為 undefined） */
export function contractOf(c: Pick<Character, 'tattoos'> | undefined): ContractRef | undefined {
  return slaveMarkOf(c)?.contract
}

/**
 * 刻上奴隸印記：換掉原本的奴隸印記，刻在條款的部位；那個部位原本的刺青被蓋掉。
 * 回傳被蓋掉的刺青（不含原本的奴隸印記）。
 */
export function setContract(c: Character, contract: ContractRef, time: GameTime = contract.since, by?: string): Tattoo[] {
  const place = contract.terms.place
  const list = (c.tattoos ??= [])
  const covered = list.filter((t) => t.kind !== 'slave' && t.place === place)
  c.tattoos = list.filter((t) => t.kind !== 'slave' && t.place !== place)
  // 淫紋被頂掉：記下來（未馴服的沉睡），之後可以到刻印師紋回來
  for (const t of covered) if (t.kind === 'curse') displaceCurse(c, t)
  c.tattoos.push({ kind: 'slave', place, contract, since: { ...time }, ...(by ? { by } : {}) })
  return covered
}

/** 拿掉奴隸印記（契約解除） */
export function clearContract(c: Character): Tattoo | undefined {
  const mark = slaveMarkOf(c)
  if (mark) c.tattoos = tattoosOf(c).filter((t) => t !== mark)
  return mark
}

// ---- 誓約印記 ----

/** 「力量 +3、智力 −2」 */
export function oathText(attrs: Partial<Record<AttrId, number>>): string {
  return ATTR_IDS.filter((a) => attrs[a]).map((a) => `${attrName(a)} ${attrs[a]! > 0 ? '+' : ''}${attrs[a]}`).join('、')
}

/** 誓約的加減不合規則時回傳原因：最多動 max_attrs 項、每項 ±1～±max_change、有加有減、加總為 0 */
export function oathError(attrs: Partial<Record<string, unknown>> | undefined): string | undefined {
  const r = tattooRules.oath
  const entries = Object.entries(attrs ?? {}).filter(([, v]) => v !== 0 && v !== undefined)
  if (entries.some(([a]) => !ATTR_IDS.includes(a as AttrId))) return '只能加減五種屬性'
  const values = entries.map(([, v]) => Number(v))
  if (values.some((v) => !Number.isInteger(v) || Math.abs(v) > r.max_change)) return `每項屬性最多 ±${r.max_change}`
  if (!values.some((v) => v > 0) || !values.some((v) => v < 0)) return '誓約要有加也有減'
  if (values.length > r.max_attrs) return `最多動 ${r.max_attrs} 項屬性`
  if (values.reduce((s, v) => s + v, 0) !== 0) return '加減的總和要是 0'
  return undefined
}

export function oathCount(c: Pick<Character, 'tattoos'>): number {
  return tattoosOf(c).filter((t) => t.kind === 'oath').length
}

// ---- 刺上與洗掉（普通刺青與誓約印記） ----

export interface NewTattoo {
  kind: 'plain' | 'oath'
  place: TattooPlace
  name: string
  desc: string
  template?: string
  attrs?: Partial<Record<AttrId, number>>
  by?: string
}

/** 不能刺的原因（部位已經有刺青、誓約不合規則或太多） */
export function tattooError(c: Pick<Character, 'tattoos'>, t: Pick<NewTattoo, 'kind' | 'place' | 'attrs'>): string | undefined {
  if (!t.place) return '身上已經沒有空著的部位'
  if (!isTattooPlace(t.place)) return '沒有這個部位'
  const there = tattooAt(c, t.place)
  if (there) return `${placeName(t.place)}已經有${tattooKindName(there.kind)}【${tattooName(there)}】`
  if (t.kind === 'oath') {
    if (oathCount(c) >= tattooRules.oath.max_per_character) return `誓約印記最多 ${tattooRules.oath.max_per_character} 個`
    return oathError(t.attrs)
  }
  return undefined
}

export function addTattoo(c: Character, t: NewTattoo, time: GameTime): Tattoo {
  const err = tattooError(c, t)
  if (err) throw new Error(err)
  const tattoo: Tattoo = {
    kind: t.kind, place: t.place, name: t.name, desc: t.desc, since: { ...time },
    ...(t.template ? { template: t.template } : {}),
    ...(t.kind === 'oath' ? { attrs: Object.fromEntries(ATTR_IDS.filter((a) => t.attrs?.[a]).map((a) => [a, t.attrs![a]])) } : {}),
    ...(t.by ? { by: t.by } : {}),
  }
  ;(c.tattoos ??= []).push(tattoo)
  return tattoo
}

/** 依圖樣刺青：部位沒指定時挑建議部位裡空著的第一個（都滿了就任何空的部位） */
export function tattooFromTemplate(id: string, c: Pick<Character, 'tattoos'>, place?: TattooPlace): NewTattoo {
  const tpl = tattooTemplate(id)
  if (!tpl) throw new Error(`沒有這個刺青圖樣：${id}`)
  const free = freePlaces(c)
  const at = place ?? (tpl.places ?? []).find((p) => free.includes(p)) ?? free[0]
  if (!at) throw new Error('身上已經沒有空著的部位')
  return { kind: tpl.kind, place: at, name: tpl.name, desc: tpl.desc, template: id, ...(tpl.kind === 'oath' ? { attrs: { ...tpl.attrs } } : {}) }
}

/** 洗掉一個部位的刺青（奴隸印記要用解除契約、未馴服的淫紋要解咒，不能用這個；已馴服的淫紋記下來，之後可以紋回來） */
export function removeTattoo(c: Character, place: TattooPlace): Tattoo | undefined {
  const t = tattooAt(c, place)
  if (!t || t.kind === 'slave' || (t.kind === 'curse' && !t.tamed)) return undefined
  c.tattoos = tattoosOf(c).filter((x) => x !== t)
  if (t.kind === 'curse') storeTamedCurse(c, t)
  return t
}

/** 給 AI 的刺青清單（沒有時為空字串） */
export function tattooSummary(c: Pick<Character, 'tattoos'>): string {
  return tattoosOf(c).map(tattooLine).join('\n')
}
