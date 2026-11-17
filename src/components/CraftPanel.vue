<script setup lang="ts">
import { textHas } from '@/engine/script'
import { blueprintName, blueprintRules, hasBlueprint } from '@/engine/blueprints'
import { computed, onMounted, ref, watch } from 'vue'
import { attrName, craftRules, damageTypeName, itemDef } from '@/engine/data'
import { canCraftHere, commissionHere, craftMaxCount, craftPlan, craftRarity, craftTarget, forgeOf, isAdultCraft, makeTarget, outfitCommission, selfFeeName, selfLewdBonus, supplyMaxTier, type AuxItem } from '@/engine/craft'
import { lewdName } from '@/engine/lewd'
import type { LewdStat } from '@/engine/types'
import { craftForKind, crafters, skillOf, toolTierFor, toolTierName } from '@/engine/crafting'
import {
  baseShown, baseSlotName, baseType, CRAFT_SLOT_ORDER, gearName, gearRules, gearSummary, gearSummaryParts, MATERIAL_KIND_NAME, rarityName, rarityPoints, sortBaseTypes, type BaseSlot,
} from '@/engine/gear'
import { formatMoney } from '@/engine/money'
import { shopTypeForCell } from '@/engine/trade'
import { currentCell } from '@/engine/grid'
import { parseUse, useGame } from '@/stores/game'
import EffectLine from './items/EffectLine.vue'
import AppDialog from './AppDialog.vue'
import BuildingMenu, { type MenuItem } from './place/BuildingMenu.vue'
import Hint from './ui/Hint.vue'
import GameIcon from './ui/GameIcon.vue'
import ContentIcon from './icons/ContentIcon.vue'
import ItemIcon from './items/ItemIcon.vue'
import CraftCard, { type CardOutcome, type CardReq, type CardTag } from './craft/CraftCard.vue'
import type { GearSpec } from '@/engine/types'

// 打造裝備（data/rules/gear.json 的 craft；docs/CRAFTING.md）：部位 → 類型 → 底材 → 材料，可以描述想要的樣子。
// commission：在鐵匠鋪、裁縫店、珠寶店委託店主；make：主角或肯幫忙的夥伴自己動手（crafts.json）
const props = withDefaults(defineProps<{ mode?: 'commission' | 'make'; crafterId?: string }>(), { mode: 'commission', crafterId: 'pc' })
const make = computed(() => props.mode === 'make')
// 店裡的委託打造是選單的一列，點了打開對話框；工藝對話框裡直接顯示
const menuItem = computed<MenuItem>(() => ({
  id: 'commission', icon: 'tools', label: '委託打造', detail: `店主擲工藝檢定，約 ${gearRules.craft.hours} 小時`,
}))
const open = ref(false)
const emit = defineEmits<{ started: [] }>()
const game = useGame()
const s = computed(() => game.state!)
// 成人用品店的委託打造在自己的畫面（adult/OutfitAtelier.vue），這裡不列
const here = computed(() => make.value || (canCraftHere(s.value) && currentCell(s.value).kind !== outfitCommission().shop))

// 站在店裡時先備好今天的商品清單（當場補買材料要看這裡賣什麼）
onMounted(() => {
  const type = shopTypeForCell(currentCell(s.value).kind)
  if (type) game.shopState(type)
})

// 自己動手：誰來做（工藝對話框上方選；不肯幫忙的人換回主角）
const crafter = computed(() => crafters(s.value).find((w) => w.member.id === props.crafterId && !w.refusal)?.member ?? s.value.party.find((m) => m.isPlayer)!)

// ---- 部位 → 類型 → 底材 ----
// 委託：只列這間店做得出來的底材（鐵匠鋪：金屬、木材；裁縫店：皮革、布料；珠寶店：寶石；成人向服裝只在成人用品店）；自己動手：全部
const bases = computed(() => Object.entries(gearRules.bases)
  // 拘束具只能自己動手打造（委託在成人用品店的訂製畫面）；詛咒具這類專屬底材不能打造
  .filter(([id, b]) => !b.exclusive && (!b.restraint || make.value) && baseShown(id) && (make.value || commissionHere(s.value, id)))
  .map(([id, b]) => ({ id, ...b, type: baseType(id) }))
  .sort((a, b) => a.price - b.price))
const slots = computed(() => [
  ...CRAFT_SLOT_ORDER.filter((x) => bases.value.some((b) => b.slot === x)),
  ...[...new Set(bases.value.map((b) => b.slot))].filter((x) => !CRAFT_SLOT_ORDER.includes(x)),
])

// 上次選的部位與類型記在瀏覽器裡
const MEMO = 'elondia.craftPick'
function recall(): { slot?: string; type?: string; base?: string } {
  try {
    return JSON.parse(localStorage.getItem(MEMO) ?? '{}') as { slot?: string; type?: string; base?: string }
  } catch {
    return {}
  }
}
const memo = recall()
const slotPick = ref(memo.slot ?? '')
const typePick = ref(memo.type ?? '')
const basePick = ref(memo.base ?? '')
const slot = computed(() => (slots.value.includes(slotPick.value as BaseSlot) ? slotPick.value : slots.value[0] ?? 'main_hand'))
const inSlot = computed(() => bases.value.filter((b) => b.slot === slot.value))
const types = computed(() => sortBaseTypes(inSlot.value.map((b) => b.type)))
const type = computed(() => (types.value.includes(typePick.value) ? typePick.value : types.value[0] ?? ''))
const list = computed(() => inSlot.value.filter((b) => b.type === type.value))
const base = computed(() => (list.value.some((b) => b.id === basePick.value) ? basePick.value : list.value[0]?.id ?? 'longsword'))
watch([slot, type, base], ([a, b, c]) => {
  try {
    localStorage.setItem(MEMO, JSON.stringify({ slot: a, type: b, base: c }))
  } catch {
    // 瀏覽器不給存：只是下次不記得
  }
})
function pickSlot(x: string) {
  slotPick.value = x
  typePick.value = ''
}

// 搜尋：直接跳到底材（玩家找不到「皮頭盔」，實際叫「皮帽」）
const query = ref('')
const hits = computed(() => {
  const q = query.value.trim()
  return q ? bases.value.filter((b) => textHas(b.name, q)).slice(0, 12) : []
})
function jump(id: string) {
  const b = bases.value.find((x) => x.id === id)
  if (!b) return
  slotPick.value = b.slot
  typePick.value = b.type
  basePick.value = b.id
  query.value = ''
}

/** 一件裝備的數值（拿掉開頭的稀有度與部位） */
const statsOf = (b: string, m: string) => gearSummary({ base: b, material: m }).split('・').slice(2).join('・')
const firstMaterial = (kind: string) => Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind).sort(([, a], [, b]) => a.tier - b.tier)[0]?.[0] ?? 'iron'

// ---- 材料：比較每種材料做出來的數值 ----
const kind = computed(() => gearRules.bases[base.value]!.kind)
const materials = computed(() => Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind.value).sort(([, a], [, b]) => a.tier - b.tier).map(([id, m]) => ({ id, ...m })))
/** 做得了第幾級（自己動手看做的人，委託看店主；工藝照材料類型） */
const levelHere = computed(() => (make.value
  ? skillOf(crafter.value, craftForKind(kind.value)).level
  : craftPlan(s.value, base.value, firstMaterial(kind.value)).level))
const canDo = (tier: number) => levelHere.value >= tier
const material = ref('')
const mat = computed(() => {
  if (materials.value.some((m) => m.id === material.value)) return material.value
  // 預設：做得了的材料裡，有持有的最高一級；都沒有就用最低一級
  const ok = materials.value.filter((m) => canDo(m.tier))
  return ([...ok].reverse().find((m) => ownedOf(m.id) > 0) ?? ok[0] ?? materials.value[0]!).id
})
const ownedOf = (m: string) => s.value.inventory.filter((i) => forgeOf(i.name).includes(m)).reduce((n, i) => n + i.qty, 0)

// ---- 打造材料的來源：選用哪一種、不夠時當場補買 ----
const usePick = ref('')
const buy = ref(true)
// 委託：全部由工匠代備，不用行囊裡的打造材料
const supplyAll = ref(false)
// 輔料：行囊裡的任何材料（最多三種），不論結果都會用掉
const aux = ref<AuxItem[]>([])
const auxPick = ref('')
const auxRules = gearRules.craft.aux
const auxOptions = computed(() => s.value.inventory.filter((i) => itemDef(i.name)?.category === 'material' && !aux.value.some((a) => a.name === i.name)))
function addAux() {
  if (!auxPick.value || aux.value.length >= auxRules.max_kinds) return
  aux.value.push({ name: auxPick.value, qty: 1 })
  auxPick.value = ''
}
// 自己打造成人向服裝、拘束具：另外選一項慾望指標，加成照做的人自己的指標（craft.ts 的 selfLewdBonus）
const lewdPick = ref<LewdStat | ''>('')
const lewdStats = computed(() => (make.value && isAdultCraft(base.value)
  ? outfitCommission().stats.map((st) => ({ st, bonus: selfLewdBonus(crafter.value, st, base.value, mat.value) }))
  : []))
// 一次做幾件（打造材料、費用、時間與經驗乘件數，只擲一次）
const count = ref(1)
const COUNT_HINT = '一次做好幾件：打造材料、工錢（自己動手的材料費與工坊租金）、時間與工藝經驗乘件數，只擲一次，每件品質一樣、附魔各自擲。輔料照填的數量用一次，提高品質的機率照總價值算。'
const opts = computed(() => ({
  ...(usePick.value ? { use: usePick.value } : {}), ...(buy.value ? { buy: true } : {}), ...(!make.value && supplyAll.value ? { supplyAll: true } : {}), ...(count.value > 1 ? { count: count.value } : {}),
  ...(lewdPick.value && lewdStats.value.some((x) => x.st === lewdPick.value && x.bonus > 0) ? { lewd: lewdPick.value } : {}),
}))
const plan = computed(() => craftPlan(s.value, base.value, mat.value, aux.value, make.value ? crafter.value : undefined, opts.value))
const skill = computed(() => craftRules.skills[plan.value.craft])
/** 這間店有賣能做成這種材料的東西 */
const soldHere = computed(() => plan.value.sources.filter((x) => x.price !== undefined))
const needBuy = computed(() => plan.value.units > plan.value.have)
const text = ref('')
const use = ref('')
const slotLabel = (x: string) => baseSlotName(x as BaseSlot)
const name = computed(() => gearName({ base: base.value, material: mat.value }))
// 數值：自己打造選了慾望指標時，一起算進去（和底材預設的加值合在一起，每項最多 item_cap）
const lineParts = computed(() => {
  const pick = opts.value.lewd
  const bonus = pick ? lewdStats.value.find((x) => x.st === pick)?.bonus ?? 0 : 0
  return gearSummaryParts({ base: base.value, material: mat.value, ...(pick && bonus ? { lewd: { [pick]: bonus } } : {}) }).slice(2)
})
const line = computed(() => lineParts.value.map((p) => p.text).join('・'))
/** 這個材料做不出加成時：換哪一種才有 */
const better = computed(() => (line.value ? undefined : materials.value.find((m) => statsOf(base.value, m.id))))
const feeName = computed(() => (make.value ? selfFeeName(plan.value) : '工錢'))

// ---- 成品卡 ----
const tags = computed<CardTag[]>(() => {
  const hot = gearRules.bases[base.value]!.restraint ? '拘束具' : isAdultCraft(base.value) ? '成人向' : ''
  // 類型本身就叫「拘束具」時只標一次（紅的）
  return [
    { text: slotLabel(gearRules.bases[base.value]!.slot) }, { text: type.value, ...(type.value === hot ? { hot: true } : {}) },
    { text: `${skill.value.name}・第 ${plan.value.tier} 級材料` },
    ...(hot && type.value !== hot ? [{ text: hot, hot: true }] : []),
  ]
})
const outcomes = computed<CardOutcome[]>(() => {
  const p = plan.value
  const paid = p.fee || p.supplyCost ? `，${feeName.value}${p.supplyCost ? '與代備的材料費' : ''}照付` : ''
  // 損失的是自己帶來的材料（工匠代備的照樣用掉、照樣付錢）
  const own = p.units - p.supplied
  const lost = Math.ceil(own * gearRules.craft.lost_on_fail)
  const rar = (d: 'critical' | 'success' | 'partial') => rarityName(craftRarity(mat.value, d)!)
  return [
    { degree: 'critical', text: `${rar('critical')}・${p.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(mat.value, 'critical')!)} 點` },
    { degree: 'success', text: `${rar('success')}・${p.count > 1 ? '每件' : ''}附魔 ${rarityPoints(craftRarity(mat.value, 'success')!)} 點` },
    { degree: 'partial', text: `${rar('partial')}・沒有附魔` },
    { degree: 'fail', text: `沒做成${lost ? `，損失 ${lost} 份材料` : ''}${paid}` },
    { degree: 'fumble', text: `搞砸了${own ? `，損失全部 ${own} 份材料` : ''}${paid}` },
  ]
})
const check = computed(() => (make.value
  ? `d20 + 工藝 ${plan.value.level * craftRules.level_bonus} + ${attrName(skill.value.attr)}調整值 ÷${craftRules.attr_div}・DC ${plan.value.dc}`
  : `店主擲 d20 + 手藝 ${plan.value.level * craftRules.level_bonus}・DC ${plan.value.dc}`))
const reqs = computed<CardReq[]>(() => {
  const p = plan.value
  const out: CardReq[] = [{
    state: p.level >= p.tier ? 'ok' : 'no', label: '工藝',
    text: `${make.value ? crafter.value.name : '工匠'} ${skill.value.name} Lv.${p.level}（要 Lv.${p.tier}）`,
  }]
  if (make.value && p.tool) {
    const need = toolTierFor(p.tier)
    out.push({ state: p.tool.tier >= need ? 'ok' : 'no', label: '工具', text: `要${toolTierName(need)}・現在 ${p.tool.source}` })
  }
  if (make.value) out.push({ state: p.blueprint ? 'ok' : 'warn', label: '圖紙', text: p.blueprint ? `有${blueprintName(p.base)}` : `沒有（DC +${blueprintRules().dc_without}）` })
  const short = p.units - p.have
  out.push(p.supplyAll ? { state: 'ok', label: '材料', text: `${p.units} 份全部由工匠代備（每份 ${formatMoney(p.supplyUnit)}）` }
    : short <= 0 ? { state: 'ok', label: '材料', text: `需要 ${p.units} 份，持有 ${p.have} 份` }
    // 委託：不夠的由工匠代備，照份數收材料費
    : p.supplied >= short ? { state: 'warn', label: '材料', text: `缺 ${short} 份，工匠代備（每份 ${formatMoney(p.supplyUnit)}）` }
    : p.buys.length && p.buys.reduce((n, b) => n + b.qty, 0) >= short ? { state: 'warn', label: '材料', text: `缺 ${short} 份，當場補買` }
    : { state: 'no', label: '材料', text: `需要 ${p.units} 份，持有 ${p.have} 份` })
  const cost = p.fee + p.buyCost + p.supplyCost
  out.push({ state: s.value.money_cc >= cost ? 'ok' : 'no', label: '錢', text: `要 ${formatMoney(cost)}・持有 ${formatMoney(s.value.money_cc)}` })
  return out
})
const sourceRows = computed(() => plan.value.sources.filter((x) => x.have > 0 || x.price !== undefined))
const costs = computed<[string, number][]>(() => [[feeName.value, plan.value.fee], ['補買', plan.value.buyCost], ['工匠代備的材料', plan.value.supplyCost]])
const hours = computed(() => (make.value ? craftRules.self.hours : gearRules.craft.hours) * plan.value.count)

function craft() {
  const u = parseUse(use.value)
  const target = make.value
    ? makeTarget(crafter.value.id, base.value, mat.value, aux.value, opts.value)
    : craftTarget(base.value, mat.value, aux.value, opts.value)
  void game.perform({ kind: make.value ? 'make' : 'craft', target, text: text.value, ...(u ? { use: u } : {}) })
  text.value = ''
  aux.value = []
  use.value = ''
  open.value = false
  emit('started')
}
</script>

<template>
  <BuildingMenu v-if="!make && here" :items="[menuItem]" @pick="open = true" />
  <component
    :is="make ? 'div' : AppDialog"
    v-if="here"
    v-bind="make ? {} : { open, title: '委託打造', icon: 'tools', width: '860px' }"
    v-on="make ? {} : { close: () => (open = false) }"
  >
  <div class="craft small">
    <p v-if="!make" class="muted intro">
      選部位、類型、底材，再選材料
      <Hint text="先用行囊裡的打造材料；不夠的份數由工匠代備（只代備第 2 級以下的材料），照最便宜的那種材料的價格另外收錢（自己帶夠就不收；也可以勾「全部由工匠代備」不用自己的）。第 3 級以上要自己帶，這間店有賣時可以當場補買。店主的工藝等級要達到材料等級，比需要的高時做得更好。" />
    </p>
    <div class="step">
      <span class="lab">搜尋</span>
      <div>
        <input v-model="query" class="search" placeholder="直接找底材，例如「帽」「靴」「弓」" />
        <div v-if="hits.length" class="chips hits">
          <button v-for="b in hits" :key="b.id" class="small" @click="jump(b.id)">{{ slotLabel(b.slot) }}・{{ b.type }}・{{ b.name }}</button>
        </div>
        <p v-else-if="query.trim()" class="muted">沒有名字裡有「{{ query.trim() }}」的底材{{ make ? '' : '（這間店做的）' }}。</p>
      </div>
    </div>

    <div class="step">
      <span class="lab">部位</span>
      <div class="chips">
        <button v-for="x in slots" :key="x" class="small" :class="{ primary: slot === x }" @click="pickSlot(x)">
          {{ slotLabel(x) }}<span class="n">{{ bases.filter((b) => b.slot === x).length }}</span>
        </button>
      </div>
    </div>

    <div class="step">
      <span class="lab">類型</span>
      <div class="chips">
        <button v-for="t in types" :key="t" class="small" :class="{ primary: type === t }" @click="typePick = t">
          {{ t }}<span class="n">{{ inSlot.filter((b) => b.type === t).length }}</span>
        </button>
      </div>
    </div>

    <div class="step">
      <span class="lab">底材</span>
      <div class="bases">
        <button v-for="b in list" :key="b.id" class="base" :class="{ on: base === b.id }" @click="basePick = b.id">
          <b>{{ b.name }}<GameIcon v-if="hasBlueprint(s, b.id)" name="scroll" :size="13" class="bp" title="有圖紙：自己打造不用加 DC" aria-label="有圖紙" /></b>
          <span class="muted">{{ MATERIAL_KIND_NAME[b.kind] }}<template v-if="statsOf(b.id, firstMaterial(b.kind))">・{{ statsOf(b.id, firstMaterial(b.kind)) }}</template></span>
        </button>
      </div>
    </div>

    <div class="step">
      <span class="lab">材料</span>
      <div>
        <table class="mats">
          <thead><tr><th>材料</th><th>等級</th><th class="wide">適合</th><th>持有</th><th>做出來的數值</th></tr></thead>
          <tbody>
            <tr v-for="m in materials" :key="m.id" class="mrow" :class="{ on: mat === m.id, locked: !canDo(m.tier) }" @click="material = m.id">
              <td class="nm"><ContentIcon kind="material" :id="m.id" :size="18" /> {{ m.name }}</td>
              <td class="nw">第 {{ m.tier }} 級<template v-if="!canDo(m.tier)"> 🔒</template></td>
              <td class="nw wide">建議 Lv.{{ m.level }}</td>
              <td class="nw">{{ `${ownedOf(m.id)} 份` }}</td>
              <td :class="statsOf(base, m.id) ? 'stat' : 'muted'">{{ statsOf(base, m.id) || '沒有加成' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted note">
          <template v-if="materials.some((m) => !canDo(m.tier))">🔒 {{ make ? `${crafter.name}的${skill.name}是 Lv.${levelHere}` : `這裡的工匠${skill.name}是 Lv.${levelHere}` }}，還做不了這一級。</template>
          數值由材料決定；成功程度只影響稀有度與附魔點數。
        </p>
      </div>
    </div>

    <!-- 成品卡（components/craft/CraftCard.vue） -->
    <CraftCard
      v-model:count="count" v-model:wish="text" v-model:use="use"
      :title="`${name}${plan.count > 1 ? ` ×${plan.count}` : ''}`" :tags="tags" :outcomes="outcomes" :check="check" :reqs="reqs"
      count-label="件數" :count-max="craftMaxCount()" :count-hint="COUNT_HINT" :hours="hours" :costs="costs"
      :blockers="plan.blockers" :busy="game.judging || !!s.pendingAction"
      :action="`${make ? `${crafter.isPlayer ? '親手' : `請${crafter.name}`}打造` : '委託打造'}${plan.count > 1 ? `（${plan.count} 件）` : ''}`"
      wish-placeholder="想要的樣子：例如刻上家紋、劍身帶著火焰紋路、取名「破曉」"
      @go="craft"
    >
      <template #icon><ItemIcon :spec="{ base, material: mat } as GearSpec" :size="30" /></template>
      <template #result>
        <div :class="line ? 'stat' : 'muted'">
          <EffectLine v-if="line" :parts="lineParts" /><template v-else>這個材料做出來沒有加成</template><template v-if="better">（換成{{ better.name }}：{{ statsOf(base, better.id) }}）</template>
        </div>
        <label v-if="lewdStats.length" class="lewd-row">慾望指標
          <select v-model="lewdPick">
            <option value="">不加</option>
            <option v-for="x in lewdStats" :key="x.st" :value="x.st" :disabled="!x.bonus">{{ lewdName(x.st) }} +{{ x.bonus }}</option>
          </select>
          <Hint text="自己打造成人向服裝、拘束具時可以加一項慾望指標：（委託的加成 + 1～2）× 做的人自己那一項的基本值 ÷ 100：指標 100 時第 1、2、3、4 級以上分別是 +5、+7、+10、+12，比成人用品店委託（+4、+6、+8、+10）多一點。" />
        </label>
      </template>
      <template #result-after>
        <p class="muted note">{{ plan.count > 1 ? '每件的附魔各自擲；' : '' }}數值由材料決定，成功程度只影響稀有度與附魔。</p>
      </template>
      <template #needs>
        <div v-if="plan.units" class="lst">
          <table class="need">
            <thead><tr><th>能做成{{ gearRules.materials[mat]!.name }}的材料</th><th class="num">持有</th><th class="num">這裡賣</th><th class="num">用掉</th></tr></thead>
            <tbody>
              <tr v-for="x in sourceRows" :key="x.name">
                <td>{{ x.name }}</td>
                <td class="num">{{ x.have }}</td>
                <td class="num">{{ x.price !== undefined ? `${formatMoney(x.price)}（剩 ${x.stock}）` : '—' }}</td>
                <td class="num">
                  <template v-if="plan.uses.find((u) => u.name === x.name)">{{ plan.uses.find((u) => u.name === x.name)!.qty }}</template><template v-else>—</template>
                  <span v-if="plan.buys.find((b) => b.name === x.name)" class="ok">（買 {{ plan.buys.find((b) => b.name === x.name)!.qty }}）</span>
                </td>
              </tr>
              <tr v-if="!sourceRows.length"><td colspan="4" class="muted">行囊裡沒有，這裡也沒有賣</td></tr>
            </tbody>
          </table>
          <div class="opts">
            <label v-if="sourceRows.length > 1" class="row">優先用
              <select v-model="usePick">
                <option value="">最便宜的</option>
                <option v-for="x in sourceRows" :key="x.name" :value="x.name">{{ x.name }}</option>
              </select>
            </label>
            <label v-if="(make || plan.tier > supplyMaxTier()) && soldHere.length && (needBuy || buy)" class="row"><input v-model="buy" type="checkbox" /> 不夠的當場補買</label>
            <label v-if="!make && plan.tier <= supplyMaxTier() && plan.have > 0" class="row"><input v-model="supplyAll" type="checkbox" /> 全部由工匠代備（不用行囊裡的）</label>
          </div>
          <p v-if="!make && plan.supplied" class="muted note">{{ plan.supplyAll ? '全部' : '不夠的' }} {{ plan.supplied }} 份由工匠代備：每份 {{ formatMoney(plan.supplyUnit) }}，共 {{ formatMoney(plan.supplyCost) }}（照最便宜的那種材料的價格）。{{ plan.supplyAll ? '' : '自己帶夠就不收。' }}</p>
          <p v-else-if="!make && plan.units > plan.have && plan.tier > supplyMaxTier()" class="muted note">工匠只代備第 {{ supplyMaxTier() }} 級以下的材料；第 {{ plan.tier }} 級的材料要自己帶{{ soldHere.length ? '，或在這間店當場補買' : '（打怪、開寶箱取得）' }}。</p>
          <p v-else-if="make && needBuy && !soldHere.length" class="muted note">這裡沒有賣；可以到{{ kind === 'metal' || kind === 'wood' ? '鐵匠鋪或雜貨店' : kind === 'jewel' ? '珠寶店' : '裁縫店或雜貨店' }}買，或打怪、開寶箱取得。</p>
        </div>
        <div class="aux-row">
          <span class="muted">輔料 <Hint :text="`選填，最多 ${auxRules.max_kinds} 種；不論結果都會用掉。價值越高越可能讓稀有度再高一級（部分成功時照成功做）；名稱與描述決定附魔偏向的屬性。`" /></span>
          <span v-for="(a, i) in aux" :key="a.name" class="tag">
            {{ a.name }} ×<input v-model.number="a.qty" type="number" min="1" :max="auxRules.max_qty" class="qty" />
            <button class="x" @click="aux.splice(i, 1)">×</button>
          </span>
          <template v-if="aux.length < auxRules.max_kinds && auxOptions.length">
            <select v-model="auxPick">
              <option value="">加入材料…</option>
              <option v-for="i in auxOptions" :key="i.name" :value="i.name">{{ i.name }}（持有 {{ i.qty }}）</option>
            </select>
            <button class="small" :disabled="!auxPick" @click="addAux">＋</button>
          </template>
          <span v-else-if="!aux.length" class="muted">行囊裡沒有材料。</span>
          <span v-if="aux.length" class="muted">
            {{ Math.round(plan.auxChance * 100) }}% 機率稀有度再高一級<template v-if="plan.elements.length">・附魔偏向 {{ plan.elements.map((e) => damageTypeName(e)).join('、') }}</template>
          </span>
        </div>
      </template>
    </CraftCard>
  </div>
  </component>
</template>

<style scoped>
.craft { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.craft p { margin: 0; }
.intro { display: flex; align-items: center; gap: 4px; }
.step { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: start; }
.step > .lab { color: var(--muted); font-weight: 600; padding-top: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .n { margin-left: 4px; font-size: var(--fs-xs); opacity: 0.7; }
.search { width: 100%; }
.hits { margin-top: 6px; }
.bases { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
.base { text-align: left; display: grid; gap: 2px; padding: 6px 9px; }
.base.on { outline: 2px solid var(--accent); outline-offset: -1px; }
.base .muted { font-size: var(--fs-xs); }
/* 有圖紙的底材：名字後面一個小卷軸 */
.base .bp { margin-left: 4px; vertical-align: -2px; color: var(--accent); }
table { width: 100%; border-collapse: collapse; }
.mats th, .need th { text-align: left; font-weight: 600; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--border); }
.mats td, .need td { padding: 4px 6px; border-bottom: 1px dashed color-mix(in srgb, currentColor 15%, transparent); vertical-align: top; }
.need th, .need td { padding: 3px 4px; }
.need .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mats .mrow { cursor: pointer; }
.mats .mrow:hover td { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.mats .mrow.on td { background: color-mix(in srgb, var(--accent) 22%, transparent); font-weight: 600; }
.mats .mrow.locked td { opacity: 0.55; }
.mats .nm { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
.mats .nw { white-space: nowrap; }
.stat { color: var(--good); font-weight: 600; }
.ok { color: var(--good); }
.note { margin: 0; font-size: var(--fs-xs); }
.lst { display: grid; gap: 4px; }
.opts { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.aux-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.aux-row .qty { width: 46px; }
.aux-row .x { padding: 0 4px; }
.lewd-row { display: flex; gap: 6px; align-items: center; }
@media (max-width: 640px) {
  .step { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .step > .lab { padding-top: 0; }
  .bases { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mats .wide { display: none; }
}
</style>
