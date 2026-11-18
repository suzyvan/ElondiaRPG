// @vitest-environment jsdom
// 房屋區塊的畫面：箱子、家僕、你不在的時候都畫得出來，按鈕接到遊戲（R30、R31）
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomePanel from '@/components/HomePanel.vue'
import { enterLocation, placeAt } from '@/engine/grid'
import { buyHome, lotsOf, placeFurniture } from '@/engine/homes'
import { candidates, staffOf } from '@/engine/staff'
import { storedItems } from '@/engine/storage'
import { addItem, newGame } from '@/engine/state'
import { useGame } from '@/stores/game'
import { generateNpc } from '@/engine/npcs'
import { Rng } from '@/engine/rng'
import { ensureRelationship, setAffinity } from '@/engine/social'

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

  it('站在熟成桶上：列出能熟成的東西，放進去開始熟成', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
    enterLocation(state)
    state.money_cc = 100000
    buyHome(state, lotsOf(state.location).find((l) => l.district === 'house')!.id)
    const home = Object.values(state.homes!)[0]!
    const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
    const i = ground.cells.findIndex((c) => c.kind === 'floor' && !c.furniture)
    const p = { x: i % ground.width, y: Math.floor(i / ground.width) }
    addItem(state.inventory, '橡木桶', 1)
    placeFurniture(state, ground, p.x, p.y, '橡木桶')
    placeAt(state, ground, p.x, p.y)
    addItem(state.inventory, '野莓', 6)
    const game = useGame()
    game.state = state
    const c = mount(HomePanel, { attachTo: document.body })
    await flushPromises()
    const select = c.findAll('select').find((x) => x.text().includes('陳年果酒'))!
    expect(select.text()).toContain('熒光蜜酒')
    await select.setValue('陳年果酒')
    await c.findAll('button').find((b) => b.text() === '放進去')!.trigger('click')
    await flushPromises()
    expect(ground.cells[i]!.aging?.item).toBe('陳年果酒')
    expect(document.body.textContent).toContain('陳年果酒：還要')
    c.unmount()
  })

  it('擴建：選單列出三種，按下去開工', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
    enterLocation(state)
    state.money_cc = 100000
    buyHome(state, lotsOf(state.location).find((l) => l.district === 'house')!.id)
    const home = Object.values(state.homes!)[0]!
    const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
    const i = ground.cells.findIndex((c) => c.kind === 'floor' && !c.furniture)
    placeAt(state, ground, i % ground.width, Math.floor(i / ground.width))
    const game = useGame()
    game.state = state
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = mount(HomePanel, { attachTo: document.body })
    await c.findAll('button.menu-row').find((b) => b.text().includes('擴建'))!.trigger('click')
    await flushPromises()
    const row = c.findAll('li').find((li) => li.text().startsWith('加蓋一層'))!
    await row.find('button').trigger('click')
    await flushPromises()
    expect(game.state!.homes![home.id]!.construction?.kind).toBe('floor')
    expect(document.body.textContent).toContain('施工中')
    c.unmount()
  })

  it('房間用途：站在房間裡可以選，選了記在房子上', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
    enterLocation(state)
    state.money_cc = 100000
    buyHome(state, lotsOf(state.location).find((l) => l.district === 'house')!.id)
    const home = Object.values(state.homes!)[0]!
    const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
    const i = ground.cells.findIndex((c, k) => c.kind === 'floor' && ground.cells[k - 1]?.kind === 'floor' && ground.cells[k + 1]?.kind === 'floor')
    placeAt(state, ground, i % ground.width, Math.floor(i / ground.width))
    const game = useGame()
    game.state = state
    const c = mount(HomePanel, { attachTo: document.body })
    await flushPromises()
    const select = c.find('select[aria-label="房間用途"]')
    await select.setValue('bedroom')
    await flushPromises()
    expect(Object.values(game.state!.homes![home.id]!.rooms ?? {})).toEqual(['bedroom'])
    expect(document.body.textContent).toContain('還沒生效：要擺一張床')
    c.unmount()
  })

  it('同居的人：列出在家的人，帶上冒險者、請他搬出去', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'soriel' })
    enterLocation(state)
    state.money_cc = 100000
    buyHome(state, lotsOf(state.location).find((l) => l.district === 'house')!.id)
    const home = Object.values(state.homes!)[0]!
    const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
    const i = ground.cells.findIndex((c) => c.kind === 'floor' && !c.furniture)
    addItem(state.inventory, '木板床', 1)
    placeFurniture(state, ground, i % ground.width, Math.floor(i / ground.width), '木板床')
    placeAt(state, ground, (i + 1) % ground.width, Math.floor((i + 1) / ground.width))
    const rec = generateNpc(state, new Rng(3), { kind: 'adventurer', location: state.location, tags: ['warrior'] }, 'adv')
    ;(state.npcs ??= {})[rec.id] = rec
    ensureRelationship(state, rec)
    setAffinity(state, rec.id, 90)
    rec.cohabit = { home: home.id, since: { ...state.time } }
    rec.at = { area: ground.key, x: 1, y: 1, until: 1e9 }
    const game = useGame()
    game.state = state
    const c = mount(HomePanel, { attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain('同居的人')
    const row = c.findAll('li').find((li) => li.text().includes(rec.name) && li.text().includes('在家'))!
    await row.findAll('button').find((b) => b.text() === '帶上')!.trigger('click')
    await flushPromises()
    expect(game.state!.party.some((m) => m.id === rec.id)).toBe(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const row2 = c.findAll('li').find((li) => li.text().includes('跟著你出門'))!
    await row2.findAll('button').find((b) => b.text() === '請他搬出去')!.trigger('click')
    await flushPromises()
    expect(game.state!.npcs![rec.id]!.cohabit).toBeUndefined()
    c.unmount()
  })

  it('傳送陣：站在上面列出別棟房子，按下去傳送過去', async () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 6, birthplace: 'albena' })
    enterLocation(state)
    state.money_cc = 200000
    const circle = () => {
      const before = new Set(Object.keys(state.homes ?? {}))
      buyHome(state, lotsOf(state.location).find((l) => l.district !== 'manor')!.id)
      const home = Object.values(state.homes!).find((h) => !before.has(h.id))!
      const ground = Object.values(home.areas).find((a) => a.homeFloor === 'ground')!
      const i = ground.cells.findIndex((c) => c.kind === 'floor' && !c.furniture)
      addItem(state.inventory, '傳送陣', 1)
      placeFurniture(state, ground, i % ground.width, Math.floor(i / ground.width), '傳送陣')
      placeAt(state, ground, i % ground.width, Math.floor(i / ground.width))
      return home
    }
    const far = circle()
    state.location = 'soriel'
    enterLocation(state)
    circle()
    addItem(state.inventory, '傳送石', 2)
    const game = useGame()
    game.state = state
    const c = mount(HomePanel, { attachTo: document.body })
    await flushPromises()
    const row = c.findAll('li').find((li) => li.text().includes(far.name))!
    await row.find('button').trigger('click')
    await flushPromises()
    expect(game.state!.location).toBe('albena')
    c.unmount()
  })
})
