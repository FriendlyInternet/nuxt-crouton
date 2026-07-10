/**
 * Team Theme Plugin (Universal, Async)
 *
 * Fetches the team theme during SSR so the HTML renders with the correct colors.
 * Uses useState to transfer the theme data to the client (no double fetch).
 * On client hydration, applies the already-fetched theme immediately.
 */
import type { TeamThemeSettings } from '../composables/useTeamTheme'
import { applyThemeSettings } from '../composables/useTeamTheme'

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

    applyThemeSettings(themeState.value, useColorMode())

    // Expose the allowUserThemes flag so crouton-auth components can read it
    // without importing from crouton-admin. Defaults to true when not set.
    const allowUserThemes = useState<boolean>('crouton:allowUserThemes', () => true)
    allowUserThemes.value = themeState.value.allowUserThemes ?? true

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
