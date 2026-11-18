<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import { abilities, ATTR_IDS, attrName, conditionName, contractDef, geography, itemRules, lewdRules, LOCK_GRADES, npcs as namedNpcs, choosablePerks, perkDef, slaveryRules, stories, tagDef } from '@/engine/data'
import type { RewardEffect } from '@/engine/effects'
import { gearRules } from '@/engine/gear'
import { EFFECT_CONDITIONS, HOME_EVENT_EFFECTS, MASTER_EVENT_EFFECTS, STORY_EFFECTS } from '@/engine/storyMods'
import { LEWD_KEYS, lewdName } from '@/engine/lewd'
import { MASTER_EVENT_POOLS } from '@/engine/data'
import { oathError, oathText, TATTOO_PLACES, placeName, tattooKindName, tattooRules } from '@/engine/tattoos'
import { parasiteRules } from '@/engine/parasites'
import { useContent } from '@/stores/content'
import Hint from '../ui/Hint.vue'

// 效果的清單（任務點的結果、完成的報酬）：金錢、物品、裝備、經驗、聲望、親密度、記憶、能力、入隊、生命值
const model = defineModel<RewardEffect[] | undefined>()
// 只開放某些效果（例如地標的參訪不能讓主角淪為奴隸）；沒有時全部
// master：主人事件格式（主人事件、調教、娼館）：效果清單換成 MASTER_EVENT_EFFECTS，親密度可以選「主人」
const props = defineProps<{ types?: RewardEffect['type'][]; master?: boolean }>()
const LABELS = computed(() => (props.master ? MASTER_EVENT_EFFECTS : STORY_EFFECTS))
// 家僕的效果只在家裡的事（TravelEventEditor 的 eventHome）列出
const eventHome = inject<Ref<boolean> | undefined>('eventHome', undefined)
const effectOptions = computed(() => Object.entries(LABELS.value).filter(([t]) => (!props.types || props.types.includes(t as RewardEffect['type'])) && (eventHome?.value || !HOME_EVENT_EFFECTS.includes(t as RewardEffect['type']))))
const ALL_LABELS: Partial<Record<RewardEffect['type'], string>> = { ...STORY_EFFECTS, ...MASTER_EVENT_EFFECTS }
const masterGear = computed(() => {
  void content.version
  return itemRules.items.filter((i) => i.master_force).map((i) => i.name)
})
// 陷阱鎖：底材有雙面效應的物品（拘束具）
const restraintItems = computed(() => {
  void content.version
  return itemRules.items.filter((i) => i.gear && gearRules.bases[i.gear.base]?.bind).map((i) => i.name)
})
const content = useContent()
// 可以給的非戰鬥狀態（含自建的）
const conditionList = computed(() => {
  void content.version
  return EFFECT_CONDITIONS().map((k) => [k, conditionName(k)] as const)
})
const list = computed(() => model.value ?? [])
const storyList = computed(() => {
  void content.version
  return [...stories].sort((a, b) => Number(b.start.kind === 'manual') - Number(a.start.kind === 'manual'))
})
type Row = Record<string, unknown> & { type: RewardEffect['type'] }
const rows = computed(() => list.value as unknown as Row[])

const DEFAULTS: Partial<Record<RewardEffect['type'], () => RewardEffect>> = {
  money: () => ({ type: 'money', amount: 100 }),
  item: () => ({ type: 'item', name: '治療藥劑', qty: 1 }),
  gear: () => ({ type: 'gear', spec: { base: 'longsword', material: 'steel' } }),
  xp: () => ({ type: 'xp', amount: 50 }),
  reputation: () => ({ type: 'reputation', faction: 'local', delta: 1 }),
  affinity: () => ({ type: 'affinity', npc: namedNpcs[0]?.id ?? '', delta: 5 }),
  memory: () => ({ type: 'memory', summary: '', importance: 2 }),
  ability: () => ({ type: 'ability', target: 'pc', choices: 3 }),
  companion: () => ({ type: 'companion', npc: namedNpcs[0]?.id ?? '', mode: 'voluntary' }),
  hp: () => ({ type: 'hp', target: 'pc', ratio: -0.2 }),
  condition: () => ({ type: 'condition', target: 'pc', condition: 'blessed', add: true }),
  start_story: () => ({ type: 'start_story', story: stories.find((s) => s.start.kind === 'manual')?.id ?? stories[0]?.id ?? '' }),
  enslave_player: () => ({ type: 'enslave_player', random: {}, contract: slaveryRules.roles.default }),
  perk: () => ({ type: 'perk', perk: choosablePerks()[0]!.id }),
  lose_perk: () => ({ type: 'lose_perk', perk: choosablePerks()[0]!.id }),
  tattoo: () => ({ type: 'tattoo', template: Object.keys(tattooRules.templates)[0]! }),
  remove_tattoo: () => ({ type: 'remove_tattoo', kind: 'plain' }),
  parasite: () => ({ type: 'parasite', parasite: defaultParasite(), op: 'add' }),
  corruption: () => ({ type: 'corruption', parasite: defaultParasite(), delta: 10 }),
  lewd: () => ({ type: 'lewd', stat: 'lewdness', delta: 1 }),
  pregnancy: () => ({ type: 'pregnancy', op: 'conceive', target: eventPregnancy?.value?.companion ? '$a' : 'pc' }),
  lactation: () => ({ type: 'lactation', op: 'add', target: 'pc', days: 3 }),
  ability_pool: () => ({ type: 'ability_pool', pool: 'master', fallback: [{ type: 'lewd', stat: 'lewdness', delta: 3 }] }),
  strict: () => ({ type: 'strict', delta: 1 }),
  home_extend: () => ({ type: 'home_extend', hours: 24 }),
  staff_pause: () => ({ type: 'staff_pause', npc: '$a', days: 3 }),
  staff_wage: () => ({ type: 'staff_wage', npc: '$a', days: -1 }),
  stow_decor: () => ({ type: 'stow_decor' }),
  master_home: () => ({ type: 'master_home' }),
  force_equip: () => ({ type: 'force_equip', npc: 'master' }),
  restrain: () => ({ type: 'restrain', item: restraintItems.value[0] ?? '' }),
  flag: () => ({ type: 'flag', key: '', value: true }),
}
const parasiteIds = Object.keys(parasiteRules.parasites)
// 寄生物的發作事件裡新增的寄生物效果：預設是這件事件自己的寄生物（TravelEventEditor 提供）
const eventParasite = inject<Ref<string | undefined> | undefined>('eventParasite', undefined)
// 線索事件的登場角色（TravelEventEditor）：好感、入隊可以指定甲（$a）、乙（$b）
const eventCast = inject<Ref<number> | undefined>('eventCast', undefined)
// 懷孕的事件（TravelEventEditor）：親密度可以指定懷孕的夥伴（$a，夥伴的事件才有）與孩子的父親（$f）
// 懷孕、泌乳的事件：$a 是那位夥伴（label 是選單上的名字），father 為 false 時沒有「孩子的父親」
const eventPregnancy = inject<Ref<{ companion: boolean; label?: string; father?: boolean } | undefined> | undefined>('eventPregnancy', undefined)
function defaultParasite(): string {
  const own = eventParasite?.value
  return own && parasiteIds.includes(own) ? own : parasiteIds[0]!
}
// 刺青：圖樣，或自己描述（誓約要填屬性的加減）
const tattooTemplates = computed(() => {
  void content.version
  return Object.entries(tattooRules.templates)
})
function tattooMode(r: Row): string {
  return typeof r.template === 'string' ? r.template : `custom:${r.kind === 'oath' ? 'oath' : 'plain'}`
}
function setTattooMode(r: Row, mode: string) {
  for (const k of ['template', 'kind', 'name', 'text', 'attrs']) delete r[k]
  if (mode.startsWith('custom:')) Object.assign(r, { kind: mode.slice(7), name: '', text: '', ...(mode === 'custom:oath' ? { attrs: {} } : {}) })
  else r.template = mode
}
function oathAttrs(r: Row): Record<string, number> {
  return (r.attrs ??= {}) as Record<string, number>
}
function setOathAttr(r: Row, a: string, v: number) {
  const attrs = { ...oathAttrs(r) }
  if (v) attrs[a] = v
  else delete attrs[a]
  r.attrs = attrs
}
function removeTattooMode(r: Row): string {
  return typeof r.place === 'string' ? r.place : `kind:${r.kind ?? 'plain'}`
}
function setRemoveTattooMode(r: Row, mode: string) {
  delete r.place
  delete r.kind
  if (mode.startsWith('kind:')) r.kind = mode.slice(5)
  else r.place = mode
}
// 特質的機會：第一個特質加上其他選項
function perkOptions(r: Row): string[] {
  return (r.options as string[] | undefined) ?? []
}
function setPerkOption(r: Row, i: number, id: string) {
  const list = [...perkOptions(r)]
  if (id) list[i] = id
  else list.splice(i, 1)
  if (list.length) r.options = list
  else delete r.options
}
// 主角淪為奴隸：固定 NPC 當主人，或隨機生成（可以指定身分）
const contracts = computed(() => {
  void content.version
  return Object.keys(slaveryRules.contracts)
})
const masterTags = Object.keys(slaveryRules.master_tags.tags)
function masterMode(r: Row): 'fixed' | 'random' {
  return typeof r.master === 'string' ? 'fixed' : 'random'
}
function setMasterMode(r: Row, mode: string) {
  if (mode === 'fixed') {
    delete r.random
    r.master = namedNpcs[0]?.id ?? ''
  } else {
    delete r.master
    r.random = {}
  }
}
function randomTag(r: Row): string {
  return (r.random as { tag?: string } | undefined)?.tag ?? ''
}
function setRandomTag(r: Row, tag: string) {
  r.random = tag ? { tag } : {}
}
function add(type: RewardEffect['type']) {
  model.value = [...list.value, DEFAULTS[type]!()]
}
function remove(i: number) {
  const next = list.value.filter((_, j) => j !== i)
  model.value = next.length ? next : undefined
}
function spec(r: Row) {
  return r.spec as { base: string; material: string; rarity?: string }
}
function materialsFor(base: string) {
  const kind = gearRules.bases[base]?.kind
  return Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind)
}
function setBase(r: Row, base: string) {
  r.spec = { base, material: materialsFor(base)[0]?.[0] ?? '' }
}
</script>

<template>
  <div class="effects">
    <div v-for="(r, i) in rows" :key="i" class="row">
      <span class="tag">{{ ALL_LABELS[r.type] ?? r.type }}</span>
      <template v-if="r.type === 'money'"><input v-model.number="r.amount" type="number" class="num" />白鸛幣（負數為花費）</template>
      <template v-else-if="r.type === 'item'">
        <input v-model="r.name" list="cv-item-names" class="grow" placeholder="物品名稱" />
        ×<input v-model.number="r.qty" type="number" class="num" title="負數為交出" />
      </template>
      <template v-else-if="r.type === 'gear'">
        <select :value="spec(r).base" @change="setBase(r, ($event.target as HTMLSelectElement).value)">
          <option v-for="(b, id) in gearRules.bases" :key="id" :value="id">{{ b.name }}</option>
        </select>
        <select v-model="spec(r).material">
          <option v-for="[id, m] in materialsFor(spec(r).base)" :key="id" :value="id">{{ m.name }}</option>
        </select>
        <input v-model="r.name" maxlength="20" placeholder="名稱（選填）" />
        <input v-model="r.desc" maxlength="80" class="grow" placeholder="描述（選填）" />
      </template>
      <template v-else-if="r.type === 'xp'"><input v-model.number="r.amount" type="number" min="0" class="num" />點（全隊）</template>
      <template v-else-if="r.type === 'reputation'">
        <select v-model="r.faction">
          <option value="local">（所在地的勢力）</option>
          <option v-for="f in geography.factions" :key="f.id" :value="f.id">{{ f.name }}</option>
          <option v-if="r.faction && r.faction !== 'local' && !geography.factions.some((f) => f.id === r.faction)" :value="r.faction">{{ r.faction }}（不在勢力清單）</option>
        </select>
        <input v-model.number="r.delta" type="number" class="num" />
      </template>
      <template v-else-if="r.type === 'affinity' || r.type === 'companion'">
        <select v-model="r.npc">
          <option v-if="master && r.type === 'affinity'" value="master">主人</option>
          <option v-if="eventPregnancy?.companion || (r.npc === '$a' && eventPregnancy)" value="$a">{{ eventPregnancy?.label ?? '懷孕的夥伴' }}</option>
          <option v-if="(eventPregnancy && eventPregnancy.father !== false) || r.npc === '$f'" value="$f">孩子的父親</option>
          <option v-if="!eventPregnancy && ((eventCast ?? 0) >= 1 || r.npc === '$a')" value="$a">登場角色甲</option>
          <option v-if="(eventCast ?? 0) >= 2 || r.npc === '$b'" value="$b">登場角色乙</option>
          <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
        <input v-if="r.type === 'affinity'" v-model.number="r.delta" type="number" class="num" />
        <input v-if="r.type === 'affinity'" v-model="r.reason" maxlength="40" placeholder="原因（選填）" />
        <select v-else v-model="r.mode">
          <option value="voluntary">自願入隊</option>
          <option value="hired">雇傭入隊</option>
        </select>
      </template>
      <template v-else-if="r.type === 'memory'"><input v-model="r.summary" class="grow" maxlength="200" placeholder="記下的事（之後給 AI 參考）" /></template>
      <template v-else-if="r.type === 'ability'">
        <select v-model="r.ability">
          <option :value="undefined">升級時的三選一</option>
          <option v-for="a in Object.values(abilities)" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </template>
      <template v-else-if="r.type === 'start_story'">
        <select v-model="r.story" class="grow">
          <option v-for="s in storyList" :key="s.id" :value="s.id">{{ s.title }}{{ s.start.kind === 'manual' ? '（只由其他事件開啟）' : '' }}</option>
        </select>
        <span class="small muted">已經開始過就略過；不看接取條件</span>
      </template>
      <template v-else-if="r.type === 'enslave_player'">
        <select :value="masterMode(r)" @change="setMasterMode(r, ($event.target as HTMLSelectElement).value)">
          <option value="fixed">固定 NPC 當主人</option>
          <option value="random">隨機的 NPC 當主人</option>
        </select>
        <select v-if="masterMode(r) === 'fixed'" v-model="r.master">
          <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
        <select v-else :value="randomTag(r)" @change="setRandomTag(r, ($event.target as HTMLSelectElement).value)">
          <option value="">任何身分（依奴隸市場的權重）</option>
          <option v-for="t in masterTags" :key="t" :value="t">{{ tagDef(t)?.name ?? t }}</option>
        </select>
        打算刻
        <select v-model="r.contract">
          <option v-for="c in contracts" :key="c" :value="c">{{ contractDef(c).name }}</option>
        </select>
        <span class="small muted">之後還有刻印檢定；已經是奴隸時改成換主人（印記沿用）；老鴇一律刻娼妓契約</span>
      </template>
      <template v-else-if="r.type === 'perk' || r.type === 'lose_perk'">
        <select v-model="r.perk">
          <option v-for="p in choosablePerks()" :key="p.id" :value="p.id">{{ p.name }}{{ p.flaw ? '（缺陷）' : '' }}</option>
        </select>
        <span v-if="r.type === 'perk' && perkDef(String(r.perk ?? ''))?.flaw" class="small muted">缺陷：直接染上 <Hint text="不是機會，不能選也不能爭取。" /></span>
        <span v-else-if="r.type === 'lose_perk' && perkDef(String(r.perk ?? ''))?.flaw" class="small muted">克服這個缺陷</span>
        <template v-if="r.type === 'perk' && !perkDef(String(r.perk ?? ''))?.flaw">
          <select v-for="(id, i) in perkOptions(r)" :key="i" :value="id" @change="setPerkOption(r, i, ($event.target as HTMLSelectElement).value)">
            <option value="">（拿掉）</option>
            <option v-for="p in choosablePerks().filter((x) => !x.flaw)" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-if="!r.direct && perkOptions(r).length < 5" :value="''" @change="setPerkOption(r, perkOptions(r).length, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
            <option value="">＋ 再提供一個…</option>
            <option v-for="p in choosablePerks().filter((x) => !x.flaw)" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label class="check small"><input v-model="r.direct" type="checkbox" /> 直接學會（不給選擇）</label>
          <span v-if="!r.direct" class="small muted">玩家從中選一個，或寫一段說法擲骰交給 AI</span>
        </template>
      </template>
      <template v-else-if="r.type === 'tattoo'">
        <select :value="tattooMode(r)" @change="setTattooMode(r, ($event.target as HTMLSelectElement).value)">
          <optgroup v-for="k in (['plain', 'oath'] as const)" :key="k" :label="tattooKindName(k)">
            <option v-for="[id, t] in tattooTemplates.filter(([, x]) => x.kind === k)" :key="id" :value="id">{{ t.name }}{{ t.attrs ? `（${oathText(t.attrs)}）` : '' }}</option>
          </optgroup>
          <option value="custom:plain">自己描述（普通刺青）</option>
          <option value="custom:oath">自己描述（誓約印記）</option>
        </select>
        <select :value="r.place ?? ''" @change="($event.target as HTMLSelectElement).value ? (r.place = ($event.target as HTMLSelectElement).value) : delete r.place">
          <option value="">部位：圖樣建議的空位</option>
          <option v-for="p in TATTOO_PLACES" :key="p" :value="p">{{ placeName(p) }}</option>
        </select>
        <template v-if="typeof r.template !== 'string'">
          <input v-model="r.name" maxlength="20" placeholder="名稱" />
          <input v-model="r.text" class="grow" maxlength="160" placeholder="外觀描述" />
          <template v-if="r.kind === 'oath'">
            <label v-for="a in ATTR_IDS" :key="a" class="small">{{ attrName(a) }}
              <input type="number" class="num" min="-3" max="3" :value="oathAttrs(r)[a] ?? 0" @input="setOathAttr(r, a, Number(($event.target as HTMLInputElement).value))" />
            </label>
            <span class="small" :class="oathError(oathAttrs(r)) ? 'warn' : 'muted'">{{ oathError(oathAttrs(r)) ?? '加減平衡' }}</span>
          </template>
        </template>
        <input v-model="r.by" maxlength="20" placeholder="誰刺的（選填）" />
        <span class="small muted">部位已經有刺青、身上沒有空位或誓約太多時不刺</span>
      </template>
      <template v-else-if="r.type === 'remove_tattoo'">
        <select :value="removeTattooMode(r)" @change="setRemoveTattooMode(r, ($event.target as HTMLSelectElement).value)">
          <option value="kind:plain">所有普通刺青</option>
          <option value="kind:oath">所有誓約印記</option>
          <option v-for="p in TATTOO_PLACES" :key="p" :value="p">{{ placeName(p) }}的刺青</option>
        </select>
        <span class="small muted">奴隸印記不會被洗掉（要解除契約）</span>
      </template>
      <template v-else-if="r.type === 'parasite' || r.type === 'corruption'">
        <select v-model="r.parasite"><option v-for="p in parasiteIds" :key="p" :value="p">{{ parasiteRules.parasites[p]!.name }}</option></select>
        <select v-if="r.type === 'parasite'" v-model="r.op"><option value="add">寄生</option><option value="tame">馴服</option><option value="remove">拿掉</option></select>
        <template v-else><input v-model.number="r.delta" type="number" min="-100" max="100" class="num" />點</template>
        <Hint :text="r.type === 'parasite' ? '對象是主角。寄生：寄生裝備穿上並鎖住、淫紋刻在設定的部位（已經有同一種、或那個部位是奴隸印記時不寄生）；馴服：換成馴服後的物品或印記，不再自動發作；拿掉：寄生物離開身體。' : '主角身上這個寄生物的侵蝕度加減（0～100，決定階段）；沉睡或已馴服時不變。'" />
      </template>
      <template v-else-if="r.type === 'lewd'">
        <select v-model="r.stat"><option v-for="k in LEWD_KEYS" :key="k" :value="k">{{ lewdName(k) }}</option></select>
        <input v-model.number="r.delta" type="number" min="-100" max="100" class="num" />
        <Hint text="主角的慾望指標（docs/LEWD_STATS.md）；曝露名聲記在目前的地區。" />
      </template>
      <template v-else-if="r.type === 'pregnancy'">
        <select v-model="r.op"><option value="conceive">受孕</option><option value="reveal">察覺</option></select>
        <select v-model="r.target">
          <option value="pc">主角</option>
          <option v-if="eventPregnancy?.companion || r.target === '$a'" value="$a">{{ eventPregnancy?.label ?? '懷孕的夥伴' }}</option>
          <option v-if="(eventCast ?? 0) >= 1 && !eventPregnancy" value="$a">登場角色甲</option>
          <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
        <template v-if="r.op === 'conceive'">
          父親
          <select :value="r.father ?? ''" @change="r.father = ($event.target as HTMLSelectElement).value || undefined">
            <option value="">不明（或只寫名字）</option>
            <option value="pc">主角</option>
            <option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option>
          </select>
          <input v-if="!r.father" v-model="r.father_name" maxlength="16" placeholder="父親的名字（選填）" />
        </template>
        <Hint text="受孕一定成立（不擲機率）；內容篩選關掉「懷孕」、對象的身體不會懷孕、已經懷孕或剛生完時不做。任務或事件要勾「懷孕」內容標籤。" />
      </template>
      <template v-else-if="r.type === 'lactation'">
        <select v-model="r.op"><option value="add">泌乳</option><option value="remove">停止泌乳</option></select>
        <select v-model="r.target">
          <option value="pc">主角</option>
          <option v-if="eventPregnancy?.companion || r.target === '$a'" value="$a">{{ eventPregnancy?.label ?? '懷孕的夥伴' }}</option>
        </select>
        <template v-if="r.op === 'add'"><input v-model.number="r.days" type="number" min="1" max="60" class="num" />天</template>
        <Hint text="內容篩選關掉「泌乳」、對象的身體不會泌乳時不做；停止只拿掉事件與道具的泌乳（懷孕的不行）。任務或事件要勾「泌乳」內容標籤。" />
      </template>
      <template v-else-if="r.type === 'ability_pool'">
        <select v-model="r.pool"><option v-for="(n, k) in MASTER_EVENT_POOLS" :key="k" :value="k">{{ n }}</option></select>
        <span class="small muted">從這個事件庫掛的技能抽一個還沒學的；都學過時：</span>
        <EffectsEditor v-model="(r as Record<string, unknown>).fallback as RewardEffect[] | undefined" :master="master" :types="['money', 'xp', 'lewd', 'affinity', 'memory']" />
      </template>
      <template v-else-if="r.type === 'strict'"><input v-model.number="r.delta" type="number" min="-5" max="5" class="num" />點 <Hint text="出門與出城的 DC 加減（主人的家）。" /></template>
      <template v-else-if="r.type === 'staff_pause'"><input v-model.number="r.days" type="number" min="1" max="30" class="num" />天 <Hint text="這件事的家僕（或做家務的奴隸）請假：這幾天效果停掉（女僕不加舒適度、廚師不做早餐……），工錢照算。" /></template>
      <template v-else-if="r.type === 'staff_wage'"><input v-model.number="r.days" type="number" min="-7" max="7" class="num" />天 <Hint text="負的是扣這位家僕幾天工錢（當作已經付了）；正的是多給幾天（從身上的錢付）。做家務的奴隸沒有工錢，不做。" /></template>
      <template v-else-if="r.type === 'stow_decor'"><Hint text="房子裡隨機一件裝飾家具（只有舒適度、沒有功能的）收回行囊，要再擺回去：打破了花瓶這類事，不會真的壞掉。沒有裝飾家具時不做。" /></template>
      <template v-else-if="r.type === 'home_extend'"><input v-model.number="r.hours" type="number" class="num" />小時</template>
      <template v-else-if="r.type === 'master_home'"><span class="small muted">把主角帶回主人的家（沒有家時沒事）</span></template>
      <template v-else-if="r.type === 'force_equip'">
        <select :value="r.item ?? ''" @change="($event.target as HTMLSelectElement).value ? (r.item = ($event.target as HTMLSelectElement).value) : delete r.item">
          <option value="">隨機挑一件主人會用的</option>
          <option v-for="n in masterGear" :key="n" :value="n">{{ n }}</option>
        </select>
        <span class="small muted">主人替主角裝上並鎖住，契約還在時拿不下來</span>
      </template>
      <template v-else-if="r.type === 'restrain'">
        <select v-model="r.item">
          <option v-if="r.item && !restraintItems.includes(r.item as string)" :value="r.item">{{ r.item }}（不是拘束具）</option>
          <option v-for="n in restraintItems" :key="n" :value="n">{{ n }}</option>
        </select>
        <select :value="r.lock ?? 'white'" @change="($event.target as HTMLSelectElement).value === 'white' ? delete r.lock : (r.lock = ($event.target as HTMLSelectElement).value)">
          <option v-for="g in LOCK_GRADES" :key="g" :value="g">{{ lewdRules.locks.grades[g].name }}</option>
        </select>
        <Hint text="把這件拘束具戴到主角身上、用這種鎖鎖住（不用契約，離開地下城也還鎖著）：要脫縛、用鑰匙或找鐵匠剪鎖才拿得下來，拿下後歸主角。內容篩選關掉「主角非自願」時不生效。" />
      </template>
      <template v-else-if="r.type === 'flag'">
        <input v-model="r.key" maxlength="40" placeholder="旗標" />
        <select v-model="r.value"><option :value="true">設定</option><option :value="false">清除</option></select>
      </template>
      <template v-else-if="r.type === 'condition'">
        <select v-model="r.add"><option :value="true">得到</option><option :value="false">去掉</option></select>
        <select v-model="r.condition"><option v-for="[k, n] in conditionList" :key="k" :value="k">{{ n }}</option></select>
        <select v-if="master" v-model="r.target"><option value="pc">主角</option><option value="master">對方</option></select>
        <Hint :text="master ? '對象是主角，或事件的對方（主人事件的主人；調教、奴隸找你的那位奴隸）。調教與娼館的事件裡，寫主角的會給事件的主角（被調教、接客的人）。多半持續到下次長休。' : '對象是主角；多半持續到下次長休。'" />
      </template>
      <template v-else-if="r.type === 'hp'">
        <template v-if="r.amount !== undefined">
          <input v-model.number="r.amount" type="number" class="num" />點生命值{{ master ? "" : "（主角）" }}
        </template>
        <template v-else>
          <input type="number" class="num" :value="Math.round(Number(r.ratio ?? 0) * 100)" @input="r.ratio = Number(($event.target as HTMLInputElement).value) / 100" />% 最大生命值{{ master ? "" : "（主角）" }}
        </template>
        <select v-if="master" v-model="r.target"><option value="pc">主角</option><option value="master">對方</option></select>
        <select v-if="master" :value="r.amount !== undefined ? 'amount' : 'ratio'" @change="($event.target as HTMLSelectElement).value === 'amount' ? (delete r.ratio, r.amount = -3) : (delete r.amount, r.ratio = -0.2)">
          <option value="ratio">比例</option>
          <option value="amount">點數</option>
        </select>
      </template>
      <button class="small x" @click="remove(i)" title="移除">✕</button>
    </div>
    <select class="small" :value="''" @change="add(($event.target as HTMLSelectElement).value as RewardEffect['type']); ($event.target as HTMLSelectElement).value = ''">
      <option value="">＋ 效果…</option>
      <option v-for="[t, n] in effectOptions" :key="t" :value="t">{{ n }}</option>
    </select>
  </div>
</template>

<style scoped src="./editor.css"></style>
<style scoped>
.effects { display: grid; gap: 4px; }
</style>
