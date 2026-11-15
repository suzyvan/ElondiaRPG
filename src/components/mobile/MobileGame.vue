<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { cellName, linkTargetName } from '@/engine/grid'
import { nearbyPeople } from '@/engine/population'
import { shopTitle } from '@/engine/shopNames'
import { shopPlace, shopTypeForCell } from '@/engine/trade'
import { useGame } from '@/stores/game'
import { useSettings } from '@/stores/settings'
import CombatView from '../CombatView.vue'
import IntentPanel from '../IntentPanel.vue'
import LogView from '../LogView.vue'
import MapPanel from '../MapPanel.vue'
import NegotiationPanel from '../NegotiationPanel.vue'
import PeoplePanel from '../PeoplePanel.vue'
import PlacePanel from '../PlacePanel.vue'
import RestPanel from '../RestPanel.vue'
import RoadPanel from '../RoadPanel.vue'
import { eventDialogOpen, openEvents } from '../events/eventQueue'
import GameIcon from '../ui/GameIcon.vue'
import type { IconName } from '../ui/iconPaths'
import BottomSheet from './BottomSheet.vue'
import { OPEN_ACTION_EVENT, guardExit } from './mobile'

// 手機版的冒險畫面（寬度 720px 以下，見 docs/MOBILE_UI.md）：
// 上：狀態列（只看）→ 地圖（探索時大、閱讀時縮成一條）→ 日誌與主動行動列 → 情境按鈕 → 底部分頁列。
// 這裡、休息、設施、更多用半屏面板；隊伍與更多裡的功能是全螢幕頁面（App 的對話框，手機上自動全螢幕）。
export type MobileOpen = 'party' | 'relations' | 'notebook' | 'craft' | 'contract' | 'slaves' | 'saves' | 'settings' | 'prompts' | 'content' | 'home' | 'quickload' | 'logsettings'
const props = defineProps<{
  hud: { day: number; clock: string; daytime: boolean; place: string; money: string; crime: { text: string; title: string } | null }
  events: number
  blockingEvent: boolean
  badges: { party: boolean; relations: number; notebook: number; contract: boolean }
  enslaved: boolean
  /** 主角擁有奴隸：「更多」裡多一項「奴隸」 */
  ownsSlaves?: boolean
}>()
const emit = defineEmits<{ open: [what: MobileOpen] }>()

const game = useGame()
const settings = useSettings()
const s = computed(() => game.state!)
const inCombat = computed(() => !!s.value.combat)

// ── 探索／閱讀狀態：閱讀時地圖縮成一條
const reading = ref(false)
const area = computed(() => game.area)
const cell = computed(() => game.cell)

// ── 情境按鈕：旅途中往前走；站在設施（或有事可做的格子）上時打開設施面板
const PLAIN = new Set(['floor', 'wall', 'water', 'road'])
const place = computed(() => {
  // 房子裡站在大門或樓梯上：直接過去（以前一律是「查看房屋」，手機出不了門）
  if (area.value.kind === 'home' && cell.value?.kind === 'link') return { verb: '前往', name: linkTargetName(s.value) ?? '別處', go: true }
  if (area.value.kind === 'home') return { verb: '查看', name: '房屋' }
  const k = cell.value?.kind
  if (cell.value?.storyNode) return { verb: '查看', name: '任務點' }
  if (!k || PLAIN.has(k)) return null
  const shop = k === 'inn' ? 'inn' : shopTypeForCell(k)
  const name = (shop && shopTitle(shopPlace(s.value).id, shop)?.name) || cellName(k) || '這裡'
  const building = !!shop || ['guild', 'tavern', 'temple', 'gate', 'brothel', 'lot', 'manor'].includes(k) || k.startsWith('lm_')
  return { verb: building ? '進入' : '查看', name }
})
const onRoad = computed(() => !!s.value.road && area.value.kind === 'road')
const roadBusy = computed(() => !!s.value.roadEvent || !!s.value.combat || !!s.value.pendingMasterEvent || !!s.value.standoff || !!s.value.pendingAction || game.judging)
const roadEnd = computed(() => (s.value.position?.x ?? 0) >= area.value.width - 1)

// ── 半屏面板
type Sheet = 'here' | 'rest' | 'place' | 'more'
const sheet = ref<Sheet | null>(null)
// 休息、設施面板自己有標題（與說明），面板上不再寫一次
const SHEET_TITLE: Record<Sheet, string> = { here: '這裡', rest: '', place: '', more: '更多' }
const sheetTitle = computed(() => (sheet.value ? SHEET_TITLE[sheet.value] : ''))
function toggleSheet(k: Sheet) {
  sheet.value = sheet.value === k ? null : k
}
// 「這裡的人」的「主動行動」：關掉面板，日誌底部的主動行動列自己會展開
const onOpenAction = () => { sheet.value = null }
window.addEventListener(OPEN_ACTION_EVENT, onOpenAction)
onBeforeUnmount(() => window.removeEventListener(OPEN_ACTION_EVENT, onOpenAction))
// 冒險畫面上沒有面板時按返回鍵：先提示，兩秒內再按一次才離開遊戲
guardExit(() => game.flash('再按一次返回鍵離開遊戲'))
onBeforeUnmount(() => guardExit(null))
// 換了格子、開始戰鬥：設施面板關掉（內容已經不是同一個地方）
watch(() => `${area.value.key}|${s.value.position?.x},${s.value.position?.y}`, () => { if (sheet.value === 'place') sheet.value = null })
watch(inCombat, (on) => { if (on) sheet.value = null })

const nearby = computed(() => nearbyPeople(s.value).length)
/** 談判進行中：「這裡」按鈕上一個紅點（進行中的事在「這裡」面板） */
const negotiating = computed(() => (s.value.negotiations?.length ?? 0) > 0)
const moreBadge = computed(() => props.badges.relations + props.badges.notebook + (props.badges.contract ? 1 : 0))
type MoreItem = { icon: IconName; label: string; open?: MobileOpen; run?: () => void; badge?: number | string }
const moreItems = computed<MoreItem[]>(() => [
  { icon: 'heart', label: '關係', open: 'relations', badge: props.badges.relations },
  { icon: 'notebook', label: '筆記', open: 'notebook', badge: props.badges.notebook },
  { icon: 'tools', label: '工藝', open: 'craft' },
  ...(props.enslaved ? [{ icon: 'lock' as IconName, label: '契約', open: 'contract' as MobileOpen, badge: props.badges.contract ? '!' : undefined }] : []),
  ...(props.ownsSlaves ? [{ icon: 'link' as IconName, label: '奴隸', open: 'slaves' as MobileOpen }] : []),
  { icon: 'saves', label: '存讀檔', open: 'saves' },
  { icon: 'save', label: '快存', run: () => void game.quickSave() },
  { icon: 'load', label: '快讀', open: 'quickload' },
  { icon: 'settings', label: '設定', open: 'settings' },
  { icon: 'globe', label: settings.uiLanguage === 'zh-Hans' ? '繁體' : '简体', run: () => { settings.uiLanguage = settings.uiLanguage === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans' } },
  { icon: 'script', label: '提示詞與正則', open: 'prompts' },
  { icon: 'world', label: '世界', open: 'content' },
  { icon: 'home', label: '首頁', open: 'home' },
])
function pickMore(m: MoreItem) {
  // 頁面蓋在「更多」上面，返回後面板還在；直接執行的動作、離開冒險頁的項目關掉面板
  if (m.run) {
    sheet.value = null
    m.run()
    return
  }
  if (m.open === 'prompts' || m.open === 'content' || m.open === 'home' || m.open === 'quickload') sheet.value = null
  if (m.open) emit('open', m.open)
}

// ── 有新的 AI 敘事時切到閱讀狀態
const latest = computed(() => s.value.reports.at(-1)?.report_id)
const narrating = computed(() => (latest.value && (game.narrations[latest.value]?.text.length ?? 0) > 0 ? latest.value : null))
watch(narrating, (id) => { if (id) reading.value = true })

// ── 鍵盤打開（文字框拿到焦點）時收起地圖。鍵盤收起時：中間有新的日誌、或還在判定，就維持閱讀狀態；不然放回原本的狀態。
// 收起地圖只改 reading，主動行動列不會重畫，文字框的焦點留著（樣稿 v2.1 的 bug，見計畫 2.1 節）
const root = ref<HTMLElement | null>(null)
let kb: { reports: number } | null = null
const typing = (el: Element | null) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type))
// 打字時（鍵盤打開）情境按鈕與分頁列也藏起來，把高度讓給日誌與文字框
const kbOpen = ref(false)
function onFocusIn(e: FocusEvent) {
  if (!typing(e.target as Element)) return
  kbOpen.value = true
  if (reading.value) return
  kb = { reports: s.value.reports.length }
  reading.value = true
}
function onFocusOut(e: FocusEvent) {
  if (!typing(e.target as Element)) return
  setTimeout(() => {
    const now = document.activeElement
    if (!typing(now)) kbOpen.value = false
    // 換到另一個文字框、或還在主動行動列裡（選對象、能力）：鍵盤沒收起或馬上會再打開
    if (!kb || typing(now) || (now && root.value?.querySelector('.action-bar')?.contains(now))) return
    const before = kb
    kb = null
    if (game.judging || s.value.pendingAction || s.value.reports.length > before.reports) return
    reading.value = false
  }, 200)
}
</script>

<template>
  <div ref="root" class="mobile-game" :class="{ typing: kbOpen }" @focusin="onFocusIn" @focusout="onFocusOut">
    <!-- 狀態列：只看不按（待處理的鈴鐺除外） -->
    <header v-if="!inCombat" class="status">
      <span class="cell"><GameIcon :name="hud.daytime ? 'sun' : 'moon'" :size="14" :class="hud.daytime ? 'sun' : 'night'" /><b>第{{ hud.day }}天 {{ hud.clock }}</b></span>
      <span class="cell place"><GameIcon name="pin" :size="14" /><b>{{ hud.place }}</b></span>
      <span class="cell money"><GameIcon name="coins" :size="14" /><b>{{ hud.money }}</b></span>
      <span v-if="hud.crime" class="cell crime" :title="hud.crime.title"><GameIcon name="siren" :size="14" /><b>{{ hud.crime.text }}</b></span>
      <button v-if="events" class="bell ghost" :class="{ hot: blockingEvent }" aria-label="待處理" @click="openEvents()">
        <GameIcon name="bell" :size="20" /><span class="badge">{{ events }}</span>
      </button>
    </header>
    <div v-if="game.saveWarning" class="error banner">
      <GameIcon name="warning" :size="14" /> {{ game.saveWarning }}
      <button class="small" @click="emit('open', 'saves')">存讀檔</button>
    </div>

    <template v-if="inCombat">
      <!-- 戰鬥：CombatView 的手機版（上方列、戰場、行動區），不顯示狀態列與底部分頁列（計畫 6 節） -->
      <main class="combat"><CombatView @open="emit('open', $event)" /></main>
    </template>
    <template v-else>
      <!-- 地圖：探索時大、閱讀時縮成一條 -->
      <section class="map" :class="{ reading }">
        <!-- 收起時只剩這一條；展開時地圖面板自己有地名，收起用底部的「地圖」 -->
        <button v-if="reading" class="map-head" type="button" aria-expanded="false" @click="reading = false">
          <b>{{ onRoad ? '旅途' : area.name }}</b>
          <span class="sub">{{ place && !onRoad ? `在${place.name}` : '' }}</span>
          <span class="toggle">{{ onRoad ? '展開旅途' : '展開地圖' }}<GameIcon name="down" :size="14" /></span>
        </button>
        <div v-show="!reading" class="map-body">
          <MapPanel />
          <RoadPanel v-if="s.road" />
        </div>
      </section>

      <main class="log-area"><LogView @settings="emit('open', 'logsettings')" /></main>

      <!-- 情境按鈕：旅途中往前走；站在設施上時打開設施面板 -->
      <div v-if="onRoad && s.roadEvent" class="ctx">
        <button class="primary" @click="eventDialogOpen = true"><GameIcon name="bell" :size="16" />決定怎麼應付</button>
      </div>
      <div v-else-if="onRoad" class="ctx two">
        <button class="primary" :disabled="roadBusy || roadEnd" @click="game.move(1, 0)">往前走一天 <GameIcon name="arrowRight" :size="16" /></button>
        <button :disabled="roadBusy || roadEnd" title="遇到事件、戰鬥或抵達時停下" @click="game.walkRoad()">一路走下去</button>
      </div>
      <div v-else-if="place" class="ctx">
        <button v-if="place.go" class="primary" @click="game.crossLink()"><GameIcon name="right" :size="16" />{{ place.verb }}{{ place.name }}</button>
        <button v-else class="primary" @click="toggleSheet('place')">{{ place.verb }}{{ place.name }}</button>
      </div>
    </template>

    <nav v-if="!inCombat" class="tabbar">
      <button :class="{ on: !reading && !sheet && !inCombat }" @click="sheet = null; reading = !reading"><GameIcon name="map" :size="22" /><span>地圖</span></button>
      <button @click="sheet = null; emit('open', 'party')"><GameIcon name="users" :size="22" /><span>隊伍</span><i v-if="badges.party" class="dot" /></button>
      <button :class="{ on: sheet === 'rest' }" :disabled="inCombat" @click="toggleSheet('rest')"><GameIcon name="bed" :size="22" /><span>休息</span></button>
      <button :class="{ on: sheet === 'here' }" :disabled="inCombat" @click="toggleSheet('here')"><GameIcon name="message" :size="22" /><span>這裡</span><i v-if="nearby" class="badge gold">{{ nearby }}</i><i v-else-if="negotiating" class="dot" /></button>
      <button :class="{ on: sheet === 'more' }" @click="toggleSheet('more')"><GameIcon name="more" :size="22" /><span>更多</span><i v-if="moreBadge" class="badge gold">{{ moreBadge }}</i></button>
    </nav>

    <!-- 談判的對話框：談判可能從設施面板、這裡的人或酒館開始，對話框掛在這裡才都打得開（列在「這裡」面板） -->
    <NegotiationPanel mode="dialog" />

    <BottomSheet :open="!!sheet" :title="sheetTitle" @close="sheet = null">
      <!-- 這裡：身邊的人、進行中的事（談判、特殊任務、委託）、行動備註；走在街上也看得到 -->
      <template v-if="sheet === 'here'">
        <PeoplePanel />
        <PlacePanel part="ongoing" />
        <IntentPanel />
      </template>
      <RestPanel v-else-if="sheet === 'rest'" />
      <PlacePanel v-else-if="sheet === 'place'" part="place" />
      <div v-else-if="sheet === 'more'" class="more-grid">
        <button v-for="m in moreItems" :key="m.label" type="button" @click="pickMore(m)">
          <GameIcon :name="m.icon" :size="22" />{{ m.label }}<i v-if="m.badge" class="badge gold">{{ m.badge }}</i>
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<style scoped>
/* 佔滿整個畫面；頁面本身不捲動，日誌自己捲 */
.mobile-game {
  position: fixed; inset: 0; z-index: 5; display: flex; flex-direction: column;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  background: #0f0b08d9;
}
.status {
  flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 12px; min-height: 40px; box-sizing: border-box;
  background: linear-gradient(180deg, #2a2017, #1d1611); border-bottom: 1px solid var(--gold-lo);
  font-size: var(--fs-sm); white-space: nowrap; font-variant-numeric: tabular-nums;
}
.status .cell { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); min-width: 0; }
.status .cell b { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.status .place { flex: 0 1 auto; }
.status .money b { color: var(--gold-hi); }
.status .night { color: #8ab6ef; }
.status .crime, .status .crime b { color: var(--danger); }
.status .bell { margin-left: auto; position: relative; width: 40px; height: 34px; padding: 0; display: grid; place-items: center; color: var(--gold-hi); border: none; }
.status .bell.hot { color: var(--danger); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.55; } }
.banner { flex: none; display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 12px; font-size: var(--fs-sm); }
.banner button { margin-left: auto; }

.map { flex: none; border-bottom: 1px solid var(--border); background: #1a140fe6; max-height: 58dvh; overflow-y: auto; }
.map-head {
  width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; min-height: 40px; text-align: left;
  background: none; border: none; border-radius: 0; box-shadow: none;
}
.map-head b { color: var(--gold-hi); font-weight: 900; letter-spacing: 0.06em; white-space: nowrap; }
.map-head .sub { flex: 1; min-width: 0; color: var(--muted); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.map-head .toggle { display: inline-flex; align-items: center; gap: 2px; color: var(--accent); font-size: var(--fs-sm); white-space: nowrap; }
.map-body { padding: 8px 8px 0; }
/* 地圖區塊裡的面板：手機上不需要外框的邊距 */
.map-body :deep(.panel) { margin-bottom: 8px; padding: 10px 10px; }

.log-area { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 8px 0; }
.log-area :deep(.log) { flex: 1; min-height: 0; margin: 0; padding: 10px 10px 6px; }
.log-area :deep(.log .feed) { flex: 1; height: auto; min-height: 0; max-height: none; }
.combat { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.combat :deep(.field) { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-left: none; border-right: none; border-radius: 0; }

.ctx { flex: none; display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border); background: #221a13; }
.ctx button { flex: 1; min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; letter-spacing: 0.06em; }
.ctx.two button:last-child { flex: 0 0 auto; font-weight: 400; }

.typing .ctx, .typing .tabbar { display: none; }
.tabbar { flex: none; display: grid; grid-template-columns: repeat(5, 1fr); background: linear-gradient(180deg, #2a2017, #17110c); border-top: 1px solid var(--gold-lo); }
.tabbar button {
  position: relative; min-height: 56px; padding: 0; display: grid; justify-items: center; align-content: center; gap: 2px;
  background: none; border: none; border-radius: 0; box-shadow: none; color: var(--muted); font-size: var(--fs-xs);
}
.tabbar button :deep(.game-icon) { color: var(--accent); }
.tabbar button.on { color: var(--gold-hi); }
.tabbar button.on::before { content: ''; position: absolute; top: 0; left: 22%; right: 22%; height: 2px; background: var(--accent); }
.badge {
  position: absolute; top: 4px; right: calc(50% - 24px); min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; box-sizing: border-box;
  background: var(--danger); color: #fff; font: 700 11px/17px system-ui, sans-serif; font-style: normal; text-align: center;
}
.badge.gold { background: var(--accent); color: #1a1008; }
.status .bell .badge { top: 0; right: 0; }
.dot { position: absolute; top: 8px; right: calc(50% - 16px); width: 9px; height: 9px; border-radius: 50%; background: var(--danger); }

.more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.more-grid button {
  position: relative; min-height: 72px; display: grid; justify-items: center; align-content: center; gap: 6px; padding: 4px;
  font-size: var(--fs-xs);
}
.more-grid button :deep(.game-icon) { color: var(--accent); }
.more-grid .badge { top: 4px; right: 6px; }
</style>
