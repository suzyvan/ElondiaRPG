<script setup lang="ts">
import { computed, ref } from 'vue'
import { attrName, craftRules, damageTypeName, itemDef } from '@/engine/data'
import { canCraftHere, craftKindsHere, craftPlan, craftRarity, craftTarget, makeTarget, type AuxItem } from '@/engine/craft'
import { crafters, skillOf, toolTierFor, toolTierName, toolWhere } from '@/engine/crafting'
import { baseShown, baseSlotName, gearName, gearRules, gearSummary, rarityName, rarityPoints, type BaseSlot } from '@/engine/gear'
import { formatMoney } from '@/engine/money'
import { parseUse, useGame } from '@/stores/game'
import AbilityPicker from './AbilityPicker.vue'
import AppDialog from './AppDialog.vue'
import BuildingMenu, { type MenuItem } from './place/BuildingMenu.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'
import ContentIcon from './icons/ContentIcon.vue'

// 打造裝備（data/rules/gear.json 的 craft）：選底材與材料，可以描述想要的樣子。
// commission：在鐵匠鋪、裁縫店、珠寶店委託店主；make：主角或肯幫忙的夥伴自己動手（crafts.json）
const props = withDefaults(defineProps<{ mode?: 'commission' | 'make' }>(), { mode: 'commission' })
const make = computed(() => props.mode === 'make')
// 店裡的委託打造是選單的一列，點了打開對話框；工藝對話框裡直接顯示
const menuItem = computed<MenuItem>(() => ({
  id: 'commission', icon: 'tools', label: '委託打造', detail: `${attrName(gearRules.craft.attr)}檢定，約 ${gearRules.craft.hours} 小時`,
}))
const open = ref(false)
const emit = defineEmits<{ started: [] }>()
const game = useGame()
const s = computed(() => game.state!)
const here = computed(() => make.value || canCraftHere(s.value))

// 自己動手：誰來做（不肯幫忙的列出原因）
const who = computed(() => crafters(s.value))
const crafterId = ref('pc')
const crafter = computed(() => who.value.find((w) => w.member.id === crafterId.value && !w.refusal)?.member ?? s.value.party.find((m) => m.isPlayer)!)

// 委託：只列這間店做得出來的底材（鐵匠鋪：金屬、木材；裁縫店：皮革、布料；珠寶店：寶石）；自己動手：全部
const bases = computed(() => Object.entries(gearRules.bases).filter(([id, b]) => !b.restraint && !b.exclusive && baseShown(id) && (make.value || craftKindsHere(s.value).includes(b.kind))).map(([id, b]) => ({ id, ...b })))
const picked = ref('')
const base = computed({
  get: () => (bases.value.some((b) => b.id === picked.value) ? picked.value : bases.value[0]?.id ?? 'longsword'),
  set: (v: string) => { picked.value = v },
})
const kind = computed(() => gearRules.bases[base.value]!.kind)
const materials = computed(() => Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind.value).map(([id, m]) => ({ id, ...m })))
const material = ref('iron')
const mat = computed(() => (gearRules.materials[material.value]?.kind === kind.value ? material.value : materials.value[0]!.id))
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
const plan = computed(() => craftPlan(s.value, base.value, mat.value, aux.value, make.value ? crafter.value : undefined))
const skill = computed(() => craftRules.skills[plan.value.craft])
const text = ref('')
const use = ref('')
const slotLabel = (slot: string) => baseSlotName(slot as BaseSlot)

function craft() {
  const u = parseUse(use.value)
  const target = make.value ? makeTarget(crafter.value.id, base.value, mat.value, aux.value) : craftTarget(base.value, mat.value, aux.value)
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
    v-bind="make ? {} : { open, title: '委託打造', icon: 'tools', width: '760px' }"
    v-on="make ? {} : { close: () => (open = false) }"
  >
  <div class="craft small">
    <p v-if="!make" class="muted intro">
      材料與工匠的等級
      <Hint text="第一級材料由工匠提供；更好的材料要自備（龍鱗、秘銀礦石之類可以打造的材料）。店主的工藝等級要達到材料等級，比需要的高時做得更好。" />
    </p>
    <p v-else class="muted intro">
      自己打造
      <Hint text="第一級材料自己買（材料費），更好的材料要自備。做的人擲屬性檢定，加上工藝等級。成功時做的人得到工藝經驗。" />
    </p>
    <table class="kv">
      <tbody>
      <tr v-if="make">
        <th>誰來做</th>
        <td>
          <select v-model="crafterId">
            <option v-for="w in who" :key="w.member.id" :value="w.member.id" :disabled="!!w.refusal">{{ w.member.name }}{{ w.refusal ? `（${w.refusal}）` : '' }}</option>
          </select>
        </td>
      </tr>
      <tr>
        <th>底材</th>
        <td>
          <select v-model="base">
            <option v-for="b in bases" :key="b.id" :value="b.id">{{ slotLabel(b.slot) }}・{{ b.name }}</option>
          </select>
        </td>
      </tr>
      <tr>
        <th>材料</th>
        <td class="pick">
          <ContentIcon kind="material" :id="mat" :size="20" />
          <select :value="mat" @change="material = ($event.target as HTMLSelectElement).value">
            <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}（{{ rarityName(m.rarity) }}，建議 {{ m.level }} 級）</option>
          </select>
        </td>
      </tr>
      <tr><th>成品</th><td><b>{{ gearName({ base, material: mat }) }}</b><div class="muted">{{ gearSummary({ base, material: mat }) }}</div></td></tr>
      <tr><th>{{ skill.name }}</th><td>{{ make ? `${crafter.name} Lv.${skillOf(crafter, plan.craft).level}` : `工匠 Lv.${plan.level}` }}<span class="muted">（這個材料要 Lv.{{ plan.tier }}）</span></td></tr>
      <tr><th>檢定</th><td>{{ attrName(make ? skill.attr : gearRules.craft.attr) }}<template v-if="make"> +{{ plan.level * craftRules.level_bonus }}</template>・DC {{ plan.dc }}</td></tr>
      <tr><th>時間</th><td>約 {{ make ? craftRules.self.hours : gearRules.craft.hours }} 小時</td></tr>
      <tr v-if="make"><th>工具</th><td>要{{ toolTierName(toolTierFor(plan.tier)) }} <Hint :text="toolWhere(plan.craft, toolTierFor(plan.tier))" /><span class="muted">・現在 {{ plan.tool?.source }}</span></td></tr>
      <tr>
        <th>{{ make ? '花費' : '工錢' }}</th>
        <td>{{ formatMoney(plan.fee) }}<span v-if="make && (plan.materialCost || plan.rent)" class="muted">（{{ [plan.materialCost ? `材料費 ${formatMoney(plan.materialCost)}` : '', plan.rent ? `工坊租金 ${formatMoney(plan.rent)}` : ''].filter(Boolean).join('、') }}）</span></td>
      </tr>
      <tr v-if="plan.units">
        <th>打造材料</th>
        <td :class="{ short: plan.have < plan.units }">{{ plan.have }} / {{ plan.units }} 份<span v-if="plan.uses.length" class="muted">（用掉 {{ plan.uses.map((u) => `${u.name}×${u.qty}`).join('、') }}）</span></td>
      </tr>
      <tr>
        <th>輔料 <Hint :text="`選填，最多 ${auxRules.max_kinds} 種；不論結果都會用掉。`" /></th>
        <td>
          <div class="aux">
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
          </div>
          <div v-if="aux.length" class="muted">
            輔料價值 {{ formatMoney(plan.auxValue) }}：{{ Math.round(plan.auxChance * 100) }}% 機率品質再高一級（部分成功時照成功做）<template v-if="plan.elements.length">・附魔偏向 {{ plan.elements.map((e) => damageTypeName(e)).join('、') }}</template>
          </div>
        </td>
      </tr>
      </tbody>
    </table>
    <table class="outcomes">
      <tbody>
      <tr><th>大成功</th><th>成功</th><th>部分成功</th><th>失敗</th></tr>
      <tr>
        <td>{{ rarityName(craftRarity(mat, 'critical')!) }}<div class="muted">附魔 {{ rarityPoints(craftRarity(mat, 'critical')!) }} 點</div></td>
        <td>{{ rarityName(craftRarity(mat, 'success')!) }}<div class="muted">附魔 {{ rarityPoints(craftRarity(mat, 'success')!) }} 點</div></td>
        <td>沒有附魔</td>
        <td>材料損失一半</td>
      </tr>
      </tbody>
    </table>
    <ul v-if="plan.blocked" class="warn blockers"><li v-for="b in plan.blockers" :key="b"><GameIcon name="warning" :size="13" /> {{ b }}</li></ul>
    <template v-else>
      <input v-model="text" placeholder="想要的樣子（選填）：例如刻上家紋、劍身帶著火焰紋路、取名「破曉」" />
      <AbilityPicker v-model="use" />
      <button class="small" :disabled="game.judging || !!s.pendingAction" @click="craft"><GameIcon name="tools" :size="13" /> {{ make ? `${crafter.isPlayer ? '親手' : `請${crafter.name}`}打造` : '委託打造' }}</button>
    </template>
  </div>
  </component>
</template>

<style scoped>
.craft { display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); }
.craft input:not([type]) { width: 100%; }
.pick { display: flex; gap: 6px; align-items: center; }
.kv select { max-width: 100%; }
.craft p { margin: 0; }
.aux { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.aux .qty { width: 46px; }
.aux .x { padding: 0 4px; }
.intro { display: flex; align-items: center; gap: 4px; }
.warn { color: var(--danger); }
table { width: 100%; border-collapse: collapse; }
.kv th { text-align: left; font-weight: 600; white-space: nowrap; width: 1%; padding: 5px 14px 5px 0; color: var(--muted); vertical-align: top; }
.kv td { padding: 5px 0; vertical-align: top; }
.kv tr + tr > * { border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.short { color: var(--danger); }
.outcomes { margin: 4px 0 2px; text-align: center; font-size: var(--fs-xs); }
.outcomes th { font-weight: 600; color: var(--muted); padding: 4px; border-bottom: 1px solid var(--border); }
.outcomes td { padding: 4px; vertical-align: top; }
.blockers { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.blockers li { display: flex; gap: 4px; align-items: baseline; }
</style>
