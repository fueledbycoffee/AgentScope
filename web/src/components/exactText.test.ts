import { describe, expect, it } from 'vitest'
import { groupExactText } from './exactText'

describe('groupExactText', () => {
  it('groups the integer part without losing digits above Number.MAX_SAFE_INTEGER', () => {
    const text = '9007199254740993.5'
    expect(groupExactText(text)).toBe('9,007,199,254,740,993.5')
    expect(Number(text).toString()).not.toBe(text)
  })

  it('preserves signs, fractions, short values, and non-decimal text', () => {
    expect(groupExactText('-1234.50')).toBe('-1,234.50')
    expect(groupExactText('+1234567')).toBe('+1,234,567')
    expect(groupExactText('42')).toBe('42')
    expect(groupExactText('1e6')).toBe('1e6')
  })
})
