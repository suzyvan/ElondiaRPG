import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGame } from '@/stores/game'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('action rollback', () => {
  it('restores the state when an action throws halfway', () => {
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const money = game.state!.money_cc
    const time = { ...game.state!.time }
    game.runAction((s) => {
      s.money_cc += 999
      s.time.hour = (s.time.hour + 5) % 24
      throw new Error('中途出錯')
    })
    expect(game.error).toBe('中途出錯')
    expect(game.state!.money_cc).toBe(money)
    expect(game.state!.time).toEqual(time)
  })

  it('程式錯誤：還原狀態，訊息的細節附上版本、位置與出錯的地方', () => {
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const money = game.state!.money_cc
    game.runAction((s) => {
      s.money_cc += 999
      const broken = undefined as unknown as { cell: string }
      return broken.cell
    })
    expect(game.state!.money_cc).toBe(money)
    const [summary, ...rest] = game.error!.split('\n')
    expect(summary).toMatch(/cell/)
    const detail = rest.join('\n')
    expect(detail).toContain('這是遊戲程式的錯誤')
    expect(detail).toContain(`版本：${__APP_VERSION__}`)
    expect(detail).toContain(`位置：${game.state!.location}`)
    expect(detail).toContain('出錯的地方：')
  })

  it('keeps the changes of an action that succeeds', () => {
    const game = useGame()
    game.start('艾倫', 'human', 'fighter')
    const money = game.state!.money_cc
    game.runAction((s) => {
      s.money_cc += 10
    })
    expect(game.error).toBeNull()
    expect(game.state!.money_cc).toBe(money + 10)
  })
})
