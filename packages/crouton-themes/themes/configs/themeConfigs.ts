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
//
// Components WITHOUT a `variant` dimension (USwitch, UModal, USlideover,
// UToast, UPagination, USlider, UColorPicker) are themed AMBIENTLY instead —
// theme-scoped CSS in each theme's main.css covering both activation paths
// ([data-theme="x"] from app presets, .theme-x body class from
// useThemeSwitcher). See #1307/#1393/#1458.

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
  select?: { defaultVariants?: { variant?: string } }
  selectMenu?: { defaultVariants?: { variant?: string } }
  textarea?: { defaultVariants?: { variant?: string } }
  tabs?: { defaultVariants?: { variant?: string } }
  checkbox?: { defaultVariants?: { variant?: string } }
  radioGroup?: { defaultVariants?: { variant?: string } }
  alert?: { defaultVariants?: { variant?: string } }
  calendar?: { defaultVariants?: { variant?: string } }
}

// Every config sets EVERY key the swap owns, so switching A → B never leaves
// A's value behind (deepAssign only overwrites what the new object names).

// Builds the common shape: every component key set to the SAME named variant.
// Nuxt UI's own defaults (the reset values) are in defaultConfig below.
const namedVariantConfig = (
  variant: string,
  colors: { primary: string, neutral: string },
  overrides: Partial<ThemeUIConfig> = {}
): ThemeUIConfig => ({
  colors,
  button: { defaultVariants: { variant } },
  input: { defaultVariants: { variant } },
  card: { defaultVariants: { variant } },
  badge: { defaultVariants: { variant } },
  select: { defaultVariants: { variant } },
  selectMenu: { defaultVariants: { variant } },
  textarea: { defaultVariants: { variant } },
  tabs: { defaultVariants: { variant } },
  checkbox: { defaultVariants: { variant } },
  radioGroup: { defaultVariants: { variant } },
  alert: { defaultVariants: { variant } },
  calendar: { defaultVariants: { variant } },
  ...overrides
})

// Default theme — Nuxt UI's own defaults, restated as the reset values.
const defaultConfig: ThemeUIConfig = {
  colors: {
    primary: 'emerald',
    neutral: 'slate'
  },
  button: { defaultVariants: { variant: 'solid' } },
  input: { defaultVariants: { variant: 'outline' } },
  card: { defaultVariants: { variant: 'outline' } },
  badge: { defaultVariants: { variant: 'solid' } },
  select: { defaultVariants: { variant: 'outline' } },
  selectMenu: { defaultVariants: { variant: 'outline' } },
  textarea: { defaultVariants: { variant: 'outline' } },
  tabs: { defaultVariants: { variant: 'pill' } },
  checkbox: { defaultVariants: { variant: 'list' } },
  radioGroup: { defaultVariants: { variant: 'list' } },
  alert: { defaultVariants: { variant: 'solid' } },
  calendar: { defaultVariants: { variant: 'solid' } }
}

// KO — named variants registered by ko/app.config.ts (variant="ko" etc.)
// Badge keeps Nuxt UI's solid: the semantic palette does the work (no ko badge
// variant registered in the layer).
const koConfig = namedVariantConfig('ko', { primary: 'orange', neutral: 'stone' }, {
  badge: { defaultVariants: { variant: 'solid' } }
})

// Minimal — named variants registered by minimal/app.config.ts (badge: same
// deliberate pass as ko).
const minimalConfig = namedVariantConfig('minimal', { primary: 'zinc', neutral: 'zinc' }, {
  badge: { defaultVariants: { variant: 'solid' } }
})

// KR-11 — named variants registered by kr11/app.config.ts
const kr11Config = namedVariantConfig('kr11', { primary: 'emerald', neutral: 'stone' })

// Black & White — a DELIBERATE pass on named chrome (#1393): bw's design IS
// Nuxt UI's standard variants under a strict neutral/neutral palette; only
// buttons carry named bw-* variants. Everything else stays on the standard
// variants the layer's own defaultVariants point at.
const blackandwhiteConfig: ThemeUIConfig = {
  colors: { primary: 'neutral', neutral: 'neutral' },
  button: { defaultVariants: { variant: 'bw-solid' } },
  input: { defaultVariants: { variant: 'subtle' } },
  card: { defaultVariants: { variant: 'outline' } },
  badge: { defaultVariants: { variant: 'solid' } },
  select: { defaultVariants: { variant: 'subtle' } },
  selectMenu: { defaultVariants: { variant: 'subtle' } },
  textarea: { defaultVariants: { variant: 'subtle' } },
  tabs: { defaultVariants: { variant: 'pill' } },
  checkbox: { defaultVariants: { variant: 'list' } },
  radioGroup: { defaultVariants: { variant: 'list' } },
  alert: { defaultVariants: { variant: 'subtle' } },
  calendar: { defaultVariants: { variant: 'solid' } }
}

// Brutalist — named variants registered by brutalist/app.config.ts
const brutalistConfig = namedVariantConfig('brutalist', { primary: 'yellow', neutral: 'neutral' })

// MTV — named variants registered by mtv/app.config.ts
const mtvConfig = namedVariantConfig('mtv', { primary: 'fuchsia', neutral: 'zinc' })

// Terminal — named variants registered by terminal/app.config.ts
const terminalConfig = namedVariantConfig('terminal', { primary: 'green', neutral: 'zinc' })

// Braun — named variants registered by braun/app.config.ts
const braunConfig = namedVariantConfig('braun', { primary: 'orange', neutral: 'stone' })

// Game Boy — named variants registered by gameboy/app.config.ts
const gameboyConfig = namedVariantConfig('gameboy', { primary: 'green', neutral: 'stone' })

// Riso / E-ink / Blueprint — named variants registered by their layers (#1311)
const risoConfig = namedVariantConfig('riso', { primary: 'pink', neutral: 'stone' })
const einkConfig = namedVariantConfig('eink', { primary: 'neutral', neutral: 'neutral' })
const blueprintConfig = namedVariantConfig('blueprint', { primary: 'sky', neutral: 'slate' })

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
  braun: braunConfig,
  gameboy: gameboyConfig,
  riso: risoConfig,
  eink: einkConfig,
  blueprint: blueprintConfig
}
