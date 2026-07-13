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

    // The team theme is the BASE; a user's personal pick (the theme pill →
    // @fyit/crouton-themes useThemeSwitcher, saved in localStorage) WINS on
    // reload when the team allows it (#1596). Without this the plugin re-applied
    // the team theme on every load and stomped the override. Resolve it
    // client-side only — the server can't read localStorage, so SSR paints the
    // team theme and the override settles just after hydration (one frame, like
    // any localStorage theme restore). ⚠️ When no override is stored, `effective`
    // stays `themeState.value`, i.e. byte-for-byte the previous behaviour.
    let effective: TeamThemeSettings = themeState.value
    if (import.meta.client) {
      // Keys owned by useThemeSwitcher: STORAGE_KEY 'nuxt-crouton-theme' + the
      // 'crouton-theme' useState. We sync the state so the pill highlights the
      // active theme AND useThemeSwitcher's own onMounted restore becomes a
      // no-op (its guard is storedTheme !== currentTheme) — no double-apply.
      const stored = localStorage.getItem('nuxt-crouton-theme')
      const validOverride = !!stored && stored !== 'default' && stored in THEME_PRESET_REGISTRY
      if (allowUserThemes.value && validOverride) {
        effective = { ...themeState.value, preset: stored as ThemePresetName }
      }
      else if (!allowUserThemes.value && stored && stored !== 'default') {
        // Locked (admins stay exempt via the switcher's canSwitchTheme, but the
        // team theme is authoritative on load): drop a lingering personal
        // override so it can't reappear on the next reload.
        localStorage.setItem('nuxt-crouton-theme', 'default')
      }
      const activePreset = effective.preset && effective.preset !== 'custom'
        ? effective.preset
        : 'default'
      useState<string>('crouton-theme').value = activePreset
    }

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
