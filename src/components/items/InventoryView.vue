<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, reactive, ref, watch } from 'vue'
import { itemRules, type ItemCategory } from '@/engine/data'
import { canEquip, canUse, classWeaponBlockFor, isIntelItem } from '@/engine/inventory'
import { formatMoney } from '@/engine/money'
import { itemValue } from '@/engine/trade'
import { useGame } from '@/stores/game'
import { CATEGORY_ORDER, GEAR_KINDS, categoryName, categoryOf, gearKindOf, isSpecialGear, itemEffect, itemEffectParts, itemRarity, itemText, type GearKind } from './itemInfo'
import EffectLine from './EffectLine.vue'
import { materialGroup, materialGroupName, materialGroupOrder, materialRecipesFull, materialTier } from '@/engine/materialInfo'
import ItemIcon from './ItemIcon.vue'
import GameIcon from '../ui/GameIcon.vue'
import { blueprintName } from '@/engine/blueprints'

// 行囊：依類別篩選，使用、裝備（戰鬥以外）
const game = useGame()
const s = computed(() => game.state!)
const inCombat = computed(() => !!s.value.combat)

/** 圖紙（R21）：底材 id，全隊共用、不會用掉 */
const blueprints = computed(() => (s.value.blueprints ?? []).map(blueprintName).sort((a, b) => a.localeCompare(b, 'zh-Hant')))
const filter = ref<ItemCategory | 'all'>('all')
const items = computed(() => s.value.inventory.filter((i) => i.qty > 0))
const counts = computed(() => {
  const out: Partial<Record<ItemCategory, number>> = {}
  for (const i of items.value) {
    const c = categoryOf(s.value, i.name)
    if (c) out[c] = (out[c] ?? 0) + 1
  }
  return out
})
// 裝備的篩選（下拉選單，可以一起用）：部位（武器・盾、防具、飾品……）與能不能賣（「特殊」：獨特裝備，商店不收）
const gearKind = ref<GearKind | ''>('')
const sellable = ref<'' | 'normal' | 'special'>('')
const isGear = computed(() => filter.value === 'equipment')
const kindOk = (name: string, k = gearKind.value) => !k || gearKindOf(s.value, name) === k
const sellOk = (name: string, v = sellable.value) => !v || (v === 'special') === isSpecialGear(s.value, name)
const gearItems = computed(() => (isGear.value ? items.value.filter((i) => categoryOf(s.value, i.name) === 'equipment') : []))
// 每個選項旁的件數：照另一個下拉選單目前的選擇算
const kindCount = (k: GearKind | '') => gearItems.value.filter((i) => kindOk(i.name, k) && sellOk(i.name)).length
const sellCount = (v: '' | 'normal' | 'special') => gearItems.value.filter((i) => sellOk(i.name, v) && kindOk(i.name)).length
watch(filter, () => {
  gearKind.value = ''
  sellable.value = ''
})
// 搜尋與排序
const query = ref('')
const sort = ref<'category' | 'name' | 'value' | 'qty'>('category')
const value = (name: string) => itemValue(s.value, name)
const shown = computed(() => {
  const q = query.value.trim()
  const list = items.value.filter((i) => (filter.value === 'all' || categoryOf(s.value, i.name) === filter.value)
    && (!isGear.value || (kindOk(i.name) && sellOk(i.name)))
    && (!q || textHas(i.name, q) || textHas(itemEffect(s.value, i.name), q)))
  if (sort.value === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  if (sort.value === 'value') return [...list].sort((a, b) => (value(b.name) ?? 0) - (value(a.name) ?? 0))
  if (sort.value === 'qty') return [...list].sort((a, b) => b.qty - a.qty)
  return list
})
// 材料再依小類（貿易類別，materialInfo.ts）分段；照類別排序時，同一段裡等級高的在前
const tierOf = (name: string) => materialTier(s.value, name)?.tier ?? 0
function materialSections(list: typeof items.value, nameOf: (g: ReturnType<typeof materialGroup>) => string) {
  return materialGroupOrder().map((g) => {
    const mine = list.filter((i) => materialGroup(s.value, i.name) === g)
    return { id: `material:${g}`, icon: 'material' as ItemCategory | 'other', name: nameOf(g), items: sort.value === 'category' ? [...mine].sort((a, b) => tierOf(b.name) - tierOf(a.name)) : mine }
  }).filter((x) => x.items.length)
}
// 「全部」依類別分段，每段可以收合；材料的小段預設收合（搜尋時全部展開）
const sections = computed(() => {
  if (filter.value === 'material') return materialSections(shown.value, materialGroupName)
  if (filter.value !== 'all') return [{ id: filter.value, icon: filter.value as ItemCategory | 'other', name: '', items: shown.value }]
  const out = CATEGORY_ORDER.flatMap((c) => {
    const list = shown.value.filter((i) => categoryOf(s.value, i.name) === c)
    if (c === 'material') return materialSections(list, (g) => `${itemRules.categories.material}・${materialGroupName(g)}`)
    return [{ id: c as string, icon: c as ItemCategory | 'other', name: itemRules.categories[c], items: list }]
  })
  out.push({ id: 'other', icon: 'other', name: '其他', items: shown.value.filter((i) => !categoryOf(s.value, i.name)) })
  return out.filter((x) => x.items.length)
})
const folded = reactive(new Set<string>())
const unfoldedMaterials = reactive(new Set<string>())
// 材料的小段預設收起（只看到小類與件數）；其他類別預設展開
const isFolded = (id: string) => filter.value === 'all' && !query.value.trim() && (id.startsWith('material:') ? !unfoldedMaterials.has(id) : folded.has(id))
function fold(id: string) {
  const set = id.startsWith('material:') ? unfoldedMaterials : folded
  if (set.has(id)) set.delete(id)
  else set.add(id)
}
const expanded = ref<string | null>(null)
const target = reactive<Record<string, string>>({})
</script>

<template>
  <div class="inventory">
    <div class="row head">
      <span class="money"><GameIcon name="coins" :size="16" />{{ formatMoney(s.money_cc) }}</span>
      <span class="small muted">共 {{ items.length }} 種物品・全隊共用</span>
    </div>
    <nav class="row tabs">
      <button class="small" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 {{ items.length }}</button>
      <template v-for="c in CATEGORY_ORDER" :key="c">
        <button v-if="counts[c]" class="small" :class="{ active: filter === c }" @click="filter = c">
          <ItemIcon :category="c" :size="14" /> {{ itemRules.categories[c] }} {{ counts[c] }}
        </button>
      </template>
    </nav>
    <div class="row tools">
      <input v-model="query" class="grow" type="search" placeholder="搜尋名稱或效果" />
      <!-- 裝備的篩選：部位、能不能賣（和搜尋、彼此都可以一起用） -->
      <template v-if="isGear">
        <select v-model="gearKind" class="small" aria-label="裝備的部位">
          <option value="">所有部位 {{ kindCount('') }}</option>
          <template v-for="k in GEAR_KINDS" :key="k.id">
            <option v-if="kindCount(k.id)" :value="k.id">{{ k.name }} {{ kindCount(k.id) }}</option>
          </template>
        </select>
        <select v-model="sellable" class="small" aria-label="能不能賣" title="特殊：不能賣給商店的獨特裝備（任務、寶箱、事件給的獨一無二的東西）">
          <option value="">一般與特殊 {{ sellCount('') }}</option>
          <option value="normal">一般（可以賣） {{ sellCount('normal') }}</option>
          <option value="special">特殊（不能賣） {{ sellCount('special') }}</option>
        </select>
      </template>
      <select v-model="sort" class="small" aria-label="排序">
        <option value="category">依類別</option>
        <option value="name">名稱</option>
        <option value="value">價值高到低</option>
        <option value="qty">數量多到少</option>
      </select>
    </div>
    <p v-if="!items.length" class="muted small">空空如也。</p>
    <p v-else-if="!shown.length" class="muted small">沒有符合的物品。</p>
    <section v-for="sec in sections" :key="sec.id" class="sec">
      <button v-if="sec.name" class="sec-head ghost" @click="fold(sec.id)">
        <GameIcon :name="isFolded(sec.id) ? 'right' : 'down'" :size="13" />
        <ItemIcon v-if="sec.icon !== 'other'" :category="sec.icon" :size="14" />{{ sec.name }}<span class="muted small">{{ sec.items.length }}</span>
      </button>
      <ul v-if="!isFolded(sec.id)" class="plain rows unfold">
        <li v-for="i in sec.items" :key="i.name" class="item-row" :class="{ open: expanded === i.name }">
          <div class="line" @click="expanded = expanded === i.name ? null : i.name">
            <span class="item-tile" :class="`r-${itemRarity(s, i.name)}`"><ItemIcon :name="i.name" :size="22" /></span>
            <span class="what">
              <strong>{{ i.name }}</strong>
              <span class="small muted">{{ categoryName(s, i.name) }}</span>
              <span v-if="itemEffect(s, i.name)" class="small effect" :title="materialRecipesFull(i.name) || undefined"><EffectLine :parts="itemEffectParts(s, i.name)" /></span>
            </span>
            <span class="small muted val">{{ value(i.name) !== undefined ? `約 ${formatMoney(value(i.name)!)}` : '' }}</span>
            <span class="qty">×{{ i.qty }}</span>
            <span class="btns" @click.stop>
              <button v-if="isIntelItem(s, i.name)" class="small" :disabled="inCombat" title="記進冒險筆記（和向情報商買情報一樣），用掉這件情報" @click="game.readIntel(i.name)"><GameIcon name="search" :size="13" /> 解讀</button>
              <template v-else-if="canUse(i.name) || canEquip(s, i.name)">
                <select :value="target[i.name] ?? s.party[0]?.id" class="small" aria-label="對象" @change="target[i.name] = ($event.target as HTMLSelectElement).value">
                  <option v-for="m in s.party" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
                <button v-if="canUse(i.name)" class="small" :disabled="inCombat" @click="game.useItem(i.name, target[i.name] ?? s.party[0]!.id)">使用</button>
                <button v-if="canEquip(s, i.name)" class="small" :disabled="inCombat || !!classWeaponBlockFor(s, i.name, target[i.name] ?? s.party[0]!.id)" :title="classWeaponBlockFor(s, i.name, target[i.name] ?? s.party[0]!.id) ? `${classWeaponBlockFor(s, i.name, target[i.name] ?? s.party[0]!.id)}（存檔規則「職業武器限制」）` : undefined" @click="game.equipItem(i.name, target[i.name] ?? s.party[0]!.id)">裝備</button>
              </template>
            </span>
          </div>
          <div v-if="expanded === i.name" class="more small">
            <div v-if="itemEffect(s, i.name)" class="effect"><EffectLine :parts="itemEffectParts(s, i.name)" /></div>
            <div v-if="materialRecipesFull(i.name)" class="effect full">{{ materialRecipesFull(i.name) }}</div>
            <div v-if="itemText(s, i.name)" class="muted">{{ itemText(s, i.name) }}</div>
          </div>
        </li>
      </ul>
    </section>
    <details v-if="blueprints.length" class="small blueprints">
      <summary><GameIcon name="scroll" :size="13" /> 圖紙 {{ blueprints.length }} 張<span class="muted">（自己打造那種底材時不用加 DC，不會用掉）</span></summary>
      <p>{{ blueprints.join('、') }}</p>
    </details>
    <p v-if="inCombat" class="small muted">戰鬥中只能從戰鬥畫面使用道具。</p>
  </div>
</template>

<style scoped>
.money { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.money :deep(.game-icon) { color: var(--accent); }
.inventory { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.head { justify-content: space-between; }
.tabs { gap: 4px; }
.tabs button.active { border-color: var(--accent); color: var(--accent); }
/* 搜尋框佔滿；手機上裝備的兩個下拉選單放不下時換到下一行 */
.tools { flex-wrap: wrap; }
.grow { flex: 1 1 12em; min-width: 0; }
.qty { font-weight: 600; color: var(--accent-2); text-align: right; white-space: nowrap; }
.effect { color: var(--accent); }
.more .effect.full { white-space: pre-line; }
.sec { display: grid; gap: 4px; }
.sec-head { justify-self: start; display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px; border: none; color: var(--accent-2); font-weight: 700; }
/* 一列一件：圖示、名稱、類別、效果摘要、估價、數量、動作；點一下展開描述 */
.rows { display: grid; margin: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); }
.item-row { padding: 0; border-bottom: 1px solid var(--border); }
.item-row:last-child { border-bottom: none; }
.item-row.open { background: #c99a4510; }
.item-row .line { display: grid; grid-template-columns: 30px minmax(0, 1fr) 6.5em 3em 13.5em; gap: 8px; align-items: center; min-height: 40px; padding: 3px 8px; cursor: pointer; }
.item-row .line:hover { background: #c99a450a; }
.what { display: flex; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; }
.what strong { flex-shrink: 0; }
.what .effect { overflow: hidden; text-overflow: ellipsis; }
.val { text-align: right; white-space: nowrap; }
.btns { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; min-width: 0; }
.btns select { height: 28px; padding: 2px 6px; max-width: 9em; }
.item-row .more { display: grid; gap: 2px; padding: 0 10px 6px 46px; }
/* 手機：圖示、名稱、數量一排，估價收起，按鈕換到下一排（不然名稱被擠到看不見） */
@media (max-width: 720px) {
  .item-row .line { grid-template-columns: 30px minmax(0, 1fr) auto; row-gap: 2px; }
  .val { display: none; }
  .btns { grid-column: 2 / -1; flex-wrap: wrap; }
  .btns:empty { display: none; }
  .item-row .more { padding-left: 10px; }
}
</style>
