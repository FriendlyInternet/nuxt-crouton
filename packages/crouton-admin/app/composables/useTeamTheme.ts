/**
 * Team Theme Composable
 *
 * Provides reactive access to the team theme and methods to update it.
 * The theme is initially fetched by the team-theme plugin (during SSR).
 * This composable reads from the shared useState and handles live updates.
 *
 * @example
 * ```typescript
 * const { theme, isLoading, updateTheme, refresh } = useTeamTheme()
 *
 * // Apply a preset (admin only)
 * await updateTheme({ preset: 'blackandwhite' })
 *
 * // Apply custom colors (admin only)
 * await updateTheme({ preset: 'custom', primary: 'blue', neutral: 'slate', radius: 0.25 })
 * ```
 */
import { computed, watch, readonly } from 'vue'
import { updateAppConfig, useAppConfig } from '#imports'
import { THEME_PRESET_REGISTRY, type ThemePresetName, type ThemePresetEntry } from '@fyit/crouton-themes/presets'

/**
 * Primary color options (Tailwind CSS colors)
 */
export type ThemePrimaryColor =
  | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green'
  | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo'
  | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose'

/**
 * Neutral color options
 */
export type ThemeNeutralColor = 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'

/**
 * Border radius options (in rem)
 */
export type ThemeRadius = 0 | 0.125 | 0.25 | 0.375 | 0.5

/**
 * Named theme presets: 'custom' plus every theme in crouton-themes'
 * THEME_PRESET_REGISTRY (#1332 — single source, no more hand-copied configs).
 */
export type ThemePreset = 'custom' | ThemePresetName

/**
 * Team theme settings
 */
export interface TeamThemeSettings {
  preset?: ThemePreset
  primary?: ThemePrimaryColor
  neutral?: ThemeNeutralColor
  radius?: ThemeRadius
  /** Whether non-admin users can switch the global UI theme themselves. Default: true */
  allowUserThemes?: boolean
}

/**
 * Preset configuration — visual metadata + what gets applied to Nuxt UI
 */
export interface ThemePresetConfig {
  label: string
  description: string
  /** Hex color for the primary preview swatch */
  previewPrimary: string
  /** Hex color for the neutral preview swatch */
  previewNeutral: string
  /** Config passed to updateAppConfig({ ui: ... }) */
  ui: Record<string, unknown> | ThemePresetEntry['ui']
}

/**
 * Available primary colors for the picker
 */
export const PRIMARY_COLORS: ThemePrimaryColor[] = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose'
]

/**
 * Available neutral colors for the picker
 */
export const NEUTRAL_COLORS: ThemeNeutralColor[] = [
  'slate', 'gray', 'zinc', 'neutral', 'stone'
]

/**
 * Available radius options for the picker
 */
export const RADIUS_OPTIONS: ThemeRadius[] = [0, 0.125, 0.25, 0.375, 0.5]

/**
 * Default theme values
 */
export const DEFAULT_THEME: Required<TeamThemeSettings> = {
  preset: 'custom',
  primary: 'emerald',
  neutral: 'slate',
  radius: 0.25,
  allowUserThemes: false
}

/**
 * Nuxt UI v4 structural defaults.
 * Applied when switching to 'custom' to undo any preset overrides.
 * Must explicitly cover every key that any preset touches.
 */
const NUXT_UI_STRUCTURAL_DEFAULTS = {
  theme: { defaultVariants: { size: 'md' } },
  button: { defaultVariants: { variant: 'solid' } },
  input: { defaultVariants: { variant: 'outline' } },
  select: { defaultVariants: { variant: 'outline' } },
  card: { defaultVariants: { variant: 'outline' } },
  alert: { defaultVariants: { variant: 'soft' } },
  textarea: { defaultVariants: { variant: 'outline' } }
}

/**
 * Named theme presets with their Nuxt UI configurations.
 * Each preset fully declares the keys it touches so switching between
 * presets always produces correct results.
 */
export const THEME_PRESETS: Record<ThemePreset, ThemePresetConfig> = {
  custom: {
    label: 'Custom',
    description: 'Choose your own colors and radius',
    previewPrimary: '#10b981', // emerald-500
    previewNeutral: '#64748b', // slate-500
    ui: {} // handled via individual color/radius settings
  },
  // Every crouton theme, derived from the themes package (label, swatches and
  // a scalars-only `ui` payload — see THEME_PRESET_REGISTRY for why arrays
  // must never be written through updateAppConfig).
  ...THEME_PRESET_REGISTRY
}

/**
 * Presets actually USABLE in this app: a theme's classes/CSS ship only when
 * its layer is extended (build-time), so filter by whether the theme's named
 * variant exists in the built app config. 'custom' is always available.
 */
export function useAvailableThemePresets() {
  const appConfig = useAppConfig()
  return computed<Partial<Record<ThemePreset, ThemePresetConfig>>>(() => {
    const registered = (appConfig as any)?.ui?.button?.variants?.variant ?? {}
    const entries = Object.entries(THEME_PRESETS).filter(([name, preset]) => {
      if (name === 'custom') return true
      const check = THEME_PRESET_REGISTRY[name as ThemePresetName]?.checkVariant
      return !!check && check in registered
    })
    return Object.fromEntries(entries)
  })
}

/**
 * Apply theme settings to Nuxt UI via updateAppConfig.
 * Exported as a standalone function so the plugin can use it too.
 */
export function applyThemeSettings(settings: TeamThemeSettings) {
  const preset = settings.preset ?? 'custom'
  const radius = settings.radius ?? DEFAULT_THEME.radius

  if (preset !== 'custom') {
    const entry = THEME_PRESETS[preset]
    if (!entry) {
      // Persisted preset whose layer is no longer extended — fall back to
      // structural defaults rather than crashing or half-applying.
      updateAppConfig({ ui: { ...NUXT_UI_STRUCTURAL_DEFAULTS } as any })
    }
    else {
      updateAppConfig({ ui: entry.ui as any })
    }
  }
  else {
    const primary = settings.primary ?? DEFAULT_THEME.primary
    const neutral = settings.neutral ?? DEFAULT_THEME.neutral
    // Typed as Record<string, unknown> to match THEME_PRESETS[].ui — Nuxt UI 4.9's
    // AppConfig `ui` type structurally rejects this concrete literal, but accepts
    // the loose record (same path the preset branch above takes).
    const customUi: Record<string, unknown> = {
      ...NUXT_UI_STRUCTURAL_DEFAULTS,
      colors: { primary, neutral }
    }
    updateAppConfig({ ui: customUi })
  }

  if (import.meta.client) {
    document.documentElement.style.setProperty('--ui-radius', `${radius}rem`)
    // Set data-theme for ambient CSS (e.g. background colors, global font overrides)
    if (preset === 'custom') {
      document.documentElement.removeAttribute('data-theme')
    }
    else {
      document.documentElement.dataset.theme = preset
    }
  }
}

export function useTeamTheme() {
  const { teamId } = useTeamContext()

  // Shared state with the plugin (populated during SSR)
  const themeData = useState<TeamThemeSettings>('team-theme-data', () => ({}))
  // Tracks whether the initial fetch has completed (avoids re-fetch on hydration)
  const themeFetched = useState<boolean>('team-theme-fetched', () => false)

  // Computed theme with defaults applied
  const theme = computed<Required<TeamThemeSettings>>(() => ({
    preset: themeData.value.preset ?? DEFAULT_THEME.preset,
    primary: themeData.value.primary ?? DEFAULT_THEME.primary,
    neutral: themeData.value.neutral ?? DEFAULT_THEME.neutral,
    radius: themeData.value.radius ?? DEFAULT_THEME.radius,
    allowUserThemes: themeData.value.allowUserThemes ?? true
  }))

  const isLoading = computed(() => !themeFetched.value)

  // Watch for live theme changes (e.g. admin editing theme settings)
  watch(theme, (newTheme) => {
    applyThemeSettings(newTheme)
  })

  // Refresh theme from API
  async function refresh() {
    if (!teamId.value) return
    try {
      const data = await $fetch<TeamThemeSettings>(
        `/api/teams/${teamId.value}/settings/theme`
      )
      themeData.value = data ?? {}
      themeFetched.value = true
      applyThemeSettings(theme.value)
    }
    catch {
      themeFetched.value = true
    }
  }

  // Update theme (for admin UI)
  async function updateTheme(settings: Partial<TeamThemeSettings>) {
    if (!teamId.value) {
      throw new Error('No team context available')
    }

    const response = await $fetch<TeamThemeSettings>(
      `/api/teams/${teamId.value}/settings/theme`,
      {
        method: 'PATCH',
        body: settings
      }
    )

    await refresh()
    return response
  }

  // Reset to defaults
  async function resetTheme() {
    return updateTheme({
      preset: DEFAULT_THEME.preset,
      primary: DEFAULT_THEME.primary,
      neutral: DEFAULT_THEME.neutral,
      radius: DEFAULT_THEME.radius
    })
  }

  return {
    theme: readonly(theme),
    isLoading,
    teamId,
    updateTheme,
    resetTheme,
    refresh,
    /** Apply theme settings immediately (for live preview) */
    applyTheme: applyThemeSettings
  }
}
