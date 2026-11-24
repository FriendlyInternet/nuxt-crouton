import { describe, it, expect } from 'vitest'
import { showPresetPicker, colorLabel, radiusLabel } from '../app/utils/theme-picker'

/**
 * #4479 — the Look & Feel page hides the preset list when "Custom" is the only
 * option, and each picker card names the current choice in plain words.
 */
describe('showPresetPicker', () => {
  // covers: T1
  it('hides the list when Custom is the only preset and nothing else is saved', () => {
    expect(showPresetPicker({ custom: {} }, undefined)).toBe(false)
    expect(showPresetPicker({ custom: {} }, 'custom')).toBe(false)
  })

  // covers: T1
  it('shows the list when the app ships more than one preset', () => {
    expect(showPresetPicker({ custom: {}, ko: {} }, undefined)).toBe(true)
  })

  // covers: T1
  it('shows the list when the team saved a named preset', () => {
    expect(showPresetPicker({ custom: {} }, 'ko')).toBe(true)
  })
})

describe('colorLabel', () => {
  // covers: T1
  it('capitalises the palette name', () => {
    expect(colorLabel('emerald')).toBe('Emerald')
    expect(colorLabel('zinc')).toBe('Zinc')
    expect(colorLabel(undefined)).toBe('')
  })
})

describe('radiusLabel', () => {
  // covers: T1
  it('names the five corner values', () => {
    expect(radiusLabel(0)).toBe('Square')
    expect(radiusLabel(0.125)).toBe('Slight')
    expect(radiusLabel(0.25)).toBe('Soft')
    expect(radiusLabel(0.375)).toBe('Rounded')
    expect(radiusLabel(0.5)).toBe('Round')
  })

  // covers: T1
  it('falls back to the number for an unknown value', () => {
    expect(radiusLabel(0.3)).toBe('0.3')
  })

  // covers: T1
  it('passes the locale key through the translator when given', () => {
    expect(radiusLabel(0, k => 'T:' + k)).toBe('T:themeSettings.radiusSquare')
  })
})
