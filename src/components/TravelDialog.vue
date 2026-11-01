<script setup lang="ts">
// 啟程旅行（對話框）：依地區分頁列出走得到的地點，路線、天數、船資與冒險區域各層的階級；選了就出發、關掉對話框。
import { computed, ref } from 'vue'
import { geography, locationById } from '@/engine/data'
import { layerName, layerRanks } from '@/engine/materialQuests'
import { formatMoney } from '@/engine/money'
import { legFare, MODE_NAME } from '@/engine/travel'
import { reachable, type Path } from '@/engine/world'
import { openFor } from '@/engine/storyFlags'
import { useGame } from '@/stores/game'
import { RANK_COLOR } from './ui/cellIcons'

const emit = defineEmits<{ close: [] }>()
const game = useGame()
const s = computed(() => game.state!)
const here = computed(() => locationById(s.value.location))

const groups = computed(() => {
  const list = reachable(s.value.location, openFor(s.value))
  return geography.regions
    .map((r) => ({ region: r, items: list.filter((d) => locationById(d.id).region === r.id) }))
    .filter((g) => g.items.length > 0)
})
// 預設打開所在的地區
const picked = ref(here.value.region)
const current = computed(() => groups.value.find((g) => g.region.id === picked.value) ?? groups.value[0])

function daysText(days: [number, number]) {
  return days[0] === days[1] ? `${days[0]} 天` : `${days[0]}～${days[1]} 天`
}
function modesText(path: Path) {
  return [...new Set(path.legs.map((l) => MODE_NAME[l.mode]))].join('／')
}
function viaText(path: Path) {
  return path.legs.slice(0, -1).map((l) => locationById(l.to).name).join('、')
}
function fareOf(path: Path) {
  return path.legs.reduce((sum, l) => sum + legFare(l), 0)
}
/** 冒險區域各層的階級，例如「淺層 E・中層 D・深層 C」 */
function layerRankText(id: string) {
  return layerRanks(id).map((r) => `${layerName(r.layer)} ${r.rank}`).join('・')
}

function go(id: string) {
  game.travel(id, game.intent || undefined)
  game.intent = ''
  emit('close')
}
</script>

<template>
  <div class="travel">
    <nav class="regions">
      <button v-for="g in groups" :key="g.region.id" class="small" :class="{ on: g.region.id === current?.region.id }" @click="picked = g.region.id">
        {{ g.region.name }} <span class="muted">{{ g.items.length }}</span>
      </button>
    </nav>
    <p class="small muted">從{{ here.name }}出發。行動備註會帶進旅途的敘事；一格一天，路上的事件出發時就決定好了。</p>
    <table v-if="current" class="dest">
      <thead>
        <tr><th>目的地</th><th>路線</th><th class="num">天數</th><th class="num">船資（每人）</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="d in current.items" :key="d.id">
          <td class="n">
            {{ locationById(d.id).name }}
            <span v-if="locationById(d.id).type === 'dungeon'" class="tiers" :title="`冒險區域・${layerRankText(d.id)}`">
              <i v-for="r in layerRanks(d.id)" :key="r.layer" :style="{ background: RANK_COLOR[r.rank] }">{{ r.rank }}</i>
            </span>
          </td>
          <td class="route">{{ modesText(d.path) }}<span v-if="viaText(d.path)" class="muted">・經{{ viaText(d.path) }}</span></td>
          <td class="num">{{ daysText(d.path.days) }}</td>
          <td class="num">{{ fareOf(d.path) > 0 ? formatMoney(fareOf(d.path)) : '—' }}</td>
          <td class="go"><button class="small primary" @click="go(d.id)">前往</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.travel { display: grid; gap: 10px; }
.travel p { margin: 0; }
.regions { display: flex; flex-wrap: wrap; gap: 4px; }
.regions button.on { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.dest { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.dest th { text-align: left; font-weight: 600; color: var(--muted); font-size: var(--fs-xs); padding: 4px 6px; border-bottom: 1px solid var(--border); }
.dest td { padding: 7px 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); vertical-align: middle; }
.dest .n { font-weight: 700; white-space: nowrap; }
.dest .route { font-size: var(--fs-xs); }
.dest .num { white-space: nowrap; text-align: right; }
.dest .go { width: 1%; text-align: right; }
.dest .go button { white-space: nowrap; }
.tiers { display: inline-flex; gap: 2px; margin-left: 4px; vertical-align: 1px; }
.tiers i { font-style: normal; font-size: 10px; width: 15px; line-height: 15px; text-align: center; font-weight: 700; color: #111; }
@media (max-width: 640px) {
  .dest th:nth-child(2), .dest td:nth-child(2) { display: none; }
}
</style>
