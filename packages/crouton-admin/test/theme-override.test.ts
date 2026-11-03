import { describe, it, expect } from 'vitest'
import { pickThemeOverride, shouldClearOverride } from '../app/utils/theme-override'

/**
 * #2257 — a theme pick saved in localStorage (`nuxt-crouton-theme`) must only
 * apply when THIS app ships that theme. localStorage is per origin, so on
 * localhost a pick made in another crouton app leaks in; applying a theme whose
 * named variants aren't built leaves buttons fill-less and inputs border-less.
 *
 * `registered` = the app's built button variants (appConfig.ui.button.variants.variant).
 */
const WITH_KO = { solid: '', outline: '', ko: '' } // app extends the KO theme layer
const WITHOUT_THEMES = { solid: '', outline: '' } // app ships no theme layer (e.g. velo)

describe('pickThemeOverride', () => {
  it('ignores an empty or default pick', () => {
    expect(pickThemeOverride(null, true, WITH_KO)).toBeNull()
    expect(pickThemeOverride('default', true, WITH_KO)).toBeNull()
  })

  it('ignores any pick when the team locks themes', () => {
    expect(pickThemeOverride('ko', false, WITH_KO)).toBeNull()
  })

  it('ignores a name that is not a crouton theme', () => {
    expect(pickThemeOverride('not-a-theme', true, WITH_KO)).toBeNull()
  })

  it('applies a pick the app actually ships', () => {
    expect(pickThemeOverride('ko', true, WITH_KO)).toBe('ko')
  })

  it('ignores a pick the app does not ship (the #2257 bug)', () => {
    expect(pickThemeOverride('ko', true, WITHOUT_THEMES)).toBeNull()
  })
})

describe('shouldClearOverride', () => {
  it('clears a lingering pick when the team locks themes', () => {
    expect(shouldClearOverride('ko', false, WITH_KO)).toBe(true)
  })

  it('clears a pick the app does not ship, so it cannot come back on reload', () => {
    expect(shouldClearOverride('ko', true, WITHOUT_THEMES)).toBe(true)
  })

  it('keeps a usable pick', () => {
    expect(shouldClearOverride('ko', true, WITH_KO)).toBe(false)
  })

  it('has nothing to clear when there is no pick', () => {
    expect(shouldClearOverride(null, true, WITHOUT_THEMES)).toBe(false)
    expect(shouldClearOverride('default', false, WITHOUT_THEMES)).toBe(false)
  })
})
