/**
 * Team Admin Middleware
 *
 * Protects routes that require team admin or owner privileges.
 * Checks that the user is a member of the team in the route param
 * and has admin/owner role.
 *
 * @example
 * ```vue
 * <script setup>
 * definePageMeta({
 *   middleware: 'team-admin'
 * })
 * </script>
 * ```
 */
import { defineNuxtRouteMiddleware, navigateTo, createError, useSession, useTeam, useNuxtApp, useRequestHeaders, watch } from '#imports'

/** Minimal shape of a team as this middleware consumes it */
interface TeamRef {
  id: string
  slug: string
}

/** Minimal member shape returned by better-auth's full-organization payload */
interface OrgMember {
  userId: string
  role: string
}

/**
 * Locally-derived slice of the better-auth client this middleware uses.
 * The full client type lives in crouton-auth (client-only plugin).
 */
interface AuthOrgClient {
  organization?: {
    list?: () => Promise<{ data?: TeamRef[] | null }>
    getFullOrganization?: (opts: { query: { organizationId: string } }) => Promise<{ data?: { members?: OrgMember[] } | null }>
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { data: sessionData, isPending, isAuthenticated } = useSession()
  const { teams, switchTeamBySlug } = useTeam()
  const nuxtApp = useNuxtApp()

  // Wait for session to load if pending
  if (isPending.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(isPending, (val) => {
        if (!val) { stop(); resolve() }
      })
    })
  }

  // Check authentication first
  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath }
    })
  }

  // Get team slug from route params
  const teamSlug = to.params.team as string
  if (!teamSlug) {
    throw createError({
      status: 400,
      statusText: 'Bad Request',
      message: 'Team parameter is required'
    })
  }

  // Super admins bypass team membership checks
  const user = sessionData.value?.user as { superAdmin?: boolean } | undefined
  if (user?.superAdmin) {
    // Still switch team context so the admin pages work correctly
    if (import.meta.client) {
      try {
        await switchTeamBySlug(teamSlug)
      } catch {
        // Super admin may not be a member — that's fine, team context
        // will be set by the page via API calls
      }
    }
    return
  }

  // Find the team and check role from teams list (includes role)
  let userTeams: TeamRef[] = teams.value

  // If teams not loaded, fetch from API
  if (userTeams.length === 0) {
    if (import.meta.server) {
      // Server-side: $authClient is not available (client-only plugin), use $fetch directly
      const requestHeaders = useRequestHeaders(['cookie'])
      try {
        const orgs = await $fetch<TeamRef[]>('/api/auth/organization/list', {
          headers: requestHeaders
        }).catch(() => null)
        if (orgs) {
          userTeams = orgs
        }
      } catch (e) {
        console.error('[@crouton/admin] Failed to fetch teams server-side:', e)
      }
    } else {
      const authClient = nuxtApp.$authClient as AuthOrgClient | undefined
      if (authClient?.organization?.list) {
        try {
          const result = await authClient.organization.list()
          if (result.data) {
            userTeams = result.data
          }
        } catch (e) {
          console.error('[@crouton/admin] Failed to fetch teams:', e)
        }
      }
    }
  }

  // Find the target team
  const targetTeam = userTeams.find(t => t.slug === teamSlug || t.id === teamSlug)

  if (!targetTeam) {
    throw createError({
      status: 403,
      statusText: 'Forbidden',
      message: 'You are not a member of this team'
    })
  }

  // Switch to the team if needed (client-side only — setActive is a session mutation).
  // Only swallow 404-style errors (team not found in active session) — those are
  // harmless because we already confirmed the user is a member above. Any other
  // error (network failure, auth error, etc.) is unexpected and must propagate so
  // the user is never left in a broken state with the wrong team context.
  if (import.meta.client) {
    try {
      await switchTeamBySlug(teamSlug)
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status
      if (status !== 404) {
        throw e
      }
    }
  }

  // Check admin status by fetching full organization with members
  if (import.meta.server) {
    // Server-side: use $fetch with request headers
    const requestHeaders = useRequestHeaders(['cookie'])
    try {
      const fullOrg = await $fetch<{ members?: OrgMember[] }>('/api/auth/organization/get-full-organization', {
        query: { organizationId: targetTeam.id },
        headers: requestHeaders
      }).catch(() => null)

      if (fullOrg?.members) {
        const { user } = useSession()
        const userId = user.value?.id
        const membership = fullOrg.members.find(m => m.userId === userId)

        if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
          throw createError({
            status: 403,
            statusText: 'Forbidden',
            message: 'Team admin or owner access required'
          })
        }
        // User is admin/owner - allow access
        return
      }
    } catch (e: any) {
      if (e.statusCode === 403 || e.status === 403) throw e
      console.error('[@crouton/admin] Failed to check admin status server-side:', e)
      throw createError({ status: 401, statusText: 'Unauthorized', message: 'Could not verify admin status' })
    }
  } else {
    // Client-side: use the auth client
    const authClient = nuxtApp.$authClient as AuthOrgClient | undefined
    if (authClient?.organization?.getFullOrganization) {
      try {
        const result = await authClient.organization.getFullOrganization({
          query: { organizationId: targetTeam.id }
        })

        if (result.data?.members) {
          const { user } = useSession()
          const userId = user.value?.id
          const membership = result.data.members.find(m => m.userId === userId)

          if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
            throw createError({
              status: 403,
              statusText: 'Forbidden',
              message: 'Team admin or owner access required'
            })
          }
          // User is admin/owner - allow access
          return
        }
      } catch (e: any) {
        if (e.statusCode === 403 || e.status === 403) throw e
        console.error('[@crouton/admin] Failed to check admin status:', e)
        throw createError({ status: 401, statusText: 'Unauthorized', message: 'Could not verify admin status' })
      }
    }
  }

  // Could not resolve team admin status — deny by default
  throw createError({ status: 403, statusText: 'Forbidden', message: 'Team admin or owner access required' })
})
