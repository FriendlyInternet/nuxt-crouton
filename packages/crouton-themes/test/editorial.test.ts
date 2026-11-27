import { describe, it, expect } from 'vitest'
import { THEME_PRESET_REGISTRY } from '../themes/configs/presets'
import { subtractThemeDefaults } from '../lib/subtractive'
// The admin's real decider (what the team-theme plugin runs). Imported by
// relative path so this ticket's T3 lives in the package it approves.
import { pickThemeOverride, shouldClearOverride } from '../../crouton-admin/app/utils/theme-override'

/**
 * #4520 — the editorial theme: registered for the team Look-and-Feel picker
 * (the registry is what crouton-admin reads), and the shared style stripper
 * removes Nuxt UI's default look under its marker while keeping geometry.
 */
describe('editorial theme registry', () => {
  // covers: T1
  it('offers editorial in the picker registry with every component on its named variant', () => {
    const named = { defaultVariants: { variant: 'editorial' } }
    expect(THEME_PRESET_REGISTRY.editorial).toEqual({
      label: 'Editorial',
      description: 'Book-style serif on white, sans controls, grey pill buttons',
      previewPrimary: '#F3F3F2',
      previewNeutral: '#282828',
      checkVariant: 'editorial',
      colorMode: 'light',
      ui: {
        colors: { primary: 'neutral', neutral: 'neutral' },
        button: named,
        input: named,
        card: named,
        badge: { defaultVariants: { variant: 'solid' } },
        select: named,
        selectMenu: named,
        textarea: named,
        tabs: named,
        checkbox: named,
        radioGroup: named,
        alert: named,
        calendar: named,
        pinInput: named
      }
    })
  })
})

describe('editorial subtraction', () => {
  // covers: T2
  it('strips Nuxt UI defaults under an editorial button and keeps geometry + focus ring', () => {
    expect(subtractThemeDefaults(
      'rounded-md shadow-xs bg-primary text-inverted font-medium px-3 py-2 text-sm focus-visible:outline-2 editorial-btn'
    )).toBe('px-3 py-2 text-sm focus-visible:outline-2 editorial-btn')
  })

  // covers: T2
  it('leaves a string with no editorial marker unchanged', () => {
    const plain = 'rounded-md shadow-xs bg-primary text-inverted font-medium px-3 py-2 text-sm'
    expect(subtractThemeDefaults(plain)).toBe(plain)
  })
})

describe('saved editorial pick', () => {
  // covers: T3
  it('applies only in apps that ship the editorial layer, and is cleared elsewhere', () => {
    expect(pickThemeOverride('editorial', true, { solid: '', editorial: '' })).toBe('editorial')
    expect(pickThemeOverride('editorial', true, { solid: '', outline: '' })).toBeNull()
    expect(shouldClearOverride('editorial', true, { solid: '', outline: '' })).toBe(true)
  })
})
