<script setup lang="ts">
import { computed, watch } from 'vue'
import { ABILITY_CATEGORIES, abilityCategory } from '@/engine/abilityCategory'
import type { AbilityCategoryId, AbilityDef } from '@/engine/data'

// 能力的分類按鈕（engine/abilityCategory.ts）：角色詳情的能力分頁、戰鬥中的技能選單共用。
// 只列這些能力裡有的分類；選的分類不在這份清單裡（換人了）時回到「全部」
const props = defineProps<{ abilities: AbilityDef[]; modelValue: AbilityCategoryId | '' }>()
const emit = defineEmits<{ 'update:modelValue': [AbilityCategoryId | ''] }>()

const counts = computed(() => {
  const out: Partial<Record<AbilityCategoryId, number>> = {}
  for (const a of props.abilities) {
    const c = abilityCategory(a)
    out[c] = (out[c] ?? 0) + 1
  }
  return out
})
const shown = computed(() => ABILITY_CATEGORIES.filter((c) => counts.value[c.id]))
watch([shown, () => props.modelValue], () => {
  if (props.modelValue && !counts.value[props.modelValue]) emit('update:modelValue', '')
}, { immediate: true })
</script>

<template>
  <div v-if="shown.length > 1" class="cat-chips" role="group" aria-label="能力分類">
    <button class="small" :class="{ on: !modelValue }" :aria-pressed="!modelValue" @click="emit('update:modelValue', '')">全部 <span class="n">{{ abilities.length }}</span></button>
    <button
      v-for="c in shown" :key="c.id" class="small" :class="{ on: modelValue === c.id }" :aria-pressed="modelValue === c.id" :title="c.hint"
      @click="emit('update:modelValue', modelValue === c.id ? '' : c.id)"
    >{{ c.name }} <span class="n">{{ counts[c.id] }}</span></button>
  </div>
</template>

<style scoped>
.cat-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 6px; }
.cat-chips button { padding: 2px 9px; }
.cat-chips button.on { background: var(--accent); color: var(--parchment, #f4e6c4); border-color: var(--accent); }
.n { opacity: 0.7; font-variant-numeric: tabular-nums; }
</style>
