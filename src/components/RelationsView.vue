<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { affinityStage } from '@/engine/character'
import { locationById } from '@/engine/data'
import { formatTime } from '@/engine/state'
import { nameOf as npcName, type Memory, type Relationship } from '@/engine/social'
import { useGame } from '@/stores/game'
import NameTag from './NameTag.vue'
import { canPromote } from '@/engine/promoteNpc'
import { npcRecord } from '@/engine/npcs'
import { awayCompanions, awayLabel } from '@/engine/away'
import { useContent, VANILLA_NAME } from '@/stores/content'
import PortraitBox from './PortraitBox.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'
import { canLive, isFollowed, livingNpcs, newsOf, newsText } from '@/engine/npcLife'
import { useSettings } from '@/stores/settings'

const game = useGame()
const content = useContent()
const s = computed(() => game.state!)
// 所在：在隊伍裡、留在房子或寄放在酒館（其他人不標，行蹤不一定知道）
const awayById = computed(() => new Map(awayCompanions(s.value).map((a) => [a.id, a])))
function whereNow(id: string): string {
  if (s.value.party.some((m) => m.id === id)) return '在隊伍裡'
  const a = awayById.value.get(id)
  return a ? `${a.place.kind === 'home' ? '留在' : '寄放在'}${awayLabel(a.place)}${a.days ? `（${a.days} 天）` : ''}` : ''
}

// 生成的人存成固定 NPC（存進目前的世界）
function promotable(id: string): boolean {
  void content.version
  return canPromote(s.value, id)
}
function promote(id: string, name: string) {
  if (!confirm(`把「${name}」存成目前世界的固定 NPC？之後可以在內容頁籤的「固定 NPC」編輯。`)) return
  game.promoteNpc(id)
  if (!game.error) game.flash(`已把「${name}」存成固定 NPC`)
}
const rels = computed(() => Object.values(s.value.relationships ?? {}))

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
  const list = rels.value.filter((r) => (!q || r.name.includes(q) || (r.aliases ?? []).some((a) => a.includes(q)))
    && (relRole.value === 'all' || roleOf(r) === relRole.value)
    && (relMood.value === 'all' || moodOf(r.affinity) === relMood.value))
  if (relSort.value === 'affinity') return list.sort((a, b) => b.affinity - a.affinity)
  if (relSort.value === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  return list.sort((a, b) => seenAt(b) - seenAt(a))
})
const pcName = computed(() => s.value.party.find((m) => m.isPlayer)?.name ?? '主角')

function nameOf(id: string): string {
  return npcName(s.value, id)
}

// ---- 人際關係編輯 ----
const editing = ref<string | null>(null)
// NPC 自己的日子（npcLife.ts）：會自己成長的人、近況（新的在前，最多三則）、關注
const settings = useSettings()
const living = computed(() => {
  void game.state?.time.day
  void game.state?.npcLife
  return game.state ? new Set(livingNpcs(game.state).map((r) => r.id)) : new Set<string>()
})
const news = (id: string) => (game.state ? [...newsOf(game.state, id)].reverse().slice(0, 3) : [])
const followable = (id: string) => {
  const rec = game.state ? npcRecord(game.state, id) : undefined
  return !!rec && !rec.dead && canLive(rec)
}
const followed = (id: string) => !!game.state && isFollowed(game.state, id)
const unpolished = (id: string) => news(id).some((n) => !n.story)

const draft = reactive({ appearance: '', toPlayer: '', aliases: '', others: [] as { id: string; text: string }[] })

function startEdit(r: Relationship) {
  editing.value = r.id
  draft.appearance = r.appearance
  draft.toPlayer = r.toPlayer
  draft.aliases = (r.aliases ?? []).join('、')
  draft.others = Object.entries(r.toOthers).map(([id, text]) => ({ id, text }))
}

function saveEdit(id: string) {
  game.editRelationship(id, {
    appearance: draft.appearance.trim(),
    toPlayer: draft.toPlayer.trim(),
    aliases: draft.aliases.split(/[、,，]/).map((x) => x.trim()),
    toOthers: Object.fromEntries(draft.others.map((o) => [o.id, o.text.trim()])),
  })
  editing.value = null
}

function affinityPct(v: number) {
  return `${(v + 100) / 2}%`
}

// ---- 共同記憶 ----
const filterPerson = ref('')
const filterLocation = ref('')
const memories = computed(() =>
  [...(s.value.memories ?? [])]
    .filter((m) => !filterPerson.value || m.participants.includes(filterPerson.value))
    .filter((m) => !filterLocation.value || m.location === filterLocation.value)
    .reverse(),
)
const memoryLocations = computed(() => [...new Set((s.value.memories ?? []).map((m) => m.location))])

const editingMemory = ref<string | null>(null)
const memoryDraft = ref('')

function editSummary(m: Memory) {
  editingMemory.value = m.id
  memoryDraft.value = m.summary
}

function saveSummary(id: string) {
  game.editMemory(id, { summary: memoryDraft.value.trim() })
  editingMemory.value = null
}

function removeMemory(id: string) {
  if (confirm('刪除這段記憶？')) game.deleteMemory(id)
}

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

const STARS = { 1: '★', 2: '★★', 3: '★★★' } as const

// ---- AI 提議的關係更新 ----
const suggestions = computed(() => s.value.suggestions ?? [])
const suggestionDraft = reactive<Record<string, string>>({})
</script>

<template>
  <div class="layout">
    <section class="panel">
      <h2 class="head"><GameIcon name="heart" :size="20" />人際關係 <Hint text="主角認識的角色。親密度由遊戲中的互動決定；外貌與關係描述可以自行編輯，會在相關事件中提供給 AI 參考。" /></h2>
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

      <div v-if="suggestions.length" class="suggestions">
        <h3 class="small">AI 提議更新「與{{ pcName }}的關係」</h3>
        <div v-for="sg in suggestions" :key="sg.id" class="suggestion small">
          <div><NameTag :id="sg.npc" /> <span class="muted">目前：{{ s.relationships?.[sg.npc]?.toPlayer }}</span></div>
          <textarea v-model="suggestionDraft[sg.id]" rows="2" :placeholder="sg.text" />
          <div class="row">
            <button class="small primary" @click="game.acceptSuggestion(sg.id, suggestionDraft[sg.id] || sg.text)">採用</button>
            <button class="small" @click="game.rejectSuggestion(sg.id)">不採用</button>
          </div>
        </div>
      </div>

      <p v-if="rels.length && !shownRels.length" class="muted small">沒有符合的人。</p>
      <article v-for="r in shownRels" :key="r.id" class="rel">
        <div class="row" style="justify-content: space-between">
          <NameTag :id="r.id" />
          <span class="small">{{ affinityStage(r.affinity) }}（{{ r.affinity }}）</span>
        </div>
        <div class="affinity"><span :style="{ left: affinityPct(r.affinity) }" /></div>
        <PortraitBox v-if="game.state" :id="r.id" size="small" />

        <template v-if="editing !== r.id">
          <dl class="small">
            <dt>外貌</dt><dd>{{ r.appearance || '—' }}</dd>
            <dt>與{{ pcName }}</dt><dd>{{ r.toPlayer || '—' }}</dd>
            <template v-if="Object.keys(r.toOthers).length">
              <dt>與他人</dt>
              <dd>
                <div v-for="(text, id) in r.toOthers" :key="id">{{ nameOf(String(id)) }}：{{ text }}</div>
              </dd>
            </template>
            <template v-if="r.aliases?.length"><dt>別名</dt><dd>{{ r.aliases.join('、') }}</dd></template>
            <template v-if="whereNow(r.id)"><dt>所在</dt><dd>{{ whereNow(r.id) }}</dd></template>
            <template v-if="r.firstMet"><dt>初次見面</dt><dd>{{ formatTime(r.firstMet.time) }}・{{ locationById(r.firstMet.location).name }}</dd></template>
            <template v-if="news(r.id).length">
              <dt>近況</dt>
              <dd><div v-for="n in news(r.id)" :key="n.day" class="news">第 {{ n.day }} 天：{{ newsText(n) }}</div></dd>
            </template>
          </dl>
          <div class="row">
            <button class="small" @click="startEdit(r)">編輯</button>
            <button
              v-if="settings.npcLife && followable(r.id)" class="small" :class="{ primary: followed(r.id) }"
              :title="followed(r.id) ? '取消關注（親密度夠高、留在家裡或離隊的夥伴照樣會自己成長）' : '關注：不在你身邊時也會自己成長（升級、換裝、受傷休養），每隔幾天有一則近況'"
              @click="game.setFollowed(r.id, !followed(r.id))"
            ><GameIcon name="star" :size="13" /> {{ followed(r.id) ? '已關注' : '關注' }}</button>
            <span v-if="settings.npcLife && living.has(r.id) && !followed(r.id)" class="small muted">會自己成長</span>
            <button v-if="settings.npcLife && unpolished(r.id) && settings.ready('life')" class="small" title="請 AI 依他的性格與和你的記憶，把近況寫成一段" @click="game.polishNews([r.id])"><GameIcon name="feather" :size="13" /> 寫成一段</button>
            <button
              v-if="promotable(r.id)" class="small"
              :title="(content.readOnly ? `${VANILLA_NAME}不能直接修改：會自動建立自己的世界，這場遊戲也改用它。` : '') + '把這個人目前的樣子（能力值、技能、特質、裝備、出沒的地方）存進目前的世界，之後可以在內容頁籤編輯；親密度與記憶延續'"
              @click="promote(r.id, r.name)"
            ><GameIcon name="bookmark" :size="13" /> 存成固定 NPC</button>
          </div>
        </template>

        <form v-else class="edit small" @submit.prevent="saveEdit(r.id)">
          <label>外貌<textarea v-model="draft.appearance" rows="2" /></label>
          <label>與{{ pcName }}的關係<textarea v-model="draft.toPlayer" rows="2" /></label>
          <label>別名（以頓號分隔）<input v-model="draft.aliases" /></label>
          <div>與他人的關係</div>
          <div v-for="(o, i) in draft.others" :key="i" class="row">
            <select v-model="o.id">
              <option v-for="other in rels.filter((x) => x.id !== r.id)" :key="other.id" :value="other.id">{{ other.name }}</option>
              <option v-if="!rels.some((x) => x.id === o.id)" :value="o.id">{{ nameOf(o.id) }}</option>
            </select>
            <input v-model="o.text" style="flex: 1" />
            <button type="button" class="small" @click="draft.others.splice(i, 1)">刪除</button>
          </div>
          <button
            v-if="rels.length > 1"
            type="button"
            class="small"
            @click="draft.others.push({ id: rels.find((x) => x.id !== r.id)!.id, text: '' })"
          >＋ 新增關係</button>
          <div class="row">
            <button class="small primary" type="submit">儲存</button>
            <button class="small" type="button" @click="editing = null">取消</button>
          </div>
        </form>
      </article>
    </section>

    <section class="panel">
      <h2 class="head"><GameIcon name="notes" :size="20" />冒險記憶 <Hint text="主角經歷過的事件。生成文本時，會依參與人、地點與時間找出相關的記憶交給 AI。釘選的記憶一定會被找到。" /></h2>

      <div class="row filters small">
        <select v-model="filterPerson">
          <option value="">所有人</option>
          <option v-for="r in rels" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <select v-model="filterLocation">
          <option value="">所有地點</option>
          <option v-for="id in memoryLocations" :key="id" :value="id">{{ locationById(id).name }}</option>
        </select>
      </div>

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
      <ul class="plain">
        <li v-for="m in memories" :key="m.id" class="memory">
          <div class="row small meta">
            <span>{{ formatTime(m.time) }}</span>
            <span>{{ m.scene ?? locationById(m.location).name }}</span>
            <span class="muted">{{ m.participants.map(nameOf).join('、') }}</span>
            <span v-if="m.merged" class="tag" title="記憶超過 200 筆時，舊的日常記憶會合併成摘要">合併 {{ m.merged }} 筆</span>
            <span class="spacer" />
            <button
              class="small star"
              :title="'重要程度：' + ['', '日常', '重要', '難忘'][m.importance]"
              @click="game.editMemory(m.id, { importance: ((m.importance % 3) + 1) as Memory['importance'] })"
            >{{ STARS[m.importance] }}</button>
            <button class="small" :class="{ pinned: m.pinned }" @click="game.editMemory(m.id, { pinned: !m.pinned })">
              <GameIcon name="bookmark" :size="12" /> {{ m.pinned ? '已釘選' : '釘選' }}
            </button>
          </div>
          <div v-if="editingMemory !== m.id" class="summary" @click="editSummary(m)">{{ m.summary }}</div>
          <div v-else class="row">
            <textarea v-model="memoryDraft" rows="2" style="flex: 1" />
            <button class="small primary" @click="saveSummary(m.id)">儲存</button>
            <button class="small danger" @click="removeMemory(m.id)">刪除</button>
          </div>
        </li>
      </ul>
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
.rel { border-top: 1px solid var(--border); padding: 10px 0; display: grid; gap: 6px; }
.news { margin-bottom: 2px; }
.affinity { position: relative; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--danger), #5a4a33 50%, var(--good)); }
.affinity span { position: absolute; top: -3px; width: 4px; height: 12px; margin-left: -2px; background: var(--text); border-radius: 2px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; }
.edit { display: grid; gap: 6px; }
.edit label { display: grid; gap: 2px; }
.filters { margin-bottom: 8px; }
.add { margin-bottom: 8px; display: grid; gap: 6px; }
.add textarea { width: 100%; margin-top: 6px; }
.memory { display: grid; gap: 4px; }
.suggestions { border: 1px dashed var(--accent); border-radius: 6px; padding: 8px; margin-bottom: 8px; display: grid; gap: 8px; }
.suggestion { display: grid; gap: 4px; }
.suggestion textarea { width: 100%; }
.meta { gap: 10px; }
.spacer { flex: 1; }
.star { color: var(--accent); }
.pinned { border-color: var(--accent); color: var(--accent); }
.summary { cursor: text; }
.summary:hover { color: var(--accent); }
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
