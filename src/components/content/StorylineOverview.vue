<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { stories, storyCounters } from '@/engine/data'
import { START_KINDS } from '@/engine/storyMods'
import { storylines, type LineEdge } from '@/engine/storylines'
import { layerLayout } from '@/engine/storyGraph'
import { useContent } from '@/stores/content'
import { measureEdges } from './graphEdges'
import { vMarquee } from '../marquee'
import HelpText from './HelpText.vue'

// 故事線總覽（docs/plan/roadmap/WORLD_EDITOR_PLAN.md E3c）：任務與任務之間怎麼接。
// 左邊是故事線（接取條件與「開始特殊任務」連起來的群組），右邊畫選的那一條；點任務打開它的編輯器。
const emit = defineEmits<{ open: [string] }>()
const content = useContent()

const lines = computed(() => {
  void content.version
  return storylines().sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name, 'zh-Hant'))
})
const byId = computed(() => {
  void content.version
  return new Map(stories.map((s) => [s.id, s]))
})
const search = ref('')
const shown = computed(() => {
  const q = search.value.trim()
  if (!q) return lines.value
  return lines.value.filter((l) => l.name.includes(q) || l.ids.some((id) => byId.value.get(id)?.title.includes(q) || l.edges.some((e) => e.flags.some((f) => f.includes(q)))))
})
const pick = ref(0)
const line = computed(() => shown.value[Math.min(pick.value, shown.value.length - 1)])
watch(search, () => { pick.value = 0 })

const cols = computed(() => (line.value ? layerLayout(line.value.ids, line.value.edges.filter((e) => e.kind !== 'echo')) : []))
/** 任務寫與讀的計數器（卡片上的小標） */
function counters(id: string): string[] {
  const s = byId.value.get(id)
  if (!s) return []
  const out = new Set<string>()
  const walk = (v: unknown, k = '') => {
    if (Array.isArray(v)) v.forEach((x) => walk(x))
    else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) {
      if (kk === 'counters' && x && typeof x === 'object') for (const c of Object.keys(x)) out.add(storyCounters[c]?.name ?? c)
      walk(x, kk)
    }
    void k
  }
  walk(s)
  return [...out]
}
const showFlags = ref(false)
const KIND_NAME: Record<LineEdge['kind'], string> = { unlock: '開放', start: '直接開啟', block: '關掉', echo: '呼應' }

// ---- 線 ----
const root = ref<HTMLElement | null>(null)
const els = new Map<string, HTMLElement>()
const setEl = (id: string) => (el: unknown) => {
  if (el instanceof HTMLElement) els.set(id, el)
  else els.delete(id)
}
const paths = shallowRef<{ d: string; kind: LineEdge['kind']; label: string; x: number; y: number; from: string; to: string }[]>([])
const size = ref({ w: 0, h: 0 })
const hover = ref<string | null>(null)
function measure() {
  if (!root.value || !line.value) {
    paths.value = []
    return
  }
  size.value = { w: root.value.scrollWidth, h: root.value.scrollHeight }
  paths.value = measureEdges(root.value, els, line.value.edges).map(({ edge: e, d, x, y }) => ({ d, kind: e.kind, label: e.kind === 'start' ? '▶' : e.flags.map((f) => `🚩${f}`).join(' '), x, y, from: e.from, to: e.to }))
}
let ro: ResizeObserver | undefined
onMounted(() => {
  void nextTick(measure)
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(root.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
watch([line, showFlags], () => void nextTick(measure))
</script>

<template>
  <div class="editor overview">
    <div class="row head-line">
      <h3>🗺️ 故事線總覽</h3>
      <span class="muted small">{{ lines.length }} 條、{{ stories.length }} 個任務</span>
    </div>
    <HelpText text="任務 A 設定的旗標是任務 B 的接取條件、或 A 的結果「開始特殊任務」開啟 B，兩個任務就在同一條故事線上。B 的任務點或選項讀到 A 的旗標（呼應別條線）畫成虛線。點任務打開它的編輯器。" />
    <div class="split">
      <div class="lines">
        <input v-model="search" placeholder="搜尋故事線、任務名稱或旗標" />
        <ul class="plain">
          <li v-for="(l, i) in shown" :key="l.ids[0]" :class="{ active: line === l }" tabindex="0" @click="pick = i" @keydown.enter.self.prevent="pick = i">
            <span class="name">{{ l.name }}</span><span class="muted small">{{ l.ids.length }}</span>
          </li>
          <li v-if="!shown.length" class="muted small">沒有符合的故事線。</li>
        </ul>
      </div>
      <div v-if="line" class="pane">
        <div class="row small graph-bar">
          <b>{{ line.name }}</b>
          <label class="check"><input v-model="showFlags" type="checkbox" /> 在線上顯示旗標</label>
          <span class="legend"><i class="ln unlock" />開放 <i class="ln start" />直接開啟 <i class="ln block" />關掉 <i class="ln echo" />呼應</span>
        </div>
        <div class="scroll">
          <div ref="root" class="graph">
            <svg class="edges" :width="size.w" :height="size.h" aria-hidden="true">
              <defs><marker id="sl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>
              <g v-for="(p, i) in paths" :key="i" :class="[p.kind, { lit: hover && (p.from === hover || p.to === hover) }]">
                <path :d="p.d" marker-end="url(#sl-arrow)"><title>{{ KIND_NAME[p.kind] }} {{ p.label }}</title></path>
                <text v-if="showFlags && p.label" :x="p.x" :y="p.y - 3" text-anchor="middle">{{ p.label }}</text>
              </g>
            </svg>
            <div v-for="(col, c) in cols" :key="c" class="col">
              <div
                v-for="id in col" :key="id" :ref="setEl(id)" class="card" :title="byId.get(id)?.summary"
                @click="emit('open', id)" @mouseenter="hover = id" @mouseleave="hover = null"
              >
                <b v-marquee class="marquee"><span>{{ byId.get(id)?.title ?? id }}</span></b>
                <div v-marquee class="marquee small muted"><span>
                  {{ byId.get(id)?.rank ? `${byId.get(id)!.rank} 級・` : '' }}{{ byId.get(id)?.start.min_level ? `Lv.${byId.get(id)!.start.min_level}・` : '' }}{{ START_KINDS[byId.get(id)!.start.kind] }}・{{ byId.get(id)?.nodes.length }} 個任務點
                </span></div>
                <div v-if="byId.get(id)?.tags?.includes('adult')" class="small tag-line">🔞 成人向</div>
                <div v-if="counters(id).length" v-marquee class="marquee small counters"><span>🔢 {{ counters(id).join('、') }}</span></div>
                <div v-if="line.outside[id]?.length" v-marquee class="marquee small muted"><span>呼應：{{ line.outside[id]!.map((x) => byId.get(x)?.title ?? x).slice(0, 3).join('、') }}{{ line.outside[id]!.length > 3 ? ' 等' : '' }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview { display: grid; gap: 8px; }
.head-line { display: flex; gap: 8px; align-items: baseline; }
.head-line h3 { margin: 0; }
.split { display: grid; grid-template-columns: minmax(160px, 220px) 1fr; gap: 10px; align-items: start; }
@media (max-width: 720px) { .split { grid-template-columns: 1fr; } }
.lines { display: grid; gap: 6px; }
.lines ul { max-height: 60vh; overflow: auto; margin: 0; padding: 0; list-style: none; }
.lines li { display: flex; gap: 6px; padding: 3px 6px; border-radius: var(--radius); cursor: pointer; }
.lines li:hover, .lines li.active { background: var(--panel-2); }
.lines li.active { outline: 1px solid var(--accent); }
.lines .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 選到（focus）或正在看的那一條顯示完整的名字 */
.lines li:is(:focus, .active) .name { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
.lines li:focus-visible { outline: 2px solid var(--accent); }
.pane { display: grid; gap: 6px; min-width: 0; max-width: 100%; }
.graph-bar { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.check { display: inline-flex; gap: 4px; align-items: center; }
.legend { display: inline-flex; gap: 4px; align-items: center; color: var(--muted); }
.legend .ln { display: inline-block; width: 18px; border-top: 2px solid var(--accent); margin-left: 6px; }
.legend .ln.start { border-color: #6fbf73; }
.legend .ln.block { border-color: var(--danger); }
.legend .ln.echo { border-top-style: dashed; border-color: var(--muted); }
.scroll { overflow: auto; max-height: 70vh; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel-2); }
.graph { position: relative; display: flex; gap: 80px; padding: 16px 20px 40px; width: max-content; align-items: flex-start; }
.edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.edges path { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: 0.7; pointer-events: stroke; }
.edges .start path { stroke: #6fbf73; }
.edges .block path { stroke: var(--danger); }
.edges .echo path { stroke: var(--muted); stroke-dasharray: 5 4; }
.edges .lit path { stroke-width: 3; opacity: 1; }
.edges text { font-size: 10px; fill: var(--text, currentColor); paint-order: stroke; stroke: var(--panel); stroke-width: 3px; }
.col { display: flex; flex-direction: column; gap: 18px; position: relative; z-index: 1; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; max-width: 240px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; cursor: pointer; }
.card:hover { border-color: var(--accent); }
.tag-line { color: var(--danger); }
.counters { color: var(--accent); }
</style>
