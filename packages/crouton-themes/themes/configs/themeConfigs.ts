// Theme UI Configurations — the RUNTIME side of theme switching.
//
// ⚠️ Scalars only. `updateAppConfig()` merges with Nuxt's deepAssign, which
// merges ARRAYS BY INDEX — a runtime write to `compoundVariants` overwrites
// whatever entries happen to sit at those indices in the built config (the
// #1306/#1304 playground bug: the layer-registered named variants lost their
// compounds on every switch). So a theme's classes/variants/compoundVariants
// live ONLY in its layer app.config (build-time, merge-safe); the runtime swap
// is limited to scalar leaves:
//   - `colors.*`                → the semantic palette
//   - `<component>.defaultVariants.variant` → which (named) variant plain,
//     variant-less usage resolves to, e.g. <UButton> → variant "ko"
// Explicitly-set variants are the author's choice and are not remapped; use
// useThemeSwitcher().getVariant('outline') to follow the active theme.

import type { ThemeName } from '../composables/useThemeSwitcher'

export interface ThemeUIConfig {
  colors?: {
    primary?: string
    neutral?: string
  }
  button?: { defaultVariants?: { variant?: string } }
  input?: { defaultVariants?: { variant?: string } }
  card?: { defaultVariants?: { variant?: string } }
  badge?: { defaultVariants?: { variant?: string } }
}

// Every config sets EVERY key the swap owns, so switching A → B never leaves
// A's value behind (deepAssign only overwrites what the new object names).

// Default theme — Nuxt UI's own defaults, restated as the reset values.
const defaultConfig: ThemeUIConfig = {
  colors: {
    primary: 'emerald',
    neutral: 'slate'
  },
  button: { defaultVariants: { variant: 'solid' } },
  input: { defaultVariants: { variant: 'outline' } },
  card: { defaultVariants: { variant: 'outline' } },
  badge: { defaultVariants: { variant: 'solid' } }
}

// KO — named variants registered by ko/app.config.ts (variant="ko" etc.)
const koConfig: ThemeUIConfig = {
  colors: {
    primary: 'orange',
    neutral: 'stone'
  },
  button: { defaultVariants: { variant: 'ko' } },
  input: { defaultVariants: { variant: 'ko' } },
  card: { defaultVariants: { variant: 'ko' } },
  badge: { defaultVariants: { variant: 'solid' } }
}

// Minimal — named variants registered by minimal/app.config.ts
const minimalConfig: ThemeUIConfig = {
  colors: {
    primary: 'zinc',
    neutral: 'zinc'
  },
  button: { defaultVariants: { variant: 'minimal' } },
  input: { defaultVariants: { variant: 'minimal' } },
  card: { defaultVariants: { variant: 'minimal' } },
  badge: { defaultVariants: { variant: 'solid' } }
}

// KR-11 — named variants registered by kr11/app.config.ts
const kr11Config: ThemeUIConfig = {
  colors: {
    primary: 'emerald',
    neutral: 'stone'
  },
  button: { defaultVariants: { variant: 'kr11' } },
  input: { defaultVariants: { variant: 'kr11' } },
  card: { defaultVariants: { variant: 'kr11' } },
  badge: { defaultVariants: { variant: 'kr11' } }
}

// Black & White — named bw-* variants registered by blackandwhite/app.config.ts
// (the layer also sets defaultVariants itself, so single-theme bw apps need no
// runtime swap; these values are for switching TO bw in a multi-theme app).
const blackandwhiteConfig: ThemeUIConfig = {
  colors: {
    primary: 'neutral',
    neutral: 'neutral'
  },
  button: { defaultVariants: { variant: 'bw-solid' } },
  input: { defaultVariants: { variant: 'subtle' } },
  card: { defaultVariants: { variant: 'outline' } },
  badge: { defaultVariants: { variant: 'solid' } }
}

// Brutalist — named variants registered by brutalist/app.config.ts
const brutalistConfig: ThemeUIConfig = {
  colors: {
    primary: 'yellow',
    neutral: 'neutral'
  },
  button: { defaultVariants: { variant: 'brutalist' } },
  input: { defaultVariants: { variant: 'brutalist' } },
  card: { defaultVariants: { variant: 'brutalist' } },
  badge: { defaultVariants: { variant: 'brutalist' } }
}

// MTV — named variants registered by mtv/app.config.ts
const mtvConfig: ThemeUIConfig = {
  colors: {
    primary: 'fuchsia',
    neutral: 'zinc'
  },
  button: { defaultVariants: { variant: 'mtv' } },
  input: { defaultVariants: { variant: 'mtv' } },
  card: { defaultVariants: { variant: 'mtv' } },
  badge: { defaultVariants: { variant: 'mtv' } }
}

// Terminal — named variants registered by terminal/app.config.ts
const terminalConfig: ThemeUIConfig = {
  colors: {
    primary: 'green',
    neutral: 'zinc'
  },
  button: { defaultVariants: { variant: 'terminal' } },
  input: { defaultVariants: { variant: 'terminal' } },
  card: { defaultVariants: { variant: 'terminal' } },
  badge: { defaultVariants: { variant: 'terminal' } }
}

// Braun — named variants registered by braun/app.config.ts
const braunConfig: ThemeUIConfig = {
  colors: {
    primary: 'orange',
    neutral: 'stone'
  },
  button: { defaultVariants: { variant: 'braun' } },
  input: { defaultVariants: { variant: 'braun' } },
  card: { defaultVariants: { variant: 'braun' } },
  badge: { defaultVariants: { variant: 'braun' } }
}

// Export all theme configs
export const THEME_UI_CONFIGS: Record<ThemeName, ThemeUIConfig> = {
  default: defaultConfig,
  ko: koConfig,
  minimal: minimalConfig,
  kr11: kr11Config,
  blackandwhite: blackandwhiteConfig,
  brutalist: brutalistConfig,
  mtv: mtvConfig,
  terminal: terminalConfig,
  braun: braunConfig
}
