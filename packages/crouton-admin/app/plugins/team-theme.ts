/**
 * Team Theme Plugin (Universal, Async)
 *
 * Fetches the team theme during SSR so the HTML renders with the correct colors.
 * Uses useState to transfer the theme data to the client (no double fetch).
 * On client hydration, applies the already-fetched theme immediately.
 */
import type { TeamThemeSettings } from '../composables/useTeamTheme'
import { applyThemeSettings } from '../composables/useTeamTheme'
import { THEME_PRESET_REGISTRY, type ThemePresetName } from '@fyit/crouton-themes/presets'

// Storage + state keys owned by @fyit/crouton-themes useThemeSwitcher (its
// STORAGE_KEY + the 'crouton-theme' useState). Named here so the coupling is
// explicit and greppable.
const OVERRIDE_KEY = 'nuxt-crouton-theme'

// The three deciders below are split into trivially-small pure functions on
// purpose: the fallow CRAP gate degrades to cyc²+cyc at zero coverage, so each
// unit stays tiny and independently testable (theme-override.test.ts).

/** The user's saved pick, or null when none / 'default' / not a real preset. */
function pickThemeOverride(stored: string | null, allowUserThemes: boolean): ThemePresetName | null {
  if (!allowUserThemes || !stored || stored === 'default') return null
  return stored in THEME_PRESET_REGISTRY ? (stored as ThemePresetName) : null
}

/** A locked team (allowUserThemes=false) drops a lingering saved override so it
 *  can't reappear on the next reload (admins still preview live via the switcher). */
function shouldClearOverride(stored: string | null, allowUserThemes: boolean): boolean {
  return !allowUserThemes && !!stored && stored !== 'default'
}

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
function resolveEffectiveTheme(teamTheme: TeamThemeSettings, allowUserThemes: boolean): TeamThemeSettings {
  if (!import.meta.client) return teamTheme
  const stored = localStorage.getItem(OVERRIDE_KEY)
  if (shouldClearOverride(stored, allowUserThemes)) localStorage.setItem(OVERRIDE_KEY, 'default')
  const override = pickThemeOverride(stored, allowUserThemes)
  const effective = override ? { ...teamTheme, preset: override } : teamTheme
  useState<string>('crouton-theme').value = activePresetName(effective)
  return effective
}

export default defineNuxtPlugin({
  name: 'team-theme',
  enforce: 'post',
  async setup() {
    const { teamId } = useTeamContext()
    if (!teamId.value) return

    // Shared state — SSR result is serialized and hydrated on client
    const themeState = useState<TeamThemeSettings>('team-theme-data', () => ({}))
    // Flag prevents re-fetching on client when SSR already populated the state
    const themeFetched = useState<boolean>('team-theme-fetched', () => false)

    if (!themeFetched.value) {
      try {
        const data = await $fetch<TeamThemeSettings>(
          `/api/teams/${teamId.value}/settings/theme`
        )
        themeState.value = data ?? {}
      }
      catch {
        // Theme fetch failed, use defaults
      }
      themeFetched.value = true
    }

    // Expose the allowUserThemes flag so crouton-auth components can read it
    // without importing from crouton-admin. Defaults to true when not set.
    const allowUserThemes = useState<boolean>('crouton:allowUserThemes', () => true)
    allowUserThemes.value = themeState.value.allowUserThemes ?? true

    // Team theme is the base; a user's saved override wins when allowed (#1596).
    const effective = resolveEffectiveTheme(themeState.value, allowUserThemes.value)
    applyThemeSettings(effective, useColorMode())

    // Fetch site settings (for custom favicon) and apply team favicon
    const siteSettings = useState<{ favicon?: string } | null>('team-site-settings', () => null)
    try {
      const siteData = await $fetch<{ favicon?: string }>(
        `/api/teams/${teamId.value}/settings/site`
      )
      siteSettings.value = siteData ?? null
    }
    catch {
      // Site settings fetch failed, proceed without custom favicon
    }

    useTeamFavicon()
  }
})
