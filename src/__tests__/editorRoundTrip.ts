// 世界編輯器的來回測試（世界編輯器的介面整理 E5，紀錄見 docs/plan/roadmap/COMPLETED.md）：整理編輯器的畫面時不能改到資料。
// 每種編輯器掛上一批內建項目：剛打開時不能是「未儲存」，不改任何東西直接儲存，存進世界的內容要和快照一樣。
// 畫面整理前後都要通過；快照真的要變（改了資料的形狀）時，先確認是故意的再更新。
import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, type Component } from 'vue'
import { abilities, enemies, itemRules, landmarks, npcs, npcTags, perkRules, shopRules, slaveryRules, specialMaps, statuses, stories } from '@/engine/data'
import { gearRules } from '@/engine/gear'
import { conditionIds } from '@/engine/mods'
import { allMasterEvents } from '@/engine/masterEventMods'
import { travelEvents } from '@/engine/road'
import { tattooRules } from '@/engine/tattoos'
import { parasiteRules } from '@/engine/parasites'
import { useContent } from '@/stores/content'
import AbilityEditor from '@/components/content/AbilityEditor.vue'
import BindRulesEditor from '@/components/content/BindRulesEditor.vue'
import FamilyRulesEditor from '@/components/content/FamilyRulesEditor.vue'
import HomeRulesEditor from '@/components/content/HomeRulesEditor.vue'
import ConditionEditor from '@/components/content/ConditionEditor.vue'
import EnemyEditor from '@/components/content/EnemyEditor.vue'
import EventRulesEditor from '@/components/content/EventRulesEditor.vue'
import GearEditor from '@/components/content/GearEditor.vue'
import ItemEditor from '@/components/content/ItemEditor.vue'
import LandmarkEditor from '@/components/content/LandmarkEditor.vue'
import MarkEditor from '@/components/content/MarkEditor.vue'
import MarkRulesEditor from '@/components/content/MarkRulesEditor.vue'
import MasterEventEditor from '@/components/content/MasterEventEditor.vue'
import NpcEditor from '@/components/content/NpcEditor.vue'
import ParasiteEditor from '@/components/content/ParasiteEditor.vue'
import PerkEditor from '@/components/content/PerkEditor.vue'
import ShopEditor from '@/components/content/ShopEditor.vue'
import SpecialMapEditor from '@/components/content/SpecialMapEditor.vue'
import StatusEditor from '@/components/content/StatusEditor.vue'
import StoryEditor from '@/components/content/StoryEditor.vue'
import StoryNodeEditor from '@/components/content/StoryNodeEditor.vue'
import TattooEditor from '@/components/content/TattooEditor.vue'
import NpcTagEditor from '@/components/content/NpcTagEditor.vue'
import ClassEditor from '@/components/content/ClassEditor.vue'
import { editableClassIds } from '@/engine/classMods'
import TravelEventEditor from '@/components/content/TravelEventEditor.vue'

// 環境用 jsdom：happy-dom 的 <select> 不在畫面上之後也不會釋放它的 <option>（1500 個選項約 40 MB），
// 編輯器有很多長的下拉選單（物品、NPC、技能……），掛幾十次記憶體就用完了。

/** 挑出能涵蓋所有特徵的一小組（依特徵的種類貪婪地挑，最多 n 個；固定的，不是隨機） */
function cover<T>(list: T[], features: (x: T) => string[], n: number): T[] {
  const left = new Set(list.flatMap(features))
  const out: T[] = []
  while (left.size && out.length < n) {
    let best: T | undefined
    let bestN = 0
    for (const x of list) {
      const k = features(x).filter((f) => left.has(f)).length
      if (k > bestN) [best, bestN] = [x, k]
    }
    if (!best) break
    out.push(best)
    for (const f of features(best)) left.delete(f)
  }
  return out
}

/** 一個物件裡出現過的欄位路徑（陣列不分索引），當成「特徵」 */
function shape(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => shape(x, `${path}[]`))
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [`${path}.${k}`, ...shape(x, `${path}.${k}`), ...(k === 'type' && typeof x === 'string' ? [`${path}.type=${x}`] : [])])
  }
  return []
}

/** 平均挑 n 個（固定的，不是隨機） */
function sample<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list
  const step = list.length / n
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]!)
}

interface Case { editor: Component; keys: string[]; props: (key: string) => Record<string, unknown> }

export const CASES: Record<string, () => Case> = {
  enemies: () => ({ editor: EnemyEditor, keys: sample(Object.keys(enemies), 30), props: (id) => ({ id }) }),
  items: () => ({ editor: ItemEditor, keys: sample(itemRules.items.map((i) => i.name), 40), props: (name) => ({ name }) }),
  bases: () => ({ editor: GearEditor, keys: sample(Object.keys(gearRules.bases), 20), props: (id) => ({ id, kind: 'base' }) }),
  materials: () => ({ editor: GearEditor, keys: sample(Object.keys(gearRules.materials), 15), props: (id) => ({ id, kind: 'material' }) }),
  abilities: () => ({ editor: AbilityEditor, keys: sample(Object.keys(abilities), 30), props: (id) => ({ id }) }),
  statuses: () => ({ editor: StatusEditor, keys: sample(Object.keys(statuses), 25), props: (id) => ({ id }) }),
  conditions: () => ({ editor: ConditionEditor, keys: sample(conditionIds(), 15), props: (id) => ({ id }) }),
  perks: () => ({ editor: PerkEditor, keys: sample(perkRules.perks.map((p) => p.id), 30), props: (id) => ({ id }) }),
  npcTags: () => ({ editor: NpcTagEditor, keys: Object.keys(npcTags.tags), props: (id) => ({ id }) }),
  classes: () => ({ editor: ClassEditor, keys: editableClassIds(), props: (id) => ({ id }) }),
  tattoos: () => ({ editor: TattooEditor, keys: sample(Object.keys(tattooRules.templates), 10), props: (id) => ({ id }) }),
  parasites: () => ({ editor: ParasiteEditor, keys: Object.keys(parasiteRules.parasites), props: (id) => ({ id }) }),
  marks: () => ({ editor: MarkEditor, keys: sample(Object.keys(slaveryRules.contracts), 10), props: (id) => ({ id }) }),
  landmarks: () => ({ editor: LandmarkEditor, keys: sample(Object.keys(landmarks), 25), props: (id) => ({ id }) }),
  specialMaps: () => ({ editor: SpecialMapEditor, keys: sample(Object.keys(specialMaps), 10), props: (id) => ({ id }) }),
  shops: () => ({ editor: ShopEditor, keys: sample(Object.keys(shopRules.types), 15), props: (id) => ({ id }) }),
  events: () => ({ editor: TravelEventEditor, keys: sample(travelEvents.templates.map((t) => t.id), 30), props: (id) => ({ id }) }),
  // 懷孕、泌乳、苗床的事件：全部打開一次（抽樣很難抽到）
  pregnancyEvents: () => ({ editor: TravelEventEditor, keys: travelEvents.templates.filter((t) => ['pregnancy', 'lactation', 'brood'].includes(t.scope ?? '')).map((t) => t.id), props: (id) => ({ id }) }),
  // 家裡的事（家僕）：全部打開一次
  homeEvents: () => ({ editor: TravelEventEditor, keys: travelEvents.templates.filter((t) => t.scope === 'home').map((t) => t.id), props: (id) => ({ id }) }),
  masterEvents: () => ({ editor: MasterEventEditor, keys: sample(allMasterEvents().map((e) => e.def.id), 20), props: (id) => ({ id }) }),
  npcs: () => ({ editor: NpcEditor, keys: sample(npcs.map((n) => n.id), 30), props: (id) => ({ id }) }),
  stories: () => ({ editor: StoryEditor, keys: cover(stories, (d) => shape({ start: d.start, tags: d.tags, rewards: d.rewards, time_limit: d.time_limit }), 20).map((d) => d.id), props: (id) => ({ id }) }),
  rules: () => ({ editor: EventRulesEditor, keys: ['eventRules'], props: () => ({}) }),
  markRules: () => ({ editor: MarkRulesEditor, keys: ['markRules'], props: () => ({}) }),
  bindRules: () => ({ editor: BindRulesEditor, keys: ['bindRules'], props: () => ({}) }),
  family: () => ({ editor: FamilyRulesEditor, keys: ['family'], props: () => ({}) }),
  homes: () => ({ editor: HomeRulesEditor, keys: ['homes'], props: () => ({}) }),
}

const hash = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12)

interface EditorVm { dirty: boolean; save: () => void }

/** 掛上一個編輯器、不改就存；回傳「開啟時未儲存」或存進世界的內容的雜湊（每一項之後把世界清空） */
async function roundTrip(c: Case, key: string, content: ReturnType<typeof useContent>, pinia: ReturnType<typeof createPinia>): Promise<string> {
  const wrapper = mount(c.editor, { props: c.props(key), global: { plugins: [pinia] } })
  await nextTick()
  const vm = wrapper.vm as unknown as EditorVm
  let out: string
  if (vm.dirty) out = 'DIRTY_ON_OPEN'
  else {
    try {
      vm.save()
      out = hash(content.mods)
    } catch (e) {
      out = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  wrapper.unmount()
  content.resetAll()
  return out
}

/** 跑幾種編輯器的來回測試 */
export function roundTripSuite(...kinds: string[]) {
  describe('world editor round trip', () => {
    beforeEach(() => localStorage.clear())
    for (const kind of kinds) {
      it(`${kind}: opening and saving without changes keeps the data`, async () => {
        const c = CASES[kind]!()
        const pinia = createPinia()
        setActivePinia(pinia)
        const content = useContent()
        content.switchWorld(content.createWorld('來回測試'))
        const result: Record<string, string> = {}
        for (const key of c.keys) result[key] = await roundTrip(c, key, content, pinia)
        expect(Object.entries(result).filter(([, v]) => v === 'DIRTY_ON_OPEN').map(([k]) => k)).toEqual([])
        expect(result).toMatchSnapshot()
      }, 120_000)
    }
  })
}

/**
 * 任務點編輯器（特殊任務編輯器裡展開的那一塊）：任務點是用 v-model 直接改的，打開時不能動到它。
 * 挑一組涵蓋所有欄位與效果種類的任務點，掛上去之後內容要和原本一樣。
 */
export function storyNodeSuite() {
  describe('world editor round trip', () => {
    it('story nodes: opening a node does not change it', async () => {
      const nodes = cover(stories.flatMap((d) => d.nodes.map((n) => ({ id: `${d.id}/${n.id}`, n }))), (x) => shape(x.n), 60)
      const pinia = createPinia()
      setActivePinia(pinia)
      const changed: string[] = []
      for (const { id, n } of nodes) {
        const before = JSON.stringify(n)
        const model = JSON.parse(before)
        const wrapper = mount(StoryNodeEditor, { props: { modelValue: model, 'onUpdate:modelValue': () => changed.push(`${id}（換掉整個任務點）`) }, global: { plugins: [pinia] } })
        await nextTick()
        if (JSON.stringify(model) !== before) changed.push(id)
        wrapper.unmount()
      }
      expect(changed).toEqual([])
      expect(nodes.length).toBeGreaterThan(10)
    }, 120_000)
  })
}
