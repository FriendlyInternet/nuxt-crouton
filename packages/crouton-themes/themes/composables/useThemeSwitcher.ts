// Theme Switcher Composable
// Provides reactive theme switching across the entire UI
// Uses updateAppConfig() to swap Nuxt UI component styles at runtime

import { THEME_UI_CONFIGS } from '../configs/themeConfigs'

export type ThemeName = 'ko' | 'minimal' | 'kr11' | 'blackandwhite' | 'default'

type BaseVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'link'

export interface ThemeConfig {
  name: ThemeName
  label: string
  description?: string
  /** Color swatches to preview the theme's vibe */
  colors: string[]
  /** Default base variant for this theme (solid, outline, ghost, etc.) */
  defaultVariant: BaseVariant
}

export const AVAILABLE_THEMES: ThemeConfig[] = [
  {
    name: 'default',
    label: 'Default',
    description: 'Nuxt UI default styling',
    colors: ['#10b981', '#6b7280', '#f3f4f6'], // emerald, gray, light gray
    defaultVariant: 'solid'
  },
  {
    name: 'ko',
    label: 'KO',
    description: 'Hardware-inspired (Teenage Engineering)',
    colors: ['#f97316', '#1c1917', '#faf5f0'], // orange, dark, cream
    defaultVariant: 'solid' // KO uses solid tactile buttons
  },
  {
    name: 'minimal',
    label: 'Minimal',
    description: 'Clean, Bauhaus-inspired',
    colors: ['#000000', '#ffffff', '#e5e5e5'], // black, white, light gray
    defaultVariant: 'outline' // Minimal uses clean outlined style
  },
  {
    name: 'kr11',
    label: 'KR-11',
    description: 'Friendly drum machine aesthetic',
    colors: ['#6ee7b7', '#fcd34d', '#fca5a5'], // mint, gold, coral
    defaultVariant: 'soft' // KR-11 uses soft tactile pads
  },
  {
    name: 'blackandwhite',
    label: 'Black & White',
    description: 'Compact monochrome dashboard theme',
    colors: ['#000000', '#525252', '#ffffff'], // black, neutral, white
    defaultVariant: 'outline' // Black & White favors outline/subtle surfaces
  }
]

const STORAGE_KEY = 'nuxt-crouton-theme'

export function useThemeSwitcher() {
  const appConfig = useAppConfig()

  // Reactive theme state - uses useState for SSR compatibility
  const currentTheme = useState<ThemeName>('crouton-theme', () => 'default')

  // SSR-safe localStorage persistence via VueUse
  const storedTheme = useLocalStorage<ThemeName>(STORAGE_KEY, 'default')

  // Initialize from stored preference on client
  if (import.meta.client && AVAILABLE_THEMES.some(t => t.name === storedTheme.value)) {
    currentTheme.value = storedTheme.value
  }

  // Computed for current theme config
  const currentThemeConfig = computed(() =>
    AVAILABLE_THEMES.find(t => t.name === currentTheme.value) ?? AVAILABLE_THEMES[0]
  )

  // Get the variant name for Nuxt UI components.
  // 'default' returns undefined to use Nuxt UI's default variant. 'blackandwhite'
  // also returns undefined: unlike ko/minimal/kr11 (which register a *named*
  // `variant="<theme>"` value), blackandwhite overrides the standard variant
  // slots directly (solid/outline/soft/ghost/link -> bw-*), so plain UButton
  // usage with no explicit variant already renders themed.
  const variant = computed(() =>
    currentTheme.value === 'default' || currentTheme.value === 'blackandwhite'
      ? undefined
      : currentTheme.value
  )

  // Set theme and persist
  function setTheme(theme: ThemeName) {
    currentTheme.value = theme
    storedTheme.value = theme

    // Swap Nuxt UI component styles via updateAppConfig
    // Using 'as any' because Nuxt UI's auto-generated types are complex
    // and don't match our simplified ThemeUIConfig interface
    const themeUIConfig = THEME_UI_CONFIGS[theme]
    if (themeUIConfig) {
      updateAppConfig({
        ui: themeUIConfig as any
      })
    }
  }

  // Cycle through themes
  function cycleTheme() {
    const currentIndex = AVAILABLE_THEMES.findIndex(t => t.name === currentTheme.value)
    const nextIndex = (currentIndex + 1) % AVAILABLE_THEMES.length
    setTheme(AVAILABLE_THEMES[nextIndex]!.name)
  }

  // Manage body class for theme-specific CSS variables via useHead
  useHead({
    bodyAttrs: {
      class: computed(() => {
        const theme = currentTheme.value
        return theme !== 'default' ? `theme-${theme}` : ''
      })
    }
  })

  // Initialize theme UI config on client
  if (import.meta.client) {
    const themeUIConfig = THEME_UI_CONFIGS[currentTheme.value]
    if (themeUIConfig) {
      updateAppConfig({
        ui: themeUIConfig as any
      })
    }
  }

  // Get variant with theme prefix for compound variants
  // e.g., getVariant('ghost') returns 'ko-ghost' when KO theme is active.
  // blackandwhite has no prefixed variants (see `variant` above) — it remaps
  // the base variant name itself, so the base variant passes through unchanged.
  function getVariant(baseVariant: string = 'solid'): string {
    if (currentTheme.value === 'default' || currentTheme.value === 'blackandwhite') return baseVariant
    return `${currentTheme.value}-${baseVariant}`
  }

  return {
    // State
    currentTheme: readonly(currentTheme),
    currentThemeConfig,
    variant,
    themes: AVAILABLE_THEMES,

    // Actions
    setTheme,
    cycleTheme,
    getVariant
  }
}