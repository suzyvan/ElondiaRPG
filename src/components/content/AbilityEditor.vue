<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { abilities, ATTR_IDS, attrName, className, damageTypeName, damageTypes, statuses, type ApplyDef, type AttrId, type DamagePart } from '@/engine/data'
import {
  ABILITY_RESOLVES, ABILITY_TARGETS, ABILITY_TYPES, abilityClasses, builtinAbility, type AbilityMod,
} from '@/engine/mods'
import { useContent } from '@/stores/content'
import { useGame } from '@/stores/game'
import UsageNote from './UsageNote.vue'
import Hint from '../ui/Hint.vue'
import ContentIcon from '../icons/ContentIcon.vue'
import { abilityGlyph, abilityGlyphName } from '../icons/abilityArt'
import EditorHeader from './EditorHeader.vue'
import FoldSet from './FoldSet.vue'

// 能力（技能、法術、戲法）的編輯表單：存檔前是草稿，按「儲存」才套用
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ deleted: [] }>()
const content = useContent()
const game = useGame()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
function current(): AbilityMod {
  const a = clone(content.mods.abilities[props.id] ?? (abilities[props.id] as AbilityMod))
  a.heal ??= {}
  a.shield ??= {}
  a.uses ??= {}
  a.upcast ??= {}
  return a
}
// 空的 heal、shield、uses、upcast 不算修改
const snap = (a: AbilityMod) => JSON.stringify(a, (k, v) => (['heal', 'shield', 'uses', 'upcast'].includes(k) && v && !Object.keys(v).length ? undefined : v))
const draft = ref<AbilityMod>(current())
const saved = ref(snap(draft.value))
watch(() => props.id, () => {
  draft.value = current()
  saved.value = snap(draft.value)
})
const dirty = computed(() => snap(draft.value) !== saved.value)
const builtin = computed(() => !!builtinAbility(props.id))
const edited = computed(() => builtin.value && !!content.mods.abilities[props.id])

// ---- 選項 ----
const damageIds = damageTypes.types.map((t) => t.id)
// 自建的狀態儲存之後也要列進來
const statusList = computed(() => {
  void content.version
  return Object.entries(statuses).map(([id, s]) => ({ id, ...s }))
})
const classList = abilityClasses()
const TO: Record<NonNullable<ApplyDef['to']>, string> = { target: '目標', self: '自己', allies: '所有隊友', enemies: '所有敵人' }
const ON: Record<NonNullable<ApplyDef['on']>, string> = { hit: '命中時', fail: '豁免失敗時', always: '一定' }
const usage = computed(() => {
  void content.version
  return content.usageOf('ability', props.id)
})

// ---- 慾望戰鬥（docs/COMBAT_SYSTEM.md 第 8.5 節） ----
const lustGain = computed({
  get: () => draft.value.lust_gain?.flat,
  set: (v: number | undefined) => { if (v) draft.value.lust_gain = { flat: v }; else delete draft.value.lust_gain },
})
const transferMode = computed({
  get: () => draft.value.lust_transfer?.mode ?? '',
  set: (v: string) => {
    if (v === 'spread') draft.value.lust_transfer = { mode: 'spread', ratio: 0.3, shield_per: 5 }
    else if (v === 'take') draft.value.lust_transfer = { mode: 'take', amount: 20 }
    else delete draft.value.lust_transfer
  },
})
const burstOn = computed({
  get: () => !!draft.value.burst,
  set: (v: boolean) => { if (v) draft.value.burst = { mult: 0.5, type: 'fire' }; else delete draft.value.burst },
})
const burstKind = computed({
  get: () => (draft.value.burst?.heal ? 'heal' : draft.value.burst?.type ?? 'fire'),
  set: (v: string) => {
    const b = draft.value.burst!
    if (v === 'heal') { b.heal = true; delete b.type } else { delete b.heal; b.type = v }
  },
})
const requiresPct = computed({
  get: () => (draft.value.requires_lust ? Math.round(draft.value.requires_lust * 100) : undefined),
  set: (v: number | undefined) => { if (v) draft.value.requires_lust = v / 100; else delete draft.value.requires_lust },
})
function ifLustPct(a: ApplyDef): number | undefined {
  return a.if_lust ? Math.round(a.if_lust * 100) : undefined
}
function setIfLust(a: ApplyDef, v: string) {
  const n = Number(v)
  if (n > 0) a.if_lust = n / 100
  else delete a.if_lust
}

function toggleClass(c: string, on: boolean) {
  const set = new Set(draft.value.classes)
  if (on) set.add(c)
  else set.delete(c)
  draft.value.classes = [...set]
}
function addDamage() {
  ;(draft.value.damage ??= []).push({ dice: '1d6', type: 'slashing' })
}
function setDamageSource(d: DamagePart, weapon: boolean) {
  if (weapon) {
    d.weapon = true
    delete d.dice
  } else {
    delete d.weapon
    d.dice ??= '1d6'
  }
}
function addApply() {
  ;(draft.value.apply ??= []).push({ status: statusList.value[0]!.id, turns: 2 })
}
function setScale(d: DamagePart, dice: string) {
  if (dice) d.scale = { dice, per: d.scale?.per ?? 4 }
  else delete d.scale
}

function save() {
  try {
    content.saveAbility(props.id, draft.value)
    draft.value = current()
    saved.value = snap(draft.value)
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
  content.restoreAbility(props.id)
  draft.value = current()
  saved.value = snap(draft.value)
}
function remove() {
  if (!confirm(`刪除「${draft.value.name}」？`)) return
  try {
    content.deleteAbility(props.id)
    emit('deleted')
  } catch (e) {
    game.error = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="editor">
    <EditorHeader
      :title="draft.name || '（未命名）'" :kind="builtin ? 'builtin' : 'custom'" :edited="edited" :dirty="dirty" :usage="usage"
      @save="save" @discard="discard" @restore="restore" @remove="remove"
    />
    <p class="small muted">id：{{ id }}</p>
    <UsageNote :usage="usage" :deletable="!builtin" />

    <FoldSet>
      <template #legend>基本</template>
      <div class="grid">
        <label>名稱 <input v-model="draft.name" maxlength="16" /></label>
        <label>種類
          <select v-model="draft.type">
            <option v-for="(n, k) in ABILITY_TYPES" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label v-if="draft.type === 'skill'">幾級可以學 <input v-model.number="draft.unlock" type="number" min="1" max="20" /></label>
        <label v-if="draft.type === 'spell'">環數 <input v-model.number="draft.circle" type="number" min="1" max="9" /></label>
        <label>行動點 <input v-model.number="draft.ap" type="number" min="0" max="12" :placeholder="draft.type === 'spell' ? '依環數' : draft.type === 'cantrip' ? '0' : ''" /></label>
        <label><span>屬性 <Hint text="用來算命中、傷害與 DC。" /></span>
          <select :value="draft.attr ?? ''" @change="draft.attr = (($event.target as HTMLSelectElement).value || undefined) as AttrId | 'casting' | undefined">
            <option value="">（不用）</option>
            <option value="casting">施法屬性（依職業）</option>
            <option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option>
          </select>
        </label>
        <label>額外仇恨 <input v-model.number="draft.threat" type="number" min="-50" max="50" /></label>
      </div>
      <div class="row checks small">
        <span>誰可以學：</span>
        <label v-for="c in classList" :key="c" class="check">
          <input type="checkbox" :checked="draft.classes.includes(c)" @change="toggleClass(c, ($event.target as HTMLInputElement).checked)" />
          {{ c === 'monster' ? '怪物' : c === 'lewd' ? '色情技能（不分職業）' : className(c) }}
        </label>
      </div>
      <p class="small muted">技能依等級學；法術要有那一環的法術環，花一個法術環；戲法不花行動點、每回合一次。怪物不能用法術。</p>
      <div class="block icon-row">
        <span>圖示</span>
        <div class="row">
          <ContentIcon kind="ability" :def="draft" :size="36" /><ContentIcon kind="ability" :def="draft" :size="20" />
          <span class="small muted">外框依種類、中間的圖與顏色依屬性（{{ abilityGlyphName(abilityGlyph(draft)) }}）自動決定；暫時不能上傳。</span>
          <Hint text="屬性：第一個寫了傷害屬性的傷害；只有武器傷害的算「武器」；沒有傷害的依治療、護盾，或對敵人（削弱）、對自己與隊友（強化）。" />
        </div>
      </div>
    </FoldSet>

    <FoldSet filled>
      <template #legend>目標與判定</template>
      <div class="grid">
        <label>目標
          <select v-model="draft.target">
            <option v-for="(n, k) in ABILITY_TARGETS" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label v-if="draft.target === 'random_enemies'">次數 <input v-model.number="draft.count" type="number" min="1" max="10" /></label>
        <label>判定
          <select v-model="draft.resolve">
            <option v-for="(n, k) in ABILITY_RESOLVES" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <template v-if="draft.resolve === 'save'">
          <label>目標豁免的屬性
            <select v-model="draft.save"><option v-for="a in ATTR_IDS" :key="a" :value="a">{{ attrName(a) }}</option></select>
          </label>
          <label>豁免成功時
            <select v-model="draft.on_save"><option value="half">傷害減半</option><option value="none">沒有傷害</option></select>
          </label>
        </template>
        <template v-if="draft.resolve === 'attack'">
          <label>命中修正 <input v-model.number="draft.hit" type="number" min="-10" max="10" /></label>
          <label>幸運一擊門檻降低 <input v-model.number="draft.crit" type="number" min="0" max="5" /></label>
        </template>
        <label>攻擊次數 <input v-model.number="draft.hits" type="number" min="1" max="6" placeholder="1" /></label>
        <label>傷害倍率 <input v-model.number="draft.mult" type="number" min="0.1" max="5" step="0.1" placeholder="1" /></label>
      </div>
      <div v-if="draft.resolve === 'attack'" class="row checks small">
        <label class="check"><input v-model="draft.adv" type="checkbox" /> 優勢（擲兩次取高）</label>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>傷害</template>
      <div v-for="(d, i) in draft.damage ?? []" :key="i" class="row small">
        <select :value="d.weapon ? 'weapon' : 'dice'" @change="setDamageSource(d, ($event.target as HTMLSelectElement).value === 'weapon')">
          <option value="weapon">武器傷害</option>
          <option value="dice">骰子</option>
        </select>
        <input v-if="!d.weapon" v-model="d.dice" class="num" placeholder="1d6" />
        <select :value="d.type ?? ''" @change="d.type = ($event.target as HTMLSelectElement).value || undefined">
          <option value="">（沿用武器）</option>
          <option v-for="t in damageIds" :key="t" :value="t">{{ damageTypeName(t) }}</option>
        </select>
        <label class="check"><input v-model="d.mod" type="checkbox" /> 加屬性調整值</label>
        <label v-if="d.type === 'lust'" class="check" title="目標的魅惑受傷倍率至少 ×0.5（對不死、構裝也有效）"><input v-model="d.pierce" type="checkbox" /> 穿透</label>
        <label>每 <input :value="d.scale?.per ?? ''" class="num" type="number" min="1" max="20" placeholder="4" @input="d.scale && (d.scale.per = Number(($event.target as HTMLInputElement).value) || 4)" /> 級多</label>
        <input :value="d.scale?.dice ?? ''" class="num" placeholder="（不加）" @change="setScale(d, ($event.target as HTMLInputElement).value.trim())" />
        <button class="small" @click="draft.damage!.splice(i, 1)" title="移除">✕</button>
      </div>
      <button class="small" @click="addDamage">＋ 傷害</button>
    </FoldSet>

    <FoldSet>
      <template #legend>治療與護盾</template>
      <div class="grid">
        <template v-if="draft.resolve === 'auto'">
          <label>治療（骰子）<input v-model="draft.heal!.dice" placeholder="1d8" /></label>
          <label>治療（固定）<input v-model.number="draft.heal!.flat" type="number" min="0" /></label>
          <label>護盾（暫時生命）<input v-model.number="draft.shield!.flat" type="number" min="0" /></label>
          <label>護盾（每級）<input v-model.number="draft.shield!.level" type="number" min="0" max="10" /></label>
        </template>
        <label>吸血（傷害的比例）<input v-model.number="draft.lifesteal" type="number" min="0" max="1" step="0.05" /></label>
        <label title="目標身上有奴隸印記時，傷害乘上這個數（驅奴術）">對奴隸的傷害 ×<input v-model.number="draft.vs_slave" type="number" min="0" max="4" step="0.25" /></label>
      </div>
      <p v-if="draft.resolve !== 'auto'" class="small muted">治療、護盾、移除負面狀態、回復法術環與直接擊倒只在結算方式是「必中」時有效。</p>
      <div v-if="draft.resolve === 'auto'" class="row checks small">
        <span>治療另外：</span>
        <label class="check"><input v-model="draft.heal!.mod" type="checkbox" /> 加屬性調整值</label>
        <label class="check"><input v-model="draft.heal!.level" type="checkbox" /> 加等級</label>
        <label class="check"><input v-model="draft.heal!.full" type="checkbox" /> 回滿</label>
      </div>
    </FoldSet>

    <FoldSet v-if="draft.type === 'spell'">
      <template #legend>升環 <Hint text="用比法術本身高的法術環施放時，每高一環多的效果（D&D 5e 的升環）。都不填時，用高環施放效果不變。說明文字要自己寫上。" /></template>
      <div class="grid">
        <label>傷害多擲 <input v-model="draft.upcast!.dice" placeholder="1d6" /></label>
        <label v-if="(draft.damage?.length ?? 0) > 1">加在第幾筆傷害 <input :value="(draft.upcast!.part ?? 0) + 1" type="number" min="1" :max="draft.damage!.length" @input="draft.upcast!.part = Math.max(0, Number(($event.target as HTMLInputElement).value) - 1) || undefined" /></label>
        <label>治療多擲 <input v-model="draft.upcast!.heal" placeholder="1d8" /></label>
        <label>治療多（固定）<input v-model.number="draft.upcast!.heal_flat" type="number" min="0" /></label>
        <label v-if="draft.target === 'random_enemies'">次數多 <input v-model.number="draft.upcast!.count" type="number" min="0" max="5" /></label>
        <label>攻擊次數多 <input v-model.number="draft.upcast!.hits" type="number" min="0" max="5" /></label>
        <label>臨時生命多 <input v-model.number="draft.upcast!.shield" type="number" min="0" /></label>
        <label><span>持續傷害多擲 <Hint text="施加的持續傷害、每回合攻擊的狀態（例如月華光束、靈體武器）每次多擲的骰子。" /></span><input v-model="draft.upcast!.status_dice" placeholder="1d10" /></label>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>狀態</template>
      <div v-for="(a, i) in draft.apply ?? []" :key="i" class="row small">
        <select v-model="a.status" class="grow">
          <option v-for="s in statusList" :key="s.id" :value="s.id">{{ s.kind === 'buff' ? '🟢' : '🔴' }} {{ s.name }}</option>
        </select>
        <input v-model.number="a.turns" class="num" type="number" min="1" max="20" /> 回合
        <select :value="a.to ?? 'target'" @change="a.to = ($event.target as HTMLSelectElement).value as ApplyDef['to']">
          <option v-for="(n, k) in TO" :key="k" :value="k">給{{ n }}</option>
        </select>
        <!-- 沒寫時依結算方式：命中骰是命中時、豁免是豁免失敗時、必中是一定 -->
        <select :value="a.on ?? (draft.resolve === 'attack' ? 'hit' : draft.resolve === 'save' ? 'fail' : 'always')" @change="a.on = ($event.target as HTMLSelectElement).value as ApplyDef['on']">
          <option v-for="(n, k) in ON" :key="k" :value="k">{{ n }}</option>
        </select>
        <select :value="a.save ?? ''" @change="a.save = (($event.target as HTMLSelectElement).value || undefined) as AttrId | undefined">
          <option value="">（不能豁免）</option>
          <option v-for="x in ATTR_IDS" :key="x" :value="x">{{ attrName(x) }}豁免</option>
        </select>
        <label title="目標的慾望達到上限的這個比例才套用">慾望 ≥ <input class="num" type="number" min="0" max="100" :value="ifLustPct(a)" placeholder="—" @input="setIfLust(a, ($event.target as HTMLInputElement).value)" />%</label>
        <label class="check" title="目標身上有奴隸印記才套用（驅奴術）"><input v-model="a.if_slave" type="checkbox" /> 只對奴隸</label>
        <label class="check" title="目標的等級比施放者低才套用（威壓）"><input v-model="a.if_weaker" type="checkbox" /> 只對等級低的</label>
        <button class="small" @click="draft.apply!.splice(i, 1)" title="移除">✕</button>
      </div>
      <button class="small" @click="addApply">＋ 狀態</button>
    </FoldSet>

    <FoldSet>
      <template #legend>慾望戰鬥 <Hint text="成人向（docs/COMBAT_SYSTEM.md 第 8.5 節）。魅惑傷害在上面的「傷害」選屬性「魅惑」。存檔規則「慾望戰鬥」關閉時，有這些欄位的能力不能用；「主角非自願」關掉時敵人不用。" /></template>
      <div class="grid">
        <label>目標的慾望 + <input v-model.number="lustGain" type="number" min="0" max="200" placeholder="—" /></label>
        <label>目標的慾望 − <input v-model.number="draft.lust_relief" type="number" min="0" max="200" placeholder="—" /></label>
        <label>消耗自己的慾望 <input v-model.number="draft.lust_cost" type="number" min="0" max="200" placeholder="—" /></label>
        <label>自己的慾望至少（%） <input v-model.number="requiresPct" type="number" min="0" max="100" placeholder="—" /></label>
        <label>給目標行動點 <input v-model.number="draft.ap_give" type="number" min="0" max="5" placeholder="—" /></label>
        <label>戰後曝露名聲 + <input v-model.number="draft.exposure" type="number" min="0" max="10" placeholder="—" /></label>
        <label>慾望在隊友之間移動
          <select v-model="transferMode">
            <option value="">（不移動）</option>
            <option value="spread">把自己的慾望分給其他友軍</option>
            <option value="take">從其他每位友軍吸過來</option>
          </select>
        </label>
        <template v-if="draft.lust_transfer?.mode === 'spread'">
          <label>分出的比例 <input v-model.number="draft.lust_transfer.ratio" type="number" min="0.05" max="1" step="0.05" /></label>
          <label>每幾點給 1 臨時生命 <input v-model.number="draft.lust_transfer.shield_per" type="number" min="0" max="50" placeholder="不給" /></label>
        </template>
        <template v-else-if="draft.lust_transfer?.mode === 'take'">
          <label>每人吸多少 <input v-model.number="draft.lust_transfer.amount" type="number" min="1" max="999" /></label>
          <label class="check" title="吸過來的慾望不會讓自己高潮，下一個自己的回合開始時全部消退"><input v-model="draft.lust_transfer.dump" type="checkbox" /> 下回合全部消退</label>
        </template>
      </div>
      <div class="row small">
        <label class="check"><input type="checkbox" :checked="!!draft.gamble" @change="($event.target as HTMLInputElement).checked ? (draft.gamble = { status: statusList[0]!.id, turns: 3, lust: 20 }) : delete draft.gamble" /> 賭局</label>
        <template v-if="draft.gamble">
          一半機會全體友軍得到
          <select v-model="draft.gamble.status"><option v-for="x in statusList" :key="x.id" :value="x.id">{{ x.name }}</option></select>
          <input v-model.number="draft.gamble.turns" type="number" min="1" max="20" class="num" /> 回合，否則全體友軍慾望 +
          <input v-model.number="draft.gamble.lust" type="number" min="0" max="200" class="num" />
        </template>
      </div>
      <div class="row small">
        <label class="check"><input v-model="burstOn" type="checkbox" /> 引爆 <Hint text="消耗全部的慾望，造成慾望 × 倍率 + 屬性調整值的傷害（或治療目標）；用了立刻結束回合，下一回合脫力。" /></label>
        <template v-if="draft.burst">
          倍率 <input v-model.number="draft.burst.mult" type="number" min="0.1" max="3" step="0.05" class="num" />
          <select v-model="burstKind">
            <option value="heal">治療</option>
            <option v-for="t in damageIds.filter((x) => x !== 'lust')" :key="t" :value="t">{{ damageTypeName(t) }}傷害</option>
          </select>
          慾望至少 <input class="num" type="number" min="0" max="100" :value="draft.burst.min_ratio ? Math.round(draft.burst.min_ratio * 100) : undefined" placeholder="—" @input="draft.burst.min_ratio = Number(($event.target as HTMLInputElement).value) / 100 || undefined" />%
        </template>
      </div>
    </FoldSet>

    <FoldSet>
      <template #legend>次數與其他</template>
      <div class="grid">
        <label>每回合幾次 <input v-model.number="draft.uses!.per_turn" type="number" min="0" max="10" placeholder="不限" /></label>
        <label>每場戰鬥幾次 <input v-model.number="draft.uses!.per_combat" type="number" min="0" max="10" placeholder="不限" /></label>
        <label>每次長休幾次 <input v-model.number="draft.uses!.per_rest" type="number" min="0" max="10" placeholder="不限" /></label>
        <label>獲得行動點 <input v-model.number="draft.ap_gain" type="number" min="0" max="10" /></label>
        <label>命中時獲得行動點 <input v-model.number="draft.ap_gain_on_hit" type="number" min="0" max="10" /></label>
        <label>目標生命值上限 <input v-model.number="draft.hp_limit" type="number" min="0" placeholder="不限" /></label>
      </div>
      <div class="row checks small">
        <label class="check"><input v-model="draft.concentration" type="checkbox" /> 需要專注</label>
        <template v-if="draft.resolve === 'auto'">
          <label class="check"><input v-model="draft.cleanse" type="checkbox" /> 移除目標的所有負面狀態</label>
          <label class="check"><input v-model="draft.recover_slot" type="checkbox" /> 回復一個法術環</label>
          <label class="check"><input v-model="draft.kill" type="checkbox" /> 直接擊倒 <Hint text="配合上面的「目標生命值上限」使用。" /></label>
        </template>
      </div>
    </FoldSet>

    <label class="block"><span>說明 <Hint text="玩家與 AI 看到的。" /></span><textarea v-model="draft.desc" rows="2" maxlength="200" /></label>
  </div>
</template>

<style scoped src="./editor.css"></style>
