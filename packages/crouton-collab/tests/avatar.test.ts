import { describe, it, expect } from 'vitest'
import { generateUserColor, getTextColor } from '../app/utils/avatar'

const hueOf = (c: string) => Number(c.match(/hsl\((\d+)/)![1])

describe('generateUserColor', () => {
  it('is stable per id', () => {
    expect(generateUserColor('u1')).toBe(generateUserColor('u1'))
  })

  it('gives 6 sequential ids hues at least 25° apart', () => {
    const hues = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'].map(id => hueOf(generateUserColor(id)))
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i]! - hues[j]!)
        expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(25)
      }
    }
  })
})

describe('getTextColor', () => {
  it('handles hex', () => {
    expect(getTextColor('#ffffff')).toBe('#1f2937')
    expect(getTextColor('#000000')).toBe('white')
  })
  it('handles hsl by lightness', () => {
    expect(getTextColor('hsl(90, 70%, 80%)')).toBe('#1f2937')
    expect(getTextColor('hsl(90, 65%, 45%)')).toBe('white')
  })
})
