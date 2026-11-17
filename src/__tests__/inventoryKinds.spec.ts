import { describe, expect, it } from 'vitest'
import { newGame } from '@/engine/state'
import { gearKindOf, isSpecialGear } from '@/components/items/itemInfo'

describe('行囊的裝備小分類與「特殊」', () => {
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1 })

  it('不能賣的裝備（獨特）算特殊，一般裝備不算', () => {
    expect(isSpecialGear(state, '說客的貼身短褲')).toBe(true)
    expect(isSpecialGear(state, '燭龍君的玉圭')).toBe(true)
    expect(isSpecialGear(state, '真狼牙皮繩項鍊')).toBe(false)
    expect(isSpecialGear(state, '治療藥水')).toBe(false)
  })

  it('依底材放的位置分成武器、防具、飾品、內衣', () => {
    expect(gearKindOf(state, '真狼牙皮繩項鍊')).toBe('jewelry')
    expect(gearKindOf(state, '說客的貼身短褲')).toBe('underwear')
    expect(gearKindOf(state, '燭龍君的玉圭')).toBe('weapon')
    expect(gearKindOf(state, '治療藥水')).toBeUndefined()
  })
})
