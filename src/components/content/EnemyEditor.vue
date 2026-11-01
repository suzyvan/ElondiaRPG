<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { abilities, ATTR_IDS, attrName, damageTypeName, damageTypes, enemies, itemRules, monsterTraits, type AttrId } from '@/engine/data'
import {
  builtinEnemy, builtinPlacementsOf, ENEMY_KINDS, formatDice, parseDice, placementsOf, tableOptions, type DiceParts, type EnemyMod, type Placement,
} from '@/engine/mods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import AffinityRows from './AffinityRows.vue'
import UsageNote from './UsageNote.vue'
import IconField from './IconField.vue'
import { MONSTER_BAND_COLOR, MONSTER_BAND_LEVELS, monsterArtPath, monsterBand } from '../icons/monsterArt'
import type { DrawSource } from '../items/itemIcon'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import FoldSet from './FoldSet.vue'
import HelpText from './HelpText.vue'

// 怪物的編輯表單：存檔前是草稿，按「儲存」才套用
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ deleted: [] }>()
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
function current(): EnemyMod {
  return clone(content.mods.enemies[props.id] ?? (enemies[props.id] as EnemyMod))
}
const draft = ref<EnemyMod>(current())
const saved = ref(JSON.stringify(draft.value))
watch(() => props.id, () => {
  draft.value = current()
  saved.value = JSON.stringify(draft.value)
})
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
// 沒有上傳時的內建圖（依草稿的種類與等級）
const iconFallback = computed<DrawSource>(() => {
  const band = monsterBand(draft.value.level)
  return { kind: 'path', path: monsterArtPath(draft.value.kind, band), color: MONSTER_BAND_COLOR[band] }
})
// 發情：不會、在哪裡都可能、只在近郊・旅途・地下城
const rutMode = computed<'' | 'any' | 'field'>({
  get: () => (draft.value.rut === 'field' ? 'field' : draft.value.rut ? 'any' : ''),
  set: (v) => {
    if (v === 'field') draft.value.rut = 'field'
    else if (v === 'any') draft.value.rut = true
    else delete draft.value.rut
  },
})
// 魔物娘的名字與外觀：兩欄都寫了才算（儲存時其中一欄空白就拿掉）
function setGirl(k: 'name' | 'desc', v: string) {
  const g = { name: draft.value.girl?.name ?? '', desc: draft.value.girl?.desc ?? '', [k]: v }
  if (!g.name && !g.desc) delete draft.value.girl
  else draft.value.girl = g
}
const builtin = computed(() => !!builtinEnemy(props.id))
const edited = computed(() => builtin.value && !!content.mods.enemies[props.id])

// ---- 選項 ----
const damageIds = damageTypes.types.map((t) => t.id)
const monsterAbilities = computed(() => Object.values(abilities).filter((a) => a.classes.includes('monster')))
const otherAbilities = computed(() => Object.values(abilities).filter((a) => !a.classes.includes('monster') && a.type !== 'spell'))
const itemNames = computed(() => {
  void content.version
  return itemRules.items.map((i) => i.name)
})
const tables = tableOptions()
// 層主的護衛（預設沒有：層主單獨出場，平衡也是這樣算的）
const guardOptions = computed(() => Object.values(enemies).filter((e) => e.id !== props.id).sort((a, b) => a.level - b.level))
function setGuard(s: Placement, id: string) {
  if (id) s.guards = [[id, s.guards?.[0]?.[1] ?? 1]]
  else delete s.guards
}
const builtinPlaces = computed(() => builtinPlacementsOf(props.id))
const nowPlaces = computed(() => {
  void content.version
  return placementsOf(props.id)
})

const pickAbility = ref('')
function addAbility() {
  if (!pickAbility.value) return
  const list = (draft.value.abilities ??= [])
  if (!list.includes(pickAbility.value)) list.push(pickAbility.value)
  pickAbility.value = ''
}
function removeAbility(id: string) {
  draft.value.abilities = (draft.value.abilities ?? []).filter((a) => a !== id)
  setGate(id, '')
}
/** 生命低於 X% 才能用：空白 = 隨時能用 */
function setGate(id: string, v: string) {
  const gates = { ...(draft.value.ability_hp_below ?? {}) }
  const n = Math.round(Number(v))
  if (v !== '' && Number.isFinite(n)) gates[id] = Math.max(1, Math.min(99, n))
  else delete gates[id]
  if (Object.keys(gates).length) draft.value.ability_hp_below = gates
  else delete draft.value.ability_hp_below
}

function addLoot() {
  ;(draft.value.loot ??= []).push({ item: '', chance: 0.5 })
}
function percent(v: number | undefined) {
  return Math.round((v ?? 0) * 100)
}

function toggleExclude(key: string, on: boolean) {
  const set = new Set(draft.value.exclude ?? [])
  if (on) set.add(key)
  else set.delete(key)
  draft.value.exclude = [...set]
}
function addSpawn() {
  ;(draft.value.spawns ??= []).push({ table: tables[0]!.key, count: 1 } as Placement)
}

const money = computed({
  get: () => draft.value.money_cc ?? [0, 0],
  set: (v: [number, number]) => { draft.value.money_cc = v },
})

function toggleTrait(t: string, on: boolean) {
  const set = new Set(draft.value.traits ?? [])
  if (on) set.add(t)
  else set.delete(t)
  draft.value.traits = [...set]
}

// 攻擊骰：只能是 {x}d{y}+{z}
const dice = computed(() => parseDice(draft.value.weapon.dice))
function setDice(k: keyof DiceParts, e: Event) {
  draft.value.weapon.dice = formatDice({ ...dice.value, [k]: Number((e.target as HTMLInputElement).value) })
}

// ---- 動作 ----
function save() {
  try {
    content.saveEnemy(props.id, draft.value)
    draft.value = current()
    saved.value = JSON.stringify(draft.value)
    game.flash(`已儲存「${draft.value.name}」`)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function discard() {
  draft.value = current()
}
function restore() {
  if (!confirm(`把「${draft.value.name}」恢復成內建的樣子？`)) return
  content.restoreEnemy(props.id)
  draft.value = current()
  saved.value = JSON.stringify(draft.value)
}
// 還有地方用到時不能刪（見 docs/CONTENT_DEPENDENCIES.md）
const usage = computed(() => {
  void content.version
  void game.state?.time.minute
  return content.usageOf('enemy', props.id)
})
function remove() {
  if (!confirm(`刪除「${draft.value.name}」？已經在地圖上的這種怪物會消失。`)) return
  try {
    content.deleteEnemy(props.id)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
    return
  }
  emit('deleted')
}
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="draft.name || '（未命名）'" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty" :usage="usage"
      @save="save" @discard="discard" @restore="restore" @remove="remove"
    />
    <UsageNote :usage="usage" :deletable="!builtin" />
    <p class="small muted">id：{{ id }}</p>

    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>名稱 <input v-model="draft.name" maxlength="20" /></label>
        <label>等級 <input v-model.number="draft.level" type="number" min="1" max="30" /></label>
        <label>種類
          <select v-model="draft.kind">
            <option v-for="(n, k) in ENEMY_KINDS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label>生命 <input v-model.number="draft.hp" type="number" min="1" /></label>
        <label>行動點 <input v-model.number="draft.ap" type="number" min="1" max="12" /></label>
        <label>迴避修正 <input v-model.number="draft.evade" type="number" /></label>
        <label>物理減傷 <input v-model.number="draft.dr" type="number" min="0" /></label>
        <label>經驗值 <input v-model.number="draft.xp" type="number" min="0" /></label>
        <label>金錢（最少～最多）
          <span class="pair"><input v-model.number="money[0]" type="number" min="0" /> ～ <input v-model.number="money[1]" type="number" min="0" /></span>
        </label>
      </div>
      <div class="block icon-row">
        <span>圖示</span>
        <IconField v-model="draft.icon" :fallback="iconFallback" :hint="`只給這隻怪物用（不能設定到整個種類）。沒有上傳時依種類與等級用內建的圖：每 ${MONSTER_BAND_LEVELS} 級一個區間，顏色越後面越紅。上傳的圖會縮到 48×48 以內，存在這個世界裡。`" />
      </div>
      <div class="row checks">
        <label class="check"><input v-model="draft.armed" type="checkbox" /> 持有裝備 <Hint text="打倒時可能掉裝備。" /></label>
        <label>發情 <Hint text="開戰時可能擲到「發情」特徵：比較想用慾望攻擊，戰敗後可能起意（戰敗事件）。「只在野外」是只在近郊、旅途與地下城的遭遇擲；特殊任務的戰鬥要那個任務點勾選才擲，淫鬥場不擲。會發情的怪物最好寫好魔物娘的樣子。" />
          <select v-model="rutMode">
            <option value="">不會</option>
            <option value="any">在哪裡都可能</option>
            <option value="field">只在野外（近郊、旅途、地下城）</option>
          </select>
        </label>
      </div>
      <label class="block"><span>描述 <Hint text="給 AI 的外觀與習性。戰鬥與戰敗事件的敘事會附上。" /></span><textarea v-model="draft.desc" rows="2" maxlength="200" /></label>
      <div class="grid">
        <label>魔物娘的名字 <Hint text="設定「魔物娘」打開時，交給 AI 的稱呼（例如「狼娘」）。畫面上的名字不變。名字和外觀都寫了才算；都不寫就沒有魔物娘形態，照原本的樣子。" />
          <input :value="draft.girl?.name ?? ''" maxlength="20" @input="setGirl('name', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
      <label class="block"><span>魔物娘的外觀 <Hint text="成年女性的身體，保留原本種族的特徵（耳朵、尾巴、鱗片、觸手……）與習性。不要寫成未成年的樣子。" /></span>
        <textarea :value="draft.girl?.desc ?? ''" rows="2" maxlength="300" @input="setGirl('desc', ($event.target as HTMLTextAreaElement).value)" />
      </label>
    </FoldSet>

    <FoldSet>
      <template #legend>屬性與普通攻擊</template>
      <div class="grid">
        <label v-for="a in ATTR_IDS" :key="a">{{ attrName(a) }} <input v-model.number="draft.attrs[a]" type="number" min="1" max="30" /></label>
      </div>
      <div class="grid">
        <label class="dice-field">攻擊骰（{x}d{y}+{z}）
          <span class="pair dice">
            <input type="number" min="1" max="20" :value="dice.count" title="骰子數量 x" @change="setDice('count', $event)" />d
            <input type="number" min="2" max="100" :value="dice.sides" title="骰子面數 y" @change="setDice('sides', $event)" />+
            <input type="number" min="0" max="99" :value="dice.bonus" title="固定加值 z" @change="setDice('bonus', $event)" />
          </span>
        </label>
        <label>傷害類型
          <select v-model="draft.weapon.type">
            <option v-for="t in damageIds" :key="t" :value="t">{{ damageTypeName(t) }}</option>
          </select>
        </label>
        <label>攻擊屬性
          <select v-model="draft.weapon.attr">
            <option v-for="a in ATTR_IDS" :key="a" :value="a as AttrId">{{ attrName(a) }}</option>
          </select>
        </label>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>抗性與攻擊加成</template>
      <HelpText text="受到的傷害倍率：-1 免疫、-0.5 減半、+0.5 弱點（×1.5）。攻擊加成是造成傷害的倍率加減。" />
      <AffinityRows v-model="draft.resist" label="抗性" />
      <AffinityRows v-model="draft.offense" label="攻擊加成" :max="7" />
    </FoldSet>

    <FoldSet>
      <template #legend>技能</template>
      <div class="chips">
        <span v-for="a in draft.abilities ?? []" :key="a" class="tag chip" :title="abilities[a]?.desc">
          {{ abilities[a]?.name ?? a }}
          <label class="small gate" title="生命降到這個百分比以下才能用；空白是隨時能用">
            生命 ≤
            <input
              type="number" min="1" max="99" placeholder="—" :value="draft.ability_hp_below?.[a] ?? ''"
              @change="setGate(a, ($event.target as HTMLInputElement).value)"
            />%
          </label>
          <button class="x" @click="removeAbility(a)" title="移除">✕</button>
        </span>
        <span v-if="!draft.abilities?.length" class="small muted">（只用普通攻擊）</span>
      </div>
      <div class="row">
        <select v-model="pickAbility">
          <option value="">選擇技能…</option>
          <optgroup label="怪物技能">
            <option v-for="a in monsterAbilities" :key="a.id" :value="a.id">{{ a.name }}：{{ a.desc.slice(0, 40) }}</option>
          </optgroup>
          <optgroup label="職業技能與戲法">
            <option v-for="a in otherAbilities" :key="a.id" :value="a.id">{{ a.name }}：{{ a.desc.slice(0, 40) }}</option>
          </optgroup>
        </select>
        <button class="small" :disabled="!pickAbility" @click="addAbility">＋ 加入</button>
      </div>
      <HelpText text="怪物沒有法術環，所以不能用法術。「生命 ≤ X%」填了的技能要等生命降到那裡才能用（狂暴、垂死反撲），解開後 AI 會比較想用；空白是隨時能用。" />
      <div class="row checks">
        <span class="small">固定特徵：</span>
        <label v-for="(t, id) in monsterTraits.traits" :key="id" class="check small" :title="t.desc">
          <input type="checkbox" :checked="draft.traits?.includes(String(id))" @change="toggleTrait(String(id), ($event.target as HTMLInputElement).checked)" /> {{ t.name }}
        </label>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>掉落物</template>
      <div v-for="(l, i) in draft.loot ?? []" :key="i" class="row">
        <input v-model="l.item" list="cv-item-names" placeholder="物品名稱" class="grow" />
        <label class="small">機率 <input class="num" type="number" min="1" max="100" :value="percent(l.chance)" @input="l.chance = Number(($event.target as HTMLInputElement).value) / 100" />%</label>
        <label class="small">數量 <input v-model.number="l.qty" class="num" type="number" min="1" placeholder="1" /></label>
        <button class="small" @click="draft.loot!.splice(i, 1)" title="移除">✕</button>
        <span v-if="l.item && !itemNames.includes(l.item)" class="small warn-text">目錄裡沒有這個物品</span>
      </div>
      <button class="small" @click="addLoot">＋ 掉落物</button>
    </FoldSet>

    <FoldSet :filled="nowPlaces.length > 0">
      <template #legend>出現地點</template>
      <p class="small">目前出現在：{{ nowPlaces.map((p) => `${p.label}${p.groups > 1 ? `（${p.groups} 組）` : ''}`).join('、') || '（沒有，不會遇到）' }}</p>
      <template v-if="builtinPlaces.length">
        <p class="small muted">內建的遭遇表 <Hint text="勾選就從那裡移除；遭遇表不會被清空。" />：</p>
        <div class="row checks">
          <label v-for="p in builtinPlaces" :key="p.key" class="check small">
            <input type="checkbox" :checked="draft.exclude?.includes(p.key)" @change="toggleExclude(p.key, ($event.target as HTMLInputElement).checked)" /> 移除 {{ p.label }}
          </label>
        </div>
      </template>
      <HelpText text="另外加入：每一組是遭遇表裡的一個選項（遭遇時從所有選項平均抽一個），權重是放幾組。層主會取代原本的層主（包括原本的護衛）；要護衛時另外選。" />
      <div v-for="(s, i) in draft.spawns ?? []" :key="i" class="row">
        <select v-model="s.table" class="grow">
          <option v-for="t in tables" :key="t.key" :value="t.key">{{ t.label }}</option>
        </select>
        <label class="small">一組 <input v-model.number="s.count" class="num" type="number" min="1" max="6" /> 隻</label>
        <label v-if="!s.table.startsWith('boss:')" class="small">權重 <input v-model.number="s.weight" class="num" type="number" min="1" max="5" placeholder="1" /></label>
        <template v-else>
          <label class="small">護衛
            <select :value="s.guards?.[0]?.[0] ?? ''" @change="setGuard(s, ($event.target as HTMLSelectElement).value)">
              <option value="">（沒有）</option>
              <option v-for="e in guardOptions" :key="e.id" :value="e.id">{{ e.name }}（{{ e.level }} 級）</option>
            </select>
          </label>
          <label v-if="s.guards?.length" class="small"><input v-model.number="s.guards[0]![1]" class="num" type="number" min="1" max="4" /> 隻</label>
        </template>
        <button class="small" @click="draft.spawns!.splice(i, 1)" title="移除">✕</button>
      </div>
      <button class="small" @click="addSpawn">＋ 出現地點</button>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
