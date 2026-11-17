<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, nextTick, ref, watch } from 'vue'
import { BESTIARY_LEVEL_NAME, bestiaryCount, bestiaryLevel, habitats, weaknesses, type BestiaryLevel } from '@/engine/bestiary'
import { abilityDef, enemies, isLayerBoss, monsterTraits, type EnemyDef } from '@/engine/data'
import { ENEMY_KINDS } from '@/engine/mods'
import { useGame } from '@/stores/game'
import ContentIcon from './icons/ContentIcon.vue'

// 怪物圖鑑（冒險筆記的一頁）：打過、打倒，或聽人說過的怪物會點亮；沒點亮的只顯示數量，不暴雷。
// 聽說：外觀、出沒的地方、弱點與抗性；遭遇：再加上等級、生命、技能、特徵；擊敗：再加上次數與掉落物。
// 版面：上面是進度與種類篩選，左邊是點亮的怪物格子，右邊（窄的時候在上面）是選中的那一隻
const game = useGame()
const s = computed(() => game.state!)
const book = computed(() => s.value.bestiary ?? {})
const query = ref('')
const only = ref<BestiaryLevel | ''>('')
const kind = ref<string>('')
type Sort = 'level' | 'name' | 'kills'
const sort = ref<Sort>('level')
const picked = ref<string | null>(null)
const count = computed(() => bestiaryCount(s.value))
const RANK: Record<BestiaryLevel, number> = { heard: 1, seen: 2, defeated: 3 }
const kindOf = (d: EnemyDef) => (d.kind && ENEMY_KINDS[d.kind] ? d.kind : 'other')
const levelOf = (id: string) => bestiaryLevel(book.value[id])

/** 各程度幾種（聽說、遭遇、擊敗） */
const byLevel = computed(() => {
  const n = { heard: 0, seen: 0, defeated: 0 }
  for (const id of Object.keys(book.value)) {
    const l = enemies[id] ? levelOf(id) : undefined
    if (l) n[l]++
  }
  return n
})
/** 種類：全部幾種、點亮幾種（一隻都沒點亮的不給選） */
const kinds = computed(() => [...Object.keys(ENEMY_KINDS), 'other'].map((k) => {
  const all = Object.values(enemies).filter((d) => kindOf(d) === k)
  return { id: k, name: ENEMY_KINDS[k] ?? '其他', total: all.length, lit: all.filter((d) => levelOf(d.id)).length }
}).filter((k) => k.total))
watch(kinds, (list) => { if (kind.value && !list.some((k) => k.id === kind.value && k.lit)) kind.value = '' })

interface Row { id: string; def: EnemyDef; level: BestiaryLevel; kills: number }
const rows = computed<Row[]>(() => {
  const q = query.value.trim()
  const out: Row[] = []
  for (const def of Object.values(enemies)) {
    const level = levelOf(def.id)
    if (!level) continue
    if (only.value && RANK[level] < RANK[only.value]) continue
    if (kind.value && kindOf(def) !== kind.value) continue
    if (q && !textHas(def.name, q)) continue
    out.push({ id: def.id, def, level, kills: book.value[def.id]?.defeated ?? 0 })
  }
  const by: Record<Sort, (a: Row, b: Row) => number> = {
    level: (a, b) => a.def.level - b.def.level || a.def.name.localeCompare(b.def.name),
    name: (a, b) => a.def.name.localeCompare(b.def.name),
    kills: (a, b) => b.kills - a.kills || a.def.level - b.def.level,
  }
  return out.sort(by[sort.value])
})
const current = computed(() => rows.value.find((r) => r.id === picked.value) ?? null)
// 窄畫面（手機）詳細資料在格子上方：點下面的怪時捲過去，不然看起來像沒反應
const detail = ref<HTMLElement | null>(null)
watch(picked, async (id) => {
  if (!id || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 640px)').matches) return
  await nextTick()
  detail.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})
watch(rows, (list) => { if (picked.value && !list.some((r) => r.id === picked.value)) picked.value = null })

const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 1000) / 10 : 0}%`
function heardText(id: string): string {
  const h = book.value[id]?.heard
  return h ? `第 ${h.day} 天${h.from ? `聽${h.from}說起` : '聽人說起'}` : ''
}
const seenText = (id: string) => (book.value[id]?.seen !== undefined ? `第 ${book.value[id]!.seen} 天第一次遇到` : '')
const traitNames = (def: EnemyDef) => (def.traits ?? []).map((t) => monsterTraits.traits[t]?.name ?? t)
const abilityNames = (def: EnemyDef) => (def.abilities ?? []).map((a) => abilityDef(a).name)
const loot = (def: EnemyDef) => [...new Set((def.loot ?? []).map((l) => l.item))]
const boss = (def: EnemyDef) => isLayerBoss(def.id)
</script>

<template>
  <div class="bestiary">
    <div class="summary">
      <div class="row">
        <b>點亮 {{ count.lit }} / {{ count.total }} 種</b>
        <span class="muted small">（{{ pct(count.lit, count.total) }}）</span>
        <span class="grow" />
        <span class="lvl heard small">聽說 {{ byLevel.heard }}</span>
        <span class="lvl seen small">遭遇 {{ byLevel.seen }}</span>
        <span class="lvl defeated small">擊敗 {{ byLevel.defeated }}</span>
      </div>
      <div class="meter" :aria-label="`點亮 ${count.lit} / ${count.total}`">
        <i class="defeated" :style="{ width: pct(byLevel.defeated, count.total) }" />
        <i class="seen" :style="{ width: pct(byLevel.seen, count.total) }" />
        <i class="heard" :style="{ width: pct(byLevel.heard, count.total) }" />
      </div>
    </div>

    <p v-if="!count.lit" class="muted small">還沒有點亮任何怪物。打過的怪物，或向人打聽到的怪物，會記在這裡。</p>
    <template v-else>
      <div class="row kinds">
        <button class="small" :class="{ active: !kind }" @click="kind = ''">全部 {{ count.lit }}</button>
        <button v-for="k in kinds" :key="k.id" class="small" :class="{ active: kind === k.id }" :disabled="!k.lit" :title="k.lit ? '' : `還沒遇過${k.name}`" @click="kind = k.id">
          {{ k.name }} <span class="muted">{{ k.lit }}/{{ k.total }}</span>
        </button>
      </div>
      <div class="row tools">
        <input id="bestiary-search" v-model="query" class="grow" placeholder="搜尋名字" aria-label="搜尋怪物名字" />
        <select id="bestiary-only" v-model="only" aria-label="點亮的程度">
          <option value="">全部點亮的</option>
          <option value="seen">遭遇過以上</option>
          <option value="defeated">擊敗過</option>
        </select>
        <select id="bestiary-sort" v-model="sort" aria-label="排序">
          <option value="level">依等級</option>
          <option value="name">依名字</option>
          <option value="kills">依擊敗次數</option>
        </select>
      </div>

      <div class="layout" :class="{ picked: !!current }">
        <ul class="plain grid">
          <li v-for="r in rows" :key="r.id">
            <button class="cell" :class="[r.level, { on: picked === r.id }]" :aria-pressed="picked === r.id" @click="picked = picked === r.id ? null : r.id">
              <ContentIcon kind="monster" :def="r.def" :size="28" />
              <span class="nm">{{ r.def.name }}</span>
              <span class="sub small">
                <template v-if="r.level !== 'heard'">Lv.{{ r.def.level }}</template><template v-else>？</template>
                <span class="dot" :class="r.level" :title="BESTIARY_LEVEL_NAME[r.level]" />
                <template v-if="r.kills">×{{ r.kills }}</template>
              </span>
            </button>
          </li>
          <li v-if="!rows.length" class="muted small empty">沒有符合的怪物。</li>
        </ul>

        <aside v-if="current" ref="detail" class="detail">
          <div class="dhead">
            <ContentIcon kind="monster" :def="current.def" :size="44" />
            <div class="grow">
              <b class="dname">{{ current.def.name }}</b>
              <div class="small muted">
                {{ ENEMY_KINDS[current.def.kind ?? ''] ?? '其他' }}<template v-if="current.level !== 'heard'">・Lv.{{ current.def.level }}</template>
                <span v-if="boss(current.def)" class="tag boss">層主</span>
              </div>
            </div>
            <span class="tag" :class="current.level">{{ BESTIARY_LEVEL_NAME[current.level] }}<template v-if="current.kills"> ×{{ current.kills }}</template></span>
            <button class="small ghost close" aria-label="收起" @click="picked = null">×</button>
          </div>
          <p v-if="current.def.desc" class="small desc">{{ current.def.desc }}</p>

          <div v-if="current.level !== 'heard'" class="stats">
            <div><span class="k">生命</span><b>{{ current.def.hp }}</b></div>
            <div><span class="k">行動點</span><b>{{ current.def.ap }}</b></div>
            <div><span class="k">閃避</span><b>{{ current.def.evade }}</b></div>
            <div><span class="k">減傷</span><b>{{ current.def.dr ?? 0 }}</b></div>
          </div>

          <dl class="facts small">
            <template v-if="weaknesses(current.def).weak.length">
              <dt>弱點</dt><dd><span v-for="w in weaknesses(current.def).weak" :key="w" class="chip weak">{{ w }}</span></dd>
            </template>
            <template v-if="weaknesses(current.def).resist.length">
              <dt>抗性</dt><dd><span v-for="w in weaknesses(current.def).resist" :key="w" class="chip resist">{{ w }}</span></dd>
            </template>
            <template v-if="habitats(current.id).length">
              <dt>出沒</dt><dd><span v-for="h in habitats(current.id)" :key="h" class="chip">{{ h }}</span></dd>
            </template>
            <template v-if="current.level !== 'heard' && abilityNames(current.def).length">
              <dt>技能</dt><dd><span v-for="a in abilityNames(current.def)" :key="a" class="chip">{{ a }}</span></dd>
            </template>
            <template v-if="current.level !== 'heard' && traitNames(current.def).length">
              <dt>特徵</dt><dd><span v-for="t in traitNames(current.def)" :key="t" class="chip">{{ t }}</span></dd>
            </template>
            <template v-if="current.level === 'defeated' && loot(current.def).length">
              <dt>掉落</dt><dd><span v-for="l in loot(current.def)" :key="l" class="chip loot">{{ l }}</span></dd>
            </template>
          </dl>
          <p v-if="current.level === 'heard'" class="small muted">實際打過之後，能看到等級、能力、技能與特徵；擊敗之後能看到掉落物。</p>
          <p v-else-if="current.level === 'seen'" class="small muted">擊敗之後能看到掉落物。</p>
          <p class="small muted">{{ [heardText(current.id), seenText(current.id)].filter(Boolean).join('；') }}</p>
        </aside>
      </div>
      <p class="small muted">沒點亮的怪物只算數量，不會顯示名字。</p>
    </template>
  </div>
</template>

<style scoped>
.bestiary { display: grid; gap: 8px; --seen: #4f7cab; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.grow { flex: 1 1 auto; min-width: 0; }
p { margin: 0; }
.summary { display: grid; gap: 4px; }
.meter { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, currentColor 10%, transparent); }
.meter i { display: block; height: 100%; }
.meter .defeated, .dot.defeated { background: var(--gold-hi); }
.meter .seen, .dot.seen { background: var(--seen); }
.meter .heard, .dot.heard { background: color-mix(in srgb, currentColor 35%, transparent); }
.lvl::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.lvl.defeated::before { background: var(--gold-hi); }
.lvl.seen::before { background: var(--seen); }
.lvl.heard::before { background: color-mix(in srgb, currentColor 35%, transparent); }
.kinds button.active { border-color: var(--accent); color: var(--accent); }
.tools input { flex: 1 1 8em; }
.layout { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); align-items: start; }
.layout.picked { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.grid li { border: none; padding: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin: 0; }
.cell { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; align-items: center; width: 100%; text-align: left; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: color-mix(in srgb, currentColor 3%, transparent); cursor: pointer; }
.cell > :first-child { grid-row: 1 / 3; }
.cell .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell .sub { display: flex; align-items: center; gap: 4px; color: var(--muted); font-variant-numeric: tabular-nums; }
.cell.heard .nm { color: var(--muted); }
.cell.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.empty { grid-column: 1 / -1; }
.detail { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; display: grid; gap: 8px; position: sticky; top: 0; }
.dhead { display: flex; gap: 10px; align-items: center; }
.dname { font-size: 1.1em; }
.close { padding: 0 6px; }
.desc { line-height: 1.6; }
.tag.seen { border-color: var(--seen); color: var(--seen); }
.tag.defeated { border-color: var(--gold-hi); color: var(--gold-hi); }
.tag.boss { margin-left: 6px; border-color: var(--danger); color: var(--danger); }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.stats div { border: 1px solid var(--border); border-radius: var(--radius); padding: 3px 6px; display: grid; text-align: center; }
.stats .k { font-size: var(--fs-xs); color: var(--muted); }
.stats b { font-variant-numeric: tabular-nums; }
.facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 8px; margin: 0; }
.facts dt { color: var(--accent); font-weight: 600; }
.facts dd { margin: 0; display: flex; flex-wrap: wrap; gap: 3px; }
.chip { border: 1px solid var(--border); border-radius: 9px; padding: 0 6px; }
.chip.weak { border-color: var(--good); color: var(--good); }
.chip.resist { border-color: var(--danger); color: var(--danger); }
.chip.loot { border-color: var(--gold-hi); }
@media (max-width: 640px) {
  .layout.picked { grid-template-columns: minmax(0, 1fr); }
  .detail { order: -1; position: static; }
}
</style>
