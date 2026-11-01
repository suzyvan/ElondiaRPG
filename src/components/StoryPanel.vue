<script setup lang="ts">
import ContentTagChips from './ContentTagChips.vue'
import { computed } from 'vue'
import { formatMoney } from '@/engine/money'
import { activeNodes, nodesHere, nodesWaitingForTime, storyMaxCost, storyOffersHere, storyWearLocks } from '@/engine/story'
import { DAY_PART_NAME, hoursUntil } from '@/engine/timeOfDay'
import { useGame } from '@/stores/game'
import StoryNodeCard from './StoryNodeCard.vue'
import GameIcon from './ui/GameIcon.vue'

// 特殊任務：這裡可以接的任務（公會、身邊的固定 NPC），以及這裡的任務點
const game = useGame()
const s = computed(() => game.state!)
// 「這裡的人」用畫面共用的那一份（game.here），進行中的任務點兩個清單共用一份：每走一步不用各自重算
const offers = computed(() => {
  void s.value.time.minute
  void s.value.position
  return storyOffersHere(s.value, game.here)
})
const active = computed(() => {
  void s.value.time.minute
  void s.value.flags
  return activeNodes(s.value)
})
const nodes = computed(() => {
  void s.value.time.minute
  void s.value.position
  return nodesHere(s.value, game.here, active.value)
})
// 站在任務點上、但時段不對的（只在白天或夜裡）：提醒要等，可以在原地等到那個時段
const waiting = computed(() => {
  void s.value.time.minute
  void s.value.position
  return nodesWaitingForTime(s.value, game.here, active.value)
})
function waitHours(part: 'day' | 'night'): number {
  return Math.round(hoursUntil(s.value.time, part === 'night' ? 'night' : 'morning') * 10) / 10
}
const busy = computed(() => game.judging || !!s.value.pendingAction || !!s.value.combat)
</script>

<template>
  <section v-if="offers.length || nodes.length || waiting.length" class="panel story-panel">
    <h3 class="title"><GameIcon name="star" :size="16" />特殊任務</h3>
    <div v-for="d in offers" :key="d.id" class="card">
      <div><span v-if="d.rank" class="tag">{{ d.rank }}</span> <b>{{ d.title }}</b> <ContentTagChips :tags="d.tags" /></div>
      <p class="small">{{ d.start.text ?? d.summary }}</p>
      <p v-if="d.start.text" class="small muted">{{ d.summary }}</p>
      <p v-if="storyMaxCost(d)" class="small muted">途中有要付錢的地方（一次最多 {{ formatMoney(storyMaxCost(d)) }}），錢不夠時那一步不能選</p>
      <p v-if="storyWearLocks(s, d)" class="small warn">{{ storyWearLocks(s, d) }}</p>
      <button class="small primary" :disabled="busy" @click="game.startStory(d.id)">接下任務</button>
    </div>
    <StoryNodeCard v-for="n in nodes" :key="n.ref" :n="n" />
    <div v-for="n in waiting" :key="n.ref" class="card">
      <div class="small muted">{{ n.def.title }}</div>
      <div><b>{{ n.node.title }}</b></div>
      <p class="small">這件事要等到{{ DAY_PART_NAME[n.node.hours!] }}才能進行（現在是{{ DAY_PART_NAME[n.node.hours === 'night' ? 'day' : 'night'] }}）。可以先去做別的事，{{ DAY_PART_NAME[n.node.hours!] }}再回來。</p>
      <div v-if="!s.road"><button class="small" :disabled="busy" @click="game.waitForStoryNode(n.ref)"><GameIcon name="hourglass" :size="13" /> 在這裡等到{{ DAY_PART_NAME[n.node.hours!] }}（約 {{ waitHours(n.node.hours!) }} 小時）</button></div>
    </div>
  </section>
</template>

<style scoped>
.story-panel { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
.story-panel h3 { margin: 0; }
.title { display: flex; align-items: center; gap: 6px; }
.title :deep(.game-icon) { color: var(--accent); }
.card { border: 1px dashed var(--accent); border-radius: var(--radius); padding: 6px 8px; display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); }
.card p { margin: 0; line-height: 1.6; }
.warn { color: var(--danger); }
</style>
