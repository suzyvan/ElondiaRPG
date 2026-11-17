<script setup lang="ts">
// key-value 表格：左邊欄位名稱、中間數值、右邊補充（例如「行動點｜4｜每回合 +2」）
export interface StatItem {
  label: string
  value: string | number
  note?: string
  hint?: string
  /** 數值與補充都比較長：補充換到下一行（例如稱號、寄生） */
  wide?: boolean
}
withDefaults(defineProps<{ items: StatItem[]; columns?: number }>(), { columns: 1 })
// 數值與補充加起來太長時，補充自動換到下一行：不然數值那一欄會被擠成一個字一行（例如身上一串拘束具、戰鬥中的加成）
const LONG = 36
const isWide = (it: StatItem) => !!it.wide || String(it.value).length + (it.note?.length ?? 0) > LONG
</script>

<template>
  <div class="stat-grid" :style="{ '--cols': columns }">
    <div v-for="it in items" :key="it.label" class="kv" :class="{ wide: isWide(it) }" :title="it.hint">
      <span class="label">{{ it.label }}</span>
      <span class="v">{{ it.value }}</span>
      <span v-if="it.note" class="note">{{ it.note }}</span>
    </div>
  </div>
</template>

<style scoped>
.stat-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 0 24px; }
.kv { display: grid; grid-template-columns: 6.5em fit-content(55%) minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 5px 0; border-bottom: 1px dotted var(--border); }
.v { font-weight: 700; font-variant-numeric: tabular-nums; }
.v:last-child { grid-column: 2 / -1; }
.note { font-size: var(--fs-sm); color: var(--muted); text-align: right; }
.kv.wide .v { grid-column: 2 / -1; }
.kv.wide .note { grid-column: 2 / -1; text-align: left; }
</style>
