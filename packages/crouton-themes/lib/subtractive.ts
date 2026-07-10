// Shared subtractive-theming helper (Nuxt UI >= 4.9 slot-class replacers, #364/#1304).
//
// A slot value that is a `(defaults) => classes` function REPLACES the resolved
// default classes instead of merging onto them. The function receives the FULLY
// RESOLVED class string for the actual props in play — base + matched variants +
// compoundVariants — which includes the theme marker classes our compoundVariants
// inject (`ko-bezel`, `kr-pad`, `bw-solid`, `minimal-btn`, ...).
//
// That makes ONE marker-gated replacer safe to share across every theme in this
// package, including in multi-theme apps (the playground): each theme's
// subtraction set fires only when that theme's marker is present in the resolved
// string, and an unmarked (default-theme) render passes through untouched. All
// themes assign this same function to the same slot keys, so app.config layer
// merging is order-independent.
//
// Pure + deterministic — SSR and client must compute the identical class string
// (hydration-mismatch rule from #364). No Date/random/env reads here, ever.

type ThemeKey = 'minimal' | 'ko' | 'kr11' | 'bw' | 'brutalist' | 'mtv'

// First matching prefix wins; a resolved string only ever carries one theme's
// markers because `variant` is single-valued and the bw markers live on the
// standard variants no other theme touches.
const MARKERS: Array<[prefix: string, theme: ThemeKey]> = [
  ['minimal-', 'minimal'],
  ['ko-', 'ko'],
  ['kr-', 'kr11'],
  ['bw-', 'bw'],
  ['brutalist-', 'brutalist'],
  ['mtv-', 'mtv']
]

// text-* utilities that are NOT color (sizes, alignment, wrapping) — kept when a
// theme only owns text color, stripped when it owns typography wholesale.
const TEXT_NON_COLOR = /^text-(xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/

const isColor = (u: string): boolean =>
  /^(bg|from|via|to|placeholder|caret|accent|fill|stroke)-/.test(u)
  || (/^text-/.test(u) && !TEXT_NON_COLOR.test(u))

const isDecor = (u: string): boolean =>
  /^-?(rounded|shadow|ring|ring-offset|inset-ring|outline|border|divide)(-|$)/.test(u)

const isMotion = (u: string): boolean =>
  /^(transition|duration|ease|animate)(-|$)/.test(u)

const isType = (u: string): boolean =>
  /^(font|tracking|leading)(-|$)/.test(u)
  || /^(uppercase|lowercase|capitalize|normal-case|italic|not-italic)$/.test(u)

// What each theme's CSS re-supplies, so the conflicting defaults can go.
// NOT stripped anywhere: layout/flex/sizing/spacing (themes keep Nuxt UI's
// geometry — the few `padding` fights keep their `!important` in the CSS).
const STRIP: Record<ThemeKey, (u: string) => boolean> = {
  // Exactly the #364 behaviour: decorative-only (rounded/shadow/ring).
  minimal: u => /^-?(rounded|shadow|ring)(-|$)/.test(u),
  // Skeuomorphic themes own color, decoration, motion AND typography
  // (font-family/size/weight/case all come from the theme CSS).
  ko: u => isColor(u) || /^text-/.test(u) || isDecor(u) || isMotion(u) || isType(u),
  kr11: u => isColor(u) || /^text-/.test(u) || isDecor(u) || isMotion(u) || isType(u),
  // B&W keeps Nuxt UI's rounding + text sizes; owns color, elevation, motion,
  // and link underlines.
  bw: u => isColor(u) || isMotion(u)
    || /^-?(shadow|ring|ring-offset|inset-ring|outline|border)(-|$)/.test(u)
    || /^(no-)?underline(-|$)/.test(u) || /^underline-offset(-|$)/.test(u),
  // Brutalist keeps text sizes + line-height; owns color, decoration, motion,
  // weight/family/tracking/case, and link underlines.
  brutalist: u => isColor(u) || isDecor(u) || isMotion(u)
    || /^(font|tracking)(-|$)/.test(u)
    || /^(uppercase|lowercase|capitalize|normal-case)$/.test(u)
    || /^(no-)?underline(-|$)/.test(u) || /^underline-offset(-|$)/.test(u),
  // MTV: same ownership profile as brutalist (slab formula with neon shadows).
  mtv: u => isColor(u) || isDecor(u) || isMotion(u)
    || /^(font|tracking)(-|$)/.test(u)
    || /^(uppercase|lowercase|capitalize|normal-case)$/.test(u)
    || /^(no-)?underline(-|$)/.test(u) || /^underline-offset(-|$)/.test(u)
}

// a11y guard: none of the themes ship their own button focus styles, so the
// default focus-visible ring must survive subtraction (minimal is exempt only
// because its shipped #364 behaviour already dropped it — see CLAUDE.md).
const keepsFocusVisible = (theme: ThemeKey): boolean => theme !== 'minimal'

const utilOf = (cls: string): string => cls.split(':').pop() ?? cls

export const subtractThemeDefaults = (defaults: string): string => {
  // Double-role guard: Nuxt merges layered app.configs with defu's *fn*
  // variant, which treats a function value as a MERGER and calls it with the
  // lower layer's value (another theme's replacer function, or undefined).
  // Several themes assign this same function to the same slot key, so at
  // merge time we return ourselves — the merged value stays the replacer —
  // and only do real work at render time, when tv passes a string.
  if (typeof (defaults as unknown) !== 'string') {
    return subtractThemeDefaults as unknown as string
  }
  const tokens = defaults.split(/\s+/).filter(Boolean)
  const marker = MARKERS.find(([prefix]) => tokens.some(t => t.startsWith(prefix)))
  if (!marker) return defaults
  const theme = marker[1]
  const kept = tokens.filter((t) => {
    if (keepsFocusVisible(theme) && t.includes('focus-visible:')) return true
    return !STRIP[theme](utilOf(t))
  })
  if (theme === 'minimal') kept.push('minimal-flat')
  return kept.join(' ')
}
