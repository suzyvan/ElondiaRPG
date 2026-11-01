<script setup lang="ts">
import { useSummary } from '@/engine/inventory'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  abilityApCost, combatItems, currentActor, defenseMult, effectiveLustMax, isActive, itemNeedsTarget, itemTargets, multLabel, struggleDc, struggleTargets, threatMultOf, threatShares, unusableReason, validTargets,
  type Combatant,
} from '@/engine/combat'
import { luckyThreshold } from '@/engine/character'
import { abilityDef, combatRules, damageTypeName, lewdRules, describeStatus, monsterTraits, statusDef, type AbilityDef } from '@/engine/data'
import { describeCombatLine } from '@/narrator/describe'
import { banner, climaxBreath, fxOn, flash, floatText, lustHit, screenFlash, screenShake, shake, shatter } from '@/fx/fx'
import { BUFF_COLOR, CRIT_COLOR, DEBUFF_COLOR, HEAL_COLOR, LUST_COLOR, MISS_COLOR, PHYSICAL_COLOR, cuesFor, unplayedHpDelta, unplayedLustDelta } from '@/fx/combatFx'
import type { TimelineEntry } from '@/engine/types'
import { useGame } from '@/stores/game'
import NameTag from './NameTag.vue'
import GameIcon from './ui/GameIcon.vue'
import ContentIcon from './icons/ContentIcon.vue'
import BottomSheet from './mobile/BottomSheet.vue'
import SwipeTabs from './mobile/SwipeTabs.vue'
import { isMobile } from './mobile/mobile'
import { vMarquee } from './marquee'

const emit = defineEmits<{ finished: []; open: [what: 'party' | 'settings'] }>()
const game = useGame()
const combat = computed(() => game.state!.combat!)
// 仇恨值：敵人選目標的機率（不是絕對的）
const shares = computed(() => threatShares(combat.value))
const actor = computed(() => currentActor(combat.value))
const party = computed(() => combat.value.combatants.filter((c) => c.side === 'party'))
const foes = computed(() => combat.value.combatants.filter((c) => c.side === 'enemy'))
const names = computed(() => Object.fromEntries(combat.value.combatants.map((c) => [c.id, c.name])))
const log = ref<HTMLElement | null>(null)
const costs = combatRules.action_costs

/** 已選擇、等待指定目標的行動 */
const pending = ref<{ kind: 'attack' } | { kind: 'struggle' } | { kind: 'ability'; ability: AbilityDef } | { kind: 'item'; item: string } | null>(null)

const targets = computed(() => {
  if (!actor.value || !pending.value) return []
  if (pending.value.kind === 'item') return itemTargets(combat.value, pending.value.item)
  if (pending.value.kind === 'struggle') return struggleTargets(combat.value, actor.value)
  return validTargets(combat.value, actor.value.id, pending.value.kind === 'ability' ? pending.value.ability : undefined)
})

// 掙脫（自己）、撕開（隊友）戰鬥中的拘束：只有一個對象時直接做
const struggleAp = lewdRules.unbind.combat.ap
/** 行動點上限超過這個數字時改寫數字（高等級的圓點會把生命值擠掉） */
const AP_PIPS_MAX = 8
const bound = computed(() => (actor.value ? struggleTargets(combat.value, actor.value) : []))
const struggleTitle = computed(() => bound.value.map((t) => `${t.id === actor.value?.id ? '掙脫' : `撕開${t.name}身上的`}拘束：DC ${struggleDc(combat.value, actor.value!, t)}`).join('\n'))
function struggle() {
  if (bound.value.length === 1) send({ type: 'struggle', target: bound.value[0]!.id })
  else pending.value = { kind: 'struggle' }
}

// 道具：行囊裡可以在戰鬥中使用的東西
const items = computed(() => combatItems(game.state!))
function itemEffect(name: string): string {
  return useSummary(items.value.find((i) => i.name === name)?.def.use).replace('・戰鬥中', '')
}

const groups = computed(() => {
  const a = actor.value
  if (!a) return []
  const list = a.abilities.map(abilityDef)
  return [
    { name: '技能', items: list.filter((x) => x.type === 'skill') },
    { name: '法術', items: list.filter((x) => x.type === 'spell').sort((x, y) => (x.circle ?? 0) - (y.circle ?? 0)) },
    { name: '戲法', items: list.filter((x) => x.type === 'cantrip') },
  ].filter((g) => g.items.length > 0)
})

function reason(a: AbilityDef): string | null {
  return actor.value ? unusableReason(combat.value, actor.value, a.id) : '不是你的回合'
}

function costText(a: AbilityDef): string {
  const ap = abilityApCost(a)
  if (a.type === 'cantrip') return '0 AP・每回合一次'
  if (a.type === 'spell') return `${a.circle} 環・${ap} AP`
  const gain = a.ap_gain ? `・+${a.ap_gain} AP` : a.ap_gain_on_hit ? `・命中 +${a.ap_gain_on_hit} AP` : ''
  return `${ap} AP${gain}`
}

function send(action: Parameters<typeof game.act>[0]) {
  pending.value = null
  game.act(action)
}

// 自願戰敗：左邊切換「不幸／主動」（記在這個瀏覽器），右邊的「戰敗」長按一秒才以戰敗結束（避免誤觸）；規則和一般戰敗一樣，只影響交給 AI 的文字
const SURRENDER = 'elondia.surrender'
const willing = ref(readWilling())
function readWilling(): boolean {
  try {
    return localStorage.getItem(SURRENDER) === 'willing'
  } catch {
    return false
  }
}
function toggleWilling() {
  willing.value = !willing.value
  try {
    localStorage.setItem(SURRENDER, willing.value ? 'willing' : 'unlucky')
  } catch {
    // 記不住也沒關係
  }
}
const HOLD_MS = 1000
/** 長按「戰敗」：按住時填滿，放開或移開就取消 */
const holding = ref(false)
let holdTimer: ReturnType<typeof setTimeout> | undefined
function holdStart(e?: Event) {
  if (e instanceof PointerEvent && e.button !== 0) return
  if (holding.value) return
  holding.value = true
  holdTimer = setTimeout(() => {
    holding.value = false
    send({ type: 'surrender', willing: willing.value })
  }, HOLD_MS)
}
function holdCancel() {
  holding.value = false
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = undefined
}
onBeforeUnmount(holdCancel)

function choose(a: AbilityDef) {
  if (a.target === 'enemy' || a.target === 'ally' || a.target === 'ally_or_downed') pending.value = { kind: 'ability', ability: a }
  else send({ type: 'ability', ability: a.id })
}

function chooseItem(name: string) {
  if (itemNeedsTarget(name)) { pending.value = { kind: 'item', item: name }; return }
  // 全體範圍與逃脫道具：不用選目標
  const list = itemTargets(combat.value, name)
  const target = list.find((t) => t.id === actor.value?.id) ?? list[0]
  if (target) send({ type: 'item', item: name, target: target.id })
}

const isTarget = (c: Combatant) => targets.value.some((t) => t.id === c.id)

// Esc 取消選目標
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && pending.value) {
    e.preventDefault()
    pending.value = null
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ── 特效播放：紀錄新增的那幾筆依序播，每筆間隔約 0.2 秒；HP 條與紀錄跟著播到哪裡才更新。
// 播放中照樣可以操作（新的紀錄接在後面播）。特效關閉時直接全部顯示。
const played = ref(combat.value.timeline.length)
const firstPlayed = combat.value.timeline.length
const field = ref<HTMLElement | null>(null)
const cards = new Map<string, Element>()
function cardRef(id: string, el: unknown) {
  if (el instanceof Element) cards.set(id, el)
  else cards.delete(id)
}
const hpDelta = computed(() => unplayedHpDelta(combat.value.timeline.slice(played.value)))
/** 畫面上的 HP（還沒播到的傷害先不扣） */
/** 高潮造成的傷害：等高潮的特效破裂之後才從 HP 條扣掉 */
const heldHp = reactive<Record<string, number>>({})
const shownHp = (c: Combatant) => Math.max(0, Math.min(c.maxHp, c.hp + (hpDelta.value[c.id] ?? 0) + (heldHp[c.id] ?? 0)))
const lustDelta = computed(() => unplayedLustDelta(combat.value.timeline.slice(played.value)))
/** 畫面上的慾望（還沒播到的先不算）；慾望戰鬥關閉時沒有慾望條 */
const shownLust = (c: Combatant) => Math.max(0, Math.min(effectiveLustMax(c), (c.lust ?? 0) - (lustDelta.value[c.id] ?? 0)))
/** 有慾望條：慾望戰鬥開著，而且不是免疫魅惑的敵人 */
const hasLustBar = (c: Combatant) => c.lustMax !== undefined && !(c.side === 'enemy' && defenseMult(c, 'lust') === 0 && !c.lust)
/** 畫面上倒下了嗎（致命的那一下還沒播到時先不算） */
const shownDown = (c: Combatant) => !isActive(c) && !(c.hp === 0 && (hpDelta.value[c.id] ?? 0) > 0)

let timer: ReturnType<typeof setTimeout> | null = null
function step() {
  timer = null
  const list = combat.value.timeline
  if (played.value >= list.length) { played.value = list.length; drained(); return }
  if (!fxOn()) { played.value = list.length; drained(); return }
  const t = list[played.value]!
  played.value++
  play(t)
  // 積了很多筆（例如敵人一口氣行動完）時加快
  const backlog = list.length - played.value
  timer = setTimeout(step, backlog > 6 ? 110 : 230)
}
function pump() {
  if (!timer) step()
}

function play(t: TimelineEntry) {
  const enemyIds = new Set(foes.value.map((c) => c.id))
  const cues = cuesFor(t)
  // 高潮：先播圍著卡片的粉光呼吸燈，傷害數字與倒下等它破裂之後才播
  const climaxWait = new Map<string, number>()
  for (const cue of cues) if (cue.kind === 'climax') climaxWait.set(cue.target, Math.round(climaxBreath(cards.get(cue.target), cue.name) * 0.95))
  const later = (target: string, fn: () => void) => {
    const wait = climaxWait.get(target)
    if (wait) setTimeout(fn, wait)
    else fn()
  }
  for (const cue of cues) {
    switch (cue.kind) {
      case 'damage': {
        const el = cards.get(cue.target)
        const show = () => {
          floatText(el, cue.amount > 0 ? `-${cue.amount}` : '0', { color: cue.amount > 0 ? cue.color : MISS_COLOR, big: cue.crit })
          if (cue.amount > 0) shake(el, cue.crit ? 2 : 1)
          flash(el, cue.area || cue.color !== PHYSICAL_COLOR ? cue.color : '#ff5a4a', cue.crit)
        }
        if (cue.climax && climaxWait.has(cue.target)) {
          heldHp[cue.target] = (heldHp[cue.target] ?? 0) + cue.amount
          later(cue.target, () => {
            heldHp[cue.target] = Math.max(0, (heldHp[cue.target] ?? 0) - cue.amount)
            show()
          })
        } else show()
        break
      }
      case 'heal': {
        const el = cards.get(cue.target)
        floatText(el, `+${cue.amount}`, { color: HEAL_COLOR })
        flash(el, HEAL_COLOR)
        break
      }
      case 'lust': {
        // 增加：粉色閃光、像素愛心的飄字與粉色粒子；消退：愛心飄字從側邊滑過
        const el = cards.get(cue.target)
        if (cue.amount > 0) lustHit(el, cue.amount, t.result === 'critical')
        else floatText(el, `${cue.amount}`, { color: LUST_COLOR, slide: true, heart: true })
        break
      }
      case 'crit':
        floatText(cards.get(cue.target), '幸運一擊！', { color: CRIT_COLOR, top: true })
        screenShake(field.value, 1.5)
        break
      case 'miss':
        floatText(cards.get(cue.target), cue.text, { color: MISS_COLOR, slide: true })
        break
      case 'fumble': {
        const el = cards.get(cue.actor)
        floatText(el, '大失敗', { color: '#c97a6e', slide: true })
        shake(el)
        break
      }
      case 'status': {
        const el = cards.get(cue.target)
        const color = cue.buff ? BUFF_COLOR : DEBUFF_COLOR
        floatText(el, cue.name, { color, top: true })
        flash(el, color)
        break
      }
      case 'down':
        // 敵人碎成像素；我方卡片的褪色下沉由 CSS 處理
        if (cue.enemy || enemyIds.has(cue.target)) {
          const el = cards.get(cue.target)
          later(cue.target, () => setTimeout(() => shatter(el), 180))
        }
        break
      case 'climax':
        // 已經在上面開始播了
        break
    }
  }
}

/** 全部播完：戰鬥結束時出勝利或戰敗的橫幅 */
let ended = combat.value.status !== 'ongoing'
function drained() {
  if (ended || combat.value.status === 'ongoing') return
  ended = true
  if (combat.value.status === 'victory') banner('勝利', 'victory')
  else if (combat.value.status === 'defeat') banner('戰敗', 'defeat')
}

watch(() => combat.value.timeline.length, (n) => {
  if (n < played.value) played.value = n
  pump()
})
watch(() => combat.value.status, () => pump())
onMounted(() => {
  // 剛開戰（不是讀檔回來）：開場橫幅；有以 BOSS 出場或層主時改紅色並震一下
  if (combat.value.timeline.length === 0 && combat.value.status === 'ongoing') {
    const boss = foes.value.some((c) => c.headliner || c.boss)
    // 踩到地圖上的格子觸發：腳下那格閃紅、畫面紅一下；BOSS 格的地圖邊框轉紅
    if (combat.value.cell) {
      screenFlash('#c8483a')
      const here = document.querySelector('.map .cell.here')
      flash(here, '#ff3a2a', true)
      if (boss) flash(document.querySelector('.map'), '#ff3a2a', true)
    }
    banner(boss ? '強敵' : '遭遇', boss ? 'boss' : 'encounter')
    if (boss) screenShake(field.value, 1.2)
  }
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

/** 倒下、撤離、已逃走 */
function downText(c: Combatant): string {
  if (c.fled) return c.side === 'enemy' ? '已逃走' : '撤離'
  return shownDown(c) ? '倒下' : ''
}

const pct = (v: number, max: number) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`

/** 戰鬥紀錄依回合分組 */
const rounds = computed(() => {
  const out: { round: number; lines: (ReturnType<typeof describeCombatLine> & { live: boolean })[]; key: number }[] = []
  combat.value.timeline.slice(0, played.value).forEach((t, i) => {
    const r = t.round ?? 0
    let g = out.at(-1)
    if (!g || g.round !== r) out.push((g = { round: r, lines: [], key: t.seq }))
    // 這次打開畫面之後才播到、有擲骰的那一行：前面的 d20 先翻滾一下
    g.lines.push({ ...describeCombatLine(t, names.value), live: i >= firstPlayed && t.roll?.value !== undefined })
  })
  return out
})

function chooseTarget(id: string) {
  const p = pending.value
  if (!p) return
  if (p.kind === 'item') send({ type: 'item', item: p.item, target: id })
  else if (p.kind === 'struggle') send({ type: 'struggle', target: id })
  else send(p.kind === 'attack' ? { type: 'attack', target: id } : { type: 'ability', ability: p.ability.id, target: id })
}

function finish() {
  if (game.finishCombat()) emit('finished')
}

/** 敵人的屬性抗性與弱點，讓玩家能針對弱點選擇攻擊 */
function affinityTags(c: Combatant): { text: string; kind: 'weak' | 'resist' | 'immune' }[] {
  const tags: { text: string; kind: 'weak' | 'resist' | 'immune' }[] = []
  for (const [key, delta] of Object.entries(c.resist)) {
    if (!delta) continue
    const m = Math.max(0, 1 + delta)
    const label = multLabel(m)
    tags.push({
      text: `${damageTypeName(key)} ${label} ×${m}`,
      kind: m === 0 ? 'immune' : m < 1 ? 'resist' : 'weak',
    })
  }
  return tags
}

function slotsText(c: Combatant): string {
  if (!c.slotMax.length) return ''
  return c.slotMax.map((max, i) => `${i + 1}環 ${c.slots[i] ?? 0}/${max}`).join('　')
}
/** 精簡版：「環 2/2・1/1」 */
function slotsShort(c: Combatant): string {
  return c.slotMax.map((max, i) => `${c.slots[i] ?? 0}/${max}`).join('・')
}

function statusTitle(id: string): string {
  const def = statusDef(id)
  return `${def.kind === 'buff' ? '增益' : '減益'}：${def.name}（${describeStatus(def)}）`
}

watch(
  played,
  async () => {
    await nextTick()
    log.value?.scrollTo({ top: log.value.scrollHeight })
  },
)

const resultText = { victory: '勝利！', defeat: '戰敗……', fled: '成功撤退', ongoing: '' }

// ── 手機版（docs/MOBILE_UI.md 第 4 節）：我方在上、敵人在下，兩欄小卡；紀錄只露最新兩行；
// 技能依類型分頁；長按卡片或技能看說明（電腦版的滑鼠提示）。
const isLewd = (a: AbilityDef) => a.classes?.includes('lewd') ?? false
function tabAbilities(id: string): AbilityDef[] {
  const list = actor.value ? actor.value.abilities.map(abilityDef) : []
  if (id === 'skill') return list.filter((x) => x.type === 'skill' && !isLewd(x))
  if (id === 'spell') return list.filter((x) => x.type === 'spell' && !isLewd(x)).sort((x, y) => (x.circle ?? 0) - (y.circle ?? 0))
  if (id === 'cantrip') return list.filter((x) => x.type === 'cantrip' && !isLewd(x))
  if (id === 'lewd') return list.filter(isLewd)
  return []
}
interface AbilityTab { id: string; label: string; count: number }
const abilityTabs = computed<AbilityTab[]>(() => [
  ...([['skill', '技能'], ['spell', '法術'], ['cantrip', '戲法'], ['lewd', '色情']] as const).map(([id, label]) => ({ id, label, count: tabAbilities(id).length })),
  { id: 'item', label: '道具', count: items.value.length },
].filter((t) => t.count > 0))
const abilityTab = ref('skill')
// 手機：選目標時把能選的卡片捲進畫面（矮螢幕上敵人可能在行動區下面）
watch(pending, (p) => {
  if (!p || !isMobile.value) return
  void nextTick(() => {
    const f = field.value
    const cards = f?.querySelectorAll<HTMLElement>('.targetable')
    if (!f || !cards?.length) return
    // 盡量讓全部能選的卡片都在畫面裡；放不下時以第一張為準
    const base = f.getBoundingClientRect().top - f.scrollTop
    const top = cards[0]!.getBoundingClientRect().top - base
    const bottom = cards[cards.length - 1]!.getBoundingClientRect().bottom - base
    let y = f.scrollTop
    if (bottom > y + f.clientHeight) y = bottom - f.clientHeight
    if (top < y) y = top
    if (y !== f.scrollTop) f.scrollTo({ top: y, behavior: 'smooth' })
  })
})
watch(abilityTabs, (tabs) => { if (!tabs.some((t) => t.id === abilityTab.value)) abilityTab.value = tabs[0]?.id ?? 'skill' }, { immediate: true })

/** 卡片上最多兩個狀態，其餘「+N」（長按看全部） */
const MAX_TAGS = 2
const shownStatuses = (c: Combatant) => (isMobile.value ? c.statuses.slice(0, MAX_TAGS) : c.statuses)
const moreStatuses = (c: Combatant) => (isMobile.value ? Math.max(0, c.statuses.length - MAX_TAGS) : 0)

/** 夾在敵我之間的紀錄：最新兩行 */
const tickerLines = computed(() => rounds.value.flatMap((g) => g.lines).slice(-2).map((l) => l.text))
const logOpen = ref(false)
const menuOpen = ref(false)

// 長按（約 0.45 秒）看說明；手指移動就取消（讓捲動與左右滑照常）。長按後放開的那一下不算點擊
type Info = { kind: 'fighter'; id: string } | { kind: 'ability'; id: string } | { kind: 'item'; name: string }
const info = ref<Info | null>(null)
let longPressed = false
function press(e: PointerEvent, what: Info) {
  if (!isMobile.value || !e.isPrimary) return
  longPressed = false
  const x0 = e.clientX, y0 = e.clientY
  const stop = () => {
    clearTimeout(hold)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('pointermove', move)
  }
  const move = (m: PointerEvent) => { if (Math.hypot(m.clientX - x0, m.clientY - y0) > 10) stop() }
  const hold = setTimeout(() => {
    longPressed = true
    info.value = what
    stop()
    try { navigator.vibrate?.(10) } catch { /* 不能震動就算了 */ }
  }, 450)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
  window.addEventListener('pointermove', move)
}
function consumeLong(): boolean {
  if (!longPressed) return false
  longPressed = false
  return true
}
/** 點卡片：選目標時出手；手機上平常點一下看詳情 */
function onCard(c: Combatant) {
  if (consumeLong()) return
  if (pending.value) {
    if (isTarget(c)) chooseTarget(c.id)
    return
  }
  if (isMobile.value) info.value = { kind: 'fighter', id: c.id }
}
/** 手機上不能用的技能照樣可以點：說出原因（手機沒有滑鼠提示） */
function tapAbility(a: AbilityDef) {
  if (consumeLong()) return
  const r = reason(a)
  if (r) return game.flash(`${a.name}：${r}`)
  choose(a)
}
function tapItem(name: string) {
  if (consumeLong()) return
  if (actor.value && actor.value.ap < costs.item) return game.flash(`${name}：行動點不足`)
  chooseItem(name)
}
const infoFighter = computed(() => {
  const i = info.value
  return i?.kind === 'fighter' ? combat.value.combatants.find((c) => c.id === i.id) ?? null : null
})
const infoAbility = computed(() => (info.value?.kind === 'ability' ? abilityDef(info.value.id) : null))
const infoItem = computed(() => {
  const i = info.value
  return i?.kind === 'item' ? items.value.find((x) => x.name === i.name) ?? null : null
})
const infoTitle = computed(() => infoFighter.value?.name ?? infoAbility.value?.name ?? infoItem.value?.name ?? '')
function pickMenu(what: 'log' | 'party' | 'settings') {
  menuOpen.value = false
  if (what === 'log') logOpen.value = true
  else emit('open', what)
}
/** 結束時的結果與按鈕：特效播完才出現 */
const showResult = computed(() => combat.value.status !== 'ongoing' && played.value >= combat.value.timeline.length)
</script>

<template>
  <!-- 手機版：戰鬥中沒有底部分頁列，上方一條「戰鬥・場景｜回合｜⋯」 -->
  <header v-if="isMobile" class="m-top">
    <span class="scene"><GameIcon name="sword" :size="16" />戰鬥<template v-if="combat.scene">・{{ combat.scene }}</template></span>
    <span class="tag round">第 {{ combat.round }} 回合</span>
    <button class="ghost m-menu" aria-label="選單" @click="menuOpen = true"><GameIcon name="more" :size="18" /></button>
  </header>
  <section ref="field" class="panel field" :class="{ picking: !!pending, lost: showResult && combat.status === 'defeat', m: isMobile }">
    <div v-if="!isMobile" class="row field-head">
      <h2 class="title"><GameIcon name="sword" :size="20" />戰鬥・{{ combat.scene ?? '' }}</h2>
      <span v-if="pending" class="pick-hint">點選發亮的卡片當目標（Esc 取消）</span>
      <span class="tag round">第 {{ combat.round }} 回合</span>
    </div>

    <div class="sides">
      <div>
        <h3 class="title side"><GameIcon name="shield" :size="16" />隊伍</h3>
        <div class="cards">
          <div
            v-for="c in party"
            :key="c.id"
            :ref="(el) => cardRef(c.id, el)"
            class="fighter"
            :class="{ current: actor?.id === c.id, down: shownDown(c), fled: c.fled, targetable: pending && isTarget(c), dim: pending && !isTarget(c) }"
            @click="onCard(c)"
            @pointerdown="press($event, { kind: 'fighter', id: c.id })"
            @contextmenu="isMobile && $event.preventDefault()"
          >
            <div class="l1">
              <NameTag :id="c.id" class="fname" />
              <span class="small muted">Lv.{{ c.level }}<template v-if="!isMobile">・幸運 {{ luckyThreshold(c.attrs) }}+</template></span>
              <span v-if="downText(c)" class="tag bad state">{{ downText(c) }}</span>
            </div>
            <div class="l2">
              <span class="hpbar" :title="`HP ${c.hp}/${c.maxHp}${c.tempHp ? `（臨時 HP ${c.tempHp}）` : ''}`">
                <span class="bar hp"><span class="ghost" :style="{ width: pct(shownHp(c), c.maxHp) }" /><span class="fill" :style="{ width: pct(shownHp(c), c.maxHp) }" /></span>
                <span class="num">{{ shownHp(c) }}/{{ c.maxHp }}<template v-if="c.tempHp">+{{ c.tempHp }}</template></span>
              </span>
              <span class="ap" :title="`行動點 ${c.ap}/${c.apMax}（每回合 +${c.apRegen}）`">
                <span v-if="c.apMax <= AP_PIPS_MAX" class="pips"><i v-for="n in c.apMax" :key="n" :class="{ on: n <= c.ap }" /></span>
                <span v-else class="pips ap-num"><i class="on" />{{ c.ap }}/{{ c.apMax }}</span>
              </span>
            </div>
            <!-- 法術環另起一行：高等級的施法者有六、七個環，和生命值、行動點擠在同一行會把生命條壓扁 -->
            <div v-if="c.slotMax.length" class="l2 slots small muted" :title="slotsText(c)">環 {{ slotsShort(c) }}</div>
            <div v-if="hasLustBar(c)" class="l2 lust" :title="`慾望 ${c.lust ?? 0}/${effectiveLustMax(c)}：滿了會高潮`">
              <span class="hpbar"><span class="bar lust"><span class="fill" :style="{ width: pct(shownLust(c), effectiveLustMax(c)) }" /></span>
                <span class="num">♥ {{ shownLust(c) }}/{{ effectiveLustMax(c) }}</span></span>
            </div>
            <div class="l3 small">
              <span v-if="isActive(c) && !isMobile" class="threat muted" :title="`仇恨值 ${Math.round(c.threat ?? 0)}・累積倍率 ×${threatMultOf(c).toFixed(2)}（職業、裝備、天賦與狀態）。敵人依仇恨加權選目標，不是絕對的。`">
                <GameIcon name="target" :size="12" />{{ Math.round((shares[c.id] ?? 0) * 100) }}%
                <span class="bar"><i :style="{ width: `${Math.round((shares[c.id] ?? 0) * 100)}%` }" /></span>
              </span>
              <span v-for="st in shownStatuses(c)" :key="st.id" class="tag" :class="statusDef(st.id).kind" :title="statusTitle(st.id)">
                {{ statusDef(st.id).name }}{{ st.turns < 99 ? ` ${st.turns}` : '' }}
              </span>
              <span v-if="moreStatuses(c)" class="tag">+{{ moreStatuses(c) }}</span>
              <span v-if="c.concentration && !isMobile" class="tag">專注：{{ abilityDef(c.concentration).name }}</span>
            </div>
          </div>
        </div>
      </div>
      <button v-if="isMobile" type="button" class="ticker" @click="logOpen = true">
        <span class="lines"><span v-for="(t, i) in tickerLines" :key="i">{{ t }}</span><span v-if="!tickerLines.length">戰鬥開始。</span></span>
        <span class="all">全部紀錄 ›</span>
      </button>
      <div>
        <h3 class="title side foe"><GameIcon name="skull" :size="16" />敵人</h3>
        <div class="cards">
          <div
            v-for="c in foes"
            :key="c.id"
            :ref="(el) => cardRef(c.id, el)"
            class="fighter"
            :class="{ current: actor?.id === c.id, down: shownDown(c), fled: c.fled, targetable: pending && isTarget(c), dim: pending && !isTarget(c), headliner: c.headliner }"
            @click="onCard(c)"
            @pointerdown="press($event, { kind: 'fighter', id: c.id })"
            @contextmenu="isMobile && $event.preventDefault()"
          >
            <div class="l1">
              <span v-if="c.headliner" class="crown" title="以 BOSS 出場"><GameIcon name="crown" :size="14" /></span>
              <strong class="fname foe-name"><ContentIcon v-if="c.defId" kind="monster" :id="c.defId" :size="22" /><span v-marquee class="marquee"><span>{{ c.name }}</span></span></strong>
              <span class="small muted">Lv.{{ c.level }}</span>
              <span v-if="downText(c)" class="tag bad state">{{ downText(c) }}</span>
            </div>
            <div class="l2">
              <span class="hpbar" :title="`HP ${c.hp}/${c.maxHp}`">
                <span class="bar hp"><span class="ghost" :style="{ width: pct(shownHp(c), c.maxHp) }" /><span class="fill" :style="{ width: pct(shownHp(c), c.maxHp) }" /></span>
                <span class="num">{{ shownHp(c) }}/{{ c.maxHp }}</span>
              </span>
              <span class="tag">{{ damageTypeName(c.weapon.type) }}攻擊</span>
            </div>
            <div v-if="hasLustBar(c)" class="l2 lust" :title="`慾望 ${c.lust ?? 0}/${effectiveLustMax(c)}：滿了會高潮`">
              <span class="hpbar"><span class="bar lust"><span class="fill" :style="{ width: pct(shownLust(c), effectiveLustMax(c)) }" /></span>
                <span class="num">♥ {{ shownLust(c) }}/{{ effectiveLustMax(c) }}</span></span>
            </div>
            <div class="l3 small">
              <span v-for="t in isMobile ? [] : affinityTags(c)" :key="t.text" class="tag" :class="t.kind">{{ t.text }}</span>
              <span v-for="t in isMobile ? [] : c.traits ?? []" :key="t" class="tag trait" :title="monsterTraits.traits[t]?.desc ?? ''">{{ monsterTraits.traits[t]?.name ?? t }}</span>
              <span v-for="st in shownStatuses(c)" :key="st.id" class="tag" :class="statusDef(st.id).kind" :title="statusTitle(st.id)">
                {{ statusDef(st.id).name }}{{ st.turns < 99 ? ` ${st.turns}` : '' }}
              </span>
              <span v-if="moreStatuses(c)" class="tag">+{{ moreStatuses(c) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section v-if="!isMobile" class="panel log-panel">
    <h3 class="title"><GameIcon name="scroll" :size="16" />戰鬥紀錄</h3>
    <div ref="log" class="log small">
      <div v-for="g in rounds" :key="g.key" class="round-group">
        <h4 v-if="g.round" class="round-head">第 {{ g.round }} 回合</h4>
        <div v-for="(l, i) in g.lines" :key="i" class="line" :title="l.detail">
          <span v-if="l.live" class="die"><GameIcon name="d20" :size="12" /></span>
          {{ l.text }}
          <div v-for="(t, k) in l.targets ?? []" :key="k" class="sub" :title="t.detail">{{ t.text }}</div>
        </div>
      </div>
      <div v-if="played === 0" class="muted">戰鬥開始。</div>
    </div>
  </section>

  <section class="panel actions" :class="{ m: isMobile }">
    <template v-if="combat.status === 'ongoing' && actor">
      <div class="row" style="justify-content: space-between">
        <h3 class="title"><GameIcon name="d20" :size="16" />{{ actor.name }} 的行動</h3>
        <span class="tag ap-left">剩餘 <strong>{{ actor.ap }}</strong> AP</span>
        <button v-if="isMobile && !pending" class="small end-turn" @click="send({ type: 'end_turn' })">結束回合</button>
        <!-- 手機：取消固定在這一行的右邊，目標再多也不會被擠出畫面 -->
        <button v-if="isMobile && pending" class="small end-turn" @click="pending = null">取消</button>
      </div>
      <template v-if="pending">
        <p class="small muted">{{ isMobile ? '選擇目標：點發亮的卡片，或用下面的按鈕' : '選擇目標：點上方發亮的卡片，或用下面的按鈕（Esc 取消）' }}</p>
        <div class="row targets">
          <button v-for="t in targets" :key="t.id" @click="chooseTarget(t.id)">{{ t.name }}（{{ t.hp }}/{{ t.maxHp }}）</button>
          <button v-if="!isMobile" class="small" @click="pending = null">取消</button>
        </div>
      </template>
      <template v-else>
        <div class="row basics">
          <button class="primary" :disabled="actor.ap < costs.weapon_attack" @click="pending = { kind: 'attack' }">
            {{ actor.weapon.name }}攻擊 <span class="small">{{ costs.weapon_attack }} AP<template v-if="!isMobile">・{{ damageTypeName(actor.weapon.type) }}</template></span>
          </button>
          <button :disabled="actor.ap < costs.defend" @click="send({ type: 'defend' })">防禦 <span class="small muted">{{ costs.defend }} AP</span></button>
          <button v-if="bound.length" :disabled="actor.ap < struggleAp" :title="`力量或靈巧（較高的）+ 熟練檢定\n${struggleTitle}`" @click="struggle">
            {{ bound.some((t) => t.id === actor!.id) ? '掙脫' : '撕開' }} <span class="small muted">{{ struggleAp }} AP</span>
          </button>
          <button class="danger" :disabled="actor.ap < costs.flee" @click="send({ type: 'flee' })">撤退 <span class="small">{{ costs.flee }} AP</span></button>
          <button v-if="!isMobile" @click="send({ type: 'end_turn' })">結束回合</button>
          <!-- 自願戰敗：放在最右邊，「戰敗」要長按 -->
          <span class="surrender" role="group" aria-label="自願戰敗">
            <button
              class="mode" :class="{ on: willing }" :aria-pressed="willing"
              :title="willing ? '主動：主角自己放棄抵抗、向敵人認輸（點一下切換成不幸）' : '不幸：主角是力戰不敵才倒下的（點一下切換成主動）'"
              @click="toggleWilling"
            >{{ willing ? '主動' : '不幸' }}</button>
            <button
              class="danger go" :class="{ holding }" :style="{ '--hold': `${HOLD_MS}ms` }"
              title="長按一秒：直接以戰敗結束這場戰鬥（規則和一般戰敗一樣，左邊的選擇只影響正文）"
              @pointerdown="holdStart" @pointerup="holdCancel" @pointerleave="holdCancel" @pointercancel="holdCancel" @contextmenu.prevent
              @keydown.enter.prevent="holdStart()" @keydown.space.prevent="holdStart()" @keyup="holdCancel" @blur="holdCancel"
            ><span class="fill" />戰敗</button>
          </span>
        </div>
        <div v-if="!isMobile" class="groups">
          <div v-for="g in groups" :key="g.name" class="group">
            <h4 class="small muted">{{ g.name }}</h4>
            <div class="row">
              <button
                v-for="a in g.items"
                :key="a.id"
                :disabled="reason(a) !== null"
                :title="`${a.desc}${reason(a) ? `\n（${reason(a)}）` : ''}`"
                class="ability"
                @click="choose(a)"
              >
                <span class="an"><ContentIcon kind="ability" :def="a" :size="18" />{{ a.name }}</span>
                <span class="small muted sub2">{{ costText(a) }}</span>
              </button>
            </div>
          </div>
          <div v-if="items.length" class="group">
            <h4 class="small muted"><GameIcon name="potion" :size="13" /> 道具（{{ costs.item }} AP）</h4>
            <div class="row">
              <button
                v-for="i in items"
                :key="i.name"
                class="ability"
                :disabled="actor.ap < costs.item"
                :title="`${i.def.desc ?? ''}${i.def.desc ? '\n' : ''}${itemEffect(i.name)}${actor.ap < costs.item ? '\n（行動點不足）' : ''}`"
                @click="chooseItem(i.name)"
              >
                <span class="an">{{ i.name }} ×{{ i.qty }}</span>
                <span class="small muted sub2">{{ itemEffect(i.name) }}</span>
              </button>
            </div>
          </div>
        </div>
        <!-- 手機版：技能依類型分頁，可以左右滑；不能用的照樣能點（說出原因），長按看說明 -->
        <SwipeTabs v-if="isMobile" v-model="abilityTab" :tabs="abilityTabs" swipe bar class="m-skills">
          <template #tab="{ tab: t }">{{ t.label }}<span class="cnt">{{ (t as AbilityTab).count }}</span></template>
          <template #default="{ id }">
            <div class="m-grid">
              <template v-if="id === 'item'">
                <button
                  v-for="i in items" :key="i.name" class="ability" :class="{ off: actor.ap < costs.item }"
                  @pointerdown="press($event, { kind: 'item', name: i.name })" @contextmenu.prevent @click="tapItem(i.name)"
                >
                  <span class="an">{{ i.name }} ×{{ i.qty }}</span>
                  <span class="small muted sub2">{{ costs.item }} AP</span>
                </button>
              </template>
              <template v-else>
                <button
                  v-for="a in tabAbilities(id)" :key="a.id" class="ability" :class="{ off: reason(a) !== null, lewd: isLewd(a) }"
                  @pointerdown="press($event, { kind: 'ability', id: a.id })" @contextmenu.prevent @click="tapAbility(a)"
                >
                  <span class="an"><ContentIcon kind="ability" :def="a" :size="16" />{{ a.name }}</span>
                  <span class="small muted sub2">{{ costText(a) }}</span>
                </button>
              </template>
            </div>
          </template>
        </SwipeTabs>
      </template>
    </template>
    <template v-else-if="showResult">
      <h3>{{ resultText[combat.status] }}</h3>
      <button class="primary" @click="finish">結束戰鬥並產生戰報</button>
    </template>
  </section>

  <template v-if="isMobile">
    <BottomSheet :open="!!info" :title="infoTitle" @close="info = null">
      <dl v-if="infoFighter" class="m-info">
        <dt>生命</dt><dd>{{ shownHp(infoFighter) }} / {{ infoFighter.maxHp }}<template v-if="infoFighter.tempHp">（臨時 {{ infoFighter.tempHp }}）</template><template v-if="downText(infoFighter)">・{{ downText(infoFighter) }}</template></dd>
        <template v-if="hasLustBar(infoFighter)"><dt>慾望</dt><dd>{{ shownLust(infoFighter) }} / {{ effectiveLustMax(infoFighter) }}（滿了會高潮）</dd></template>
        <template v-if="infoFighter.side === 'party'">
          <dt>行動點</dt><dd>{{ infoFighter.ap }} / {{ infoFighter.apMax }}（每回合 +{{ infoFighter.apRegen }}）</dd>
          <template v-if="infoFighter.slotMax.length"><dt>法術環</dt><dd>{{ slotsText(infoFighter) }}</dd></template>
          <dt>幸運一擊</dt><dd>自然骰 {{ luckyThreshold(infoFighter.attrs) }} 以上</dd>
          <template v-if="isActive(infoFighter)"><dt>仇恨</dt><dd>{{ Math.round((shares[infoFighter.id] ?? 0) * 100) }}%（累積倍率 ×{{ threatMultOf(infoFighter).toFixed(2) }}）。敵人依仇恨加權選目標，不是絕對的。</dd></template>
          <template v-if="infoFighter.concentration"><dt>專注</dt><dd>{{ abilityDef(infoFighter.concentration).name }}</dd></template>
        </template>
        <template v-else>
          <dt>等級</dt><dd>Lv.{{ infoFighter.level }}<template v-if="infoFighter.headliner">・以 BOSS 出場</template></dd>
          <dt>攻擊</dt><dd>{{ damageTypeName(infoFighter.weapon.type) }}</dd>
          <template v-if="affinityTags(infoFighter).length"><dt>抗性</dt><dd><span v-for="t in affinityTags(infoFighter)" :key="t.text" class="tag" :class="t.kind">{{ t.text }}</span></dd></template>
          <template v-if="infoFighter.traits?.length"><dt>特性</dt><dd><div v-for="t in infoFighter.traits" :key="t"><b>{{ monsterTraits.traits[t]?.name ?? t }}</b>：{{ monsterTraits.traits[t]?.desc ?? '' }}</div></dd></template>
        </template>
        <dt>狀態</dt>
        <dd>
          <div v-for="st in infoFighter.statuses" :key="st.id">{{ statusTitle(st.id) }}{{ st.turns < 99 ? `・剩 ${st.turns} 回合` : '' }}</div>
          <template v-if="!infoFighter.statuses.length">無</template>
        </dd>
      </dl>
      <div v-else-if="infoAbility" class="m-info">
        <p>{{ infoAbility.desc }}</p>
        <dl>
          <dt>花費</dt><dd>{{ costText(infoAbility) }}</dd>
          <template v-if="reason(infoAbility)"><dt>現在</dt><dd class="bad">{{ reason(infoAbility) }}</dd></template>
        </dl>
      </div>
      <div v-else-if="infoItem" class="m-info">
        <p>{{ infoItem.def.desc }}</p>
        <dl><dt>效果</dt><dd>{{ itemEffect(infoItem.name) }}</dd><dt>花費</dt><dd>{{ costs.item }} AP</dd></dl>
      </div>
    </BottomSheet>
    <BottomSheet :open="logOpen" title="戰鬥紀錄" @close="logOpen = false">
      <div class="m-log small">
        <div v-for="g in rounds" :key="g.key">
          <h4 v-if="g.round" class="round-head">第 {{ g.round }} 回合</h4>
          <div v-for="(l, i) in g.lines" :key="i" class="line">
            {{ l.text }}
            <div v-for="(t, k) in l.targets ?? []" :key="k" class="sub">{{ t.text }}</div>
            <div v-if="l.detail" class="muted detail">{{ l.detail }}</div>
          </div>
        </div>
        <div v-if="played === 0" class="muted">戰鬥開始。</div>
      </div>
    </BottomSheet>
    <BottomSheet :open="menuOpen" title="選單" @close="menuOpen = false">
      <div class="m-menu-list">
        <button @click="pickMenu('log')"><GameIcon name="scroll" :size="18" />戰鬥紀錄</button>
        <button @click="pickMenu('party')"><GameIcon name="users" :size="18" />隊伍</button>
        <button @click="pickMenu('settings')"><GameIcon name="settings" :size="18" />設定</button>
      </div>
    </BottomSheet>
  </template>
</template>

<style scoped>
.field-head { justify-content: space-between; flex-wrap: nowrap; }
.field-head h2 { margin: 0; }
.pick-hint { margin-left: auto; margin-right: 8px; color: var(--gold-hi); font-size: var(--fs-sm); }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 6px; }
.title { display: flex; align-items: center; gap: 6px; }
.title :deep(.game-icon) { color: var(--accent); }
.side { margin: 0 0 6px; }
.side.foe, .side.foe :deep(.game-icon) { color: var(--danger); }
.round { color: var(--gold-hi); border-color: var(--gold-lo); }
.ap-left strong { color: var(--gold-hi); }
/* 精簡卡片：名字列、HP／AP／法術環、仇恨與狀態 */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.fighter {
  border: 1px solid #ffffff14; border-radius: 3px; padding: 5px 8px; background: #0004; display: grid; gap: 3px; align-content: start;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s; min-width: 0;
}
.fighter.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 10px #f0d08333; animation: breathe 2.4s ease-in-out infinite; }
/* 輪到誰：金框慢慢呼吸 */
@keyframes breathe { 50% { box-shadow: 0 0 0 1px var(--gold-hi), 0 0 16px #f0d08366; } }
:global(html[data-fx='lite']) .fighter.current { animation: none; }
/* 新加上的狀態標籤彈出來 */
.l3 .tag.buff, .l3 .tag.debuff { animation: tag-pop 0.3s steps(4, end); }
@keyframes tag-pop { from { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.2); opacity: 1; } }
/* 戰敗：整個戰場慢慢變灰變暗 */
.field { transition: filter 1.4s ease; }
.field.lost { filter: grayscale(0.85) brightness(0.7); }
.fighter.down { opacity: 0.4; filter: grayscale(0.7); transform: translateY(3px); transition: opacity 0.5s, filter 0.5s, transform 0.5s steps(4, end), border-color 0.15s, box-shadow 0.15s; }
/* 敵人倒下：碎片散開後卡片才淡掉 */
.side.foe + .cards .fighter.down:not(.fled) { transition-delay: 0.25s; }
.fighter.fled { transform: translateX(14px); opacity: 0.25; filter: none; }
.side.foe + .cards .fighter.fled { transform: translateX(-14px); }
.fighter.dim { opacity: 0.35; }
/* 以 BOSS 出場的怪物：金色邊框 */
.fighter.headliner {
  border: 2px solid #e2b04a; padding: 4px 7px;
  background: linear-gradient(180deg, #e2b04a1f, #0004 60%);
  box-shadow: 0 0 0 1px #6d5128, 0 0 12px #f0d08355, inset 0 0 0 1px #f0d08333;
}
.fighter.headliner.current { box-shadow: 0 0 0 1px var(--accent), 0 0 16px #f0d083aa; }
.fighter.headliner .fname { color: var(--gold-hi); }
.crown { display: inline-flex; color: var(--gold-hi); flex: none; }
.fighter.targetable { cursor: pointer; border-color: var(--gold-hi); border-style: dashed; box-shadow: 0 0 8px #f0d08355; opacity: 1; }
.fighter.targetable:hover { box-shadow: 0 0 0 1px var(--gold-hi), 0 0 14px #f0d08399; }
.l1, .l2 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.l1 .fname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l1 .foe-name { display: flex; align-items: center; }
.foe-name .marquee { flex: 1 1 auto; }
.l1 > .small { white-space: nowrap; }
.state { margin-left: auto; padding: 0 5px; }
.l3 { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; min-height: 0; }
.l3:empty { display: none; }
.l3 .tag, .l2 .tag { margin: 0; }
.hpbar { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 70px; }
.hpbar .bar { flex: 1; height: 8px; }
/* 慾望條：粉紅色，比 HP 條細 */
.l2.lust .bar { height: 5px; }
.bar.lust > span { background: linear-gradient(180deg, #ff9ccb, #e0508f 50%, #9a2a5c); }
/* HP 殘影：白色的一段先留著，再慢慢追上真實值 */
.bar > span.ghost { position: absolute; left: 0; top: 0; background: #fff6e0cc; transition: width 0.45s ease-out 0.35s; }
.bar > span.ghost::after { display: none; }
.bar > span.fill { transition: width 0.12s steps(3, end); }
.num { font-size: var(--fs-xs); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ap { flex: none; }
.pips { display: inline-flex; gap: 2px; }
.ap-num { align-items: center; gap: 3px; font-size: var(--fs-xs); color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pips i { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--accent); display: inline-block; }
.pips i.on { background: var(--accent); }
.slots { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.tag.buff { border-color: var(--good); color: var(--good); }
.tag.debuff, .tag.bad { border-color: var(--danger); color: var(--danger); }
.tag.weak { border-color: var(--good); color: var(--good); }
.tag.resist { border-color: var(--muted); }
.tag.immune { border-color: var(--danger); color: var(--danger); }
.threat { display: inline-flex; gap: 4px; align-items: center; }
.threat .bar { width: 40px; height: 4px; background: var(--border); border: none; box-shadow: none; border-radius: 2px; overflow: hidden; }
.threat .bar i { display: block; height: 100%; background: var(--danger); }
.trait { border-color: var(--accent-2); color: var(--accent-2); }
.foe-name { display: inline-flex; align-items: center; gap: 4px; }

/* 戰鬥紀錄：依回合分組，自己捲動 */
.log-panel h3 { margin: 0 0 4px; }
.log { max-height: 190px; overflow-y: auto; display: grid; gap: 0; padding-left: 8px; border-left: 2px solid #c8483a66; }
.round-head { margin: 4px 0 2px; font-size: var(--fs-xs); font-weight: normal; color: var(--accent-2); letter-spacing: 0.1em; }
.round-group:first-child .round-head { margin-top: 0; }
.line { padding: 2px 0 2px 6px; border-bottom: 1px dotted #ffffff10; }
.line[title] { cursor: help; }
.line .sub { padding-left: 1.2em; color: var(--muted); }
/* 擲骰：d20 翻滾 0.3 秒，接著那一行的字才出來 */
.line .die { display: inline-flex; vertical-align: -2px; margin-right: 3px; color: var(--accent); animation: die-roll 0.3s steps(6, end); }
.line:has(.die) { animation: line-in 0.3s steps(1, end); }
@keyframes die-roll { from { transform: rotate(-360deg) scale(1.4); } }
@keyframes line-in { from { color: transparent; } }
.round-group:last-child .line:last-child { color: var(--text); border-bottom: none; }

/* 行動面板固定在視窗底部，捲到哪裡都點得到 */
.actions { position: sticky; bottom: 0; z-index: 5; box-shadow: 0 -10px 24px #000c; margin-bottom: 0; background-color: var(--bg); }
.actions h3 { margin: 0; }
.basics { margin: 6px 0 4px; }
/* 自願戰敗：「不幸／主動」和「戰敗」連成一顆按鈕 */
.surrender { display: inline-flex; margin-left: auto; }
.surrender > button { margin: 0; }
.surrender .mode { border-top-right-radius: 0; border-bottom-right-radius: 0; border-right-width: 0; min-width: 3.2em; color: var(--muted); }
.surrender .mode.on { color: var(--accent); }
.surrender .go { position: relative; overflow: hidden; border-top-left-radius: 0; border-bottom-left-radius: 0; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none; }
/* 長按的進度：按住時從左填到右，放開就退回 */
.surrender .go .fill { position: absolute; inset: 0; background: currentColor; opacity: 0.25; transform: scaleX(0); transform-origin: left; pointer-events: none; }
.surrender .go.holding .fill { transform: scaleX(1); transition: transform var(--hold) linear; }
.groups { max-height: 30vh; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 0 18px; align-items: flex-start; }
.group { min-width: 0; }
.group .row { gap: 4px; }
.group h4 { margin: 4px 0 3px; font-weight: normal; color: var(--accent-2); display: flex; align-items: center; gap: 4px; }
/* 技能與道具按鈕固定兩行高：不能用的原因放在滑鼠提示 */
.ability { display: inline-grid; grid-template-rows: auto auto; text-align: left; line-height: 1.3; min-width: 120px; max-width: 220px; }
.ability .an { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ability .sub2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 720px) {
  .sides { grid-template-columns: 1fr; }
}

/* ── 手機版（MobileGame 裡：上方列、可捲動的戰場、固定在下面的行動區） */
.m-top {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; min-height: 40px; box-sizing: border-box;
  background: linear-gradient(180deg, #2a1712, #1d1210); border-bottom: 1px solid #7a2f22;
}
.m-top .scene { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; font-weight: 900; color: var(--gold-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-top .scene :deep(.game-icon) { color: var(--danger); }
.m-top .m-menu { width: 36px; height: 34px; padding: 0; display: grid; place-items: center; border: none; }
.field.m { padding: 8px 10px; margin: 0; }
/* 敵人貼在行動區上方（拇指好點），多出來的空白留在我方下面 */
.field.m .sides { display: flex; flex-direction: column; gap: 8px; margin-top: 0; min-height: 100%; }
.field.m .ticker { margin-top: auto; }
.field.m .side { font-size: var(--fs-xs); letter-spacing: 0.12em; }
.field.m .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.field.m .fighter { padding: 5px 7px; cursor: pointer; -webkit-touch-callout: none; user-select: none; }
.field.m .hpbar { min-width: 0; }
/* 卡片上只留生命、慾望、行動點與狀態；武器屬性、法術環、仇恨、抗性、特性在長按（點一下）的詳情裡 */
.field.m .l2 > .tag, .field.m .l2.slots { display: none; }
.ticker {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; text-align: left; box-sizing: border-box;
  background: #1a1410; border: 1px solid var(--border); border-radius: var(--radius); box-shadow: none; font-size: var(--fs-sm);
}
.ticker .lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ticker .lines span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.ticker .lines span:last-child { color: var(--text); }
.ticker .all { flex: none; font-size: var(--fs-xs); color: var(--accent); }
.actions.m { position: static; margin: 0; padding: 8px 10px 10px; box-shadow: none; border-left: none; border-right: none; border-radius: 0; }
.actions.m .end-turn { margin-left: auto; }
.actions.m .row { flex-wrap: nowrap; gap: 6px; }
.actions.m .targets { overflow-x: auto; padding-bottom: 2px; }
.actions.m .targets button { flex: none; }
.actions.m .basics { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); margin: 6px 0; }
.actions.m .surrender { display: flex; min-width: 0; }
.actions.m .surrender > button { flex: 1; min-width: 0; }
.actions.m .basics button { min-height: 42px; padding: 2px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-skills :deep(.st-bar) { margin-bottom: 6px; }
.m-skills .cnt { margin-left: 2px; font-size: var(--fs-xs); color: var(--muted); }
.m-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; max-height: 152px; overflow-y: auto; overscroll-behavior: contain; }
.m-grid .ability { min-width: 0; max-width: none; min-height: 46px; padding: 4px 6px; -webkit-touch-callout: none; user-select: none; }
.m-grid .ability.off { opacity: 0.45; }
.m-grid .ability.lewd .an { color: #ff9ccb; }
.m-info { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: var(--fs-sm); line-height: 1.6; }
.m-info p { grid-column: 1 / -1; margin: 0; }
.m-info dl { grid-column: 1 / -1; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
.m-info dt { color: var(--muted); }
.m-info dd { margin: 0; min-width: 0; }
.m-info .bad { color: var(--danger); }
.m-log .round-head { margin: 8px 0 2px; color: var(--accent); font-size: var(--fs-xs); letter-spacing: 0.12em; }
.m-log .line { padding: 2px 0; }
.m-log .sub { padding-left: 1em; color: var(--muted); }
.m-log .detail { font-size: var(--fs-xs); padding-left: 1em; }
.m-menu-list { display: grid; gap: 6px; }
.m-menu-list button { display: flex; align-items: center; gap: 8px; min-height: 46px; justify-content: flex-start; }
</style>
