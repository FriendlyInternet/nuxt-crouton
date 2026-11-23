import { describe, it, expect, vi } from 'vitest'
import { createTV } from 'tailwind-variants'
import { disabledButtonCompoundVariants } from '../app/theme/disabled-button'

// Stand-in for Nuxt UI 4.11.3's button theme (dist/shared/ui.*.mjs `button`):
// the same base slot, a `loading` variant, and the per-colour compound strings
// for solid/outline/soft/subtle/ghost/link. Button.vue resolves its classes with
// `tv({ extend: tv(theme), ...appConfig.ui.button })` — that is what we replay here.
const colors = ['primary', 'error']
const nuxtUiButtonTheme = {
  slots: {
    base: 'rounded-md font-medium inline-flex items-center disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:opacity-75 aria-disabled:opacity-75 transition-colors'
  },
  variants: {
    color: Object.fromEntries(colors.map(c => [c, ''])),
    variant: { 'solid': '', 'outline': '', 'soft': '', 'subtle': '', 'ghost': '', 'link': '', 'minimal-solid': 'minimal-solid-look' },
    loading: { true: '' }
  },
  compoundVariants: [
    ...colors.map(color => ({ color, variant: 'solid', class: `text-inverted bg-${color} hover:bg-${color}/75 active:bg-${color}/75 disabled:bg-${color} aria-disabled:bg-${color} outline-${color}/25 focus-visible:outline-3` })),
    ...colors.map(color => ({ color, variant: 'outline', class: `ring ring-inset ring-${color}/50 text-${color} hover:bg-${color}/10 active:bg-${color}/10 disabled:bg-transparent aria-disabled:bg-transparent dark:disabled:bg-transparent dark:aria-disabled:bg-transparent outline-${color}/25 focus-visible:outline-3 focus-visible:ring-${color}` })),
    ...colors.map(color => ({ color, variant: 'soft', class: `text-${color} bg-${color}/10 hover:bg-${color}/15 active:bg-${color}/15 outline-${color}/25 focus-visible:outline-3 disabled:bg-${color}/10 aria-disabled:bg-${color}/10` })),
    ...colors.map(color => ({ color, variant: 'subtle', class: `text-${color} ring ring-inset ring-${color}/25 bg-${color}/10 hover:bg-${color}/15 active:bg-${color}/15 disabled:bg-${color}/10 aria-disabled:bg-${color}/10 outline-${color}/25 focus-visible:outline-3 focus-visible:ring-${color}` })),
    ...colors.map(color => ({ color, variant: 'ghost', class: `text-${color} hover:bg-${color}/10 active:bg-${color}/10 outline-${color}/25 focus-visible:outline-3 disabled:bg-transparent aria-disabled:bg-transparent dark:disabled:bg-transparent dark:aria-disabled:bg-transparent` })),
    ...colors.map(color => ({ color, variant: 'link', class: `text-${color} hover:text-${color}/75 active:text-${color}/75 disabled:text-${color} aria-disabled:text-${color} outline-${color}/25 focus-visible:outline-3` }))
  ]
}

const tv = createTV()
const base = tv(nuxtUiButtonTheme as any)
const withOverride = tv({ extend: base, compoundVariants: disabledButtonCompoundVariants } as any)
const withoutOverride = tv({ extend: base } as any)

const classesOf = (fn: any, props: Record<string, unknown>) =>
  String(fn(props).base()).split(/\s+/)

describe('disabled button look (#4329)', () => {
  it('T1 — solid/soft/subtle get a neutral fill + muted text, colour fill merged away', () => {
    for (const color of colors) {
      for (const variant of ['solid', 'soft', 'subtle']) {
        const cls = classesOf(withOverride, { color, variant, loading: false })
        expect(cls).toContain('disabled:bg-elevated')
        expect(cls).toContain('aria-disabled:bg-elevated')
        expect(cls).toContain('disabled:text-muted')
        expect(cls).not.toContain(`disabled:bg-${color}`)
        expect(cls).not.toContain(`disabled:bg-${color}/10`)
        expect(cls).not.toContain(`aria-disabled:bg-${color}`)
        expect(cls).not.toContain(`aria-disabled:bg-${color}/10`)
        // enabled look untouched; opacity fade kept
        expect(cls).toContain('disabled:opacity-75')
      }
    }
  })

  it('T2 — outline/ghost/link get muted text; outline/subtle get a grey ring', () => {
    for (const color of colors) {
      for (const variant of ['outline', 'ghost', 'link']) {
        const cls = classesOf(withOverride, { color, variant, loading: false })
        expect(cls).toContain('disabled:text-muted')
        expect(cls).toContain('aria-disabled:text-muted')
        expect(cls).not.toContain(`disabled:text-${color}`)
      }
      for (const variant of ['outline', 'subtle']) {
        const cls = classesOf(withOverride, { color, variant, loading: false })
        expect(cls).toContain('disabled:ring-accented')
        expect(cls).toContain('aria-disabled:ring-accented')
      }
    }
  })

  it('T3 — loading buttons and theme-named variants are byte-identical to no override', () => {
    for (const color of colors) {
      for (const variant of ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link']) {
        const props = { color, variant, loading: true }
        expect(withOverride(props).base()).toBe(withoutOverride(props).base())
      }
      for (const loading of [true, false]) {
        const props = { color, variant: 'minimal-solid', loading }
        expect(withOverride(props).base()).toBe(withoutOverride(props).base())
      }
    }
  })

  it('T4 — app/app.config.ts wires the override into ui.button.compoundVariants', async () => {
    vi.stubGlobal('defineAppConfig', (c: unknown) => c)
    const { default: config } = await import('../app/app.config') as any
    expect(config.ui.button.compoundVariants).toBe(disabledButtonCompoundVariants)
    expect(config.croutonCollections.croutonRedirects).toBeDefined()
    vi.unstubAllGlobals()
  })
})
