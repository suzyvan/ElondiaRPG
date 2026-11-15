<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGame } from '@/stores/game'
import GameIcon from './ui/GameIcon.vue'

// 錯誤泡泡：從右上角跳出，先只顯示摘要，細節收在「詳細」裡（stores/game.ts 的 toasts；narrator/errorText.ts）。
// 開著對話框（showModal）時，對話框以外的東西都點不到，所以泡泡搬進最上面那個對話框裡顯示（Teleport），沒有對話框時放在 body。
// 12 秒後自己收起，滑鼠停在上面或打開了詳細就不收
const game = useGame()
const target = ref<HTMLElement | string>('body')
let observer: MutationObserver | undefined
function retarget(opened?: HTMLElement) {
  if (opened) {
    target.value = opened
    return
  }
  const cur = target.value
  if (cur instanceof HTMLElement && cur.isConnected && cur.hasAttribute('open')) return
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  target.value = open.at(-1) ?? 'body'
}
onMounted(() => {
  retarget()
  observer = new MutationObserver((records) => {
    let opened: HTMLElement | undefined
    for (const r of records) {
      const el = r.target as HTMLElement
      if (r.type === 'attributes' && el.tagName === 'DIALOG' && el.hasAttribute('open')) opened = el
    }
    retarget(opened)
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true, childList: true })
})
const opened = ref(new Set<number>())
const hovered = ref<number | null>(null)
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const LIFE_MS = 12000

function schedule(id: number) {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => {
    if (opened.value.has(id) || hovered.value === id) return schedule(id)
    game.dismissToast(id)
  }, LIFE_MS))
}

watch(() => game.toasts.map((t) => `${t.id}:${t.count}`).join(','), () => {
  for (const t of game.toasts) if (!timers.has(t.id)) schedule(t.id)
  for (const id of [...timers.keys()]) if (!game.toasts.some((t) => t.id === id)) { clearTimeout(timers.get(id)); timers.delete(id) }
  // 同一則又發生一次：重新計時
  for (const t of game.toasts) if (t.count > 1) schedule(t.id)
}, { immediate: true })

onBeforeUnmount(() => {
  for (const t of timers.values()) clearTimeout(t)
  observer?.disconnect()
})

function toggle(id: number, open: boolean) {
  const next = new Set(opened.value)
  if (open) next.add(id)
  else next.delete(id)
  opened.value = next
  if (!open) schedule(id)
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 複製不了就算了
  }
}
</script>

<template>
  <Teleport :to="target">
  <div class="toasts" role="region" aria-label="錯誤訊息" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in game.toasts" :key="t.id" class="toast" role="alert" @mouseenter="hovered = t.id" @mouseleave="hovered = null; schedule(t.id)">
        <div class="head">
          <GameIcon name="warning" :size="15" class="ic" />
          <span class="sum">{{ t.summary }}<span v-if="t.count > 1" class="count">×{{ t.count }}</span></span>
          <button class="ghost close" aria-label="關閉" @click="game.dismissToast(t.id)"><GameIcon name="close" :size="12" /></button>
        </div>
        <details v-if="t.detail" @toggle="toggle(t.id, ($event.target as HTMLDetailsElement).open)">
          <summary>詳細</summary>
          <p class="detail">{{ t.detail }}</p>
          <button class="small ghost" @click="copy(t.text)">複製訊息</button>
        </details>
      </div>
    </TransitionGroup>
  </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed; top: calc(env(safe-area-inset-top, 0px) + 10px); right: calc(env(safe-area-inset-right, 0px) + 10px);
  margin: 0; padding: 0; width: min(380px, calc(100vw - 20px)); display: grid; gap: 8px; z-index: 1000; pointer-events: none;
}
.toasts:empty { display: none; }
.toast {
  /* 固定的深色泡泡（對話框的羊皮紙樣式會改寫 --panel、--text 這類變數，不能跟著變） */
  --toast-bg: #221a13; --toast-text: #efe4cc; --toast-muted: #b3a081; --toast-red: #e0705e;
  pointer-events: auto; background: var(--toast-bg); color: var(--toast-text);
  border: 1px solid var(--toast-red); border-left-width: 4px; border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .25); padding: 8px 10px; display: grid; gap: 4px;
}
.head { display: flex; align-items: flex-start; gap: 8px; }
.ic { color: var(--toast-red); flex: none; margin-top: 2px; }
.sum { flex: 1; min-width: 0; line-height: 1.45; overflow-wrap: anywhere; }
.count { margin-left: 6px; font-size: var(--fs-xs); color: var(--toast-muted); }
.close { flex: none; padding: 2px 4px; }
details { font-size: var(--fs-xs); }
details summary { cursor: pointer; color: var(--toast-muted); }
.toast button { color: var(--toast-text); }
.detail { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 40vh; overflow-y: auto; line-height: 1.5; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(16px); }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: none; } }
</style>
