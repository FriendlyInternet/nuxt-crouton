// Theme UI Configurations
// Each theme defines how standard Nuxt UI variants should look
// These are swapped at runtime via updateAppConfig()

import type { ThemeName } from '../composables/useThemeSwitcher'

// Type for the UI config structure
export interface ThemeUIConfig {
  colors?: {
    primary?: string
    neutral?: string
  }
  button?: {
    variants?: {
      variant?: Record<string, string>
    }
    compoundVariants?: Array<{
      variant?: string
      color?: string
      class: string
    }>
  }
  input?: {
    variants?: {
      variant?: Record<string, string>
    }
    compoundVariants?: Array<{
      variant?: string
      class: string
    }>
  }
  card?: {
    variants?: {
      variant?: Record<string, string>
    }
    compoundVariants?: Array<{
      variant?: string
      class: string
    }>
  }
}

// Default theme - no overrides, use Nuxt UI defaults
const defaultConfig: ThemeUIConfig = {
  colors: {
    primary: 'emerald',
    neutral: 'slate'
  },
  button: {
    compoundVariants: []
  }
}

// KO Theme - Hardware-inspired (Teenage Engineering)
// Override variant classes directly to replace Nuxt UI defaults
const koConfig: ThemeUIConfig = {
  colors: {
    primary: 'orange',
    neutral: 'stone'
  },
  button: {
    // Override variant definitions - these REPLACE Nuxt UI defaults
    variants: {
      variant: {
        solid: 'ko-bezel',
        outline: 'ko-outline',
        soft: 'ko-soft',
        ghost: 'ko-ghost',
        link: 'ko-link'
      }
    },
    // Color-specific adjustments via compoundVariants
    compoundVariants: [
      { variant: 'solid', color: 'primary', class: 'ko-bezel--orange' },
      { variant: 'solid', color: 'neutral', class: 'ko-bezel--dark' },
      { variant: 'solid', color: 'error', class: 'ko-bezel--red' },
      { variant: 'solid', color: 'secondary', class: 'ko-bezel--pink' },
      { variant: 'solid', color: 'info', class: 'ko-bezel--blue' },
      { variant: 'outline', color: 'primary', class: 'ko-outline--orange' },
      { variant: 'outline', color: 'neutral', class: 'ko-outline--dark' },
      { variant: 'outline', color: 'error', class: 'ko-outline--red' },
      { variant: 'ghost', color: 'primary', class: 'ko-ghost--orange' },
      { variant: 'ghost', color: 'neutral', class: 'ko-ghost--dark' }
    ]
  }
}

// Minimal Theme - Clean Bauhaus-inspired
const minimalConfig: ThemeUIConfig = {
  colors: {
    primary: 'zinc',
    neutral: 'zinc'
  },
  button: {
    compoundVariants: [
      // Solid variant overrides
      { variant: 'solid', color: 'primary', class: 'minimal-solid' },
      { variant: 'solid', color: 'neutral', class: 'minimal-solid minimal-solid--neutral' },
      { variant: 'solid', color: 'error', class: 'minimal-solid minimal-solid--error' },
      // Outline variant overrides
      { variant: 'outline', color: 'primary', class: 'minimal-outline' },
      { variant: 'outline', color: 'neutral', class: 'minimal-outline minimal-outline--neutral' },
      { variant: 'outline', color: 'error', class: 'minimal-outline minimal-outline--error' },
      // Ghost variant overrides
      { variant: 'ghost', color: 'primary', class: 'minimal-ghost' },
      { variant: 'ghost', color: 'neutral', class: 'minimal-ghost minimal-ghost--neutral' },
      { variant: 'ghost', color: 'error', class: 'minimal-ghost minimal-ghost--error' }
    ]
  }
}

// KR-11 Theme - Friendly drum machine aesthetic
const kr11Config: ThemeUIConfig = {
  colors: {
    primary: 'emerald',
    neutral: 'stone'
  },
  button: {
    compoundVariants: [
      // Solid variant overrides
      { variant: 'solid', color: 'primary', class: 'kr-solid kr-solid--mint' },
      { variant: 'solid', color: 'neutral', class: 'kr-solid kr-solid--cream' },
      { variant: 'solid', color: 'warning', class: 'kr-solid kr-solid--gold' },
      { variant: 'solid', color: 'error', class: 'kr-solid kr-solid--coral' },
      // Soft variant overrides
      { variant: 'soft', color: 'primary', class: 'kr-soft kr-soft--mint' },
      { variant: 'soft', color: 'neutral', class: 'kr-soft kr-soft--cream' },
      { variant: 'soft', color: 'warning', class: 'kr-soft kr-soft--gold' },
      { variant: 'soft', color: 'error', class: 'kr-soft kr-soft--coral' },
      // Ghost variant overrides
      { variant: 'ghost', color: 'primary', class: 'kr-ghost kr-ghost--mint' },
      { variant: 'ghost', color: 'neutral', class: 'kr-ghost kr-ghost--cream' }
    ]
  }
}

// Black & White Theme - compact monochrome dashboard
// Variant CLASSES are already registered by the theme's own app.config.ts
// (bw-solid/bw-outline/bw-soft/bw-ghost/bw-link); the switcher only needs the
// color palette here since the theme has no per-color compoundVariants.
const blackandwhiteConfig: ThemeUIConfig = {
  colors: {
    primary: 'neutral',
    neutral: 'neutral'
  }
}

// Export all theme configs
export const THEME_UI_CONFIGS: Record<ThemeName, ThemeUIConfig> = {
  default: defaultConfig,
  ko: koConfig,
  minimal: minimalConfig,
  kr11: kr11Config,
  blackandwhite: blackandwhiteConfig
}
