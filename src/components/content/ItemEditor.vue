<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ATTR_IDS, attrName, companionRules, damageTypeName, damageTypes, enemies, geography, itemDef, itemRules, statuses, stories,
  type AttrId, type ItemIntel, type ItemUse, type ToolKind,
} from '@/engine/data'
import { gearPrice, gearRules, gearSummary, rarityName, RARITY_ORDER } from '@/engine/gear'
import { actionRules, DUNGEON_LAYER_NAME, lewdRules, LOCK_GRADES, npcTags, perkRules, slaveryRules, tagDef, type LockGrade } from '@/engine/data'
import { LEWD_STATS, lewdName } from '@/engine/lewd'
import type { LewdStat } from '@/engine/types'
import { intelSummary, useSummary } from '@/engine/inventory'
import { dungeonTemplates, parasitesFrom } from '@/engine/dungeonEvents'
import { CHEST_LAYERS, itemSources, sanitizeGearSpecLoose, type ChestLayer, type GatherPlace, type ItemMod, SYSTEM_CONDITIONS } from '@/engine/mods'
import { formatMoney } from '@/engine/money'
import { inferTradeCategory, marketRules, tradeCategoryName } from '@/engine/market'
import { inferMaterialTier, maxMaterialTier } from '@/engine/materialInfo'
import { TOOL_KINDS, toolSummary } from '@/engine/tools'
import { choosablePerks, CRAFT_IDS, craftRules, FURNITURE_FUNCTIONS, homeRules, type FurnitureFunction, type FurniturePlace } from '@/engine/data'
import { PLACE_NAME } from '@/engine/homes'
import { CONTENT_TAGS, FILTER_TAGS } from '@/engine/content'
import { categoryIconSource, gearIconSource, type IconSource } from '@/engine/itemIcons'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import AffinityRows from './AffinityRows.vue'
import IconField from './IconField.vue'
import ContentIcon from '../icons/ContentIcon.vue'
import UsageNote from './UsageNote.vue'
import SourceNote from './SourceNote.vue'
import Hint from '../ui/Hint.vue'
import EditorHeader from './EditorHeader.vue'
import FoldSet from './FoldSet.vue'
import HelpText from './HelpText.vue'

// 物品的編輯表單：基本資料、出現的地方（商店、掉落、寶箱、採集、事件）、消耗品效果、裝備組成
const props = defineProps<{ name: string }>()
const emit = defineEmits<{ renamed: [name: string]; deleted: [] }>()
const content = useContent()
const game = useGame()

interface Drop { enemy: string; chance: number; qty: number }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function current(): { item: ItemMod; drops: Drop[] } {
  const base = content.mods.items[props.name] ?? (itemDef(props.name) as ItemMod)
  const item = clone(base)
  const src = itemSources(props.name)
  item.chests ??= src.chests
  item.gather ??= src.gather
  item.use ??= {}
  // 打開時就補上預設的情報內容，才不會一打開就顯示「未儲存」
  if (item.category === 'info') item.intel ??= { kind: 'point' }
  return { item, drops: src.drops }
}
const init = current()
const draft = ref<ItemMod>(init.item)
const drops = ref<Drop[]>(init.drops)
const newName = ref(props.name)
const snapshotText = () => JSON.stringify([draft.value, drops.value, newName.value])
const saved = ref(snapshotText())
function reset() {
  const c = current()
  draft.value = c.item
  drops.value = c.drops
  newName.value = props.name
  saved.value = snapshotText()
}
watch(() => props.name, reset)

const dirty = computed(() => snapshotText() !== saved.value)
const custom = computed(() => !!content.mods.items[props.name]?.custom)
const edited = computed(() => !custom.value && !!content.mods.items[props.name])

// ---- 選項 ----
const CATS = itemRules.categories
// 貿易類別（城鎮標籤的價格倍率看這個，docs/TRADE.md 3.1 節）：沒填時照其他欄位推
const inferredTrade = computed(() => tradeCategoryName(inferTradeCategory({ ...draft.value, name: newName.value })))
// 材料等級沒填時照用途推（用目前套用中的內容推：剛改的配方、掉落要存檔之後才算進去）
const inferredTier = computed(() => {
  const t = inferMaterialTier(custom.value ? newName.value : props.name)
  return t ? `第 ${t.tier} 級` : '推不出來，不顯示'
})
const damageIds = damageTypes.types.map((t) => t.id)
const statusList = Object.entries(statuses).map(([id, s]) => ({ id, ...s }))
const debuffs = statusList.filter((s) => s.kind === 'debuff')
const buffs = statusList.filter((s) => s.kind === 'buff')
const enemyList = computed(() => {
  void content.version
  return Object.values(enemies).sort((a, b) => a.level - b.level)
})
const LAYER: Record<ChestLayer, string> = DUNGEON_LAYER_NAME
const SHOPS: Record<string, string> = { general: '雜貨店', temple: '神殿', tavern: '酒館', smith: '鐵匠鋪', tailor: '裁縫店', jeweler: '珠寶店', magic: '魔法物品店', info: '情報商' }
const LOCS: Record<string, string> = { village: '任何聚落', town: '城鎮以上', city: '城市以上', capital: '王都' }
const bases = computed(() => {
  void content.version
  return Object.entries(gearRules.bases)
})
/** 沒有上傳圖時用的：裝備用底材的圖，打造材料用第一個材料的圖，其他用類別的圖 */
const iconFallback = computed<IconSource>(() => {
  void content.version
  const base = draft.value.category === 'equipment' ? draft.value.gear?.base : undefined
  if (base && gearRules.bases[base]) return gearIconSource({ base })
  const forge = draft.value.category === 'material' ? draft.value.forge?.materials.find((m) => !!gearRules.materials[m]) : undefined
  return forge ? { kind: 'material', material: forge } : categoryIconSource(draft.value.category)
})
const materials = computed(() => {
  void content.version
  const kind = draft.value.gear ? gearRules.bases[draft.value.gear.base]?.kind : undefined
  return Object.entries(gearRules.materials).filter(([, m]) => m.kind === kind)
})

// ---- 欄位 ----
const use = computed(() => (draft.value.use ??= {}) as ItemUse)
// 冥想道具：慾望指標的增減（docs/LEWD_STATS.md 第 4.1 節）
const LEWD_USE_KEYS = [...LEWD_STATS, 'exposure'] as const
function setUseLewd(k: (typeof LEWD_USE_KEYS)[number], v: number) {
  const l = { ...(use.value.lewd ?? {}) }
  if (v) l[k] = Math.max(-20, Math.min(20, Math.round(v)))
  else delete l[k]
  use.value.lewd = Object.keys(l).length ? l : undefined
}
// 寄生物的引子（docs/ADULT_EVENTS.md 第 6 節）：在地下城裡用了立刻遇到的地下城事件（照順序挑第一件體型相符的）
const BODY_SHORT: Record<string, string> = { masc: '陽剛', fem: '陰柔', andro: '中性' }
const lureChoices = computed(() => {
  void content.version
  const all = dungeonTemplates().map((t) => ({ id: t.id, label: `${t.title}${t.pc_body?.length ? `（${t.pc_body.map((b) => BODY_SHORT[b] ?? b).join('、')}）` : ''}`, parasite: parasitesFrom(t).length > 0 }))
  return { parasite: all.filter((t) => t.parasite), other: all.filter((t) => !t.parasite) }
})
function lureLabel(id: string): string {
  return [...lureChoices.value.parasite, ...lureChoices.value.other].find((t) => t.id === id)?.label ?? `${id}（不存在）`
}
function addLure(id: string) {
  if (!id || use.value.lure?.includes(id) || (use.value.lure?.length ?? 0) >= 4) return
  use.value.lure = [...(use.value.lure ?? []), id]
}
function removeLure(id: string) {
  const l = (use.value.lure ?? []).filter((x) => x !== id)
  use.value.lure = l.length ? l : undefined
  if (!l.length && !draft.value.gear?.unique) delete draft.value.black_market
}
// 內容標籤（商店照內容篩選上架）
function toggleContentTag(t: string, on: boolean) {
  const set = new Set(draft.value.content_tags ?? [])
  if (on) set.add(t)
  else set.delete(t)
  if (set.size) draft.value.content_tags = FILTER_TAGS.filter((x) => set.has(x))
  else delete draft.value.content_tags
}
// 吃喝可以給的非戰鬥狀態（用餐、喝酒、磨利、自建的……；奴隸印記這類由規則加上的除外）
const conditionList = computed(() => {
  void content.version
  return Object.entries(companionRules.conditions)
    .filter(([id]) => !id.startsWith('$') && !SYSTEM_CONDITIONS.includes(id))
    .map(([id, c]) => ({ id, name: `${c.name}：${c.desc}` }))
})
function setTool(kind: string) {
  if (!kind) delete draft.value.tool
  else draft.value.tool = {
    kind: kind as ToolKind,
    ...(itemRules.tools[kind as ToolKind].bonus !== undefined ? { bonus: draft.value.tool?.bonus ?? itemRules.tools[kind as ToolKind].bonus } : {}),
    ...(kind === 'craft' ? { craft: draft.value.tool?.craft ?? 'smithing', tier: draft.value.tool?.tier ?? 1 } : {}),
  }
}
const toolText = computed(() => toolSummary(draft.value.tool))
// 家具
const furn = computed(() => (draft.value.furniture ??= { places: ['indoor'] }))
function setFurnFunction(v: string) {
  if ((FURNITURE_FUNCTIONS as readonly string[]).includes(v)) furn.value.function = v as FurnitureFunction
  else delete furn.value.function
  if (v === 'workbench') furn.value.craft ??= 'smithing'
  else delete furn.value.craft
  if (v === 'training') furn.value.training ??= 1
  else delete furn.value.training
  if (v === 'storage') furn.value.slots ??= 12
  else {
    delete furn.value.slots
    delete furn.value.money
  }
}
function toggleFurnPlace(p: FurniturePlace) {
  const list = furn.value.places
  furn.value.places = list.includes(p) ? (list.length > 1 ? list.filter((x) => x !== p) : list) : [...list, p]
}

// 配方（怎麼做出這件物品）與種子（種在苗圃長出什麼）
const itemNames = computed(() => {
  void content.version
  return itemRules.items.map((i) => i.name).filter((n) => n !== props.name)
})
function toggleRecipe(on: boolean) {
  if (on) draft.value.recipe = { craft: 'alchemy', level: 1, inputs: [{ name: '', qty: 1 }], hours: 2 }
  else delete draft.value.recipe
}
function toggleSeed(on: boolean) {
  if (on) draft.value.seed = { yields: [''], qty: [1, 2], days: 3, place: 'yard' }
  else delete draft.value.seed
}

// ---- 情報 ----
const intel = computed(() => (draft.value.intel ??= { kind: 'point' }))
const intelText = computed(() => intelSummary(draft.value.intel))
const intelIsDungeon = computed(() => geography.locations.find((l) => l.id === intel.value.location)?.type === 'dungeon')
function setIntelKind(kind: ItemIntel['kind']) {
  draft.value.intel = kind === 'story' ? { kind, story: stories[0]?.id } : { kind }
}
function setIntelLocation(id: string) {
  intel.value.location = id || undefined
  if (!intelIsDungeon.value) delete intel.value.layer
}
function toggle<T>(list: T[] | undefined, v: T, on: boolean): T[] {
  const set = new Set(list ?? [])
  if (on) set.add(v)
  else set.delete(v)
  return [...set]
}
/** 只在這些地區的商店賣（都不勾時拿掉欄位） */
function setRegion(id: string, on: boolean) {
  const set = new Set(draft.value.regions ?? [])
  if (on) set.add(id)
  else set.delete(id)
  if (set.size) draft.value.regions = geography.regions.map((r) => r.id).filter((r) => set.has(r))
  else delete draft.value.regions
}
function setTag(tag: string, on: boolean) {
  draft.value.tags = toggle(draft.value.tags, tag, on)
}
function setChest(layer: ChestLayer, pct: number) {
  draft.value.chests = { ...(draft.value.chests ?? {}), [layer]: Math.max(0, Math.min(100, pct)) / 100 }
}
function setGather(g: GatherPlace, on: boolean) {
  draft.value.gather = toggle(draft.value.gather, g, on)
}
function setForge(m: string, on: boolean) {
  const list = toggle(draft.value.forge?.materials, m, on)
  draft.value.forge = list.length ? { materials: list } : undefined
}

function ensureGear() {
  if (!draft.value.gear) draft.value.gear = { base: 'longsword', material: 'iron' }
}
watch(() => draft.value.category, (c) => {
  if (c === 'equipment') ensureGear()
})
function setBase(id: string) {
  const kind = gearRules.bases[id]!.kind
  const mat = gearRules.materials[draft.value.gear?.material ?? '']?.kind === kind ? draft.value.gear!.material
    : Object.entries(gearRules.materials).find(([, m]) => m.kind === kind)![0]
  draft.value.gear = { ...draft.value.gear, base: id, material: mat }
}
const enchantMods = computed({
  get: () => draft.value.gear?.enchants?.mods ?? {},
  set: (v) => {
    if (draft.value.gear) draft.value.gear.enchants = { ...(draft.value.gear.enchants ?? {}), mods: v }
  },
})
function setEnchantMod(k: string, v: number) {
  enchantMods.value = { ...enchantMods.value, [k]: v || undefined }
}
const MOD_NAME: Record<string, string> = { hit: '命中', damage: '傷害', evade: '迴避', dr: '減傷', save: '豁免', crit: '幸運一擊', ap_regen: '行動點回復' }
// ---- 獨特物品的檢定加值（一種，可以疊加；不能打造、購買，只能從特殊事件或寶箱得到） ----
const uniqueContexts = Object.entries(perkRules.contexts)
const uniqueSkills = Object.entries(actionRules.skills).map(([k, v]) => [k, v.name] as const)
const uniqueKinds = Object.entries(actionRules.kinds).map(([k, v]) => [k, v.name] as const)
const uniqueTags = Object.entries(npcTags.tags).map(([k, v]) => [k, v.name] as const)
function setUnique(on: boolean) {
  if (!draft.value.gear) return
  if (on) draft.value.gear.unique = { check: { contexts: ['lock'] }, bonus: 1 }
  else delete draft.value.gear.unique
}
function toggleUniqueFilter(key: 'skills' | 'attrs' | 'contexts' | 'kinds' | 'vs_tags', value: string, on: boolean) {
  const u = draft.value.gear?.unique
  if (!u) return
  const set = new Set<string>((u.check[key] as string[] | undefined) ?? [])
  if (on) set.add(value)
  else set.delete(value)
  if (set.size) (u.check as Record<string, string[]>)[key] = [...set]
  else delete u.check[key]
}

// ---- 屬性的加減（只有內容資料裡的裝備；不在商店上架）與主人強制裝備 ----
const attrMax = gearRules.attrs.max_change
function setGearAttr(a: string, v: number) {
  const g = draft.value.gear
  if (!g) return
  const attrs = { ...(g.attrs ?? {}) } as Record<string, number>
  if (v) attrs[a] = Math.max(-attrMax, Math.min(attrMax, Math.round(v)))
  else delete attrs[a]
  if (Object.keys(attrs).length) g.attrs = attrs
  else delete g.attrs
}
// 慾望指標的加減（docs/LEWD_STATS.md 第 3 節）
const lewdCap = lewdRules.gear.item_cap
// 物品自己的拘束程度（底材是拘束具時）
const gearBindBase = computed(() => {
  const base = draft.value.gear ? gearRules.bases[draft.value.gear.base] : undefined
  return base?.bind && base.bind_kind ? base : undefined
})
function setGearLock(v: string) {
  const g = draft.value.gear
  if (!g) return
  if (v) g.lock = v as LockGrade
  else delete g.lock
}
function setGearBind(v: string) {
  const g = draft.value.gear
  if (!g) return
  if (v) g.bind = Number(v)
  else delete g.bind
}
function setGearLewd(k: LewdStat, v: number) {
  const g = draft.value.gear
  if (!g) return
  const lewd = { ...(g.lewd ?? {}) }
  if (v) lewd[k] = Math.max(-lewdCap, Math.min(lewdCap, Math.round(v)))
  else delete lewd[k]
  if (Object.keys(lewd).length) g.lewd = lewd
  else delete g.lewd
}
const masterTags = Object.keys(slaveryRules.master_tags.tags)
function setMasterForce(on: boolean) {
  if (on) draft.value.master_force = {}
  else delete draft.value.master_force
}
function toggleMasterTag(t: string, on: boolean) {
  const f = draft.value.master_force
  if (!f) return
  const set = new Set(f.tags ?? [])
  if (on) set.add(t)
  else set.delete(t)
  if (set.size) f.tags = [...set]
  else delete f.tags
}

const gearText = computed(() => {
  const g = sanitizeGearSpecLoose(draft.value.gear)
  return g ? gearSummary(g) : '底材與材料的類型要一致'
})
function priceFromGear() {
  const g = sanitizeGearSpecLoose(draft.value.gear)
  if (g) draft.value.price_cc = gearPrice(g)
}
const useText = computed(() => {
  try {
    return useSummary(draft.value.use)
  } catch {
    return ''
  }
})

function addDrop() {
  drops.value.push({ enemy: enemyList.value[0]!.id, chance: 0.3, qty: 1 })
}

// ---- 動作 ----
function save() {
  try {
    const target = content.saveItem(props.name, draft.value, custom.value ? newName.value : undefined)
    content.setItemDrops(target, drops.value)
    game.flash(`已儲存「${target}」`)
    if (target !== props.name) emit('renamed', target)
    else reset()
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function restore() {
  if (!confirm(`把「${props.name}」恢復成內建的樣子？（怪物掉落的設定改在怪物上，不會一起恢復）`)) return
  content.restoreItem(props.name)
  reset()
}
// 還有地方用到時不能刪（見 docs/CONTENT_DEPENDENCIES.md）
const usage = computed(() => {
  void content.version
  void game.state?.time.minute
  return content.usageOf('item', props.name)
})
function remove() {
  if (!confirm(`刪除「${props.name}」？怪物不再掉落；其他存檔裡已有的會變成無法使用的雜物。`)) return
  try {
    content.deleteItem(props.name)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
    return
  }
  content.setItemDrops(props.name, [])
  emit('deleted')
}

/** 照明工具燒的燃料：能照亮格子的物品（burns > 0），不含自己 */
const fuels = computed(() => {
  void content.version
  return itemRules.items.filter((i) => (i.burns ?? 0) > 0 && i.name !== props.name).map((i) => i.name)
})
function setFuel(v: string) {
  if (!draft.value.tool) return
  if (v) draft.value.tool.fuel = v
  else delete draft.value.tool.fuel
}
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="name" :kind="custom ? 'custom' : 'builtin'" :edited="edited" :dirty="dirty" :usage="usage"
      @save="save" @discard="reset" @restore="restore" @remove="remove"
    />
    <UsageNote :usage="usage" :deletable="custom" />
    <SourceNote kind="item" :id="name" />

    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>名稱
          <input v-if="custom" v-model="newName" maxlength="20" />
          <input v-else :value="name" disabled title="內建物品不能改名（存檔與掉落表用名稱對應）" />
        </label>
        <label>類別
          <select v-model="draft.category">
            <option v-for="(n, k) in CATS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label>價格（{{ formatMoney(draft.price_cc) }}）<input v-model.number="draft.price_cc" type="number" min="0" /></label>
        <label title="城鎮標籤（礦產豐富、港口貿易……）照貿易類別調整買賣價格">貿易類別
          <select :value="draft.trade_category ?? ''" @change="($event.target as HTMLSelectElement).value ? (draft.trade_category = ($event.target as HTMLSelectElement).value) : delete draft.trade_category">
            <option value="">（照推的：{{ inferredTrade }}）</option>
            <option v-for="(n, k) in marketRules.categories" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label v-if="draft.category === 'material'" title="行囊、商店顯示的材料等級；沒填時照用途推（打造材料的等級、用到它的配方、會掉它的怪物等級）">材料等級
          <select :value="draft.tier ?? ''" @change="($event.target as HTMLSelectElement).value ? (draft.tier = Number(($event.target as HTMLSelectElement).value)) : delete draft.tier">
            <option value="">（照推的：{{ inferredTier }}）</option>
            <option v-for="t in maxMaterialTier()" :key="t" :value="t">第 {{ t }} 級</option>
          </select>
        </label>
      </div>
      <label class="block">描述 <textarea v-model="draft.desc" rows="2" maxlength="200" /></label>
      <label class="check small"><input type="checkbox" :checked="!!draft.adult" @change="draft.adult = ($event.target as HTMLInputElement).checked || undefined" /> 成人向（內容編輯器的篩選用）</label>
      <div class="row small"><span>內容標籤 <Hint text="設定的內容篩選關掉這些標籤時，商店不賣（例如懷孕的避子湯、泌乳的道具）。" /></span>
        <label v-for="t in FILTER_TAGS" :key="t" class="check"><input type="checkbox" :checked="draft.content_tags?.includes(t)" @change="toggleContentTag(t, ($event.target as HTMLInputElement).checked)" /> {{ CONTENT_TAGS[t].name }}</label>
      </div>
      <label v-if="draft.category === 'equipment'" class="check small"><input type="checkbox" :checked="!!draft.lactation" @change="draft.lactation = ($event.target as HTMLInputElement).checked || undefined" /> 戴著的時候泌乳 <Hint text="泌乳之環這類（docs/FAMILY.md 第 10 節）：內容篩選打開「泌乳」、身體會泌乳的人戴著時泌乳。" /></label>
      <div class="block icon-row"><span>圖示</span><IconField v-model="draft.icon" :fallback="iconFallback" /></div>
      <p v-if="draft.category === 'material'" class="small muted">材料的價格是商人的收購價（全額收購）；其他物品賣出時是一半。</p>
    </FoldSet>

    <FoldSet>
      <template #legend>在哪裡出現</template>
      <div class="row checks">
        <span class="small">商店：</span>
        <label v-for="(n, t) in SHOPS" :key="t" class="check small"><input type="checkbox" :checked="draft.tags.includes(String(t))" @change="setTag(String(t), ($event.target as HTMLInputElement).checked)" /> {{ n }}</label>
        <label class="small">最低聚落
          <select :value="draft.min_location ?? 'village'" @change="draft.min_location = ($event.target as HTMLSelectElement).value">
            <option v-for="(n, k) in LOCS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label class="small" title="成人向（docs/LEWD_STATS.md 第 20 節）：魅氣濃度至少這麼高的聚落才買得到（淫市的貨）">魅氣濃度 ≥
          <select :value="draft.charm_min ?? ''" @change="($event.target as HTMLSelectElement).value ? (draft.charm_min = Number(($event.target as HTMLSelectElement).value)) : delete draft.charm_min">
            <option value="">（不限）</option>
            <option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
      </div>
      <div class="row checks" title="地方的特產：只在這些地區的商店賣；都不勾時哪裡都賣">
        <span class="small">只在這些地區賣：</span>
        <label v-for="r in geography.regions" :key="r.id" class="check small"><input type="checkbox" :checked="!!draft.regions?.includes(r.id)" @change="setRegion(r.id, ($event.target as HTMLInputElement).checked)" /> {{ r.name }}</label>
      </div>
      <p v-if="draft.category === 'equipment'" class="small muted">裝備在商店是每天隨機上架幾樣，不是每天都有。</p>
      <div class="row checks">
        <span class="small">寶箱（各層的機率）：</span>
        <label v-for="l in CHEST_LAYERS" :key="l" class="small">{{ LAYER[l] }} <input class="num" type="number" min="0" max="100" :value="Math.round((draft.chests?.[l] ?? 0) * 100)" @change="setChest(l, Number(($event.target as HTMLInputElement).value))" />%</label>
      </div>
      <div class="row checks">
        <span class="small">採集：</span>
        <label class="check small"><input type="checkbox" :checked="draft.gather?.includes('wild')" @change="setGather('wild', ($event.target as HTMLInputElement).checked)" /> 近郊的資源格</label>
        <label class="check small"><input type="checkbox" :checked="draft.gather?.includes('dungeon')" @change="setGather('dungeon', ($event.target as HTMLInputElement).checked)" /> 地下城的資源格</label>
      </div>
      <label class="check small"><input v-model="draft.event" type="checkbox" /> 事件：AI 判定主動行動時可以把它當成報酬 <Hint text="提示詞會列出這個物品。" /></label>
      <div>
        <span class="small">怪物掉落：</span>
        <div v-for="(d, i) in drops" :key="i" class="row">
          <select v-model="d.enemy" class="grow">
            <option v-for="e in enemyList" :key="e.id" :value="e.id">{{ e.name }}（{{ e.level }} 級）</option>
          </select>
          <label class="small">機率 <input class="num" type="number" min="1" max="100" :value="Math.round(d.chance * 100)" @input="d.chance = Number(($event.target as HTMLInputElement).value) / 100" />%</label>
          <label class="small">數量 <input v-model.number="d.qty" class="num" type="number" min="1" /></label>
          <button class="small" @click="drops.splice(i, 1)" title="移除">✕</button>
        </div>
        <button class="small" @click="addDrop">＋ 掉落的怪物</button>
        <p class="small muted">掉落設定存在怪物身上（和怪物編輯頁的掉落物是同一份）。</p>
      </div>
    </FoldSet>

    <FoldSet v-if="draft.category === 'consumable' || draft.category === 'food' || draft.category === 'scroll'">
      <template #legend>使用效果（{{ useText || '無' }}）</template>
      <div class="grid">
        <label>吃喝後的狀態（到下次長休）
          <select :value="use.condition ?? ''" @change="use.condition = ($event.target as HTMLSelectElement).value || undefined">
            <option value="">（無）</option>
            <option v-for="c in conditionList" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label>回復生命（骰子）<input v-model="use.heal" placeholder="2d4+2" /></label>
        <label>回復法術環（N 環以下）<input v-model.number="use.slot" type="number" min="0" max="9" /></label>
        <label>暫時生命 <input v-model.number="use.temp_hp" type="number" min="0" /></label>
        <label>行動點 <input v-model.number="use.ap" type="number" min="0" max="10" /></label>
        <label title="戰鬥中：負數消退慾望（清心茶 −30），正數算自己增加的慾望">慾望 <input v-model.number="use.lust" type="number" min="-200" max="200" /></label>
        <label>救起倒下的隊友（最大生命 %）<input type="number" min="0" max="100" :value="Math.round((use.revive ?? 0) * 100)" @change="use.revive = Number(($event.target as HTMLInputElement).value) / 100 || undefined" /></label>
        <label>給自己或隊友的狀態
          <select :value="use.status?.id ?? ''" @change="use.status = ($event.target as HTMLSelectElement).value ? { id: ($event.target as HTMLSelectElement).value, turns: use.status?.turns ?? 3 } : undefined">
            <option value="">（無）</option>
            <option v-for="s in buffs" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label v-if="use.status">持續回合 <input v-model.number="use.status.turns" type="number" min="1" max="20" /></label>
      </div>
      <div class="row checks">
        <span class="small">解除：</span>
        <label v-for="s in debuffs" :key="s.id" class="check small"><input type="checkbox" :checked="use.cleanse?.includes(s.id)" @change="use.cleanse = toggle(use.cleanse, s.id, ($event.target as HTMLInputElement).checked)" /> {{ s.name }}</label>
      </div>
      <details v-if="draft.category === 'consumable'" class="small">
        <summary>📖 書籍：讀完有機會學會的特質（{{ use.perks?.length ?? 0 }}，最多 6 個）</summary>
        <p class="muted">讀完時從勾選的特質選一個學（也可以寫說法交給 AI）。種族特質不能從書裡學。</p>
        <label v-for="p in choosablePerks().filter((x) => !x.flaw)" :key="p.id" class="check" :title="p.desc">
          <input type="checkbox" :checked="use.perks?.includes(p.id)" :disabled="!use.perks?.includes(p.id) && (use.perks?.length ?? 0) >= 6" @change="use.perks = toggle(use.perks, p.id, ($event.target as HTMLInputElement).checked)" /> {{ p.name }}
        </label>
      </details>
      <div class="grid">
        <label>投擲傷害（骰子）<input :value="use.damage?.dice ?? ''" placeholder="2d6" @change="use.damage = ($event.target as HTMLInputElement).value ? { dice: ($event.target as HTMLInputElement).value, type: use.damage?.type ?? 'fire' } : undefined" /></label>
        <label v-if="use.damage">傷害類型
          <select v-model="use.damage.type"><option v-for="t in damageIds" :key="t" :value="t">{{ damageTypeName(t) }}</option></select>
        </label>
        <label>對敵人施加狀態
          <select :value="use.apply?.status ?? ''" @change="use.apply = ($event.target as HTMLSelectElement).value ? { status: ($event.target as HTMLSelectElement).value, turns: use.apply?.turns ?? 2, save: use.apply?.save, dc: use.apply?.dc } : undefined">
            <option value="">（無）</option>
            <option v-for="s in debuffs" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <template v-if="use.apply">
          <label>回合 <input v-model.number="use.apply.turns" type="number" min="1" max="20" /></label>
          <label>豁免屬性
            <select v-model="use.apply.save"><option :value="undefined">（不能豁免）</option><option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option></select>
          </label>
          <label v-if="use.apply.save">豁免 DC <input v-model.number="use.apply.dc" type="number" min="5" max="30" /></label>
        </template>
        <label v-if="use.damage || use.apply"><span>豁免 <Hint text="成功時傷害減半、不受狀態。" /></span>
          <select :value="use.save?.attr ?? ''" @change="use.save = ($event.target as HTMLSelectElement).value ? { attr: ($event.target as HTMLSelectElement).value as AttrId, dc: use.save?.dc ?? 13 } : undefined">
            <option value="">（不能豁免）</option>
            <option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option>
          </select>
        </label>
        <label v-if="use.save">豁免 DC <input v-model.number="use.save.dc" type="number" min="5" max="30" /></label>
        <label v-if="use.damage || use.apply">範圍
          <select v-model="use.area"><option value="one">一名敵人</option><option value="all">所有敵人</option></select>
        </label>
      </div>
      <label class="check small"><input v-model="use.escape" type="checkbox" /> 傳送：全隊立刻脫離戰鬥</label>
      <div class="row small">
        <label title="內容篩選打開「泌乳」、身體會泌乳的人才能用；給自由的夥伴要先說服">泌乳幾天 <input v-model.number="use.lactation" type="number" min="0" max="60" class="num" /></label>
        <label class="check"><input type="checkbox" :checked="!!use.stop_lactation" @change="use.stop_lactation = ($event.target as HTMLInputElement).checked || undefined" /> 斷乳（拿掉道具與事件造成的泌乳）</label>
      </div>
      <div class="row small">
        <span>冥想 <Hint text="用了花一個小時，慾望指標增減幾點（負數是降低；曝露名聲是用的地方那一帶的）。神殿的清心香、淨念香、自持經、隱名符就是這種。每項 −20～+20。" /></span>
        <label v-for="k in LEWD_USE_KEYS" :key="k">{{ lewdName(k) }} <input type="number" min="-20" max="20" class="num" :value="use.lewd?.[k] ?? 0" @change="setUseLewd(k, Number(($event.target as HTMLInputElement).value))" /></label>
      </div>
      <details v-if="draft.category === 'consumable'" class="small" :open="!!use.lure?.length">
        <summary>🐛 寄生物的引子：在地下城裡用了立刻遇到的事件（{{ use.lure?.length ?? 0 }}，最多 4 件）</summary>
        <p class="muted">在地下城裡使用時，立刻遇到這件地下城事件（不看機率、冷卻、地點與層數；有別的事情等著回應、不在地下城時不能用，也不會用掉）。有好幾件時照順序挑第一件主角體型相符的，所以陽剛體型的版本放在後面；內容篩選擋掉的不算。</p>
        <div v-for="id in use.lure ?? []" :key="id" class="row">
          <span class="grow">{{ lureLabel(id) }}</span>
          <button class="small" title="移除" @click="removeLure(id)">✕</button>
        </div>
        <select v-if="(use.lure?.length ?? 0) < 4" :value="''" @change="addLure(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">＋ 加一件地下城事件…</option>
          <optgroup label="會帶來寄生物的事件">
            <option v-for="t in lureChoices.parasite" :key="t.id" :value="t.id" :disabled="use.lure?.includes(t.id)">{{ t.label }}</option>
          </optgroup>
          <optgroup label="其他地下城事件">
            <option v-for="t in lureChoices.other" :key="t.id" :value="t.id" :disabled="use.lure?.includes(t.id)">{{ t.label }}</option>
          </optgroup>
        </select>
        <label v-if="use.lure?.length" class="check">
          <input type="checkbox" :checked="!!draft.black_market" @change="draft.black_market = ($event.target as HTMLInputElement).checked || undefined" />
          在黑市賣：地下街裡的黑市每天各上架一份（照物品的價錢；存檔規則「黑市賣寄生物的引子」關掉時不賣，物品的內容標籤或引來的事件被內容篩選擋掉時也不賣）
        </label>
      </details>
      <label class="check small"><input v-model="use.combat_only" type="checkbox" /> 只能在戰鬥中使用 <Hint text="回復生命、法術環以外的效果一律只能在戰鬥中用。" /></label>
    </FoldSet>

    <FoldSet v-if="draft.category === 'gear'">
      <template #legend>工具模板（{{ toolText || '無：交給 AI 判斷' }}）</template>
      <div class="grid">
        <label>模板
          <select :value="draft.tool?.kind ?? ''" @change="setTool(($event.target as HTMLSelectElement).value)">
            <option value="">（無：交給 AI 判斷）</option>
            <option v-for="k in TOOL_KINDS" :key="k" :value="k">{{ itemRules.tools[k].name }}</option>
          </select>
        </label>
        <label v-if="draft.tool && itemRules.tools[draft.tool.kind].bonus !== undefined">加值
          <input v-model.number="draft.tool.bonus" type="number" min="1" :max="itemRules.tools[draft.tool.kind].max ?? 10" />
        </label>
        <template v-if="draft.tool?.kind === 'craft'">
          <label>工藝
            <select v-model="draft.tool.craft">
              <option v-for="c in CRAFT_IDS" :key="c" :value="c">{{ craftRules.skills[c].name }}</option>
            </select>
          </label>
          <label>階級
            <select v-model.number="draft.tool.tier">
              <option :value="1">低階：隨身工具組（第 1～2 級材料，任何地方）</option>
              <option :value="2">中階：攜帶式工坊（第 3 級材料，旅店、安全房展開）</option>
            </select>
          </label>
        </template>
        <label v-if="draft.tool?.kind === 'light'">燒什麼
          <select :value="draft.tool.fuel ?? ''" @change="setFuel(($event.target as HTMLSelectElement).value)">
            <option value="">（燒自己，或不會燒）</option>
            <option v-for="f in fuels" :key="f" :value="f">{{ f }}</option>
            <option v-if="draft.tool.fuel && !fuels.includes(draft.tool.fuel)" :value="draft.tool.fuel">{{ draft.tool.fuel }}（不是燃料）</option>
          </select>
        </label>
        <label><span>能照亮幾格 <Hint text="燃料、火把每一份能照亮幾格；0 = 不是燃料。" /></span>
          <input v-model.number="draft.burns" type="number" min="0" max="999" />
        </label>
      </div>
      <HelpText text="照明：在黑暗的地方每走一格燒掉一點。「燒什麼」填燃料物品的名稱（例如油燈燒燈油，燈油本身要填能照亮幾格）；空白而且有「能照亮幾格」時燒掉工具本身（火把）；都沒有時不會燒掉（魔法照明石）。" />
      <div class="row small">
        <label>鎖
          <select :value="draft.lock ?? ''" @change="($event.target as HTMLSelectElement).value ? (draft.lock = ($event.target as HTMLSelectElement).value as LockGrade) : delete draft.lock">
            <option value="">（不是鎖）</option>
            <option v-for="g in LOCK_GRADES" :key="g" :value="g">{{ lewdRules.locks.grades[g].name }}（×{{ lewdRules.locks.grades[g].mult }}）</option>
          </select>
        </label>
        <Hint text="成人向（docs/LEWD_STATS.md 第 7 節）：可以在裝備欄替身上的拘束具上鎖，雙面效應的戰鬥增益才生效。" />
        <label>鑰匙
          <select :value="draft.key ?? ''" :disabled="!!draft.lock" @change="($event.target as HTMLSelectElement).value ? (draft.key = ($event.target as HTMLSelectElement).value as LockGrade) : delete draft.key">
            <option value="">（不是鑰匙）</option>
            <option v-for="g in LOCK_GRADES" :key="g" :value="g">打得開{{ lewdRules.locks.grades[g].name }}以下</option>
          </select>
        </label>
        <Hint text="成人向（docs/LEWD_STATS.md 第 16 節）：打開自己打不開的拘束具（主人、陷阱鎖上的，或自己鎖上但鑰匙不在身上的），用一次就沒了，鎖也跟著壞掉。" />
      </div>
      <HelpText text="行囊裡同一種工具只算加值最高的一件。沒有套模板的雜物，AI 判定主動行動時會看到它在行囊裡，依玩家描述的用法決定有沒有幫助。" />
    </FoldSet>

    <FoldSet v-if="draft.category === 'furniture'">
      <template #legend>家具</template>
      <div class="grid">
        <label>功能
          <select :value="furn.function ?? ''" @change="setFurnFunction(($event.target as HTMLSelectElement).value)">
            <option value="">裝飾（只有舒適度）</option>
            <option value="bed">床（在家長休）</option>
            <option value="workbench">高階工作台</option>
            <option value="garden">苗圃（可以播種）</option>
            <option value="training">調教室（成人向：在家調教加值、奴隸每天順從 +1）</option>
            <option value="crib">搖籃（家裡的嬰兒睡在這裡；可有可無）</option>
            <option value="storage">儲物箱（收東西；保險箱還能存錢）</option>
          </select>
        </label>
        <label v-if="furn.function === 'storage'">能放幾種 <input v-model.number="furn.slots" type="number" min="1" max="99" title="不同的東西各算一種，同一種的數量不限" /></label>
        <label v-if="furn.function === 'storage'" class="check"><input type="checkbox" :checked="!!furn.money" @change="($event.target as HTMLInputElement).checked ? (furn.money = true) : delete furn.money" /> 可以存錢（保險箱）</label>
        <label v-if="furn.function === 'training'">調教加值 <input v-model.number="furn.training" type="number" min="1" max="3" /></label>
        <label v-if="furn.function === 'workbench'">工藝
          <select v-model="furn.craft">
            <option v-for="c in CRAFT_IDS" :key="c" :value="c">{{ craftRules.skills[c].name }}</option>
          </select>
        </label>
        <label>舒適度 <input v-model.number="furn.comfort" type="number" min="0" max="10" /></label>
        <label>地圖符號 <input v-model="furn.icon" title="擺在家裡時，地圖格上顯示的 emoji" maxlength="4" placeholder="🪑" /></label>
      </div>
      <div class="row small">
        <span>能放在：</span>
        <label v-for="p in (['indoor', 'yard', 'basement'] as const)" :key="p" class="check">
          <input type="checkbox" :checked="furn.places.includes(p)" @change="toggleFurnPlace(p)" /> {{ PLACE_NAME[p] }}
        </label>
      </div>
      <p class="small muted">家具擺在自己房子的格子上。床讓你在家長休；舒適度加總達到 {{ homeRules.comfort_rested }} 時，在家長休後睡得香甜；高階工作台讓這種工藝能處理第四、五級的材料；苗圃可以種下種子（種子的「能種在」要和苗圃擺的地方一樣）；儲物箱收行囊裡的東西（容量算種類，在這棟房子做工藝、播種時箱子裡的也算），保險箱還能存錢。</p>
    </FoldSet>

    <FoldSet v-if="draft.category !== 'equipment'">
      <template #legend><label class="check"><input type="checkbox" :checked="!!draft.recipe" @change="toggleRecipe(($event.target as HTMLInputElement).checked)" /> 配方：可以自己做出來</label></template>
      <template v-if="draft.recipe">
        <div class="grid">
          <label>工藝
            <select v-model="draft.recipe.craft">
              <option v-for="c in CRAFT_IDS" :key="c" :value="c">{{ craftRules.skills[c].name }}</option>
            </select>
          </label>
          <label>需要的等級 <input v-model.number="draft.recipe.level" type="number" min="1" :max="craftRules.max_level" /></label>
          <label>一批做出幾份 <input v-model.number="draft.recipe.qty" type="number" min="1" max="20" placeholder="1" /></label>
          <label>一批另外的花費（{{ formatMoney(draft.recipe.cost_cc ?? 0) }}） <input v-model.number="draft.recipe.cost_cc" type="number" min="0" placeholder="0" /></label>
          <label>一批幾小時 <input v-model.number="draft.recipe.hours" type="number" min="1" max="48" /></label>
        </div>
        <div v-for="(x, i) in draft.recipe.inputs" :key="i" class="row">
          <input v-model="x.name" list="recipe-items" placeholder="材料名稱" />
          ×<input v-model.number="x.qty" type="number" min="1" max="99" class="qty" />
          <button class="small" :disabled="draft.recipe.inputs.length <= 1" @click="draft.recipe.inputs.splice(i, 1)" title="刪除這一項">✕</button>
        </div>
        <button v-if="draft.recipe.inputs.length < 6" class="small" @click="draft.recipe.inputs.push({ name: '', qty: 1 })">＋ 材料</button>
        <p class="small muted">做的人擲{{ craftRules.skills[draft.recipe.craft].name }}的屬性檢定，加工藝等級；DC {{ craftRules.recipe.dc[(draft.recipe.level || 1) - 1] }}，工具要{{ craftRules.tool_tier_names[craftRules.tool_tier[(draft.recipe.level || 1) - 1]! - 1] }}。材料最多 6 種；沒填名稱的材料不會存。</p>
      </template>
    </FoldSet>

    <FoldSet v-if="draft.category === 'material'">
      <template #legend><label class="check"><input type="checkbox" :checked="!!draft.seed" @change="toggleSeed(($event.target as HTMLInputElement).checked)" /> 種子：可以種在苗圃</label></template>
      <template v-if="draft.seed">
        <div class="grid">
          <label>能種在
            <select v-model="draft.seed.place">
              <option v-for="p in (['yard', 'basement', 'indoor'] as const)" :key="p" :value="p">{{ PLACE_NAME[p] }}的苗圃</option>
            </select>
          </label>
          <label>幾天成熟 <input v-model.number="draft.seed.days" type="number" min="1" max="30" /></label>
          <label>收成最少 <input v-model.number="draft.seed.qty[0]" type="number" min="1" max="20" /></label>
          <label>收成最多 <input v-model.number="draft.seed.qty[1]" type="number" min="1" max="20" /></label>
        </div>
        <div v-for="(_, i) in draft.seed.yields" :key="i" class="row">
          <input v-model="draft.seed.yields[i]" list="recipe-items" placeholder="長出的物品" />
          <button class="small" :disabled="draft.seed.yields.length <= 1" @click="draft.seed.yields.splice(i, 1)" title="刪除這一項">✕</button>
        </div>
        <button v-if="draft.seed.yields.length < 5" class="small" @click="draft.seed.yields.push('')">＋ 作物</button>
        <p class="small muted">有好幾種作物時，收成時隨機長出其中一種。</p>
      </template>
    </FoldSet>
    <datalist id="recipe-items"><option v-for="n in itemNames" :key="n" :value="n" /></datalist>

    <FoldSet v-if="draft.category === 'info'">
      <template #legend>情報內容（{{ intelText }}）</template>
      <div class="grid">
        <label>解讀後得到
          <select :value="intel.kind" @change="setIntelKind(($event.target as HTMLSelectElement).value as ItemIntel['kind'])">
            <option value="point">事件點</option>
            <option value="story">特殊任務的消息</option>
            <option value="lead">進行中委託的線索</option>
          </select>
        </label>
        <template v-if="intel.kind === 'point'">
          <label>事件
            <select :value="intel.event ?? ''" @change="intel.event = (($event.target as HTMLSelectElement).value || undefined) as ItemIntel['event']">
              <option value="">隨機</option>
              <option value="combat">盤踞的強敵</option>
              <option value="chest">藏寶處</option>
              <option value="merchant">流浪商人</option>
            </select>
          </label>
          <label>地點
            <select :value="intel.location ?? ''" @change="setIntelLocation(($event.target as HTMLSelectElement).value)">
              <option value="">解讀的地方附近</option>
              <option v-for="l in geography.locations" :key="l.id" :value="l.id">{{ l.name }}{{ l.type === 'dungeon' ? '（地下城）' : '' }}</option>
            </select>
          </label>
          <label v-if="intelIsDungeon">哪一層
            <select :value="intel.layer ?? ''" @change="intel.layer = (($event.target as HTMLSelectElement).value || undefined) as ItemIntel['layer']">
              <option value="">隨機</option>
              <option v-for="l in CHEST_LAYERS" :key="l" :value="l">{{ LAYER[l] }}</option>
            </select>
          </label>
          <label>有效天數 <input v-model.number="intel.days" type="number" min="1" max="30" placeholder="5" /></label>
        </template>
        <label v-else-if="intel.kind === 'story'">特殊任務
          <select v-model="intel.story">
            <option v-for="st in stories" :key="st.id" :value="st.id">{{ st.title }}</option>
          </select>
        </label>
      </div>
      <HelpText text="在行囊按「🔍 解讀」：和向情報商買情報一樣記進冒險筆記，用掉這件物品。AI 自創的情報物品是解讀地點附近隨機的事件點。" />
    </FoldSet>

    <FoldSet v-if="draft.category === 'equipment'">
      <template #legend>裝備組成</template>
      <div v-if="draft.gear" class="grid">
        <label>底材
          <select :value="draft.gear.base" @change="setBase(($event.target as HTMLSelectElement).value)">
            <option v-for="[id, b] in bases" :key="id" :value="id">{{ b.name }}</option>
          </select>
        </label>
        <label>材料
          <select v-model="draft.gear.material">
            <option v-for="[id, m] in materials" :key="id" :value="id">{{ m.name }}（{{ rarityName(m.rarity) }}）</option>
          </select>
        </label>
        <label>稀有度
          <select :value="draft.gear.rarity ?? ''" @change="draft.gear!.rarity = ($event.target as HTMLSelectElement).value || undefined">
            <option value="">依材料</option>
            <option v-for="r in RARITY_ORDER" :key="r" :value="r">{{ rarityName(r) }}</option>
          </select>
        </label>
      </div>
      <div v-if="draft.gear" class="grid">
        <label v-for="(n, k) in MOD_NAME" :key="k">附魔・{{ n }} <input type="number" :value="enchantMods[k as keyof typeof enchantMods] ?? ''" @change="setEnchantMod(String(k), Number(($event.target as HTMLInputElement).value))" /></label>
      </div>
      <template v-if="draft.gear">
        <AffinityRows :model-value="draft.gear.enchants?.resist" label="附魔・抗性" @update:model-value="draft.gear!.enchants = { ...(draft.gear!.enchants ?? {}), resist: $event }" />
        <AffinityRows :model-value="draft.gear.enchants?.offense" label="附魔・攻擊加成" @update:model-value="draft.gear!.enchants = { ...(draft.gear!.enchants ?? {}), offense: $event }" />
      </template>
      <div class="row">
        <span class="summary small">{{ gearText }}</span>
        <button class="small" @click="priceFromGear">依組成定價</button>
      </div>
      <p class="small muted">這裡設定的數值不受稀有度的附魔點數限制（那是給打造、寶箱與 AI 生成的裝備用的）。</p>
      <template v-if="draft.gear">
        <label class="check small">
          <input type="checkbox" :checked="!!draft.gear.unique" @change="setUnique(($event.target as HTMLInputElement).checked)" />
          獨特物品：帶一種檢定加值。不會在商店賣、不能打造，要放進寶箱或特殊任務的效果才拿得到 <Hint text="這個檢定加值和附魔分開，可以和其他加值疊加。" />
        </label>
        <label v-if="draft.gear.unique" class="check small">
          <input type="checkbox" :checked="!!draft.black_market" @change="draft.black_market = ($event.target as HTMLInputElement).checked || undefined" />
          也會出現在黑市：地下街裡的黑市每天刷新幾件珍品（件數在遊戲規則），價格是物品價的幾倍，可以殺價
        </label>
        <div v-if="draft.gear.unique" class="unique small">
          <label>檢定加值 <input v-model.number="draft.gear.unique.bonus" type="number" min="-3" max="3" class="num" /></label>
          <span class="muted">勾選篩選條件：同一欄是「或」，不同欄是「且」，都不勾就是所有檢定。</span>
          <details open><summary>檢定分類（{{ draft.gear.unique.check.skills?.length ?? 0 }}）</summary>
            <label v-for="[k, n] in uniqueSkills" :key="k" class="check"><input type="checkbox" :checked="draft.gear.unique.check.skills?.includes(k as never)" @change="toggleUniqueFilter('skills', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}</label>
          </details>
          <details><summary>屬性（{{ draft.gear.unique.check.attrs?.length ?? 0 }}）</summary>
            <label v-for="a in ATTR_IDS" :key="a" class="check"><input type="checkbox" :checked="draft.gear.unique.check.attrs?.includes(a)" @change="toggleUniqueFilter('attrs', a, ($event.target as HTMLInputElement).checked)" /> {{ attrName(a) }}</label>
          </details>
          <details><summary>情境（{{ draft.gear.unique.check.contexts?.length ?? 0 }}）</summary>
            <label v-for="[k, n] in uniqueContexts" :key="k" class="check"><input type="checkbox" :checked="draft.gear.unique.check.contexts?.includes(k as never)" @change="toggleUniqueFilter('contexts', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}</label>
          </details>
          <details><summary>主動行動（{{ draft.gear.unique.check.kinds?.length ?? 0 }}）</summary>
            <label v-for="[k, n] in uniqueKinds" :key="k" class="check"><input type="checkbox" :checked="draft.gear.unique.check.kinds?.includes(k as never)" @change="toggleUniqueFilter('kinds', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}</label>
          </details>
          <details><summary>對象的標籤（{{ draft.gear.unique.check.vs_tags?.length ?? 0 }}）</summary>
            <label v-for="[k, n] in uniqueTags" :key="k" class="check"><input type="checkbox" :checked="draft.gear.unique.check.vs_tags?.includes(k)" @change="toggleUniqueFilter('vs_tags', k, ($event.target as HTMLInputElement).checked)" /> {{ n }}</label>
          </details>
        </div>
        <div class="row small">
          <span>屬性加減（每項 ±{{ attrMax }}） <Hint :text="`身上裝備的同一項合計最多 ±${gearRules.attrs.cap}。`" />：</span>
          <label v-for="a in ATTR_IDS" :key="a">{{ attrName(a) }}
            <input type="number" class="num" :min="-attrMax" :max="attrMax" :value="draft.gear.attrs?.[a] ?? 0" @input="setGearAttr(a, Number(($event.target as HTMLInputElement).value))" />
          </label>
        </div>
        <div class="row small">
          <span>慾望指標加減（每項 ±{{ lewdCap }}） <Hint :text="`成人向（docs/LEWD_STATS.md 第 3 節）。穿著時的有效值；底材的預設（成人向服裝、束縛用）另外加，全身每項合計 ±${lewdRules.gear.total_cap}。`" />：</span>
          <label v-for="k in LEWD_STATS" :key="k">{{ lewdName(k) }}
            <input type="number" class="num" :min="-lewdCap" :max="lewdCap" :value="draft.gear.lewd?.[k] ?? 0" @input="setGearLewd(k, Number(($event.target as HTMLInputElement).value))" />
          </label>
        </div>
        <div v-if="gearBindBase" class="row small">
          <label>拘束程度
            <select :value="draft.gear.bind ?? ''" @change="setGearBind(($event.target as HTMLSelectElement).value)">
              <option value="">（照底材：{{ gearBindBase.bind }}）</option>
              <option v-for="n in [1, 2, 3]" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label>自帶的鎖
            <select :value="draft.gear.lock ?? ''" @change="setGearLock(($event.target as HTMLSelectElement).value)">
              <option value="">（沒有）</option>
              <option v-for="g in LOCK_GRADES" :key="g" :value="g">{{ lewdRules.locks.grades[g].name }}</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" :checked="!!draft.gear.curse" @change="($event.target as HTMLInputElement).checked ? (draft.gear!.curse = true) : delete draft.gear!.curse" />
            詛咒具
          </label>
          <Hint :text="`底材是拘束具（${lewdRules.two_face.kinds[gearBindBase.bind_kind!]?.name ?? gearBindBase.bind_kind}）時，這件物品可以有自己的程度，蓋過底材的設定；種類照底材。自帶的鎖：戴上就算鎖上（雙面效應用這個等級），不能打開、也不會變成行囊裡的鎖（docs/LEWD_STATS.md 第 7 節）。詛咒具：一戴上就被詛咒鎖住，掙不開、鑰匙打不開、鐵匠剪不掉，只能到神殿解咒（第 7.2 節）；不會在商店上架。`" />
        </div>
        <label class="check small">
          <input type="checkbox" :checked="!!draft.master_force" @change="setMasterForce(($event.target as HTMLInputElement).checked)" />
          主人會強制裝備：主角是奴隸時，主人的事件可能挑這件替主角裝上，契約還在時拿不下來
        </label>
        <div v-if="draft.master_force" class="row small">
          <span class="muted">只有這些身分的主人會用（都不勾＝任何主人）：</span>
          <label v-for="t in masterTags" :key="t" class="check">
            <input type="checkbox" :checked="draft.master_force.tags?.includes(t)" @change="toggleMasterTag(t, ($event.target as HTMLInputElement).checked)" /> {{ tagDef(t)?.name ?? t }}
          </label>
        </div>
        <p v-if="draft.gear.attrs" class="small muted">有屬性加減的東西不在商店上架、AI 交易也不會賣。</p>
        <p v-else-if="draft.master_force" class="small muted">主人會強制裝備的東西沒有勾商店時不上架；勾了照樣在那種店賣。</p>
      </template>
    </FoldSet>

    <FoldSet v-if="draft.category === 'material'">
      <template #legend>打造材料</template>
      <div class="row checks">
        <label v-for="(m, id) in gearRules.materials" :key="id" class="check small">
          <input type="checkbox" :checked="draft.forge?.materials.includes(String(id))" @change="setForge(String(id), ($event.target as HTMLInputElement).checked)" /> <ContentIcon kind="material" :def="m" :size="14" /> {{ m.name }}（{{ m.tier }} 級）
        </label>
      </div>
      <p class="small muted">勾選後可以在鐵匠鋪、裁縫店或珠寶店拿它委託打造對應材料的裝備（第 2 級以上）。</p>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
