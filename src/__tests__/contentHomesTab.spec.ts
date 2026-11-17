// @vitest-environment jsdom
// 世界編輯器的「🗺️ 地點 → 🏠 房屋設定」分頁：自己一頁，連結跳到事件頁並篩選家裡的事
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContentView from '@/components/ContentView.vue'

describe('房屋設定分頁', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('在地點組裡；打開是房屋設定，連結跳到事件頁的家裡的事', async () => {
    const c = mount(ContentView, { attachTo: document.body })
    await c.findAll('nav.groups button').find((b) => b.text().includes('地點'))!.trigger('click')
    await flushPromises()
    await c.findAll('nav.subs button').find((b) => b.text().includes('房屋設定'))!.trigger('click')
    await flushPromises()
    expect(c.text()).toContain('自建的成套家具')
    expect(c.text()).not.toContain('＋ 新增物品')
    await c.findAll('button').find((b) => b.text().includes('看家裡的事'))!.trigger('click')
    await flushPromises()
    expect(c.find('nav.subs button.active').text()).toContain('事件')
    expect(c.text()).toContain('偷懶被抓到')
    expect(c.text()).not.toContain('搜身盤查')
    c.unmount()
  })
})
