/**
 * Team Initialization Plugin
 *
 * Logs initialization status for team configuration.
 * Handles both `autoCreateOnSignup` and `defaultTeamSlug` settings.
 *
 * Note: The actual team creation is handled lazily in database hooks
 * because NuxtHub's D1 database is only available during request handling,
 * not at Nitro plugin startup time.
 *
 * @see server/lib/auth.ts - buildDatabaseHooks() handles the lazy creation
 */
import type { CroutonAuthConfig } from '../../types/config'

export default defineNitroPlugin(async () => {
  // Deduplicate across layer resolution
  if ((globalThis as Record<string, boolean>).__croutonTeamPluginLogged) return
  (globalThis as Record<string, boolean>).__croutonTeamPluginLogged = true

  const config = useRuntimeConfig().public.crouton?.auth as CroutonAuthConfig | undefined
  const teams = config?.teams

  if (!teams) {
    return
  }

  const appName = config?.appName ?? 'Default Workspace'

  // Log auto-create on signup configuration
  if (teams.autoCreateOnSignup) {
    console.log(`🍞 crouton:auth Auto-create workspace enabled`)
    console.log(`🍞 crouton:auth Each new user will get their own personal workspace`)
  }

  // Log default team configuration
  if (teams.defaultTeamSlug) {
    console.log(`🍞 crouton:auth Default team enabled`)
    console.log(`🍞 crouton:auth Default team "${appName}" (slug: ${teams.defaultTeamSlug}) will be created on the first sign-up or sign-in`)
  }

  // Log combined behavior if both are set
  if (teams.autoCreateOnSignup && teams.defaultTeamSlug) {
    console.log(`🍞 crouton:auth Note: Users will get both a personal workspace AND be added to the default team`)
  }
})
