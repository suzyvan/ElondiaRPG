import { afterEach, describe, expect, it } from 'vitest'
import { abilities, enemies, itemRules, perkRules } from '@/engine/data'
import { gearRules } from '@/engine/gear'
import { itemIconSource, withoutIcons } from '@/engine/itemIcons'
import { applyContent, emptyMods, normalizeMods, sanitizeEnemy, sanitizePerkMod } from '@/engine/mods'
import { perkPower } from '@/engine/perks'
import { ABILITY_GLYPHS, abilityGlyph, abilityLayers } from '@/components/icons/abilityArt'
import { MATERIAL_KINDS, materialArtPath, materialDraw, materialStage } from '@/components/icons/materialArt'
import { MONSTER_KINDS, monsterArtPath, monsterBand, monsterDraw } from '@/components/icons/monsterArt'
import { perkArtPath, perkDraw, perkRarity, perkTier } from '@/components/icons/perkArt'
import { sourceDraw } from '@/components/items/itemIcon'

afterEach(() => applyContent(emptyMods()))

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** path 畫的範圍要在 24×24 裡（像素圖不能超過 12×12 格） */
function inBounds(d: string): boolean {
  expect(d.length).toBeGreaterThan(0)
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (x < 0 || y < 0 || x + w > 24 || y + 2 > 24) return false
  }
  return true
}

describe('monster icons', () => {
  it('groups levels in bands of 4', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 30].map(monsterBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('draws a different picture for every kind and band, inside 24×24', () => {
    const all = MONSTER_KINDS.flatMap((k) => [0, 1, 2, 3].map((b) => monsterArtPath(k, b)))
    expect(new Set(all).size).toBe(all.length)
    expect(all.every(inBounds)).toBe(true)
    // 17 級以上沿用最後一張圖，顏色不同
    expect(monsterArtPath('beast', 4)).toBe(monsterArtPath('beast', 3))
    expect(monsterDraw({ kind: 'beast', level: 17 })).not.toEqual(monsterDraw({ kind: 'beast', level: 13 }))
  })

  it('covers every built-in monster kind', () => {
    const kinds = new Set(Object.values(enemies).map((e) => e.kind ?? ''))
    for (const k of kinds) expect(MONSTER_KINDS).toContain(k)
  })

  it('uses an upload only for that one monster, then its built-in picture, then pixel art', () => {
    const [a, b] = Object.values(enemies).filter((e) => e.kind === 'beast')
    applyContent(normalizeMods({ ...emptyMods(), enemies: { [a!.id]: { ...a!, icon: PNG } } }))
    expect(monsterDraw(enemies[a!.id]!)).toEqual({ img: PNG })
    const own = monsterDraw(enemies[b!.id]!)
    expect(own).toMatchObject({ smooth: true })
    expect((own as { img: string }).img).toMatch(new RegExp(`icons/monsters/${b!.id}\\.webp$`))
    // 沒有內建圖的（自建的怪物、沒給 id）用像素圖
    expect('img' in monsterDraw({ ...b!, id: 'my_own_beast' })).toBe(false)
    expect('img' in monsterDraw({ kind: 'beast', level: 3 })).toBe(false)
  })

  it('has a built-in picture for every built-in monster', () => {
    for (const e of Object.values(enemies)) expect('img' in monsterDraw(e), e.id).toBe(true)
  })

  it('keeps valid uploads and drops anything else; saves leave them out', () => {
    const e = Object.values(enemies)[0]!
    expect(sanitizeEnemy(e.id, { ...e, icon: PNG }, false).icon).toBe(PNG)
    expect(sanitizeEnemy(e.id, { ...e, icon: 'https://example.com/x.png' }, false).icon).toBeUndefined()
    const mods = normalizeMods({ ...emptyMods(), enemies: { [e.id]: { ...e, icon: PNG } } })
    expect(mods.enemies[e.id]!.icon).toBe(PNG)
    expect(withoutIcons(mods).enemies[e.id]!.icon).toBeUndefined()
    expect(mods.enemies[e.id]!.icon).toBe(PNG)
  })
})

describe('ability icons', () => {
  it('picks the glyph from the damage type, then the effect', () => {
    expect(abilityGlyph(abilities.fireball!)).toBe('fire')
    expect(abilityGlyph(abilities.power_strike!)).toBe('weapon')
    expect(abilityGlyph(abilities.second_wind!)).toBe('heal')
    expect(abilityGlyph(abilities.blinding_dust!)).toBe('debuff')
    expect(abilityGlyph({ target: 'self' })).toBe('buff')
    expect(abilityGlyph({ target: 'ally', shield: { flat: 5 } })).toBe('shield')
  })

  it('has a glyph for every damage type and draws every ability', () => {
    for (const a of Object.values(abilities)) {
      expect(ABILITY_GLYPHS).toContain(abilityGlyph(a))
      const layers = abilityLayers(a.type, abilityGlyph(a))
      expect(layers).toHaveLength(2)
      expect(layers.every((l) => inBounds(l.d))).toBe(true)
    }
  })

  it('frames each kind differently', () => {
    const frames = (['cantrip', 'skill', 'spell'] as const).map((t) => abilityLayers(t, 'fire')[0]!.d)
    expect(new Set(frames).size).toBe(3)
  })
})

describe('material icons', () => {
  it('draws by kind and tier, coloured by rarity', () => {
    const all = MATERIAL_KINDS.flatMap((k) => [1, 2, 3, 4, 5].map((t) => materialArtPath(k, t)))
    expect(new Set(all).size).toBe(all.length)
    expect(all.every(inBounds)).toBe(true)
    expect([0, 1, 5, 9].map(materialStage)).toEqual([0, 0, 4, 4])
    for (const m of Object.values(gearRules.materials)) {
      expect(MATERIAL_KINDS).toContain(m.kind)
      expect(materialDraw(m).color).toBe(`var(--r-${m.rarity})`)
    }
    expect(materialDraw({ kind: 'metal', tier: 1, rarity: 'nope' }).color).toBe('var(--r-common)')
  })

  it('material items that forge into a material use its picture', () => {
    // 內建物品都有內建圖：用名稱沒有內建圖的自建物品測
    const builtinOre = itemRules.items.find((i) => i.category === 'material' && i.forge?.materials.length)!
    const ore = { ...builtinOre, name: '測試用的礦石' }
    const plain = { ...itemRules.items.find((i) => i.category === 'material' && !i.forge)!, name: '測試用的材料' }
    applyContent(normalizeMods({ ...emptyMods(), items: { [ore.name]: { ...ore, custom: true }, [plain.name]: { ...plain, custom: true } } }))
    const src = itemIconSource(undefined, ore.name)
    expect(src).toEqual({ kind: 'material', material: ore.forge!.materials[0] })
    expect(sourceDraw(src)).toEqual(materialDraw(gearRules.materials[ore.forge!.materials[0]!]!))
    expect(itemIconSource(undefined, plain.name)).toEqual({ kind: 'category', category: 'material' })
  })
})

describe('perk icons', () => {
  it('draws good and bad perks apart, by strength', () => {
    const all = [false, true].flatMap((f) => [0, 1, 2, 3].map((t) => perkArtPath(f, t)))
    expect(new Set(all).size).toBe(8)
    expect(all.every(inBounds)).toBe(true)
    expect([0, 1.5, 2, 2.5, 3, 3.5, 4, 9, -3.5].map(perkTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 2])
    for (const p of perkRules.perks) {
      expect(perkDraw(p).path).toBe(perkArtPath(!!p.flaw, perkTier(perkPower(p))))
    }
  })

  it('takes the rarity from the perk, or from its strength', () => {
    const weak = { effects: [{ check: { attrs: ['str' as const] }, bonus: 1 }] }
    expect(perkRarity(weak)).toBe('common')
    expect(perkRarity({ ...weak, rarity: 'epic' })).toBe('epic')
    expect(perkRarity({ ...weak, rarity: 'shiny' })).toBe('common')
    expect(perkDraw({ ...weak, rarity: 'legendary' }).color).toBe('var(--r-legendary)')
  })

  it('the content editor keeps a valid rarity only', () => {
    const p = perkRules.perks.find((x) => !x.race && !x.flaw)!
    expect(sanitizePerkMod(p.id, { ...p, rarity: 'rare' }, false)!.rarity).toBe('rare')
    expect(sanitizePerkMod(p.id, { ...p, rarity: 'mythic' }, false)!.rarity).toBeUndefined()
  })
})
