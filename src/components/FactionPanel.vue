<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, ref, watch } from 'vue'
import { factionBoard, type FactionEntry } from '@/engine/factionBoard'
import { securityRules } from '@/engine/security'
import { formatMoney } from '@/engine/money'
import { useGame } from '@/stores/game'
import Hint from './ui/Hint.vue'

// 冒險筆記的「勢力」分頁（engine/factionBoard.ts；docs/NPC_SYSTEM.md 第 9 節）：
// 每個勢力的聲望、聲望對價格與罰金的影響、城鎮的警戒與通緝、要聲望才能進的地方
const game = useGame()
const s = computed(() => game.state!)
const KEY = 'elondia.factionView'
const readView = (): 'met' | 'all' => {
  try {
    return localStorage.getItem(KEY) === 'all' ? 'all' : 'met'
  } catch {
    return 'met'
  }
}
const view = ref<'met' | 'all'>(readView())
watch(view, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // 記不住也沒關係
  }
})
const query = ref('')
const all = computed(() => {
  void s.value.time.minute
  void s.value.reputation
  return factionBoard(s.value)
})
const met = computed(() => all.value.filter((f) => f.met))
const unmet = computed(() => all.value.filter((f) => !f.met))
const matches = (f: FactionEntry) => {
  const q = query.value.trim()
  return !q || textHas(f.name, q) || f.towns.some((t) => textHas(t.name, q))
}
const shown = computed(() => met.value.filter(matches))
const shownUnmet = computed(() => (view.value === 'all' ? unmet.value.filter(matches) : []))
const wantedN = computed(() => all.value.filter((f) => f.wanted).length)
const alertTowns = computed(() => all.value.reduce((n, f) => n + f.towns.filter((t) => t.alert > 0).length, 0))
const hereFaction = computed(() => all.value.find((f) => f.here))
const alertMax = securityRules.alert.max

// 聲望尺：-15～+25，照聲望的區間上色
const MIN = -15
const MAX = 25
const TICKS = [-10, -5, 0, 5, 10, 20]
const pos = (v: number) => `${((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * 100}%`
const BANDS = computed(() => {
  const b = [...securityRules.reputation_bands].sort((x, y) => x.min - y.min)
  return b.map((band, i) => {
    const from = Math.max(MIN, i === 0 ? MIN : band.min)
    const to = Math.min(MAX, b[i + 1]?.min ?? MAX)
    const tone = band.buy < 0 ? (band.buy <= -0.1 ? 'good' : 'good-soft') : band.buy > 0 ? (band.buy >= 0.3 ? 'bad' : 'warn') : 'mid'
    return { width: `${(Math.max(0, to - from) / (MAX - MIN)) * 100}%`, tone }
  })
})
const pct = (x: number) => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`
function effect(f: FactionEntry): { text: string; tone: string } {
  const b = f.band
  if (!b.buy && !b.sell) return { text: '價格照常', tone: '' }
  return { text: `買入 ${pct(b.buy)}、賣出 ${pct(b.sell)}、罰金 ×${b.fine}`, tone: b.buy < 0 ? 'good' : 'bad' }
}
const bandHint = computed(() => [...securityRules.reputation_bands].map((b, i, arr) => {
  const range = i === 0 ? `${b.min} 以上` : i === arr.length - 1 ? `${arr[i - 1]!.min - 1} 以下` : `${b.min}～${arr[i - 1]!.min - 1}`
  return `聲望 ${range}：${!b.buy && !b.sell ? '價格照常' : `買入 ${pct(b.buy)}、賣出 ${pct(b.sell)}`}、罰金 ×${b.fine}`
}).join('\n'))
</script>

<template>
  <div class="factions">
    <div class="row filters">
      <button class="small" :class="{ active: view === 'met' }" @click="view = 'met'">接觸過的 {{ met.length }}</button>
      <button class="small" :class="{ active: view === 'all' }" @click="view = 'all'">全部 {{ all.length }}</button>
      <input v-model="query" class="grow" placeholder="搜尋勢力或城鎮" aria-label="搜尋勢力或城鎮" />
    </div>
    <p class="small muted">
      <template v-if="wantedN">被 <b class="bad">{{ wantedN }}</b> 個勢力通緝・</template>
      <template v-if="alertTowns"><b class="warn">{{ alertTowns }}</b> 座城的衛兵在警戒・</template>
      {{ hereFaction ? `目前在${hereFaction.name}的地盤` : '目前所在的地方沒有所屬的勢力' }}
      <Hint :text="`聲望對這個勢力的城裡買賣價格與罰金的影響：\n${bandHint}\n完成委託、特殊任務、事件會加聲望；在城裡犯法被看到會扣聲望、提高衛兵警戒，警戒滿 ${alertMax} 就被通緝。`" />
    </p>

    <p v-if="!shown.length && !shownUnmet.length" class="muted small">{{ query.trim() ? '沒有符合的勢力。' : '還沒接觸過任何勢力。' }}</p>
    <article v-for="f in shown" :key="f.id" class="card" :class="{ alarm: f.wanted }">
      <div class="head">
        <b class="name">{{ f.name }}</b>
        <span v-if="f.here" class="tag here">你在這裡</span>
        <span v-if="f.wanted" class="tag bad">通緝中</span>
        <span v-else-if="f.towns.some((t) => t.alert > 0)" class="tag warn">有城在警戒</span>
        <span v-if="f.capital" class="tag">首都 {{ f.capital }}</span>
        <span class="rep" :class="{ pos: f.rep > 0, neg: f.rep < 0 }">{{ f.rep > 0 ? '+' : '' }}{{ f.rep }}</span>
      </div>
      <div class="scale" :aria-label="`聲望 ${f.rep}`">
        <div class="bands"><i v-for="(b, i) in BANDS" :key="i" :class="b.tone" :style="{ width: b.width }" /></div>
        <span class="mark" :style="{ left: pos(f.rep) }" />
      </div>
      <div class="ticks small muted" aria-hidden="true"><span v-for="t in TICKS" :key="t" :style="{ left: pos(t) }">{{ t < 0 ? `−${-t}` : t }}</span></div>
      <div v-if="f.towns.length" class="small">在這個勢力的城裡：<span :class="effect(f).tone">{{ effect(f).text }}</span></div>
      <div v-if="f.wanted" class="small bad">你被通緝：城門不能檢定，進城要先在城門繳罰金（約 {{ formatMoney(f.fine ?? 0) }}）；也不能進貴族區與王城。</div>
      <div v-if="f.id === 'guild'" class="small muted">完成委託會加，放棄或逾期會扣；在沒有所屬勢力的地方犯法也算在這裡。</div>
      <div v-if="f.towns.length">
        <div class="lbl">城鎮</div>
        <div class="towns small">
          <span v-for="t in f.towns" :key="t.id" class="town" :class="{ unseen: !t.visited }">
            {{ t.name }}<template v-if="t.capital">（首都）</template>
            <b v-if="f.wanted" class="bad">通緝</b>
            <b v-else-if="t.alert" class="warn">警戒 {{ t.alert }}/{{ alertMax }}</b>
            <template v-if="!t.visited">・沒去過</template>
          </span>
        </div>
      </div>
      <div v-if="f.unlocks.length">
        <div class="lbl">要聲望的地方</div>
        <ul class="unlocks small">
          <li v-for="u in f.unlocks" :key="u.name" :class="{ no: !u.ok }"><span class="mk">{{ u.ok ? '✓' : '○' }}</span>{{ u.name }}（聲望 {{ u.need }}<template v-if="!u.ok">，還差 {{ u.need - f.rep }}</template>）</li>
        </ul>
      </div>
    </article>
    <div v-if="shownUnmet.length">
      <div class="lbl">還沒接觸過的勢力（聲望 0）</div>
      <div class="towns small">
        <span v-for="f in shownUnmet" :key="f.id" class="town unseen">{{ f.name }}<template v-if="f.capital">・首都 {{ f.capital }}</template></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.factions { display: grid; gap: 10px; }
.filters { gap: 6px; flex-wrap: wrap; }
.filters .grow { flex: 1 1 10em; min-width: 0; }
.filters button.active { border-color: var(--accent); color: var(--accent); }
p { margin: 0; }
.card { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; display: grid; gap: 6px; }
.card.alarm { border-color: var(--danger); }
.head { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
.name { font-size: 1.05em; }
.tag { font-size: var(--fs-xs); border: 1px solid var(--border); border-radius: 9px; padding: 0 6px; color: var(--muted); }
.tag.here { border-color: var(--accent); color: var(--accent); }
.tag.bad { border-color: var(--danger); color: var(--danger); }
.tag.warn { border-color: #b7862a; color: #b7862a; }
.rep { margin-left: auto; font-weight: 700; font-size: 1.15em; font-variant-numeric: tabular-nums; }
.rep.pos, .good { color: var(--good); }
.rep.neg, .bad { color: var(--danger); }
.warn { color: #b7862a; }
.scale { position: relative; height: 18px; }
.bands { position: absolute; left: 0; right: 0; top: 6px; height: 6px; display: flex; border-radius: 3px; overflow: hidden; }
.bands i { display: block; height: 100%; }
.bands .bad { background: var(--danger); }
.bands .warn { background: #b7862a; }
.bands .mid { background: color-mix(in srgb, currentColor 18%, transparent); }
.bands .good-soft { background: color-mix(in srgb, var(--good) 55%, transparent); }
.bands .good { background: var(--good); }
.mark { position: absolute; top: 1px; width: 3px; height: 16px; background: currentColor; transform: translateX(-1px); border-radius: 1px; }
.ticks { position: relative; height: 1.3em; font-variant-numeric: tabular-nums; margin-top: -4px; }
.ticks span { position: absolute; transform: translateX(-50%); }
.lbl { font-size: var(--fs-xs); color: var(--muted); letter-spacing: .05em; margin-bottom: 2px; }
.towns { display: flex; flex-wrap: wrap; gap: 4px; }
.town { border: 1px solid var(--border); border-radius: 4px; padding: 0 6px; }
.town.unseen { color: var(--muted); border-style: dashed; }
.town b { margin-left: 4px; }
.unlocks { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
.unlocks li { display: flex; gap: 6px; border: none; padding: 0; }
.unlocks .mk { width: 1.2em; flex: none; }
.unlocks .no { color: var(--muted); }
</style>
