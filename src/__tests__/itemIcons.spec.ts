import { afterEach, describe, expect, it } from 'vitest'
import { itemRules } from '@/engine/data'
import { gearRules } from '@/engine/gear'
import { categoryIconSource, ICON_MAX_CHARS, itemIconSource, sanitizeIcon } from '@/engine/itemIcons'
import { applyContent, emptyMods, normalizeMods, sanitizeBase, sanitizeItem } from '@/engine/mods'
import { ART_NAMES, artPath } from '@/components/items/itemArt'
import { baseArt, CATEGORY_ART, sourceDraw } from '@/components/items/itemIcon'

afterEach(() => applyContent(emptyMods()))

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG2 = 'data:image/png;base64,AAAA'
const builtinFood = itemRules.items.find((i) => i.category === 'food' && !i.gear)!
const builtinGear = itemRules.items.find((i) => i.gear && gearRules.bases[i.gear.base])!
// 內建物品都有內建圖：測試後面的查找順序用自建物品（名稱沒有內建圖）
const food = '測試用的麵包'
const gear = { ...builtinGear, name: '測試用的長劍' }
function customMods() {
  const mods = emptyMods()
  mods.items[food] = { ...builtinFood, name: food, custom: true }
  mods.items[gear.name] = { ...gear, custom: true }
  return mods
}

describe('item icons', () => {
  it('only accepts small image data URLs', () => {
    expect(sanitizeIcon(PNG)).toBe(PNG)
    expect(sanitizeIcon('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA')
    expect(sanitizeIcon('https://example.com/a.png')).toBeUndefined()
    expect(sanitizeIcon('data:text/html;base64,AAAA')).toBeUndefined()
    expect(sanitizeIcon('data:image/svg+xml;base64,AAAA')).toBeUndefined()
    expect(sanitizeIcon(`data:image/png;base64,${'A'.repeat(ICON_MAX_CHARS)}`)).toBeUndefined()
    expect(sanitizeIcon(42)).toBeUndefined()
  })

  it('uses the built-in picture of a built-in item, smoothly, unless the item has an upload', () => {
    const src = itemIconSource(undefined, builtinFood.name)
    expect(src).toMatchObject({ kind: 'image', smooth: true })
    expect((src as { src: string }).src).toMatch(/icons\/items\/[0-9a-f]{12}\.webp$/)
    expect(sourceDraw(src)).toEqual({ img: (src as { src: string }).src, smooth: true })
    expect(itemIconSource(undefined, builtinGear.name)).toMatchObject({ kind: 'image', smooth: true })
    // 底材、類別上傳的圖不蓋過物品自己的內建圖；物品自己上傳的圖優先
    const mods = emptyMods()
    mods.categoryIcons.food = { icon: PNG }
    mods.items[builtinFood.name] = { ...builtinFood, icon: PNG2 }
    applyContent(mods)
    expect(itemIconSource(undefined, builtinFood.name)).toEqual({ kind: 'image', src: PNG2 })
    expect(sourceDraw(itemIconSource(undefined, builtinFood.name))).toEqual({ img: PNG2 })
  })

  it('falls back from the item to the base to the category', () => {
    applyContent(customMods())
    expect(itemIconSource(undefined, food)).toEqual({ kind: 'category', category: 'food' })
    expect(itemIconSource(undefined, gear.name)).toEqual({ kind: 'base', base: gear.gear!.base })
    // 物品目錄裡沒有的裝備（AI 生成的）：用存檔裡的組成找底材
    const state = { customItems: { 奇怪的劍: { category: 'equipment', price_cc: 10, gear: { base: 'longsword', material: 'iron' } } } }
    expect(itemIconSource(state, '奇怪的劍')).toEqual({ kind: 'base', base: 'longsword' })
    expect(itemIconSource(undefined, '不存在的東西')).toEqual({ kind: 'category', category: undefined })

    const mods = customMods()
    mods.categoryIcons.food = { icon: PNG }
    mods.bases[gear.gear!.base] = { ...gearRules.bases[gear.gear!.base]!, icon: PNG2 }
    applyContent(mods)
    expect(itemIconSource(undefined, food)).toEqual({ kind: 'image', src: PNG })
    expect(itemIconSource(undefined, gear.name)).toEqual({ kind: 'image', src: PNG2 })

    // 物品自己的圖優先
    mods.items[gear.name] = { ...gear, icon: PNG }
    applyContent(mods)
    expect(itemIconSource(undefined, gear.name)).toEqual({ kind: 'image', src: PNG })

    // 恢復預設之後換回內建的
    applyContent(customMods())
    expect(categoryIconSource('food')).toEqual({ kind: 'category', category: 'food' })
    expect(itemIconSource(undefined, gear.name)).toEqual({ kind: 'base', base: gear.gear!.base })
  })

  it('keeps valid icons when cleaning mods and drops the rest', () => {
    expect(sanitizeItem('測試', { category: 'food', price_cc: 1, tags: [], icon: PNG }, true).icon).toBe(PNG)
    expect(sanitizeItem('測試', { category: 'food', price_cc: 1, tags: [], icon: 'javascript:alert(1)' }, true).icon).toBeUndefined()
    expect(sanitizeBase({ ...gearRules.bases.longsword!, icon: PNG }, false, 'longsword').icon).toBe(PNG)
    const m = normalizeMods({ categoryIcons: { food: { icon: PNG }, nonsense: { icon: PNG }, scroll: { icon: 'bad' } } })
    expect(m.categoryIcons).toEqual({ food: { icon: PNG } })
    // 舊的自訂內容沒有這一欄
    expect(normalizeMods({}).categoryIcons).toEqual({})
  })

  it('has built-in art for every base and category', () => {
    for (const id of Object.keys(gearRules.bases)) expect(baseArt(id), id).not.toEqual({ ui: 'question' })
    for (const c of Object.keys(itemRules.categories)) expect(CATEGORY_ART[c as keyof typeof CATEGORY_ART], c).toBeDefined()
    for (const n of ART_NAMES) expect(artPath(n), n).toMatch(/^M\d/)
    // 自建底材：依武器類型、欄位與材料類型挑
    expect(baseArt('custom_x', { slot: 'feet', kind: 'leather' })).toEqual({ art: 'boots' })
    expect(baseArt('custom_y', { slot: 'main_hand', kind: 'metal', weapon: 'dagger' })).toEqual({ art: 'dagger' })
    expect(baseArt('custom_z', { slot: 'ring', kind: 'jewel' })).toEqual({ art: 'ring' })
    expect(sourceDraw({ kind: 'image', src: PNG })).toEqual({ img: PNG })
    // 複製內建武器的自建底材（整理後變成 weaponDef，登錄成 w_<底材>）：還是用那種武器的圖
    applyContent(normalizeMods({ ...emptyMods(), bases: { mod_base_knife: { custom: true, name: '短刃', kind: 'metal', price: 50, slot: 'main_hand', weapon: 'dagger' } } } as never))
    expect(baseArt('mod_base_knife')).toEqual({ art: 'dagger' })
  })
})
