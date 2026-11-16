<script lang="ts">
import { ref as moduleRef } from 'vue'
/** 篩選：可互動（身邊、沒被制伏的人）或全部；桌面版與手機版共用，切換後一直記著（重新整理回到可互動） */
const filter = moduleRef<'can' | 'all'>('can')
</script>

<script setup lang="ts">
import { npcPerksOf, perksOf } from '@/engine/perks'
import { computed, reactive, ref, watch } from 'vue'
import { affinityStage } from '@/engine/character'
import { askingFor, proposeDc, squadOptions } from '@/engine/companions'
import { actionRules, genderName, raceName, tagDef } from '@/engine/data'
import { isBound, partyMax, partyRoom } from '@/engine/party'
import { cellAt, CELL_NAME, cellName, position } from '@/engine/grid'
import { affinityTable, itemValue, type InteractionKind } from '@/engine/interactions'
import { CURRENCY, formatMoney } from '@/engine/money'
import { npcRecord, npcTitle } from '@/engine/npcs'
import { isGuarded, isHostile, type PresentNpc } from '@/engine/population'
import { npcActivity } from '@/engine/activities'
import { inActiveSquad } from '@/engine/squads'
import { jobName, staffInviteDc, staffInviteRefusal } from '@/engine/staff'
import { STAFF_JOBS, type StaffJob } from '@/engine/data'
import type { NpcRecord } from '@/engine/types'
import { parseUse, useGame } from '@/stores/game'
import { useSettings } from '@/stores/settings'
import { floatText } from '@/fx/fx'
import { stateKey } from '@/fx/seen'
import AbilityPicker from './AbilityPicker.vue'
import FoldMenu from './ui/FoldMenu.vue'
import NameTag from './NameTag.vue'
import Avatar from './ui/Avatar.vue'
import GameIcon from './ui/GameIcon.vue'
import { isMobile, OPEN_ACTION_EVENT } from './mobile/mobile'

// 這裡的人：和主角同一個地點、同一個地區的 NPC（見 docs/NPC_SYSTEM.md 第 7 節）
const game = useGame()
const s = computed(() => game.state!)
const settings = useSettings()
const everyone = computed(() => game.here)
/** 可互動：在身邊（同一格或相鄰）、沒有被制伏（被制伏的只能在戰後處置裡處理） */
const canTalk = (p: PresentNpc) => p.dist <= 1 && !s.value.captives?.npcs.includes(p.rec.id)
const canCount = computed(() => everyone.value.filter(canTalk).length)
const people = computed(() => (filter.value === 'can' ? everyone.value.filter(canTalk) : everyone.value))
const groups = computed(() => ([
  { key: 'staff', title: '店主與職員', icon: 'store', items: people.value.filter((p) => p.staff) },
  { key: 'adventurer', title: '冒險者', icon: 'sword', items: people.value.filter((p) => !p.staff && p.kind === 'adventurer') },
  { key: 'commoner', title: '普通人', icon: 'users', items: people.value.filter((p) => !p.staff && p.kind === 'commoner') },
] as const).filter((g) => g.items.length).map((g) => {
  const near = g.items.filter((p) => p.dist <= 1).length
  return { ...g, near, detail: near ? `身邊 ${near} 人` : '都不在身邊（要先走近）' }
}))
const where = computed(() => game.area.name)
// 身邊（同一格或相鄰）的人才能互動：沒有時自動收起，有人走近時自動打開；也可以點標題手動切換。
// 店主與職員、冒險者、普通人三組也一樣：那一組身邊有人才展開。
// 設定「這裡的人預設摺起來」時不自動展開，要自己點開；換了地點又摺起來
const nearCount = computed(() => everyone.value.filter((p) => p.dist <= 1).length)
const expanded = ref(!settings.peopleCollapsed && canCount.value > 0)
watch(() => canCount.value > 0, (has) => { if (!settings.peopleCollapsed) expanded.value = has })
watch(() => [s.value.location, game.area.name], () => { if (settings.peopleCollapsed) expanded.value = false })
watch(() => settings.peopleCollapsed, (on) => { expanded.value = !on && canCount.value > 0 })
// 等待判定、或有擋住行動的事件（刻印、主人的要求、戰敗事件）時，互動按鈕停用
const busy = computed(() => !!s.value.pendingAction || game.judging || !!s.value.pendingMark || !!s.value.pendingMasterEvent || !!s.value.pendingDefeat)

// 換了地點：請 AI 潤飾這裡的居民（AI 判定開啟時，每個地點一次）
watch(() => s.value.location, () => void game.flavorRoster(), { immediate: true })

const open = ref<string | null>(null)
watch(people, (list) => {
  if (open.value && !list.some((p) => p.rec.id === open.value)) open.value = null
})

// 親密度變了：那個人的名字旁飄出愛心 +／碎心 −（讀檔、剛走到這裡不算）
const lineEls = new Map<string, Element>()
function lineRef(id: string, el: unknown) {
  if (el instanceof Element) lineEls.set(id, el)
  else lineEls.delete(id)
}
watch(() => [stateKey(game.state), people.value.map((p) => `${p.rec.id}=${rel(p.rec.id)?.affinity ?? ''}`)] as const, ([key, now], old) => {
  if (!old || old[0] !== key) return
  const before = new Map(old[1].map((x) => x.split('=') as [string, string]))
  for (const x of now) {
    const [id, v] = x.split('=') as [string, string]
    const b = before.get(id)
    if (!b || !v || b === v) continue
    const d = Number(v) - Number(b)
    floatText(lineEls.get(id), d > 0 ? `♥+${d}` : `💔${d}`, { color: d > 0 ? '#ff8cc8' : '#a89a84' })
  }
})
function rel(id: string) {
  return s.value.relationships?.[id]
}

/** 每個人正在做什麼（固定亂數，依時段記住；不用 AI） */
const doing = computed(() => Object.fromEntries(people.value.map((p) => [p.rec.id, npcActivity(s.value, p, game.area)])))

function hostile(p: PresentNpc): boolean {
  return isHostile(s.value, p.rec)
}

/** 被制伏、等你處置的人：只能在戰後處置裡處理 */
function captive(p: PresentNpc): boolean {
  return !!s.value.captives?.npcs.includes(p.rec.id)
}

/** 遠處的人在哪裡：方向與格子 */
function whereIs(p: PresentNpc): string {
  const me = position(s.value)
  const dx = p.x - me.x
  const dy = p.y - me.y
  const dir = `${dx < 0 ? '西' : dx > 0 ? '東' : ''}${dy < 0 ? '北' : dy > 0 ? '南' : ''}`
  const cell = cellAt(game.area, p.x, p.y)
  return `在${dir ? `${dir}方` : '這裡'}的${cell ? cellName(cell.kind) : '某處'}（${p.dist} 格）`
}

function attack(p: PresentNpc) {
  if (confirm(`偷襲${p.rec.name}？被人看到的話，這裡與${p.rec.name}常去的地方都會提高警戒、降低聲望。`)) interact('attack', p)
}

/** 帶到「主動行動」：加進對象（還沒選人時就是主要對象），捲到日誌底部的主動行動列 */
function toAction(p: PresentNpc) {
  const max = actionRules.kinds.free.max_targets ?? 1
  if (!game.actionTargets.includes(p.rec.id)) {
    if (game.actionTargets.length >= max) game.flash(`主動行動最多 ${max} 個對象，先移掉一位`)
    else game.actionTargets = [...game.actionTargets, p.rec.id]
  }
  // 手機版：關掉「這裡」面板、展開日誌底部的主動行動列（MobileGame、ActionPanel 都聽這個事件）
  if (isMobile.value) return void window.dispatchEvent(new Event(OPEN_ACTION_EVENT))
  document.querySelector('.action-bar')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  document.querySelector<HTMLTextAreaElement>('.action-bar textarea.free')?.focus({ preventScroll: true })
}

// 一國之主這類人：不能偷襲、偷竊（內容頁籤的設定）
const GUARDED = '身邊戒備森嚴，找不到下手的機會'
const guarded = (p: PresentNpc, kind: 'attack' | 'steal') => isGuarded(p.rec.id, kind)

// 固定 NPC 的小隊：不拆開雇用，找隊長整隊邀請或請他們帶你同行
const squadOf = (id: string) => inActiveSquad(s.value, id)
const squadOpt = (id: string) => squadOptions(s.value, id)

function tagsOf(rec: NpcRecord) {
  return (rec.tags ?? []).map((t) => tagDef(t)).filter((t) => !!t)
}

// ---- 互動 ----
const text = reactive<Record<string, string>>({})
const gift = reactive<Record<string, string>>({})
const use = ref('')
const gifts = computed(() => s.value.inventory.filter((i) => i.qty > 0))

function interact(kind: InteractionKind | 'invite' | 'squad_join', p: PresentNpc) {
  const id = p.rec.id
  const u = parseUse(use.value)
  void game.perform({
    kind, target: id, text: text[id] ?? '',
    ...(kind === 'gift' ? { item: gift[id] } : {}),
    ...(u ? { use: u } : {}),
  })
  text[id] = ''
  use.value = ''
}

function giftHint(rec: NpcRecord): string {
  const item = gift[rec.id]
  if (!item) return ''
  const t = affinityTable(s.value, 'gift', rec, item)
  return `價值 ${formatMoney(itemValue(s.value, item))}・成功時親密度 +${t.success}`
}

// ---- 雇用（只限冒險者） ----
const candidates = computed(() => {
  // 依存檔取得：雇用、還價、拒絕後即時更新
  const today = s.value.taverns?.[s.value.location]
  return today?.day === s.value.time.day ? today.candidates : []
})
const offers = reactive<Record<string, number>>({})
const hiring = ref<string | null>(null)
const partyFull = computed(() => partyRoom(s.value) < 1)
// 被主人帶著：雇用改成向主人提議（主人出錢，入隊後是主人的隊員）
const bound = computed(() => isBound(s.value))
// 請認識的普通人來自己的房子當家僕（staff.ts）：這座城有自己的房子才列
const hasHomeHere = computed(() => Object.values(s.value.homes ?? {}).some((h) => h.location === s.value.location && !h.master))
const staffJob = reactive<Record<string, StaffJob>>({})
function inviteStaff(p: PresentNpc) {
  void game.perform({ kind: 'staff_invite', target: `${p.rec.id}:${staffJob[p.rec.id] ?? 'maid'}`, text: text[p.rec.id] ?? '' })
  text[p.rec.id] = ''
}
const proposedToday = (id: string) => s.value.flags[`propose_no:${id}`] === s.value.time.day
function proposeDcOf(id: string): number | null {
  try {
    return proposeDc(s.value, { kind: 'hire', npc: id })
  } catch {
    return null
  }
}
async function propose(id: string) {
  await game.perform({ kind: 'propose', target: `hire:${id}`, text: text[id] ?? '' })
  text[id] = ''
  hiring.value = null
}

function candidateOf(id: string) {
  return candidates.value.find((c) => c.npc === id)
}

function startHire(id: string) {
  // 第一次查看時建立今天的候選名單
  if (!candidateOf(id)) game.tavernCandidates()
  const c = candidateOf(id)
  if (!c) return
  offers[id] ??= askingFor(c)
  hiring.value = hiring.value === id ? null : id
}

function hire(id: string) {
  const c = candidateOf(id)
  if (!c) return
  const offer = Math.max(0, Math.floor(offers[id] ?? askingFor(c)))
  const say = text[id] ?? ''
  // 隊伍滿了：先騰出位子（送回房子、寄放、請離）再談
  game.requireRoom(1, `雇用${npcRecord(s.value, id)?.name ?? ''}`, async () => {
    await game.hire(id, offer, say)
    hiring.value = null
  })
}
/** 小隊：整隊邀請、請他們帶你同行（位子不夠時先騰出位子） */
function squadAct(kind: 'invite' | 'squad_join', p: PresentNpc) {
  const o = squadOpt(p.rec.id)
  const name = squadOf(p.rec.id)?.name ?? ''
  if (kind === 'invite') game.requireRoom(o.invite.need, `整隊邀請${name}`, () => interact('invite', p))
  else game.requireRoom(o.join.need, `跟著${name}同行`, () => interact('squad_join', p), true)
}
</script>

<template>
  <section class="panel people">
    <div class="row head">
      <h3>
        <button class="ghost fold" :class="{ open: expanded }" :aria-expanded="expanded" :title="expanded ? '收起' : '展開'" @click="expanded = !expanded">
          <GameIcon name="users" :size="18" />這裡的人 <span class="sub muted">{{ where }}・{{ everyone.length }} 人，身邊 {{ nearCount }} 人</span>
          <GameIcon name="right" :size="13" class="chev" />
        </button>
      </h3>
    </div>
    <template v-if="expanded">
    <div v-if="everyone.length" class="filter" role="group" aria-label="篩選">
      <button class="small" :class="{ on: filter === 'can' }" :aria-pressed="filter === 'can'" title="只列身邊、可以直接互動的人" @click="filter = 'can'">可互動 {{ canCount }}</button>
      <button class="small" :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" title="列出這一區所有的人（遠處的要先走近）" @click="filter = 'all'">全部 {{ everyone.length }}</button>
    </div>
    <p v-if="!everyone.length" class="small muted">這裡現在沒有別人。</p>
    <p v-else-if="!people.length" class="small muted">身邊沒有可以互動的人。這一區還有 {{ everyone.length }} 人，切到「全部」看他們在哪裡。</p>

    <div>
    <FoldMenu v-for="g in groups" :id="`people.${g.key}`" :key="g.key" class="group" :icon="g.icon" :label="g.title" :detail="g.detail" :badge="g.items.length" :auto="g.near > 0">
      <ul class="plain">
        <li v-for="p in g.items" :key="p.rec.id" :class="{ open: open === p.rec.id, far: p.dist > 1 }">
          <div :ref="(el) => lineRef(p.rec.id, el)" class="row line" @click="open = open === p.rec.id ? null : p.rec.id">
            <Avatar :id="p.rec.id" :size="28" />
            <NameTag :id="p.rec.id" />
            <span class="small muted">{{ npcTitle(p.rec) }}</span>
            <span v-if="captive(p)" class="tag small bad">被制伏</span>
            <span v-else-if="hostile(p)" class="tag small bad">敵對</span>
            <span v-if="p.dist > 1" class="tag">{{ p.dist }} 格</span>
            <span v-if="squadOf(p.rec.id)" class="tag small squad" :title="squadOf(p.rec.id)!.leader === p.rec.id ? '小隊的隊長' : '小隊的隊員'"><GameIcon name="flag" :size="11" />{{ squadOf(p.rec.id)!.name }}<template v-if="squadOf(p.rec.id)!.leader === p.rec.id">・隊長</template></span>
            <span v-for="t in tagsOf(p.rec)" :key="t.name" class="tag small" :title="t.ai_hint">{{ t.emoji }}{{ t.name }}</span>
            <span v-if="rel(p.rec.id)" class="tag known" :title="`親密度 ${rel(p.rec.id)!.affinity}`"><GameIcon name="heart" :size="11" />{{ affinityStage(rel(p.rec.id)!.affinity) }}</span>
          </div>
          <div v-if="doing[p.rec.id] && !captive(p)" class="doing small muted" :title="doing[p.rec.id]" @click="open = open === p.rec.id ? null : p.rec.id">{{ doing[p.rec.id] }}</div>

          <div v-if="open === p.rec.id" class="detail small">
            <div class="muted">{{ genderName(p.rec.gender) }}・{{ raceName(p.rec.race) }}<template v-if="p.rec.lineage">（{{ p.rec.lineage }}）</template>・{{ npcTitle(p.rec) }} Lv.{{ p.rec.level }}</div>
            <div v-if="p.rec.appearance" class="muted">{{ p.rec.appearance }}</div>
            <div v-if="rel(p.rec.id)" class="muted">{{ p.rec.personality }}</div>
            <div v-if="rel(p.rec.id)" class="muted">特質：{{ perksOf({ perks: npcPerksOf(p.rec), race: p.rec.race }).map((x) => (x.flaw ? `${x.name}（缺陷）` : x.name)).join('、') }}</div>
            <div v-if="rel(p.rec.id)?.toPlayer" class="muted">與你：{{ rel(p.rec.id)!.toPlayer }}</div>

            <p v-if="captive(p)" class="muted">{{ p.rec.name }}被你制伏在地上，先在「戰後處置」決定怎麼處置（可以審問、劫財、放過、收為奴隸或處決）。</p>
            <p v-else-if="p.dist > 1" class="muted">{{ whereIs(p) }}。走到旁邊（相鄰的格子）才能互動。</p>
            <template v-else-if="!hostile(p)">
              <p v-if="squadOf(p.rec.id) && squadOf(p.rec.id)!.leader !== p.rec.id" class="muted">是{{ squadOf(p.rec.id)!.name }}的隊員，不單獨受雇；要找隊長整隊邀請，或請他們帶你同行。</p>
              <input v-model="text[p.rec.id]" placeholder="想說什麼、怎麼做（選填，會交給 AI 判定）" />
              <AbilityPicker v-model="use" />
              <div class="row acts">
                <button class="small" :disabled="busy" title="魅力檢定：聊得好會拉近關係，也可能聽到消息" @click="interact('chat', p)"><GameIcon name="message" :size="13" />聊天</button>
                <button class="small" :disabled="busy" title="把這個人加進主動行動的對象（第一位是主要對象），自由描述要做的事" @click="toAction(p)"><GameIcon name="d20" :size="13" />主動行動</button>
                <template v-if="squadOf(p.rec.id)?.leader === p.rec.id && !bound">
                  <button class="small" :disabled="busy || !!squadOpt(p.rec.id).invite.why" :title="squadOpt(p.rec.id).invite.why ?? `整隊 ${squadOpt(p.rec.id).size} 人入隊・魅力檢定，參考 DC ${squadOpt(p.rec.id).invite.dc}`" @click="squadAct('invite', p)"><GameIcon name="feather" :size="13" />整隊邀請</button>
                  <button class="small" :disabled="busy || !!squadOpt(p.rec.id).join.why" :title="squadOpt(p.rec.id).join.why ?? `跟著他們的隊伍・魅力檢定，參考 DC ${squadOpt(p.rec.id).join.dc}`" @click="squadAct('squad_join', p)"><GameIcon name="flag" :size="13" />請他們帶你同行</button>
                </template>
                <button v-else-if="p.kind === 'adventurer' && !p.staff && !squadOf(p.rec.id)" class="small" :disabled="busy || (bound && partyFull)" @click="startHire(p.rec.id)">
                  <GameIcon name="hand" :size="13" />{{ hiring === p.rec.id ? '收起' : bound ? '向主人提議雇用' : '雇用' }}
                </button>
                <template v-if="hasHomeHere && p.kind === 'commoner' && !p.staff && !p.rec.staff && !bound">
                  <select v-model="staffJob[p.rec.id]" class="small" aria-label="請他做什麼">
                    <option v-for="j in STAFF_JOBS" :key="j" :value="j">{{ jobName(j) }}</option>
                  </select>
                  <button class="small" :disabled="busy || !!staffInviteRefusal(s, p.rec.id)" :title="staffInviteRefusal(s, p.rec.id) ?? `請他來你家當${jobName(staffJob[p.rec.id] ?? 'maid')}・魅力檢定，參考 DC ${staffInviteDc(s, p.rec.id)}`" @click="inviteStaff(p)"><GameIcon name="home" :size="13" />請他來家裡做事</button>
                </template>
                <details class="more">
                  <summary class="small" title="獻媚、誘惑、偷竊、偷襲" aria-label="更多互動"><GameIcon name="more" :size="16" /></summary>
                  <div class="more-list">
                    <button class="small" :disabled="busy" title="魅力檢定：奉承、討好；失敗會降低親密度，對貴族更難" @click="interact('flatter', p)">獻媚</button>
                    <button class="small" :disabled="busy" title="魅力檢定：勾引、挑逗；對方信仰虔誠、戴著清心的護符比較難，越淫亂越容易。成功時親密度上升、對方淫亂 +1，失敗會降低親密度" @click="interact('seduce', p)">誘惑</button>
                    <button class="small" :disabled="busy || guarded(p, 'steal')" :title="guarded(p, 'steal') ? GUARDED : '靈巧檢定：偷錢或東西；被發現會降低親密度，在城裡還會提高衛兵警戒、降低聲望'" @click="interact('steal', p)">偷竊</button>
                    <button v-if="p.kind === 'adventurer' && !p.staff" class="small danger" :disabled="busy || guarded(p, 'attack')" :title="guarded(p, 'attack') ? GUARDED : '靈巧檢定：成功就先手開戰；被看到會有衛兵與聲望的後果'" @click="attack(p)">偷襲</button>
                  </div>
                </details>
              </div>
              <!-- 小隊的按鈕停用時，原因直接寫出來（滑鼠提示在手機上看不到） -->
              <p v-if="squadOf(p.rec.id)?.leader === p.rec.id && !bound && (squadOpt(p.rec.id).invite.why || squadOpt(p.rec.id).join.why)" class="muted why">
                <template v-if="squadOpt(p.rec.id).invite.why">整隊邀請：{{ squadOpt(p.rec.id).invite.why }}。</template>
                <template v-if="squadOpt(p.rec.id).join.why">請他們帶你同行：{{ squadOpt(p.rec.id).join.why }}。</template>
              </p>
              <div class="row">
                <select v-model="gift[p.rec.id]" class="small">
                  <option :value="undefined">選擇禮物…</option>
                  <option v-for="i in gifts" :key="i.name" :value="i.name">{{ i.name }} ×{{ i.qty }}</option>
                </select>
                <button class="small" :disabled="busy || !gift[p.rec.id]" @click="interact('gift', p)"><GameIcon name="gift" :size="13" />送禮</button>
                <span class="muted">{{ giftHint(p.rec) }}</span>
              </div>

              <div v-if="hiring === p.rec.id && candidateOf(p.rec.id) && bound" class="hire">
                <span>要價 {{ formatMoney(askingFor(candidateOf(p.rec.id)!)) }}・主人出錢</span>
                <span v-if="proposedToday(p.rec.id)" class="muted">主人今天不想再聽你提這個人</span>
                <template v-else>
                  <span class="muted">魅力檢定，參考 DC {{ proposeDcOf(p.rec.id) ?? '—' }}（上面的文字是你怎麼說服主人）</span>
                  <button class="small primary" :disabled="busy" @click="propose(p.rec.id)">向主人提議（魅力檢定）</button>
                </template>
              </div>
              <div v-else-if="hiring === p.rec.id && candidateOf(p.rec.id)" class="hire">
                <span>要價 {{ formatMoney(askingFor(candidateOf(p.rec.id)!)) }}<template v-if="candidateOf(p.rec.id)!.counter_cc">（還價）</template></span>
                <span v-if="candidateOf(p.rec.id)!.declined" class="muted">今天不想再談了</span>
                <template v-else>
                  <label>出價（{{ CURRENCY.short }}）<input v-model.number="offers[p.rec.id]" type="number" min="0" step="5" /></label>
                  <button class="small primary" :disabled="(offers[p.rec.id] ?? 0) > s.money_cc || busy" @click="hire(p.rec.id)">
                    {{ (offers[p.rec.id] ?? 0) >= askingFor(candidateOf(p.rec.id)!) ? `雇用（${formatMoney(offers[p.rec.id] ?? 0)}）` : '提出條件（魅力檢定）' }}
                  </button>
                </template>
              </div>
            </template>
            <template v-else>
              <p class="muted">{{ p.rec.name }}對你充滿敵意。</p>
              <div class="row">
                <button class="small" :disabled="busy" @click="toAction(p)"><GameIcon name="d20" :size="13" />主動行動</button>
                <button class="small" :disabled="busy || guarded(p, 'steal')" :title="guarded(p, 'steal') ? GUARDED : ''" @click="interact('steal', p)">偷竊</button>
                <button v-if="p.kind === 'adventurer' && !p.staff" class="small danger" :disabled="busy || guarded(p, 'attack')" :title="guarded(p, 'attack') ? GUARDED : ''" @click="attack(p)">偷襲</button>
              </div>
            </template>
          </div>
        </li>
      </ul>
    </FoldMenu>
    </div>
    <p v-if="partyFull" class="small muted">隊伍已滿（{{ partyMax(s) }} 人）<template v-if="!bound">：雇人或邀請時會先請你騰出位子</template>。</p>
    </template>
  </section>
</template>

<style scoped>
.people .head { justify-content: space-between; }
.people h3 { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.people h3 :deep(.game-icon) { color: var(--accent); }
.fold { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; min-height: 0; }
.fold .chev { transition: transform 0.15s; color: var(--muted) !important; }
.fold.open .chev { transform: rotate(90deg); }
.sub { font-size: var(--fs-xs); font-weight: normal; letter-spacing: 0; }
.acts button, .detail .row button { display: inline-flex; align-items: center; gap: 4px; }
/* 「⋯」：展開時把獻媚、偷竊、偷襲排在旁邊（同一列，放不下就換行），不浮在上面，才不會被摺疊區裁掉 */
.more { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.more > summary { list-style: none; cursor: pointer; padding: 2px 6px; color: var(--muted); border: 1px solid transparent; border-radius: 3px; }
.more > summary::-webkit-details-marker { display: none; }
.more > summary:hover, .more[open] > summary { color: var(--accent); border-color: var(--gold-lo); }
.more-list { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.more-list button { white-space: nowrap; }
.line { gap: 3px 6px; cursor: pointer; flex-wrap: wrap; min-width: 0; }
/* 標籤多時換到下一行，名字不會被擠掉；名字本身太長才省略 */
.line > * { flex-shrink: 0; }
.line > .name-tag, .line > .small.muted { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line > .name-tag { flex-shrink: 1; min-width: 3em; }
.line > .small.muted { flex-shrink: 100; }
.line > .name-tag :deep(.name) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.known { color: var(--accent); border-color: var(--gold-lo); }
.why { margin: 0; }
.filter { display: flex; gap: 4px; margin: 2px 0 4px; }
.filter button { min-height: 0; padding: 1px 10px; }
.filter button.on { border-color: var(--accent); color: var(--accent); background: #c99a4522; }
.bad { color: var(--danger); border-color: var(--danger); }
li.far .line, li.far .doing { opacity: 0.7; }
/* 正在做什麼：名字下面一行，對齊頭像右邊 */
.doing { padding-left: 34px; margin-top: -2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
li.open { background: #c99a4510; outline: 1px solid var(--gold-lo); border-radius: 3px; padding: 6px; }
.detail { display: grid; gap: 4px; margin-top: 4px; grid-template-columns: minmax(0, 1fr); }
.detail input, .detail select { min-width: 0; }
.detail > input { width: 100%; }
.hire { display: grid; gap: 4px; padding: 6px; border: 1px dashed var(--border); border-radius: 6px; }
.hire label { display: grid; gap: 2px; }
</style>
