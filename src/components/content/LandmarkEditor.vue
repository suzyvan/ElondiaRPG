<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ATTR_IDS, attrName, landmarks, landmarkTypes, locationById, npcs as namedNpcs, perkRules, specialMaps, type LandmarkScene } from '@/engine/data'
import { settlementArea } from '@/engine/grid'
import { builtinLandmark, LANDMARK_EFFECTS, LANDMARK_LIMITS, landmarkTraining, landmarkUsage, type LandmarkMod } from '@/engine/landmarkMods'
import { builtinPerk } from '@/engine/mods'
import EffectsEditor from './EffectsEditor.vue'
import type { CellRef } from '@/engine/shopMods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import CellPicker from './CellPicker.vue'
import UsageNote from './UsageNote.vue'
import Hint from '../ui/Hint.vue'
import FlagInput from './FlagInput.vue'
import NameListInput from './NameListInput.vue'
import { wearChoices } from '@/engine/gear'
import EditorHeader from './EditorHeader.vue'
import RequiresEditor from './RequiresEditor.vue'
import CheckList from './CheckList.vue'
import { BODY_OPTIONS, CONTENT_TAG_OPTIONS } from './checks'
import FoldSet from './FoldSet.vue'
import HelpText from './HelpText.vue'

// 城鎮特色地標的編輯表單：名稱、圖示、說明、AI 的氛圍、類型、位置，以及開放條件、參訪、場景、探索、打工與受訓。
// 內建的不能換聚落、不能刪除
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ deleted: [] }>()
const content = useContent()
const game = useGame()

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
type Draft = LandmarkMod & { train: string[]; flagsText: string; flagsNoneText: string }
function current(): Draft {
  void content.version
  const l = clone(landmarks[props.id]!)
  return {
    scene: '', ...l, open: l.open ?? {}, ...(builtinLandmark(props.id) ? {} : { custom: true }),
    scenes: (l.scenes ?? []).map((sc) => ({ ...sc, requires: sc.requires ?? {}, cast: sc.cast ?? [], effects: sc.effects ?? [] })),
    train: landmarkTraining(props.id), flagsText: (l.open?.flags ?? []).join('、'), flagsNoneText: (l.open?.flags_none ?? []).join('、'),
  }
}
const draft = ref<Draft>(current())
const saved = ref(JSON.stringify(draft.value))
const picking = ref(false)
function reset() {
  draft.value = current()
  saved.value = JSON.stringify(draft.value)
  picking.value = false
}
watch(() => props.id, reset)
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const builtin = computed(() => !!builtinLandmark(props.id))
const edited = computed(() => builtin.value && !!content.mods.landmarks?.[props.id])
const usage = computed(() => {
  void content.version
  return landmarkUsage(props.id)
})
const typeList = Object.entries(landmarkTypes).map(([k, t]) => [k, t.name] as const)

function placeText(r: CellRef) {
  return `${locationById(r.area.split('/')[0]!).name}・${settlementArea(r.area, false)?.name ?? r.area}（${r.x}, ${r.y}）`
}
function toggleType(t: string, on: boolean) {
  const set = new Set(draft.value.types)
  if (on) set.add(t)
  else set.delete(t)
  draft.value.types = [...set]
}
function pick(r: CellRef | null) {
  if (!r) return
  draft.value.at = r
  draft.value.location = r.area.split('/')[0]!
  picking.value = false
}
// 受訓：有受訓設定的特質（種族天賦除外）
const trainPerks = computed(() => {
  void content.version
  return perkRules.perks.filter((p) => !p.race && (p.train ?? builtinPerk(p.id)?.train))
})
function toggleTrain(id: string, on: boolean) {
  const set = new Set(draft.value.train)
  if (on) set.add(id)
  else set.delete(id)
  draft.value.train = [...set]
}
const open = computed(() => draft.value.open!)
const splitFlags = (t: string) => t.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean)
function toggleVisit(on: boolean) {
  if (on) draft.value.visit = { title: '參訪', hours: 0.5, effects: [] }
  else delete draft.value.visit
}
// 場景
function addScene() {
  (draft.value.scenes ??= []).push({ title: '新的場景', scene: '', hours: 2, requires: {}, cast: [], effects: [] })
}
function removeScene(i: number) {
  draft.value.scenes!.splice(i, 1)
}
// 內部：同一個聚落的固定特殊地圖
const interiors = computed(() => {
  void content.version
  return Object.values(specialMaps).filter((m) => m.grid?.length && m.location === draft.value.location)
})
function setSpot(sc: LandmarkScene, k: 'x' | 'y', v: string) {
  if (v === '') {
    delete sc.spot
    return
  }
  sc.spot = { ...(sc.spot ?? { x: 0, y: 0 }), [k]: Math.max(0, Math.floor(Number(v) || 0)) }
}
function toggleExplore(on: boolean) {
  if (on) draft.value.explore = { title: '四處探索', attr: 'int', dc: 12, hours: 2, effects: [{ type: 'money', amount: 30 }] }
  else delete draft.value.explore
}
function toggleWork(on: boolean) {
  if (on) draft.value.work = { attr: 'cha', dc: 12, rate_cc: 3, desc: '在這裡幫忙。' }
  else delete draft.value.work
}
function save() {
  try {
    const { train, flagsText, flagsNoneText, ...m } = draft.value
    m.open = { ...m.open, flags: splitFlags(flagsText), flags_none: splitFlags(flagsNoneText) }
    const before = (JSON.parse(saved.value) as Draft).train
    content.saveLandmark(props.id, m)
    if (JSON.stringify([...train].sort()) !== JSON.stringify([...before].sort())) content.setShopTraining(props.id, train)
    reset()
    game.flash(`已儲存「${landmarks[props.id]?.name}」`)
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
function restore() {
  if (!confirm(`把「${draft.value.name}」恢復成內建的樣子？（位置也回到原處）`)) return
  content.restoreLandmark(props.id)
  reset()
}
function remove() {
  if (!confirm(`刪除自建的地標「${draft.value.name}」？地圖上的格子會變回道路。`)) return
  try {
    content.deleteLandmark(props.id)
    emit('deleted')
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
const wearOptions = computed(() => wearChoices())
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="`${draft.emoji} ${draft.name}`" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty" :usage="usage"
      @save="save" @discard="reset" @restore="restore" @remove="remove"
    />
    <p class="small muted">id：{{ id }}。地標是聚落地圖上的一格：特殊任務的任務點、固定 NPC 的站點、公會委託的標的都可以指定它，生成的居民也會依類型聚到這裡。{{ builtin ? '內建的地標只能在同一個聚落裡移動、不能刪除。' : '' }}</p>
    <UsageNote :usage="usage" :deletable="!builtin" />
    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>名稱 <input v-model="draft.name" :maxlength="LANDMARK_LIMITS.name_chars" /></label>
        <label>圖示 <input v-model="draft.emoji" maxlength="8" /></label>
      </div>
      <label class="block"><span>說明 <Hint text="站在這裡時顯示。" /></span><textarea v-model="draft.desc" rows="2" :maxlength="LANDMARK_LIMITS.desc_chars" /></label>
      <label class="block"><span>氛圍（選填） <Hint text="站在這裡行動時交給 AI 描寫場景。" /></span><textarea v-model="draft.scene" rows="2" :maxlength="LANDMARK_LIMITS.scene_chars" /></label>
      <div class="row checks small">
        <span class="muted">類型（最多 {{ LANDMARK_LIMITS.types }} 種） <Hint text="決定聚到這裡的居民與公會委託。" />：</span>
        <label v-for="[k, n] in typeList" :key="k" class="check">
          <input type="checkbox" :checked="draft.types.includes(k)" :disabled="!draft.types.includes(k) && draft.types.length >= LANDMARK_LIMITS.types" @change="toggleType(k, ($event.target as HTMLInputElement).checked)" /> {{ n }}
        </label>
      </div>
    </FoldSet>
    <FoldSet filled>
      <template #legend>位置</template>
      <div class="row small">
        <span>{{ draft.at.area ? placeText(draft.at) : '還沒選' }}</span>
        <button class="small" @click="picking = !picking">{{ picking ? '收起' : builtin ? '移動' : '選位置' }}</button>
      </div>
      <p class="small muted">{{ builtin ? '在同一個聚落裡搬到一格空地（道路），可以換區塊。' : '選聚落與區塊，點一格空地（道路）。' }}舊存檔讀進來時地圖會跟著變。</p>
      <CellPicker v-if="picking" :model-value="draft.at.area ? draft.at : null" :location="draft.location" :lock-location="builtin" :marker="draft.emoji" :self="id" @update:model-value="pick" />
    </FoldSet>
    <FoldSet>
      <template #legend>開放的條件</template>
      <p class="small muted">不開放時不能參訪、探索、打工與受訓（公會委託照樣可以做）。</p>
      <div class="grid">
        <label>時段
          <select v-model="open.hours">
            <option :value="undefined">任何時候</option>
            <option value="day">只在白天</option>
            <option value="night">只在夜裡</option>
          </select>
        </label>
        <label>至少要有的聲望（這裡的勢力） <input v-model.number="open.min_reputation" type="number" :min="LANDMARK_LIMITS.reputation[0]" :max="LANDMARK_LIMITS.reputation[1]" /></label>
      </div>
      <label class="check small"><input v-model="open.official" type="checkbox" /> 官方場所 <Hint text="逃亡奴隸不能用。" /></label>
      <label class="check small"><input v-model="open.adult" type="checkbox" /> 成人向的場所 <Hint text="不當委託地點；內容編輯器的篩選用。" /></label>
      <RequiresEditor
        :model-value="{ flags: splitFlags(draft.flagsText), flags_none: splitFlags(draft.flagsNoneText) }" label="開放的條件" placeholder="全部成立才開放" :extras="false"
        @update:model-value="(v) => { draft.flagsText = (v.flags ?? []).join('、'); draft.flagsNoneText = (v.flags_none ?? []).join('、') }"
      />
      <label class="check small"><input v-model="open.hidden" type="checkbox" /> 旗標的條件不成立時不顯示 <Hint text="地圖上看起來是普通的道路，條件成立後才出現（例如完成任務後才開幕的店、秘密俱樂部）。要有旗標的條件才有效。" /></label>
    </FoldSet>
    <FoldSet>
      <template #legend>參訪</template>
      <label class="check small"><input type="checkbox" :checked="!!draft.visit" @change="toggleVisit(($event.target as HTMLInputElement).checked)" /> 可以參訪 <Hint text="花錢或時間，得到效果；不用檢定。" /></label>
      <template v-if="draft.visit">
        <div class="grid">
          <label>名稱 <input v-model="draft.visit.title" :maxlength="LANDMARK_LIMITS.title_chars" /></label>
          <label>花費（白鸛） <input v-model.number="draft.visit.money_cc" type="number" min="0" /></label>
          <label>時數 <input v-model.number="draft.visit.hours" type="number" step="0.5" :min="LANDMARK_LIMITS.hours[0]" :max="LANDMARK_LIMITS.hours[1]" /></label>
          <label>隔幾天能再來 <input v-model.number="draft.visit.cooldown_days" type="number" :min="LANDMARK_LIMITS.cooldown[0]" :max="LANDMARK_LIMITS.cooldown[1]" placeholder="1" /></label>
        </div>
        <label class="block">說明 <input v-model="draft.visit.desc" :maxlength="LANDMARK_LIMITS.desc_chars" /></label>
        <div class="small">效果（最多 {{ LANDMARK_LIMITS.effects }} 個）：<EffectsEditor v-model="draft.visit.effects" :types="LANDMARK_EFFECTS" /></div>
      </template>
    </FoldSet>
    <FoldSet>
      <template #legend>場景（最多 {{ LANDMARK_LIMITS.scenes }} 個）</template>
      <label class="small">內部（特殊地圖） <Hint text="同一個聚落的固定特殊地圖：地標格變成入口，從地圖的出口離開時回到地標格；場景可以指定在裡面的哪一格。" />
        <select v-model="draft.interior">
          <option :value="undefined">沒有</option>
          <option v-for="m in interiors" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
      <label class="check small"><input type="checkbox" :checked="!!draft.auction" @change="($event.target as HTMLInputElement).checked ? (draft.auction = true) : delete draft.auction" /> 拍賣會（成人向：每天的拍品、出價、寄賣，規則在 lewd.json 的 auction）</label>
      <HelpText text="條件成立時可以選的固定場景（例如解鎖的特殊區域）：付錢、花時間，在場的人加好感，交給 AI 寫經過；成人向的場景照成人場景規則詳細描寫。預設每 3 天一次，場景之間共用。" />
      <div v-for="(sc, i) in draft.scenes ?? []" :key="i" class="scene-box">
        <div class="row"><b>場景 {{ i + 1 }}</b><span class="spacer" /><button class="small warn" @click="removeScene(i)" title="刪除這一項">✕</button></div>
        <div class="grid">
          <label>名稱 <input v-model="sc.title" :maxlength="LANDMARK_LIMITS.title_chars" /></label>
          <label>花費（白鸛） <input v-model.number="sc.money_cc" type="number" min="0" /></label>
          <label>時數 <input v-model.number="sc.hours" type="number" step="0.5" :min="LANDMARK_LIMITS.hours[0]" :max="LANDMARK_LIMITS.hours[1]" /></label>
          <label>隔幾天能再來 <input v-model.number="sc.cooldown_days" type="number" :min="LANDMARK_LIMITS.cooldown[0]" :max="LANDMARK_LIMITS.cooldown[1]" placeholder="3" /></label>
          <label>在場的人加好感 <input v-model.number="sc.affinity" type="number" :min="LANDMARK_LIMITS.affinity[0]" :max="LANDMARK_LIMITS.affinity[1]" /></label>
          <label class="check"><input v-model="sc.own_cooldown" type="checkbox" /> 自己算冷卻 <Hint text="不和這個地標的其他場景共用冷卻（例如咖啡廳的喝茶）。" /></label>
        </div>
        <div v-if="draft.interior" class="grid">
          <label>在內部的 x <input :value="sc.spot?.x" type="number" min="0" placeholder="外面" @input="setSpot(sc, 'x', ($event.target as HTMLInputElement).value)" /></label>
          <label>在內部的 y <input :value="sc.spot?.y" type="number" min="0" placeholder="外面" @input="setSpot(sc, 'y', ($event.target as HTMLInputElement).value)" /></label>
          <label>那一格的名稱 <input v-model="sc.spot_name" :maxlength="LANDMARK_LIMITS.title_chars" placeholder="例如：米米的小房間" /></label>
        </div>
        <label class="block">說明（玩家看的） <input v-model="sc.desc" :maxlength="LANDMARK_LIMITS.desc_chars" /></label>
        <label class="block"><span>經過（交給 AI） <Hint text="這段場景是什麼；{cast} 會換成在場的人。" /></span><textarea v-model="sc.scene" rows="3" :maxlength="LANDMARK_LIMITS.scene_text_chars" /></label>
        <CheckList v-model="sc.tags" label="內容標籤" :options="CONTENT_TAG_OPTIONS" />
        <CheckList v-model="sc.pc_body" label="只給這些主角" hint="依主角的體型；都不勾＝都可以。勾了女性形象、中性而沒勾男性形象時，設定打開「陽剛體型也能遇到『只給陰柔、中性』的成人內容」的玩家一樣會遇到。" :options="BODY_OPTIONS" />
        <div class="row small">限定穿著 <Hint text="主角要穿著這些才能選（例如打工的制服）。寫底材時任何一件同種的服裝都算。" /> <NameListInput v-model="sc.wear" :options="wearOptions" placeholder="底材或物品名稱" /></div>
        <RequiresEditor :model-value="sc.requires!" label="場景出現的條件" placeholder="全部成立才出現" :extras="false" any @update:model-value="(v) => (sc.requires = v)" />
        <div class="small">在場的固定 NPC（最多 {{ LANDMARK_LIMITS.cast }} 個） <Hint text="寫了旗標的人，旗標成立才在場；沒寫的人一定在場（死了或被抓走時這個場景不出現）。" /></div>
        <div v-for="(c, j) in sc.cast ?? []" :key="j" class="grid">
          <label>角色 <select v-model="c.npc"><option v-for="n in namedNpcs" :key="n.id" :value="n.id">{{ n.name }}</option></select></label>
          <label>這些旗標成立才在場 <FlagInput v-model="c.flags" /></label>
          <label class="check"><button class="small" @click="sc.cast!.splice(j, 1)" title="移除">✕</button></label>
        </div>
        <div class="row">
          <button class="small" :disabled="(sc.cast?.length ?? 0) >= LANDMARK_LIMITS.cast" @click="(sc.cast ??= []).push({ npc: namedNpcs[0]!.id })">＋ 加一個角色</button>
          <label class="small">有人不在場時代替的人 <input v-model="sc.extras" :maxlength="LANDMARK_LIMITS.extras_chars" placeholder="例如：其他不知名的魅魔" /></label>
        </div>
        <div class="small">效果（最多 {{ LANDMARK_LIMITS.effects }} 個）：<EffectsEditor v-model="sc.effects" :types="LANDMARK_EFFECTS" /></div>
      </div>
      <button class="small" :disabled="(draft.scenes?.length ?? 0) >= LANDMARK_LIMITS.scenes" @click="addScene">＋ 新增場景</button>
    </FoldSet>
    <FoldSet>
      <template #legend>探索</template>
      <label class="check small"><input type="checkbox" :checked="!!draft.explore" @change="toggleExplore(($event.target as HTMLInputElement).checked)" /> 可以探索 <Hint text="主動行動的檢定，成功得到效果。" /></label>
      <template v-if="draft.explore">
        <div class="grid">
          <label>名稱 <input v-model="draft.explore.title" :maxlength="LANDMARK_LIMITS.title_chars" /></label>
          <label>屬性 <select v-model="draft.explore.attr"><option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option></select></label>
          <label>DC <input v-model.number="draft.explore.dc" type="number" :min="LANDMARK_LIMITS.dc[0]" :max="LANDMARK_LIMITS.dc[1]" /></label>
          <label>時數 <input v-model.number="draft.explore.hours" type="number" step="0.5" :min="LANDMARK_LIMITS.hours[0]" :max="LANDMARK_LIMITS.hours[1]" /></label>
          <label>隔幾天能再試 <input v-model.number="draft.explore.cooldown_days" type="number" :min="LANDMARK_LIMITS.cooldown[0]" :max="LANDMARK_LIMITS.cooldown[1]" placeholder="7" /></label>
        </div>
        <label class="block">說明 <input v-model="draft.explore.desc" :maxlength="LANDMARK_LIMITS.desc_chars" /></label>
        <div class="small">成功的效果：<EffectsEditor v-model="draft.explore.effects" :types="LANDMARK_EFFECTS" /></div>
        <div class="small">大成功另外的效果：<EffectsEditor v-model="draft.explore.critical" :types="LANDMARK_EFFECTS" /></div>
      </template>
    </FoldSet>
    <FoldSet>
      <template #legend>打工</template>
      <label class="check small"><input type="checkbox" :checked="!!draft.work" @change="toggleWork(($event.target as HTMLInputElement).checked)" /> 可以在這裡打工 <Hint text="和設施的工作一樣。" /></label>
      <template v-if="draft.work">
        <div class="grid">
          <label>屬性 <select v-model="draft.work.attr"><option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option></select></label>
          <label>DC <input v-model.number="draft.work.dc" type="number" :min="LANDMARK_LIMITS.dc[0]" :max="LANDMARK_LIMITS.dc[1]" /></label>
          <label>時薪（白鸛） <input v-model.number="draft.work.rate_cc" type="number" :min="LANDMARK_LIMITS.rate_cc[0]" :max="LANDMARK_LIMITS.rate_cc[1]" /></label>
        </div>
        <label class="block">描述 <input v-model="draft.work.desc" :maxlength="LANDMARK_LIMITS.desc_chars" /></label>
      </template>
    </FoldSet>
    <FoldSet>
      <template #legend>受訓</template>
      <HelpText text="勾選的特質可以在這裡受訓（缺陷是克服）。受訓的價格、時數與檢定在「特質」頁設定，存在各特質上：恢復這個地標的預設不會改回受訓清單。" />
      <div class="row checks small">
        <label v-for="p in trainPerks" :key="p.id" class="check" :title="p.desc">
          <input type="checkbox" :checked="draft.train.includes(p.id)" @change="toggleTrain(p.id, ($event.target as HTMLInputElement).checked)" />
          {{ p.flaw ? '⚠️' : '' }}{{ p.name }}
        </label>
      </div>
    </FoldSet>
  </div>
</template>

<style scoped src="./editor.css"></style>
<style scoped>
.scene-box { display: grid; gap: 6px; border: 1px dashed var(--border); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
</style>
