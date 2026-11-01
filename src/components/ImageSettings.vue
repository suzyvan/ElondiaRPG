<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_PORTRAIT_TEMPLATE, DEFAULT_STYLE, IMAGE_SERVICES, imageServiceInfo } from '@/narrator/imageInfo'
import { useImageSettings } from '@/stores/image'
import { useSettings } from '@/stores/settings'
import ComfySettings from './ComfySettings.vue'
import GameIcon from './ui/GameIcon.vue'
import Hint from './ui/Hint.vue'

// 插圖生成的設定：生圖服務、形象插圖的提示詞、生圖提示詞預處理（內建或自訂的指示）
const image = useImageSettings()
const settings = useSettings()
const info = computed(() => imageServiceInfo(image.service))
const cfg = computed(() => image.configs[image.service])
const sizeKey = computed({
  get: () => `${cfg.value.width}x${cfg.value.height}`,
  set: (v: string) => {
    const [w, h] = v.split('x').map(Number)
    if (w && h) {
      cfg.value.width = w
      cfg.value.height = h
    }
  },
})
const tagSource = computed(() => settings.sourceFor('tags'))
const tagReady = computed(() => settings.sourceReady(tagSource.value.index))
// 目前服務用的預處理指示；自訂的可以直接修改
const pre = computed(() => image.preprocessorFor())
const custom = computed(() => image.preprocessors.find((p) => p.id === pre.value?.id))

function removePreprocessor() {
  const p = custom.value
  if (!p) return
  const users = IMAGE_SERVICES.filter((s) => image.preprocess[s.id] === p.id).map((s) => s.name)
  if (confirm(`刪除預處理指示「${p.name}」？${users.length ? `（${users.join('、')} 會改成不預處理）` : ''}`)) image.removePreprocessor(p.id)
}

function resetService() {
  if (confirm(`把 ${info.value.name} 的參數恢復預設？（API key 會保留）`)) image.resetService(image.service)
}
</script>

<template>
  <section class="panel">
    <h2 class="head">
      <GameIcon name="image" />插圖生成
      <Hint text="用來生成角色的形象插圖（隊伍與人物卡上的「生成形象圖」）。API key 只存在這個瀏覽器，請求直接從瀏覽器送往你選擇的服務。圖片存在這個瀏覽器的 IndexedDB；匯出存檔時可以選擇附上。" />
    </h2>
    <div class="form">
      <label>生圖服務
        <select v-model="image.service">
          <option v-for="s in IMAGE_SERVICES" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <p class="small muted">{{ info.note }}</p>
      <label><span>API key<template v-if="info.keyOptional">（選填） <Hint text="有設驗證時才要。" /></template></span>
        <input v-model="cfg.apiKey" type="password" autocomplete="off" />
      </label>
      <label>服務網址 <input v-model="cfg.baseURL" /></label>
      <ComfySettings v-if="image.service === 'comfyui'" />
      <label v-else>模型 <input v-model="cfg.model" :list="image.service === 'novelai' ? 'nai-models' : undefined" /></label>
      <datalist id="nai-models">
        <option value="nai-diffusion-4-5-full" />
        <option value="nai-diffusion-4-5-curated" />
        <option value="nai-diffusion-5-full" />
        <option value="nai-diffusion-5-curated" />
      </datalist>
      <div v-if="image.service !== 'comfyui'" class="grid">
        <label>尺寸
          <select v-model="sizeKey">
            <option v-for="[w, h] in info.sizes" :key="`${w}x${h}`" :value="`${w}x${h}`">{{ w }} × {{ h }}</option>
            <option v-if="!info.sizes.some(([w, h]) => w === cfg.width && h === cfg.height)" :value="`${cfg.width}x${cfg.height}`">{{ cfg.width }} × {{ cfg.height }}（自訂）</option>
          </select>
        </label>
        <template v-if="image.service !== 'openai'">
          <label>寬 <input v-model.number="cfg.width" type="number" min="64" step="64" /></label>
          <label>高 <input v-model.number="cfg.height" type="number" min="64" step="64" /></label>
          <label>步數 <input v-model.number="cfg.steps" type="number" min="1" max="150" /></label>
          <label>CFG <input v-model.number="cfg.scale" type="number" min="0" max="30" step="0.5" /></label>
          <label>取樣器 <input v-model="cfg.sampler" /></label>
        </template>
      </div>
      <label v-if="image.service === 'novelai'">負面提示詞 <textarea v-model="cfg.negative" rows="2" /></label>
      <label><span>額外參數（JSON，選填） <Hint :text="image.service === 'novelai' ? '合併進 parameters。' : '合併進請求。'" /></span>
        <textarea v-model="cfg.extra" rows="2" class="mono" spellcheck="false" placeholder='{"quality": "high"}' />
      </label>
      <div v-if="image.service !== 'comfyui'" class="row"><button class="small" @click="resetService"><GameIcon name="undo" :size="14" />這個服務的參數恢復預設</button></div>

      <fieldset class="pre">
        <legend class="head">
          <GameIcon name="wand" :size="16" />生圖提示詞預處理
          <Hint text="生圖前先把角色的描述交給大語言模型（「功能分配」的「插圖提示詞預處理」），依選的指示改寫成生圖服務看得懂的格式（例如 Danbooru 標籤、英文描述、JSON），再把結果直接送出，不再套用提示詞模板與畫風。每個生圖服務各自選；NovelAI 與動漫風格的 Stable Diffusion 模型通常只看得懂 Danbooru 標籤。" />
        </legend>
        <p class="small muted">
          改寫用的來源：「{{ tagSource.name }}」
          <span v-if="pre && !tagReady" class="warn-text">這個來源還沒設定好。</span>
        </p>
        <label>{{ info.name }} 用的預處理
          <select v-model="image.preprocess[image.service]">
            <option value="">不預處理（套用提示詞模板）</option>
            <optgroup label="內建">
              <option v-for="p in image.allPreprocessors().filter((x) => x.builtin)" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="image.preprocessors.length" label="自訂">
              <option v-for="p in image.preprocessors" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
          </select>
        </label>
        <template v-if="custom">
          <label>名稱 <input v-model="custom.name" maxlength="30" /></label>
          <label>回覆的整理方式
            <select v-model="custom.output">
              <option value="tags">整理成標籤（拿掉說明、換行改逗號、去掉重複）</option>
              <option value="text">原樣送出（只拿掉程式碼框）</option>
            </select>
          </label>
          <label><span>指示 <Hint text="當作 system 交給大語言模型。" /></span>
            <textarea v-model="custom.instructions" rows="9" class="mono" spellcheck="false" />
          </label>
        </template>
        <details v-else-if="pre">
          <summary class="small">「{{ pre.name }}」的指示 <Hint text="內建，不能修改；複製成自訂的再改。" /></summary>
          <textarea :value="pre.instructions" rows="9" class="mono" readonly />
          <p class="small muted">回覆的整理方式：{{ pre.output === 'tags' ? '整理成標籤' : '原樣送出' }}</p>
        </details>
        <div class="row">
          <button v-if="pre" class="small" @click="image.addPreprocessor(pre)"><GameIcon name="copy" :size="14" />複製成自訂</button>
          <button class="small" @click="image.addPreprocessor()"><GameIcon name="plus" :size="14" />新增預處理指示</button>
          <button v-if="custom" class="small" @click="removePreprocessor"><GameIcon name="trash" :size="14" />刪除這份指示</button>
        </div>
      </fieldset>

      <fieldset class="pre">
        <legend class="small">
          <GameIcon name="notebook" :size="16" />日誌插圖
          <Hint text="冒險日誌每則底下的插圖按鈕（或下面的自動生成）：先用「插圖提示詞預處理」的模型來源把日誌整理成分鏡（誰在畫面上、站在哪、在做什麼），再照上面選的生圖服務與預處理的寫法出圖，掛在那則日誌下面。NovelAI 的 V4 模型可以分開描述每個人與位置；ChatGPT 會把登場角色的形象圖當參考圖；ComfyUI 接成一段提示詞，三人以上容易混在一起。" />
        </legend>
        <label>
          <span>自動生成 <Hint warn :width="320" text="每一張圖都要花錢：先用「插圖提示詞預處理」的模型整理分鏡（花 token），再送一次生圖（ChatGPT、NovelAI 依張數計費）。只在正文第一次寫完時畫；沒有正文的日誌不畫，重寫經過也不會重畫（要重畫按日誌底下的插圖按鈕）。生圖服務或預處理的模型來源沒設定好時不會自動畫。" /></span>
          <select v-model="image.sceneAuto">
            <option value="off">關閉</option>
            <option value="adult">只畫成人場景</option>
            <option value="all">每一則（有正文的日誌）</option>
          </select>
        </label>
        <label>成人場景改用
          <select v-model="image.sceneAdultService">
            <option value="">和一般場景一樣（{{ info.name }}）</option>
            <option v-for="s in IMAGE_SERVICES.filter((x) => x.id !== 'openai')" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <p class="small muted">
          ChatGPT 不畫成人內容；日誌是成人場景（帶親密場景）時改用這裡選的服務（要先切到那個服務填好 key 與網址）。
          <span v-if="image.sceneAdultService && !image.ready(image.sceneAdultService)" class="warn-text">{{ imageServiceInfo(image.sceneAdultService).name }} 還沒設定好。</span>
          <span v-else-if="image.sceneAuto !== 'off' && image.sceneService(true) === 'openai'" class="warn-text">成人場景不會自動畫：要先在這裡指定 NovelAI 或 ComfyUI。</span>
        </p>
      </fieldset>

      <label><span>畫風 <Hint text="填進提示詞模板的 {style}。" /></span><input v-model="image.style" /></label>
      <div class="row"><button class="small" :disabled="image.style === DEFAULT_STYLE" @click="image.style = DEFAULT_STYLE">畫風恢復預設</button></div>
      <details>
        <summary class="small">形象插圖的提示詞模板</summary>
        <p class="small muted">代號：{name} {gender} {race} {role} {level} {appearance} {personality} {background} {gear} {tattoos} {composition} {style}。{composition} 依刺青與裝備的部位自動選 upper body、cowboy shot 或 full body；模板沒有這個代號時，寫死的 upper body 也會跟著換。代號的值是空的那一行會整行拿掉。</p>
        <textarea v-model="image.template" rows="9" class="mono" spellcheck="false" />
        <div class="row"><button class="small" :disabled="image.template === DEFAULT_PORTRAIT_TEMPLATE" @click="image.template = DEFAULT_PORTRAIT_TEMPLATE">恢復預設</button></div>
      </details>
      <p class="small status" :class="image.ready() ? 'ok-text' : 'warn-text'">
        <GameIcon :name="image.ready() ? 'check' : 'alert'" :size="14" />{{ image.ready() ? '可以生成插圖' : image.service === 'comfyui' ? '還沒設定好（需要網址，以及選好這組設定的模型）' : '還沒設定好（需要網址與 API key）' }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.form { display: grid; gap: 10px; max-width: 640px; }
.form label { display: grid; gap: 4px; }
.form label.check { display: flex; gap: 6px; align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.form textarea, .form input:not([type='checkbox']) { width: 100%; }
.mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
.row { display: flex; gap: 6px; }
.warn-text { color: var(--danger); }
.ok-text { color: var(--accent); }
details textarea { width: 100%; margin-top: 4px; }
.pre { display: grid; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; }
.pre legend { padding: 0 4px; }
.pre p { margin: 0; }
.head { display: flex; align-items: center; gap: 6px; }
.head :deep(.game-icon) { color: var(--accent); }
.row button, .status { display: inline-flex; align-items: center; gap: 4px; }
</style>
