// @vitest-environment jsdom
// 房屋區塊的畫面：箱子、家僕、你不在的時候都畫得出來，按鈕接到遊戲（R30、R31）
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomePanel from '@/components/HomePanel.vue'
import { enterLocation, placeAt } from '@/engine/grid'
import { buyHome, lotsOf, placeFurniture } from '@/engine/homes'
import { candidates, staffOf } from '@/engine/staff'
import { storedItems } from '@/engine/storage'
import { addItem, newGame } from '@/engine/state'
import { useGame } from '@/stores/game'

describe('房屋區塊', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('站在箱子上：列出箱子與行囊，放進去會進箱子；家僕的應徵者可以雇用', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
    enterLocation(state)
    state.money_cc = 100000
    buyHome(state, lotsOf(state.location).find((l) => l.district === 'house')!.id)
    const home = Object.values(state.homes!)[0]!
    const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
    const i = ground.cells.findIndex((c) => c.kind === 'floor' && !c.furniture)
    const p = { x: i % ground.width, y: Math.floor(i / ground.width) }
    addItem(state.inventory, '木箱', 1)
    placeFurniture(state, ground, p.x, p.y, '木箱')
    placeAt(state, ground, p.x, p.y)
    addItem(state.inventory, '木材', 3)
    home.staffNotes = [{ text: '某人辭職了。', tag: '辭職', day: 1 }]
    const game = useGame()
    game.state = state
    const c = mount(HomePanel, { attachTo: document.body })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('放了 0／12 種')
    expect(text).toContain('你不在的時候')
    expect(text).toContain('家僕')
    const row = c.findAll('li').find((li) => li.text().startsWith('木材'))!
    await row.find('button').trigger('click')
    await flushPromises()
    expect(storedItems(ground.cells[i]!)).toEqual([{ name: '木材', qty: 3 }])
    // 展開家僕（還沒雇人時收著）：雇第一位應徵者
    await c.findAll('button.menu-row').find((b) => b.text().includes('家僕'))!.trigger('click')
    await flushPromises()
    const first = candidates(game.state!, home.location)[0]!
    const hireRow = c.findAll('li').find((li) => li.text().startsWith(first.name))
    expect(hireRow).toBeDefined()
    await hireRow!.findAll('button').find((b) => b.text() === '雇用')!.trigger('click')
    await flushPromises()
    expect(staffOf(game.state!, home.id).map((r) => r.id)).toEqual([first.id])
    c.unmount()
  })
})
