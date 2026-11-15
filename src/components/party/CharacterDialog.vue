<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  abilityQuality, apMaxFor, attrsOf, carriedAbilities, castingAttr, countsForLoadout, evadeFloor, gearAffinities, hasRerollPool, luckyThreshold, mod, proficiency, rerollsLeft, weaponFor, xpToNext,
} from '@/engine/character'
import { fieldCombatBonuses } from '@/engine/combat'
import { abilityDef, armorDef, attributeRules, attrName, classDef, damageTypeName, genderName, locationById, progression, slaveryRules, statusDef, tagDef } from '@/engine/data'
import { XP_SINKS, xpSinkBlocked, xpSinkCost, xpSinkName } from '@/engine/xpSinks'
import PcTagPicker from '../PcTagPicker.vue'
import { isNoncombatant } from '@/engine/party'
import { perksOf } from '@/engine/perks'
import { bandName, exposureAt, exposureLevel, forcedSubmission, gearLewd, LEWD_STATS, lewdName, lewdOf, lewdTitles, vacuumBonus, vacuumSides, VACUUM_TEXT, lewdPower } from '@/engine/lewd'
import { encounterText, sexRecordItems, sexRecordOf, virginWord } from '@/engine/sexRecord'
import { pregnancyLine } from '@/engine/pregnancy'
import { lactationLine, milkBlock } from '@/engine/lactation'
import { postpartumMaxHp, pregnancyTwoFace } from '@/engine/pregCombat'
import { pregnancyStageName } from '@/engine/pregMarks'
import { lactationSensitivity } from '@/engine/lewd'
import { bindLabel, bindsOf, hasMaster, lockName, schoolDef, schoolName, schoolsOf, twoFaceCombat } from '@/engine/schools'
import { isOwnSlave } from '@/engine/ownedSlaves'
import { MOD_NAME } from '@/engine/gear'
import { gameRule } from '@/engine/gameRules'
import { useGame } from '@/stores/game'
import { useSettings } from '@/stores/settings'
import { flash, floatText } from '@/fx/fx'
import { freshKeys, stateKey } from '@/fx/seen'
import AppDialog from '../AppDialog.vue'
import BodyFigure from './BodyFigure.vue'
import { characterBody } from '@/engine/look'
import { BODIES, BODY_NAME, type Body } from '@/engine/traits'
import ContentIcon from '../icons/ContentIcon.vue'
import PortraitBox from '../PortraitBox.vue'
import Avatar from '../ui/Avatar.vue'
import GameIcon from '../ui/GameIcon.vue'
import AbilityCategoryChips from '../ui/AbilityCategoryChips.vue'
import { abilityCategory, abilityCategoryName } from '@/engine/abilityCategory'
import type { AbilityCategoryId } from '@/engine/data'
import Hint from '../ui/Hint.vue'
import StatGrid, { type StatItem } from '../ui/StatGrid.vue'
import PaperDoll from './PaperDoll.vue'
import TattooMap from './TattooMap.vue'
import ParasitePane from './ParasitePane.vue'
import { activeParasites, parasiteDef, parasitesOf, parasiteTwoFace } from '@/engine/parasites'
import { abilityMeta, affinityText, attrNote, CHAR_TABS, contractFor, groupedAbilities, QUALITY_NAME, signed, slotsText, TYPE_NAME, type CharTab } from './memberInfo'
import SwipeTabs from '../mobile/SwipeTabs.vue'
import { isMobile } from '../mobile/mobile'

// 角色詳情：分頁（屬性與戰鬥、特質、裝備、刺青、寄生物、角色設定、能力），頂部切換角色
const props = defineProps<{ open: boolean; member: string; tab: CharTab }>()
const emit = defineEmits<{ close: []; 'update:member': [id: string]; 'update:tab': [tab: CharTab] }>()
type CharTabDef = (typeof CHAR_TABS)[number]
const game = useGame()
const settings = useSettings()
const s = computed(() => game.state!)
const inCombat = computed(() => !!s.value.combat)
const m = computed(() => s.value.party.find((x) => x.id === props.member) ?? s.value.party[0]!)
// 寄生物：只有身上有的時候
const tabs = computed(() => CHAR_TABS.filter((t) => (t.id !== 'parasites' || !!parasitesOf(m.value).length)
  && (!isNoncombatant(m.value) || (t.id !== 'abilities' && (t.id !== 'gear' || !!m.value.gear)))))
// 分頁不適用這個角色時（例如非戰鬥人員的能力）回到「屬性與戰鬥」：開啟、換角色、換分頁時都檢查
watch([tabs, () => props.tab, () => props.open], () => {
  if (props.open && !tabs.value.some((t) => t.id === props.tab)) emit('update:tab', 'stats')
}, { immediate: true })

const b = computed(() => fieldCombatBonuses(game.state, m.value))
const sources = (parts: { src: string; v: number }[]) => parts.map((p) => `${p.src} ${signed(p.v)}`).join('・')
const combat = computed<StatItem[]>(() => {
  const x = m.value
  const w = weaponFor(x)
  const a = armorDef(x.armor)
  return [
    { label: '行動點', value: apMaxFor(x.level, attrsOf(x)), note: `每回合 +${b.value.ap_regen.total}${b.value.ap_regen.parts.length > 1 ? `（${sources(b.value.ap_regen.parts)}）` : ''}` },
    { label: '法術環', value: slotsText(x) },
    ...(classDef(x.class).caster !== 'none' ? [{ label: '施法屬性', value: attrName(castingAttr(x.class)), note: `熟練 +${proficiency(x.level)}` }] : []),
    { label: '幸運一擊', value: `自然骰 ${luckyThreshold(attrsOf(x), gearAffinities(x).mods.crit ?? 0)} 以上`, hint: '擲出這個數字以上的自然骰時，傷害加倍' },
    { label: '武器', value: w.name, note: `${w.dice} ${damageTypeName(w.type)}・${attrName(w.attr)}` },
    { label: '防具', value: a.name, note: `迴避 ${signed(a.evade)}・物理減傷 ${a.dr}` },
    // 命中、迴避……的加值與來源（裝備、特質、非戰鬥狀態都算在這裡；戰鬥中的狀態另外算）
    { label: '命中', value: `d20 ${signed(b.value.hit.total)}`, note: sources(b.value.hit.parts), hint: '攻擊擲 d20 加上這些，達到對方的迴避就命中。慾望戰鬥的加成另計。' },
    { label: '迴避', value: `d20 ${signed(b.value.evade.total)}`, note: `骰子最低 ${evadeFloor(attrsOf(x))}${b.value.evade.parts.length ? `・${sources(b.value.evade.parts)}` : ''}`, hint: '被攻擊時擲 d20（低於下限時算下限）加上這些，就是對方要達到的數字。慾望戰鬥的加成另計。' },
    ...(b.value.damage.total ? [{ label: '傷害加成', value: signed(b.value.damage.total), note: sources(b.value.damage.parts) }] : []),
    { label: '減傷', value: b.value.dr.total, note: sources(b.value.dr.parts), hint: '防具與裝備的減傷只擋物理傷害；特質與狀態的擋所有傷害。慾望戰鬥的加成另計。' },
    ...(b.value.save.total ? [{ label: '豁免加成', value: signed(b.value.save.total), note: sources(b.value.save.parts) }] : []),
    { label: '傷害倍率', value: affinityText(x) },
  ]
})

// 性經歷（docs/LEWD_STATS.md 第 29 節）：主角記在 pc，其他人用自己的 id
const sexId = computed(() => (m.value.isPlayer ? 'pc' : m.value.id))
const sexRec = computed(() => sexRecordOf(s.value, sexId.value))
// 懷孕（察覺之後）與產後虛弱（docs/FAMILY.md 第 4.4 節）
const pregLine = computed(() => pregnancyLine(s.value, sexId.value))
// 泌乳（docs/FAMILY.md 第 10 節）
const lactLine = computed(() => lactationLine(s.value, m.value))
// 擠奶（一天一次）：只有隊伍裡的人
const milkWhy = computed(() => (s.value.party.some((x) => x.id === m.value.id) ? milkBlock(s.value, m.value) : '不在隊伍裡'))
const sexItems = computed<StatItem[]>(() => sexRecordItems(s.value, sexId.value).map((x) => ({ label: x.label, value: x.value, ...(x.value.length > 12 ? { wide: true } : {}) })))
const sexDraft = reactive({ virgin: true, partners: 0, times: 0, servicePartners: 0, serviceTimes: 0, solo: 0, favorite: '', notes: '' })
function resetSexDraft() {
  const r = sexRec.value
  Object.assign(sexDraft, { virgin: r.virgin, partners: r.partners, times: r.times, servicePartners: r.servicePartners, serviceTimes: r.serviceTimes, solo: r.solo ?? 0, favorite: r.favorite ?? '', notes: r.notes ?? '' })
}
function saveSex() {
  game.editSexRecord(sexId.value, { ...sexDraft })
  game.flash('已更新性經歷')
}
function clearSex() {
  if (!confirm(`清掉${m.value.name}的性經歷記錄（含最近三次），回到初始值？`)) return
  game.editSexRecord(sexId.value, null)
  resetSexDraft()
}

// 主角自己的奴隸：契約、調教與能對他做的事在「我的奴隸」（OwnedSlavesDialog.vue）
const ownSlave = computed(() => isOwnSlave(s.value, m.value))
function openSlaves() {
  window.dispatchEvent(new CustomEvent('elondia:open-slaves', { detail: m.value.id }))
  emit('close')
}

// 慾望指標：有效值（括號是裝備的加減）、分段；曝露名聲看目前的地區
const lewdItems = computed<StatItem[]>(() => {
  const x = m.value
  const v = lewdOf(x)
  const gear = gearLewd(x)
  const items: StatItem[] = LEWD_STATS.map((k) => ({
    label: lewdName(k),
    value: v[k],
    note: `${bandName(k, v[k], k === 'submission' && forcedSubmission(x))}${gear[k] ? `（裝備 ${signed(gear[k])}）` : ''}${v[k] > 100 ? `・效力 ${lewdPower(v[k])}（超過 100 的部分遞減）` : ''}`,
  }))
  const region = locationById(s.value.location).region
  const exp = exposureAt(s.value, x.id, region)
  const vac = vacuumSides(x)
  const vacNote = vac.length ? `（真空${vacuumBonus(x) ? ` +${vacuumBonus(x)}` : ''}：${vac.map((v) => VACUUM_TEXT[v]).join('、')}）` : ''
  items.push({ label: lewdName('exposure'), value: exp, note: `${bandName('exposure', exp)}・身上的曝露度 ${exposureLevel(x)}${vacNote}` })
  // 流派與雙面效應（docs/LEWD_STATS.md 第 6、7 節）
  const schools = schoolsOf(x)
  const pitch = schools.map((id) => `${schoolName(id)}：${schoolDef(id)?.pitch ?? ''}`).join(' ')
  const servant = schools.includes('servitude') ? (hasMaster(x) ? '（有主人：隸從派全效）' : '（沒有主人：隸從派一半效果）') : ''
  items.push({ label: '流派', value: schools.length ? schools.map(schoolName).join('、') : '沒有', note: schools.length ? `${pitch}${servant}` : '向各流派的老師學，或讀秘法書', wide: schools.length > 0 })
  const binds = bindsOf(x)
  if (binds.length) {
    const tf = twoFaceCombat(x, s.value)
    items.push({
      label: '拘束',
      value: binds.map((b) => `${b.name}（${bindLabel(b.kind, b.bind)}${b.lock ? `・${lockName(b.lock)}` : ''}）`).join('、'),
      note: tf.active.length ? `戰鬥中：${twoFaceText(tf)}` : schools.length ? '鎖上之後戰鬥中才有增益' : '沒修流派：只有平常的檢定減值',
    })
  }
  // 寄生類的雙面效應（第 14.1 節）
  const wild = activeParasites(x).filter((p) => !p.tamed)
  if (wild.length) {
    const pt = parasiteTwoFace(x)
    const parts = Object.entries(pt.mods).filter(([, n]) => n).map(([k, n]) => `${MOD_NAME[k] ?? k} ${signed(n ?? 0)}`)
    if (pt.lustBonus) parts.push(`造成的慾望 ${signed(pt.lustBonus)}`)
    items.push({
      label: '寄生',
      value: pt.active.length ? pt.active.map((a) => `${a.name}（${a.stage}${a.mult !== 1 ? `・×${a.mult}` : ''}）`).join('、') : wild.map((p) => parasiteDef(p.id)?.name ?? p.id).join('、'),
      note: parts.length ? `戰鬥中：${parts.join('・')}` : schools.length ? '還在潛伏：戰鬥中沒有加成' : '沒修流派：只有平常的檢定減值',
      wide: true,
    })
  }
  // 懷孕的雙面效應與產後虛弱（docs/FAMILY.md 第 4.3、6 節）
  if (x.pregMark?.known && x.pregMark.stage && x.pregMark.stage !== 'hidden') {
    const pf = pregnancyTwoFace(x)
    const parts = Object.entries(pf.mods).filter(([, n]) => n).map(([k, n]) => `${MOD_NAME[k] ?? k} ${signed(n ?? 0)}`)
    const down = Object.entries(pf.allyDown ?? {}).filter(([, n]) => n).map(([k, n]) => `${MOD_NAME[k] ?? k} ${signed(n ?? 0)}`)
    if (down.length) parts.push(`有隊友倒下時${down.join('、')}`)
    items.push({ label: '懷孕', value: pregnancyStageName(x.pregMark.stage), note: parts.length ? `戰鬥中：${parts.join('・')}` : schools.length ? '' : '沒修流派：只有平常的檢定減值', wide: true })
  }
  if (x.pregMark?.postpartum) items.push({ label: '產後虛弱', value: `生命上限 ×${postpartumMaxHp(x)}`, note: '戰鬥中；所有檢定 -1', wide: true })
  // 稱號（第 28 節，只是稱號）
  const titles = lewdTitles(s.value, x)
  if (titles.length) items.push({ label: '稱號', value: titles.map((t) => t.name).join('、'), note: titles.map((t) => t.desc).join(' '), wide: true })
  return items
})

function twoFaceText(tf: ReturnType<typeof twoFaceCombat>): string {
  const parts = Object.entries(tf.mods).filter(([, v]) => v).map(([k, v]) => `${MOD_NAME[k] ?? k} ${signed(v ?? 0)}`)
  if (tf.initiative) parts.unshift(`先攻 ${signed(tf.initiative)}`)
  if (tf.immune.length) parts.push(`免疫${tf.immune.map((id) => statusDef(id).name).join('、')}`)
  return parts.join('・')
}

// ---- 主角設定 ----
// ── 特效：加屬性點時數字彈一下；選中的能力卡發光、在能力清單裡翻面出現；新學會的特質卡翻過來
const popped = ref('')
let popTimer: ReturnType<typeof setTimeout> | undefined
// 多出來的經驗的用途（xpSinks.ts）：鑽研特質、苦練屬性（20 級以上）、鑽研技能；花費各自翻倍
const XP_SINK_HINT = (() => {
  const r = progression.xp_sinks
  return `多出來的經驗可以換：${r.perk.name}（一次學特質的機會，三選一或寫說法交給 AI）、${r.attr.name}（${r.attr.min_level} 級以上，一點屬性點）、${r.ability.name}（多學一個技能，三選一）。每換一次，那一種的花費就乘上倍率，三種各算各的；起始花費與倍率在設定的遊戲規則（成長）調整。經驗從目前的進度扣，還沒滿級時會延後升級。`
})()
function spend(attr: string) {
  game.spendAttr(m.value.id, attr as Parameters<typeof game.spendAttr>[1])
  popped.value = ''
  clearTimeout(popTimer)
  requestAnimationFrame(() => (popped.value = attr))
  popTimer = setTimeout(() => (popped.value = ''), 500)
}
// 技能攜帶上限（存檔規則）：攜帶中的技能與法術；戲法不算
const loadoutCap = computed(() => gameRule(s.value, 'skillLoadout'))
const carried = computed(() => new Set(carriedAbilities(m.value, loadoutCap.value)))
const carriedCount = computed(() => m.value.abilities.filter((id) => countsForLoadout(id) && carried.value.has(id)).length)
// 能力的分類按鈕與「只看攜帶中」（engine/abilityCategory.ts）
const abCat = ref<AbilityCategoryId | ''>('')
const onlyCarried = ref(false)
const abilityDefs = computed(() => m.value.abilities.map(abilityDef))
const shownGroups = computed(() => groupedAbilities(m.value)
  .map((g) => ({ ...g, items: g.items.filter((a) => (!abCat.value || abilityCategory(a) === abCat.value) && (!onlyCarried.value || carried.value.has(a.id))) }))
  .filter((g) => g.items.length))
const learned = ref('')
function pick(e: MouseEvent, id: string) {
  const el = e.currentTarget as HTMLElement
  flash(el, '#ffd34d', true)
  floatText(el, '習得！', { color: '#ffd34d', top: true })
  learned.value = id
  game.chooseAbility(m.value.id, id)
}
const newPerks = computed(() => freshKeys(`perks:${stateKey(game.state)}:${m.value.id}`, perksOf(m.value).map((p) => p.id)))
const editingProfile = ref(false)
const profile = reactive<{ gender: string; appearance: string; background: string; body: Body | '' }>({ gender: '', appearance: '', background: '', body: '' })
function startProfile() {
  profile.gender = m.value.gender ?? ''
  profile.body = m.value.body ?? ''
  profile.appearance = m.value.appearance ?? ''
  profile.background = m.value.background ?? ''
  editingProfile.value = true
}
function saveProfile() {
  game.editProfile({ ...profile })
  editingProfile.value = false
}
watch(() => props.member, () => (editingProfile.value = false, editingTags.value = false))
// 主角的身分標籤：存檔規則允許時可以更換
const editingTags = ref(false)
const tagDraft = ref<string[]>([])
const canChangeTags = computed(() => !!game.state?.options?.tagChange)
function startTags() {
  tagDraft.value = [...(m.value.tags ?? [])]
  editingTags.value = true
}
function saveTags() {
  game.setPcTags(tagDraft.value)
  editingTags.value = false
}
</script>

<template>
  <AppDialog :open="open" title="角色詳情" icon="user" width="1120px" fixed @close="emit('close')">
    <div class="who">
      <button v-for="x in s.party" :key="x.id" :class="{ on: x.id === m.id }" @click="emit('update:member', x.id)">
        <Avatar :id="x.id" :size="26" />{{ x.name }}
      </button>
    </div>
    <nav v-if="!isMobile" class="tabs">
      <button v-for="t in tabs" :key="t.id" :class="{ on: t.id === tab }" @click="emit('update:tab', t.id)">
        <GameIcon :name="t.icon" :size="15" />{{ t.label }}
        <span v-if="(t.id === 'abilities' && m.pendingAbilityChoices?.length) || (t.id === 'stats' && m.attrPoints > 0)" class="dot" />
      </button>
    </nav>
    <!-- 手機版：分頁可以左右滑（SwipeTabs 自己畫分頁列）；電腦版只畫目前的分頁 -->
    <SwipeTabs :tabs="tabs" :model-value="tab" :swipe="isMobile" :bar="isMobile" @update:model-value="emit('update:tab', $event as CharTab)">
      <template #tab="{ tab: t }">
        <GameIcon :name="(t as CharTabDef).icon" :size="14" />{{ t.label }}
        <span v-if="(t.id === 'abilities' && m.pendingAbilityChoices?.length) || (t.id === 'stats' && m.attrPoints > 0)" class="dot" />
      </template>
      <template #default="{ id }">
        <!-- 屬性與戰鬥 -->
        <section v-if="id === 'stats'" class="pane two">
          <div>
            <div v-if="!isNoncombatant(m)" class="level">
              <b>Lv.{{ m.level }}</b>
              <div class="bar xp"><span :style="{ width: `${m.level >= 20 ? 100 : Math.min(100, (m.xp / xpToNext(m.level)) * 100)}%` }" /></div>
              <span class="num">{{ m.level >= 20 ? `EXP ${m.xp}（滿級）` : `EXP ${m.xp} / ${xpToNext(m.level)}` }}</span>
            </div>
            <div v-if="!isNoncombatant(m)" class="xp-sinks">
              <span class="small muted">經驗的用途 <Hint :text="XP_SINK_HINT" /></span>
              <button
                v-for="k in XP_SINKS" :key="k" class="small" :disabled="inCombat || !!xpSinkBlocked(m, k, s) || game.judging"
                :title="xpSinkBlocked(m, k, s) ?? `花 ${xpSinkCost(m, k, s)} 經驗`" @click="game.spendXp(m.id, k)"
              >{{ xpSinkName(k) }}<span class="cost">{{ xpSinkCost(m, k, s) }}</span></button>
            </div>
            <table class="attrs">
              <thead><tr><th>屬性</th><th>數值</th><th>修正</th><th>來源</th><th /></tr></thead>
              <tbody>
                <tr v-for="a in attributeRules.attributes" :key="a.id">
                  <td>{{ a.name }} <Hint :text="a.desc" /></td>
                  <td class="big" :class="{ changed: attrNote(m, a.id) }"><span :class="{ pop: popped === a.id }">{{ attrsOf(m)[a.id] }}</span></td>
                  <td>{{ signed(mod(attrsOf(m)[a.id])) }}</td>
                  <td class="src">{{ attrNote(m, a.id) || '—' }}</td>
                  <td><button v-if="m.attrPoints > 0" class="small" :disabled="inCombat" :aria-label="`${a.name} +1`" @click="spend(a.id)">＋</button></td>
                </tr>
              </tbody>
            </table>
            <p v-if="m.attrPoints > 0" class="points">可分配屬性點：<b>{{ m.attrPoints }}</b></p>
            <!-- 慾望指標放在五維屬性底下；右欄是戰鬥數值與性經歷 -->
            <h4 class="lewd-title">慾望指標 <Hint text="成人向。淫亂、敏感、忍耐、順從會隨經歷慢慢改變，影響慾望戰鬥（慾望上限、受到的慾望、初始慾望……）與 AI 的描寫；曝露名聲依地區記，在城鎮裡穿著曝露的服裝會累積，每天淡掉一點。括號是裝備給的加減。流派是慾望戰鬥的打法，向各流派的老師學或讀秘法書，每一派的玩法寫在「流派」那一行。拘束具平常讓檢定變差；修了任何一個流派、又用鎖鎖上時，戰鬥中反過來給增益（束縛派、刑罰派這類契合的流派給更多）。" /></h4>
            <StatGrid :items="lewdItems" />
            <p v-if="pregLine" class="small preg">🍼 {{ pregLine }}</p>
            <p v-if="lactLine" class="small preg">💧 {{ lactLine }}（敏感 +{{ lactationSensitivity() }}）
              <button v-if="milkWhy !== '不在隊伍裡'" class="small" :disabled="!!milkWhy" :title="milkWhy ?? '擠出母乳（一天一次）'" @click="game.milk(m.id)">擠奶</button>
            </p>
          </div>
          <div>
            <p v-if="isNoncombatant(m)" class="small muted">無法戰鬥：同行但不參與戰鬥、不分經驗。戰敗時依親密度救助（搬救兵）或逃跑（在聚落等你）。</p>
            <StatGrid v-else :items="combat" />
            <template v-if="settings.sexRecords">
            <h4 class="lewd-title">性經歷 <Hint text="成人向（docs/LEWD_STATS.md 第 29 節）。親密場景之後，AI 讀那段經過記下誰和誰發生了關係、性侍奉、初體驗、最喜歡的人與性癖（設定 → AI 敘事的「AI 記下性經歷」；判定時不記）。只留最近三次的經過。成人場景的敘事與判定會附上這份記錄。" /></h4>
            <StatGrid :items="sexItems" />
            <ul v-if="sexRec.recent.length" class="sex-recent small">
              <li v-for="e in sexRec.recent" :key="`${e.day}-${e.report}`">{{ encounterText(e) }}</li>
            </ul>
            <details class="sex-edit small" @toggle="($event.target as HTMLDetailsElement).open && resetSexDraft()">
              <summary>修改性經歷</summary>
              <div class="row">
                <label>經驗
                  <select v-model="sexDraft.virgin">
                    <option :value="true">沒有（{{ virginWord(m.gender) }}）</option>
                    <option :value="false">有</option>
                  </select>
                </label>
                <label>關係人數 <input v-model.number="sexDraft.partners" type="number" min="0" /></label>
                <label>次數 <input v-model.number="sexDraft.times" type="number" min="0" /></label>
                <label>侍奉人數 <input v-model.number="sexDraft.servicePartners" type="number" min="0" /></label>
                <label>侍奉次數 <input v-model.number="sexDraft.serviceTimes" type="number" min="0" /></label>
                <label>自慰次數 <input v-model.number="sexDraft.solo" type="number" min="0" /></label>
              </div>
              <label class="wide">最喜歡的人 <input v-model="sexDraft.favorite" maxlength="16" /></label>
              <label class="wide">性癖與偏好 <input v-model="sexDraft.notes" maxlength="120" /></label>
              <div class="row">
                <button class="small primary" @click="saveSex">儲存</button>
                <button class="small" title="清掉記錄（含最近三次），回到依角色擲出的初始值" @click="clearSex">回到初始值</button>
              </div>
            </details>
            </template>
          </div>
        </section>

        <!-- 特質 -->
        <section v-else-if="id === 'perks'" class="pane">
          <div class="perks">
            <article v-for="p in perksOf(m)" :key="p.id" class="perk" :class="{ flaw: p.flaw, flip: newPerks.has(p.id) }">
              <header>
                <ContentIcon kind="perk" :def="p" :size="20" />
                <b>{{ p.name }}</b>
                <span v-if="p.race" class="tag">種族</span><span v-if="p.flaw" class="tag bad">缺陷</span><span v-if="p.custom" class="tag">自訂</span>
              </header>
              <p class="small">{{ p.desc }}</p>
            </article>
          </div>
          <p v-if="!perksOf(m).length" class="muted small">還沒有特質。可以靠升級、事件、特殊任務、受訓與書籍學會。</p>
          <p v-if="m.perkOffers?.length" class="muted small">有 {{ m.perkOffers.length }} 次學特質的機會，在事件視窗（右上角的「待處理」）選擇。</p>
        </section>

        <!-- 裝備 -->
        <section v-else-if="id === 'gear'" class="pane"><PaperDoll :member="m" /></section>

        <!-- 刺青 -->
        <section v-else-if="id === 'tattoos'" class="pane"><TattooMap :member="m" /></section>

        <!-- 寄生物 -->
        <section v-else-if="id === 'parasites'" class="pane"><ParasitePane :member="m" /></section>

        <!-- 角色設定 -->
        <section v-else-if="id === 'profile'" class="pane profile">
          <PortraitBox :id="m.id" />
          <div class="texts">
            <div v-if="ownSlave" class="contract small own">
              <span><GameIcon name="link" :size="14" /> {{ m.name }}是你的奴隸（{{ contractFor(m)!.def.name }}）：契約、調教與能對他做的事在「我的奴隸」。</span>
              <button class="small" @click="openSlaves">打開「我的奴隸」</button>
            </div>
            <div v-else-if="contractFor(m)" class="contract small">
              <h4><GameIcon name="lock" :size="14" /> {{ contractFor(m)!.def.name }}</h4>
              <div>主人 {{ contractFor(m)!.masterName || '無主' }}・{{ contractFor(m)!.def.mark }}</div>
              <ul class="plain">
                <li v-for="f in contractFor(m)!.def.functions" :key="f" class="muted">{{ (slaveryRules.functions as Record<string, string>)[f] }}</li>
                <li v-for="e in contractFor(m)!.def.side_effects" :key="e" class="muted">副作用：{{ e }}</li>
              </ul>
              <div class="row">
                <span class="tag">收益歸主人 {{ Math.round(contractFor(m)!.def.income_share * 100) }}%</span>
                <span class="tag">談判 DC {{ contractFor(m)!.def.negotiate_dc }}</span>
                <span class="tag">逃離 DC {{ contractFor(m)!.def.escape_dc }}</span>
                <span class="tag">出城 DC {{ contractFor(m)!.def.exit_dc }}</span>
                <span class="tag">服從懲罰 -{{ contractFor(m)!.obedience }}</span>
              </div>
            </div>
            <template v-if="!editingProfile">
              <dl class="kv">
                <template v-if="m.personality"><dt>個性</dt><dd>{{ m.personality }}</dd></template>
                <template v-if="m.gender"><dt>性別</dt><dd>{{ genderName(m.gender) }}</dd></template>
                <template v-if="m.isPlayer"><dt>體型</dt><dd>{{ BODY_NAME[characterBody(m)] }}<span v-if="!m.body" class="muted">（依種族與性別）</span></dd></template>
                <template v-if="m.birthplace"><dt>出身</dt><dd>{{ locationById(m.birthplace).name }}</dd></template>
                <template v-if="m.isPlayer && (m.tags?.length || canChangeTags)">
                  <dt>身分</dt>
                  <dd>
                    <template v-if="!editingTags">
                      <span v-for="t in m.tags ?? []" :key="t" class="tag" :title="tagDef(t)?.ai_hint">{{ tagDef(t)?.emoji }} {{ tagDef(t)?.name ?? t }}</span>
                      <span v-if="!m.tags?.length" class="muted">（沒有）</span>
                      <button v-if="canChangeTags" class="small" @click="startTags"><GameIcon name="edit" :size="13" /> 更換</button>
                    </template>
                    <div v-else class="tag-edit">
                      <PcTagPicker v-model="tagDraft" />
                      <div class="row"><button class="small primary" @click="saveTags">儲存</button><button class="small" @click="editingTags = false">取消</button></div>
                    </div>
                  </dd>
                </template>
                <template v-if="m.appearance"><dt>外貌</dt><dd>{{ m.appearance }}</dd></template>
                <template v-if="m.background"><dt>背景</dt><dd>{{ m.background }}</dd></template>
              </dl>
              <button v-if="m.isPlayer" class="small" @click="startProfile"><GameIcon name="edit" :size="13" /> 編輯設定</button>
            </template>
            <form v-else class="edit" @submit.prevent="saveProfile">
              <label>性別<input v-model="profile.gender" maxlength="20" /></label>
              <div class="body-pick">
                <label>體型 <Hint text="裝備欄與刺青的人形圖用哪一種輪廓；不選時依種族與性別。" />
                  <select v-model="profile.body">
                    <option value="">依種族與性別（{{ BODY_NAME[characterBody({ race: m.race, gender: profile.gender })] }}）</option>
                    <option v-for="b in BODIES" :key="b" :value="b">{{ BODY_NAME[b] }}</option>
                  </select>
                </label>
                <span class="fig"><BodyFigure :body="profile.body || characterBody({ race: m.race, gender: profile.gender })" /></span>
              </div>
              <label>外貌<textarea v-model="profile.appearance" rows="3" maxlength="600" /></label>
              <label>背景<textarea v-model="profile.background" rows="4" maxlength="800" /></label>
              <div class="row"><button class="small primary" type="submit">儲存</button><button class="small" type="button" @click="editingProfile = false">取消</button></div>
            </form>
          </div>
        </section>

        <!-- 能力 -->
        <section v-else-if="id === 'abilities'" class="pane">
          <div v-if="m.pendingAbilityChoices?.length" class="choose">
            <div class="row head">
              <b><GameIcon name="sparkles" :size="15" /> 升級！請選擇一項能力</b>
              <button v-if="hasRerollPool(m)" class="small" :disabled="inCombat || rerollsLeft(m, settings.rerollLimit()) <= 0" @click="game.rerollAbility(m.id)">重抽（剩 {{ rerollsLeft(m, settings.rerollLimit()) }} 次）</button>
              <button v-else class="small" disabled title="能學的能力都已經列在選項裡了">重抽（沒有其他能力可換）</button>
            </div>
            <div class="options">
              <button v-for="id in m.pendingAbilityChoices[0]" :key="id" class="option" :disabled="inCombat" @click="pick($event, id)">
                <b class="ab-name"><ContentIcon kind="ability" :id="id" :size="18" />{{ abilityDef(id).name }}</b>
                <span class="muted small">{{ TYPE_NAME[abilityDef(id).type] }}【{{ QUALITY_NAME[abilityQuality(abilityDef(id))] }}】・{{ abilityMeta(abilityDef(id)) }}</span>
                <span class="small">{{ abilityDef(id).desc }}</span>
              </button>
            </div>
          </div>
          <p v-if="loadoutCap > 0 && m.abilities.some(countsForLoadout)" class="loadout small">
            攜帶 <b :class="{ full: carriedCount >= loadoutCap }">{{ carriedCount }} / {{ loadoutCap }}</b>
            <Hint text="戰鬥中只能用攜帶的技能與法術（戲法不算，一直都帶著）；沒帶的留在技能庫，戰鬥以外隨時可以換。上限在設定的「遊戲規則」調整。" />
            <button class="small only-carried" :class="{ on: onlyCarried }" :aria-pressed="onlyCarried" @click="onlyCarried = !onlyCarried">只看攜帶中</button>
          </p>
          <AbilityCategoryChips v-if="m.abilities.length" v-model="abCat" :abilities="abilityDefs" />
          <div v-for="g in shownGroups" :key="g.type" class="group">
            <h4>{{ TYPE_NAME[g.type] }}</h4>
            <div class="abilities">
              <article v-for="a in g.items" :key="a.id" class="ability" :class="[`q-${abilityQuality(a)}`, { flip: learned === a.id, benched: !carried.has(a.id) }]">
                <header>
                  <ContentIcon kind="ability" :def="a" :size="20" /><b>{{ a.name }}</b><span class="tag">{{ QUALITY_NAME[abilityQuality(a)] }}</span><span class="tag cat">{{ abilityCategoryName(abilityCategory(a)) }}</span>
                  <button
                    v-if="loadoutCap > 0 && countsForLoadout(a.id)" class="carry small" :class="carried.has(a.id) ? 'ghost' : 'sec'"
                    :disabled="inCombat || (!carried.has(a.id) && carriedCount >= loadoutCap)"
                    :title="inCombat ? '戰鬥中不能換' : carried.has(a.id) ? '放回技能庫' : carriedCount >= loadoutCap ? '已經帶滿，先放回一個' : '帶上'"
                    @click="game.setAbilityCarried(m.id, a.id, !carried.has(a.id))"
                  >{{ carried.has(a.id) ? '攜帶中' : '技能庫' }}</button>
                </header>
                <div class="meta small muted">{{ abilityMeta(a) }}</div>
                <p class="small">{{ a.desc }}</p>
              </article>
            </div>
          </div>
          <p v-if="!m.abilities.length" class="muted small">還沒有能力。</p>
          <p v-else-if="!shownGroups.length" class="muted small">這個分類沒有{{ onlyCarried ? '攜帶中的' : '' }}能力。</p>
        </section>
      </template>
    </SwipeTabs>
  </AppDialog>
</template>

<style scoped>
.who { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.who button { display: flex; align-items: center; gap: 6px; padding: 3px 12px 3px 3px; }
.who button.on { background: #4b3420; color: var(--parchment); border-color: #2a1a0e; box-shadow: 0 0 0 1px #c99a45; }
.tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 2px solid #4b3420; margin-bottom: 14px; }
.tabs button { position: relative; display: flex; align-items: center; gap: 6px; background: #d9c08c; border: 1px solid #a88a5a; border-bottom: none; border-radius: 3px 3px 0 0; margin-bottom: -2px; color: var(--muted); padding: 6px 16px; }
.tabs button.on { background: #4b3420; color: #f0d083; border-color: #2a1a0e; }
.dot { position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); }
.pane.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; }
.level { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; margin-bottom: 8px; }
.level b { font-size: 1.1rem; font-weight: 900; }
.level .bar { height: 7px; }
.level .num { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }
.xp-sinks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: -2px 0 8px; }
.xp-sinks .cost { margin-left: 4px; font-variant-numeric: tabular-nums; opacity: .7; font-size: var(--fs-xs); }
.attrs { width: 100%; border-collapse: collapse; }
.attrs th { text-align: left; font-weight: 600; padding: 6px 4px; font-size: var(--fs-sm); color: var(--muted); border-bottom: 2px solid #4b3420; }
.attrs td { padding: 7px 4px; border-bottom: 1px dotted var(--border); font-variant-numeric: tabular-nums; }
.attrs .big { font-size: 1.2rem; font-weight: 900; }
.attrs .big.changed { color: #a8452c; }
.attrs .src { font-size: var(--fs-xs); color: var(--muted); }
.points b { color: #a8452c; }
.perks, .abilities { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
.perk, .ability { padding: 8px 10px; background: #fff8e455; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 2px; }
.perk.flaw { border-left-color: var(--danger); }
.perk header, .ability header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.perk p, .ability p { margin: 4px 0 0; }
.ab-name { display: inline-flex; align-items: center; gap: 4px; }
.tag.bad { color: var(--danger); border-color: var(--danger); }
.ability.q-uncommon { border-left-color: #2f7a1e; } .ability.q-rare { border-left-color: #1f5a9a; }
.ability.q-epic { border-left-color: #6a3a9a; } .ability.q-legendary, .ability.q-mythic { border-left-color: #a86a10; }
.sex-recent { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 2px; }
.sex-edit { margin-top: 6px; }
.sex-edit .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
.sex-edit label { display: inline-flex; align-items: center; gap: 4px; }
.sex-edit input[type='number'] { width: 4.5em; }
.sex-edit .wide { display: flex; margin: 4px 0; }
.sex-edit .wide input { flex: 1; }
.lewd-title { margin: 14px 0 4px; color: var(--accent-2); letter-spacing: 0.1em; display: flex; align-items: center; gap: 4px; }
.group h4 { margin: 12px 0 6px; color: var(--accent-2); letter-spacing: 0.15em; }
.loadout { margin: 0 0 4px; display: flex; align-items: center; gap: 4px; }
.loadout .full { color: #a8452c; }
.loadout .only-carried { margin-left: auto; padding: 1px 9px; }
.loadout .only-carried.on { background: var(--accent); color: var(--parchment); border-color: var(--accent); }
.ability .tag.cat { color: var(--muted); }
.ability.benched { opacity: 0.6; }
.ability .carry { margin-left: auto; padding: 1px 8px; }
.choose { padding: 10px; border: 1px dashed var(--accent); border-radius: 3px; margin-bottom: 8px; background: #fff3cf66; }
.choose .head { justify-content: space-between; }
.options { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; margin-top: 8px; }
.option { display: grid; text-align: left; gap: 2px; white-space: normal; }
.profile { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: start; }
.texts { display: grid; gap: 10px; justify-items: start; }
.texts > * { max-width: 100%; }
.texts .kv, .texts .contract, .texts .edit { justify-self: stretch; }
.kv { display: grid; grid-template-columns: 4em minmax(0, 1fr); gap: 6px 10px; margin: 0; }
.kv dt { color: var(--muted); font-size: var(--fs-sm); letter-spacing: 0.15em; }
.kv dd { margin: 0; }
.kv dd .tag { margin-right: 4px; }
.tag-edit { display: grid; gap: 6px; }
.contract { display: grid; gap: 4px; padding: 8px 10px; border: 1px dashed var(--danger); border-radius: 3px; }
.contract h4 { margin: 0; color: var(--danger); display: flex; align-items: center; gap: 4px; }
.contract.own { border-color: var(--accent-2); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.contract.own > span { display: inline-flex; align-items: center; gap: 4px; flex: 1 1 16em; }
.edit { display: grid; gap: 6px; }
.edit label { display: grid; gap: 2px; }
.edit textarea { width: 100%; }
@media (max-width: 900px) { .pane.two, .profile { grid-template-columns: minmax(0, 1fr); } }
.body-pick { display: flex; gap: 10px; align-items: center; }
.body-pick .fig { width: 44px; flex: none; }
/* 特效：屬性 +1 彈一下、新能力與新特質的卡片翻過來 */
.pop { display: inline-block; animation: attr-pop 0.4s steps(4, end); color: var(--gold-hi); }
@keyframes attr-pop { 40% { transform: scale(1.6) translateY(-3px); } }
.flip { animation: card-flip 0.6s steps(6, end); box-shadow: 0 0 0 1px var(--accent), 0 0 12px #f0d08366; }
@keyframes card-flip { from { transform: rotateY(180deg); filter: brightness(0.3); } 50% { transform: rotateY(90deg); } }
</style>
