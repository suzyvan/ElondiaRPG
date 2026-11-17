import { describe, expect, it } from 'vitest'
import { travelEvents } from '@/engine/road'
import { EVENT_SCOPES, sanitizeTravelEvent, newTravelEvent } from '@/engine/travelEventMods'
import { changeEventType, EVENT_TYPES, eventIcon, eventTypeOf } from '@/components/content/events/eventTypes'

describe('世界編輯器的事件類型表', () => {
  it('每一種事件都有類型，清單的說明都寫得出來', () => {
    expect(EVENT_TYPES.map((t) => t.id).sort()).toEqual([...EVENT_SCOPES].sort())
    for (const t of travelEvents.templates) {
      const def = eventTypeOf(t)
      expect(def.id).toBe(t.scope ?? 'road')
      expect(typeof def.note(t)).toBe('string')
      expect(eventIcon(t)).toBeTruthy()
    }
    // 泌乳、苗床的事件不再寫成旅途的「任何路段」
    for (const id of ['lactation', 'brood'] as const) {
      const t = newTravelEvent(`x_${id}`, id)
      expect(eventTypeOf(t).note(t)).not.toContain('路段')
    }
  })

  it('發生在主角身上的類型只有選擇，換類型時補上預設值', () => {
    const d = newTravelEvent('x', 'road')
    d.kind = 'check'
    d.tier = 'advanced'
    changeEventType(d, 'dungeon')
    expect(d.scope).toBe('dungeon')
    expect(d.kind).toBe('choice')
    expect(d.tier).toBe('normal')
    expect(d.triggers).toEqual(['trap'])
    expect(d.options?.length).toBeGreaterThan(0)
    changeEventType(d, 'pregnancy')
    expect(d.subject).toBe('pc')
    expect(d.tags).toEqual(expect.arrayContaining(['adult', 'pregnancy']))
    changeEventType(d, 'road')
    expect(d.scope).toBeUndefined()
    // 整理過後就是旅途事件
    expect(sanitizeTravelEvent('x', d, true).scope).toBeUndefined()
  })

  it('類型專屬欄位只列在那個類型', () => {
    const fieldsOf = (id: string) => EVENT_TYPES.find((t) => t.id === id)!.fields
    expect(fieldsOf('road')).toEqual(expect.arrayContaining(['kind', 'tier', 'modes']))
    expect(fieldsOf('town')).not.toContain('tier')
    expect(fieldsOf('dungeon')).not.toContain('kind')
    expect(fieldsOf('lead')).not.toContain('hours')
    expect(EVENT_TYPES.filter((t) => t.fields.includes('tier')).map((t) => t.id)).toEqual(['road'])
  })
})
