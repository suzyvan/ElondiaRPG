// 刺青店、刻印師與神殿：花錢刺青與洗刺青（docs/TATTOOS.md 第 6 節）。
// 刺青店刺普通刺青、刻印師刻誓約印記；洗刺青：刺青店只洗普通刺青，刻印師與神殿都能洗（神殿便宜但要聲望）。
// 奴隸印記的解除另外走解除印記（slavery.ts 的 unmarkOffers，有檢定）。
// 也可以替隊伍裡的人刺青、洗刺青（第 6.1 節）：主角自己的奴隸不用問，自由的夥伴要親密度夠（inkConsent）。

import { tagsAllowed } from './content'
import { lewdOf } from './lewd'
import { canLactate } from './pregMarks'
import { pcTagMult } from './pcTags'
import { recalc } from './character'
import { locationById } from './data'
import { currentCell } from './grid'
import { formatMoney } from './money'
import { isFugitive, pcOf, setHp } from './party'
import { nurseryRefusal } from './children'
import { meetsReputation } from './security'
import { commitReport } from './state'
import { addTattoo, contractOf, oathError, placeName, removeTattoo, tattooAt, tattooError, tattooKindName, tattooRules, tattooTemplate, type NewTattoo } from './tattoos'
import { baseReport } from './town'
import type { Character, GameState, Report, TattooKind, TattooPlace } from './types'

export type TattooShopId = 'parlor' | 'carver' | 'temple'

interface ShopRules {
  name: string
  ink?: number
  oath_per_point?: number
  custom_extra?: number
  remove: Partial<Record<TattooKind, number>>
  min_reputation?: number
  hours: number
}

export function tattooShop(id: TattooShopId): ShopRules {
  return (tattooRules as unknown as { shops: Record<TattooShopId, ShopRules> }).shops[id]
}

const CELL_SHOP: Partial<Record<string, TattooShopId>> = { tattoo: 'parlor', carver: 'carver', temple: 'temple' }

/** 站在哪一種刺青的店（刺青店、刻印師、神殿） */
export function tattooShopHere(state: GameState): TattooShopId | undefined {
  return CELL_SHOP[currentCell(state).kind]
}

/** 這家店刺得了的種類：刺青店普通刺青、刻印師誓約印記、神殿不刺 */
export function inkKind(shop: TattooShopId): 'plain' | 'oath' | undefined {
  return shop === 'parlor' ? 'plain' : shop === 'carver' ? 'oath' : undefined
}

/** 不接待的原因（神殿：逃亡奴隸、聲望不夠） */
export function shopRefusal(state: GameState, shop: TattooShopId): string | undefined {
  const r = tattooShop(shop)
  if (shop === 'temple' && isFugitive(state)) return '神殿的人認出了你身上的契約印記，拒絕接待'
  if (shop === 'temple') {
    const owed = nurseryRefusal(state)
    if (owed) return owed
  }
  if (r.min_reputation && !meetsReputation(state, locationById(state.location).faction, r.min_reputation)) return `要在這裡的勢力有 ${r.min_reputation} 點聲望，神殿才肯替你洗刺青`
  return undefined
}

/** 刺青的價格：刺青店固定價，刻印師依誓約加的總點數；自己描述的另外加錢 */
export function inkPrice(shop: TattooShopId, t: Pick<NewTattoo, 'kind' | 'attrs' | 'template'>): number {
  const r = tattooShop(shop)
  // 圖樣另外加的價錢（淫紋）；自己描述的加 custom_extra
  const extra = t.template ? tattooTemplate(t.template)?.price ?? 0 : r.custom_extra ?? 0
  if (t.kind === 'oath') return Object.values(t.attrs ?? {}).filter((v) => (v ?? 0) > 0).reduce((sum, v) => sum + v!, 0) * (r.oath_per_point ?? 0) + extra
  return (r.ink ?? 0) + extra
}

/** 洗掉這種刺青的價格（這家店不洗時為 undefined） */
export function removePrice(shop: TattooShopId, kind: TattooKind, tamed = true): number | undefined {
  return kind === 'slave' || (kind === 'curse' && !tamed) ? undefined : tattooShop(shop).remove[kind]
}

/** 要刺的刺青：圖樣，或自己描述（名稱、外觀；誓約要屬性的加減） */
export type InkOrder = { template: string; place: TattooPlace } | { kind: 'plain' | 'oath'; name: string; desc: string; place: TattooPlace; attrs?: NewTattoo['attrs'] }

/** 這個圖樣現在不能刺的原因：內容篩選關掉了它的標籤、會泌乳的圖樣而刺的人身體不會泌乳（docs/FAMILY.md 第 10 節） */
export function templateBlock(state: GameState, id: string, who: Character = pcOf(state)): string | undefined {
  const tpl = tattooTemplate(id)
  if (!tpl) return '沒有這個圖樣'
  if (!tagsAllowed(tpl.content_tags)) return '內容篩選關掉了這種刺青'
  if (tpl.lactation && !canLactate(who)) return who.isPlayer ? '你的身體不會泌乳' : `${who.name}的身體不會泌乳`
  return undefined
}

// ---- 替隊伍裡的人刺青（docs/TATTOOS.md 第 6.1 節） ----

/** 主角自己的奴隸（契約的主人是主角） */
function ownSlave(c: Character): boolean {
  return c.bond === 'slave' && contractOf(c)?.master === 'pc'
}

/** 可以替他刺青、洗刺青的人：主角，以及在隊上的自己的奴隸、雇來的、自願入隊的夥伴（隊長、主人的人、客人不算） */
export function tattooTargets(state: GameState): Character[] {
  return state.party.filter((m) => m.isPlayer || (!m.status.includes('away') && (ownSlave(m) || m.bond === 'hired' || m.bond === 'voluntary')))
}

/** 隊伍裡這個人（不在可以刺青的人裡時丟出錯誤） */
function targetOf(state: GameState, id?: string): Character {
  if (!id || id === 'pc') return pcOf(state)
  const c = tattooTargets(state).find((m) => m.id === id)
  if (!c) throw new Error('不能替這個人刺青')
  return c
}

/**
 * 這個人不肯刺（或不肯洗）的原因：主角自己、主角的奴隸不用問；自由的夥伴看親密度，
 * 普通刺青與洗刺青 min_affinity、誓約印記 oath_min_affinity、淫紋 adult_min_affinity（或淫亂到 adult_min_lewdness）
 */
export function inkConsent(c: Character, t?: Pick<NewTattoo, 'kind' | 'template'>): string | undefined {
  if (c.isPlayer || ownSlave(c)) return undefined
  const r = tattooRules.companion
  const affinity = c.affinity ?? 0
  const adult = !!(t?.template && tattooTemplate(t.template)?.adult)
  if (adult) {
    return affinity >= r.adult_min_affinity || lewdOf(c).lewdness >= r.adult_min_lewdness
      ? undefined
      : `${c.name}不肯紋這種圖樣（親密度要 ${r.adult_min_affinity}，或淫亂 ${r.adult_min_lewdness}）`
  }
  const need = t?.kind === 'oath' ? r.oath_min_affinity : r.min_affinity
  return affinity >= need ? undefined : `${c.name}不肯讓你${t ? `替他刺${tattooKindName(t.kind)}` : '動他的刺青'}（親密度要 ${need}）`
}

export function orderTattoo(state: GameState, order: InkOrder, who: Character = pcOf(state)): NewTattoo {
  if ('template' in order) {
    const tpl = tattooTemplate(order.template)
    if (!tpl) throw new Error('沒有這個圖樣')
    const block = templateBlock(state, order.template, who)
    if (block) throw new Error(block)
    return { kind: tpl.kind, place: order.place, name: tpl.name, desc: tpl.desc, template: order.template, ...(tpl.attrs ? { attrs: { ...tpl.attrs } } : {}) }
  }
  const name = order.name.trim().slice(0, 20)
  if (!name) throw new Error('請替刺青取個名字')
  if (order.kind === 'oath' && oathError(order.attrs)) throw new Error(oathError(order.attrs))
  return { kind: order.kind, place: order.place, name, desc: order.desc.trim().slice(0, 160), ...(order.kind === 'oath' ? { attrs: { ...order.attrs } } : {}) }
}

function shopReport(state: GameState, shop: TattooShopId): Report {
  const r = tattooShop(shop)
  const report = baseReport(state, 'trade', r.hours)
  report.location.scene = `${locationById(state.location).name}的${shop === 'temple' ? '神殿' : r.name}`
  return report
}

/** 在刺青店或刻印師刺青；who 是隊伍裡要刺的人（沒有時是主角） */
export function inkTattoo(state: GameState, order: InkOrder, who?: string): Report {
  const shop = tattooShopHere(state)
  if (!shop || !inkKind(shop)) throw new Error('這裡不能刺青')
  const pc = targetOf(state, who)
  const t = orderTattoo(state, order, pc)
  if (t.kind !== inkKind(shop)) throw new Error(`${tattooShop(shop).name}只刺${tattooKindName(inkKind(shop)!)}`)
  const err = tattooError(pc, t)
  if (err) throw new Error(err)
  const refused = inkConsent(pc, t)
  if (refused) throw new Error(refused)
  const price = inkPrice(shop, t)
  if (state.money_cc < price) throw new Error(`錢不夠（要 ${formatMoney(price)}）`)
  const report = shopReport(state, shop)
  const added = addTattoo(pc, { ...t, by: tattooShop(shop).name }, state.time)
  // 誓約印記改了力量、信仰，生命上限跟著變
  recalc(pc)
  setHp(state, pc, pc.hp, report)
  report.changes.money_cc = -price
  report.changes.tattoos = [{ actor: pc.isPlayer ? 'pc' : pc.id, place: added.place, kind: added.kind, name: added.name ?? '', added: true }]
  report.outcome.summary = pc.isPlayer
    ? `在${placeName(added.place)}刺上了${tattooKindName(added.kind)}【${added.name}】，花了 ${formatMoney(price)}。`
    : `替${pc.name}在${placeName(added.place)}刺上了${tattooKindName(added.kind)}【${added.name}】，花了 ${formatMoney(price)}。`
  report.narration = { pov: 'second_person', length: 'short', focus: [pc.isPlayer ? '刺青的過程與感覺' : `${pc.name}刺青的過程與反應`, added.desc ?? ''] }
  return commitReport(state, report)
}

/** 洗掉一個部位的刺青（奴隸印記不行）；who 是隊伍裡的人（沒有時是主角） */
export function washTattoo(state: GameState, place: TattooPlace, who?: string): Report {
  const shop = tattooShopHere(state)
  if (!shop) throw new Error('這裡不能洗刺青')
  const refused = shopRefusal(state, shop)
  if (refused) throw new Error(refused)
  const pc = targetOf(state, who)
  const consent = inkConsent(pc)
  if (consent) throw new Error(consent)
  const t = tattooAt(pc, place)
  if (!t) throw new Error(`${placeName(place)}沒有刺青`)
  if (t.kind === 'slave') throw new Error('奴隸印記要解除契約才能去掉')
  if (t.kind === 'curse' && !t.tamed) throw new Error('未馴服的詛咒印記洗不掉，要解咒')
  const base = removePrice(shop, t.kind)
  // 神殿洗刺青：神職的身分打折
  const price = base === undefined ? undefined : Math.round(base * (shop === 'temple' ? pcTagMult(pcOf(state), 'service_mult') : 1))
  if (price === undefined) throw new Error(`${tattooShop(shop).name}不洗${tattooKindName(t.kind)}`)
  if (state.money_cc < price) throw new Error(`錢不夠（要 ${formatMoney(price)}）`)
  const report = shopReport(state, shop)
  removeTattoo(pc, place)
  recalc(pc)
  setHp(state, pc, pc.hp, report)
  report.changes.money_cc = -price
  report.changes.tattoos = [{ actor: pc.isPlayer ? 'pc' : pc.id, place, kind: t.kind, name: t.name ?? '', added: false }]
  report.outcome.summary = `${pc.isPlayer ? '' : `替${pc.name}`}洗掉了${placeName(place)}的${tattooKindName(t.kind)}【${t.name}】，花了 ${formatMoney(price)}。`
  return commitReport(state, report)
}
