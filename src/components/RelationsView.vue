<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, reactive, ref } from 'vue'
import { affinityStage } from '@/engine/character'
import { locationById, locationName } from '@/engine/data'
import { formatTime } from '@/engine/state'
import { nameOf as npcName, type Memory, type Relationship } from '@/engine/social'
import { useGame } from '@/stores/game'
import NameTag from './NameTag.vue'
import RelationDetail from './RelationDetail.vue'
import MemoryList from './MemoryList.vue'
import { npcRecord, npcTitle } from '@/engine/npcs'
import { awayCompanions, awayLabel } from '@/engine/away'
import { whereaboutsOf } from '@/engine/population'
import { allyPlacements } from '@/engine/story'
import Avatar from './ui/Avatar.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'
import { isFollowed, newsOf } from '@/engine/npcLife'
import { useSettings } from '@/stores/settings'
import { isMobile } from './mobile/mobile'

const game = useGame()
const settings = useSettings()
// 手機：「人物｜記憶」兩個分頁（電腦版左右兩欄）
const side = ref<'people' | 'memories'>('people')
const s = computed(() => game.state!)
// 所在：在隊伍裡、留在房子或寄放在酒館；其他人寫今天在哪（和地圖上擺人用同一套，另一片大陸時註明；population.ts 的 whereaboutsOf）
const awayById = computed(() => new Map(awayCompanions(s.value).map((a) => [a.id, a])))
// 特殊任務在場的友方：整批算一次，不要每個人各掃一遍任務點
const allies = computed(() => allyPlacements(s.value))
function whereNow(id: string): string {
  if (s.value.party.some((m) => m.id === id)) return '在隊伍裡'
  const a = awayById.value.get(id)
  if (a) return `${a.master ? '主人留在' : a.place.kind === 'home' ? '留在' : '寄放在'}${awayLabel(a.place)}${a.days ? `（${a.days} 天）` : ''}`
  return whereaboutsOf(s.value, id, allies.value)
}
const rels = computed(() => Object.values(s.value.relationships ?? {}))

// ---- 列表一列的內容 ----
/** 打開人物詳情（二級視窗）的人 */
const openId = ref<string | null>(null)
/** 名字旁邊的小字：隊友寫等級，其他人寫職業或身分 */
function titleOf(id: string): string {
  const m = s.value.party.find((x) => x.id === id)
  if (m) return `Lv.${m.level}`
  const rec = npcRecord(s.value, id)
  return rec ? `${npcTitle(rec)}${rec.kind === 'adventurer' ? ` Lv.${rec.level}` : ''}` : ''
}
const followed = (id: string) => isFollowed(s.value, id)
const pairable = (id: string) => !!s.value.npcLife?.pairs?.includes(id)
/** 上次見面之後的近況幾則 */
function newNews(id: string): number {
  const seen = s.value.relationships?.[id]?.lastSeen?.time.day ?? 0
  return newsOf(s.value, id).filter((n) => n.day >= seen).length
}
const suggestionFor = (id: string) => (s.value.suggestions ?? []).some((x) => x.npc === id)

// ---- 篩選：名字、身分、好感、排序 ----
const relQuery = ref('')
const relRole = ref<'all' | 'party' | 'merchant' | 'other'>('all')
const relMood = ref<'all' | 'friendly' | 'neutral' | 'hostile'>('all')
const relSort = ref<'recent' | 'affinity' | 'name'>('recent')
const keepers = computed(() => new Set(Object.values(s.value.shops ?? {}).map((x) => x.keeper)))
function roleOf(r: Relationship): 'party' | 'merchant' | 'other' {
  if (s.value.party.some((m) => m.id === r.id)) return 'party'
  if (keepers.value.has(r.id) || npcRecord(s.value, r.id)?.tags?.includes('merchant')) return 'merchant'
  return 'other'
}
const moodOf = (v: number) => (v >= 20 ? 'friendly' : v <= -21 ? 'hostile' : 'neutral')
const seenAt = (r: Relationship) => { const t = r.lastSeen?.time ?? r.firstMet?.time; return t ? t.day * 1440 + (t.hour ?? 0) * 60 + (t.minute ?? 0) : 0 }
const shownRels = computed(() => {
  const q = relQuery.value.trim()
  const list = rels.value.filter((r) => (!q || textHas(r.name, q) || (r.aliases ?? []).some((a) => textHas(a, q)))
    && (relRole.value === 'all' || roleOf(r) === relRole.value)
    && (relMood.value === 'all' || moodOf(r.affinity) === relMood.value))
  const by = relSort.value === 'affinity' ? (a: Relationship, b: Relationship) => b.affinity - a.affinity
    : relSort.value === 'name' ? (a: Relationship, b: Relationship) => a.name.localeCompare(b.name, 'zh-Hant')
      : (a: Relationship, b: Relationship) => seenAt(b) - seenAt(a)
  // 有 AI 提議的人固定排在最前面（提示叫玩家去點他們）
  return list.sort((a, b) => Number(suggestionFor(b.id)) - Number(suggestionFor(a.id)) || by(a, b))
})
const pcName = computed(() => s.value.party.find((m) => m.isPlayer)?.name ?? '主角')

function nameOf(id: string): string {
  return npcName(s.value, id)
}

function affinityPct(v: number) {
  return `${(v + 100) / 2}%`
}

// ---- 共同記憶 ----
// 篩選：人、地點、重要程度（重要以上、難忘、釘選）、內容搜尋；清單本身（一頁 30 筆、依天分段）在 MemoryList.vue
const filterPerson = ref('')
const filterLocation = ref('')
const filterLevel = ref<'all' | 'important' | 'unforgettable' | 'pinned'>('all')
const memQuery = ref('')
const filterKey = computed(() => [filterPerson.value, filterLocation.value, filterLevel.value, memQuery.value].join('|'))
const allMemories = computed(() => s.value.memories ?? [])
const mergedCount = computed(() => allMemories.value.reduce((n, m) => n + (m.merged ?? 0), 0))
const pinnedCount = computed(() => allMemories.value.filter((m) => m.pinned).length)
const memories = computed(() => {
  const q = memQuery.value.trim()
  return [...allMemories.value]
    .filter((m) => !filterPerson.value || m.participants.includes(filterPerson.value))
    .filter((m) => !filterLocation.value || m.location === filterLocation.value)
    .filter((m) => filterLevel.value === 'all' || (filterLevel.value === 'important' ? m.importance >= 2 : filterLevel.value === 'unforgettable' ? m.importance === 3 : !!m.pinned))
    .filter((m) => !q || textHas(m.summary, q) || textHas(m.scene, q) || m.participants.some((id) => textHas(nameOf(id), q)))
    .reverse()
})
const memoryLocations = computed(() => [...new Set(allMemories.value.map((m) => m.location))])

const newMemory = reactive({ summary: '', participants: [] as string[], importance: 2 as Memory['importance'] })
function addMemory() {
  if (!newMemory.summary.trim()) return
  game.addMemory({
    time: { ...s.value.time },
    location: s.value.location,
    participants: ['pc', ...newMemory.participants],
    summary: newMemory.summary.trim(),
    importance: newMemory.importance,
  })
  newMemory.summary = ''
  newMemory.participants = []
}


// ---- AI 提議的關係更新：列表上只提示，採用在人物詳情的「概況」 ----
const suggestions = computed(() => s.value.suggestions ?? [])
</script>

<template>
  <nav v-if="isMobile" class="ptabs">
    <button :class="{ on: side === 'people' }" @click="side = 'people'">人物 {{ rels.length }}</button>
    <button :class="{ on: side === 'memories' }" @click="side = 'memories'">記憶 {{ allMemories.length }}</button>
  </nav>
  <div class="layout" :class="{ split: !isMobile }">
    <section v-show="!isMobile || side === 'people'" class="panel">
      <h2 class="head"><GameIcon name="heart" :size="20" />人際關係 <Hint text="主角認識的角色。親密度由遊戲中的互動決定；外貌、性格與關係描述可以自行編輯，會在相關事件中提供給 AI 參考。" /></h2>
      <p v-if="rels.length === 0" class="muted small">還沒有認識任何人。到酒館招募夥伴吧。</p>
      <div v-else class="row rel-filter">
        <input v-model="relQuery" class="small q" type="search" placeholder="搜尋名字" />
        <select v-model="relRole" class="small" aria-label="身分">
          <option value="all">全部身分</option>
          <option value="party">隊友</option>
          <option value="merchant">商人</option>
          <option value="other">其他</option>
        </select>
        <select v-model="relMood" class="small" aria-label="好感">
          <option value="all">全部好感</option>
          <option value="friendly">友善</option>
          <option value="neutral">普通</option>
          <option value="hostile">敵對</option>
        </select>
        <select v-model="relSort" class="small" aria-label="排序">
          <option value="recent">最近見面</option>
          <option value="affinity">好感高到低</option>
          <option value="name">名字</option>
        </select>
        <span class="small muted">{{ shownRels.length }} / {{ rels.length }} 人</span>
      </div>

      <p v-if="suggestions.length" class="small hint-ai"><GameIcon name="sparkles" :size="13" /> AI 提議更新 {{ suggestions.length }} 位的「與{{ pcName }}的關係」：點有「AI 提議」標記的人，在「概況」採用或不採用。</p>

      <p v-if="rels.length && !shownRels.length" class="muted small">沒有符合的人。</p>
      <!-- 一個人一列：頭像、名字、好感、今天在哪、小圖示；點一下打開人物詳情（RelationDetail.vue） -->
      <ul class="plain people">
        <li v-for="r in shownRels" :key="r.id">
          <button class="person" :class="{ sel: openId === r.id }" @click="openId = r.id">
            <Avatar :id="r.id" :size="42" />
            <span class="nm"><NameTag :id="r.id" /><span v-if="titleOf(r.id)" class="small muted">{{ titleOf(r.id) }}</span></span>
            <span class="stage small">{{ affinityStage(r.affinity) }} <b>{{ r.affinity }}</b></span>
            <span class="sub2 small">
              <span class="aff" :title="`親密度 ${r.affinity}`"><i :style="{ left: affinityPct(r.affinity) }" /></span>
              <span class="where muted" :title="whereNow(r.id)"><GameIcon name="pin" :size="11" /> {{ whereNow(r.id) }}</span>
              <span class="icons">
                <span v-if="settings.npcLife && followed(r.id)" title="已關注">⭐</span>
                <span v-if="settings.npcLife && settings.npcPairs && pairable(r.id)" title="私生活可以和別人發生關係">💞</span>
                <span v-if="settings.npcLife && newNews(r.id)" class="badge" title="上次見面之後的近況">近況 {{ newNews(r.id) }}</span>
                <span v-if="suggestionFor(r.id)" class="badge" title="AI 提議更新與主角的關係，點開在「概況」採用或不採用">AI 提議</span>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <RelationDetail :id="openId" :where="openId ? whereNow(openId) : ''" :ids="shownRels.map((x) => x.id)" @open="(id) => (openId = id)" @close="openId = null" />

    <section v-show="!isMobile || side === 'memories'" class="panel">
      <h2 class="head"><GameIcon name="notes" :size="20" />冒險記憶 <Hint text="主角經歷過的事件。生成文本時，會依參與人、地點與時間找出相關的記憶交給 AI。釘選的記憶一定會被找到。" /></h2>

      <p class="small muted count">共 {{ allMemories.length }} 筆<template v-if="mergedCount">（舊的日常合併過 {{ mergedCount }} 筆）</template><template v-if="memories.length !== allMemories.length">・符合 {{ memories.length }} 筆</template></p>
      <div class="row filters small">
        <input v-model="memQuery" class="q" type="search" placeholder="搜尋記憶的內容或人名" />
        <select v-model="filterPerson" aria-label="人">
          <option value="">所有人</option>
          <option v-for="r in rels" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <select v-model="filterLocation" aria-label="地點">
          <option value="">所有地點</option>
          <option v-for="id in memoryLocations" :key="id" :value="id">{{ locationName(id) }}</option>
        </select>
      </div>
      <nav class="row chips small">
        <button class="small" :class="{ active: filterLevel === 'all' }" @click="filterLevel = 'all'">全部</button>
        <button class="small" :class="{ active: filterLevel === 'important' }" title="重要（★★）與難忘（★★★）" @click="filterLevel = 'important'">★★ 重要以上</button>
        <button class="small" :class="{ active: filterLevel === 'unforgettable' }" @click="filterLevel = 'unforgettable'">★★★ 難忘</button>
        <button class="small" :class="{ active: filterLevel === 'pinned' }" title="釘選的記憶：交給 AI 時一定找得到" @click="filterLevel = 'pinned'"><GameIcon name="bookmark" :size="12" /> 釘選 {{ pinnedCount }}</button>
      </nav>

      <details class="add small">
        <summary>手動新增記憶</summary>
        <textarea v-model="newMemory.summary" rows="2" placeholder="例如：在河谷鎮的舊石橋上，莉娜第一次說出自己怕水的原因。" />
        <div class="row">
          <label v-for="r in rels" :key="r.id"><input v-model="newMemory.participants" type="checkbox" :value="r.id" /> {{ r.name }}</label>
        </div>
        <div class="row">
          <select v-model.number="newMemory.importance">
            <option :value="1">日常</option>
            <option :value="2">重要</option>
            <option :value="3">難忘</option>
          </select>
          <button class="small primary" :disabled="!newMemory.summary.trim()" @click="addMemory">新增（{{ formatTime(s.time) }}・{{ locationById(s.location).name }}）</button>
        </div>
      </details>

      <p v-if="memories.length === 0" class="muted small">沒有符合的記憶。</p>
      <MemoryList :items="memories" :reset-key="filterKey" />
    </section>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 6px; }
.rel-filter { gap: 6px; margin-bottom: 8px; position: sticky; top: -14px; z-index: 2; padding: 6px 0; background: inherit; }
.rel-filter .q { flex: 1 1 7em; min-width: 7em; }
.rel-filter > span { white-space: nowrap; }
.head :deep(.game-icon) { color: var(--accent); }
.layout { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(320px, 1.2fr); gap: 14px; align-items: start; }
/* 電腦版：對話框固定高度，人物與記憶兩欄各自捲動 */
.layout.split { height: 100%; align-items: stretch; }
.layout.split > .panel { min-height: 0; overflow-y: auto; }
.layout.split .rel-filter { top: 0; }
/* 一個人一列：頭像｜名字（身分小字）｜好感；第二行是好感條、今天在哪、小圖示 */
.people { display: grid; }
.people > li { border-bottom: 1px solid var(--border); }
.person { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; width: 100%; padding: 7px 6px; border: 0; box-shadow: none; border-radius: 0; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; min-height: 0; }
.person:hover, .person.sel { background: #c99a4514; }
.person.sel { outline: 1px solid var(--gold-lo, var(--accent)); border-radius: 3px; }
.person > :first-child { grid-row: span 2; }
.nm { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
.nm > .small { overflow: hidden; text-overflow: ellipsis; flex-shrink: 100; }
.stage { white-space: nowrap; text-align: right; }
.stage b { font-variant-numeric: tabular-nums; }
.sub2 { grid-column: 2 / -1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.sub2 .where { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aff { position: relative; width: 72px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, var(--danger), #5a4a33 50%, var(--good)); flex: none; }
.aff i { position: absolute; top: -3px; width: 4px; height: 11px; margin-left: -2px; background: var(--text); border-radius: 2px; box-shadow: 0 0 0 1px var(--panel, #f3e6c8); }
.icons { display: inline-flex; gap: 4px; align-items: center; flex: none; }
.badge { font-size: 11px; border: 1px solid var(--accent); color: var(--accent); border-radius: 3px; padding: 0 4px; white-space: nowrap; }
.hint-ai { margin: 0 0 6px; color: var(--accent); }
.filters { margin-bottom: 6px; gap: 6px; }
.filters .q { flex: 1 1 10em; min-width: 0; }
.count { margin: -4px 0 6px; }
.chips { gap: 4px; margin-bottom: 8px; }
.chips button.active { border-color: var(--accent); color: var(--accent); }
.ptabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.ptabs button { flex: 1; border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 0; }
.ptabs button.on { border-bottom-color: var(--accent); color: var(--accent); font-weight: bold; }
.add { margin-bottom: 8px; display: grid; gap: 6px; }
.add textarea { width: 100%; margin-top: 6px; }
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
  .layout.split { height: auto; }
  .layout.split > .panel { overflow-y: visible; }
}
</style>
