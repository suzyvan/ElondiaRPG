<script setup lang="ts">
import ContentTagChips from './ContentTagChips.vue'
import { deadlineText, hoursLeft, storyDeadline } from '@/engine/deadlines'
import { computed, ref } from 'vue'
import { enemies, locationById, stories } from '@/engine/data'
import { expireIntel, intelPlace } from '@/engine/intel'
import { canTurnIn, isMaterialQuest, layerName, questProgressText } from '@/engine/materialQuests'
import { formatMoney } from '@/engine/money'
import { examsFirst } from '@/engine/guild'
import { formatTime } from '@/engine/state'
import { activeNodes, nodesWaitingForDays, placeText, storyPauseReason } from '@/engine/story'
import { questScene, questTemplate } from '@/engine/town'
import type { Quest } from '@/engine/types'
import { useGame } from '@/stores/game'
import BestiaryPanel from './BestiaryPanel.vue'
import FoldMenu from './ui/FoldMenu.vue'
import GameIcon from './ui/GameIcon.vue'

// 冒險筆記：一般委託、特殊任務（目前的目標與經過）、情報（買到的與打聽到的傳聞）、怪物圖鑑
const game = useGame()
const s = computed(() => game.state!)
type Tab = 'quests' | 'stories' | 'intel' | 'bestiary'
const tab = ref<Tab>('quests')

// ---- 一般委託 ----
const AREA: Record<Quest['area'], string> = { town: '城內', outskirts: '近郊', dungeon: '冒險區域' }
const active = computed(() => examsFirst(s.value.quests.filter((q) => q.status === 'accepted' || q.status === 'ready')))
const finished = computed(() => s.value.quests.filter((q) => q.status === 'completed').slice(-20).reverse())
function where(q: Quest): string {
  if (q.area === 'dungeon') return `${locationById(q.target).name}${q.layer ? `・${layerName(q.layer)}` : ''}`
  if (q.area === 'outskirts') return `${locationById(q.target).name}近郊`
  return questTemplate(q) ? questScene(q) : `${locationById(q.target).name}・城內`
}

function abandonQuest(q: Quest) {
  if (confirm(`放棄委託「${q.title}」？公會聲望 -1。`)) game.abandonQuest(q.id)
}

// ---- 特殊任務 ----
const myStories = computed(() => {
  void s.value.time.minute
  void s.value.flags
  const nodes = activeNodes(s.value)
  // 只差「幾天之後」的任務點：寫出第幾天以後再來
  const later = nodesWaitingForDays(s.value)
  return Object.values(s.value.stories ?? {})
    .map((p) => ({ p, def: stories.find((d) => d.id === p.id), goals: nodes.filter((n) => n.def.id === p.id), later: later.filter((n) => n.def.id === p.id) }))
    .filter((x) => x.def)
    .sort((a, b) => Number(a.p.status !== 'active') - Number(b.p.status !== 'active'))
})
function abandon(id: string, title: string) {
  if (confirm(`放棄特殊任務「${title}」？放棄後不能再接。`)) game.abandonStory(id)
}

// ---- 情報 ----
const intel = computed(() => {
  void s.value.time.day
  expireIntel(s.value)
  return [...(s.value.intel ?? [])].sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.time.day - a.time.day)
})
const EVENT: Record<string, string> = { combat: '💀 盤踞的強敵', chest: '🎁 藏寶處', merchant: '🧳 流浪商人' }
const STATUS: Record<string, string> = { active: '有效', done: '已完成', expired: '已過期' }

const counts = computed(() => ({
  quests: active.value.length,
  stories: myStories.value.filter((x) => x.p.status === 'active').length,
  intel: intel.value.filter((i) => i.status === 'active' && i.kind === 'point').length,
}))
</script>

<template>
  <div class="notebook">
    <nav class="row tabs">
      <button :class="{ active: tab === 'quests' }" @click="tab = 'quests'"><GameIcon name="scroll" :size="15" />一般委託 <span v-if="counts.quests" class="tag">{{ counts.quests }}</span></button>
      <button :class="{ active: tab === 'stories' }" @click="tab = 'stories'"><GameIcon name="star" :size="15" />特殊任務 <span v-if="counts.stories" class="tag">{{ counts.stories }}</span></button>
      <button :class="{ active: tab === 'intel' }" @click="tab = 'intel'"><GameIcon name="eye" :size="15" />情報 <span v-if="counts.intel" class="tag">{{ counts.intel }}</span></button>
      <button :class="{ active: tab === 'bestiary' }" @click="tab = 'bestiary'"><GameIcon name="skull" :size="15" />圖鑑</button>
    </nav>

    <template v-if="tab === 'quests'">
      <p v-if="!active.length" class="muted">沒有進行中的委託。到冒險者公會接委託吧。</p>
      <div v-for="q in active" :key="q.id" class="card">
        <div class="row">
          <span class="tag">{{ q.rank }}</span><span class="tag">{{ AREA[q.area] }}</span><b class="grow">{{ q.title }}</b>
          <span v-if="canTurnIn(s, q)" class="tag ok">可以交付</span>
          <span v-else-if="q.deadline" class="tag" :class="{ warn: hoursLeft(s, q.deadline) < 24 }" :title="`期限：第 ${q.deadline.day} 天 ${q.deadline.hour ?? 0} 時`"><GameIcon name="hourglass" :size="12" />{{ deadlineText(s, q.deadline) }}</span>
          <button class="small" @click="abandonQuest(q)">放棄</button>
        </div>
        <div class="small">進度：{{ questProgressText(s, q) }}・報酬 {{ formatMoney(q.reward_cc) }}{{ isMaterialQuest(q) && (q.max ?? q.goal) > q.goal ? '（可以多交，報酬依數量增加）' : '' }}</div>
        <div class="small muted">
          地點：{{ where(q) }}<template v-if="q.monster">・目標：{{ enemies[q.monster]?.name ?? q.monster }}</template>・交付：{{ locationById(q.giver).name }}的冒險者公會
          <span v-if="q.flags?.lead" class="tag">有線索 +5</span>
        </div>
      </div>
      <FoldMenu v-if="finished.length" id="notebook.finished" class="history" icon="check" label="完成的委託" :detail="`最近 ${finished.length} 件`" :badge="finished.length">
        <ul class="plain small muted">
          <li v-for="q in finished" :key="q.id">{{ q.rank }}・{{ q.title }}<template v-if="q.delivered && q.delivered > q.goal">（交了 {{ q.delivered }} 份）</template></li>
        </ul>
      </FoldMenu>
    </template>

    <template v-else-if="tab === 'stories'">
      <p v-if="!myStories.length" class="muted">還沒有特殊任務。固定的人物、公會、旅途上的事件或情報商都可能帶來特別的委託。</p>
      <div v-for="{ p, def, goals, later } in myStories" :key="p.id" class="card" :class="p.status">
        <div class="row">
          <span v-if="def!.rank" class="tag">{{ def!.rank }}</span>
          <b class="grow">{{ def!.title }} <ContentTagChips :tags="def!.tags" /></b>
          <span v-if="p.status === 'active' && storyDeadline(s, p.id)" class="tag" :class="{ warn: hoursLeft(s, storyDeadline(s, p.id)!) < 24 }"><GameIcon name="hourglass" :size="12" />{{ deadlineText(s, storyDeadline(s, p.id)) }}</span>
          <span class="tag" :class="{ ok: p.status === 'completed' }">{{ p.status === 'active' ? '進行中' : p.status === 'completed' ? '完成' : '失敗' }}</span>
          <button v-if="p.status === 'active'" class="small" @click="abandon(p.id, def!.title)">放棄</button>
        </div>
        <p class="small">{{ def!.summary }}</p>
        <div v-if="p.status === 'active'" class="small">
          <b>目前的目標</b>
          <ul class="plain goals">
            <li v-for="g in goals" :key="g.ref"><GameIcon name="target" :size="12" /> {{ g.node.title }} <span class="muted">（{{ placeText(g.node, s) }}）</span></li>
            <li v-for="g in later" :key="g.ref" class="muted"><GameIcon name="hourglass" :size="12" /> {{ g.node.title }}（{{ placeText(g.node, s) }}・{{ formatTime(g.from) }} 以後）</li>
            <li v-if="storyPauseReason(s, def!) === 'tags'" class="muted">（設定的內容篩選關掉了這個任務的標籤，任務暫停中；重新開啟後接著進行）</li>
            <li v-else-if="storyPauseReason(s, def!) === 'body'" class="muted">（這個任務只給陰柔、中性體型的主角，任務暫停中；打開設定「陽剛體型也能遇到『只給陰柔、中性』的成人內容」或改回體型後接著進行）</li>
            <li v-else-if="!goals.length && !later.length" class="muted">（現在沒有可以進行的目標）</li>
          </ul>
        </div>
        <FoldMenu class="history" icon="notes" label="經過" :detail="p.log.length ? `最近：${p.log.at(-1)!.text.slice(0, 24)}${p.log.at(-1)!.text.length > 24 ? '…' : ''}` : ''" :badge="p.log.length" :open="p.status === 'active'">
          <ul class="plain small log">
            <li v-for="(l, i) in [...p.log].reverse()" :key="i"><span class="muted">{{ formatTime(l.time) }}</span> {{ l.text }}</li>
          </ul>
        </FoldMenu>
      </div>
    </template>

    <BestiaryPanel v-else-if="tab === 'bestiary'" />

    <template v-else>
      <p v-if="!intel.length" class="muted">還沒有情報。情報商賣附近的事件點與特殊任務的消息；向人打聽到的傳聞也記在這裡。</p>
      <div v-for="it in intel" :key="it.id" class="card" :class="it.status">
        <div class="row">
          <b class="grow"><GameIcon v-if="it.kind === 'story'" name="star" :size="13" /><GameIcon v-else-if="it.kind === 'rumor'" name="message" :size="13" /> {{ it.title }}</b>
          <span v-if="it.event" class="tag">{{ EVENT[it.event] }}</span>
          <span v-if="it.kind === 'rumor'" class="tag">傳聞</span>
          <span v-else class="tag" :class="{ ok: it.status === 'active' }">{{ STATUS[it.status] }}</span>
        </div>
        <p v-if="it.text" class="small">{{ it.text }}</p>
        <div class="small muted">
          <template v-if="it.kind === 'point'">地點：{{ intelPlace(it) }}・第 {{ it.until }} 天前有效・</template>
          <template v-else-if="it.location">地點：{{ locationById(it.location).name }}・</template>
          <template v-if="it.monster && enemies[it.monster]">怪物：{{ enemies[it.monster]!.name }}・</template>
          {{ formatTime(it.time) }}{{ it.npc ? `在${locationById(it.from).name}聽${it.npc}說的` : it.source ? `在${locationById(it.from).name}解讀「${it.source}」得到` : `在${locationById(it.from).name}的情報商買到` }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.notebook { display: grid; gap: 8px; }
.tabs { gap: 6px; }
.tabs button { display: inline-flex; align-items: center; gap: 6px; }
.tabs button.active { border-color: var(--accent); color: var(--accent); }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.grow { flex: 1; min-width: 120px; }
.card { border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 10px; display: grid; gap: 4px; }
.card p { margin: 0; line-height: 1.6; }
.card.completed, .card.failed, .card.done, .card.expired { opacity: 0.65; }
.tag.ok { border-color: var(--accent); color: var(--accent); }
.tag.warn { border-color: var(--danger); color: var(--danger); }
.goals :deep(.game-icon) { color: var(--accent); }
.goals, .log { margin: 2px 0 0; display: grid; gap: 2px; }
</style>
