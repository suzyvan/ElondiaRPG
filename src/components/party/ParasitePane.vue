<script setup lang="ts">
import { computed } from 'vue'
import type { Character } from '@/engine/types'
import { actionRules, attrName } from '@/engine/data'
import { parasiteDef, parasiteEffects, parasiteRules, parasitesOf, stageName, stageOf } from '@/engine/parasites'
import { flaresOn, triggerBlock } from '@/engine/parasiteEvents'
import { broodOf } from '@/engine/brood'
import { tagsAllowed } from '@/engine/content'
import { placeName } from '@/engine/tattoos'
import { useGame } from '@/stores/game'
import Hint from '../ui/Hint.vue'

// 寄生物（主角）：階段、侵蝕度、目前的被動效果；已馴服的可以主動觸發（每次長休之間一次）
const props = defineProps<{ member: Character }>()
const game = useGame()
const list = computed(() => parasitesOf(props.member).flatMap((p) => {
  const def = parasiteDef(p.id)
  return def ? [{ p, def }] : []
}))

function effectText(p: Parameters<typeof parasiteEffects>[0]): string {
  return parasiteEffects(p).map((e) => {
    const what = e.check.attrs?.length ? e.check.attrs.map(attrName).join('、') : e.check.kinds?.length ? e.check.kinds.map((k) => actionRules.kinds[k]?.name ?? k).join('、') : '檢定'
    return `${what} ${e.bonus > 0 ? '+' : ''}${e.bonus}`
  }).join('，')
}
const block = (id: string) => (game.state ? triggerBlock(game.state, id) : '')
// 苗床（蜂卵、觸手之種……）沒有「發作」：照時間長大、有自己的苗床事件，只有關掉「怪物的苗床」時才停
const brood = (p: { id: string }) => !!broodOf(p.id)
const quiet = (p: Parameters<typeof flaresOn>[1]) => !!game.state && (brood(p) ? !tagsAllowed(['monster_brood']) : !flaresOn(game.state, p))
</script>

<template>
  <div class="parasites">
    <p class="small muted">
      寄生物會依侵蝕度分成{{ parasiteRules.stages.map((s) => `「${s.name}」`).join('') }}幾個階段，發作時屈服就上升、抵抗成功就下降。
      <Hint text="解咒：到神殿（信仰檢定）或刻印師（智力檢定），侵蝕度越高越難、越貴；失敗時侵蝕度上升。完成寄生物自己的任務線可以馴服它。設定裡的「寄生發作的機率」可以調整、或關掉發作。" />
    </p>
    <article v-for="{ p, def } in list" :key="p.id" class="card">
      <h4>
        {{ def.name }}
        <span v-if="p.tamed" class="tag good">已馴服</span>
        <span v-else-if="p.dormant" class="tag">沉睡中</span>
        <span v-else class="tag bad">{{ stageName(p.corruption) }}</span>
      </h4>
      <p class="small">{{ def.desc }}</p>
      <template v-if="!p.tamed && !p.dormant">
        <div class="bar" :title="`侵蝕度 ${p.corruption}／100`">
          <span :style="{ width: `${p.corruption}%` }" />
          <i v-for="st in parasiteRules.stages.slice(1)" :key="st.min" :style="{ left: `${st.min}%` }" :title="st.name" />
        </div>
        <p class="small">侵蝕度 <b>{{ p.corruption }}</b>／100<template v-if="effectText(p)">・{{ effectText(p) }}</template></p>
      </template>
      <template v-if="!p.tamed && !p.dormant">
        <p v-if="brood(p) && quiet(p)" class="small muted">內容篩選關掉了「怪物的苗床」：苗床停止長大，也不會有苗床的事件；要拿掉就去解咒或取出。</p>
        <p v-else-if="brood(p)" class="small muted">苗床不會「發作」：它會隨時間長大，途中有苗床的事件，長到支配時產下；也可以去神殿、刻印師解咒或取出。</p>
        <p v-else-if="quiet(p)" class="small muted">發作已經關掉（內容篩選、主角的形象或存檔規則「寄生發作的機率」）：它就像一道詛咒，不會發作、侵蝕度也不增長，但被動效果還在；要拿掉就去解咒。</p>
      </template>
      <p v-if="p.dormant" class="small muted">被奴隸印記頂掉了，不會發作；可以到刻印師那裡紋回來。</p>
      <p v-else-if="p.tamed && p.stored" class="small muted">印記不在身上，可以到刻印師那裡紋回來。</p>
      <p v-if="p.covered" class="small muted">刻上時蓋掉了{{ placeName(p.covered.place) }}的「{{ p.covered.name }}」，可以到刻印師那裡紋回來。</p>
      <div v-if="p.tamed && def.tamed && member.isPlayer" class="row">
        <button class="small" :disabled="!!block(p.id) || game.judging" @click="game.triggerParasite(p.id)">主動喚醒</button>
        <span v-if="block(p.id)" class="small muted">{{ block(p.id) }}</span>
      </div>
      <p v-if="stageOf(p.corruption) >= 3 && !p.tamed && !p.dormant" class="small warn">它幾乎支配了你的身體，發作得更頻繁了。</p>
    </article>
    <p v-if="!list.length" class="muted small">身上沒有寄生物。</p>
  </div>
</template>

<style scoped>
.parasites { display: grid; gap: 10px; }
.card { border: 1px solid var(--line, #a88a5a); border-radius: 4px; padding: 8px 10px; display: grid; gap: 4px; }
.card h4 { margin: 0; display: flex; align-items: center; gap: 6px; }
.bar { position: relative; height: 8px; background: rgba(0, 0, 0, 0.12); border-radius: 4px; overflow: hidden; }
.bar span { position: absolute; inset: 0 auto 0 0; background: #c0466e; }
.bar i { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(0, 0, 0, 0.35); }
.warn { color: var(--danger); }
</style>
