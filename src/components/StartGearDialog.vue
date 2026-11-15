<script setup lang="ts">
// 建立角色的起始裝備：依分類（武器、防具、飾品）與欄位列出能選的所有裝備，每一件的性能與預算都算好了。
// 職業的基本配備（第 1 級材料）不花預算；基本配備欄位升級材料花「等級 - 1」，其他欄位加裝備花材料等級（gear.ts 的 creationCatalog）。
import { computed, ref } from 'vue'
import { armorDef, attrName, damageTypeName, weaponDef, type AttrId } from '@/engine/data'
import { describeEffects } from '@/engine/perks'
import {
  creationCatalog, creationCost, gearRules, gearStats, MOD_NAME, rarityName, SLOT_CATEGORY, slotNameFor, weaponLine, type CreationGear, type CreationOption, type CreationPick,
} from '@/engine/gear'
import type { GearSlot } from '@/engine/types'
import AppDialog from './AppDialog.vue'
import ItemIcon from './items/ItemIcon.vue'
import ContentIcon from './icons/ContentIcon.vue'

const props = defineProps<{ open: boolean; classId: string; race: string; classWeapons?: boolean; budget: number; spent: number }>()
const emit = defineEmits<{ close: [] }>()
/** 各欄位的選擇（基本配備欄位一定有東西；其他欄位可以是 undefined） */
const picks = defineModel<CreationGear>({ required: true })

const catalog = computed(() => creationCatalog(props.classId, props.race, props.classWeapons))
const slotName = (slot: GearSlot) => slotNameFor(slot, props.race)
const CATEGORIES = [
  { id: 'weapon', name: '武器' },
  { id: 'armor', name: '防具' },
  { id: 'accessory', name: '飾品' },
] as const
type Category = (typeof CATEGORIES)[number]['id']
const category = ref<Category>('weapon')
const slots = computed(() => catalog.value.filter((s) => SLOT_CATEGORY[s.slot] === category.value))
const slot = ref<GearSlot>('main_hand')
const current = computed(() => slots.value.find((s) => s.slot === slot.value) ?? slots.value[0])
const tierFilter = ref(0)
const maxTier = gearRules.creation.max_tier

function pickCategory(c: Category) {
  category.value = c
  slot.value = catalog.value.find((s) => SLOT_CATEGORY[s.slot] === c)?.slot ?? slot.value
}

const twoHanded = computed(() => !!gearRules.bases[picks.value.main_hand?.base ?? '']?.two_handed)
const blockedSlot = (s: GearSlot) => s === 'off_hand' && twoHanded.value
/** 同一件：自建的裝備比物品名稱，制式品比底材與材料等級 */
const samePick = (p: CreationPick | undefined, o: Pick<CreationOption, 'base' | 'tier' | 'item'>) => !!p && (o.item ? p.item === o.item : !p.item && p.base === o.base && p.tier === o.tier)
const isPicked = (o: CreationOption) => samePick(picks.value[o.slot], o)
const asPick = (o: CreationOption): CreationPick => ({ base: o.base, tier: o.tier, ...(o.item ? { item: o.item } : {}) })
/** 換成這一件之後的總花費 */
function costIf(o: CreationOption): number {
  return creationCost(props.classId, { ...picks.value, [o.slot]: asPick(o) })
}

function choose(o: CreationOption) {
  picks.value = { ...picks.value, [o.slot]: asPick(o) }
}
function clear(s: GearSlot) {
  const next = { ...picks.value }
  delete next[s]
  picks.value = next
}

const onlyCustom = ref(false)
const hasCustom = computed(() => catalog.value.some((s) => s.options.some((o) => o.custom)))
const options = computed(() => (current.value?.options ?? [])
  .filter((o) => !tierFilter.value || o.tier === tierFilter.value)
  .filter((o) => !onlyCustom.value || o.custom))

// ---- 性能 ----
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
function attackOf(o: CreationOption): string {
  const s = gearStats(o.spec)
  if (!s.weapon) return ''
  const w = weaponDef(s.weapon)
  return weaponLine(w, s.two_handed)
}
function defenseOf(o: CreationOption): string {
  const s = gearStats(o.spec)
  if (!s.armor) return ''
  const a = armorDef(s.armor)
  return `迴避 ${signed(a.evade)}・減傷 ${a.dr}`
}
function bonusOf(o: CreationOption): string {
  const s = gearStats(o.spec)
  return [
    ...Object.entries(s.mods).filter(([, v]) => v).map(([k, v]) => `${MOD_NAME[k] ?? k} ${signed(v!)}`),
    ...Object.entries(s.resist).filter(([, v]) => v).map(([k, v]) => `${damageTypeName(k)} ×${Math.round((1 + v!) * 100) / 100}`),
    ...Object.entries(s.offense).filter(([, v]) => v).map(([k, v]) => `${damageTypeName(k)}攻擊 ×${Math.round((1 + v!) * 100) / 100}`),
    ...Object.entries(o.spec.attrs ?? {}).filter(([, v]) => v).map(([k, v]) => `${attrName(k as AttrId)} ${signed(v!)}`),
    ...(o.spec.unique ? [`獨特：${describeEffects([o.spec.unique]).replace(/。$/, '')}`] : []),
  ].join('、')
}
const materialOf = (o: CreationOption) => gearRules.materials[o.spec.material]

/** 下方的清單：每個欄位現在選的 */
const summary = computed(() => catalog.value.map((s) => {
  const p = picks.value[s.slot]
  const o = p ? s.options.find((x) => samePick(p, x)) : undefined
  return { slot: s.slot, template: s.template, option: o, blocked: blockedSlot(s.slot) }
}))
</script>

<template>
  <AppDialog :open="open" title="起始裝備" icon="shield" width="1080px" @close="emit('close')">
    <div class="gear-dialog">
      <div class="budget row">
        <span>預算 <strong :class="{ over: spent > budget }">{{ spent }} / {{ budget }}</strong> 點</span>
        <span class="small muted">職業的基本配備（第 1 級材料）免費；基本配備升級材料花「等級 - 1」，其他欄位的裝備花它的材料等級（最多第 {{ maxTier }} 級）。世界裡自建的裝備花材料等級，加上稀有度多出的附魔點數、獨特效果 1 點與屬性加值。預算在「設定」的遊戲規則裡調整。</span>
      </div>
      <nav class="tabs">
        <button v-for="c in CATEGORIES" :key="c.id" class="small" :class="{ on: category === c.id }" @click="pickCategory(c.id)">{{ c.name }}</button>
      </nav>
      <nav class="tabs slots">
        <button
          v-for="s in slots" :key="s.slot" class="small" :class="{ on: current?.slot === s.slot, has: !!picks[s.slot] && !blockedSlot(s.slot) }"
          :disabled="blockedSlot(s.slot)" :title="blockedSlot(s.slot) ? '雙手武器，不能拿副手' : ''" @click="slot = s.slot"
        >
          {{ slotName(s.slot) }}<span v-if="s.template" class="muted">（基本）</span>
        </button>
        <label v-if="hasCustom" class="small check only-custom"><input v-model="onlyCustom" type="checkbox" /> 只看自建</label>
        <label class="small tier-filter">材料等級
          <select v-model.number="tierFilter">
            <option :value="0">全部</option>
            <option v-for="t in maxTier" :key="t" :value="t">第 {{ t }} 級</option>
          </select>
        </label>
      </nav>
      <div v-if="current" class="scroll">
        <table class="catalog">
          <thead>
            <tr><th /><th>裝備</th><th>材料</th><th>攻擊</th><th>防禦</th><th>其他加成</th><th class="num">預算</th></tr>
          </thead>
          <tbody>
            <tr v-if="!current.template" :class="{ on: !picks[current.slot] }" @click="clear(current.slot)">
              <td class="pick"><input type="radio" :checked="!picks[current.slot]" @click.stop="clear(current.slot)" /></td>
              <td colspan="5" class="muted">（不裝備）</td>
              <td class="num">0</td>
            </tr>
            <tr
              v-for="o in options" :key="o.item ? `i:${o.item}` : `${o.base}-${o.tier}`"
              :class="{ on: isPicked(o), over: !isPicked(o) && costIf(o) > budget }"
              @click="choose(o)"
            >
              <td class="pick"><input type="radio" :checked="isPicked(o)" @click.stop="choose(o)" /></td>
              <td class="name"><span class="item-tile" :class="`r-${o.spec.rarity ?? materialOf(o)?.rarity}`"><ItemIcon :name="o.item" :spec="o.spec" :size="20" /></span>{{ o.name }}<span v-if="o.custom" class="tag">{{ o.item ? '自建裝備' : '自建底材' }}</span></td>
              <td class="nowrap"><ContentIcon kind="material" :id="o.spec.material" :size="14" /> {{ materialOf(o)?.name }}<span class="muted">（{{ o.tier }} 級・{{ rarityName(materialOf(o)?.rarity ?? 'common') }}）</span></td>
              <td class="nowrap">{{ attackOf(o) }}</td>
              <td class="nowrap">{{ defenseOf(o) }}</td>
              <td class="bonus">{{ bonusOf(o) }}</td>
              <td class="num"><b>{{ o.cost === 0 ? '免費' : `${o.cost} 點` }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4 class="small">目前的配備</h4>
      <table class="summary small">
        <tbody>
        <tr v-for="r in summary" :key="r.slot" :class="{ off: r.blocked }">
          <th>{{ slotName(r.slot) }}<span v-if="r.template" class="muted">（基本）</span></th>
          <td>
            <template v-if="r.blocked">雙手武器，不能拿副手</template>
            <template v-else-if="r.option">{{ r.option.name }}</template>
            <span v-else class="muted">—</span>
          </td>
          <td class="num">{{ r.option && !r.blocked ? (r.option.cost ? `${r.option.cost} 點` : '免費') : '' }}</td>
          <td class="act"><button v-if="r.option && !r.template && !r.blocked" class="small ghost" @click="clear(r.slot)">拿掉</button></td>
        </tr>
        </tbody>
      </table>
      <p v-if="spent > budget" class="over small">超過預算 {{ spent - budget }} 點：降低材料等級或拿掉幾件。</p>
      <div class="row end"><button class="primary" @click="emit('close')">完成</button></div>
    </div>
  </AppDialog>
</template>

<style scoped>
.gear-dialog { display: grid; gap: 8px; }
.budget { gap: 10px; align-items: baseline; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tabs button.on { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.tabs button.has:not(.on)::after { content: '●'; font-size: 8px; margin-left: 3px; color: var(--accent); vertical-align: 2px; }
.only-custom { margin-left: auto; display: inline-flex; gap: 4px; align-items: center; }
.only-custom + .tier-filter { margin-left: 8px; }
.tier-filter { margin-left: auto; display: inline-flex; gap: 4px; align-items: center; }
.scroll { max-height: 46vh; overflow: auto; border: 1px solid var(--border); border-radius: 2px; }
.catalog { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.catalog thead th { position: sticky; top: 0; background: var(--parchment-2, var(--panel)); font-size: var(--fs-xs); font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border); z-index: 1; }
.catalog td { padding: 4px 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); vertical-align: middle; }
.catalog tbody tr { cursor: pointer; }
.catalog tbody tr:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.catalog tr.on { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.catalog tr.over .num { color: var(--danger); }
.catalog .pick { width: 1%; }
.catalog .name { display: flex; align-items: center; gap: 6px; font-weight: 700; white-space: nowrap; }
.catalog .name .item-tile { width: 26px; height: 26px; }
.catalog .bonus { font-size: var(--fs-xs); }
.num { text-align: right; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.summary { border-collapse: collapse; width: 100%; }
.summary th { text-align: left; font-weight: 600; white-space: nowrap; padding: 2px 10px 2px 0; width: 1%; }
.summary td { padding: 2px 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
.summary .act { width: 1%; white-space: nowrap; }
.summary tr.off { opacity: 0.6; }
h4 { margin: 4px 0 0; }
.over { color: var(--danger); }
.end { justify-content: flex-end; }
</style>
