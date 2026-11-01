import { describe, expect, it } from 'vitest'
import { indexById } from '@/engine/data'

describe('indexById', () => {
  it('finds by id and follows in-place changes to the list', () => {
    const list = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }]
    const find = indexById(list)
    expect(find('b')?.v).toBe(2)
    // 換掉某一筆（自訂內容改了這個任務）：拿到新的那一筆
    list[1] = { id: 'b', v: 20 }
    expect(find('b')?.v).toBe(20)
    // 刪掉前面的、位置往前移：照樣找得到
    list.splice(0, 1)
    expect(find('c')?.v).toBe(3)
    expect(find('a')).toBeUndefined()
    // 新增的
    list.push({ id: 'd', v: 4 })
    expect(find('d')?.v).toBe(4)
    // 整份換掉（還原成內建）
    list.splice(0, list.length, { id: 'x', v: 9 })
    expect(find('b')).toBeUndefined()
    expect(find('x')?.v).toBe(9)
  })
})
