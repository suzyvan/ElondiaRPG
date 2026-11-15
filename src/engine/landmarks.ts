// 城鎮的特色地標：遊戲中的功能（docs/LANDMARKS.md）。資料在 data/world/landmarks.json，內容編輯器見 landmarkMods.ts。
// 開放條件、參訪（付錢或花時間換效果）、探索（主動行動的檢定）、場景（條件成立時的固定場景）；打工與受訓走 work.ts、perkActions.ts（格子的種類就是地標 id）。

import { landmarkDef, landmarks, locationById, npcs as namedNpcs, specialMaps, type Degree, type LandmarkDef, type LandmarkScene, type SceneRole } from './data'
import { pcBodyAllowed, tagsAllowed } from './content'
import { characterBody } from './look'
import { activeNodes, npcFree } from './story'
import { npcRecord } from './npcs'
import { applyEffects, type RewardEffect } from './effects'
import { currentArea, currentCell, position } from './grid'
import { enterSpecial } from './specialMaps'
import { isNight } from './light'
import { missingWear, wearName, wearNote } from './gear'
import { exposureLevel } from './lewd'
import { isLactating } from './lactation'
import { canLactate } from './pregMarks'
import { broodBlock, broodOf, broodsOf } from './brood'
import { formatMoney } from './money'
import { isFugitive, pcOf } from './party'
import { meetsReputation } from './security'
import { condMet } from './storyFlags'
import { baseReport } from './town'
import { effectText } from './trade'
import { commitReport } from './state'
import type { Character, GameState, Report } from './types'

/** 主角現在站的地標（聚落裡的地標格，或在地標的內部） */
export function landmarkHere(state: GameState): LandmarkDef | undefined {
  const area = currentArea(state)
  if (area.kind === 'special') return landmarkDef(currentCell(state).kind) ?? landmarkOfInterior(area.special)
  if (area.kind !== 'settlement') return undefined
  return landmarkDef(currentCell(state).kind)
}

/** 以這張特殊地圖為內部的地標 */
export function landmarkOfInterior(id: string | undefined): LandmarkDef | undefined {
  return id ? Object.values(landmarks).find((l) => l.interior === id) : undefined
}

/** 主角在這個地標的內部 */
export function insideLandmark(state: GameState, l: LandmarkDef): boolean {
  const area = currentArea(state)
  return area.kind === 'special' && !!l.interior && area.special === l.interior
}

/** 為什麼現在不能走進地標的內部（可以時是 undefined） */
/** 有沒有進行中的特殊任務點在這張特殊地圖裡 */
export function storyInside(state: GameState, map: string): boolean {
  return activeNodes(state).some((n) => n.node.at.where === 'special' && n.node.at.special_map === map)
}

/**
 * 被召見：這一區有地標的內部（interior_story）擺著進行中的特殊任務點，例如宣德樓的城樓、金帳的內帳。
 * 王城的衛兵照樣放行（不用聲望、許可或說服），見 grid.ts 的 crossLink
 */
export function summonedInto(state: GameState, areaKey: string): LandmarkDef | undefined {
  return Object.values(landmarks).find((l) => l.at.area === areaKey && l.interior_story && l.interior && storyInside(state, l.interior))
}

export function interiorBlocked(state: GameState): string | undefined {
  const l = landmarkHere(state)
  if (!l?.interior || !specialMaps[l.interior]) return '這裡沒有可以進去的地方'
  if (insideLandmark(state, l)) return '已經在裡面了'
  // 只在特殊任務的任務點在裡面時開放（金帳的內帳：被召見才進得去）
  if (l.interior_story && !storyInside(state, l.interior)) return `沒有事要辦時進不去${specialMaps[l.interior]!.name}`
  // 被召見（任務點在裡面）：官方機構不因為逃亡奴隸的身分擋人
  return landmarkClosed(state, l, { summoned: !!l.interior_story }) ?? (l.enter?.role ? roleNote(state, l.enter.role) : undefined)
}

/**
 * 走進地標的內部（站在入口；從出口離開時回到地標格）。
 * 地標寫了進場的身分（enter.role）時，符合的人進去時各得到效果，寫一則日誌（回傳報告）
 */
export function enterLandmark(state: GameState): Report | undefined {
  const why = interiorBlocked(state)
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const role = l.enter?.role
  const who = role ? roleMembers(state, role) : []
  // 地標本身在特殊地圖裡（例如地下街的俱樂部）：記下地標格，從內部出來時回到這裡
  const p = position(state)
  const from = state.special && p.area.startsWith('sm/') ? { area: p.area, x: p.x, y: p.y } : undefined
  enterSpecial(state, l.interior!)
  if (from) (state.special!.inner ??= []).push(from)
  if (!role?.effects?.length && !l.enter?.text) return undefined
  const inner = specialMaps[l.interior!]!
  const report = baseReport(state, 'event', 0.25)
  report.location.scene = `${locationById(state.location).name}・${inner.name}`
  report.lore_keys!.push(l.name)
  applyRoleEffects(state, report, role, who)
  const text = fillRole(l.enter?.text ?? `{role}走進了${inner.name}。`, who)
  report.outcome = { result: 'success', summary: text }
  return commitReport(state, report)
}

/** 站在地標上行動時，場景帶上地標與它的氛圍（交給 AI） */
export function withLandmark(state: GameState, scene: string): string {
  const l = landmarkHere(state)
  if (!l || scene.includes(l.name)) return scene
  const mood = (l.scene || l.desc).slice(0, 80)
  return `${scene}・${l.name}${mood ? `（${mood}）` : ''}`
}

// ---- 開放條件 ----

/** 地標現在不開放的原因（開放時是 undefined） */
export function landmarkClosed(state: GameState, l: LandmarkDef, opts: { summoned?: boolean } = {}): string | undefined {
  const o = l.open
  if (!o) return undefined
  if (o.hours === 'day' && isNight(state.time)) return `${l.name}只在白天開放`
  if (o.hours === 'night' && !isNight(state.time)) return `${l.name}只在夜裡開放`
  if (!condMet(state, { ...(o.flags ? { flags: o.flags } : {}), ...(o.flags_none ? { flags_none: o.flags_none } : {}) })) return `${l.name}現在不開放`
  if (o.min_reputation && !meetsReputation(state, locationById(l.location).faction, o.min_reputation)) return `要在這裡的勢力有 ${o.min_reputation} 點聲望，${l.name}才讓你進去`
  if (o.official && isFugitive(state) && !opts.summoned) return `${l.name}的人認出了你身上的契約印記，不讓你進去`
  return undefined
}

/** 站在不開放的地標上：打工、受訓、參訪、探索都不行 */
export function closedHere(state: GameState): string | undefined {
  const l = landmarkHere(state)
  return l ? landmarkClosed(state, l) : undefined
}

function record(state: GameState, id: string) {
  return ((state.landmarks ??= {})[id] ??= {})
}

/** 還要等幾天才能再參訪／探索（0：現在可以） */
export function waitDays(state: GameState, l: LandmarkDef, what: 'visit' | 'explore'): number {
  const last = what === 'visit' ? state.landmarks?.[l.id]?.visited : state.landmarks?.[l.id]?.explored
  if (last === undefined) return 0
  const gap = what === 'visit' ? l.visit?.cooldown_days ?? 1 : l.explore?.cooldown_days ?? 7
  return Math.max(0, last + gap - state.time.day)
}

/** 為什麼現在不能參訪或探索（可以時是 undefined） */
export function blockedReason(state: GameState, what: 'visit' | 'explore'): string | undefined {
  const l = landmarkHere(state)
  if (!l || !l[what]) return what === 'visit' ? '這裡沒有可以參訪的地方' : '這裡沒有可以探索的地方'
  const closed = landmarkClosed(state, l)
  if (closed) return closed
  const wait = waitDays(state, l, what)
  if (wait) return `${wait} 天後才能再${what === 'visit' ? '來' : '探索'}`
  if (what === 'visit' && (l.visit!.money_cc ?? 0) > state.money_cc) return `錢不夠（要 ${formatMoney(l.visit!.money_cc!)}）`
  return undefined
}

// ---- 參訪 ----

/** 參訪地標：付錢、花時間，得到設定的效果 */
export function visitLandmark(state: GameState): Report {
  const why = blockedReason(state, 'visit')
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const v = l.visit!
  const report = baseReport(state, 'event', v.hours ?? 0.5)
  report.location.scene = `${locationById(state.location).name}・${l.name}・${v.title}${l.scene ? `（${l.scene.slice(0, 80)}）` : ''}`
  report.lore_keys!.push(l.name)
  applyEffects(state, report, [...(v.money_cc ? [{ type: 'money' as const, amount: -v.money_cc }] : []), ...v.effects])
  record(state, l.id).visited = state.time.day
  report.outcome = { result: 'success', summary: `在${l.name}${v.title}。` }
  return commitReport(state, report)
}

// ---- 探索（主動行動 explore） ----

export function setupExplore(state: GameState) {
  const why = blockedReason(state, 'explore')
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const e = l.explore!
  const gains = e.effects.map((x) => effectText(state, x)).join('、') || '有所收穫'
  const extra = (e.critical ?? []).map((x) => effectText(state, x)).join('、')
  return {
    attr: e.attr, dc: e.dc, hours: e.hours, situational: [],
    scene: `${locationById(state.location).name}・${l.name}・${e.title}`,
    outcomes: {
      critical: extra ? `${gains}，另外 ${extra}` : gains, success: gains, partial: '有些頭緒，但沒找到什麼', fail: '一無所獲', fumble: '一無所獲，還弄得狼狽不堪',
    } as Partial<Record<Degree, string>>,
  }
}

export function applyExplore(state: GameState, report: Report, degree: Degree): string {
  const l = landmarkHere(state)
  if (!l?.explore) return '這裡沒有可以探索的地方。'
  record(state, l.id).explored = state.time.day
  const e = l.explore
  if (degree !== 'critical' && degree !== 'success') return `在${l.name}${e.title}，${degree === 'partial' ? '有些頭緒，但沒找到什麼' : '一無所獲'}。`
  applyEffects(state, report, [...e.effects, ...(degree === 'critical' ? e.critical ?? [] : [])])
  return `在${l.name}${e.title}，有所收穫。`
}

// ---- 場景（docs/LANDMARKS.md 第 6 節） ----

const npcName = (id: string) => namedNpcs.find((n) => n.id === id)?.name ?? id

/** 場景裡現在在場的固定 NPC；有寫旗標的人不在場時 missing（換成代替的人） */
export function sceneCast(state: GameState, sc: LandmarkScene): { ids: string[]; missing: boolean } {
  const ids: string[] = []
  let missing = false
  for (const c of sc.cast ?? []) {
    if (npcFree(state, c.npc) && (!c.flags?.length || condMet(state, { flags: c.flags }))) ids.push(c.npc)
    else missing = true
  }
  return { ids, missing }
}

// ---- 身分（docs/LANDMARKS.md 第 6.1 節） ----

/** 效果裡會讓主角成為苗床的那幾個（寄生物的 add，寄生物是苗床） */
function broodEffects(role: SceneRole): string[] {
  return (role.effects ?? []).flatMap((e) => (e.type === 'parasite' && e.op === 'add' && broodOf(e.parasite) ? [e.parasite] : []))
}

/** 這個人的穿著與身體符不符合這個身分（不看能不能成為苗床） */
function roleFits(state: GameState, role: SceneRole, c: Character): boolean {
  if (c.status.includes('away')) return false
  if ((role.pc_only || broodEffects(role).length) && !c.isPlayer) return false
  if (missingWear(c, role.wear).length) return false
  if (!pcBodyAllowed(role.body, characterBody(c))) return false
  if (role.exposure && exposureLevel(c) < role.exposure) return false
  if (role.can_lactate && !canLactate(c)) return false
  if (role.lactating && !isLactating(state, c)) return false
  if (role.brood && !broodsOf(c).length) return false
  return true
}

/** 主角現在不能成為這個身分的苗床的原因（懷孕中、已經有了……；沒有苗床的效果時是 undefined） */
function roleBroodBlock(state: GameState, role: SceneRole): string | undefined {
  return broodEffects(role).map((id) => broodBlock(state, id)).find(Boolean)
}

/** 隊伍裡現在能當這個身分的人（主角在前） */
export function roleMembers(state: GameState, role: SceneRole): Character[] {
  if (roleBroodBlock(state, role)) return []
  return [...state.party].sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer)).filter((c) => roleFits(state, role, c))
}

/** 沒有人能當這個身分時的說明（有人能當時是 undefined） */
export function roleNote(state: GameState, role: SceneRole): string | undefined {
  if (roleMembers(state, role).length) return undefined
  const pcOnly = !!role.pc_only || broodEffects(role).length > 0
  // 主角的穿著與身體都符合，只是現在不能成為苗床
  const block = roleBroodBlock(state, role)
  if (block && roleFits(state, role, pcOf(state))) return `主角現在不能當${role.name}（${block}）`
  const parts: string[] = []
  if (role.body?.length) parts.push(`是${role.body.map((b) => BODY_NAME[b]).join('或')}體型`)
  if (role.wear?.length) parts.push(`穿著${role.wear.map((w) => `【${wearName(w)}】`).join('')}`)
  if (role.exposure) parts.push(`穿得夠少（曝露度 ${role.exposure}）`)
  if (role.can_lactate) parts.push('身體會泌乳')
  if (role.lactating) parts.push('正在泌乳')
  if (role.brood) parts.push('身上有怪物的苗床')
  return `${pcOnly ? '主角要' : '隊伍裡要有人'}${parts.join('、') || '符合條件'}才能當${role.name}${role.wear?.length ? '（到隊伍的裝備換上）' : ''}`
}

const BODY_NAME = { masc: '陽剛', fem: '陰柔', andro: '中性' } as const

/** {role} 換成當這個身分的人（主角寫「主角」） */
function fillRole(text: string, who: Character[]): string {
  return text.replace(/\{role\}/g, who.map((c) => (c.isPlayer ? '主角' : c.name)).join('、') || '主角')
}

/** 身分的效果：每個人各一份（對象換成那個人；寄生物、苗床、腐化本來就是主角的，只給主角；錢、物品照人數給） */
function applyRoleEffects(state: GameState, report: Report, role: SceneRole | undefined, who: Character[]) {
  if (!role?.effects?.length) return
  const list: RewardEffect[] = []
  for (const c of who) {
    const id = c.isPlayer ? 'pc' : c.id
    for (const e of role.effects) {
      if (e.type === 'parasite' || e.type === 'corruption') {
        if (c.isPlayer) list.push(e)
      } else if ('target' in e || PERSONAL.has(e.type)) list.push({ ...e, target: id } as RewardEffect)
      else list.push(e)
    }
  }
  applyEffects(state, report, list)
}
/** 對象可以省略（預設主角）的個人效果 */
const PERSONAL = new Set<RewardEffect['type']>(['lewd', 'xp', 'perk', 'lose_perk', 'ability', 'ability_pool'])

/** 場景現在出不出現：內容標籤、主角的體型、劇情旗標；一定要在場的人（沒寫旗標的）死了或被抓走時也不出現 */
export function sceneShown(state: GameState, sc: LandmarkScene): boolean {
  if (!tagsAllowed(sc.tags)) return false
  if (!pcBodyAllowed(sc.pc_body, characterBody(pcOf(state)))) return false
  if (sc.requires && !condMet(state, sc.requires)) return false
  return (sc.cast ?? []).every((c) => c.flags?.length || npcFree(state, c.npc))
}

/** 場景在不在主角站的這一格：有內部的地標，寫了格子的場景在裡面的那一格，沒寫的在外面的地標格上 */
function sceneAtHere(state: GameState, l: LandmarkDef, sc: LandmarkScene): boolean {
  if (!insideLandmark(state, l)) return !(l.interior && sc.spot)
  const p = position(state)
  return !!sc.spot && sc.spot.x === p.x && sc.spot.y === p.y
}

/** 站在這裡現在出現的場景（index 是地標上的順序） */
export function scenesHere(state: GameState): { index: number; scene: LandmarkScene }[] {
  const l = landmarkHere(state)
  if (!l?.scenes) return []
  return l.scenes.map((scene, index) => ({ index, scene })).filter(({ scene }) => sceneAtHere(state, l, scene) && sceneShown(state, scene))
}

/** 在地標的內部時，有場景的格子（地圖標示用）：「x,y」→ 格子的名稱 */
export function sceneSpots(state: GameState): Map<string, string> {
  const out = new Map<string, string>()
  const l = landmarkHere(state)
  if (!l?.scenes || !insideLandmark(state, l)) return out
  for (const sc of l.scenes) {
    if (!sc.spot || !sceneShown(state, sc)) continue
    const k = `${sc.spot.x},${sc.spot.y}`
    out.set(k, out.get(k) ?? sc.spot_name ?? sc.title)
  }
  return out
}

/** 還要等幾天才能再選這個場景（0：現在可以）；沒有勾自己算冷卻的場景共用地標的冷卻 */
export function sceneWait(state: GameState, l: LandmarkDef, sc: LandmarkScene): number {
  const r = state.landmarks?.[l.id]
  const last = sc.own_cooldown ? r?.scenes?.[sc.title] : r?.scene
  if (last === undefined) return 0
  return Math.max(0, last + (sc.cooldown_days ?? 3) - state.time.day)
}

/** 為什麼現在不能選這個場景（可以時是 undefined） */
export function sceneBlocked(state: GameState, index: number): string | undefined {
  const l = landmarkHere(state)
  const sc = l?.scenes?.[index]
  if (!l || !sc || !sceneAtHere(state, l, sc) || !sceneShown(state, sc)) return '這裡沒有這個場景'
  const closed = landmarkClosed(state, l)
  if (closed) return closed
  const wait = sceneWait(state, l, sc)
  if (wait) return `${wait} 天後才能再來`
  if ((sc.money_cc ?? 0) > state.money_cc) return `錢不夠（要 ${formatMoney(sc.money_cc!)}）`
  return wearNote(pcOf(state), sc.wear) ?? (sc.role ? roleNote(state, sc.role) : undefined)
}

/** 場景裡在場的人的名字（有人不在場時接上代替的人） */
export function sceneCastNames(state: GameState, sc: LandmarkScene): string[] {
  const { ids, missing } = sceneCast(state, sc)
  const names = ids.map(npcName)
  if (missing && sc.extras) names.push(sc.extras)
  return names
}

/** 場景交給 AI 的文字：{cast} 換成在場的人，{role} 換成當這個身分的人 */
export function sceneText(state: GameState, sc: LandmarkScene): string {
  const text = sc.scene.replace(/\{cast\}/g, sceneCastNames(state, sc).join('、') || sc.extras || '在場的人')
  return sc.role ? fillRole(text, roleMembers(state, sc.role)) : text
}

/** 選一個地標的場景：付錢、花時間，在場的人加好感，得到設定的效果；成人向的場景交給 AI 詳細描寫 */
export function playLandmarkScene(state: GameState, index: number): Report {
  const why = sceneBlocked(state, index)
  if (why) throw new Error(why)
  const l = landmarkHere(state)!
  const sc = l.scenes![index]!
  const { ids } = sceneCast(state, sc)
  const text = sceneText(state, sc)
  const who = sc.role ? roleMembers(state, sc.role) : []
  const report = baseReport(state, 'event', sc.hours ?? 2)
  report.location.scene = `${locationById(state.location).name}・${l.name}${sc.spot_name ? `・${sc.spot_name}` : ''}・${sc.title}${l.scene ? `（${l.scene.slice(0, 80)}）` : ''}`
  report.lore_keys!.push(l.name, ...ids.map(npcName))
  // 在場的人記在 others：插圖的分鏡從隊伍與 others 挑人
  const present = ids
    .filter((id) => !state.party.some((m) => m.id === id))
    .map((id) => npcRecord(state, id))
    .filter((r): r is NonNullable<typeof r> => !!r && !r.dead)
    .map((r) => ({ id: r.id, name: r.name, race: r.race, class: r.class, level: r.level, personality: r.personality }))
  if (present.length) report.others = [...(report.others ?? []), ...present]
  applyEffects(state, report, [
    ...(sc.money_cc ? [{ type: 'money' as const, amount: -sc.money_cc }] : []),
    ...(sc.affinity ? ids.map((npc) => ({ type: 'affinity' as const, npc, delta: sc.affinity!, reason: `${l.name}・${sc.title}` })) : []),
    ...(sc.effects ?? []),
  ])
  applyRoleEffects(state, report, sc.role, who)
  const r = record(state, l.id)
  if (sc.own_cooldown) (r.scenes ??= {})[sc.title] = state.time.day
  else r.scene = state.time.day
  report.outcome = { result: 'success', summary: `在${l.name}${sc.title}：${text}` }
  if (sc.tags?.includes('adult')) {
    // 身分只有隊友（主角沒穿制服，隊友去上工）：場景的主角是那位隊友（淫亂成長、性經歷記在他身上）
    const actor = sc.role && who.length && !who.some((c) => c.isPlayer) ? who[0]!.id : undefined
    report.narration = { ...report.narration, length: 'long', adult_scene: text, ...(actor ? { adult_actor: actor } : {}) }
  }
  // 限定體型的內容：主角也參加時（陽剛體型打開了設定），一樣提醒 AI 照主角的身體寫
  if (sc.pc_body?.length || (sc.role?.body?.length && who.some((c) => c.isPlayer))) report.narration = { ...report.narration, body_limited: true }
  return commitReport(state, report)
}
