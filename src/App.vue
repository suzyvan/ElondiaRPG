<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { locationById } from '@/engine/data'
import { formatMoney } from '@/engine/money'
import { formatTime } from '@/engine/state'
import { alertLevel, factionName } from '@/engine/security'
import { currentArea } from '@/engine/grid'
import { atMasterHome, houseRefusedToday, mayExtend, mayLeaveHouse } from '@/engine/masterHome'
import { isBound, isEnslaved } from '@/engine/party'
import { masterAllows, masterRefusedToday } from '@/engine/slavery'
import { useGame } from '@/stores/game'
import { useSettings } from '@/stores/settings'
import { useContent } from '@/stores/content'
import HomeView from '@/components/HomeView.vue'
import AppDialog from '@/components/AppDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import NotebookView from '@/components/NotebookView.vue'
import CraftDialog from '@/components/CraftDialog.vue'
import ContractDialog from '@/components/ContractDialog.vue'
import { canTurnIn } from '@/engine/materialQuests'
import RoadPanel from '@/components/RoadPanel.vue'
import CombatView from '@/components/CombatView.vue'
import IntentPanel from '@/components/IntentPanel.vue'
import LogView from '@/components/LogView.vue'
import MapPanel from '@/components/MapPanel.vue'
import NewGameView from '@/components/NewGameView.vue'
import PartyCards from '@/components/party/PartyCards.vue'
import CharacterDialog from '@/components/party/CharacterDialog.vue'
import OwnedSlavesDialog from '@/components/OwnedSlavesDialog.vue'
import { ownedSlaves } from '@/engine/ownedSlaves'
import MakeRoomDialog from '@/components/party/MakeRoomDialog.vue'
import type { CharTab } from '@/components/party/memberInfo'
import InventoryView from '@/components/items/InventoryView.vue'
import PeoplePanel from '@/components/PeoplePanel.vue'
import PlacePanel from '@/components/PlacePanel.vue'
import RelationsView from '@/components/RelationsView.vue'
import RestPanel from '@/components/RestPanel.vue'
import SaveDialog from '@/components/SaveDialog.vue'
import SettingsView from '@/components/SettingsView.vue'
import EventCenter from '@/components/events/EventCenter.vue'
import UnsavedDialog from '@/components/content/UnsavedDialog.vue'
import PartyStrip from '@/components/PartyStrip.vue'
import MobileGame, { type MobileOpen } from '@/components/mobile/MobileGame.vue'
import { isMobile } from '@/components/mobile/mobile'
import SwipeTabs from '@/components/mobile/SwipeTabs.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import AmbientLayer from '@/components/fx/AmbientLayer.vue'
import BackgroundLayer from '@/components/fx/BackgroundLayer.vue'
import { edgePulse, floatText, placeCard, tween } from '@/fx/fx'
import { stateKey } from '@/fx/seen'
import type { IconName } from '@/components/ui/iconPaths'
import { activeEvents, openEvents, pendingEvents } from '@/components/events/eventQueue'
import { confirmDiscard, unsavedEdits } from '@/components/content/unsaved'

// 提示詞頁籤會載入整本世界書，切過去時才載入
const PromptsView = defineAsyncComponent(() => import('@/components/PromptsView.vue'))
const ContentView = defineAsyncComponent(() => import('@/components/ContentView.vue'))

const game = useGame()
// 成人向開關變更時重畫遊戲畫面（娼館／按摩店等名稱）
const settings = useSettings()
const inCombat = computed(() => !!game.state?.combat)
const pendingSkills = computed(() => game.state?.party.some((m) => m.pendingAbilityChoices?.length || m.attrPoints > 0) ?? false)
const suggestionCount = computed(() => game.state?.suggestions?.length ?? 0)
// 需要回應的事件（事件視窗關著時在上方提醒）
const eventCount = computed(() => pendingEvents(game.state).length)
const blockingEvent = computed(() => activeEvents(game.state).some((e) => e.blocking))
// 通緝與這裡的衛兵警戒
const crime = computed(() => {
  const s = game.state
  if (!s) return null
  const wanted = Object.keys(s.wanted ?? {})
  if (wanted.length) return { text: '通緝中', title: `被${wanted.map(factionName).join('、')}通緝` }
  const level = alertLevel(s)
  return level ? { text: `警戒 ${level}`, title: `${locationById(s.location).name}的衛兵警戒 ${level}` } : null
})

// ── 特效：金錢滾動與飄字、通緝或警戒升高時畫面邊緣紅一下、換區域時的地名卡（讀檔不算）
const moneyEl = ref<HTMLElement | null>(null)
const moneyShown = ref(game.state?.money_cc ?? 0)
let stopMoney = () => {}
watch(() => [stateKey(game.state), game.state?.money_cc ?? 0] as const, ([key, v], old) => {
  stopMoney()
  const delta = old && old[0] === key ? v - old[1] : 0
  if (!delta) { moneyShown.value = v; return }
  floatText(moneyEl.value, `${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}`, { color: delta > 0 ? '#ffd34d' : '#ff7a66' })
  stopMoney = tween(moneyShown.value, v, 600, (x) => (moneyShown.value = x))
})
const crimeLevel = computed(() => (game.state ? Object.keys(game.state.wanted ?? {}).length * 10 + alertLevel(game.state) : 0))
watch(() => [stateKey(game.state), crimeLevel.value] as const, ([key, v], old) => {
  if (old && old[0] === key && v > old[1]) edgePulse()
})
const areaInfo = computed(() => {
  const s = game.state
  if (!s) return null
  try {
    const a = currentArea(s)
    return { key: a.key, name: a.name, town: locationById(s.location).name }
  } catch {
    return null
  }
})
// 監看的是字串：陣列每次都是新的，走一步也會觸發，所以只看 key 有沒有變
watch(() => `${stateKey(game.state)}|${areaInfo.value?.key ?? ''}`, (now, old) => {
  const a = areaInfo.value
  const [save, area] = now.split('|')
  const [oldSave, oldArea] = (old ?? '').split('|')
  if (!a || !old || save !== oldSave || !oldArea || area === oldArea) return
  placeCard(a.name, a.name.includes(a.town) ? '' : a.town)
})

type Tab = 'adventure' | 'prompts' | 'content'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'adventure', label: '冒險', icon: 'map' },
  { id: 'prompts', label: '提示詞與正則', icon: 'script' },
  { id: 'content', label: '世界', icon: 'world' },
]
const tab = ref<Tab>('adventure')
/** 換頁籤：離開世界頁時，世界編輯器有未儲存的修改先問一次 */
async function setTab(t: Tab) {
  if (tab.value === 'content' && t !== 'content' && !(await confirmDiscard())) return
  tab.value = t
}

// 沒有載入遊戲時：首頁與它的幾個畫面（開新遊戲、世界管理、提示詞管理）
type Screen = 'home' | 'new' | 'worlds' | 'prompts'
const screen = ref<Screen>('home')
async function setScreen(s: Screen) {
  if (screen.value === 'worlds' && s !== 'worlds' && !(await confirmDiscard())) return
  screen.value = s
}
const content = useContent()
// 進入遊戲時切到冒險頁；回到首頁時從首頁開始
watch(() => !!game.state, (inGame) => {
  if (inGame) {
    tab.value = 'adventure'
    showSaves.value = false
  } else screen.value = 'home'
})
async function goHome() {
  if (!(await confirmDiscard())) return
  closeDialogs()
  await game.toHome()
}
function closeDialogs() {
  charOpen.value = showParty.value = showInventory.value = showRelations.value = showNotebook.value = showCraft.value = showContract.value = showSlaves.value = showSaves.value = showSettings.value = false
}

const showSettings = ref(false)
/** 打開設定並切到指定的分頁（設定對話框每次打開時讀這一頁） */
function openSettings(page: string) {
  try {
    localStorage.setItem('elondia.settingsPage', page)
  } catch {
    // 記不住分頁時從上次的分頁開始
  }
  showSettings.value = true
}
// 冒險頁面的「AI」泡泡視窗按「完整設定」：打開設定的那一頁
const onOpenSettings = (e: Event) => openSettings(String((e as CustomEvent).detail ?? 'narration'))
window.addEventListener('elondia:open-settings', onOpenSettings)
onBeforeUnmount(() => window.removeEventListener('elondia:open-settings', onOpenSettings))
const showParty = ref(false)
const showInventory = ref(false)
const showRelations = ref(false)
const showNotebook = ref(false)
const showCraft = ref(false)
/** 奴隸契約（主角身上有契約印記時才有這個按鈕） */
const showContract = ref(false)
const enslaved = computed(() => (game.state ? isEnslaved(game.state) : false))
/** 我的奴隸（主角擁有奴隸時才有這個按鈕；角色詳情可以指定先看哪一位） */
const showSlaves = ref(false)
const slaveFocus = ref('')
const ownsSlaves = computed(() => (game.state ? ownedSlaves(game.state).length > 0 : false))
function openSlaves(id = '') {
  slaveFocus.value = id
  showSlaves.value = true
}
const onOpenSlaves = (e: Event) => openSlaves(String((e as CustomEvent).detail ?? ''))
window.addEventListener('elondia:open-slaves', onOpenSlaves)
onBeforeUnmount(() => window.removeEventListener('elondia:open-slaves', onOpenSlaves))
/** 現在可以請求主人讓你出門、出城或延長許可（按鈕上提示一下） */
const canAskMaster = computed(() => {
  const s = game.state
  if (!s || !isBound(s)) return false
  if (mayExtend(s)) return true
  if (atMasterHome(s)) return !mayLeaveHouse(s) && !houseRefusedToday(s)
  return currentArea(s).kind === 'settlement' && !masterAllows(s) && !masterRefusedToday(s)
})
/** 可以回公會交付的委託 */
const readyQuests = computed(() => (game.state ? game.state.quests.filter((q) => canTurnIn(game.state!, q)).length : 0))
const showSaves = ref(false)
// 角色詳情（分頁）：從角色卡或地圖下方的隊伍卡打開
const charOpen = ref(false)
const charMember = ref('')
const charTab = ref<CharTab>('stats')
function openCharacter(member: string, tab: CharTab) {
  charMember.value = member
  charTab.value = tab
  charOpen.value = true
}
/** 事件視窗要打開隊伍：指定了人（升級）就直接開他的角色詳情，有能力要選時開能力分頁 */
function onOpenParty(id?: string) {
  tab.value = 'adventure'
  const m = id ? game.state?.party.find((x) => x.id === id) : undefined
  if (m) openCharacter(m.id, m.pendingAbilityChoices?.length ? 'abilities' : 'stats')
  else showParty.value = true
}
// 白天（6～18 點）顯示太陽，晚上顯示月亮
const daytime = computed(() => { const h = game.state?.time.hour ?? 12; return h >= 6 && h < 18 })
const clock = computed(() => (game.state ? formatTime(game.state.time).split(' ').at(-1) : ''))

// 960～1180 寬：只放得下兩欄，右欄（這裡的人、地點）改成左欄的第二個分頁
const NARROW = '(min-width: 961px) and (max-width: 1180px)'
const narrow = ref(window.matchMedia(NARROW).matches)
const sideTab = ref<'map' | 'here'>('map')
const showLeft = computed(() => !narrow.value || inCombat.value || sideTab.value === 'map')
const showRight = computed(() => !inCombat.value && (!narrow.value || sideTab.value === 'here'))
const onNarrow = (e: MediaQueryListEvent) => { narrow.value = e.matches }

// ── 手機版（720px 以下）：冒險頁換成 MobileGame，對話框變成全螢幕頁面（AppDialog）
const mobileGame = computed(() => isMobile.value && !!game.state && tab.value === 'adventure')
const mobileDim = computed(() => isMobile.value && (game.state ? tab.value !== 'adventure' : screen.value === 'worlds' || screen.value === 'prompts'))
const mobileHud = computed(() => {
  const st = game.state!
  return { day: st.time.day, clock: clock.value ?? '', daytime: daytime.value, place: locationById(st.location).name, money: formatMoney(moneyShown.value), crime: crime.value }
})
const mobileBadges = computed(() => ({ party: pendingSkills.value, relations: suggestionCount.value, notebook: readyQuests.value, contract: canAskMaster.value }))
// 隊伍頁：手機上隊伍與行囊是同一頁的兩個分頁
const partyPage = ref('party')
const PARTY_PAGES = [{ id: 'party', label: '隊伍' }, { id: 'bag', label: '行囊' }]
function onMobileOpen(what: MobileOpen) {
  switch (what) {
    case 'party': partyPage.value = 'party'; showParty.value = true; break
    case 'relations': showRelations.value = true; break
    case 'notebook': showNotebook.value = true; break
    case 'craft': showCraft.value = true; break
    case 'contract': showContract.value = true; break
    case 'slaves': openSlaves(); break
    case 'saves': showSaves.value = true; break
    case 'settings': showSettings.value = true; break
    case 'logsettings': openSettings('models'); break
    case 'prompts': setTab('prompts'); break
    case 'content': tab.value = 'content'; break
    case 'home': void goHome(); break
    case 'quickload': askQuickLoad(); break
  }
}

function askQuickLoad() {
  if (!game.state || confirm('讀取快速存檔？目前的進度會先自動存一份。')) void game.quickLoad()
}

// 快捷鍵：F8 / Ctrl+S 快速存檔，F9 快速讀檔
function onKey(e: KeyboardEvent) {
  const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
  if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
    e.preventDefault()
    if (game.state) void game.quickSave()
  } else if (e.key === 'F9' && !typing && game.state) {
    e.preventDefault()
    askQuickLoad()
  }
}
// 自動保存失敗時，離開頁面前提醒一下
function onLeave(e: BeforeUnloadEvent) {
  // 世界編輯器有未儲存的修改時也提醒
  if (!game.saveWarning && !unsavedEdits.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => {
  window.matchMedia(NARROW).addEventListener('change', onNarrow)
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', onLeave)
})
onBeforeUnmount(() => {
  window.matchMedia(NARROW).removeEventListener('change', onNarrow)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', onLeave)
})
</script>

<template>
  <header v-if="!(isMobile && game.state)" class="top">
    <div class="logo"><GameIcon name="sword" :size="24" /><h1>埃隆迪亞大陸</h1></div>
    <nav v-if="game.state" class="tabs">
      <button v-for="t in TABS" :key="t.id" :class="{ active: tab === t.id }" @click="setTab(t.id)"><GameIcon :name="t.icon" :size="15" />{{ t.label }}</button>
    </nav>
    <nav v-else-if="screen !== 'home'" class="tabs">
      <button @click="setScreen('home')"><GameIcon name="home" :size="15" />首頁</button>
    </nav>
    <div v-if="game.state" class="hud">
      <span class="cell" title="遊戲時間"><GameIcon name="calendar" :size="15" /><span class="label">第</span><b>{{ game.state.time.day }}</b><span class="label">天</span><b>{{ clock }}</b><GameIcon :name="daytime ? 'sun' : 'moon'" :size="15" :class="daytime ? 'sun' : 'night'" /></span>
      <span class="cell" title="所在地點"><GameIcon name="pin" :size="15" /><b>{{ locationById(game.state.location).name }}</b></span>
      <span ref="moneyEl" class="cell money" title="持有金錢"><GameIcon name="coins" :size="15" /><b>{{ formatMoney(moneyShown) }}</b></span>
      <span v-if="crime" :key="crime.text" class="cell crime" :title="crime.title"><GameIcon name="siren" :size="15" /><b>{{ crime.text }}</b></span>
    </div>
    <div class="top-buttons">
      <button v-if="eventCount" class="small events" :class="{ hot: blockingEvent }" title="需要你處理的事" @click="openEvents()"><GameIcon :key="eventCount" name="bell" :size="14" class="bell" />待處理<span class="badge">{{ eventCount }}</span></button>
      <!-- 介面語言：選項名稱各用自己的寫法，不轉換 -->
      <label class="ghost icon lang" title="介面語言（AI 寫的正文用哪一種，在設定的「AI 的輸出語言」）">
        <GameIcon name="globe" :size="24" />
        <select v-model="settings.uiLanguage" data-no-convert aria-label="介面語言">
          <option value="zh-Hant">繁體</option>
          <option value="zh-Hans">简体</option>
        </select>
      </label>
      <button v-if="game.state" class="ghost icon" title="快速存檔（F8 / Ctrl+S）" @click="game.quickSave()"><GameIcon name="save" :size="24" /><span>快存</span></button>
      <button v-if="game.state" class="ghost icon" title="快速讀檔（F9）" @click="askQuickLoad"><GameIcon name="load" :size="24" /><span>快讀</span></button>
      <button v-if="game.state" class="ghost icon" title="存檔與讀檔：存檔欄位、匯出與匯入" @click="showSaves = true"><GameIcon name="saves" :size="24" /><span>存讀檔</span></button>
      <button class="ghost icon" title="設定" @click="showSettings = true"><GameIcon name="settings" :size="24" /><span>設定</span></button>
      <button v-if="game.state" class="ghost icon" title="存好進度，回到首頁" @click="goHome"><GameIcon name="home" :size="24" /><span>首頁</span></button>
    </div>
  </header>
  <BackgroundLayer />
  <!-- 手機版的提示詞、世界頁：說明文字直接壓在背景圖上，背景亮的地方讀不清楚，蓋一層暗色 -->
  <div v-if="mobileDim" class="m-dim" aria-hidden="true" />
  <AmbientLayer v-if="game.state" />
  <Transition name="notice">
    <div v-if="game.notice" class="notice">{{ game.notice }}</div>
  </Transition>

  <div v-if="game.saveWarning" class="error row save-warning">
    <span><GameIcon name="warning" :size="15" /> {{ game.saveWarning }}</span>
    <button class="small" style="margin-left: auto" @click="showSaves = true">存讀檔</button>
  </div>

  <!-- 錯誤訊息：右上角的泡泡（ToastHost），不插在畫面中間 -->
  <ToastHost />

  <template v-if="!game.state">
    <HomeView
      v-if="screen === 'home'"
      @new="screen = 'new'" @load="showSaves = true" @worlds="screen = 'worlds'" @prompts="screen = 'prompts'" @settings="showSettings = true"
    />
    <!-- 換世界時重畫，自訂的種族、能力、NPC 才會跟著變 -->
    <NewGameView v-else-if="screen === 'new'" :key="content.active" @settings="showSettings = true" @home="screen = 'home'" />
    <ContentView v-else-if="screen === 'worlds'" />
    <PromptsView v-else-if="screen === 'prompts'" />
  </template>

  <!-- 手機版：提示詞、世界頁的上方只有一條「回到冒險」 -->
  <nav v-if="isMobile && game.state && tab !== 'adventure'" class="m-back">
    <button class="ghost" @click="setTab('adventure')"><GameIcon name="right" :size="16" class="flip" />回到冒險</button>
  </nav>
  <MobileGame
    v-if="mobileGame"
    :hud="mobileHud" :events="eventCount" :blocking-event="blockingEvent" :badges="mobileBadges" :enslaved="enslaved" :owns-slaves="ownsSlaves"
    @open="onMobileOpen"
  />
  <PromptsView v-if="game.state && tab === 'prompts'" />
  <ContentView v-if="game.state && tab === 'content'" />

  <main v-if="game.state && !isMobile" v-show="tab === 'adventure'" class="game" :class="{ combat: inCombat }">
    <nav v-if="narrow && !inCombat" class="panel side-tabs">
      <button :class="{ active: sideTab === 'map' }" @click="sideTab = 'map'"><GameIcon name="map" :size="15" />地圖／隊伍</button>
      <button :class="{ active: sideTab === 'here' }" @click="sideTab = 'here'"><GameIcon name="users" :size="15" />這裡／地點</button>
    </nav>
    <aside v-show="showLeft" class="left">
      <MapPanel />
      <PartyStrip @open="openCharacter" />
      <RoadPanel v-if="game.state.road && !inCombat" />
      <template v-if="!inCombat">
        <RestPanel />
        <IntentPanel />
      </template>
    </aside>

    <section class="center">
      <nav class="panel toolbar">
        <button class="ghost" @click="showParty = true"><GameIcon name="users" :size="20" />隊伍<span v-if="pendingSkills" class="note">可升級</span></button>
        <button class="ghost" @click="showInventory = true"><GameIcon name="backpack" :size="20" />行囊</button>
        <button class="ghost" :title="suggestionCount ? `${suggestionCount} 則提議` : ''" @click="showRelations = true"><GameIcon name="heart" :size="20" />關係<span v-if="suggestionCount" class="badge">{{ suggestionCount }}</span></button>
        <button class="ghost" :title="readyQuests ? `${readyQuests} 件委託可以交付` : ''" @click="showNotebook = true"><GameIcon name="notebook" :size="20" />筆記<span v-if="readyQuests" class="badge gold">{{ readyQuests }}</span></button>
        <button class="ghost" @click="showCraft = true"><GameIcon name="tools" :size="20" />工藝</button>
        <button v-if="enslaved" class="ghost" :title="canAskMaster ? '可以請求主人讓你出門、出城或延長許可' : ''" @click="showContract = true"><GameIcon name="lock" :size="20" />契約<span v-if="canAskMaster" class="note">可請求</span></button>
        <button v-if="ownsSlaves" class="ghost" @click="openSlaves()"><GameIcon name="link" :size="20" />奴隸</button>
      </nav>
      <CombatView v-if="inCombat" />
      <LogView v-else @settings="openSettings('models')" />
    </section>

    <aside v-if="!inCombat" v-show="showRight" class="right">
      <PeoplePanel />
      <PlacePanel />
    </aside>
  </main>

  <AppDialog :open="showParty" title="隊伍" icon="users" width="1200px" @close="showParty = false">
    <!-- 手機版：隊伍與行囊是同一頁的兩個分頁，可以左右滑 -->
    <SwipeTabs v-if="isMobile" v-model="partyPage" :tabs="PARTY_PAGES" swipe bar>
      <template #default="{ id }">
        <InventoryView v-if="id === 'bag'" />
        <PartyCards v-else @detail="openCharacter" />
      </template>
    </SwipeTabs>
    <PartyCards v-else @detail="openCharacter" />
  </AppDialog>
  <CharacterDialog v-if="game.state" v-model:member="charMember" v-model:tab="charTab" :open="charOpen" @close="charOpen = false" />
  <AppDialog :open="showInventory" title="行囊" icon="backpack" width="1000px" @close="showInventory = false">
    <InventoryView />
  </AppDialog>
  <AppDialog :open="showRelations" title="人際關係與冒險記憶" icon="heart" width="1200px" fixed @close="showRelations = false">
    <RelationsView />
  </AppDialog>
  <AppDialog :open="showNotebook" title="冒險筆記" icon="notebook" width="900px" @close="showNotebook = false">
    <NotebookView />
  </AppDialog>
  <AppDialog :open="showCraft" title="工藝" icon="tools" width="760px" @close="showCraft = false">
    <CraftDialog @close="showCraft = false" />
  </AppDialog>
  <AppDialog :open="showContract && enslaved" title="奴隸契約" icon="lock" width="640px" @close="showContract = false">
    <ContractDialog @close="showContract = false" />
  </AppDialog>
  <AppDialog :open="showSlaves && ownsSlaves" title="我的奴隸" icon="link" width="680px" @close="showSlaves = false">
    <OwnedSlavesDialog :focus="slaveFocus" @close="showSlaves = false" @detail="(id) => { showSlaves = false; openCharacter(id, 'stats') }" />
  </AppDialog>
  <AppDialog :open="showSaves" title="存檔與讀檔" icon="saves" width="860px" @close="showSaves = false">
    <SaveDialog @loaded="showSaves = false" />
  </AppDialog>
  <AppDialog :open="showSettings" title="設定" icon="settings" width="760px" fixed @close="showSettings = false">
    <SettingsView />
  </AppDialog>

  <MakeRoomDialog />
  <UnsavedDialog />
  <EventCenter v-if="game.state" @open-party="onOpenParty" @open-relations="tab = 'adventure'; showRelations = true" />
</template>

<style scoped>
.top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 22px; padding: 4px 4px 12px; margin-bottom: 14px; position: relative; }
.top::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold-lo), var(--accent), var(--gold-lo), transparent);
}
.logo { display: flex; align-items: center; gap: 10px; color: var(--accent); }
.logo h1 {
  margin: 0; font-size: 1.4rem; font-weight: 900; letter-spacing: 0.22em;
  background: linear-gradient(180deg, #fff1c6, #e2b45a 55%, #a87528); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 1px 0 #000);
}
.tabs { display: flex; gap: 2px; }
.tabs button { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; color: var(--muted); padding: 6px 12px; }
.tabs button:hover:not(:disabled) { color: var(--text); border-color: transparent; }
.tabs button.active { color: var(--gold-hi); border-bottom-color: var(--accent); }
.hud { display: flex; gap: 4px; flex-wrap: wrap; }
.hud .cell { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px; background: #0006; border: 1px solid #ffffff12; border-radius: 2px; color: var(--accent); }
.hud .cell b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.hud .cell .label { letter-spacing: 0.04em; }
.hud .money b { color: var(--gold-hi); }
.hud .night { color: #8ab6ef; }
.hud .crime, .hud .crime b { color: var(--danger); }
.top-buttons { margin-left: auto; display: flex; gap: 2px; align-items: center; }
.top-buttons .icon { min-width: 48px; padding: 4px 6px 2px; display: grid; justify-items: center; gap: 2px; color: var(--muted); }
.top-buttons .icon span { font-size: 11px; line-height: 1.2; white-space: nowrap; }
/* 語言：圖示下面是小小的下拉選單，和其他按鈕的文字同一排 */
.top-buttons .lang { cursor: pointer; }
.top-buttons .lang select { font-size: 11px; line-height: 1.2; padding: 0 2px; min-height: 0; height: auto; border: none; background: transparent; color: inherit; cursor: pointer; text-align: center; }
.top-buttons .lang select option { background: var(--panel, #1a130d); color: var(--text); }
.events { display: inline-flex; align-items: center; gap: 4px; border-color: var(--accent); color: var(--gold-hi); margin-right: 6px; }
.events.hot { border-color: var(--danger); color: var(--danger); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.55; } }
.badge {
  display: inline-block; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--danger); color: #fff;
  font: 700 11px/17px system-ui, sans-serif; text-align: center;
}
.badge.gold { background: var(--accent); color: #1a1008; }
.notice {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 60;
  background: var(--panel); border: 1px solid var(--accent); border-radius: var(--radius);
  padding: 6px 14px; box-shadow: 0 6px 20px #000a;
}
.save-warning { position: sticky; top: 0; z-index: 50; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
/* 上方通知：淡入並往下滑 */
.notice-enter-active, .notice-leave-active { transition: opacity 0.2s, transform 0.2s steps(4, end); }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translate(-50%, -10px); }
/* 「待處理」多了一件：鈴鐺搖兩下 */
.events .bell { animation: bell 0.6s steps(6, end); transform-origin: 50% 10%; }
@keyframes bell { 15% { transform: rotate(18deg); } 35% { transform: rotate(-16deg); } 55% { transform: rotate(10deg); } 75% { transform: rotate(-6deg); } }
/* 通緝、警戒出現或升級：標籤閃一下 */
.hud .crime { animation: crime-in 0.5s steps(5, end); }
@keyframes crime-in { from { box-shadow: 0 0 0 2px var(--danger), 0 0 14px var(--danger); } }

.game {
  display: grid;
  grid-template-columns: 400px minmax(0, 1fr) 380px;
  grid-template-areas: 'left center right';
  gap: 16px;
  align-items: start;
}
.left { grid-area: left; }
.center { grid-area: center; min-width: 0; }
/* 右欄固定在畫面上、自己捲動：捲右欄不會把地圖和日誌捲走。
   高度扣掉上方的標題列（約 94px），底部和中間欄對齊（LogView 的 100vh - 300px），內容再多也不會把整頁撐高 */
.right {
  grid-area: right; position: sticky; top: 12px; max-height: calc(100vh - 118px); overflow-y: auto;
  overscroll-behavior: contain; scrollbar-width: thin; padding-right: 2px;
}
.game.combat { grid-template-areas: 'left center center'; }
.side-tabs { grid-area: tabs; display: flex; padding: 0; margin: 0; }
.side-tabs button {
  flex: 1; display: inline-flex; justify-content: center; align-items: center; gap: 6px; padding: 8px; border: none; border-radius: 0;
  border-bottom: 2px solid transparent; color: var(--muted);
}
.side-tabs button.active { color: var(--gold-hi); border-bottom-color: var(--accent); }
.side-tabs button :deep(.game-icon) { color: var(--accent); }

/* 日誌上方的工具列 */
.toolbar { display: flex; flex-wrap: wrap; padding: 0; margin-bottom: 12px; }
.toolbar button {
  display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border: none; border-right: 1px solid #ffffff10; border-radius: 0;
  color: var(--text); font-size: var(--fs-md);
}
.toolbar button :deep(.game-icon) { color: var(--accent); }
.toolbar button:hover:not(:disabled) { background: #c99a4512; color: var(--gold-hi); }
.toolbar .note { font-size: var(--fs-xs); line-height: 16px; padding: 0 4px; border-radius: 2px; background: var(--accent); color: #1a1008; font-weight: 700; }

/* 手機版 */
.m-dim { position: fixed; inset: 0; z-index: -1; background: #0f0b08d9; pointer-events: none; }
/* 上方列擠成一排：標題縮小，右邊的按鈕只留圖示（語言的下拉選單照舊） */
@media (max-width: 720px) {
  .top { flex-wrap: nowrap; gap: 8px; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { gap: 6px; min-width: 0; }
  .logo h1 { font-size: 1.1rem; letter-spacing: 0.12em; white-space: nowrap; }
  .tabs button { padding: 6px 8px; white-space: nowrap; }
  .top-buttons .icon { min-width: 40px; }
  .top-buttons .icon > span { display: none; }
}
.m-back { display: flex; margin: -6px -10px 8px; }
.m-back button { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); }
.m-back .flip, .m-back :deep(.flip) { transform: scaleX(-1); }

@media (max-width: 1380px) {
  .game { grid-template-columns: 320px minmax(0, 1fr) 320px; }
}
@media (max-width: 1180px) {
  .game { grid-template-columns: 340px minmax(0, 1fr); grid-template-areas: 'tabs center' 'left center'; row-gap: 0; }
  .game.combat { grid-template-areas: 'left center'; row-gap: 16px; }
  .side-tabs { margin-bottom: 12px; }
  .right { grid-area: left; position: static; max-height: none; overflow: visible; }
}
@media (max-width: 960px) {
  .game, .game.combat { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'left' 'center' 'right'; }
  .right { grid-area: right; }
}
</style>
