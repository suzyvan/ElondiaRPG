<script setup lang="ts">
import { computed, ref } from 'vue'
import { attrName } from '@/engine/data'
import { formatMoney } from '@/engine/money'
import { trainees, trainOptions } from '@/engine/perkActions'
import { trainDays } from '@/engine/perks'
import { craftLessons } from '@/engine/craftLessons'
import { craftRules } from '@/engine/data'
import { useGame } from '@/stores/game'
import FoldMenu from './ui/FoldMenu.vue'
import Hint from './ui/Hint.vue'

// 受訓：在這個設施，或向身邊的老師（固定 NPC 的 mentor）花錢、花時間學特質（data/rules/perks.json 的 train、mentor）
const game = useGame()
const s = computed(() => game.state!)
// 身上的缺陷可以在這裡克服的，排在前面；老師會教的接在後面
// 誰來學：主角或隊伍裡的夥伴（學工藝、學特質、克服缺陷都看這個人；夥伴第一次入隊時工藝都是 0 級）
const learner = ref('')
const learnerId = computed(() => (s.value.party.some((m) => m.id === learner.value) ? learner.value : (s.value.party.find((m) => m.isPlayer) ?? s.value.party[0]!).id))
const learnerChar = computed(() => s.value.party.find((m) => m.id === learnerId.value)!)
/** 這個人能不能受訓學特質（任務同行、跟著別人的隊伍不行） */
const canTrain = computed(() => trainees(s.value).some((m) => m.id === learnerId.value))
const list = computed(() => {
  void game.cell
  void s.value.time.minute
  return canTrain.value ? trainOptions(s.value, learnerChar.value.isPlayer ? undefined : learnerId.value) : []
})
// 隊伍裡每個能受訓的人在這裡能學的特質或克服的缺陷（換人學的時候選單還在；選單的數字算全隊）
const trainCounts = computed(() => {
  void game.cell
  void s.value.time.minute
  return trainees(s.value).map((m) => trainOptions(s.value, m.isPlayer ? undefined : m.id).length)
})
const anyTrain = computed(() => trainCounts.value.some((n) => n > 0))
// 學工藝（R21）：這間店教的工藝，店裡最多教到 Lv.2
const lessons = computed(() => {
  void game.cell
  void s.value.time.minute
  void s.value.money_cc
  return craftLessons(s.value, learnerId.value)
})
// 這一格的店有教工藝（換人學的時候選單還在）
const lessonCounts = computed(() => {
  void game.cell
  void s.value.time.minute
  void s.value.money_cc
  return trainees(s.value).map((m) => craftLessons(s.value, m.id).length)
})
const teaches = computed(() => lessonCounts.value.some((n) => n > 0))
// 選單的數字：隊伍裡任何人在這裡能學的總數（主角沒得學、夥伴有時不會是 0）
const badge = computed(() => [...trainCounts.value, ...lessonCounts.value].reduce((a, b) => a + b, 0))
const text = ref('')

function train(id: string) {
  void game.train(learnerChar.value.isPlayer ? id : `${id}@${learnerId.value}`, text.value)
  text.value = ''
}
</script>

<template>
  <FoldMenu v-if="anyTrain || teaches" id="place.train" class="train" icon="book" label="受訓" :detail="teaches ? '學工藝、學特質或克服缺陷' : '花錢、花時間學特質或克服缺陷'" :badge="badge">
    <p class="muted small intro">花錢、花時間受訓 <Hint text="主角或自己的夥伴都可以受訓（選誰來學）：能學什麼、等級門檻、檢定都看那個人，學費從隊伍的錢付。成功時有機會學會（也可以改寫說法爭取別的）；身上的缺陷成功就克服。身邊有老師時，也可以向老師學他會教的特質（好感夠才肯教，學費比較便宜、比較好學）。學費、時間、難度照特質的強度算，強的特質要角色等級夠、和老師或店主夠熟才肯教；每天練 8 小時。大成功學費打對折；失敗收一半；大失敗照收。" /></p>
    <label v-if="s.party.length > 1" class="row small who">誰來學
      <select v-model="learner">
        <option v-for="m in s.party" :key="m.id" :value="m.isPlayer ? '' : m.id">{{ m.name }}</option>
      </select>
    </label>
    <p v-if="teaches && canTrain && !lessons.length" class="muted small">這裡教的工藝，這個人都學到店裡教的上限（Lv.{{ craftRules.tuition.length }}）了。</p>
    <ul v-if="lessons.length" class="plain small">
      <li v-for="l in lessons" :key="l.craft" class="row">
        <div class="grow">
          <span class="tag">學工藝</span><b>{{ l.name }}</b> Lv.{{ l.from }} → Lv.{{ l.to }}
          <Hint :text="`付學費、花時間就學會，不用擲骰。店裡最多教到 Lv.${craftRules.tuition.length}，之後靠製作累積經驗升級。工藝 0 級時什麼都不能做。`" />
          <div class="muted">練 {{ l.hours }} 小時<template v-if="l.days > 1">（分 {{ l.days }} 天）</template>・學費 {{ formatMoney(l.price_cc) }}</div>
          <div v-if="l.blocked" class="muted">{{ l.blocked }}</div>
        </div>
        <button class="small" :disabled="game.judging || !!s.pendingAction || !!l.blocked" @click="game.learnCraft(l.craft, learnerId)">學</button>
      </li>
    </ul>
    <p v-if="!canTrain" class="muted small">{{ learnerChar.name }}不是自己的夥伴（任務同行、跟著別人的隊伍），不能在這裡受訓。</p>
    <p v-else-if="anyTrain && !list.length" class="muted small">{{ learnerChar.name }}在這裡沒有可以學的特質或可以克服的缺陷。</p>
    <input v-if="list.length" v-model="text" placeholder="怎麼學（選填，會寫進日誌）：例如每天天沒亮就跟著教官練" />
    <ul v-if="list.length" class="plain small">
      <li v-for="o in list" :key="o.def.id" class="row">
        <div class="grow">
          <span v-if="o.def.flaw" class="tag">克服缺陷</span><span v-if="o.mentor" class="tag">老師：{{ o.mentor.name }}</span><b>{{ o.def.name }}</b>：{{ o.def.desc }}
          <div class="muted">{{ attrName(o.train.attr) }}檢定 DC {{ o.train.dc }}・練 {{ o.train.hours }} 小時<template v-if="trainDays(o.train.hours).days > 1">（分 {{ trainDays(o.train.hours).days }} 天）</template>・學費 {{ formatMoney(o.train.price_cc) }}<template v-if="o.train.level">・要 Lv.{{ o.train.level }}<template v-if="o.train.affinity">、親密度 {{ o.train.affinity }}</template></template></div>
          <div v-if="o.blocked" class="muted">{{ o.blocked }}</div>
        </div>
        <button class="small" :disabled="game.judging || !!s.pendingAction || !!o.blocked || s.money_cc < o.train.price_cc" @click="train(o.def.id)">受訓</button>
      </li>
    </ul>
  </FoldMenu>
</template>

<style scoped>
.train input { width: 100%; }
.train ul { display: grid; gap: 4px; margin: 0; }
.train li { gap: 8px; align-items: center; }
.grow { flex: 1; }
.train p { margin: 0; }
.who { gap: 8px; align-items: center; }
.intro { display: flex; align-items: center; gap: 4px; }
</style>
