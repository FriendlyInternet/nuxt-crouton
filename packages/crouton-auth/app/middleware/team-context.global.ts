/**
 * Global Team Context Middleware
 *
 * Automatically resolves and syncs team context.
 * Runs on ALL routes (global middleware) to ensure team context is available.
 *
 * Unified resolution strategy:
 * 1. Check URL params first: [team] route param
 * 2. Fall back to session's active organization
 *
 * Team context is stored in:
 * - useState('crouton-auth-team') - for reactive access in components
 * - Server: event.context.team (via server middleware)
 */
import { useAuthClientSafe } from '../../types/auth-client'
import { mapOrganizationToTeam, type RawOrganization } from '../../shared/utils/auth'

export default defineNuxtRouteMiddleware(async (to) => {
  const config = useAuthConfig()

  // Get team state (shared via useState)
  const {
    setTeamContext,
    setTeamError,
    clearTeamContext
  } = useTeamState()

  // Skip for auth routes - no team context needed
  if (to.path.startsWith('/auth')) {
    clearTeamContext()
    return
  }

  // Get session state
  const { isAuthenticated, activeOrganization, isPending } = useSession()

  // Wait for session to load (important for initial navigation)
  if (isPending.value) {
    // Wait for session to load (max 5 seconds)
    await new Promise<void>((resolve) => {
      const unwatch = watch(
        () => isPending.value,
        (pending) => {
          if (!pending) {
            unwatch()
            resolve()
          }
        },
        { immediate: true }
      )
      // Timeout after 5 seconds
      setTimeout(() => {
        unwatch()
        resolve()
      }, 5000)
    })
  }

  // Not authenticated - clear team context
  if (!isAuthenticated.value) {
    clearTeamContext()

    return
  }

  // Debug logging
  if (config?.debug) {
    console.log(`[@crouton/auth] Team context middleware: ${to.path}`)
  }

  try {
    // Unified team resolution
    const resolution = await resolveTeamContext(to, config)

    if (resolution.error) {
      setTeamError(resolution.error)
    } else if (resolution.teamId) {
      setTeamContext({
        teamId: resolution.teamId,
        teamSlug: resolution.teamSlug,
        team: activeOrganization.value ?? null
      })
    } else {
      clearTeamContext()
    }

    // Handle redirects
    if (resolution.needsRedirect && resolution.redirectTo) {
      if (config?.debug) {
        console.log(`[@crouton/auth] Redirecting to: ${resolution.redirectTo}`)
      }
      return navigateTo(resolution.redirectTo, { replace: true })
    }
  } catch (error) {
    console.error('[@crouton/auth] Team context middleware error:', error)
    setTeamError(error instanceof Error ? error.message : 'Team resolution failed')
    // Don't block navigation - let the page handle the error
  }
})

/**
 * Resolve team context from URL and session
 */
async function resolveTeamContext(
  to: ReturnType<typeof useRoute>,
  config: ReturnType<typeof useAuthConfig>
): Promise<{
  teamId: string | null
  teamSlug: string | null
  needsRedirect: boolean
  redirectTo?: string
  error?: string
}> {
  const { activeOrganization } = useSession()
  const { teams, switchTeamBySlug } = useTeam()

  const urlTeamParam = to.params.team as string | undefined

  // Ensure teams are loaded - fetch from API if nanostore is empty
  // Also populate the fallback state so the team switcher can show all teams
  const fallbackTeams = useState<Array<{ id: string; slug: string; name: string }>>('crouton-auth-fallback-teams', () => [])
  let userTeams: Array<{ id: string; slug: string; name: string }> = teams.value
  if (userTeams.length === 0) {
    if (import.meta.server) {
      // Server-side: $authClient is not available (client-only plugin), use $fetch directly
      const requestHeaders = useRequestHeaders(['cookie'])
      try {
        const orgs = await $fetch<RawOrganization[]>('/api/auth/organization/list', {
          headers: requestHeaders
        }).catch(() => null)
        if (orgs && orgs.length > 0) {
          userTeams = orgs
          fallbackTeams.value = orgs.map(mapOrganizationToTeam)
        }
      } catch (e) {
        console.error('[@crouton/auth] Failed to fetch teams server-side:', e)
      }
    } else {
      try {
        const authClient = useAuthClientSafe()
        if (authClient?.organization?.list) {
          const result = await authClient.organization.list()
          if (result.data && result.data.length > 0) {
            userTeams = result.data
            fallbackTeams.value = result.data.map(mapOrganizationToTeam)
          }
        }
      } catch (e) {
        console.error('[@crouton/auth] Failed to fetch teams:', e)
      }
    }
  }

  if (urlTeamParam) {
    // Team specified in URL - validate user has access
    const targetTeam = userTeams.find(
      t => t.slug === urlTeamParam || t.id === urlTeamParam
    )

    if (!targetTeam) {
      // Team not found or no access - redirect to first available team
      const firstTeam = userTeams[0]
      if (firstTeam) {
        const newPath = to.path.replace(`/${urlTeamParam}`, `/${firstTeam.slug}`)
        return {
          teamId: firstTeam.id,
          teamSlug: firstTeam.slug,
          needsRedirect: true,
          redirectTo: newPath
        }
      }
      // No teams at all
      return {
        teamId: null,
        teamSlug: null,
        needsRedirect: false,
        error: 'No teams available'
      }
    }

    // Valid team - switch session if needed (client-only: authClient is not available on server)
    // Always use targetTeam.slug (not urlTeamParam which may be an ID)
    if (!import.meta.server && activeOrganization.value?.id !== targetTeam.id) {
      try {
        await switchTeamBySlug(targetTeam.slug)
      } catch (e) {
        console.error('[@crouton/auth] Failed to switch team:', e)
      }
    }

    return {
      teamId: targetTeam.id,
      teamSlug: targetTeam.slug,
      needsRedirect: false
    }
  } else {
    // No team in URL - use active organization from session if available
    return {
      teamId: activeOrganization.value?.id ?? null,
      teamSlug: activeOrganization.value?.slug ?? null,
      needsRedirect: false
    }
  }
}
