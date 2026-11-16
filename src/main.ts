import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initContent } from './stores/content'
import { preloadCurrent } from './stores/saves'
import { useGame } from './stores/game'
// 字型隨遊戲打包（不連 Google Fonts）：依 unicode-range 切片，瀏覽器只下載畫面上用到的字
import '@fontsource/noto-serif-tc/400.css'
import '@fontsource/noto-serif-tc/600.css'
import '@fontsource/noto-serif-tc/700.css'
import '@fontsource/noto-serif-tc/900.css'
// 繁體字型缺的簡體字（世界書原文、AI 用簡體寫的正文）用 Noto Serif SC 補
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-serif-sc/700.css'
import '@fontsource/noto-serif-sc/900.css'
import '@fontsource/lxgw-wenkai-tc/400.css'
import '@fontsource/lxgw-wenkai-tc/700.css'
import './style.css'

// 網站更新後，還開著的舊頁面要載入的程式檔已經換了名字（例如連線測試、AI 敘事要用的模組）：
// 原本的「Failed to fetch dynamically imported module」看不懂，改成請玩家重新整理
window.addEventListener('vite:preloadError', (e) => {
  const err = (e as Event & { payload?: unknown }).payload
  if (err instanceof Error) err.message = `遊戲已經更新到新版本，這個頁面還是舊的：請重新整理頁面（F5）再試一次。（${err.message}）`
})

// 自訂內容（怪物、物品、裝備）要在讀檔之前套用
initContent()

// 進行中的遊戲存在 IndexedDB（非同步），讀出來之後才掛上畫面
void preloadCurrent().finally(() => {
  const app = createApp(App)
  app.use(createPinia())
  // 畫面（元件）裡出的程式錯誤：原本只印在瀏覽器的主控台，玩家看不到；改成錯誤泡泡，細節附上出錯的位置
  app.config.errorHandler = (err, _instance, info) => {
    console.error(err)
    try {
      useGame().reportBug(err, `畫面顯示（${info}）`)
    } catch {
      // 連錯誤泡泡都出不來：至少主控台有
    }
  }
  app.mount('#app')
})
