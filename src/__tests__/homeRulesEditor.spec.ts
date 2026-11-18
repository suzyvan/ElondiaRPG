// @vitest-environment jsdom
// ⚙️ 房屋設定：自建成套家具可以新增、手動設定效果、存檔（docs/HOMES.md 第 4.1 節）
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomeRulesEditor from '@/components/content/HomeRulesEditor.vue'
import { companionRules, homeRules } from '@/engine/data'
import { useContent } from '@/stores/content'

describe('⚙️ 房屋設定的自建套組', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('新增一套、手動設定效果、存檔後套用', async () => {
    const content = useContent()
    const c = mount(HomeRulesEditor, { attachTo: document.body })
    await c.findAll('button').find((b) => b.text().includes('新增套組'))!.trigger('click')
    await flushPromises()
    await c.findAll('button').find((b) => b.text() === '手動設定')!.trigger('click')
    await flushPromises()
    ;(c.vm as unknown as { save: () => void }).save()
    await flushPromises()
    const sets = (content.mods.homes?.rules as { furniture_sets: Record<string, { name: string; effect?: { check_attrs?: string[] } }> }).furniture_sets
    const id = Object.keys(sets).find((k) => k.startsWith('mod_set_'))!
    expect(sets[id]).toMatchObject({ name: '新的套組', effect: { check_attrs: ['cha'] } })
    expect(homeRules.furniture_sets[id]?.name).toBe('新的套組')
    expect(companionRules.conditions[`set_${id}`]).toBeDefined()
    c.unmount()
    content.resetAll()
    expect(homeRules.furniture_sets[id]).toBeUndefined()
  })
})
