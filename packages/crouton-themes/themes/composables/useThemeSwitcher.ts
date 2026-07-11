// Theme Switcher Composable
// Provides reactive theme switching across the entire UI
// Uses updateAppConfig() to swap Nuxt UI component styles at runtime

import { THEME_UI_CONFIGS } from '../configs/themeConfigs'

export type ThemeName = 'ko' | 'minimal' | 'kr11' | 'blackandwhite' | 'brutalist' | 'mtv' | 'terminal' | 'braun' | 'gameboy' | 'riso' | 'eink' | 'blueprint' | 'default'

type BaseVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'link'

export interface ThemeConfig {
  name: ThemeName
  label: string
  description?: string
  /** Color swatches to preview the theme's vibe */
  colors: string[]
  /** Default base variant for this theme (solid, outline, ghost, etc.) */
  defaultVariant: BaseVariant
  /**
   * The color scheme this theme was DESIGNED in — its default. Applying the
   * theme sets the color mode to it only while the user has no explicit
   * preference (#1395 relaxed the #1387 pin: every theme now ships a designed
   * counterpart palette for the other scheme, so an explicit light/dark
   * choice always wins). Omit for themes that adapt to both (blackandwhite).
   */
  colorMode?: 'light' | 'dark'
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
    defaultVariant: 'solid', // KO uses solid tactile buttons
    colorMode: 'light'
  },
  {
    name: 'minimal',
    label: 'Minimal',
    description: 'Clean, Bauhaus-inspired',
    colors: ['#000000', '#ffffff', '#e5e5e5'], // black, white, light gray
    defaultVariant: 'outline', // Minimal uses clean outlined style
    colorMode: 'light'
  },
  {
    name: 'kr11',
    label: 'KR-11',
    description: 'Friendly drum machine aesthetic',
    colors: ['#b8e9d2', '#e9d227', '#f7d3ca'], // play-mint, FILL-yellow, pad-1 salmon (#1347)
    defaultVariant: 'soft', // KR-11 uses soft tactile pads
    colorMode: 'light'
  },
  {
    name: 'blackandwhite',
    label: 'Black & White',
    description: 'Compact monochrome dashboard theme',
    colors: ['#000000', '#525252', '#ffffff'], // black, neutral, white
    defaultVariant: 'outline' // Black & White favors outline/subtle surfaces
  },
  {
    name: 'brutalist',
    label: 'Brutalist',
    description: 'Thick borders, hard shadows, zero subtlety',
    colors: ['#0a0a0a', '#ffd800', '#fdfbf5'], // ink, shock yellow, paper
    defaultVariant: 'solid',
    colorMode: 'light'
  },
  {
    name: 'mtv',
    label: 'MTV',
    description: 'Day-glo blocks, clashing neon shadows, Memphis energy',
    colors: ['#ff2d95', '#00e5ff', '#ffe600'], // pink, cyan, yellow
    defaultVariant: 'solid',
    colorMode: 'light'
  },
  {
    name: 'terminal',
    label: 'Terminal',
    description: 'Green phosphor on black, scanlines, inverse video',
    colors: ['#33ff66', '#0a0f0a', '#ffb000'], // phosphor, tube, amber
    defaultVariant: 'solid',
    colorMode: 'dark'
  },
  {
    name: 'braun',
    label: 'Braun',
    description: 'Warm analog hi-fi — cream, hairlines, one orange accent',
    colors: ['#f2efe9', '#f26c1d', '#2e2c29'], // cream, orange, charcoal
    defaultVariant: 'solid',
    colorMode: 'light'
  },
  {
    name: 'gameboy',
    label: 'Game Boy',
    description: 'Four shades of olive green, chunky pixels',
    colors: ['#0f380f', '#8bac0f', '#9bbc0e'], // ink, light, screen
    defaultVariant: 'solid',
    colorMode: 'light'
  },
  {
    name: 'riso',
    label: 'Riso',
    description: 'Two-color riso print — fluoro pink + teal, misregistered',
    colors: ['#ff48b0', '#00887a', '#f7f3e8'], // pink, teal, paper
    defaultVariant: 'solid',
    colorMode: 'light'
  },
  {
    name: 'eink',
    label: 'E-ink',
    description: 'Greyscale reading mode — zero motion, newspaper type',
    colors: ['#1c1c1c', '#6b6b6b', '#f4f2ee'], // ink, gray, paper
    defaultVariant: 'outline',
    colorMode: 'light'
  },
  {
    name: 'blueprint',
    label: 'Blueprint',
    description: 'Cyanotype drafting sheet — white line-work on blue',
    colors: ['#123a63', '#dce9f5', '#ffd66b'], // blue, line, pencil
    defaultVariant: 'solid',
    colorMode: 'dark'
  }
]

const STORAGE_KEY = 'nuxt-crouton-theme'

export function useThemeSwitcher() {
  const appConfig = useAppConfig()
  // Captured in setup scope so setTheme can pin it from event handlers (#1387).
  const colorMode = useColorMode()

  // Reactive theme state - uses useState for SSR compatibility
  const currentTheme = useState<ThemeName>('crouton-theme', () => 'default')

  // SSR-safe localStorage persistence via VueUse
  const storedTheme = useLocalStorage<ThemeName>(STORAGE_KEY, 'default')

  // Restore the stored preference AFTER hydration (onMounted), never during
  // setup: the server can't know localStorage, so a setup-time restore makes
  // the client's first render differ from the SSR HTML → hydration class
  // mismatch on every themed component (#1304). Post-mount it's a normal
  // reactive update. Idempotent across the many components calling this.
  // Guarded: plugins (themeProvider.client) call this composable outside any
  // component instance, where onMounted can't register.
  if (getCurrentInstance()) onMounted(() => {
    if (
      storedTheme.value !== currentTheme.value
      && AVAILABLE_THEMES.some(t => t.name === storedTheme.value)
    ) {
      setTheme(storedTheme.value)
    }
  })

  // Computed for current theme config
  const currentThemeConfig = computed(() =>
    AVAILABLE_THEMES.find(t => t.name === currentTheme.value) ?? AVAILABLE_THEMES[0]
  )

  // Get the variant name for Nuxt UI components.
  // 'default' returns undefined to use Nuxt UI's default variant. Every theme
  // registers NAMED variants under its class prefix (ko, minimal, kr11, bw-*),
  // and the runtime swap points defaultVariants.variant at the same name — so
  // binding :variant="variant" and plain variant-less usage render identically.
  const variant = computed(() =>
    currentTheme.value === 'default'
      ? undefined
      : currentTheme.value === 'blackandwhite' ? 'bw-solid' : currentTheme.value
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

    // The theme's designed scheme is a DEFAULT, not a lock (#1395 relaxed the
    // #1387 pin): applied only while the user has no explicit preference
    // ('system'). Every theme now carries a designed counterpart palette for
    // the other scheme, so an explicit light/dark choice always wins; adaptive
    // themes (blackandwhite, default) never touch the preference at all.
    const scheme = AVAILABLE_THEMES.find(t => t.name === theme)?.colorMode
    if (scheme && colorMode.preference === 'system') {
      colorMode.preference = scheme
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

  // (No setup-time updateAppConfig: the onMounted restore above applies the
  // stored theme's config post-hydration via setTheme.)

  // Get variant with theme prefix for compound variants
  // e.g., getVariant('ghost') returns 'ko-ghost' when KO theme is active and
  // 'bw-ghost' under blackandwhite (whose named-variant prefix is 'bw', not
  // the theme name). 'default' passes the base variant through unchanged.
  // Returns `any`: the concrete union of registered variant names is generated
  // per consuming app by Nuxt UI, so this composable can't name it — and a
  // plain `string` fails assignment against that union in templates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getVariant(baseVariant: string = 'solid'): any {
    if (currentTheme.value === 'default') return baseVariant
    const prefix = currentTheme.value === 'blackandwhite' ? 'bw' : currentTheme.value
    return `${prefix}-${baseVariant}`
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