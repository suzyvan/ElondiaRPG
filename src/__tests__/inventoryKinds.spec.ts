import { describe, expect, it } from 'vitest'
import { newGame } from '@/engine/state'
import { gearKindOf, isSpecialGear } from '@/components/items/itemInfo'
import { sellPrice, shopKey } from '@/engine/trade'

describe('行囊的裝備小分類與「特殊」', () => {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1 })

  it('不能賣的裝備（獨特）算特殊，一般裝備不算', () => {
    expect(isSpecialGear(state, '說客的貼身短褲')).toBe(true)
    expect(isSpecialGear(state, '燭龍君的玉圭')).toBe(true)
    expect(isSpecialGear(state, '真狼牙皮繩項鍊')).toBe(false)
    expect(isSpecialGear(state, '治療藥水')).toBe(false)
  })

  it('只帶屬性或詛咒、不是獨特的拘束具商店照收，不算特殊（和商店收購同一個判斷）', () => {
    for (const n of ['奴隸項圈', '壓制項圈', '貞操帶']) {
      expect(isSpecialGear(state, n)).toBe(false)
      expect(sellPrice(state, shopKey(state, 'smithy'), n)).not.toBeNull()
    }
    expect(sellPrice(state, shopKey(state, 'smithy'), '燭龍君的玉圭')).toBeNull()
  })

  it('依底材放的位置分成武器、防具、飾品、內衣', () => {
    expect(gearKindOf(state, '真狼牙皮繩項鍊')).toBe('jewelry')
    expect(gearKindOf(state, '說客的貼身短褲')).toBe('underwear')
    expect(gearKindOf(state, '燭龍君的玉圭')).toBe('weapon')
    expect(gearKindOf(state, '治療藥水')).toBeUndefined()
  })
})
