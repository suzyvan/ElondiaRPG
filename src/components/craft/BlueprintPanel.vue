<script setup lang="ts">
import { computed } from 'vue'
import { blueprintRules } from '@/engine/blueprints'
import { baseShown, baseSlotName, CRAFT_SLOT_ORDER, gearRules, MATERIAL_KIND_NAME, type BaseSlot } from '@/engine/gear'
import { useGame } from '@/stores/game'

// 工藝的「已有圖紙」分頁（docs/CRAFTING.md 2.2 節）：拿到的圖紙（店裡買的、敵人身上搜到的、任務給的）自動列在這裡，
// 依部位分組；點一張就到「打造裝備」選好那個底材
const emit = defineEmits<{ open: [base: string] }>()
const game = useGame()

const groups = computed(() => {
  const owned = (game.state?.blueprints ?? []).filter((b) => gearRules.bases[b] && baseShown(b))
  const bySlot = new Map<string, string[]>()
  for (const b of owned) {
    const slot = gearRules.bases[b]!.slot
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), b])
  }
  const order = [...CRAFT_SLOT_ORDER, ...[...bySlot.keys()].filter((x) => !CRAFT_SLOT_ORDER.includes(x as BaseSlot))]
  return order.filter((x) => bySlot.has(x)).map((slot) => ({
    slot, name: baseSlotName(slot as BaseSlot),
    items: bySlot.get(slot)!.sort((a, b) => gearRules.bases[a]!.price - gearRules.bases[b]!.price),
  }))
})
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
</script>

<template>
  <div class="bps">
    <p class="small muted">
      有圖紙的底材自己打造不用加 DC（沒有時 +{{ blueprintRules().dc_without }}），不會用掉，任何材料都適用；委託店家打造不需要圖紙。
      圖紙在會打造那種底材的店（鐵匠鋪、裁縫店、珠寶店、成人用品店）買，也可能從人形的敵人身上搜到。
    </p>
    <p v-if="!total" class="muted">還沒有圖紙。</p>
    <section v-for="g in groups" :key="g.slot" class="group">
      <h4>{{ g.name }} <span class="muted small">{{ g.items.length }}</span></h4>
      <div class="list">
        <button v-for="b in g.items" :key="b" class="bp" :title="`到「打造裝備」選${gearRules.bases[b]!.name}`" @click="emit('open', b)">
          <b>{{ gearRules.bases[b]!.name }}</b>
          <span class="small muted">{{ MATERIAL_KIND_NAME[gearRules.bases[b]!.kind] }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bps { display: grid; gap: 8px; }
.bps p { margin: 0; }
.group h4 { margin: 4px 0; color: var(--accent-2); letter-spacing: 0.1em; }
.list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
.bp { display: grid; gap: 2px; text-align: left; padding: 6px 9px; }
</style>
