<script setup lang="ts">
import { computed, ref } from 'vue'
import { craftRules, genderName, homeRules, itemDef, itemRules, raceName } from '@/engine/data'
import {
  comfortOf, describeHome, furnitureIn, hasBed, homeOfArea, lotHere, lotPrice, ownHomeOfArea, PLACE_NAME, placeOf, residents, stayRefusal,
} from '@/engine/homes'
import { cropStatus, plotPlace, seedsFor } from '@/engine/garden'
import { depositRefusal, storageSlots, storageSpec, storedItems, storedMoney } from '@/engine/storage'
import { formatMoney } from '@/engine/money'
import { childrenAtHome, hasTemple } from '@/engine/children'
import { useGame } from '@/stores/game'
import FoldMenu from './ui/FoldMenu.vue'
import NameTag from './NameTag.vue'
import GameIcon from './ui/GameIcon.vue'
import MasterWaiting from './party/MasterWaiting.vue'
import { rosterWaiting } from '@/engine/masterRoster'
import Hint from './ui/Hint.vue'

// 房子（docs/HOMES.md）：站在待售的空地上可以買；在自己的房子裡擺家具、讓夥伴留守或帶上
const game = useGame()
const s = computed(() => game.state!)
const area = computed(() => game.area)
const cell = computed(() => game.cell)

// ---- 待售的空地 ----
const lot = computed(() => lotHere(s.value, area.value, cell.value))
const lotDef = computed(() => (lot.value ? homeRules.districts[lot.value.district] : undefined))
const price = computed(() => (lot.value ? lotPrice(s.value, lot.value) : 0))
const newName = ref('')
function buy() {
  if (!lot.value || !confirm(`用 ${formatMoney(price.value)} 買下這棟${lotDef.value!.name}？`)) return
  game.buyHome(lot.value.id, newName.value)
  newName.value = ''
}

// ---- 主人的家（主角是奴隸時，見 docs/COMPANIONS.md 第 3.4 節） ----
const masterHome = computed(() => {
  const h = homeOfArea(s.value, area.value)
  return h?.master ? h : undefined
})
// 主人留在家裡的隊員：向主人提議帶上（masterRoster.ts）
const masterWaiting = computed(() => (masterHome.value ? rosterWaiting(s.value).filter((w) => w.place === 'home') : []))

// ---- 自己的房子 ----
const home = computed(() => ownHomeOfArea(s.value, area.value))
const place = computed(() => placeOf(area.value, cell.value))
const choices = computed(() => s.value.inventory.filter((i) => {
  const f = itemDef(i.name)?.furniture
  return i.qty > 0 && !!f && !!place.value && f.places.includes(place.value)
}))
const pick = ref('')
const all = computed(() => (home.value ? furnitureIn(home.value) : []))
const comfort = computed(() => (home.value ? comfortOf(home.value) : 0))
const benches = computed(() => all.value.filter((f) => itemDef(f.name)?.furniture?.function === 'workbench').map((f) => `${f.name}（${craftRules.skills[itemDef(f.name)!.furniture!.craft!].name}）`))
const staying = computed(() => (home.value ? residents(s.value, home.value.id) : []))
const companions = computed(() => s.value.party.filter((m) => !m.isPlayer))
// 住在家裡的嬰兒（docs/FAMILY.md 第 7.3 節）
const kids = computed(() => (home.value ? childrenAtHome(s.value, home.value.id) : []))
const templeHere = computed(() => (home.value ? hasTemple(home.value.location) : false))
const floorName = (key: string) => home.value?.areas[key]?.name.split('・').at(-1) ?? ''

// 苗圃：播種、收成、拔掉
const plot = computed(() => (home.value ? plotPlace(area.value, cell.value) : undefined))
const crop = computed(() => cropStatus(s.value, cell.value))
const seeds = computed(() => seedsFor(s.value, area.value, cell.value))
const seedPick = ref('')
const plots = computed(() => {
  if (!home.value) return { total: 0, ripe: 0 }
  const cells = Object.values(home.value.areas).flatMap((a) => a.cells.filter((c) => plotPlace(a, c)))
  return { total: cells.length, ripe: cells.filter((c) => cropStatus(s.value, c)?.ready).length }
})
const waitText = (h: number) => (h >= 24 ? `約 ${Math.ceil(h / 24)} 天` : `${h} 小時`)
function plantIt() {
  if (!seedPick.value) return
  game.plant(seedPick.value)
  seedPick.value = ''
}
function uprootIt() {
  if (crop.value && confirm(`拔掉還沒成熟的${crop.value.seed}？種子不會退回。`)) game.uproot()
}

// 儲物箱：站在箱子上存取（不花時間）
const chest = computed(() => (home.value && (storageSpec(cell.value) || storedItems(cell.value).length || storedMoney(cell.value)) ? cell.value : undefined))
const chestSpec = computed(() => storageSpec(chest.value))
const boxItems = computed(() => storedItems(chest.value))
const boxQty = ref<number | ''>('')
const boxCat = ref('')
const categories = computed(() => Object.entries(itemRules.categories).filter(([id]) => s.value.inventory.some((i) => i.qty > 0 && itemDef(i.name)?.category === id)))
const bagItems = computed(() => s.value.inventory.filter((i) => i.qty > 0 && (!boxCat.value || itemDef(i.name)?.category === boxCat.value)))
const refusal = (name: string) => (chest.value ? depositRefusal(s.value, chest.value, name) : undefined)
const sameCount = computed(() => s.value.inventory.filter((i) => i.qty > 0 && boxItems.value.some((b) => b.name === i.name)).length)
const qtyArg = () => (typeof boxQty.value === 'number' && boxQty.value > 0 ? boxQty.value : undefined)
const money = ref<number | ''>('')
function moveMoney(dir: 'in' | 'out') {
  if (typeof money.value !== 'number' || money.value <= 0) return
  if (dir === 'in') game.depositMoney(money.value)
  else game.withdrawMoney(money.value)
  money.value = ''
}

function placeIt() {
  if (!pick.value) return
  game.placeFurniture(pick.value)
  pick.value = ''
}
function rename() {
  const n = prompt('房子的名字', home.value?.name)
  if (n && home.value) game.renameHome(home.value.id, n)
}
</script>

<template>
  <section v-if="lot && lotDef" class="panel home small">
    <h3 class="title">
      <GameIcon name="pin" :size="16" />待售的房子
      <Hint text="買下後可以擺家具（床讓你在家長休、高階工作台讓你做第四、五級的工藝），也能讓夥伴留在家裡看家（不算離隊，不佔隊伍人數）。" />
    </h3>
    <p>{{ lotDef.name }}：{{ describeHome(lot) }}，每層 {{ lotDef.size[0] - 2 }} × {{ lotDef.size[1] - 2 }} 格，隔成 {{ lotDef.rooms[0] }}～{{ lotDef.rooms[1] }} 間。</p>
    <div class="row">
      <input v-model="newName" maxlength="16" placeholder="房子的名字（選填）" />
      <button class="primary small" :disabled="s.money_cc < price" @click="buy">買下（{{ formatMoney(price) }}）</button>
    </div>
  </section>

  <section v-else-if="masterHome" class="panel home small">
    <h3 class="title">
      <GameIcon name="building" :size="16" />{{ masterHome.name }}
      <Hint text="這是主人的家：可以在這裡長休（睡在下人房），也可以和主人談判；不能擺家具，也不能自己讓人留下。主人的奴隸可以向主人提議留在家裡（隊伍卡片的「向主人提議」），之後在這裡提議帶上。出門前要主人同意（主動行動）。" />
    </h3>
    <p class="muted">{{ area.name.split('・').at(-1) }}・{{ describeHome(masterHome) }}。</p>
    <template v-if="masterWaiting.length">
      <h4 class="sub">主人留在家裡的隊員</h4>
      <MasterWaiting place="home" />
    </template>
  </section>

  <section v-else-if="home" class="panel home small">
    <div class="row head">
      <h3 class="title"><GameIcon name="home" :size="16" />{{ home.name }}</h3>
      <button class="small ghost" title="改名" aria-label="改名" @click="rename"><GameIcon name="edit" :size="14" /></button>
    </div>
    <p class="muted">{{ area.name.split('・').at(-1) }}・舒適度 {{ comfort }}／{{ homeRules.comfort_rested }}<template v-if="comfort >= homeRules.comfort_rested">（在家長休會睡得香甜）</template>・{{ hasBed(home) ? '有床，可以在家長休' : '還沒有床' }}<template v-if="benches.length">・工作台：{{ benches.join('、') }}</template><template v-if="plots.total">・苗圃 {{ plots.total }} 塊<template v-if="plots.ripe">（{{ plots.ripe }} 塊可以收成）</template></template></p>

    <div class="spot">
      <template v-if="cell.furniture">
        <span>這一格：{{ itemDef(cell.furniture)?.furniture?.icon ?? '🪑' }} {{ cell.furniture }}</span>
        <button v-if="!cell.crop && !chest?.storage" class="small" @click="game.takeFurniture()">收起</button>
      </template>
      <template v-else-if="place">
        <span>這一格（{{ PLACE_NAME[place] }}）是空的</span>
        <template v-if="choices.length">
          <select v-model="pick">
            <option value="">擺放家具…</option>
            <option v-for="c in choices" :key="c.name" :value="c.name">{{ itemDef(c.name)?.furniture?.icon }} {{ c.name }}（{{ c.qty }}）</option>
          </select>
          <button class="small" :disabled="!pick" @click="placeIt">擺放</button>
        </template>
        <span v-else class="muted">行囊裡沒有能放在{{ PLACE_NAME[place] }}的家具（雜貨店、鐵匠鋪、裁縫店、珠寶店有賣）。</span>
      </template>
      <span v-else class="muted">站在空的地板或院子上可以擺家具。</span>
    </div>

    <div v-if="chest" class="spot chest">
      <div class="row head">
        <b>{{ chestSpec ? `${chestSpec.icon ?? '📦'} ${chest.furniture}` : '箱子' }}</b>
        <span class="muted small">放了 {{ boxItems.length }}／{{ storageSlots(chest) }} 種<template v-if="chestSpec?.money">・存款 {{ formatMoney(storedMoney(chest)) }}</template></span>
        <Hint text="存進去、拿出來不花時間。每個箱子能放的種類有限，同一種的數量不限；情報要帶在身上才讀得到，不能放進箱子。在這棟房子裡做工藝、播種時，箱子裡的材料與種子也算。箱子裡還有東西時不能收起。" />
      </div>
      <div v-if="chestSpec?.money || storedMoney(chest)" class="row">
        <input v-model.number="money" type="number" min="1" placeholder="金額（白鸛）" />
        <button v-if="chestSpec?.money" class="small" :disabled="!money || money > s.money_cc" @click="moveMoney('in')">存錢</button>
        <button class="small" :disabled="!money || money > storedMoney(chest)" @click="moveMoney('out')">領錢</button>
        <span class="muted small">存在保險箱的錢戰敗時不會損失</span>
      </div>
      <div class="row">
        <label class="small">數量 <input v-model.number="boxQty" type="number" min="1" placeholder="全部" class="qty" /></label>
        <button class="small" :disabled="!sameCount" :title="sameCount ? '' : '行囊裡沒有箱子裡已經有的東西'" @click="game.depositMany({ same: true })">同樣的東西全部放進去</button>
        <select v-model="boxCat">
          <option value="">行囊：全部分類</option>
          <option v-for="[id, n] in categories" :key="id" :value="id">{{ n }}</option>
        </select>
        <button v-if="boxCat && chestSpec" class="small" @click="game.depositMany({ category: boxCat })">這一類全部放進去</button>
      </div>
      <div class="cols">
        <div>
          <h4 class="sub">箱子裡</h4>
          <ul class="plain">
            <li v-for="i in boxItems" :key="i.name" class="row">
              <span>{{ i.name }} ×{{ i.qty }}</span>
              <button class="small" @click="game.withdraw(i.name, qtyArg())">拿出來</button>
            </li>
            <li v-if="!boxItems.length" class="muted">空的。</li>
          </ul>
        </div>
        <div v-if="chestSpec">
          <h4 class="sub">行囊</h4>
          <ul class="plain">
            <li v-for="i in bagItems" :key="i.name" class="row">
              <span>{{ i.name }} ×{{ i.qty }}</span>
              <button class="small" :disabled="!!refusal(i.name)" :title="refusal(i.name)" @click="game.deposit(i.name, qtyArg())">放進去</button>
            </li>
            <li v-if="!bagItems.length" class="muted">沒有東西。</li>
          </ul>
        </div>
      </div>
    </div>

    <div v-if="plot" class="spot">
      <template v-if="crop">
        <span>{{ crop.ready ? '🌾' : '🌿' }} {{ crop.seed }}（會長出{{ crop.spec.yields.join('或') }}）：{{ crop.ready ? '可以收成了' : `還要${waitText(crop.hoursLeft)}` }}</span>
        <button v-if="crop.ready" class="primary small" @click="game.harvest()">收成</button>
        <button v-else class="small" @click="uprootIt">拔掉</button>
      </template>
      <template v-else-if="seeds.length">
        <select v-model="seedPick">
          <option value="">播種…</option>
          <option v-for="sd in seeds" :key="sd.name" :value="sd.name">{{ sd.name }}（{{ sd.qty }}）</option>
        </select>
        <button class="small" :disabled="!seedPick" @click="plantIt">播種</button>
      </template>
      <span v-else class="muted">行囊裡沒有能種在{{ PLACE_NAME[plot] }}苗圃的種子（雜貨店、神殿、魔法物品店有賣）。</span>
    </div>

    <FoldMenu id="home.people" icon="users" label="看家的夥伴" detail="留守的夥伴不佔隊伍人數，也能幫忙做工藝" :badge="staying.length" open>
      <p class="small muted">留守不算離隊 <Hint text="留守不算離隊：羈絆、契約、親密度都保留，不佔隊伍人數，也不參加戰鬥。有工作台時，留在家裡的夥伴也能幫忙做工藝。" /></p>
      <ul class="plain">
        <li v-for="m in staying" :key="m.id" class="row">
          <NameTag :id="m.id" />
          <button class="small" @click="game.requireRoom(1, `帶上${m.name}`, () => game.takeResident(m.id))">帶上</button>
        </li>
        <li v-if="!staying.length" class="muted">沒有人留在家裡。</li>
      </ul>
      <ul v-if="companions.length" class="plain">
        <li v-for="m in companions" :key="m.id" class="row">
          <NameTag :id="m.id" />
          <button class="small" :disabled="!!stayRefusal(m)" :title="stayRefusal(m)" @click="game.stayHome(m.id)">留在家裡</button>
        </li>
      </ul>
    </FoldMenu>

    <FoldMenu v-if="kids.length" id="home.kids" icon="heart" label="孩子" detail="住在家裡的嬰兒（不用寄養費，不一定要有搖籃）" :badge="kids.length" open>
      <ul class="plain">
        <li v-for="k in kids" :key="k.id" class="row">
          <span>🍼 {{ k.name }} <span class="muted">（{{ genderName(k.gender) }}・{{ raceName(k.race) }}・{{ s.time.day - k.born }} 天大・母親{{ k.mother.name }}・父親{{ k.father?.name ?? '不明' }}）</span></span>
          <span class="row">
            <button class="small" @click="game.visitChild(k.id)">抱抱</button>
            <button class="small" :disabled="!templeHere" :title="templeHere ? '' : '這座城沒有神殿'" @click="game.moveChild(k.id, { kind: 'temple', location: home.location })">送去育幼院</button>
          </span>
        </li>
      </ul>
    </FoldMenu>

    <FoldMenu id="home.furniture" icon="sofa" label="家具" detail="擺在這棟房子裡的家具" :badge="all.length">
      <ul class="plain">
        <li v-for="f in all" :key="`${f.area}:${f.x},${f.y}`">{{ itemDef(f.name)?.furniture?.icon }} {{ f.name }} <span class="muted">（{{ floorName(f.area) }}<template v-if="f.stored">・放了 {{ f.stored }} 種</template>）</span></li>
        <li v-if="!all.length" class="muted">還沒有家具。</li>
      </ul>
    </FoldMenu>
  </section>
</template>

<style scoped>
.home { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.home p { margin: 0; }
.head { justify-content: space-between; }
.head h3 { margin: 0; }
.title { display: flex; align-items: center; gap: 6px; }
.title :deep(.game-icon) { color: var(--accent); }
.spot { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px; border: 1px dashed var(--border); border-radius: 6px; }
.home ul { margin: 0; }
.home li.row { justify-content: space-between; }
.chest { display: grid; gap: 6px; }
.chest .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.chest .cols ul { max-height: 220px; overflow-y: auto; }
.chest .qty { width: 5em; }
.chest .sub { margin: 0 0 2px; }
</style>
