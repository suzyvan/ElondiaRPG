<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { itemRules, shopDef, type ItemCategory, type ShopType } from '@/engine/data'
import { formatMoney } from '@/engine/money'
import { breakdownText, buyBreakdown, listPrice, listSellPrice, CART_CHANGE_WARNING as CHANGE_WARNING, cartBargainHeld, cartFromRecords, costText, dealMoney, discount, effectText, isItemDeal, isUniqueItem, sellBreakdown, sellPrice, shopKey, shopPlace } from '@/engine/trade'
import { materialGroup, materialGroupName, materialGroupOrder, materialRecipesFull, materialTier } from '@/engine/materialInfo'
import type { Deal, Report } from '@/engine/types'
import { useGame } from '@/stores/game'
import { CATEGORY_ORDER, categoryName, categoryOf, itemEffect, itemEffectParts, itemRarity, itemText } from './itemInfo'
import EffectLine from './EffectLine.vue'
import ItemIcon from './ItemIcon.vue'
import GameIcon from '../ui/GameIcon.vue'
import SwipeTabs from '../mobile/SwipeTabs.vue'
import { isMobile } from '../mobile/mobile'
import ContentTagChips from '../ContentTagChips.vue'
import { storyDef, storyMaxCost } from '@/engine/story'
import CartPanel from './CartPanel.vue'
import MarketTags from './MarketTags.vue'
import PriceSteps from './PriceSteps.vue'

// 商店的交易視窗：左邊是店裡的商品，右邊是行囊（可以賣的標出收購價），下面是購物車（一般商品與賣出一次結帳，CartPanel）。
// 特別交易（AI 準備的、情報、服務）照舊一件一件買、一件一件交涉
const props = defineProps<{ type: ShopType; loading?: boolean }>()
const game = useGame()
const s = computed(() => game.state!)
// 購物車：買入（交易 id → 數量）、賣出（物品名稱 → 數量）
const cart = reactive<{ buy: Record<string, number>; sell: Record<string, number> }>({ buy: {}, sell: {} })
// 購物車展開明細時（桌機）：商品、行囊的清單矮一點，讓購物車與結帳一起放得進一個畫面，不會被黏在底部的結帳列蓋住
// 購物車預設收合（只有預覽）；展開明細時清單才讓出空間
const cartOpen = ref(false)
const cartFilled = computed(() => Object.keys(cart.buy).length + Object.keys(cart.sell).length > 0)
const cartCount = computed(() => Object.values(cart.buy).reduce((a, b) => a + b, 0) + Object.values(cart.sell).reduce((a, b) => a + b, 0))
// 手機版的分頁：店裡的商品｜你的行囊｜購物車（電腦版購物車放在兩欄下面）
const SIDES = computed(() => [
  { id: 'buy', label: '店裡的商品' }, { id: 'sell', label: '你的行囊' },
  ...(isMobile.value ? [{ id: 'cart', label: `購物車${cartCount.value ? ` ${cartCount.value}` : ''}` }] : []),
])
const side = ref('buy')
const key = computed(() => shopKey(s.value, props.type))
const shop = computed(() => {
  const cur = s.value.shops?.[key.value]
  return cur && cur.day === s.value.time.day ? cur : undefined
})
const off = computed(() => Math.round(discount(s.value, key.value) * 100))
const busy = computed(() => game.judging)
const place = computed(() => shopPlace(s.value))
/** 最近一次交易的結果（顯示在視窗上方） */
const last = ref('')

// ---- 商品 ----
type Group = ItemCategory | 'special'
const itemName = (d: Deal) => d.id.slice('item:'.length)
const groupOf = (d: Deal): Group => (isItemDeal(d) ? categoryOf(s.value, itemName(d)) ?? 'special' : 'special')
const deals = computed(() => shop.value?.deals.filter((d) => d.stock > 0) ?? [])
const groups = computed(() => {
  const set = new Set(deals.value.map(groupOf))
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...(set.has('special') ? ['special' as const] : [])]
})
const filter = ref<Group | 'all'>('all')
// 搜尋與排序
const query = ref('')
const sort = ref<'default' | 'cheap' | 'dear' | 'name'>('default')
const shownDeals = computed(() => {
  const q = query.value.trim()
  const list = deals.value.filter((d) => (filter.value === 'all' || groupOf(d) === filter.value)
    && (!q || d.title.includes(q) || (isItemDeal(d) && (itemEffect(s.value, itemName(d)) ?? '').includes(q))))
  if (sort.value === 'cheap') return [...list].sort((a, b) => price(a) - price(b))
  if (sort.value === 'dear') return [...list].sort((a, b) => price(b) - price(a))
  if (sort.value === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'))
  return list
})
// 特別交易內容多，維持卡片；一般商品一列一件，點一下展開
const specialDeals = computed(() => shownDeals.value.filter((d) => !isItemDeal(d)))
/** 情報商賣的特殊任務消息：任務的內容標籤、途中最多一次要付的錢（買之前就知道） */
function dealStory(d: Deal) {
  const g = d.gets.find((x) => x.type === 'start_story')
  return g?.type === 'start_story' ? storyDef(g.story) : undefined
}
const itemDeals = computed(() => shownDeals.value.filter(isItemDeal))
// 特別交易預設收起（只看到標題列與筆數）；篩選「特別交易」或搜尋時展開
const specialsOpen = ref(false)
const specialsFolded = computed(() => filter.value === 'all' && !query.value.trim() && !specialsOpen.value)
const expanded = ref<string | null>(null)
const toggle = (id: string) => { expanded.value = expanded.value === id ? null : id }
const groupName = (g: Group) => (g === 'special' ? '特別交易' : itemRules.categories[g])

/** 還沒放進購物車的存貨 */
const leftOf = (d: Deal) => d.stock - (cart.buy[d.id] ?? 0)
/** 談好價之後要改購物車：先提醒（改了就照原價交易） */
const okToChange = () => !cartBargainHeld(s.value, props.type, cartFromRecords(cart)) || confirm(CHANGE_WARNING)
function addBuy(d: Deal, all = false) {
  if (leftOf(d) <= 0 || !okToChange()) return
  cart.buy[d.id] = (cart.buy[d.id] ?? 0) + (all ? leftOf(d) : 1)
}
/** 從購物車拿掉一個，或全部拿掉 */
function removeBuy(d: Deal, all = false) {
  const inCart = cart.buy[d.id] ?? 0
  if (inCart <= 0 || !okToChange()) return
  if (!all && inCart > 1) cart.buy[d.id] = inCart - 1
  else delete cart.buy[d.id]
}
const price = (d: Deal) => dealMoney(s.value, key.value, d)
/** 收購價比標準收購價（基本價 × 收購比例）高：up（紅字）；低：down（綠字）——紅漲綠跌，和售價一樣 */
const sellTone = (name: string, p: number | null) => {
  const list = listSellPrice(s.value, key.value, name)
  return p === null || list === undefined || p === list ? '' : p > list ? 'up' : 'down'
}
/** 售價比標準售價（基本價 × 店家加成）高：up；低：down（字變紅、變綠） */
const priceTone = (d: Deal) => {
  const list = listPrice(s.value, d)
  const p = price(d)
  return list === undefined || p === list ? '' : p > list ? 'up' : 'down'
}
function affordable(d: Deal, n = 1): boolean {
  if (s.value.money_cc < price(d) * n) return false
  return d.gives.every((g) => g.type !== 'item' || (s.value.inventory.find((i) => i.name === g.name)?.qty ?? 0) >= (g.qty ?? 1) * n)
}

// ---- 交涉 ----
const haggling = ref<string | null>(null)
const haggleText = reactive<Record<string, string>>({})
async function bargain(d: Deal) {
  haggling.value = null
  const before = s.value.reports.length
  last.value = '交涉中…'
  await game.bargain(props.type, d.id, haggleText[d.id] ?? '')
  const r = s.value.reports.length > before ? s.value.reports[s.value.reports.length - 1] : undefined
  last.value = r?.outcome.summary ?? ''
}

// ---- 行囊 ----
const buysText = computed(() => shopDef(props.type).buys.map((c) => itemRules.categories[c]).join('、'))
const onlySellable = ref(true)
// 行囊的篩選：類別與搜尋（和店裡的商品一樣）
const bagFilter = ref<ItemCategory | 'other' | 'all'>('all')
const bagQuery = ref('')
const bagCat = (name: string): ItemCategory | 'other' => categoryOf(s.value, name) ?? 'other'
const bagAll = computed(() => s.value.inventory
  .filter((i) => i.qty > 0)
  .map((i) => ({ ...i, price: sellPrice(s.value, key.value, i.name) }))
  .filter((i) => !onlySellable.value || i.price !== null))
const bagCats = computed(() => {
  const set = new Set(bagAll.value.map((i) => bagCat(i.name)))
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...(set.has('other') ? ['other' as const] : [])]
})
const bag = computed(() => bagAll.value
  .filter((i) => (bagFilter.value === 'all' || bagCat(i.name) === bagFilter.value)
    && (!bagQuery.value.trim() || i.name.includes(bagQuery.value.trim()) || (itemEffect(s.value, i.name) ?? '').includes(bagQuery.value.trim())))
  .sort((a, b) => Number(b.price !== null) - Number(a.price !== null)))
// 行囊依類別分段，材料再依小類（和行囊頁一樣，materialInfo.ts）；同一段裡能賣的在前、等級高的在前
const bagGroups = computed(() => {
  const groupOf = (name: string) => {
    const c = categoryOf(s.value, name)
    if (c === 'material') {
      const g = materialGroup(s.value, name)
      return { id: `material:${g}`, order: CATEGORY_ORDER.indexOf('material') + (materialGroupOrder().indexOf(g) + 1) / 100, name: `${itemRules.categories.material}・${materialGroupName(g)}` }
    }
    return c ? { id: c, order: CATEGORY_ORDER.indexOf(c), name: itemRules.categories[c] } : { id: 'other', order: 99, name: '其他' }
  }
  const groups = new Map<string, { id: string; order: number; name: string; items: typeof bag.value }>()
  for (const i of bag.value) {
    const g = groupOf(i.name)
    if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] })
    groups.get(g.id)!.items.push(i)
  }
  const tier = (name: string) => materialTier(s.value, name)?.tier ?? 0
  return [...groups.values()].sort((a, b) => a.order - b.order).map((g) => ({
    ...g, items: [...g.items].sort((a, b) => Number(b.price !== null) - Number(a.price !== null) || tier(b.name) - tier(a.name)),
  }))
})
/** 展開了收購價拆解的物品 */
const sellWhy = ref<string | null>(null)
const buyWhy = (d: Deal) => buyBreakdown(s.value, key.value, d)
const buyWhyText = (d: Deal) => { const b = buyWhy(d); return b ? `${breakdownText(b)}\n（點一下展開）` : undefined }
const sellLeft = (name: string, have: number) => have - (cart.sell[name] ?? 0)
function addSell(name: string, have: number, all = false) {
  if (sellLeft(name, have) <= 0 || !okToChange()) return
  cart.sell[name] = (cart.sell[name] ?? 0) + (all ? sellLeft(name, have) : 1)
}
/** 從購物車拿掉一個（或全部）要賣的 */
function removeSell(name: string, all = false) {
  const inCart = cart.sell[name] ?? 0
  if (inCart <= 0 || !okToChange()) return
  if (!all && inCart > 1) cart.sell[name] = inCart - 1
  else delete cart.sell[name]
}
/** 價格欄只寫數字（單位在右上角的錢與表頭） */
const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// ---- 結果 ----
function done(r: Report | undefined) {
  if (r) last.value = r.outcome.summary ?? ''
}
function buy(d: Deal) {
  done(game.buyDeal(props.type, d.id, 1))
}

</script>

<template>
  <div class="shop-dialog" :class="{ 'cart-peek': cartFilled && !cartOpen, 'cart-open': cartFilled && cartOpen }">
    <!-- 頂端一列：這座城的行情（彩色標籤）、折扣與 AI 的提示，右邊是錢（店主寫在建築的選單上，這裡不另外佔一列） -->
    <div class="shop-bar">
      <div class="bar-left small">
        <MarketTags :location="place.id" :marquee="false" compact />
        <span v-if="off" class="tag ok">折扣 {{ off }}%</span>
        <span v-if="loading" class="muted">AI 正在準備今天的商品…</span>
        <span v-else-if="shop?.source === 'ai'" class="muted">今天有 AI 準備的特別商品</span>
      </div>
      <strong class="money"><GameIcon name="coins" :size="16" />{{ formatMoney(s.money_cc) }}</strong>
    </div>
    <p v-if="last" class="last small"><GameIcon name="check" :size="13" /> {{ last }}</p>

    <!-- 電腦版左右兩欄；手機版變成「店裡的商品｜你的行囊」兩個分頁，可以左右滑 -->
    <SwipeTabs v-model="side" :tabs="SIDES" :swipe="isMobile" :bar="isMobile" all class="cols">
      <template #default="{ id }">
        <template v-if="id === 'buy'">
          <!-- 店裡的商品 -->
          <section class="col">
            <div class="row head-row">
              <h3 class="head"><GameIcon name="store" :size="17" />店裡的商品</h3>
              <input v-model="query" class="grow search" type="search" placeholder="搜尋名稱或效果" />
              <select v-model="sort" class="small" aria-label="排序">
                <option value="default">預設排序</option>
                <option value="cheap">價格低到高</option>
                <option value="dear">價格高到低</option>
                <option value="name">名稱</option>
              </select>
            </div>
            <nav class="row chips">
              <button class="small" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 {{ deals.length }}</button>
              <button v-for="g in groups" :key="g" class="small" :class="{ active: filter === g }" @click="filter = g">
                <GameIcon v-if="g === 'special'" name="sparkles" :size="14" /><ItemIcon v-else :category="g" :size="14" /> {{ groupName(g) }}
              </button>
            </nav>
            <p v-if="!deals.length" class="small muted">今天沒有東西可以買了。</p>
            <p v-else-if="!shownDeals.length" class="small muted">沒有符合的商品。</p>
            <div class="list">
              <button v-if="specialDeals.length && filter === 'all' && !query.trim()" class="group-head small ghost" :aria-expanded="!specialsFolded" @click="specialsOpen = !specialsOpen">
                <GameIcon :name="specialsFolded ? 'right' : 'down'" :size="13" /><GameIcon name="sparkles" :size="13" />特別交易<span class="muted">{{ specialDeals.length }}</span>
              </button>
              <ul v-if="specialDeals.length && !specialsFolded" class="plain rows specials">
                <li v-for="d in specialDeals" :key="d.id" class="item-row" :class="{ open: expanded === d.id }">
                  <div class="line special-line" @click="toggle(d.id)">
                    <span class="item-tile special"><GameIcon name="sparkles" :size="18" /></span>
                    <span class="what marquee"><span class="what-in">
                      <strong>{{ d.title }}</strong><span class="qty small">×{{ d.stock }}</span>
                      <ContentTagChips v-if="dealStory(d)" :tags="dealStory(d)!.tags" />
                      <span class="small effect">{{ d.gets.map((g) => effectText(s, g, shop?.keeper)).join('、') }}</span>
                    </span></span>
                    <span class="price">{{ costText(s, key, d) }}</span>
                    <span class="btns" @click.stop>
                      <button class="small primary" :disabled="busy || !affordable(d)" @click="buy(d)">買下</button>
                      <button v-if="price(d) > 0" class="small" :disabled="d.haggled || busy" @click="haggling = haggling === d.id ? null : d.id">{{ d.haggled ? '已交涉' : '交涉' }}</button>
                    </span>
                  </div>
                  <div v-if="expanded === d.id" class="more small">
                    <div class="effect">得到：{{ d.gets.map((g) => effectText(s, g, shop?.keeper)).join('、') }}</div>
                    <div v-if="d.desc" class="muted">{{ d.desc }}</div>
                    <div v-if="dealStory(d) && storyMaxCost(dealStory(d)!)" class="muted">任務途中有要付錢的地方（一次最多 {{ formatMoney(storyMaxCost(dealStory(d)!)) }}），錢不夠時那一步不能選</div>
                  </div>
                  <div v-if="haggling === d.id" class="row haggle">
                    <input v-model="haggleText[d.id]" class="grow" placeholder="怎麼交涉？例如：挑出瑕疵、搬出熟人、請店主喝一杯" />
                    <button class="small" :disabled="busy" @click="bargain(d)">交涉（檢定）</button>
                  </div>
                </li>
              </ul>
              <div v-if="itemDeals.length" class="thead small muted" aria-hidden="true"><span /><span>物品</span><span class="c">類別</span><span class="r">價格</span><span /><span /></div>
              <ul v-if="itemDeals.length" class="plain rows">
                <li v-for="d in itemDeals" :key="d.id" class="item-row" :class="{ open: expanded === d.id }">
                  <div class="line" @click="toggle(d.id)">
                    <span class="item-tile" :class="`r-${itemRarity(s, itemName(d))}`"><ItemIcon :name="itemName(d)" :size="22" /></span>
                    <span class="what"><strong class="nm">{{ d.title }}</strong><span class="qty small" :title="`還剩 ${leftOf(d)} 個（購物車裡的不算）`">×{{ leftOf(d) }}</span><span class="sub small muted">{{ categoryName(s, itemName(d)) }}</span></span>
                    <span class="cat small muted">{{ categoryName(s, itemName(d)) }}</span>
                    <span class="price" :class="priceTone(d)" :title="buyWhyText(d)">{{ num(price(d)) }}</span>
                    <span class="steps" @click.stop>
                      <button class="small" :disabled="!cart.buy[d.id]" title="全部拿出購物車" aria-label="全部拿出購物車" @click="removeBuy(d, true)">«</button>
                      <button class="small" :disabled="!cart.buy[d.id]" title="從購物車拿出一個" aria-label="從購物車拿出一個" @click="removeBuy(d)">‹</button>
                      <button class="small" :disabled="leftOf(d) <= 0" title="放進購物車一個" aria-label="放進購物車一個" @click="addBuy(d)">›</button>
                      <button class="small" :disabled="leftOf(d) <= 0" :title="`剩下的 ${leftOf(d)} 個全部放進購物車`" aria-label="剩下的全部放進購物車" @click="addBuy(d, true)">»</button>
                    </span>
                    <span class="incart small" :title="cart.buy[d.id] ? `購物車裡有 ${cart.buy[d.id]} 個` : undefined"><template v-if="cart.buy[d.id]"><GameIcon name="cart" :size="13" />{{ cart.buy[d.id] }}</template></span>
                  </div>
                  <div v-if="expanded === d.id" class="more small">
                    <div class="muted">類別：{{ categoryName(s, itemName(d)) }}</div>
                    <div v-if="itemEffect(s, itemName(d))" class="effect"><EffectLine :parts="itemEffectParts(s, itemName(d))" /></div>
                    <div v-if="d.desc || itemText(s, itemName(d))" class="muted">{{ d.desc ?? itemText(s, itemName(d)) }}</div>
                    <PriceSteps v-if="buyWhy(d)" :b="buyWhy(d)!" />
                  </div>
                </li>
              </ul>
            </div>
          </section>
        </template>
        <template v-else-if="id === 'cart'">
          <CartPanel :type="type" :cart="cart" @done="(t) => (last = t)" />
        </template>
        <template v-else>
          <!-- 行囊 -->
          <section class="col bag-pane">
            <div class="row head-row">
              <h3 class="head"><GameIcon name="backpack" :size="17" />你的行囊</h3>
              <input v-model="bagQuery" class="grow search" type="search" placeholder="搜尋行囊" />
            </div>
            <div class="row small">
              <span class="muted">這間店收：{{ buysText || '不收東西' }}</span>
              <span class="grow" />
              <label class="check"><input v-model="onlySellable" type="checkbox" /> 只顯示能賣的</label>
            </div>
            <nav v-if="bagCats.length > 1" class="row chips">
              <button class="small" :class="{ active: bagFilter === 'all' }" @click="bagFilter = 'all'">全部 {{ bagAll.length }}</button>
              <button v-for="c in bagCats" :key="c" class="small" :class="{ active: bagFilter === c }" @click="bagFilter = c">
                <ItemIcon v-if="c !== 'other'" :category="c" :size="14" /> {{ c === 'other' ? '其他' : itemRules.categories[c] }}
              </button>
            </nav>
            <p v-if="!bag.length" class="small muted">{{ bagAll.length ? '沒有符合篩選的東西。' : onlySellable ? '沒有這間店收的東西。' : '行囊是空的。' }}</p>
            <div v-if="bag.length" class="thead small muted" aria-hidden="true"><span /><span>物品</span><span class="r">收購</span><span /><span /></div>
            <div class="list">
              <template v-for="g in bagGroups" :key="g.id">
                <div class="group-head small">{{ g.name }}<span class="muted">{{ g.items.length }}</span></div>
                <ul class="plain rows">
                  <li v-for="i in g.items" :key="i.name" class="item-row" :class="{ open: sellWhy === i.name, dim: i.price === null }">
                    <div class="line" @click="sellWhy = sellWhy === i.name ? null : i.name">
                      <span class="item-tile" :class="`r-${itemRarity(s, i.name)}`"><ItemIcon :name="i.name" :size="22" /></span>
                      <span class="what"><strong class="nm">{{ i.name }}</strong><span class="qty small" :title="cart.sell[i.name] ? `行囊裡有 ${i.qty} 個，購物車裡要賣 ${cart.sell[i.name]} 個` : undefined">×{{ sellLeft(i.name, i.qty) }}</span><span class="sub small muted">{{ categoryName(s, i.name) }}</span></span>
                      <span class="price" :class="sellTone(i.name, i.price)" :title="i.price !== null ? '收購價（一個；點一下看怎麼算）' : undefined">{{ i.price !== null ? num(i.price) : '' }}</span>
                      <span v-if="i.price !== null" class="steps" @click.stop>
                        <button class="small" :disabled="!cart.sell[i.name]" title="全部拿出購物車" aria-label="全部拿出購物車" @click="removeSell(i.name, true)">«</button>
                        <button class="small" :disabled="!cart.sell[i.name]" title="從購物車拿出一個" aria-label="從購物車拿出一個" @click="removeSell(i.name)">‹</button>
                        <button class="small" :disabled="sellLeft(i.name, i.qty) <= 0" title="放進購物車一個（賣出）" aria-label="放進購物車一個（賣出）" @click="addSell(i.name, i.qty)">›</button>
                        <button class="small" :disabled="sellLeft(i.name, i.qty) <= 0" :title="`剩下的 ${sellLeft(i.name, i.qty)} 個全部放進購物車（賣出）`" aria-label="剩下的全部放進購物車（賣出）" @click="addSell(i.name, i.qty, true)">»</button>
                      </span>
                      <span v-else class="no small muted">{{ isUniqueItem(s, i.name) ? '獨特裝備不能賣' : '這間店不收' }}</span>
                      <span v-if="i.price !== null" class="incart small" :title="cart.sell[i.name] ? `購物車裡要賣 ${cart.sell[i.name]} 個` : undefined"><template v-if="cart.sell[i.name]"><GameIcon name="cart" :size="13" />{{ cart.sell[i.name] }}</template></span>
                    </div>
                    <div v-if="sellWhy === i.name" class="more small">
                      <div class="muted">類別：{{ categoryName(s, i.name) }}</div>
                      <div v-if="itemEffect(s, i.name)" class="effect" :title="materialRecipesFull(i.name) || undefined"><EffectLine :parts="itemEffectParts(s, i.name)" /></div>
                      <div v-if="itemText(s, i.name)" class="muted">{{ itemText(s, i.name) }}</div>
                      <PriceSteps v-if="i.price !== null && sellBreakdown(s, key, i.name)" :b="sellBreakdown(s, key, i.name)!" sell />
                    </div>
                  </li>
                </ul>
              </template>
            </div>
          </section>
        </template>
      </template>
    </SwipeTabs>
    <CartPanel v-if="!isMobile" v-model:open="cartOpen" collapsible :type="type" :cart="cart" @done="(t) => (last = t)" />
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 6px; }
.head :deep(.game-icon), .money :deep(.game-icon) { color: var(--accent); }
.shop-dialog { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.shop-bar { display: flex; flex-wrap: nowrap; gap: 8px; justify-content: space-between; align-items: flex-start; }
.shop-bar .money { flex: none; }
.money { color: var(--accent-2); }
.tag.ok { border-color: var(--accent); color: var(--accent); margin-left: 6px; }
.error { color: var(--danger); margin: 0; }
.last { color: var(--accent); margin: 0; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 760px) { .cols { grid-template-columns: minmax(0, 1fr); } }
.col { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-content: start; min-width: 0; }
.col h3 { margin: 0; color: var(--accent-2); }
/* 標題與搜尋同一列（清單才不會被擠得很矮）；手機版：分頁列已經寫了是哪一邊，只留搜尋 */
.head-row { flex-wrap: nowrap; gap: 8px; }
.head-row h3 { flex: none; white-space: nowrap; }
.cols.swipe .head-row > h3.head { display: none; }
.bar-left { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-width: 0; flex: 1; }
.chips { gap: 4px; }
.chips button.active { border-color: var(--accent); color: var(--accent); }
/* 電腦版：下面還有購物車，清單矮一點；手機版購物車是另一個分頁 */
.list { display: grid; gap: 6px; margin: 0; max-height: max(260px, calc(100vh - 430px)); overflow-y: auto; padding-right: 2px; align-content: start; }
.cols.swipe .list { max-height: calc(100vh - 350px); }
.shop-dialog.cart-peek .cols:not(.swipe) .list { max-height: max(240px, calc(100vh - 560px)); }
.shop-dialog.cart-open .cols:not(.swipe) .list { max-height: max(200px, calc(100vh - 690px)); }
/* 手機：清單自己會捲，橫滑要留給分頁切換（不然瀏覽器把橫滑當成清單的捲動） */
.cols.swipe .list { touch-action: pan-y; }
.specials { margin-bottom: 6px; }
.tools { flex-wrap: nowrap; }
.search { min-width: 0; }
/* 一般商品：一列一件，約 44px 高 */
.rows { display: grid; gap: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); }
.item-row { padding: 0; border-bottom: 1px solid var(--border); }
.item-row:last-child { border-bottom: none; }
.item-row.open { background: #c99a4510; }
.item-row .line { display: grid; grid-template-columns: var(--shop-cols); gap: 6px; align-items: center; min-height: 40px; padding: 3px 8px; cursor: pointer; }
.item-row .line:hover { background: #c99a450a; }
/* 特別交易：價錢（可能是東西或時數，照寫）、庫存、買下與交涉 */
.item-row .line.special-line { grid-template-columns: 30px minmax(0, 1fr) auto auto; gap: 8px; }
.item-row.dim .line { opacity: 0.55; }
/* 一般商品與行囊的欄位：圖示、物品（名稱後面是 ×數量）、類別、價格、« ‹ › »、購物車；表頭用同一組（固定寬度，表頭與每一列才對得齊） */
.shop-dialog { --shop-cols: 30px minmax(0, 1fr) 76px 56px 114px 38px; }
.thead { display: grid; grid-template-columns: var(--shop-cols); gap: 6px; padding: 0 9px 3px; border-bottom: 1px solid var(--border); }
.thead .r { text-align: right; }
.cat { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.what .sub { display: none; }
.steps { display: inline-flex; gap: 2px; justify-content: flex-end; }
.steps button { width: 26px; height: 26px; padding: 0; line-height: 1; }
.no { grid-column: 6 / -1; text-align: right; white-space: nowrap; }
/* 行囊：沒有類別欄（類別在分組標題與點開的詳情），名稱欄寬一點 */
.bag-pane { --shop-cols: 30px minmax(0, 1fr) 56px 114px 38px; }
.bag-pane .no { grid-column: 5 / -1; }
/* 很長的名字換行，不截成「…」 */
.bag-pane .what:not(.marquee) { white-space: normal; overflow-wrap: anywhere; }
/* 手機：圖示、名稱（類別小字在名稱下面）、價錢一排；庫存、按鈕、購物車換到下一排 */
@media (max-width: 720px) {
  .shop-dialog, .bag-pane { --shop-cols: 30px minmax(0, 1fr) auto; }
  .thead .c, .thead > span:nth-child(n + 5), .bag-pane .thead > span:nth-child(n + 4), .item-row .line .cat { display: none; }
  .what .sub { display: block; margin: 0; }
  .item-row .line .steps { grid-column: 2 / -1; grid-row: 2; justify-self: end; margin-right: 44px; }
  .item-row .line .incart { grid-column: 3; grid-row: 2; }
  .item-row .line .no, .bag-pane .item-row .line .no { grid-column: 2 / -1; grid-row: 2; }
  .item-row .line.special-line { grid-template-columns: 30px minmax(0, 1fr) auto; row-gap: 2px; }
  .item-row .line.special-line .btns { grid-column: 2 / -1; flex-wrap: wrap; }
}
.what { min-width: 0; }
/* 名稱、類別、行情、效果放不下時截斷成「…」（不跑馬燈；點一下展開看完整說明） */
.what .what-in { display: inline; white-space: nowrap; }
.what .what-in > * + * { margin-left: 6px; }
/* 名稱放得下就完整顯示，放不下才截斷 */
.what .nm { display: inline; }
.what:not(.marquee) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.what .qty { margin-left: 4px; }
.btns { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; }
.btns .num { width: 52px; height: 28px; padding: 2px 6px; }
/* 購物車裡有幾個：最右邊固定寬度的一欄 */
.incart { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; color: var(--accent); font-weight: 600; white-space: nowrap; }
/* 減號與加號連成一組 */
.stepper { display: inline-flex; }
.stepper button { border-radius: 0; padding: 2px 8px; }
.stepper button:first-child { border-top-left-radius: var(--radius); border-bottom-left-radius: var(--radius); }
.stepper button:last-child { border-top-right-radius: var(--radius); border-bottom-right-radius: var(--radius); margin-left: -1px; }
.all { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.item-row .more { display: grid; gap: 2px; padding: 0 10px 6px 46px; }
.item-row .haggle { padding: 0 8px 6px 46px; }
.group-head { display: flex; gap: 6px; align-items: center; padding: 4px 2px 0; color: var(--accent-2); font-weight: 700; }
button.group-head { border: none; background: none; justify-content: flex-start; width: 100%; text-align: left; cursor: pointer; }
.list > .group-head { padding-top: 6px; }
.grow { flex: 1; min-width: 0; }
.price { font-weight: 600; white-space: nowrap; text-align: right; }
.price.up { color: var(--danger); }
.price.down { color: var(--good, #3d7a3a); }
.qty { font-weight: 600; color: var(--accent-2); }
.effect { color: var(--accent); }
.num { width: 58px; }
.glut { color: var(--danger); font-size: 0.78rem; }
</style>
