<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { lastSeen, stateKey } from '@/fx/seen'
import { affinityStage, apMaxFor, attrsOf, carriedAbilities, castingAttr, combatBonuses, guildRankFor, loadoutUsage, mod, proficiency, xpToNext } from '@/engine/character'
import { gameRule } from '@/engine/gameRules'
import { playerRank } from '@/engine/guild'
import { abilityDef, attributeRules, attrName, className, classDef, companionRules, conditionName, conditionTone, genderDef, genderName, raceName } from '@/engine/data'
import { gearSummary, SLOTS, slotNameFor } from '@/engine/gear'
import { specRarity } from '../items/itemInfo'
import { hitDiceLeft, hitDie } from '@/engine/rest'
import { isBound, isNoncombatant, leaderOf } from '@/engine/party'
import { awayCompanions, awayLabel } from '@/engine/away'
import { childrenOf, owedFee, placeText } from '@/engine/children'
import { formatMoney } from '@/engine/money'
import NameTag from '../NameTag.vue'
import MasterRosterPropose from './MasterRosterPropose.vue'
import { perksOf } from '@/engine/perks'
import { placeName, tattooName, tattoosOf } from '@/engine/tattoos'
import { parasiteDef, parasitesOf, stageName } from '@/engine/parasites'
import type { Character } from '@/engine/types'
import { useGame } from '@/stores/game'
import Avatar from '../ui/Avatar.vue'
import GameIcon from '../ui/GameIcon.vue'
import ItemIcon from '../items/ItemIcon.vue'
import { attrNote, contractFor, spellSlots, type CharTab } from './memberInfo'

// 隊伍的第一層：每人一張角色卡，細節在角色詳情（CharacterDialog）
const emit = defineEmits<{ detail: [member: string, tab: CharTab] }>()
const game = useGame()
const s = computed(() => game.state!)
const inCombat = computed(() => !!s.value.combat)
// 技能攜帶上限：卡片上列攜帶中的能力
const loadoutCap = computed(() => gameRule(s.value, 'skillLoadout'))
const leader = computed(() => leaderOf(s.value))
const bound = computed(() => isBound(s.value))

const pct = (v: number, max: number) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`
const levelUp = (m: Character) => !!m.pendingAbilityChoices?.length || m.attrPoints > 0
function levelUpText(m: Character): string {
  const parts = [m.pendingAbilityChoices?.length ? `有 ${m.pendingAbilityChoices.length} 項能力可以選擇` : '', m.attrPoints > 0 ? `${m.attrPoints} 點屬性可以分配` : '']
  return `升級了！${parts.filter(Boolean).join('、')}`
}
function rank(m: Character) {
  return m.isPlayer ? playerRank(s.value) : guildRankFor(m.level)
}
function gearList(m: Character) {
  return SLOTS.filter((slot) => m.gear?.[slot]).map((slot) => ({ slot, g: m.gear![slot]! }))
}
const rarityOf = specRarity
// ── 特效：EXP 條從上次打開時的值漲到現在（升級了就從 0 漲）；公會階級變了就像蓋章一樣蓋上去
const xpFrom = reactive<Record<string, string>>({})
const stamped = reactive<Record<string, boolean>>({})
for (const m of s.value.party) {
  const key = `${stateKey(game.state)}:${m.id}`
  const prev = lastSeen(`xp:${key}`, { level: m.level, xp: m.xp })
  if (prev && (prev.level !== m.level || prev.xp !== m.xp)) xpFrom[m.id] = prev.level === m.level ? pct(prev.xp, xpToNext(m.level)) : '0%'
  const r = lastSeen(`rank:${key}`, rank(m))
  if (r !== undefined && r !== rank(m)) stamped[m.id] = true
}
onMounted(() => requestAnimationFrame(() => requestAnimationFrame(() => { for (const k of Object.keys(xpFrom)) delete xpFrom[k] })))
// 不在隊上的夥伴：留在房子、寄放在酒館（要親自回去才帶得上）
const away = computed(() => awayCompanions(s.value))
// 家人：嬰兒（docs/FAMILY.md 第 7.5 節）
const kids = computed(() => childrenOf(s.value))
const BOND: Record<string, string> = { hired: '受雇', voluntary: '自願', slave: '奴隸' }
function canDismiss(m: Character) {
  return !m.isPlayer && !m.group && m.bond !== 'slave' && m.bond !== 'guest'
}
</script>

<template>
  <div class="cards">
    <article v-for="m in s.party" :key="m.id" class="card">
      <div v-if="levelUp(m)" class="alert">
        <GameIcon name="sparkles" :size="15" />{{ levelUpText(m) }}
        <button class="small" @click="emit('detail', m.id, m.pendingAbilityChoices?.length ? 'abilities' : 'stats')">前往</button>
      </div>
      <span class="rank" :class="{ stamp: stamped[m.id] }" :title="m.isPlayer ? '冒險者公會的階級（功績與晉升考核）' : '依等級換算的階級'">{{ rank(m) }}</span>

      <div class="top">
        <button class="pic ghost" title="角色設定與形象圖" @click="emit('detail', m.id, 'profile')"><Avatar :id="m.id" :size="104" /></button>
        <div class="who">
          <h3>
            <span :style="{ color: genderDef(m.gender)?.color }">{{ m.name }}</span>
            <span v-if="m.isPlayer" class="tag gold">主角</span>
            <span v-else-if="m.bond" class="tag" :class="m.bond">{{ companionRules.bonds[m.bond] }}</span>
          </h3>
          <div class="meta"><template v-if="m.gender">{{ genderName(m.gender) }}・</template>{{ raceName(m.race) }}・{{ className(m.class) }}・Lv.{{ m.level }}</div>
          <div class="vital"><span class="label">HP</span><div class="bar hp"><span :style="{ width: pct(m.hp, m.maxHp) }" /></div><span class="num" :title="m.tempHp ? `臨時生命 ${m.tempHp}：下一場戰鬥帶著，長休後消失` : undefined">{{ m.hp }} / {{ m.maxHp }}<template v-if="m.tempHp"> +{{ m.tempHp }}</template></span></div>
          <div class="vital"><span class="label">EXP</span><div class="bar xp"><span :style="{ width: xpFrom[m.id] ?? pct(m.xp, xpToNext(m.level)) }" /></div><span class="num">{{ m.level >= 20 ? `${m.xp}（滿級）` : `${m.xp} / ${xpToNext(m.level)}` }}</span></div>
          <div class="attr5">
            <button
              v-for="a in attributeRules.attributes" :key="a.id" class="ghost" :class="{ boost: attrNote(m, a.id) }"
              :title="attrNote(m, a.id) || a.desc" @click="emit('detail', m.id, 'stats')"
            >
              <span class="label">{{ a.name }}</span>
              <b>{{ attrsOf(m)[a.id] }}</b><small>{{ mod(attrsOf(m)[a.id]) >= 0 ? '+' : '' }}{{ mod(attrsOf(m)[a.id]) }}</small>
            </button>
          </div>
        </div>
      </div>

      <div class="chips">
        <span class="tag" title="生命骰：短休時用來回復生命值">生命骰 d{{ hitDie(m) }} × {{ hitDiceLeft(m) }}/{{ m.level }}</span>
        <span v-if="!m.isPlayer && m.affinity !== undefined" class="tag" :title="`親密度 ${m.affinity}`"><GameIcon name="heart" :size="11" />{{ affinityStage(m.affinity) }}</span>
        <span v-if="m.group && m.bond !== 'leader'" class="tag">{{ s.party.find((x) => x.id === m.group)?.name }}的隊伍</span>
        <span v-if="contractFor(m)" class="tag bad" :title="contractFor(m)!.def.mark"><GameIcon name="lock" :size="11" />{{ contractFor(m)!.def.name }}</span>
        <span v-for="c in m.status" :key="c" class="tag" :class="conditionTone(c)" :title="companionRules.conditions[c]?.desc">{{ conditionName(c) }}</span>
      </div>
      <p v-if="isNoncombatant(m)" class="small muted nc">無法戰鬥：同行但不參與戰鬥、不分經驗。</p>
      <div v-else class="combat3">
        <div><span class="label">行動點</span><span><b>{{ apMaxFor(m.level, attrsOf(m)) }}</b> <small class="muted">每回合 +{{ combatBonuses(m).ap_regen.total }}</small></span></div>
        <div>
          <span class="label">法術環</span>
          <span v-if="spellSlots(m).length" class="slots" title="剩下／上限；長休後全滿">
            <span v-for="x in spellSlots(m)" :key="x.circle" class="slot" :class="{ empty: !x.left }">{{ x.circle }}環 <b>{{ x.left }}</b>/{{ x.max }}</span>
          </span>
          <span v-else class="muted">—</span>
        </div>
        <div>
          <span class="label">施法屬性</span>
          <span v-if="classDef(m.class).caster !== 'none'"><b>{{ attrName(castingAttr(m.class)) }}</b> <small class="muted">熟練 +{{ proficiency(m.level) }}</small></span>
          <span v-else class="muted">—</span>
        </div>
      </div>

      <button class="sec ghost" @click="emit('detail', m.id, 'perks')">
        <span class="label">特質</span>
        <span class="items">
          <span v-for="p in perksOf(m)" :key="p.id" class="tag" :class="{ bad: p.flaw }" :title="p.desc">{{ p.name }}<template v-if="p.flaw">（缺陷）</template></span>
          <span v-if="!perksOf(m).length" class="muted">無</span>
        </span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>
      <button v-if="!isNoncombatant(m) || m.gear" class="sec ghost" @click="emit('detail', m.id, 'gear')">
        <span class="label">裝備</span>
        <span class="items">
          <span v-for="x in gearList(m)" :key="x.slot" class="gear-ic" :class="`r-${rarityOf(x.g.spec)}`" :title="`${slotNameFor(x.slot, m.race)}：${x.g.name}\n${gearSummary(x.g.spec)}`">
            <ItemIcon :name="x.g.name" :spec="x.g.spec" :size="20" />
          </span>
          <span v-if="!gearList(m).length" class="muted">無</span>
        </span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>
      <button class="sec ghost" @click="emit('detail', m.id, 'tattoos')">
        <span class="label">刺青</span>
        <span class="items">
          <span v-for="t in tattoosOf(m)" :key="t.place" class="tag" :class="{ bad: t.kind === 'slave' }">{{ placeName(t.place) }}・{{ tattooName(t) }}</span>
          <span v-if="!tattoosOf(m).length" class="muted">無</span>
        </span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>
      <button v-if="parasitesOf(m).length" class="sec ghost" @click="emit('detail', m.id, 'parasites')">
        <span class="label">寄生物</span>
        <span class="items">
          <span v-for="p in parasitesOf(m)" :key="p.id" class="tag" :class="{ bad: !p.tamed && !p.dormant }">{{ parasiteDef(p.id)?.name ?? p.id }}・{{ p.tamed ? '已馴服' : p.dormant ? '沉睡' : stageName(p.corruption) }}</span>
        </span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>
      <button v-if="!isNoncombatant(m) && m.abilities.length" class="sec ghost" @click="emit('detail', m.id, 'abilities')">
        <span class="label">能力</span>
        <span class="items">
          <span v-for="id in carriedAbilities(m, loadoutCap).slice(0, 8)" :key="id" class="tag" :title="abilityDef(id).desc">{{ abilityDef(id).name }}</span>
          <span v-if="carriedAbilities(m, loadoutCap).length > 8" class="muted small">等 {{ carriedAbilities(m, loadoutCap).length }} 項</span>
          <span v-if="loadoutUsage(m, loadoutCap).library" class="muted small">（技能庫 {{ loadoutUsage(m, loadoutCap).library }}）</span>
        </span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>
      <button class="sec ghost" @click="emit('detail', m.id, 'profile')">
        <span class="label">設定</span>
        <span class="items muted ellipsis">{{ m.personality || m.background || m.appearance || '—' }}</span>
        <span class="go">詳情<GameIcon name="right" :size="12" /></span>
      </button>

      <div v-if="canDismiss(m)" class="foot">
        <button class="small danger" :disabled="inCombat" @click="game.dismiss(m.id)">請離隊伍</button>
      </div>
      <div v-else-if="bound && leader && m.group === leader.id && m.id !== leader.id" class="foot">
        <MasterRosterPropose :member="m" />
      </div>
    </article>
  </div>

  <section v-if="away.length" class="panel away">
    <h3><GameIcon name="home" :size="16" /> 不在隊上的夥伴 <span class="muted small">{{ away.length }} 人</span></h3>
    <p class="small muted">留在房子或寄放在酒館：不算離隊，羈絆、契約、親密度都保留。要親自回到那裡才能帶上（房子在「看家的夥伴」，酒館在「寄放夥伴」）。<template v-if="away.some((a) => a.master)">標著「主人留下的」是主人的隊員：要回到那裡向{{ leader?.name ?? '主人' }}提議帶上（酒館的「主人留在這裡的隊員」、主人的家的「主人留在家裡的隊員」）。</template></p>
    <ul class="plain">
      <li v-for="a in away" :key="a.id" class="away-row">
        <NameTag :id="a.id" />
        <span class="small muted">Lv.{{ a.character.level }}<template v-if="a.character.bond && BOND[a.character.bond]">・{{ BOND[a.character.bond] }}</template></span>
        <span class="small where"><GameIcon :name="a.place.kind === 'home' ? 'home' : 'mug'" :size="12" /> {{ awayLabel(a.place) }}</span>
        <span class="small muted">{{ a.days ? `待了 ${a.days} 天` : '今天留下' }}</span>
        <span v-if="a.master" class="small chip-master" :title="`主人的隊員：要向${leader?.name ?? '主人'}提議才能帶回`">主人留下的</span>
      </li>
    </ul>
  </section>

  <section v-if="kids.length" class="panel away">
    <h3><GameIcon name="heart" :size="16" /> 家人 <span class="muted small">{{ kids.length }} 個孩子</span></h3>
    <p class="small muted">孩子住在神殿的育幼院（每天寄養費）或自己的房子。到那座城的神殿「育幼院」或房子的「孩子」可以探望、繳費、接回家或送去育幼院。</p>
    <ul class="plain">
      <li v-for="k in kids" :key="k.id" class="away-row">
        <span>🍼 {{ k.name }}</span>
        <span class="small muted">{{ s.time.day - k.born }} 天大・母親{{ k.mother.name }}・父親{{ k.father?.name ?? '不明' }}</span>
        <span class="small where"><GameIcon :name="k.where.kind === 'home' ? 'home' : 'heart'" :size="12" /> {{ placeText(s, k.where) }}</span>
        <span v-if="owedFee(s, k)" class="small">欠寄養費 {{ formatMoney(owedFee(s, k)) }}</span>
      </li>
    </ul>
  </section>

  <section v-if="leader" class="panel leader">
    <h3><GameIcon name="flag" :size="16" /> {{ leader.name }}的隊伍</h3>
    <p v-if="bound" class="small muted">你是{{ leader.name }}的奴隸，不能自行離隊；只能在工具列的「契約」裡談判或逃離。</p>
    <template v-else>
      <p class="small muted">你是這支隊伍的隊員。離隊會在下次休息（短休或長休）時進行：正式道別比較體面；偷偷離開要過靈巧檢定，被發現會很尷尬。</p>
      <div class="row">
        <button class="small" :class="{ primary: s.pendingLeave?.mode === 'formal' }" @click="game.requestLeave('formal')">正式道別</button>
        <button class="small" :class="{ primary: s.pendingLeave?.mode === 'sneak' }" @click="game.requestLeave('sneak')">偷偷離開</button>
        <button v-if="s.pendingLeave" class="small" @click="game.requestLeave(null)">打消念頭</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.away { display: grid; gap: 6px; margin-top: 16px; }
.away h3, .away p { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.away p { display: block; }
.away ul { display: grid; gap: 4px; margin: 0; }
.chip-master { border: 1px solid var(--border); border-radius: 99px; padding: 0 6px; color: var(--accent); }
.away-row { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.where { color: var(--accent); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(480px, 100%), 1fr)); gap: 16px; }
.card {
  position: relative; display: grid; gap: 6px; align-content: start; padding: 14px;
  background: #fff8e440; border: 1px solid var(--border); border-radius: 2px; box-shadow: inset 0 0 0 3px #fff6dd55, 0 2px 4px #6a4a2a33;
}
.alert {
  display: flex; align-items: center; gap: 8px; margin: -14px -14px 0; padding: 6px 14px;
  background: linear-gradient(90deg, #a8452c, #7a2e1a); color: #fbe9c8; font-size: var(--fs-sm);
}
.alert button { margin-left: auto; padding: 1px 10px; }
.rank {
  position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; display: grid; place-items: center;
  font-weight: 900; font-size: 1.1rem; color: #fbe9c8; background: radial-gradient(circle, #a8452c, #6a2414);
  border: 2px solid #c99a45; border-radius: 50%; box-shadow: 0 2px 4px #0006;
}
.alert ~ .rank { top: 48px; }
.top { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 14px; align-items: start; }
.pic { padding: 0; border: 3px solid #4b3420; outline: 1px solid #c99a45; outline-offset: -5px; background: #3a2a1a; width: 112px; height: 112px; display: grid; place-items: center; }
.pic :deep(.avatar) { box-shadow: none; border: none; }
.who { min-width: 0; padding-right: 44px; }
.who h3 { margin: 0; font-size: 1.3rem; font-weight: 900; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.meta { font-size: var(--fs-sm); color: var(--muted); margin: 0 0 4px; }
.vital { display: grid; grid-template-columns: 2.6em minmax(0, 1fr) 5.5em; gap: 6px; align-items: center; margin-bottom: 3px; }
.vital .num { font-size: var(--fs-sm); text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.bar.xp { height: 6px; }
.bar.xp > span { transition: width 0.9s steps(12, end) 0.2s; }
.rank.stamp { animation: stamp 0.45s steps(5, end) 0.2s both; }
@keyframes stamp { from { transform: scale(2.4) rotate(-12deg); opacity: 0; } 70% { transform: scale(0.92) rotate(2deg); opacity: 1; } }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tag.gold { color: #7a4a10; border-color: #b8893b; background: #fff3cf; }
.tag.bad { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 60%, transparent); }
.tag.good { color: var(--good); border-color: color-mix(in srgb, var(--good) 55%, transparent); }
.attr5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-top: 5px; }
.attr5 button { display: grid; justify-items: center; gap: 0; padding: 2px 0 1px; background: #fff8e488; border: 1px solid #c4a670; border-radius: 2px; color: var(--text); }
.attr5 button:hover:not(:disabled) { border-color: var(--accent); color: var(--text); }
.attr5 .label { letter-spacing: 0.2em; font-size: var(--fs-xs); line-height: 1.3; }
.attr5 b { font-size: 1.15rem; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.attr5 small { font-size: var(--fs-xs); color: #8a4a1e; font-weight: 700; }
.attr5 .boost b { color: #a8452c; }
.nc { margin: 0; }
.combat3 { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: var(--fs-sm); }
.combat3 > div { display: flex; align-items: baseline; gap: 6px; padding: 0 0 0 8px; border-left: 2px solid #c99a45; }
.combat3 .label { color: var(--muted); }
.slots { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.slot { font-size: var(--fs-xs); line-height: 18px; padding: 0 6px; border: 1px solid var(--chip-border); border-radius: 2px; background: var(--chip-bg); white-space: nowrap; }
.slot b { color: var(--mp); }
.slot.empty { opacity: 0.55; }
.sec {
  display: grid; grid-template-columns: 3.6em minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 3px 0;
  border: none; border-top: 1px dashed #b8955a99; border-radius: 0; text-align: left; color: var(--text); background: none;
}
.sec:hover:not(:disabled) { background: #7a5a2a0d; border-color: #b8955a99; color: var(--text); }
.sec .label { letter-spacing: 0.2em; }
.sec .items { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-width: 0; font-size: var(--fs-sm); }
.sec .ellipsis { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sec .go { display: inline-flex; align-items: center; gap: 2px; font-size: var(--fs-xs); color: var(--accent); }
.gear-ic { width: 26px; height: 26px; display: grid; place-items: center; background: #3a2a1aee; color: #e8d8b8; border: 1px solid #4b3420; box-shadow: inset 0 0 0 1px #c99a4555; }
.gear-ic.r-uncommon { box-shadow: inset 0 0 0 1px var(--r-uncommon); color: var(--r-uncommon); }
.gear-ic.r-rare { box-shadow: inset 0 0 0 1px var(--r-rare); color: var(--r-rare); }
.gear-ic.r-epic { box-shadow: inset 0 0 0 1px var(--r-epic); color: var(--r-epic); }
.gear-ic.r-legendary { box-shadow: inset 0 0 0 1px var(--r-legendary); color: var(--r-legendary); }
.foot { display: flex; justify-content: flex-end; padding-top: 4px; }
.leader { margin-top: 16px; }
.leader h3 { display: flex; align-items: center; gap: 6px; }
</style>
