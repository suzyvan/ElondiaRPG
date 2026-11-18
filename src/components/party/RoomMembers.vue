<script setup lang="ts">
import { computed, reactive } from 'vue'
import { craftRules } from '@/engine/data'
import { homeLabel, homesHere, lodgeRefusal, sendHomeRefusal } from '@/engine/away'
import type { Character } from '@/engine/types'
import { useGame } from '@/stores/game'
import { rosterMaster } from '@/engine/masterRoster'
import NameTag from '../NameTag.vue'
import MasterRosterPropose from './MasterRosterPropose.vue'

// 騰出位子：隊員一個一個送回房子、寄放在酒館或請離隊伍（騰出位子的對話框與等你決定的入隊共用）
const game = useGame()
const s = computed(() => game.state!)
const members = computed(() => s.value.party.filter((m) => !m.isPlayer && m.bond !== 'guest'))
const homes = computed(() => homesHere(s.value))
const pick = reactive<Record<string, string>>({})
// 同居的人只回他住的那一棟
const mateHome = (id: string) => s.value.npcs?.[id]?.cohabit?.home
const homeFor = (id: string) => mateHome(id) || pick[id] || homes.value[0]?.id || ''
const homeName = (id: string) => homes.value.find((h) => h.id === homeFor(id))?.name ?? ''
// 主人帶著主角時：主人的隊員要向主人提議（masterRoster.ts）
const master = computed(() => rosterMaster(s.value))
const mastersMember = (m: Character) => !!master.value && m.group === master.value.id && m.id !== master.value.id

/** 不能請離隊伍的原因 */
function dismissRefusal(m: Character): string | undefined {
  if (m.bond === 'leader' || m.group) return '這是你跟著的隊伍'
  if (m.bond === 'slave') return '奴隸不能遣散，先解除契約'
  return undefined
}
/** 才入隊沒多久：遣散會被當成用完就丟 */
function fresh(m: Character): boolean {
  if (!m.joined) return false
  const hours = (s.value.time.day - m.joined.day) * 24 + (s.value.time.hour ?? 0) - (m.joined.hour ?? 0)
  return hours < craftRules.dismiss_penalty.days * 24
}
/** 為什麼少了某些選項：全都不行時說跟著的隊伍、奴隸的原因；否則說沒有房子、不能寄放酒館的原因 */
function why(m: Character): string {
  const home = sendHomeRefusal(s.value, m)
  const lodge = lodgeRefusal(s.value, m)
  const leave = dismissRefusal(m)
  if (home && lodge && leave) return leave
  const out: string[] = []
  if (home === '這座城鎮沒有你的房子') out.push(home)
  if (lodge && lodge !== home) out.push(lodge)
  return out.length ? `${out.join('；')}。` : ''
}
function dismiss(m: Character) {
  if (fresh(m) && !confirm(`${m.name}才入隊沒幾天，現在遣散會被當成用完就丟（親密度下降、這座城的物價上漲一陣子）。還是要遣散嗎？`)) return
  game.dismiss(m.id)
}
</script>

<template>
  <ul class="plain room-members">
    <li v-for="m in members" :key="m.id" class="member">
      <NameTag :id="m.id" />
      <MasterRosterPropose v-if="mastersMember(m)" :member="m" class="acts" />
      <div v-else-if="m.id !== master?.id" class="acts">
        <template v-if="!sendHomeRefusal(s, m)">
          <select v-if="homes.length > 1 && !mateHome(m.id)" :id="`room-home-${m.id}`" :value="homeFor(m.id)" :aria-label="`${m.name}要回哪一棟房子`" @change="pick[m.id] = ($event.target as HTMLSelectElement).value">
            <option v-for="h in homes" :key="h.id" :value="h.id">{{ homeLabel(h) }}</option>
          </select>
          <button class="small" @click="game.sendHome(homeFor(m.id), m.id)">{{ mateHome(m.id) ? `回「${homeName(m.id)}」住下` : homes.length > 1 ? '送回房子' : `送回「${homes[0]!.name}」` }}</button>
        </template>
        <button v-if="!lodgeRefusal(s, m)" class="small" @click="game.lodgeAtTavern(m.id)">寄放在酒館</button>
        <button v-if="!dismissRefusal(m)" class="small danger" @click="dismiss(m)">請離隊伍</button>
      </div>
      <p v-if="m.id === master?.id" class="why small muted">帶著你的主人</p>
      <p v-else-if="!mastersMember(m) && why(m)" class="why small muted">{{ why(m) }}</p>
    </li>
    <li v-if="!members.length" class="muted">隊伍裡只有你自己。</li>
  </ul>
</template>

<style scoped>
.room-members { display: grid; gap: 6px; margin: 0; }
.member { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; justify-content: space-between; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; }
.member > :deep(.name-tag) { white-space: nowrap; }
.acts { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; margin-left: auto; }
.why { flex-basis: 100%; margin: 0; }
.why:empty { display: none; }
</style>
