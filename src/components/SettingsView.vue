<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFEAT_LOOT_NAME, defeatLootRule } from '@/engine/expedition'
import type { DefeatLoot, Difficulty } from '@/engine/types'
import { companionRules } from '@/engine/data'
import { CONTENT_TAGS, FILTER_TAGS } from '@/engine/content'
import { gearRules } from '@/engine/gear'
import type { StepPlace } from '@/engine/grid'
import mapsJson from '@data/world/maps.json'
import { useGame } from '@/stores/game'
import { AI_FEATURES, SOURCE_MAX, useSettings } from '@/stores/settings'
import AiToggles from './AiToggles.vue'
import ImageSettings from './ImageSettings.vue'
import RuleFields from './RuleFields.vue'
import { DIFFICULTY_DEFS, DIFFICULTY_IDS, difficultyOf, difficultySummary, RULE_DEFS, type NumericRule } from '@/engine/gameRules'
import ModelSourceEditor from './ModelSourceEditor.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'

const settings = useSettings()
// 走一格的時間：三種地方
const STEP_DEFAULT = mapsJson.generation.step_minutes
const STEP_PLACES: { id: StepPlace; name: string }[] = [{ id: 'settlement', name: '城鎮' }, { id: 'wild', name: '近郊' }, { id: 'dungeon', name: '冒險區域' }]
const game = useGame()
// 這個存檔的數值規則（沒有寫的是預設）
const saveRules = computed(() => Object.fromEntries((Object.keys(RULE_DEFS) as NumericRule[])
  .filter((k) => game.state?.options?.[k] !== undefined).map((k) => [k, game.state!.options![k]!])) as Partial<Record<NumericRule, number>>)
const source = ref(0)
function addSource() {
  const i = settings.addSource()
  if (i >= 0) source.value = i
}
function removeSource() {
  const s = settings.sources[source.value]
  if (!s) return
  const used = AI_FEATURES.filter((f) => settings.routes[f.id] === source.value).map((f) => f.name)
  const first = settings.sources[source.value === 0 ? 1 : 0]!.name
  if (!confirm(`刪除「${s.name}」？${used.length ? `用它的功能（${used.join('、')}）會改用「${first}」。` : ''}`)) return
  settings.removeSource(source.value)
  source.value = Math.min(source.value, settings.sources.length - 1)
}
// 設定分成幾個頁籤（記住上次看的那一頁）
const PAGES = [
  { id: 'models', label: '模型', icon: 'settings' },
  { id: 'images', label: '圖像', icon: 'image' },
  { id: 'narration', label: '敘事與判定', icon: 'sparkles' },
  { id: 'rules', label: '遊戲規則', icon: 'd20' },
  { id: 'display', label: '畫面', icon: 'eye' },
  { id: 'save', label: '存檔', icon: 'save' },
] as const
type PageId = (typeof PAGES)[number]['id']
const PAGE_KEY = 'elondia.settingsPage'
function savedPage(): PageId {
  try {
    const v = localStorage.getItem(PAGE_KEY)
    return PAGES.some((p) => p.id === v) ? (v as PageId) : 'models'
  } catch {
    return 'models'
  }
}
const page = ref<PageId>(savedPage())
function openPage(id: PageId) {
  page.value = id
  try {
    localStorage.setItem(PAGE_KEY, id)
  } catch {
    // 無法記住時下次從第一頁開始
  }
}

function doReset() {
  if (confirm('確定要刪除目前的存檔？此動作無法復原。')) game.reset()
}
</script>

<template>
  <nav class="row tabs pages">
    <button v-for="p in PAGES" :key="p.id" :class="{ active: page === p.id }" @click="openPage(p.id)"><GameIcon :name="p.icon" :size="15" />{{ p.label }}</button>
  </nav>

  <template v-if="page === 'models'">
    <section class="panel">
      <h2 class="head"><GameIcon name="settings" :size="20" />模型來源
        <Hint text="可以設定多個模型來源（預設三個，最多八個；例如一個擅長寫作的模型、一個便宜的模型），再在下方指定每個功能用哪一個。API key 只會存在這個瀏覽器的 localStorage，請求直接從瀏覽器送往你選擇的服務。請勿在共用電腦上保存 key。" />
      </h2>
      <nav class="row tabs">
        <button v-for="(s, i) in settings.sources" :key="i" :class="{ active: source === i }" @click="source = i">
          <span class="dot" :class="{ ready: settings.sourceReady(i) }" :title="settings.sourceReady(i) ? '已設定' : '未設定'" />{{ s.name }}
        </button>
        <button v-if="settings.sources.length < SOURCE_MAX" class="ghost" title="新增一個來源（先複製來源 1 的服務與 key）" @click="addSource">＋ 新增來源</button>
      </nav>
      <ModelSourceEditor :key="`${source}-${settings.sources.length}`" :index="source" />
      <div v-if="settings.sources.length > 1" class="row">
        <button class="ghost small danger" @click="removeSource">🗑️ 刪除「{{ settings.sources[source]?.name }}」</button>
      </div>
    </section>

    <section class="panel">
      <h2 class="head"><GameIcon name="shuffle" :size="20" />功能分配
        <Hint text="只有「敘事正文」與「成人場景正文」會寫出日誌裡的正文，適合用寫作能力好的模型；其他功能只輸出 JSON，可以改用便宜、快速的模型。帶親密場景的日誌一律交給「成人場景正文」：請確認那個來源的使用政策允許此類內容，不允許時模型可能拒絕生成。" />
      </h2>
      <table class="routes small">
        <tbody>
          <tr v-for="f in AI_FEATURES" :key="f.id">
            <td class="name"><GameIcon :name="f.prose ? 'edit' : 'code'" :size="14" :title="f.prose ? '寫正文' : '只輸出 JSON'" /> {{ f.name }}</td>
            <td>
              <select v-model.number="settings.routes[f.id]">
                <option v-for="(s, i) in settings.sources" :key="i" :value="i">{{ s.name }}{{ settings.sourceReady(i) ? '' : '（未設定）' }}</option>
              </select>
            </td>
            <td class="muted">{{ f.desc }}</td>
          </tr>
        </tbody>
      </table>
      <label class="check small" :class="{ muted: settings.sourceIndex('judge') !== settings.sourceIndex('narration') }">
        <input v-model="settings.judgeWritesNarrative" type="checkbox" :disabled="settings.sourceIndex('judge') !== settings.sourceIndex('narration')" />
        判定時順便寫出經過 <Hint text="判定與敘事正文同一個來源時才有效；省一次呼叫，但經過不是用敘事正文的提示詞寫的。" />
      </label>
      <p class="small note">
        <template v-if="settings.splitJudgeNarrative()">
          主動行動：先由「{{ settings.sourceFor('judge').name }}」判定（只回傳 JSON），再由「{{ settings.sourceFor('narration').name }}」用敘事正文的提示詞寫出經過（每次兩次呼叫）。
        </template>
        <template v-else>主動行動：由「{{ settings.sourceFor('judge').name }}」判定時順便寫出經過（每次一次呼叫）。</template>
      </p>
    </section>

  </template>

  <ImageSettings v-if="page === 'images'" />

  <template v-if="page === 'narration'">

    <section class="panel">
      <h2 class="head"><GameIcon name="d20" :size="20" />AI 判定與描述
        <Hint text="遊戲裡所有會呼叫 AI 的開關都在這裡；冒險頁面的「AI」按鈕打開的泡泡視窗也是同一組開關。每一項的「?」寫出會影響哪些行為。" />
      </h2>
      <div class="form">
        <AiToggles kinds />
        <p v-if="!settings.ready()" class="small warn-line">
          <GameIcon name="warning" :size="14" /> 還沒有設定好的模型來源，所有 AI 功能都不會呼叫：到<a href="#" @click.prevent="openPage('models')">模型來源</a>填寫服務、模型與 API key。
        </p>
        <p v-else-if="settings.judgesWithAi()" class="small muted">
          擲骰的行動由「{{ settings.sourceFor('judge').name }}」判定，經過{{ settings.splitJudgeNarrative() ? `由「${settings.sourceFor('narration').name}」寫` : '在判定時順便寫出' }}；各功能用哪個來源在<a href="#" @click.prevent="openPage('models')">模型來源</a>的「功能分配」。
        </p>
      </div>
    </section>

    <section class="panel">
      <h2 class="head"><GameIcon name="book" :size="20" />AI 輸出與內容</h2>
      <div class="form">
        <label>
          AI 的輸出語言
          <select v-model="settings.language">
            <option value="zh-Hant">繁體中文</option>
            <option value="zh-Hans">简体中文</option>
          </select>
        </label>
        <label>
          <span class="lab">世界書注入字數上限 <Hint text="文風、世界書條目與其他提示詞在畫面上方的「提示詞」頁籤調整，也可以在那裡預覽送出的內容。" /></span>
          <input v-model.number="settings.loreBudget" type="number" min="2000" step="1000" style="width: 140px" />
        </label>
        <div class="row checks">
          <span class="lab">內容篩選 <Hint text="取消勾選的內容不會出現：帶這個標籤的特殊任務不會開放、任務裡帶這個標籤的選項不會出現。進行中的任務不受影響。" /></span>
          <label v-for="t in FILTER_TAGS" :key="t" class="check" :title="CONTENT_TAGS[t].desc">
            <input v-model="settings.contentFilters[t]" type="checkbox" /> {{ CONTENT_TAGS[t].name }}
          </label>
        </div>
        <label>
          <span class="lab">戰敗色情事件 <Hint text="戰敗後敵人（發情的怪物、惡人……）起意的事件。關閉「主角非自願」時也不會發生。" /></span>
          <select v-model="settings.defeatAdult">
            <option value="all">開啟</option>
            <option value="not_masc">男性形象的主角不發生</option>
            <option value="off">關閉</option>
          </select>
        </label>
        <label>
          <span class="lab">隊友的戰敗色情事件 <Hint text="主角不會遇到戰敗色情事件時（上面設成關閉或「男性形象的主角不發生」、或關閉了「主角非自願」），改由還在場的隊友遇到：符合這裡設定的隊友裡魅力最高的那位。玩家替那位隊友選擇反應（虛與委蛇、掙扎、咬牙撐過，或自己描述），由隊友擲骰，結果也記在隊友身上。無法戰鬥的隊員戰敗時已經跑開了，不算。主角會遇到時照舊是主角。" /></span>
          <select v-model="settings.defeatCompanion">
            <option value="all">開啟</option>
            <option value="not_masc">男性形象的隊友不發生</option>
            <option value="off">關閉</option>
          </select>
        </label>
        <label class="check">
          <input v-model="settings.mascBodyContent" type="checkbox" /> 陽剛體型也能遇到「只給陰柔、中性」的成人內容
          <Hint text="有一部分成人向內容限定陰柔、中性體型的主角：17 條打工、儀式的特殊任務線，地下城事件（全部），部分城鎮、旅途事件與地標的場景；連帶兩種主要的寄生物也只能從那裡得到。勾選後陽剛體型的主角也會遇到。看的是體型（陽剛、陰柔、中性），不是性別；體型在建立角色或角色設定裡可以改。" />
        </label>
        <p v-if="settings.mascBodyContent" class="small body-warn"><GameIcon name="caution" :size="16" class="warn-icon" />這些內容是照陰柔、中性的主角寫的：角色的身分不會變（陽剛體型的主角一樣會當兔女郎、女僕、新娘），固定的事件文字也可能寫到不符合主角身體的部位。AI 寫經過時會照主角的身體改寫，但不保證每次都自然。</p>
        <label v-if="settings.defeatAdult !== 'off' || settings.defeatCompanion !== 'off'" class="check">
          <input v-model="settings.defeatAlways" type="checkbox" /> 戰敗色情事件一定發生 <Hint text="不擲「敵人起意」的魅力檢定：戰敗、沒有救兵，而且還站著的敵人裡有會起意的（惡人、發情的怪物……），就一定進入戰敗事件。不死、構裝這類不會起意的敵人照樣不會。" />
        </label>
      </div>
    </section>

  </template>

  <section v-if="page === 'display'" class="panel">
    <h2 class="head"><GameIcon name="sparkles" :size="20" />畫面特效與背景</h2>
    <div class="form">
      <label>
        <span class="lab">動畫特效（戰鬥、升級、金錢、地圖、背景氛圍） <Hint text="全部：所有特效，包括受擊抖動、畫面震動、像素碎裂、光粒子、背景的灰塵與飄雪。
精簡：保留短小的回饋（飄字、HP 殘影、橫幅、地名卡、角色滑動），去掉震動、粒子、背景飄落物與持續閃動的光。
關閉：不播特效，數字與畫面直接更新。
跟隨系統：系統開了「減少動態效果」時用精簡，否則全部。" /></span>
        <select v-model="settings.effects">
          <option value="auto">跟隨系統</option>
          <option value="full">全部</option>
          <option value="lite">精簡</option>
          <option value="off">關閉</option>
        </select>
      </label>
      <label class="check"><input v-model="settings.background" type="checkbox" /> 背景圖 <Hint text="依所在的地區、城鎮或地下城換整頁背景（城鎮與地區依時段、地下城依深度，有那張圖才換）。還沒有圖的地方不顯示背景圖。" /></label>
      <label v-if="settings.background">
        <span class="lab">背景圖亮度 {{ settings.backgroundBrightness }}% <Hint text="越暗，面板上的字越清楚。" /></span>
        <input v-model.number="settings.backgroundBrightness" type="range" min="20" max="100" step="5" />
      </label>
      <label v-if="settings.background">
        <span class="lab">面板不透明度 {{ settings.panelOpacity }}% <Hint text="有背景圖時，面板透出多少背景。越低背景越明顯，面板上的字也越吃力；100% 是完全不透。" /></span>
        <input v-model.number="settings.panelOpacity" type="range" min="40" max="100" step="5" />
      </label>
    </div>
  </section>

  <template v-if="page === 'rules'">
    <section v-if="game.state" class="panel">
      <h2 class="head"><GameIcon name="d20" :size="20" />這個存檔的規則</h2>
      <div class="form">
        <label><span class="lab">難度 <Hint text="怪物的生命與造成的傷害各乘一個係數（頭目一組，小怪依出現的區域各一組），普通是設計的基準（和沒有這個設定時一樣）。經驗值與戰利品不隨難度變動。改了只影響之後開打的戰鬥，進行中的那一場不變。" /></span>
          <select :value="difficultyOf(game.state)" @change="game.setDifficulty(($event.target as HTMLSelectElement).value as Difficulty)">
            <option v-for="id in DIFFICULTY_IDS" :key="id" :value="id">
              {{ DIFFICULTY_DEFS[id].name }}
            </option>
          </select>
        </label>
        <p class="small muted">{{ DIFFICULTY_DEFS[difficultyOf(game.state)].desc }}（{{ difficultySummary(DIFFICULTY_DEFS[difficultyOf(game.state)]) }}）</p>
        <label><span class="lab">在地下城戰敗時，這趟探索撿到、還沒帶出去的物品與錢 <Hint text="離開地下城（啟程旅行）就算帶出去了。這個規則存在存檔裡，每個存檔可以不一樣。" /></span>
          <select :value="defeatLootRule(game.state)" @change="game.setDefeatLoot(($event.target as HTMLSelectElement).value as DefeatLoot)">
            <option v-for="(n, k) in DEFEAT_LOOT_NAME" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" :checked="!!game.state.options?.tagChange" @change="game.setTagChange(($event.target as HTMLInputElement).checked)" />
          允許在遊戲中更換身分標籤 <Hint text="勾選時，可以在角色詳情的「角色設定」裡更換主角的身分標籤（最多 3 個）。皇族可以直接進出王城。" /></label>
        <RuleFields :model-value="saveRules" @update:model-value="game.setRules" />
      </div>
    </section>

    <section class="panel">
      <h2 class="head"><GameIcon name="sliders" :size="20" />遊戲規則</h2>
      <div class="form">
        <label>
          <span class="lab">升級時能力三選一的重抽次數（每組） <Hint text="0 表示不能重抽。只影響之後的重抽，已經用掉的次數照算。" /></span>
          <input v-model.number="settings.abilityRerolls" type="number" min="0" max="99" style="width: 100px" />
        </label>
        <label>
          <span class="lab">兩次長休至少隔幾小時 <Hint :text="`0～24，預設 ${companionRules.rest.long_rest_gap_hours}。從上次長休結束時算起。`" /></span>
          <input v-model.number="settings.longRestGap" type="number" min="0" max="24" style="width: 100px" />
        </label>
        <div class="field">
          <span class="lab">走一格花幾分鐘 <Hint :text="`0～60。預設：城鎮 ${STEP_DEFAULT.settlement}、近郊 ${STEP_DEFAULT.wild}、冒險區域 ${STEP_DEFAULT.dungeon} 分鐘。時間影響白天黑夜、光源的燃料與委託的期限。房子裡照城鎮算，特殊地圖照冒險區域算；旅途一格一天，不受影響。`" /></span>
          <div class="steps">
            <label v-for="p in STEP_PLACES" :key="p.id">{{ p.name }} <input v-model.number="settings.stepMinutes[p.id]" type="number" min="0" max="60" style="width: 72px" /> 分</label>
          </div>
        </div>
        <label>
          <span class="lab">建角時挑裝備的預算（材料等級點數） <Hint :text="`0～${gearRules.creation.max_budget}，預設 ${gearRules.creation.default_budget}。職業的基本配備免費；把模板裝備換成更好的材料每升一級花 1 點，另外加的裝備花它的材料等級（第 ${gearRules.creation.max_tier} 級以內）。只影響之後建立的角色。`" /></span>
          <input v-model.number="settings.creationGearBudget" type="number" min="0" :max="gearRules.creation.max_budget" style="width: 100px" />
        </label>
      </div>
    </section>

  </template>

  <section v-if="page === 'save'" class="panel">
    <h2 class="head"><GameIcon name="save" :size="20" />存檔</h2>
    <p v-if="!game.state" class="small muted">還沒有開始冒險。</p>
    <p class="small muted">目前的進度會自動存在瀏覽器中。存檔欄位、快速存檔、匯出與匯入檔案在右上角的「存讀檔」。</p>
    <div v-if="game.state" class="row">
      <button class="danger" @click="doReset">放棄目前的進度並回到開始畫面</button>
    </div>
    <p class="small muted">存檔欄位裡的存檔不會被刪除。</p>
    <label class="check">
      <input v-model="settings.backupBeforeSwitch" type="checkbox" /> 讀檔、開新遊戲前先備份到自動存檔
      <Hint text="開著時，讀檔前會把目前的進度存一份；在首頁開新遊戲或讀檔、蓋掉還沒繼續的遊戲前，也會先把它存一份。都存進自動存檔欄位（和長休、抵達目的地的自動存檔輪流用最近 3 格）。關掉時不存，自動存檔欄位只留長休、抵達的存檔，但誤讀或誤開新遊戲就找不回原本的進度。" />
    </label>
    <h3 class="head"><GameIcon name="book" :size="17" />日誌瘦身</h3>
    <div class="form">
      <label>
        <span class="lab">完整保留最近幾則日誌 <Hint text="超過時，更早的日誌每 50 則整理一次：只留時間、地點、簡述與 AI 寫的經過（在日誌最上方「顯示封存的舊紀錄」），隊伍快照、經過的時間軸與變化清單拿掉，讓存檔不會越來越大。token 用量不會因此變少：封存的日誌的用量另外合計，日誌上方會分開顯示。" /></span>
        <input v-model.number="settings.logKeep" type="number" min="50" max="5000" step="50" style="width: 120px" />
      </label>
      <p v-if="game.state" class="small muted">目前：{{ game.state.reports.length }} 則完整的日誌、{{ game.state.logArchive?.length ?? 0 }} 則封存的紀錄。</p>
    </div>
  </section>
</template>

<style scoped>
.body-warn { display: flex; gap: 6px; align-items: flex-start; margin: 0; line-height: 1.6; }
.body-warn .warn-icon { color: var(--danger); flex: none; margin-top: 2px; }
.form { display: grid; gap: 12px; max-width: 560px; }
.warn-line { margin: -4px 0 0; color: var(--accent); }
.tabs { gap: 6px; margin-bottom: 10px; }
.tabs button { display: inline-flex; align-items: center; gap: 6px; }
.tabs button.active { border-color: var(--accent); color: var(--accent); }
.head { display: flex; align-items: center; gap: 6px; }
.head :deep(.game-icon) { color: var(--accent); }
.lab { display: inline-flex; align-items: center; gap: 4px; }
.field-row { display: flex; align-items: center; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--muted); display: inline-block; }
.dot.ready { background: var(--good); border-color: var(--good); }
.routes .name :deep(.game-icon) { color: var(--accent); }
.pages { position: sticky; top: 0; z-index: 1; background: var(--bg); padding: 4px 0; flex-wrap: wrap; }
.routes { border-collapse: collapse; width: 100%; }
.routes td { border-bottom: 1px solid var(--border); padding: 6px 8px 6px 0; vertical-align: top; }
.routes .name { white-space: nowrap; font-weight: 600; }
/* 手機：用途名稱和來源一排，說明換到下一排佔滿寬度 */
@media (max-width: 720px) {
  .routes, .routes tbody { display: block; }
  .routes tr { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 8px; align-items: center; border-bottom: 1px solid var(--border); padding: 6px 0; }
  .routes td { border-bottom: none; padding: 0; }
  .routes td select { width: 100%; }
  .routes td.muted { grid-column: 1 / -1; padding-top: 4px; }
}
.note { color: var(--accent-2); }
.form label, .form .field { display: grid; gap: 4px; }
.form label.check { display: flex; gap: 6px; align-items: center; }
.steps { display: flex; flex-wrap: wrap; gap: 12px; }
.form .steps label { display: inline-flex; gap: 6px; align-items: center; }
</style>
