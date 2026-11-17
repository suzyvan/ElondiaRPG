<script setup lang="ts">
import { textHas } from '@/engine/script'
import { computed, ref, shallowRef, watch } from 'vue'
import { closure, contentKeys, splitKey, entryOf, usersOf, type RefGraph, type RefKey } from '@/engine/contentRefs'
import { defaultChoice, type ImportChoice, type ImportRow } from '@/engine/contentImport'
import type { ContentMods } from '@/engine/mods'
import { MOD_SECTION_NAMES, modLabel, useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import AppDialog from '../AppDialog.vue'

// 局部匯入（docs/plan/WORLD_EDITOR_PLAN.md E2）：從檔案或這個瀏覽器的另一個世界，挑幾項帶進目前的世界。
// 勾一項就連同它用到的東西（🔒，不能取消）；和這個世界不同的項目選「取代」「保留」或「另存一份」。
// 帶入前在沙盒裡檢查：有錯誤的特殊任務整包不帶入；整理時被改掉的地方列出來。
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const content = useContent()
const game = useGame()

const from = ref<'file' | string>('file')
const source = shallowRef<{ name: string; mods: ContentMods } | null>(null)
const graph = shallowRef<RefGraph | null>(null)
const picked = ref<Set<RefKey>>(new Set())
const choices = ref<Record<RefKey, ImportChoice>>({})
const search = ref('')
const onlyConflicts = ref(false)
const error = ref('')
const otherWorlds = computed(() => content.worlds.filter((w) => w.id !== content.active))

function load(src: { name: string; mods: ContentMods; picked: RefKey[] }) {
  source.value = src
  graph.value = content.analyzeSource(src.mods)
  picked.value = new Set(src.picked.filter((k) => graph.value!.refs.has(k)))
  choices.value = {}
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  try {
    error.value = ''
    load(content.importSource({ text: await f.text() }))
  } catch (err) {
    error.value = `讀不了這個檔案：${err instanceof Error ? err.message : String(err)}`
  }
}
watch(from, (v) => {
  source.value = null
  if (v !== 'file') {
    try {
      error.value = ''
      load(content.importSource({ world: v }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }
})

// ---- 清單 ----
const allKeys = computed(() => (source.value ? contentKeys(source.value.mods) : []))
const keys = computed(() => (graph.value ? closure(graph.value, picked.value) : new Set<RefKey>()))
const rows = computed<ImportRow[]>(() => (source.value ? content.compareImport(source.value.mods, allKeys.value) : []))
const rowOf = computed(() => new Map(rows.value.map((r) => [r.key, r])))
function label(key: RefKey): string {
  const [section, id] = splitKey(key)
  return modLabel(section, id, entryOf(source.value!.mods, key))
}
const groups = computed(() => {
  const q = search.value.trim()
  const out: { section: string; name: string; keys: RefKey[] }[] = []
  for (const key of allKeys.value) {
    const [section] = splitKey(key)
    const row = rowOf.value.get(key)
    if (onlyConflicts.value && row?.status !== 'conflict') continue
    if (q && !textHas(label(key), q) && !key.includes(q)) continue
    let g = out.find((x) => x.section === section)
    if (!g) out.push((g = { section, name: MOD_SECTION_NAMES[section as keyof typeof MOD_SECTION_NAMES], keys: [] }))
    g.keys.push(key)
  }
  return out
})
/** 被選的項目拉進來的（不是自己勾的）：鎖住，說明是誰用到 */
const pulledBy = (key: RefKey) => (picked.value.has(key) ? [] : usersOf(graph.value!, key).filter((k) => keys.value.has(k)))
function toggle(key: RefKey, on: boolean) {
  const next = new Set(picked.value)
  if (on) next.add(key)
  else next.delete(key)
  picked.value = next
}
const choiceOf = (k: RefKey): ImportChoice => choices.value[k] ?? defaultChoice(rowOf.value.get(k)!)
function setChoice(k: RefKey, c: ImportChoice) {
  choices.value = { ...choices.value, [k]: c }
}
const STATUS: Record<ImportRow['status'], string> = { new: '新增', same: '和這裡一樣', conflict: '和這裡不同' }
const conflicts = computed(() => [...keys.value].map((k) => rowOf.value.get(k)!).filter((r) => r?.status === 'conflict'))
/** 選的項目在來源世界還有誰用到（不會自動帶，可以一起帶） */
const users = computed(() => {
  if (!graph.value) return []
  const out = new Set<RefKey>()
  for (const k of picked.value) for (const u of usersOf(graph.value, k)) if (!keys.value.has(u)) out.add(u)
  return [...out]
})
const external = computed(() => {
  if (!graph.value) return []
  return [...new Set([...keys.value].flatMap((k) => graph.value!.external.get(k) ?? []))]
})

// ---- 預檢查與帶入 ----
const pkg = computed(() => (source.value && keys.value.size ? content.packageFor(source.value.mods, [...keys.value].map((k) => rowOf.value.get(k)!), choices.value) : null))
const writeCount = computed(() => (pkg.value ? contentKeys(pkg.value.mods as ContentMods).length : 0))
const check = shallowRef<{ changed: RefKey[]; errors: string[]; problems: string[] } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
watch(pkg, (p) => {
  check.value = null
  clearTimeout(timer)
  if (!p || !writeCount.value) return
  timer = setTimeout(() => {
    check.value = content.precheckImport(p)
  }, 300)
})
function bring() {
  if (!pkg.value || !check.value || check.value.errors.length) return
  if (check.value.changed.length && !confirm(`有 ${check.value.changed.length} 項整理時會被改掉一部分（見清單），仍要帶入嗎？`)) return
  try {
    const n = content.importPackage(pkg.value)
    game.flash(`已帶入 ${n} 項到「${content.activeName}」`)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <AppDialog :open="open" title="從檔案或其他世界帶入" icon="📥" width="860px" @close="emit('close')">
    <div class="picker">
      <div class="row small">
        來源
        <select v-model="from">
          <option value="file">內容檔或世界包…</option>
          <option v-for="w in otherWorlds" :key="w.id" :value="w.id">世界「{{ w.name }}」</option>
        </select>
        <label v-if="from === 'file'" class="file">選檔案<input type="file" accept=".json,application/json" @change="onFile" /></label>
        <span v-if="source" class="muted">「{{ source.name }}」共 {{ allKeys.length }} 項自訂內容</span>
      </div>
      <p class="small muted">勾的項目會連同它用到的東西一起帶進「{{ content.activeName }}」（🔒 是被用到的，不能取消）。只算自建與修改過的內容：沒修改的內建項目每個世界都有。</p>
      <p v-if="error" class="small warn-text">{{ error }}</p>

      <template v-if="source">
        <div class="row small">
          <input v-model="search" placeholder="搜尋名稱" class="grow" />
          <label class="check"><input v-model="onlyConflicts" type="checkbox" /> 只看和這裡不同的</label>
        </div>
        <div class="list">
          <p v-if="!groups.length" class="small muted">沒有符合的項目。</p>
          <section v-for="g in groups" :key="g.section">
            <h4>{{ g.name }}</h4>
            <div v-for="k in g.keys" :key="k" class="item small" :class="{ on: keys.has(k) }">
              <label class="check">
                <input type="checkbox" :checked="keys.has(k)" :disabled="keys.has(k) && !picked.has(k)" @change="toggle(k, ($event.target as HTMLInputElement).checked)" />
                <span v-if="keys.has(k) && !picked.has(k)" title="被選的項目用到，一定要一起帶">🔒</span>
                {{ label(k) }}
              </label>
              <span class="tag" :class="rowOf.get(k)?.status">{{ STATUS[rowOf.get(k)!.status] }}{{ rowOf.get(k)?.newerVersion ? '（新版本）' : '' }}</span>
              <span v-if="keys.has(k) && !picked.has(k)" class="muted by">被 {{ pulledBy(k).slice(0, 2).map(label).join('、') }}{{ pulledBy(k).length > 2 ? ' 等' : '' }} 用到</span>
              <span v-if="keys.has(k) && rowOf.get(k)?.status === 'conflict'" class="choice">
                <label><input type="radio" :name="`c-${k}`" :checked="choiceOf(k) === 'replace'" @change="setChoice(k, 'replace')" /> 用來源的取代</label>
                <label><input type="radio" :name="`c-${k}`" :checked="choiceOf(k) === 'keep'" @change="setChoice(k, 'keep')" /> 保留這裡的</label>
                <label v-if="rowOf.get(k)!.custom" title="改成新的 id（加上 8 碼指紋）另外存一份，這裡原本的不動"><input type="radio" :name="`c-${k}`" :checked="choiceOf(k) === 'copy'" @change="setChoice(k, 'copy')" /> 另存一份</label>
              </span>
            </div>
          </section>
        </div>

        <div class="summary small">
          <p>選了 {{ picked.size }} 項，連帶共 {{ keys.size }} 項；要寫進來的 {{ writeCount }} 項（和這裡一樣、或選了保留的不寫）。<template v-if="conflicts.length">和這裡不同的 {{ conflicts.length }} 項照上面的選擇。</template></p>
          <p v-if="users.length" class="muted">
            來源裡還有用到這些項目的：
            <button v-for="u in users.slice(0, 8)" :key="u" class="small" title="一起帶（連同它用到的東西）" @click="toggle(u, true)">＋ {{ label(u) }}</button>
            <template v-if="users.length > 8">等 {{ users.length }} 項</template>
          </p>
          <p v-if="external.length" class="muted">讀到但來源裡沒有人設定的旗標（由 AI、遊戲規則或這個世界的其他內容設定）：{{ external.map((f) => `🚩${f}`).join('、') }}</p>
          <p class="muted">不會帶入：固定 NPC 的形象圖、世界書條目。</p>
          <template v-if="writeCount">
            <p v-if="!check" class="muted">檢查中…</p>
            <template v-else>
              <p v-if="!check.errors.length && !check.changed.length && !check.problems.length">✅ 檢查通過。</p>
              <p v-for="e in check.errors" :key="e" class="warn-text">⛔ {{ e }}</p>
              <p v-if="check.changed.length" class="warn-text">⚠ 整理時會被改掉一部分（多半是引用的東西不在）：{{ check.changed.map(label).join('、') }}</p>
              <p v-for="p in check.problems" :key="p" class="warn-text">⚠ {{ p }}</p>
            </template>
          </template>
        </div>
      </template>

      <div class="row foot">
        <span class="spacer" />
        <button class="small" @click="emit('close')">取消</button>
        <button class="small primary" :disabled="!writeCount || !check || check.errors.length > 0" @click="bring">帶入 {{ writeCount }} 項</button>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
.picker { display: grid; gap: 8px; }
.picker p { margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.grow { flex: 1; min-width: 140px; }
.file { position: relative; cursor: pointer; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.list { max-height: 46vh; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 8px; }
.list h4 { margin: 6px 0 2px; color: var(--accent); }
.item { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; padding: 2px 4px; border-radius: var(--radius); }
.item.on { background: var(--panel-2); }
.check { display: inline-flex; gap: 4px; align-items: center; }
.tag.conflict { color: var(--danger); border-color: var(--danger); }
.by { font-size: 0.9em; }
.choice { display: inline-flex; flex-wrap: wrap; gap: 8px; }
.summary { display: grid; gap: 4px; }
.warn-text { color: var(--danger); }
.spacer { flex: 1; }
.foot { border-top: 1px solid var(--border); padding-top: 6px; }
</style>
