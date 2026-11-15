<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apMaxFor, attrsOf, combatBonuses, mod } from '@/engine/character'
import { askingFor, invitable, joinableSquads, partyOffersHere, proposeDc, squadOptions, underworldProposalBlocked, waitChance } from '@/engine/companions'
import { abilityDef, attributeRules, className, companionRules, conditionName, genderName, raceName, slaveryRules } from '@/engine/data'
import { landmarkHidden } from '@/engine/grid'
import { underworldAskBlocked, underworldEntryBlocked, underworldEscorted, underworldKnown, underworldLandmarks, underworldOf } from '@/engine/underworld'
import { mealMenu } from '@/engine/meals'
import { CURRENCY, formatMoney } from '@/engine/money'
import { ASK_COST, ASK_DC, askAroundBlock } from '@/engine/askAround'
import { leadPoolOn } from '@/engine/leads'
import { characterFor, npcRecord } from '@/engine/npcs'
import { perksOf } from '@/engine/perks'
import { isBound, isNoncombatant, leaderOf, partyMax, partyRoom } from '@/engine/party'
import { inActiveSquad } from '@/engine/squads'
import { lodgeRefusal, lodgersHere } from '@/engine/away'
import { canNegotiate } from '@/engine/negotiation'
import { discount, keeperTitle, shopKey } from '@/engine/trade'
import type { Character, TavernCandidate } from '@/engine/types'
import { useGame } from '@/stores/game'
import { spellSlots } from './party/memberInfo'
import NameTag from './NameTag.vue'
import AppDialog from './AppDialog.vue'
import ShopDialog from './items/ShopDialog.vue'
import BuildingMenu, { type MenuItem } from './place/BuildingMenu.vue'
import Avatar from './ui/Avatar.vue'
import GameIcon from './ui/GameIcon.vue'
import MasterWaiting from './party/MasterWaiting.vue'
import { rosterWaiting } from '@/engine/masterRoster'
import Hint from './ui/Hint.vue'
import { useSettings } from '@/stores/settings'

const game = useGame()
const s = computed(() => game.state!)
const candidates = ref<TavernCandidate[]>([])
const bound = computed(() => isBound(s.value))
const partyFull = computed(() => partyRoom(s.value) < 1)
const maxParty = computed(() => partyMax(s.value))

function refresh() {
  candidates.value = game.tavernCandidates()
}

// 酒館的交易清單（AI 開啟時請 AI 準備今天的特別商品）
const settings = useSettings()
const tradeLoading = ref(false)
onMounted(async () => {
  refresh()
  game.shopState('tavern')
  tradeLoading.value = settings.designs('shop')
  await Promise.all([game.flavorRoster().then(refresh), game.flavorShop('tavern')])
  tradeLoading.value = false
})

const visible = computed(() => {
  // 依存檔重新取：雇用、還價、拒絕後即時更新
  const today = s.value.taverns?.[s.value.location]
  const list = today && today.day === s.value.time.day ? today.candidates : candidates.value
  return list.filter((c) => !s.value.party.some((m) => m.id === c.npc))
})

// 雇用前的預覽：角色資料以 NPC id 當種子產生，和入隊後一樣
const previews = computed(() => {
  const out: Record<string, Character> = {}
  for (const c of visible.value) {
    const rec = npcRecord(s.value, c.npc)
    if (rec) out[c.npc] = characterFor(s.value, rec)
  }
  return out
})
const pv = (id: string) => previews.value[id]!
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`

const offers = reactive<Record<string, number>>({})
const approach = reactive<Record<string, string>>({})
const open = ref<string | null>(null)

function toggle(c: TavernCandidate) {
  open.value = open.value === c.npc ? null : c.npc
  offers[c.npc] ??= askingFor(c)
}

function hire(c: TavernCandidate) {
  const offer = Math.max(0, Math.floor(offers[c.npc] ?? askingFor(c)))
  const text = approach[c.npc] ?? ''
  // 隊伍滿了：先騰出位子（送回房子、寄放、請離）再談
  game.requireRoom(1, `雇用${npcRecord(s.value, c.npc)?.name ?? ''}`, async () => {
    await game.hire(c.npc, offer, text)
    open.value = null
  })
}

// 被主人帶著：不能自己雇人，改成向主人提議（主人出錢，見 companions.ts 的 proposeDc）
const master = computed(() => (bound.value ? leaderOf(s.value) : undefined))
function proposeDcOf(id: string): number | null {
  try {
    return proposeDc(s.value, { kind: 'hire', npc: id })
  } catch {
    return null
  }
}
const proposedToday = (id: string) => s.value.flags[`propose_no:${id}`] === s.value.time.day
async function propose(c: TavernCandidate) {
  await game.perform({ kind: 'propose', target: `hire:${c.npc}`, text: approach[c.npc] ?? '' })
  open.value = null
}

// ---- 用餐 ----
const menu = computed(() => {
  void s.value.time.minute
  return mealMenu(s.value)
})
// 隊伍現在的用餐與喝酒狀態
const MEAL_CONDITIONS = new Set(['fed_light', 'fed_well', 'fed_fine', 'fed_feast', 'fed_legend', 'cheered', 'tipsy'])
const fed = computed(() => s.value.party
  .map((m) => ({ name: m.name, list: m.status.filter((c) => MEAL_CONDITIONS.has(c)).map(conditionName) }))
  .filter((x) => x.list.length))

// ---- 組隊 ----
const offersHere = computed(() => partyOffersHere(s.value))
const leader = computed(() => leaderOf(s.value))
const chance = computed(() => Math.round(waitChance(s.value) * 100))


// ---- 邀請、黑市 ----
const inviteList = computed(() => invitable(s.value))
const inviteText = ref('')
// 固定 NPC 的小隊：整隊邀請、或請他們帶你同行
const squadHere = computed(() => joinableSquads(s.value))
const squadName = (id: string) => inActiveSquad(s.value, id)?.name
const squadOpt = (id: string) => squadOptions(s.value, id)
const squadText = ref('')
function inviteOne(id: string) {
  const text = inviteText.value
  inviteText.value = ''
  const sq = inActiveSquad(s.value, id)
  const need = sq ? squadOpt(id).invite.need : 1
  game.requireRoom(need, sq ? `整隊邀請${sq.name}` : `邀請${npcRecord(s.value, id)?.name ?? ''}`, () => game.perform({ kind: 'invite', target: id, text }))
}
function squadJoin(leaderId: string) {
  const text = squadText.value
  squadText.value = ''
  game.requireRoom(squadOpt(leaderId).join.need, `跟著${inActiveSquad(s.value, leaderId)?.name ?? '他們'}同行`, () => game.perform({ kind: 'squad_join', target: leaderId, text }), true)
}

// ---- 寄放在酒館的夥伴（不算離隊、不收錢，奴隸不能寄放） ----
const lodgers = computed(() => lodgersHere(s.value))
// 主人留在這間酒館的隊員（被主人帶著時，masterRoster.ts）
const masterLodgers = computed(() => (bound.value ? rosterWaiting(s.value).filter((w) => w.place === 'tavern') : []))
const companions = computed(() => s.value.party.filter((m) => !m.isPlayer && m.bond !== 'guest'))

// ---- 地下街（underworld.ts）：沒打聽到之前打聽，打聽到之後從這裡走進去 ----
const underworld = computed(() => underworldOf(s.value.location))
const underworldIn = computed(() => (underworld.value ? underworldLandmarks(underworld.value).filter((l) => !landmarkHidden(s.value, l)).map((l) => l.name) : []))
const knowsUnderworld = computed(() => underworldKnown(s.value))
const enterWhy = computed(() => underworldEntryBlocked(s.value))
const askWhy = computed(() => underworldAskBlocked(s.value))
// 被主人帶著：向主人提議去地下街（companions.ts 的 underworldProposalBlocked），主人答應的那一天跟著主人走進去
const escorted = computed(() => underworldEscorted(s.value))
const proposeUwWhy = computed(() => (bound.value ? underworldProposalBlocked(s.value) : undefined))
const proposeUwDc = computed(() => {
  try {
    return bound.value && underworld.value ? proposeDc(s.value, { kind: 'underworld' }) : null
  } catch {
    return null
  }
})
const proposeUwText = ref('')
const askText = ref('')
const askDc = slaveryRules.black_market_search.dc
const askHours = slaveryRules.black_market_search.hours

// ---- 選單 ----
type Section = 'meals' | 'recruit' | 'offers' | 'invite' | 'lodge' | 'underworld' | 'propose_underworld' | 'trade'
const section = ref<Section | null>(null)
const bestMeal = computed(() => {
  const list = s.value.party.flatMap((m) => m.status.filter((c) => MEAL_CONDITIONS.has(c)))
  return list.length ? conditionName(list[0]!) : ''
})
const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { id: 'meals', icon: 'mug', label: '用餐', detail: `今天的菜單 ${menu.value.filter((m) => !m.unavailable).length} 道（全隊一起吃）`, badge: bestMeal.value, tone: 'good' },
  ]
  if (bound.value) {
    items.push({ id: 'recruit', icon: 'users', label: '向主人提議雇人', detail: partyFull.value ? `隊伍已滿（${maxParty.value} 人）` : visible.value.length ? `請${master.value?.name ?? '主人'}出錢雇用今天城裡的冒險者（${visible.value.length} 位）` : '今天城裡沒有可以雇用的冒險者', badge: visible.value.length || '', tone: 'gold' })
    if (masterLodgers.value.length) items.push({ id: 'lodge', icon: 'home', label: '主人留在這裡的隊員', detail: `${masterLodgers.value.map((w) => w.character.name).join('、')}在這裡等主人`, badge: masterLodgers.value.length })
    if (underworld.value) {
      items.push(escorted.value
        ? { id: 'enter_underworld', icon: 'door', label: `跟著${master.value?.name ?? '主人'}走進${underworld.value.name}`, disabled: !!enterWhy.value, detail: enterWhy.value ?? `主人今天答應帶你去${underworldIn.value.length ? `・裡面有${underworldIn.value.join('、')}` : ''}` }
        : { id: 'propose_underworld', icon: 'eye', label: '向主人提議去地下街', disabled: !!proposeUwWhy.value, detail: proposeUwWhy.value ?? `請${master.value?.name ?? '主人'}帶你去${underworld.value.name}：魅力檢定，參考 DC ${proposeUwDc.value ?? '—'}` })
    }
  } else {
    items.push(
      { id: 'recruit', icon: 'users', label: '招募冒險者', detail: partyFull.value ? `隊伍已滿（${maxParty.value} 人），雇人前先騰出位子` : visible.value.length ? `今天城裡有 ${visible.value.length} 位可以雇用` : '今天城裡沒有可以雇用的冒險者', badge: visible.value.length || '', tone: 'gold' },
      { id: 'offers', icon: 'flag', label: leader.value ? '你所在的隊伍' : '加入別人的隊伍', detail: leader.value ? `正跟著${leader.value.name}的隊伍` : `等待組隊 ${companionRules.wait_party.hours} 小時・機率約 ${chance.value}%${squadHere.value.length ? `・身邊有 ${squadHere.value.length} 支認識的小隊` : ''}`, badge: leader.value ? '' : (offersHere.value.length + squadHere.value.length) || '' },
    )
    if (inviteList.value.length) items.push({ id: 'invite', icon: 'feather', label: '邀請認識的人', detail: `${inviteList.value.length} 位認識的人可以邀請`, badge: inviteList.value.length })
    if (lodgers.value.length || companions.value.length) items.push({ id: 'lodge', icon: 'home', label: '寄放夥伴', detail: lodgers.value.length ? `${lodgers.value.map((m) => m.name).join('、')}在這裡等你` : '讓同伴在酒館等你回來（不算離隊、不收錢）', badge: lodgers.value.length || '' })
    if (underworld.value) {
      items.push(knowsUnderworld.value
        ? { id: 'enter_underworld', icon: 'door', label: `走進${underworld.value.name}`, disabled: !!enterWhy.value, detail: enterWhy.value ?? (underworldIn.value.length ? `裡面有${underworldIn.value.join('、')}` : '見不得光的買賣') }
        : { id: 'underworld', icon: 'eye', label: '打聽地下街', detail: `魅力檢定 DC ${askDc}，約 ${askHours} 小時：這座城見不得光的買賣藏在哪裡` })
    }
  }
  // 打聽：線索池的隱藏線索（askAround.ts）
  const askBlock = game.state ? askAroundBlock(game.state) : null
  if (leadPoolOn()) items.push({ id: 'ask', icon: 'eye', label: '打聽消息', disabled: !!askBlock, detail: askBlock ?? `請一輪酒（${formatMoney(ASK_COST)}），魅力檢定 DC ${ASK_DC}：打聽這一帶的線索（約 1 小時）` })
  items.push({ id: 'trade', icon: 'coins', label: '酒館的交易', detail: tradeLoading.value ? 'AI 正在準備今天的特別交易…' : '餐點以外的交易：情報、請客、幫忙……' })
  // 長期折扣（和其他商店一樣，見 ShopPanel）
  items.push({
    id: 'discount', icon: 'hand', label: '談長期折扣', disabled: !!discountBlocked.value,
    detail: discountBlocked.value ?? (off.value ? `目前享有 ${off.value}% 折扣` : '和老闆談一個長期的折扣'),
    badge: off.value ? `${off.value}%` : '', tone: 'good',
  })
  return items
})
const keeper = computed(() => {
  const shop = s.value.shops?.[shopKey(s.value, 'tavern')]
  return shop && shop.day === s.value.time.day ? npcRecord(s.value, shop.keeper) : undefined
})
const off = computed(() => Math.round(discount(s.value, shopKey(s.value, 'tavern')) * 100))
const discountBlocked = computed(() => canNegotiate(s.value, 'shop_discount', { shop: 'tavern' }))
function pick(id: string) {
  if (id === 'discount') game.startNegotiation('shop_discount', { shop: 'tavern' })
  else if (id === 'ask') game.askAround()
  else if (id === 'enter_underworld') game.enterUnderworld()
  else section.value = id as Section
}
const TITLES: Record<Section, string> = { meals: '用餐', recruit: '招募冒險者', offers: '加入別人的隊伍', invite: '邀請認識的人', lodge: '寄放夥伴', underworld: '打聽地下街', propose_underworld: '向主人提議去地下街', trade: '酒館的交易' }
</script>
<template>
  <div class="tavern">
    <p v-if="bound" class="small muted">身為奴隸，你不能自己雇人或找隊伍；想多個隊友，可以向主人提議。</p>
    <p v-if="keeper" class="small muted keeper">{{ keeperTitle('tavern') }}：<NameTag :id="keeper.id" />・{{ keeper.personality }}</p>
    <BuildingMenu :items="menuItems" @pick="pick" />

    <AppDialog :open="section !== null" :title="section ? TITLES[section] : ''" icon="mug" :inline-error="section === 'trade'" :width="section === 'trade' ? '1400px' : '900px'" @close="section = null">
      <template #head>
        <Hint v-if="section === 'meals'" text="全隊一起吃（價格是每人）。吃完的狀態到下次長休前有效；同時只保留最好的一餐，喝酒喝多了會微醺。" />
        <Hint v-else-if="section === 'recruit'" :text="`今天在城裡、可以雇用的冒險者（在右側「這裡的人」也能直接雇用）。出價低於要價時要談判；出價的影響最大，運氣好甚至能免費雇到人。\n雇用是一次付清：沒有期限，也不用按週付薪水。之後的戰利品與委託報酬都歸你，不用分給同伴。\n同伴的親密度降到 ${companionRules.leave_threshold} 以下時，會在短休或長休後離隊（奴隸除外）；也可以在隊伍裡遣散。`" />
        <Hint v-else-if="section === 'invite'" text="需要親密度與魅力檢定。被婉拒後，要等下次長休才能再邀請。" />
      </template>

      <!-- 用餐 -->
      <template v-if="section === 'meals'">
        <div class="meals">
          <article v-for="m in menu" :key="m.id" class="meal" :class="{ off: !!m.unavailable }">
            <header><b>{{ m.name }}</b><span class="price">{{ m.unavailable ?? formatMoney(m.price) }}<small v-if="!m.unavailable && s.party.length > 1"> ×{{ s.party.length }}</small></span></header>
            <div class="small cond"><span class="tag good">{{ conditionName(m.condition) }}</span></div>
            <p class="small muted">{{ m.desc }}</p>
            <button class="small" :disabled="!!m.unavailable || s.money_cc < m.total || game.judging" @click="game.eatMeal(m.id)">點餐<template v-if="!m.unavailable">（{{ formatMoney(m.total) }}）</template></button>
          </article>
        </div>
        <p v-if="fed.length" class="small muted fed">目前：{{ fed.map((x) => `${x.name}：${x.list.join('、')}`).join('；') }}</p>
      </template>

      <!-- 招募 -->
      <template v-else-if="section === 'recruit'">
        <p v-if="visible.length === 0" class="muted small">今天城裡沒有可以雇用的冒險者。</p>
        <div class="cands">
          <article v-for="c in visible" :key="c.npc" class="cand">
            <template v-if="npcRecord(s, c.npc)">
              <header>
                <Avatar :id="c.npc" :size="52" />
                <div>
                  <NameTag :id="c.npc" />
                  <div class="small muted">{{ genderName(npcRecord(s, c.npc)!.gender) }}・{{ raceName(npcRecord(s, c.npc)!.race) }}・{{ className(npcRecord(s, c.npc)!.class) }} Lv.{{ npcRecord(s, c.npc)!.level }}</div>
                </div>
              </header>
              <template v-if="previews[c.npc]">
                <div class="vitals small">
                  <span><span class="label">HP</span> <b>{{ pv(c.npc).maxHp }}</b></span>
                  <template v-if="!isNoncombatant(pv(c.npc))">
                    <span><span class="label">AP</span> <b>{{ apMaxFor(pv(c.npc).level, attrsOf(pv(c.npc))) }}</b><small class="muted">（每回合 +{{ combatBonuses(pv(c.npc)).ap_regen.total }}）</small></span>
                    <span v-if="spellSlots(pv(c.npc)).length"><span class="label">法術環</span> {{ spellSlots(pv(c.npc)).map((x) => `${x.circle}環×${x.max}`).join('・') }}</span>
                  </template>
                </div>
                <div class="attr5">
                  <span v-for="a in attributeRules.attributes" :key="a.id" :title="a.desc">
                    <span class="label">{{ a.name }}</span>
                    <b>{{ attrsOf(pv(c.npc))[a.id] }}</b><small>{{ signed(mod(attrsOf(pv(c.npc))[a.id])) }}</small>
                  </span>
                </div>
                <div v-if="pv(c.npc).abilities.length" class="chips">
                  <span class="label small">能力</span>
                  <span v-for="id in pv(c.npc).abilities" :key="id" class="tag" :title="abilityDef(id).desc">{{ abilityDef(id).name }}</span>
                </div>
                <div v-if="perksOf(pv(c.npc)).length" class="chips">
                  <span class="label small">特質</span>
                  <span v-for="p in perksOf(pv(c.npc))" :key="p.id" class="tag" :class="{ bad: p.flaw }" :title="p.desc">{{ p.name }}<template v-if="p.flaw">（缺陷）</template></span>
                </div>
              </template>
              <p class="bio">{{ npcRecord(s, c.npc)!.personality }}</p>
              <details v-if="npcRecord(s, c.npc)!.appearance" class="appearance small">
                <summary>外貌</summary>
                <p class="muted">{{ npcRecord(s, c.npc)!.appearance }}</p>
              </details>
              <div class="price-row">
                <span><span class="label">要價</span> <b>{{ formatMoney(askingFor(c)) }}</b><span v-if="c.counter_cc" class="tag">還價</span></span>
                <template v-if="bound">
                  <span v-if="proposedToday(c.npc)" class="small muted">主人今天不想再聽你提這個人</span>
                  <button v-else class="small primary" :disabled="partyFull" @click="toggle(c)">{{ open === c.npc ? '收起' : '向主人提議' }}</button>
                </template>
                <span v-else-if="c.declined" class="small muted">今天不想再談了</span>
                <button v-else class="small primary" @click="toggle(c)">{{ open === c.npc ? '收起' : '談雇傭' }}</button>
              </div>
              <div v-if="open === c.npc && bound" class="nego small">
                <p class="muted">請{{ master?.name ?? '主人' }}出錢雇用，加入後是主人的隊員。魅力檢定，參考 DC {{ proposeDcOf(c.npc) ?? '—' }}（主人的親密度、要價相對主人的財力、主人的身分、契約的服從懲罰）。部分成功時主人要你出一半。</p>
                <label><span>怎麼說服主人（選填） <Hint text="會交給 AI 判定。" /></span><input v-model="approach[c.npc]" placeholder="例如：說他能幫主人扛行李、打退攔路的人" /></label>
                <button class="small primary" :disabled="game.judging" @click="propose(c)">向主人提議雇用（魅力檢定）</button>
              </div>
              <div v-else-if="open === c.npc" class="nego small">
                <label>出價（{{ CURRENCY.short }}）<input v-model.number="offers[c.npc]" type="number" min="0" step="5" /></label>
                <label><span>談判方式（選填） <Hint text="會交給 AI 判定。" /></span><input v-model="approach[c.npc]" placeholder="例如：答應分他一成戰利品、請他喝酒" /></label>
                <button class="small primary" :disabled="(offers[c.npc] ?? 0) > s.money_cc || game.judging" @click="hire(c)">
                  {{ (offers[c.npc] ?? 0) >= askingFor(c) ? `雇用（${formatMoney(offers[c.npc] ?? 0)}）` : '提出條件（魅力檢定）' }}
                </button>
              </div>
            </template>
          </article>
        </div>
        <p v-if="partyFull && bound" class="small muted">隊伍已滿（{{ maxParty }} 人）。</p>
        <p v-else-if="partyFull" class="small muted">隊伍已滿（{{ maxParty }} 人）：雇用時會先請你騰出位子（送回房子、寄放在酒館或請離隊伍）。</p>
      </template>

      <!-- 加入別人的隊伍 -->
      <template v-else-if="section === 'offers'">
        <p v-if="leader" class="small muted">你正跟著{{ leader.name }}的隊伍。想離開的話，到「隊伍」選擇離隊方式，會在下次休息時進行。</p>
        <template v-else>
          <div class="row wait">
            <button @click="game.requireRoom(1, '等待組隊', () => game.waitForParty(), true)"><GameIcon name="hourglass" :size="15" /> 等待組隊（{{ companionRules.wait_party.hours }} 小時）</button>
            <span class="small muted">機率約 {{ chance }}%，受魅力與等級影響；對方可能付簽約金給你。</span>
          </div>
          <p v-if="!offersHere.length" class="small muted">目前沒有隊伍邀請你。</p>
          <!-- 認識的固定 NPC 小隊就在身邊：請他們帶你同行 -->
          <template v-if="squadHere.length">
            <input v-model="squadText" class="wide" placeholder="怎麼說服他們帶上你（選填）" />
            <div class="cands">
              <article v-for="q in squadHere" :key="q.leader" class="cand small">
                <header>
                  <Avatar :id="q.leader" :size="44" />
                  <div><NameTag :id="q.leader" /> <span class="tag">{{ q.name }}</span><div class="muted">隊員：<template v-for="(id, i) in q.members" :key="id"><span v-if="i">、</span><NameTag :id="id" /></template></div></div>
                </header>
                <div class="row">
                  <button class="small primary" :disabled="!!squadOpt(q.leader).join.why || game.judging" @click="squadJoin(q.leader)">請他們帶你同行（魅力檢定）</button>
                  <span class="muted">{{ squadOpt(q.leader).join.why ?? `參考 DC ${squadOpt(q.leader).join.dc}（隊長的親密度、你帶的同伴數、等級差）` }}</span>
                </div>
              </article>
            </div>
          </template>
          <div class="cands">
            <article v-for="o in offersHere" :key="o.id" class="cand small">
              <header>
                <Avatar :id="o.leader" :size="44" />
                <div><NameTag :id="o.leader" /> <span class="muted">Lv.{{ npcRecord(s, o.leader)?.level }}</span><div class="muted">邀請你同行<template v-if="o.pay_cc">，願意付 {{ formatMoney(o.pay_cc) }}</template></div></div>
              </header>
              <div v-if="o.members.length" class="muted">隊員：<template v-for="(id, i) in o.members" :key="id"><span v-if="i">、</span><NameTag :id="id" /></template></div>
              <p class="bio">{{ npcRecord(s, o.leader)?.personality }}</p>
              <div class="row">
                <button class="small primary" @click="game.requireRoom(1 + o.members.length, `加入${npcRecord(s, o.leader)?.name ?? ''}的隊伍`, () => game.acceptPartyOffer(o.id), true)">加入</button>
                <button class="small" @click="game.declinePartyOffer(o.id)">婉拒</button>
              </div>
            </article>
          </div>
        </template>
      </template>

      <!-- 邀請 -->
      <template v-else-if="section === 'invite'">
        <input v-model="inviteText" class="wide" placeholder="邀請的方式（選填）" />
        <ul class="plain invite">
          <li v-for="r in inviteList" :key="r.id" class="row">
            <Avatar :id="r.id" :size="30" />
            <span class="grow"><NameTag :id="r.id" /> <span class="muted small">Lv.{{ r.level }}・親密度 {{ s.relationships?.[r.id]?.affinity }}</span>
              <template v-if="squadName(r.id)"> <span class="tag small">{{ squadName(r.id) }}（{{ squadOpt(r.id).size }} 人）</span> <span v-if="squadOpt(r.id).invite.why" class="muted small">{{ squadOpt(r.id).invite.why }}</span></template>
            </span>
            <button v-if="squadName(r.id)" class="small" :disabled="!!squadOpt(r.id).invite.why || game.judging" :title="squadOpt(r.id).invite.dc ? `參考 DC ${squadOpt(r.id).invite.dc}（每多一名隊員 +${companionRules.squad.invite_per_member}）` : ''" @click="inviteOne(r.id)">整隊邀請</button>
            <button v-else class="small" :disabled="game.judging" @click="inviteOne(r.id)">邀請</button>
          </li>
        </ul>
      </template>

      <!-- 寄放夥伴 -->
      <template v-else-if="section === 'lodge' && bound">
        <p class="small muted">主人留在這間酒館的隊員。想讓他們回到隊伍，要向{{ master?.name ?? '主人' }}提議（魅力檢定，失敗今天不能再提這個人）。</p>
        <MasterWaiting place="tavern" />
      </template>
      <template v-else-if="section === 'lodge'">
        <p class="small muted">寄放的同伴不算離隊：羈絆、契約、親密度都保留，不佔隊伍人數，會一直在這間酒館等你回來帶。不收錢；奴隸只能留在你的房子。</p>
        <h4 class="sub">在這裡等你的人</h4>
        <ul class="plain invite">
          <li v-for="m in lodgers" :key="m.id" class="row">
            <Avatar :id="m.id" :size="30" />
            <span class="grow"><NameTag :id="m.id" /></span>
            <button class="small primary" @click="game.requireRoom(1, `帶上${m.name}`, () => game.takeLodger(m.id))">帶上</button>
          </li>
          <li v-if="!lodgers.length" class="muted small">沒有人寄放在這裡。</li>
        </ul>
        <template v-if="companions.length">
          <h4 class="sub">隊伍裡的同伴</h4>
          <ul class="plain invite">
            <li v-for="m in companions" :key="m.id" class="row">
              <Avatar :id="m.id" :size="30" />
              <span class="grow"><NameTag :id="m.id" /> <span v-if="lodgeRefusal(s, m)" class="muted small">{{ lodgeRefusal(s, m) }}</span></span>
              <button class="small" :disabled="!!lodgeRefusal(s, m)" @click="game.lodgeAtTavern(m.id)">寄放在這裡</button>
            </li>
          </ul>
        </template>
      </template>

      <!-- 打聽地下街 -->
      <template v-else-if="section === 'underworld'">
        <p class="small muted">這座城有見不得光的買賣（黑市、淫鬥場、地下俱樂部……），都藏在不對外人說的地下街裡。向酒館裡的人打聽入口（魅力檢定 DC {{ askDc }}，約 {{ askHours }} 小時）；打聽到之後從酒館就能走進去。</p>
        <input v-model="askText" class="wide" placeholder="打聽的方式（選填）" />
        <button class="primary" :disabled="game.judging || !!askWhy" @click="game.perform({ kind: 'black_market', text: askText }); askText = ''; section = null">{{ askWhy ?? '打聽地下街' }}</button>
      </template>

      <!-- 被主人帶著：向主人提議去地下街 -->
      <template v-else-if="section === 'propose_underworld'">
        <p class="small muted">這座城見不得光的買賣（黑市、淫鬥場、地下俱樂部……）藏在{{ underworld?.name ?? '地下街' }}裡。身為奴隸不能自己去，可以請{{ master?.name ?? '主人' }}帶你去：魅力檢定，參考 DC {{ proposeUwDc ?? '—' }}（主人的親密度、主人的身分、契約的服從懲罰）。成功時主人今天帶你去，你也記住入口；部分成功主人帶你去但不讓你記路；失敗今天不能再提。進去之後黑市的奴隸一樣是向主人提議買下；珍品、拍賣會、淫鬥場用你自己的錢。</p>
        <input v-model="proposeUwText" class="wide" placeholder="怎麼說服主人（選填），例如：想替主人找一件好東西、聽說那裡有主人要的人" />
        <button class="primary" :disabled="game.judging || !!proposeUwWhy" @click="game.perform({ kind: 'propose', target: 'underworld', text: proposeUwText }); proposeUwText = ''; section = null">{{ proposeUwWhy ?? '向主人提議（魅力檢定）' }}</button>
      </template>

      <!-- 酒館的交易 -->
      <ShopDialog v-else-if="section === 'trade'" type="tavern" :loading="tradeLoading" />
    </AppDialog>
  </div>
</template>

<style scoped>
.sub { margin: 6px 0 0; font-size: var(--fs-sm, 0.9rem); color: var(--muted); }
.tavern { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.wide { width: 100%; margin-bottom: 8px; }
.meals { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.meal { display: grid; gap: 4px; align-content: start; padding: 10px; background: #fff8e455; border: 1px solid var(--border); border-radius: 2px; }
.meal.off { opacity: 0.55; }
.meal header { display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
.meal .price { font-weight: 700; color: var(--accent); white-space: nowrap; }
.meal p { margin: 0; }
.meal button { justify-self: start; }
.tag.good { color: var(--good); border-color: color-mix(in srgb, var(--good) 50%, transparent); }
.fed { margin-top: 10px; }
.cands { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.cand { display: grid; gap: 6px; align-content: start; padding: 12px; background: #fff8e455; border: 1px solid var(--border); border-radius: 2px; }
.cand header { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; }
.bio { margin: 0; font-family: var(--font-story); font-size: var(--fs-sm); line-height: 1.8; }
.appearance summary { cursor: pointer; color: var(--accent-2); }
.appearance p { margin: 4px 0 0; }
.vitals { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.vitals b { font-variant-numeric: tabular-nums; }
.label { color: var(--muted); }
.attr5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.attr5 > span { display: grid; justify-items: center; padding: 2px 0 1px; background: #fff8e488; border: 1px solid #c4a670; border-radius: 2px; }
.attr5 .label { font-size: var(--fs-xs); letter-spacing: 0.2em; line-height: 1.3; }
.attr5 b { font-size: 1.05rem; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.attr5 small { font-size: var(--fs-xs); color: #8a4a1e; font-weight: 700; }
.chips { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.chips .label { margin-right: 2px; }
.tag.bad { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, transparent); }
.price-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
.price-row b { color: var(--accent); font-size: var(--fs-lg); }
.nego { display: grid; gap: 4px; padding: 8px; background: var(--panel-2); border-radius: 3px; }
.nego label { display: grid; gap: 2px; }
.wait { margin-bottom: 10px; }
.wait button { display: inline-flex; align-items: center; gap: 4px; }
.invite li { gap: 8px; }
.grow { flex: 1; min-width: 0; }
</style>
