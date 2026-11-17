<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { attrName, craftRules, itemDef, type CraftId } from '@/engine/data'
import { CRAFT_IDS, crafters, skillOf, toolTierFor, toolTierName, toolWhere } from '@/engine/crafting'
import { currentCell } from '@/engine/grid'
import { formatMoney } from '@/engine/money'
import { producedQty, produceTarget, recipeItems, recipePlan } from '@/engine/recipes'
import { shopTypeForCell } from '@/engine/trade'
import { parseUse, useGame } from '@/stores/game'
import { inventCategories } from '@/engine/invention'
import { isMobile } from './mobile/mobile'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'
import ItemIcon from './items/ItemIcon.vue'
import InventPanel from './InventPanel.vue'
import CraftCard, { type CardOutcome, type CardReq } from './craft/CraftCard.vue'
import { itemEffect, itemText } from './items/itemInfo'

// 製作物品：依配方製作（物品的 recipe，crafts.json 的 recipe；docs/CRAFTING.md 第 6 節）與自創配方（第 7 節）。
// 工藝 → 類別 → 配方卡片（最後一張是自創）；做的人擲工藝的屬性檢定加工藝等級；不夠的材料可以向站的這間店當場補買
const props = withDefaults(defineProps<{ crafterId?: string }>(), { crafterId: 'pc' })
const emit = defineEmits<{ started: [] }>()
const game = useGame()
const s = computed(() => game.state!)

// 站在店裡時先備好今天的商品清單（當場補買要看這裡賣什麼）
onMounted(() => {
  const type = shopTypeForCell(currentCell(s.value).kind)
  if (type) game.shopState(type)
})

const crafter = computed(() => crafters(s.value).find((w) => w.member.id === props.crafterId && !w.refusal)?.member ?? s.value.party.find((m) => m.isPlayer)!)

const CATEGORY_NAME: Record<string, string> = { consumable: '藥劑與消耗品', food: '料理', furniture: '家具', gear: '工具', material: '材料' }
const categoryOf = (name: string) => itemDef(name)?.category ?? s.value.customItems?.[name]?.category ?? 'consumable'
const catName = (c: string) => CATEGORY_NAME[c] ?? c

// 上次選的工藝與類別記在瀏覽器裡
const MEMO = 'elondia.recipePick'
function recall(): { craft?: string; cat?: string; ready?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(MEMO) ?? '{}') as { craft?: string; cat?: string; ready?: boolean }
  } catch {
    return {}
  }
}
const memo = recall()
const buy = ref(true)
const batches = ref(1)
const all = computed(() => recipeItems().map((r) => ({ ...r, cat: categoryOf(r.name), plan: recipePlan(s.value, r.name, 1, crafter.value, { buy: buy.value }) })))
const crafts = computed(() => CRAFT_IDS.filter((c) => all.value.some((r) => r.recipe.craft === c)))
const craftPick = ref<string>(memo.craft ?? '')
const craft = computed<CraftId>(() => (crafts.value.includes(craftPick.value as CraftId) ? craftPick.value as CraftId : crafts.value[0]!))
const inCraft = computed(() => all.value.filter((r) => r.recipe.craft === craft.value))
const cats = computed(() => [...new Set(inCraft.value.map((r) => r.cat))])
const catPick = ref(memo.cat ?? '')
const cat = computed(() => (cats.value.includes(catPick.value) ? catPick.value : ''))
const onlyReady = ref(!!memo.ready)
watch([craft, cat, onlyReady], ([a, b, c]) => {
  try {
    localStorage.setItem(MEMO, JSON.stringify({ craft: a, cat: b, ready: c }))
  } catch {
    // 瀏覽器不給存：只是下次不記得
  }
})
function pickCraft(c: CraftId) {
  craftPick.value = c
  catPick.value = ''
}

// 搜尋：配方或成品的名字、類別
const query = ref('')
const rows = computed(() => {
  const q = query.value.trim()
  return (q ? all.value.filter((r) => textHas(r.name, q) || textHas(catName(r.cat), q)) : inCraft.value.filter((r) => !cat.value || r.cat === cat.value))
    .filter((r) => !onlyReady.value || !r.plan.blocked)
    .sort((a, b) => a.recipe.level - b.recipe.level || CRAFT_IDS.indexOf(a.recipe.craft) - CRAFT_IDS.indexOf(b.recipe.craft) || a.name.localeCompare(b.name))
})
/** 卡片上的狀態 */
function status(r: (typeof all.value)[number]): { ok: boolean; text: string } {
  if (r.plan.blocked) return { ok: false, text: r.plan.blockers[0]!.replace(/（.*$/, '') }
  return { ok: true, text: r.plan.buyCost ? `要補買 ${formatMoney(r.plan.buyCost)}` : '做得出來' }
}

// 自創配方：配方清單最後一張卡片（這種工藝能自創時；搜尋時不列）
const INVENT = '\u0000invent'
const canInvent = computed(() => !query.value.trim() && inventCategories(craft.value).length > 0)
const picked = ref('')
// 手機版：成品卡在整串配方下面，點了卡片就捲過去
const detail = ref<HTMLElement>()
function pick(n: string) {
  picked.value = n
  if (isMobile.value) void nextTick(() => detail.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}
const inventing = computed(() => canInvent.value && (picked.value === INVENT || !rows.value.length))
const name = computed(() => (inventing.value ? '' : rows.value.some((r) => r.name === picked.value) ? picked.value : (rows.value.find((r) => !r.plan.blocked) ?? rows.value[0])?.name ?? ''))
const plan = computed(() => (name.value ? recipePlan(s.value, name.value, batches.value, crafter.value, { buy: buy.value }) : undefined))
const skill = computed(() => (plan.value ? craftRules.skills[plan.value.recipe.craft] : undefined))
const sold = computed(() => plan.value?.inputs.some((x) => x.offer) ?? false)

// ---- 成品卡 ----
const outcomes = computed<CardOutcome[]>(() => {
  const p = plan.value
  if (!p) return []
  const paid = p.fee ? '，花費照付' : ''
  return [
    { degree: 'critical', text: `${producedQty(p.qty, 'critical')} 份` },
    { degree: 'success', text: `${p.qty} 份` },
    { degree: 'partial', text: `${producedQty(p.qty, 'partial')} 份` },
    { degree: 'fail', text: `沒做成，材料損失一半${paid}` },
    { degree: 'fumble', text: `搞砸了，材料全部損失${paid}` },
  ]
})
const reqs = computed<CardReq[]>(() => {
  const p = plan.value
  if (!p || !skill.value) return []
  const need = toolTierFor(p.recipe.level)
  const missing = p.inputs.some((x) => x.have + x.buy < x.need)
  const buying = p.inputs.some((x) => x.buy > 0)
  const cost = p.fee + p.buyCost
  return [
    { state: p.level >= p.recipe.level ? 'ok' : 'no', label: '工藝', text: `${crafter.value.name} ${skill.value.name} Lv.${p.level}（要 Lv.${p.recipe.level}）` },
    { state: p.tool.tier >= need ? 'ok' : 'no', label: '工具', text: `要${toolTierName(need)}・現在 ${p.tool.source}` },
    { state: missing ? 'no' : buying ? 'warn' : 'ok', label: '材料', text: !p.inputs.length ? '不需要' : missing ? '不夠' : buying ? '缺的當場補買' : '夠用' },
    { state: s.value.money_cc >= cost ? 'ok' : 'no', label: '錢', text: `要 ${formatMoney(cost)}・持有 ${formatMoney(s.value.money_cc)}` },
  ]
})
const costs = computed<[string, number][]>(() => (plan.value ? [['耗材費（瓶子、溶劑等）', plan.value.cost], ['工坊租金', plan.value.rent], ['補買', plan.value.buyCost]] : []))
const text = ref('')
const use = ref('')

function rename() {
  const from = plan.value?.name
  if (!from) return
  const to = prompt('自創物品的名字（配方也跟著改）', from)
  if (!to || to.trim() === from) return
  const n = game.renameInvention(from, to)
  if (n) picked.value = n
}

function forget() {
  if (plan.value && confirm(`忘記「${plan.value.name}」的配方？做好的成品會留著，但之後不能再做。`)) game.forgetInvention(plan.value.name)
}

function produce() {
  if (!plan.value) return
  const u = parseUse(use.value)
  void game.perform({ kind: 'produce', target: produceTarget(crafter.value.id, name.value, plan.value.batches, { buy: buy.value }), text: text.value, ...(u ? { use: u } : {}) })
  text.value = ''
  use.value = ''
  emit('started')
}
</script>

<template>
  <div class="recipes small">
    <div class="step">
      <span class="lab">搜尋</span>
      <input v-model="query" class="search" placeholder="找配方或成品，例如「藥劑」「床」" />
    </div>
    <template v-if="!query.trim()">
      <div class="step">
        <span class="lab">工藝</span>
        <div class="chips">
          <button v-for="c in crafts" :key="c" class="small" :class="{ primary: craft === c }" @click="pickCraft(c)">
            {{ craftRules.skills[c].name }}<span class="n">Lv.{{ skillOf(crafter, c).level }}・{{ all.filter((r) => r.recipe.craft === c).length }}</span>
          </button>
        </div>
      </div>
      <div class="step">
        <span class="lab">類別</span>
        <div class="chips">
          <button class="small" :class="{ primary: !cat }" @click="catPick = ''">全部<span class="n">{{ inCraft.length }}</span></button>
          <button v-for="c in cats" :key="c" class="small" :class="{ primary: cat === c }" @click="catPick = c">{{ catName(c) }}<span class="n">{{ inCraft.filter((r) => r.cat === c).length }}</span></button>
          <button class="small" :class="{ primary: onlyReady }" @click="onlyReady = !onlyReady">只看做得出來的<span class="n">{{ inCraft.filter((r) => !r.plan.blocked).length }}</span></button>
        </div>
      </div>
    </template>
    <div class="step">
      <span class="lab">配方</span>
      <div v-if="rows.length || canInvent" class="cards">
        <button v-for="r in rows" :key="r.name" class="card" :class="{ on: name === r.name, no: !!r.plan.blocked }" @click="pick(r.name)">
          <b>{{ r.invented ? '★ ' : '' }}{{ r.name }}{{ (r.recipe.qty ?? 1) > 1 ? ` ×${r.recipe.qty}` : '' }}</b>
          <span class="muted">{{ query.trim() ? `${craftRules.skills[r.recipe.craft].name}・` : '' }}Lv.{{ r.recipe.level }}・<span :class="status(r).ok ? 'ok' : 'bad'">{{ status(r).text }}</span></span>
          <span class="muted">{{ r.plan.inputs.map((x) => `${x.name} ${Math.min(x.have, x.need)}/${x.need}`).join('、') || '不需要材料' }}</span>
        </button>
        <button v-if="canInvent" class="card new" :class="{ on: inventing }" @click="pick(INVENT)">
          <b><GameIcon name="lightbulb" :size="13" /> 自創{{ craftRules.skills[craft].name }}配方</b>
          <span class="muted">寫下做法，放進材料試做</span>
          <span class="muted">做出來就記成新配方</span>
        </button>
      </div>
      <p v-else class="muted">{{ onlyReady ? '沒有現在做得出來的配方。' : '沒有符合的配方。' }}</p>
    </div>

    <div ref="detail" class="detail">
    <InventPanel v-if="inventing" :craft="craft" :category-hint="cat" :crafter-id="crafter.id" @started="emit('started')" />
    <CraftCard
      v-else-if="plan && skill"
      v-model:count="batches" v-model:wish="text" v-model:use="use"
      :title="plan.name" :tags="[{ text: `${skill.name} Lv.${plan.recipe.level}` }, { text: catName(categoryOf(plan.name)) }, ...(s.inventions?.[plan.name] ? [{ text: '自創', hot: true }] : [])]"
      :outcomes="outcomes" :check="`d20 + 工藝 ${plan.level * craftRules.level_bonus} + ${attrName(skill.attr)}調整值 ÷${craftRules.attr_div}・DC ${plan.dc}`" :reqs="reqs"
      count-label="批數" :count-max="craftRules.recipe.max_batches" count-hint="材料、花費、時間與經驗乘批數，只擲一次。"
      :hours="plan.hours" :costs="costs" :blockers="plan.blockers" :busy="game.judging || !!s.pendingAction"
      :action="`${crafter.isPlayer ? '動手製作' : `請${crafter.name}製作`}（${plan.qty} 份）`" action-icon="scroll"
      wish-placeholder="想怎麼做：例如加一點蜂蜜讓藥比較好入口"
      @go="produce"
    >
      <template #icon><ItemIcon :name="plan.name" :size="30" /></template>
      <template v-if="s.inventions?.[plan.name]" #head-extra>
        <button class="small" @click="rename"><GameIcon name="edit" :size="13" /> 改名</button>
        <button class="small" @click="forget">忘記</button>
      </template>
      <template #result>
        <p v-if="itemEffect(s, plan.name)" class="effect">{{ itemEffect(s, plan.name) }}</p>
        <p v-if="itemText(s, plan.name)" class="desc">{{ itemText(s, plan.name) }}</p>
      </template>
      <template #needs>
        <table v-if="plan.inputs.length" class="mats">
          <thead><tr><th>材料</th><th class="num">需要</th><th class="num">持有</th><th class="num">這裡賣</th><th class="num">當場買</th></tr></thead>
          <tbody>
            <tr v-for="x in plan.inputs" :key="x.name">
              <td>{{ x.name }}</td>
              <td class="num">{{ x.need }}</td>
              <td class="num" :class="{ short: x.have < x.need }" :title="x.home ? `行囊 ${x.have - x.home}、家裡的箱子 ${x.home}` : undefined">{{ x.home ? `${x.have - x.home}＋家裡 ${x.home}` : x.have }}</td>
              <td class="num">{{ x.offer ? `${formatMoney(x.offer.price)}（剩 ${x.offer.stock}）` : '—' }}</td>
              <td class="num">
                <span v-if="x.buy" class="ok">{{ x.buy }} 份</span>
                <span v-else-if="x.have < x.need" class="short">缺 {{ x.need - x.have }}</span>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>
        <label v-if="sold" class="check"><input v-model="buy" type="checkbox" /> 不夠的當場補買（照這間店的售價）</label>
        <p class="muted small-note">工具要{{ toolTierName(toolTierFor(plan.recipe.level)) }} <Hint :text="toolWhere(plan.recipe.craft, toolTierFor(plan.recipe.level))" /></p>
      </template>
    </CraftCard>
    </div>
  </div>
</template>

<style scoped>
.recipes { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.recipes p { margin: 0; }
.detail { scroll-margin-top: 8px; min-width: 0; }
.step { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: start; }
.step > .lab { color: var(--muted); font-weight: 600; padding-top: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .n { margin-left: 4px; font-size: var(--fs-xs); opacity: 0.75; }
.search { width: 100%; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
.card { text-align: left; display: grid; gap: 2px; padding: 6px 9px; }
.card.on { outline: 2px solid var(--accent); outline-offset: -1px; }
.card.no { opacity: 0.6; }
.card.new { border-style: dashed; background: transparent; color: var(--accent); }
.card.new b { display: flex; gap: 4px; align-items: center; }
.card .muted { font-size: var(--fs-xs); }
.ok { color: var(--good); }
.bad, .short { color: var(--danger); }
.effect { color: var(--good); font-weight: 600; }
.desc { color: var(--muted); font-family: var(--font-story); }
.small-note { font-size: var(--fs-xs); display: flex; gap: 4px; align-items: center; }
table { width: 100%; border-collapse: collapse; }
.mats th { text-align: left; font-weight: 600; color: var(--muted); padding: 3px 4px; border-bottom: 1px solid var(--border); }
.mats td { padding: 3px 4px; border-bottom: 1px dashed color-mix(in srgb, currentColor 15%, transparent); }
.mats .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.check { display: flex; gap: 6px; align-items: center; }
@media (max-width: 640px) {
  .step { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .step > .lab { padding-top: 0; }
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
