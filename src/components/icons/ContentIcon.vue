<script setup lang="ts">
// 怪物、技能、材料、特質的圖示（內建的像素圖；怪物可以有上傳的圖）。
// 給 id 查目前的內容；給 def 直接用（編輯器的草稿、角色身上的自訂特質）。
import { computed } from 'vue'
import { abilities, enemies, perkDef, type AbilityDef, type EnemyDef, type PerkDef } from '@/engine/data'
import { gearRules, type MaterialDef } from '@/engine/gear'
import { useContent } from '@/stores/content'
import type { IconLayer } from '../ui/pixelArt'
import { abilityGlyph, abilityLayers } from './abilityArt'
import { materialDraw } from './materialArt'
import { monsterDraw } from './monsterArt'
import { perkDraw } from './perkArt'

type Def =
  | { kind: 'monster'; def?: Pick<EnemyDef, 'kind' | 'level' | 'icon'> & { id?: string } }
  | { kind: 'ability'; def?: Pick<AbilityDef, 'type' | 'damage' | 'heal' | 'shield' | 'target'> }
  | { kind: 'material'; def?: Pick<MaterialDef, 'kind' | 'tier' | 'rarity'> }
  | { kind: 'perk'; def?: Pick<PerkDef, 'effects' | 'flaw' | 'rarity'> }

const props = withDefaults(defineProps<{
  kind: Def['kind']
  id?: string
  def?: NonNullable<Def['def']>
  size?: number
}>(), { size: 24 })

const content = useContent()

const draw = computed<{ img: string; smooth?: boolean } | { layers: IconLayer[] } | undefined>(() => {
  void content.version
  const id = props.id ?? ''
  switch (props.kind) {
    case 'monster': {
      const e = (props.def as EnemyDef | undefined) ?? enemies[id]
      if (!e) return undefined
      const d = monsterDraw({ ...e, id: (e as { id?: string }).id ?? id })
      return 'img' in d ? d : { layers: [{ d: d.path, color: d.color }] }
    }
    case 'ability': {
      const a = (props.def as AbilityDef | undefined) ?? abilities[id]
      return a ? { layers: abilityLayers(a.type, abilityGlyph(a)) } : undefined
    }
    case 'material': {
      const m = (props.def as MaterialDef | undefined) ?? gearRules.materials[id]
      if (!m) return undefined
      const d = materialDraw(m)
      return { layers: [{ d: d.path, color: d.color }] }
    }
    case 'perk': {
      const p = (props.def as PerkDef | undefined) ?? perkDef(id)
      if (!p) return undefined
      const d = perkDraw(p)
      return { layers: [{ d: d.path, color: d.color }] }
    }
  }
  return undefined
})
</script>

<template>
  <!-- 圖都是亮色的：一律放在深色的小底框裡，羊皮紙對話框裡也看得清楚 -->
  <span v-if="draw" class="content-icon" :style="{ width: `${size + 4}px`, height: `${size + 4}px` }">
    <img v-if="'img' in draw" :class="{ smooth: draw.smooth }" :src="draw.img" :width="size" :height="size" alt="" draggable="false" />
    <svg v-else :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
      <path v-for="(l, i) in draw.layers" :key="i" :d="l.d" :style="{ fill: l.color, opacity: l.opacity }" />
    </svg>
  </span>
</template>

<style scoped>
.content-icon {
  flex: none; display: inline-grid; place-items: center; vertical-align: middle; border-radius: 2px;
  background: #2a1e14; box-shadow: inset 0 0 0 1px #c99a4533;
}
svg { shape-rendering: crispEdges; }
img { object-fit: contain; image-rendering: pixelated; }
img.smooth { image-rendering: auto; } /* 內建的圖是畫的，縮小時平滑 */
</style>
