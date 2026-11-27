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
import { pickThemeOverride, shouldClearOverride } from '../utils/theme-override'

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
// `colorMode` is passed in by callers that captured it in setup scope
// (watch/refresh callbacks lose the Nuxt context, #1387).
export function applyThemeSettings(settings: TeamThemeSettings, colorMode?: { preference: string }) {
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
      // The theme's designed scheme is a DEFAULT, not a lock (#1395 relaxed
      // the #1387 pin): applied only while the visitor has no explicit
      // preference ('system'). Themes carry designed counterpart palettes
      // for both schemes, so an explicit light/dark choice always wins.
      const scheme = THEME_PRESET_REGISTRY[preset as ThemePresetName]?.colorMode
      if (scheme && colorMode && colorMode.preference === 'system') {
        colorMode.preference = scheme
      }
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
    // Set data-theme for ambient CSS (background, fonts) — and let radius follow
    // the right owner (#1595). A preset theme declares its own --ui-radius base
    // token in CSS (#1594); an inline style would BEAT that stylesheet rule, so
    // for a preset we must NOT set radius inline — clear any left by a prior
    // custom selection so the theme's token wins. Only "custom" (the slider)
    // owns radius inline.
    if (preset === 'custom') {
      document.documentElement.style.setProperty('--ui-radius', `${radius}rem`)
      document.documentElement.removeAttribute('data-theme')
    }
    else {
      document.documentElement.style.removeProperty('--ui-radius')
      document.documentElement.dataset.theme = preset
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Fetch one team's theme; never throws (a failure comes back as `error`). */
async function fetchTeamTheme(id: string): Promise<{ data: TeamThemeSettings } | { error: string }> {
  try {
    const data = await $fetch<TeamThemeSettings>(`/api/teams/${id}/settings/theme`)
    return { data: data ?? {} }
  }
  catch (err) {
    return { error: errorMessage(err) }
  }
}

// Storage + state keys owned by @fyit/crouton-themes useThemeSwitcher (its
// STORAGE_KEY + the 'crouton-theme' useState). Named here so the coupling is
// explicit and greppable.
const OVERRIDE_KEY = 'nuxt-crouton-theme'

/** The preset useThemeSwitcher's 'crouton-theme' state shows as active
 *  ('default' for a custom/absent preset) — keeps the pill in sync and makes its
 *  onMounted restore a no-op (guard: storedTheme !== currentTheme). */
function activePresetName(theme: TeamThemeSettings): string {
  const preset = theme.preset
  return preset && preset !== 'custom' ? preset : 'default'
}

/**
 * Resolve the theme to actually apply (#1596): the team theme is the BASE; a
 * user's saved pick (the theme pill → useThemeSwitcher localStorage) WINS on
 * reload when the team allows it — without this the plugin re-applied the team
 * theme every load and stomped the override. Client-only — SSR paints the team
 * theme and the override settles just after hydration (one frame, like any
 * localStorage theme restore). ⚠️ No override stored ⇒ returns `teamTheme`
 * unchanged, byte-for-byte the previous behaviour.
 */
export function resolveEffectiveTheme(teamTheme: TeamThemeSettings, allowUserThemes: boolean): TeamThemeSettings {
  if (import.meta.server) return teamTheme
  const stored = localStorage.getItem(OVERRIDE_KEY)
  // Only themes this app ships (their variant is built) may apply — localStorage
  // is per origin, so a pick from another app on the same host leaks in (#2257).
  const registered = (useAppConfig() as any)?.ui?.button?.variants?.variant
  if (shouldClearOverride(stored, allowUserThemes, registered)) localStorage.setItem(OVERRIDE_KEY, 'default')
  const override = pickThemeOverride(stored, allowUserThemes, registered)
  const effective = override ? { ...teamTheme, preset: override } : teamTheme
  useState<string>('crouton-theme').value = activePresetName(effective)
  return effective
}

export function useTeamTheme() {
  const { teamId } = useTeamContext()
  const colorMode = useColorMode()

  // Shared state with the plugin (populated during SSR)
  const themeData = useState<TeamThemeSettings>('team-theme-data', () => ({}))
  // Tracks whether the initial fetch has completed (avoids re-fetch on hydration)
  const themeFetched = useState<boolean>('team-theme-fetched', () => false)
  // Shared across callers so several useTeamTheme() users never each fetch (#4551)
  const themeError = useState<string | null>('team-theme-error', () => null)
  const themePending = useState<boolean>('team-theme-pending', () => false)
  // Which team `team-theme-data` belongs to — loads are per team (#4563)
  const loadedFor = useState<string | null>('team-theme-team-id', () => null)
  const allowUserThemes = useState<boolean>('crouton:allowUserThemes', () => true)

  // Computed theme with defaults applied
  const theme = computed<Required<TeamThemeSettings>>(() => ({
    preset: themeData.value.preset ?? DEFAULT_THEME.preset,
    primary: themeData.value.primary ?? DEFAULT_THEME.primary,
    neutral: themeData.value.neutral ?? DEFAULT_THEME.neutral,
    radius: themeData.value.radius ?? DEFAULT_THEME.radius,
    allowUserThemes: themeData.value.allowUserThemes ?? true
  }))

  const isLoading = computed(() => !themeFetched.value)

  // Load the current team's theme and apply it. `userPickWins` applies the
  // user's saved pick on top (#1596) — true for late loads, false for refresh()
  // after a save (the theme as saved is applied).
  async function load(userPickWins: boolean) {
    const id = teamId.value
    if (!id) return
    themePending.value = true
    themeError.value = null
    const result = await fetchTeamTheme(id)
    themePending.value = false
    // The team changed while this load ran: drop it, load the current team.
    if (teamId.value !== id) return ensureLoaded()
    themeFetched.value = true
    loadedFor.value = id
    themeError.value = 'error' in result ? result.error : storeAndApply(result.data, userPickWins)
  }

  /** Store a loaded theme and apply it; returns the error message if applying failed. */
  function storeAndApply(data: TeamThemeSettings, userPickWins: boolean): string | null {
    themeData.value = data
    allowUserThemes.value = theme.value.allowUserThemes
    try {
      const toApply = userPickWins ? resolveEffectiveTheme(theme.value, allowUserThemes.value) : theme.value
      applyThemeSettings(toApply, colorMode)
      return null
    }
    catch (err) {
      return errorMessage(err)
    }
  }

  // Refresh theme from API (applies the theme as saved)
  function refresh() {
    return load(false)
  }

  // Late loads live here (#4551, #4563): the plugin only loads at boot. Load
  // whenever the current team's theme isn't loaded (a fresh sign-in, a team
  // switch), unless a load is already running; a load that finishes for a team
  // you've since left is dropped and the current team loads instead.
  const needsLoad = computed(() => !!teamId.value && loadedFor.value !== teamId.value && !themePending.value)
  function ensureLoaded() {
    if (!import.meta.server && needsLoad.value) load(true)
  }
  watch(teamId, ensureLoaded, { immediate: true })

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
    /** Message of the last failed load, or null */
    error: readonly(themeError),
    teamId,
    updateTheme,
    resetTheme,
    refresh,
    /** Apply theme settings immediately (for live preview) */
    applyTheme: (settings: TeamThemeSettings) => applyThemeSettings(settings, colorMode)
  }
}
