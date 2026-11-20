<script setup lang="ts">
import { computed } from 'vue'
import type { ItemCategory } from '@/engine/data'
import { categoryIconSource, gearIconSource, itemIconSource } from '@/engine/itemIcons'
import type { GearSpec } from '@/engine/types'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import { sourceDraw, type DrawSource } from './itemIcon'

// 物品圖示：玩家上傳的圖，沒有時用內建的底材圖或類別圖（查找順序見 engine/itemIcons.ts）。
// 給 name 查物品；只給 spec 查底材；只給 category 查類別；source 直接指定（編輯器的預覽）。
const props = withDefaults(defineProps<{ name?: string; spec?: GearSpec; category?: ItemCategory; source?: DrawSource; size?: number }>(), { size: 24 })

const content = useContent()
const game = useGame()
const draw = computed(() => {
  void content.version
  const src = props.source
    ?? (props.name ? itemIconSource(game.state ?? undefined, props.name, props.spec) : props.spec ? gearIconSource(props.spec) : categoryIconSource(props.category))
  return sourceDraw(src)
})
</script>

<template>
  <img v-if="'img' in draw" class="item-icon img" :class="{ smooth: draw.smooth }" :src="draw.img" :width="size" :height="size" alt="" draggable="false" />
  <svg v-else class="item-icon" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true"><path :d="draw.path" :style="draw.color ? { fill: draw.color } : undefined" /></svg>
</template>

<style scoped>
.item-icon { flex: none; vertical-align: middle; }
svg.item-icon { fill: currentColor; shape-rendering: crispEdges; }
.img { object-fit: contain; image-rendering: pixelated; } /* 上傳的像素圖縮放時保持銳利 */
.img.smooth { image-rendering: auto; } /* 內建的圖是畫的，縮小時平滑 */
</style>
