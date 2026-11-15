<script setup lang="ts">
import { computed, ref } from 'vue'
import { craftRules } from '@/engine/data'
import { CRAFT_IDS, crafters, rentShopName, skillOf, xpToNext } from '@/engine/crafting'
import { useGame } from '@/stores/game'
import CraftPanel from './CraftPanel.vue'
import RecipePanel from './RecipePanel.vue'
import BlueprintPanel from './craft/BlueprintPanel.vue'
import { baseType, gearRules } from '@/engine/gear'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'

// 工藝：隊伍的七種工藝等級；兩個分頁：打造裝備、製作物品（依配方製作與自創配方）。誰來做在分頁旁邊選，兩邊共用（docs/CRAFTING.md）
const emit = defineEmits<{ close: [] }>()
const game = useGame()
const s = computed(() => game.state!)
const who = computed(() => crafters(s.value))
const MEMO = 'elondia.craftTab'
type Tab = 'gear' | 'item' | 'blueprint'
function recallTab(): Tab {
  try {
    const v = localStorage.getItem(MEMO)
    return v === 'gear' || v === 'blueprint' ? v : 'item'
  } catch {
    return 'item'
  }
}
const tab = ref<Tab>(recallTab())
function pickTab(t: Tab) {
  tab.value = t
  try {
    localStorage.setItem(MEMO, t)
  } catch {
    // 瀏覽器不給存：只是下次不記得
  }
}
const crafterId = ref('pc')
const blueprintCount = computed(() => (s.value.blueprints ?? []).length)
/** 已有圖紙：點一張就到打造裝備、選好那個底材（打造裝備從瀏覽器記的選擇開始，CraftPanel 的 elondia.craftPick） */
function openBlueprint(base: string) {
  const b = gearRules.bases[base]
  if (!b) return
  try {
    localStorage.setItem('elondia.craftPick', JSON.stringify({ slot: b.slot, type: baseType(base), base }))
  } catch {
    // 瀏覽器不給存：打造裝備從上次的選擇開始
  }
  pickTab('gear')
}
// 租工坊的店：同一家店的工藝放在一起（鍛造、木工：鐵匠鋪……）
const rentShops = computed(() => {
  const by = new Map<string, string[]>()
  for (const c of CRAFT_IDS) by.set(rentShopName(c), [...(by.get(rentShopName(c)) ?? []), craftRules.skills[c].name])
  return [...by].map(([shop, names]) => `${names.join('、')}：${shop}`).join('；')
})
</script>

<template>
  <div class="crafts">
    <div class="table">
      <table class="small">
        <thead>
          <tr><th></th><th v-for="c in CRAFT_IDS" :key="c">{{ craftRules.skills[c].name }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="w in who" :key="w.member.id" :class="{ off: !!w.refusal }">
            <th :title="w.refusal">{{ w.member.name }}<span v-if="w.refusal" class="muted">（{{ w.refusal }}）</span></th>
            <td v-for="c in CRAFT_IDS" :key="c">
              Lv.{{ skillOf(w.member, c).level }}
              <span v-if="xpToNext(skillOf(w.member, c).level)" class="muted">{{ skillOf(w.member, c).xp }}/{{ xpToNext(skillOf(w.member, c).level) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="topbar">
      <div class="tabs">
        <button :class="{ active: tab === 'gear' }" @click="pickTab('gear')"><GameIcon name="tools" :size="14" /> 打造裝備</button>
        <button :class="{ active: tab === 'item' }" @click="pickTab('item')"><GameIcon name="scroll" :size="14" /> 製作物品</button>
        <button :class="{ active: tab === 'blueprint' }" @click="pickTab('blueprint')"><GameIcon name="scroll" :size="14" /> 已有圖紙 <span class="muted">{{ blueprintCount }}</span></button>
        <Hint :text="`裝備材料：工藝等級 N 可以處理第 N 級以下的材料（鍛造、木工、製革、裁縫、珠寶）。\n工具：第 1～2 級用隨身工具組（任何地方）；第 3 級要工坊：在旅店、安全房、自己的房子展開攜帶式工坊，或站到地圖上對應的店的格子再打開工藝，就會租用店裡的工坊（每小時 ${craftRules.workshop_rent.per_hour_cc} 白鸛，自己的工具夠用時不租）。\n租工坊的店：${rentShops}。\n第 4～5 級要自己房子裡的工作台。\n夥伴要自願加入而且親密度 ${craftRules.companion.min_affinity} 以上、或是你的奴隸才肯幫忙；在自己的房子裡，留守的夥伴也能幫忙。`" />
      </div>
      <label class="who">誰來做
        <select v-model="crafterId">
          <option v-for="w in who" :key="w.member.id" :value="w.member.id" :disabled="!!w.refusal">{{ w.member.name }}{{ w.refusal ? `（${w.refusal}）` : '' }}</option>
        </select>
      </label>
    </div>
    <RecipePanel v-if="tab === 'item'" :crafter-id="crafterId" @started="emit('close')" />
    <BlueprintPanel v-else-if="tab === 'blueprint'" @open="openBlueprint" />
    <CraftPanel v-else mode="make" :crafter-id="crafterId" @started="emit('close')" />
  </div>
</template>

<style scoped>
.crafts { display: grid; gap: 8px; }
.table { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; width: 100%; }
.topbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.tabs { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.tabs button { padding: 4px 14px; }
.tabs .active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); font-weight: 600; }
.who { display: flex; gap: 6px; align-items: center; }
th, td { padding: 3px 6px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
tr.off { opacity: 0.55; }
p { margin: 0; }
</style>
