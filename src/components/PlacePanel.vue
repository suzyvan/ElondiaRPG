<script setup lang="ts">
import FoldMenu from './ui/FoldMenu.vue'
import { deadlineText, questDeadlineDays } from '@/engine/deadlines'
import HomePanel from './HomePanel.vue'
import { computed, ref, watch } from 'vue'
import { attrOf, mod } from '@/engine/character'
import { attrName, isCustomShopId, landmarkDef, locationById, parkPlaza, shopRules, specialMapOfKey, specialMaps, type ShopType } from '@/engine/data'
import { canTravelHere, CELL_ICON, CELL_NAME, cellName, currentArea, currentCell, DUNGEON_LAYERS, position, linkEntryBlock, linkTargetName, LOCK_METHODS, lockPicker, questRunnableHere, type CellKind, type LockMethod } from '@/engine/grid'
import { formatMoney } from '@/engine/money'
import { marketsHere } from '@/engine/companions'
import { canNegotiate } from '@/engine/negotiation'
import { canAcceptRank, guildQuests, questSpot, questTemplate, templeCost } from '@/engine/town'
import { examOffer, examQuest, examsFirst, isExam, promotionStatus } from '@/engine/guild'
import { canTurnIn, deliverable, isCollectQuest, isMaterialQuest, layerName, questProgressText, rewardFor } from '@/engine/materialQuests'
import { bestTool } from '@/engine/tools'
import type { Quest } from '@/engine/types'
import { reachable } from '@/engine/world'
import { useGame } from '@/stores/game'
import { sideNodesOpen, storyDef } from '@/engine/story'
import { useContent } from '@/stores/content'
import BrothelPanel from './BrothelPanel.vue'
import ArenaPanel from './ArenaPanel.vue'
import FusePanel from './FusePanel.vue'
import OutfitTailorPanel from './OutfitTailorPanel.vue'
import GuardStatus from './GuardStatus.vue'
import { isWanted, palacePersuadeDc } from '@/engine/security'
import MarketPanel from './MarketPanel.vue'
import NegotiationPanel from './NegotiationPanel.vue'
import StoryPanel from './StoryPanel.vue'
import ShopPanel from './ShopPanel.vue'
import LandmarkPanel from './LandmarkPanel.vue'
import { closedHere, sceneSpots } from '@/engine/landmarks'
import TattooPanel from './TattooPanel.vue'
import TavernPanel from './TavernPanel.vue'
import WorkPanel from './WorkPanel.vue'
import TrainPanel from './TrainPanel.vue'
import { checkBonus } from '@/engine/perks'
import CraftPanel from './CraftPanel.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'
import type { IconName } from './ui/iconPaths'
import AppDialog from './AppDialog.vue'
import TravelDialog from './TravelDialog.vue'
import SceneBanner from './place/SceneBanner.vue'
import BuildingMenu, { type MenuItem } from './place/BuildingMenu.vue'
import { shopKindName, shopTitle, type NamedShop } from '@/engine/shopNames'
import { shopPlace, shopTypeForCell } from '@/engine/trade'
import { CELL_GAME_ICON } from './ui/cellIcons'
import { isMobile } from './mobile/mobile'

const game = useGame()

/** 離開臨時地圖：特殊任務帶進來、任務點還沒完成時，離開等於放棄 */
function leaveSide() {
  const id = s.value.side?.story
  if (id && sideNodesOpen(s.value, id) && !confirm(`離開這裡就是放棄特殊任務「${storyDef(id)?.title ?? id}」（放棄後不能再接）。確定離開？`)) return
  game.leaveSide()
}
const content = useContent()
// 手機版把面板拆成兩半：設施面板只畫這一格（place），「這裡」面板畫進行中的事（ongoing）；電腦版整個畫（all）
const props = withDefaults(defineProps<{ part?: 'all' | 'place' | 'ongoing' }>(), { part: 'all' })
const showPlace = computed(() => props.part !== 'ongoing')
const showOngoing = computed(() => props.part !== 'place')
const s = computed(() => game.state!)
const here = computed(() => locationById(s.value.location))
const area = computed(() => game.area)
const cell = computed(() => game.cell)
// 安全的室內（地標的內部）：空地叫「室內」，不叫道路
const insideRoom = computed(() => area.value.kind === 'special' && !!specialMaps[area.value.special ?? '']?.peaceful)
// 地標內部有場景的格子（例如咖啡廳的小房間）
const sceneSpot = computed(() => {
  const p = position(s.value)
  return sceneSpots(s.value).get(`${p.x},${p.y}`)
})
// 特殊地圖：地圖的描述、通道通往哪裡
const specialDef = computed(() => (area.value.kind === 'special' ? specialMapOfKey(area.value.key) : undefined))
const linkName = computed(() => linkTargetName(s.value) ?? '別處')
const linkBlock = computed(() => (cell.value.kind === 'link' ? linkEntryBlock(s.value) : null))
// 王城的衛兵：聲望不夠、今天還沒被拒絕時可以說服
const canPersuade = computed(() => linkBlock.value?.zone === 'palace' && !isWanted(s.value, here.value.faction) && s.value.palaceBlock?.[s.value.location] !== s.value.time.day)
// 說服衛兵的說詞（選填；設定了 AI 判定時依說詞調整 DC）
const persuadeText = ref('')
function persuade() {
  void game.perform({ kind: 'palace_gate', text: persuadeText.value })
  persuadeText.value = ''
}
const lockTool = computed(() => bestTool(s.value, 'lockpick'))
const LOCK_ICON: Record<LockMethod, IconName> = { dex: 'unlock', str: 'hand', int: 'lightbulb' }
function lockBonus(k: LockMethod): number {
  const picker = lockPicker(s.value, k)
  return mod(attrOf(picker, k)) + (k === 'dex' ? lockTool.value?.bonus ?? 0 : 0) + checkBonus(picker, { context: 'lock', attr: k })
}
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n))
const intent = computed({ get: () => game.intent, set: (v: string) => (game.intent = v) })

const AREA_NAME: Record<Quest['area'], string> = { town: '城內', outskirts: '近郊', dungeon: '冒險區域' }

// ---- 公會委託（走進公會時才產生） ----
const quests = ref<Quest[]>([])
watch(
  () => [cell.value.kind, area.value.key] as const,
  ([kind]) => {
    if (kind === 'guild') quests.value = examsFirst(game.visitGuild())
  },
  { immediate: true },
)
function refreshQuests() {
  quests.value = examsFirst(guildQuests(s.value))
}

const promo = computed(() => promotionStatus(s.value))
const exam = computed(() => examQuest(s.value))
// 這座城的公會發的、還沒接的晉升考核（各城鎮的公會各有一個）
const offer = computed(() => {
  void quests.value
  return examOffer(s.value)
})
const activeQuests = computed(() => examsFirst(s.value.quests.filter((q) => q.status === 'accepted' || q.status === 'ready')))
// 材料委託可以過量交付：選要交幾份（預設全部）
const turnInQty = ref<Record<string, number>>({})
function turnIn(q: Quest) {
  game.turnInQuest(q.id, isMaterialQuest(q) ? turnInQty.value[q.id] ?? deliverable(s.value, q) : undefined)
  refreshQuests()
}
const runnableHere = computed(() =>
  activeQuests.value.filter((q) => q.status === 'accepted' && q.area !== 'dungeon' && questRunnableHere(s.value, { ...q, spot: questSpot(q) })),
)

function questWhere(q: Quest): string {
  if (canTurnIn(s.value, q)) return `可以交付了！${isExam(q) ? '到任何一座城鎮的冒險者公會' : `回到${locationById(q.giver).name}的冒險者公會`}${isMaterialQuest(q) ? '（可以多交，報酬依數量增加）' : ''}`
  if (q.area === 'dungeon') return `目標：${locationById(q.target).name}${q.layer ? `・${layerName(q.layer)}` : ''}`
  if (isMaterialQuest(q)) return `地點：${locationById(q.target).name}近郊（${isCollectQuest(q) && q.monster ? '打倒牠們' : '採集點'}）`
  if (q.area === 'outskirts') return `地點：${locationById(q.target).name}近郊（地圖上的 ❗）`
  return `地點：${locationById(q.target).name}的${cellName(questSpot(q) as CellKind) || questSpot(q)}`
}

/** 按鈕上的耗時：驅除、討伐直接開打，時間照戰鬥回合算，不是範本上的小時數 */
function questTime(q: Quest): string {
  const tpl = questTemplate(q)
  if (tpl?.kind === 'pest' || tpl?.kind === 'hunt') return '直接進入戰鬥'
  return `約 ${tpl?.hours ?? 1} 小時`
}

function runQuest(id: string) {
  game.doTownQuest(id, intent.value || undefined)
  intent.value = ''
}

// ---- 市場 ----
const publicMarket = computed(() => marketsHere(s.value).some((m) => m.kind === 'public'))
const rations = computed(() => s.value.inventory.find((i) => i.name === '乾糧')?.qty ?? 0)

// ---- 旅行：目的地在對話框裡（TravelDialog） ----
const showTravel = ref(false)
const travelMenu = computed<MenuItem[]>(() => {
  const list = reachable(s.value.location)
  const near = list.filter((d) => locationById(d.id).region === here.value.region).length
  return [{ id: 'travel', icon: 'compass', label: '啟程旅行', detail: `這個地區 ${near} 個・其他地區 ${list.length - near} 個`, badge: list.length }]
})

const ICON = computed<Partial<Record<string, string>>>(() => {
  void content.version
  return { ...CELL_ICON, floor: '🧭' }
})

// 鐵匠鋪、裁縫店、珠寶店、魔法物品店、情報商：各自的交易清單
const SHOPS = ['smithy', 'tailor', 'jeweler', 'magic', 'informant'] as const
// 自建的商店（內容編輯器擺的）：格子的種類就是商店的 id
const shopHere = computed<ShopType | null>(() => {
  void content.version
  const k = cell.value.kind
  if ((SHOPS as readonly string[]).includes(k)) return k as (typeof SHOPS)[number]
  return isCustomShopId(k) && shopRules.types[k] ? k : null
})
// 店名、描述與招呼語（旅店也有）：見 engine/shopNames.ts
const named = computed<NamedShop | null>(() => {
  void content.version
  return cell.value.kind === 'inn' ? 'inn' : shopTypeForCell(cell.value.kind)
})
const title = computed(() => {
  return named.value ? shopTitle(shopPlace(s.value).id, named.value) : null
})
// 有場景橫幅的建築：有店名的店、旅店、公會
const banner = computed(() => {
  if (title.value && named.value) return { kind: named.value, name: title.value.name, tag: title.value.name !== shopKindName(named.value) ? shopKindName(named.value) : '' }
  if (cell.value.kind === 'guild') return { kind: 'guild', name: cellName('guild'), tag: '' }
  return null
})
// 神殿、雜貨店選單的其他項目（交易與折扣以外）
const extraOpen = ref<'wash' | 'market' | null>(null)
const templeMenu = computed<MenuItem[]>(() => [
  {
    id: 'heal', icon: 'heart', label: '神殿治療', detail: '受傷的隊員 HP 回滿（不回復法術環）',
    badge: templeCost(s.value) ? formatMoney(templeCost(s.value)) : '不需要', disabled: templeCost(s.value) === 0 || s.value.money_cc < templeCost(s.value),
  },
  { id: 'wash', icon: 'feather', label: '洗刺青', detail: '要有聲望；奴隸印記要解除契約才能去掉' },
])
const marketName = computed(() => marketsHere(s.value).find((m) => m.kind === 'public')?.def.name ?? '市場')
const generalMenu = computed<MenuItem[]>(() => (publicMarket.value ? [{ id: 'market', icon: 'users', label: marketName.value, detail: '公開的奴隸買賣' }] : []))
function onExtra(id: string) {
  if (id === 'heal') game.templeHeal()
  else if (id === 'wash' || id === 'market') extraOpen.value = id
}
// 公會的選單：委託板在對話框裡
const showBoard = ref(false)
const guildMenu = computed<MenuItem[]>(() => [{
  id: 'board', icon: 'scroll', label: '委託板',
  detail: `${quests.value.filter((q) => q.status === 'available').length} 件可以接取${activeQuests.value.length ? `・進行中 ${activeQuests.value.length} 件` : ''}`,
  badge: quests.value.filter((q) => canTurnIn(s.value, q)).length ? `${quests.value.filter((q) => canTurnIn(s.value, q)).length} 件可交付` : quests.value.length,
  tone: quests.value.some((q) => canTurnIn(s.value, q)) ? 'gold' : undefined,
}])
// 商店的說明（shops.json 的 desc，內容頁籤可以改）：店名有自己的描述時收進「?」
const shopDesc = computed(() => {
  void content.version
  return Object.values(shopRules.types).find((t) => t.cell === cell.value.kind)?.desc ?? landmarkDef(cell.value.kind)?.desc ?? ''
})
</script>

<template>
    <div class="place">
      <!-- 待售的空地、自己的房子 -->
      <HomePanel v-if="showPlace" />
      <!-- 目前所在格子（房子裡由上面的房屋區塊顯示） -->
      <section v-if="showPlace && area.kind !== 'road' && area.kind !== 'home'" class="panel">
        <!-- 特殊任務的任務點和地圖上一樣是 ⭐，不要顯示成委託地點 -->
        <h3 v-if="cell.storyNode" class="place-title"><GameIcon name="star" :size="18" />特殊任務的任務點</h3>
        <SceneBanner v-else-if="banner" :kind="banner.kind" :name="banner.name" :tag="banner.tag" :icon="CELL_GAME_ICON[cell.kind]">
          <Hint v-if="shopDesc && title?.desc" :text="shopDesc" />
        </SceneBanner>
        <h3 v-else class="place-title">
          <GameIcon v-if="CELL_GAME_ICON[cell.kind]" :name="CELL_GAME_ICON[cell.kind]!" :size="18" />
          <span v-else-if="ICON[cell.kind]">{{ ICON[cell.kind] }}</span>
          <GameIcon v-else name="pin" :size="18" />
          {{ title ? title.name : sceneSpot ?? (cell.kind === 'wall' ? '道路' : cell.kind === 'boss' && cell.name ? cell.name : insideRoom && cell.kind === 'floor' ? '室內' : cellName(cell.kind)) }}
          <span v-if="title && named && title.name !== shopKindName(named)" class="tag">{{ shopKindName(named) }}</span>
          <Hint v-if="title && shopDesc && title.desc" :text="shopDesc" />
        </h3>
        <template v-if="title && title.desc">
          <p class="shop-desc">{{ title.desc }}</p>
          <p v-if="title.greeting" class="greeting small">「{{ title.greeting }}」</p>
        </template>
        <p v-else-if="shopDesc" class="muted small">{{ shopDesc }}</p>
        <p v-if="specialDef" class="muted small">{{ specialDef.name }}：{{ specialDef.desc }}</p>

        <template v-if="cell.kind === 'inn'">
          <p class="muted small">可以在這裡長休（見下方「休息」）。</p>
        </template>

        <template v-else-if="cell.kind === 'temple'">
          <ShopPanel :key="`temple-${s.location}-${s.time.day}`" type="temple" :extra="templeMenu" @extra="onExtra" />
          <AppDialog :open="extraOpen === 'wash'" title="洗刺青" icon="feather" width="760px" @close="extraOpen = null">
            <TattooPanel shop="temple" />
          </AppDialog>
        </template>

        <template v-else-if="cell.kind === 'tattoo'">
          <p class="muted small">刺普通刺青（只是外觀），也替人洗掉普通刺青。</p>
          <TattooPanel shop="parlor" />
        </template>

        <template v-else-if="cell.kind === 'carver'">
          <p class="muted small">刻誓約印記，也洗刺青 <Hint text="誓約印記讓屬性有加有減；這裡也洗普通刺青與誓約印記。身上有奴隸印記時，可以付高價請刻印師燒掉（見主動行動的解除印記）。" /></p>
          <TattooPanel shop="carver" />
        </template>

        <template v-else-if="cell.kind === 'shop'">
          <p class="muted small">乾糧持有 {{ rations }} 份 <Hint text="乾糧可以吃來果腹（戰鬥開始時有一點暫時生命）；地下城的安全房長休每人要一份。" /></p>
          <ShopPanel :key="`general-${s.location}-${s.time.day}`" type="general" :extra="generalMenu" @extra="onExtra" />
          <AppDialog :open="extraOpen === 'market'" :title="marketName" icon="users" width="980px" @close="extraOpen = null">
            <MarketPanel kind="public" />
          </AppDialog>
        </template>

        <template v-else-if="shopHere">
          <ShopPanel :key="`${shopHere}-${s.location}-${s.time.day}`" :type="shopHere" />
          <FusePanel />
          <OutfitTailorPanel />
        </template>

        <template v-else-if="cell.kind === 'tavern'">
          <TavernPanel :key="`${s.location}-${s.time.day}`" />
          <ArenaPanel />
        </template>

        <template v-else-if="cell.kind === 'guild'">
          <div class="guild-rank small">
            <div>
              <GameIcon name="trophy" :size="14" /> 你是 <strong>{{ promo.rank }} 級</strong>冒險者・功績 {{ promo.merit }}<template v-if="promo.next">・升 {{ promo.next }} 級需要功績 {{ promo.needMerit }}、等級 {{ promo.needLevel }}</template>
            </div>
            <div v-if="exam" class="hot"><GameIcon name="scroll" :size="14" /> 晉升考核：{{ exam.title }}（{{ exam.status === 'ready' ? '完成了，在任何一座公會都可以交付' : '進行中' }}）</div>
            <div v-else-if="offer" class="hot"><GameIcon name="scroll" :size="14" /> 這裡的公會發了晉升考核：{{ offer.title }}（在委託板上）<Hint text="冒險者的階級各地通用：每座城鎮的公會各發一個考核，目標在各自附近，挑方便的一個接（同時只能接一個）；在任何一座公會都可以交付。" /></div>
            <div v-else-if="promo.next" class="muted">功績與等級都夠了，各城鎮的公會都會發晉升考核（目標在各自附近，挑一個接）；通過才升階。交付委託（依委託階級）、打倒地下城層主、完成特殊任務都有功績。</div>
          </div>
          <BuildingMenu :items="guildMenu" @pick="showBoard = true" />
          <AppDialog :open="showBoard" title="委託板" icon="scroll" width="900px" @close="showBoard = false">
          <template #head><Hint text="委託板每天更新，沒人接的委託會撤下換新（談過報酬的會保留）。" /></template>
          <ul class="plain board">
            <li v-if="quests.length === 0" class="muted small">目前沒有委託。</li>
            <li v-for="q in quests" :key="q.id">
              <div><span class="tag" :class="{ hot: isExam(q) }">{{ isExam(q) ? `晉升 ${q.rank}` : q.rank }}</span> <span class="tag">{{ AREA_NAME[q.area] }}</span> {{ q.title }}</div>
              <div class="small muted">
                報酬 {{ formatMoney(q.reward_cc) }}<template v-if="isMaterialQuest(q) && (q.max ?? q.goal) > q.goal">（可以過量交付到 {{ q.max }}{{ isCollectQuest(q) ? ' 份' : ' 次' }}，報酬依比例增加）</template>
                <span v-if="q.status === 'available' && questDeadlineDays(q, s) !== undefined">・期限 {{ questDeadlineDays(q, s) }} 天</span>
                <span v-if="q.status !== 'available'">・{{ questProgressText(s, q) }}</span>
                <span v-if="q.status === 'accepted' && q.deadline">・<GameIcon name="hourglass" :size="12" /> {{ deadlineText(s, q.deadline) }}</span>
              </div>
              <button
                v-if="q.status === 'available'"
                class="small"
                :disabled="!canAcceptRank(s, q.rank, q)"
                @click="game.acceptQuest(q.id); refreshQuests()"
              >{{ canAcceptRank(s, q.rank, q) ? '接取' : '階級不足' }}</button>
              <template v-else-if="canTurnIn(s, q)">
                <input
                  v-if="isMaterialQuest(q) && deliverable(s, q) > q.goal"
                  v-model.number="turnInQty[q.id]" type="number" class="qty" :min="q.goal" :max="deliverable(s, q)"
                  :placeholder="String(deliverable(s, q))"
                />
                <button class="small primary" @click="turnIn(q)">
                  交付<template v-if="isMaterialQuest(q)">（{{ formatMoney(rewardFor(q, turnInQty[q.id] ?? deliverable(s, q))) }}）</template>
                </button>
              </template>
              <span v-else class="small muted">進行中</span>
              <button
                v-if="!canNegotiate(s, 'quest_reward', { quest: q.id })"
                class="small"
                @click="game.startNegotiation('quest_reward', { quest: q.id })"
              >談判報酬</button>
              <span v-else-if="q.flags?.negotiated" class="small muted">（已談過報酬）</span>
            </li>
          </ul>
          </AppDialog>
        </template>

        <template v-else-if="cell.kind === 'gate'">
          <p class="muted small">出城到近郊的荒野，或從這裡啟程前往其他地點。</p>
          <GuardStatus can-pay />
          <button @click="game.goOutskirts()">前往{{ here.name }}近郊</button>
        </template>

        <template v-else-if="cell.kind === 'exit' && area.kind === 'wild'">
          <GuardStatus can-pay />
          <button @click="game.returnToTown()">返回{{ here.name }}</button>
        </template>

        <template v-else-if="cell.kind === 'merchant'">
          <p class="muted small">照著情報找到的流浪商人：賣城裡少見的材料、藥劑、卷軸與幾件優良裝備。</p>
          <ShopPanel :key="`wanderer-${s.location}-${s.time.day}`" type="wanderer" />
        </template>

        <template v-else-if="cell.kind === 'exit' && parkPlaza(area.location) && area.kind === 'dungeon'">
          <p class="muted small">{{ area.name }}的出口，通往{{ specialMaps[parkPlaza(area.location)!]?.name }}。</p>
          <button @click="game.leavePark()">回到{{ specialMaps[parkPlaza(area.location)!]?.name }}</button>
        </template>

        <template v-else-if="cell.kind === 'exit' && area.kind === 'special'">
          <p class="muted small">{{ area.name }}的出口。</p>
          <button @click="game.leaveSpecial()">離開，回到{{ s.special?.back ? '進來前的地方' : here.name }}</button>
        </template>

        <template v-else-if="cell.kind === 'link'">
          <p class="muted small">通往{{ linkName }}的{{ area.kind === 'special' ? '通道' : cell.dir === 'out' ? '大門' : '路口' }}。</p>
          <p v-if="linkBlock" class="warn small"><GameIcon name="siren" :size="13" /> {{ linkBlock.reason }}</p>
          <template v-if="canPersuade">
            <textarea v-model="persuadeText" class="persuade-text" rows="2" maxlength="400" placeholder="你怎麼說服衛兵（選填）：例如亮出公會的推薦信，說是來替伯爵送急件的" />
            <button class="primary" :disabled="game.judging" @click="persuade">說服衛兵（魅力 DC {{ palacePersuadeDc(s) }}）</button>
          </template>
          <button :class="{ primary: !linkBlock }" :disabled="!!linkBlock" @click="game.crossLink()"><GameIcon name="right" :size="14" /> 前往{{ linkName }}<span class="key">E</span></button>
        </template>

        <template v-else-if="cell.kind === 'exit' && area.kind === 'side'">
          <p class="muted small">{{ area.name }}的出口。</p>
          <button @click="leaveSide">離開，回到{{ s.road ? '旅途' : '原本的地方' }}</button>
        </template>

        <template v-else-if="cell.kind === 'exit' && area.kind === 'dungeon'">
          <p class="muted small">{{ here.name }}的入口。可以從這裡離開，前往其他地點。</p>
        </template>

        <template v-else-if="cell.kind === 'stairs_down'">
          <p class="muted small">通往{{ DUNGEON_LAYERS[(area.layer ?? 0) + 1]?.name }}。越往下越危險。</p>
          <button class="primary" @click="game.descend()">往下一層</button>
        </template>

        <template v-else-if="cell.kind === 'stairs_up'">
          <button @click="game.ascend()">回到{{ DUNGEON_LAYERS[(area.layer ?? 1) - 1]?.name }}</button>
        </template>

        <template v-else-if="cell.kind === 'brothel'">
          <BrothelPanel />
          <ArenaPanel />
        </template>

        <template v-else-if="cell.kind === 'safe'">
          <p class="muted small">安全房：魔物不會靠近，可以安心短休或長休（見下方「休息」）。</p>
        </template>

        <template v-else-if="cell.kind === 'chest' && !cell.done && cell.lock">
          <p class="muted small"><GameIcon name="lock" :size="13" /> 上鎖的寶箱（DC {{ cell.lock }}）<template v-if="lockTool">・開鎖時用{{ lockTool.name }}（+{{ lockTool.bonus }}）</template>
            <Hint :text="`選一種方式試著打開，由隊伍中那項屬性最高的人來做；失敗可以再試或換一種，每次 10 分鐘。${lockTool ? '' : '靈巧開鎖時，帶著開鎖類的工具會容易一點。'}`" />
          </p>
          <div class="row lock-methods">
            <button v-for="(m, k) in LOCK_METHODS" :key="k" class="small" @click="game.pickLock(k)">
              <GameIcon :name="LOCK_ICON[k]" :size="13" /> {{ m.name }} <span class="muted">（{{ attrName(k) }}・{{ lockPicker(s, k).name }} {{ signed(lockBonus(k)) }}）</span>
            </button>
          </div>
        </template>

        <LandmarkPanel v-else-if="landmarkDef(cell.kind) || sceneSpot" :key="`lm-${area.key}-${cell.kind}`" />

        <p v-else-if="!cell.storyNode" class="muted small">{{ cell.done ? '這裡已經清理乾淨了。' : '四下無事。' }}</p>

        <WorkPanel :key="`${area.key}-${cell.kind}`" />
        <TrainPanel v-if="!closedHere(s)" :key="`train-${area.key}-${cell.kind}`" />
        <CraftPanel :key="`craft-${area.key}-${cell.kind}`" />

        <div v-for="q in runnableHere" :key="q.id" class="quest-here">
          <div class="small"><span class="tag">{{ q.rank }}</span> {{ q.title }}</div>
          <button class="small primary" @click="runQuest(q.id)">執行委託（{{ questTime(q) }}）</button>
        </div>
      </section>

      <!-- 進行中的事（談判、委託）：手機版放在「這裡」面板，走在街上也看得到。
           特殊任務（這裡可以接的、這裡的任務點）跟著位置走：設施面板與「這裡」面板都有 -->
      <NegotiationPanel v-if="showOngoing" :mode="isMobile ? 'list' : 'all'" />
      <StoryPanel />
      <template v-if="showOngoing">

        <section v-if="activeQuests.length" class="panel">
          <FoldMenu id="quests.active" icon="scroll" label="進行中的委託" :detail="activeQuests.some((q) => canTurnIn(s, q)) ? `${activeQuests.filter((q) => canTurnIn(s, q)).length} 件可以交付` : '委託的進度與地點'" :badge="activeQuests.length" :tone="activeQuests.some((q) => canTurnIn(s, q)) ? 'gold' : undefined">
          <ul class="plain small">
            <li v-for="q in activeQuests" :key="q.id">
              <span class="tag">{{ q.rank }}</span> {{ q.title }}（{{ questProgressText(s, q) }}）
              <span v-if="q.flags?.lead" class="tag">有線索 +5</span>
              <div class="muted">{{ questWhere(q) }}</div>
            </li>
          </ul>
          </FoldMenu>
        </section>
      </template>

      <section v-if="showPlace && canTravelHere(s)" class="panel travel">
        <BuildingMenu :items="travelMenu" @pick="showTravel = true" />
        <AppDialog :open="showTravel" title="啟程旅行" icon="compass" width="860px" @close="showTravel = false">
          <TravelDialog @close="showTravel = false" />
        </AppDialog>
      </section>
    </div>
</template>

<style scoped>
/* 鍵盤快捷鍵的小方塊（前往相連區域：E） */
.key { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid currentColor; border-radius: 3px; font-size: 11px; line-height: 1.4; opacity: 0.75; }
.persuade-text { width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 4px; }
.guild-rank { display: grid; gap: 2px; padding: 6px 8px; border: 1px dashed var(--accent); border-radius: var(--radius); margin-bottom: 6px; }
.guild-rank .hot { color: var(--accent); }
.board > li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 10px 4px; }
.board > li > div { flex-basis: 100%; }
.tag.hot { border-color: var(--accent); color: var(--accent); }
.lock-methods { display: flex; flex-wrap: wrap; gap: 4px; }
.qty { width: 56px; }
.warn { color: var(--accent); margin: 2px 0; }
.travel :deep(.menu) { margin: 0; }
.quest-here { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); display: grid; gap: 4px; }
.place-title { display: flex; align-items: center; gap: 6px; }
.place-title :deep(.game-icon) { color: var(--accent); }
.place-title .tag { font-weight: normal; letter-spacing: 0; }
.shop-desc { margin: 0 0 4px; font-family: var(--font-story); color: var(--text); opacity: 0.9; font-size: var(--fs-sm); line-height: 1.8; }
.greeting { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--gold-lo); color: var(--muted); font-family: var(--font-story); }
</style>
