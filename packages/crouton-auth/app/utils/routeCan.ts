/**
 * Route permission check shared by the `can` page middleware (#4105) and the
 * deprecated crouton-admin `team-admin` shim.
 *
 * A page names the action(s) it needs with `definePageMeta({ can: '…' })`.
 * `routeActions(to)` collects them from EVERY matched route record — vue-router
 * lets a child's `meta.can` hide the parent's in `to.meta`, so a parent
 * (`team.vue` → `admin:access`) and its child (`team/settings.vue` →
 * `team:manage`) must both be read from `to.matched`.
 *
 * `checkRouteCan(to, actions)` asks `GET /api/teams/[team]/can` directly with
 * `useRequestFetch()` (forwards the cookie during server rendering). It does
 * NOT use `useCan()`: that computed reads `false` while loading, so a guard
 * built on it would refuse everyone on the first pass.
 *
 * Every Nuxt composable is taken at the top of `checkRouteCan`, BEFORE its first
 * `await`. This is a plain helper, not the middleware body, so Nuxt's
 * await-context transform does not cover it: on the server a `useRequestFetch()`
 * called after an `await` throws (no Nuxt instance), and the catch below turned
 * that into a 401 for every signed-in owner (#4151 review — velo preview).
 * `navigateTo` after an await runs inside `nuxtApp.runWithContext` for the same reason.
 */
import type { Ref } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'

interface RouteLike {
  fullPath: string
  params: Record<string, unknown>
  matched: Array<{ meta?: Record<string, unknown> }>
}

/** Unique, flattened `meta.can` of every matched route record. */
export function routeActions(to: Pick<RouteLike, 'matched'> | RouteLocationNormalized): string[] {
  const out = new Set<string>()
  for (const record of to.matched ?? []) {
    const can = (record.meta as Record<string, unknown> | undefined)?.can
    const list = Array.isArray(can) ? can : can ? [can] : []
    for (const action of list) {
      if (typeof action === 'string' && action) out.add(action)
    }
  }
  return [...out]
}

function statusOf(e: unknown): number | undefined {
  const err = e as { statusCode?: number, status?: number, response?: { status?: number } } | null
  return err?.statusCode ?? err?.status ?? err?.response?.status
}

/** Wait for the session to load if pending. */
async function waitForSession(isPending: Ref<boolean>) {
  if (!isPending.value) return
  await new Promise<void>((resolve) => {
    const stop = watch(isPending, (val) => {
      if (!val) {
        stop()
        resolve()
      }
    })
  })
}

/**
 * Switch to the team (client only — setActive is a session mutation). For a
 * super admin any failure is harmless (they may not be a member — the page sets
 * context via API calls); for everyone else only a 404 (team not in the active
 * session) is, anything else propagates.
 */
async function switchTeamOnClient(switchTeamBySlug: (slug: string) => Promise<unknown>, teamSlug: string, superAdmin: boolean) {
  if (!import.meta.client) return
  try {
    await switchTeamBySlug(teamSlug)
  } catch (e) {
    if (!superAdmin && statusOf(e) !== 404) throw e
  }
}

/** Ask the can endpoint; 403 → not a member, any other failure → 401. */
type RequestFetch = ReturnType<typeof useRequestFetch>

async function fetchAllowed(requestFetch: RequestFetch, teamSlug: string, actions: string[]): Promise<Record<string, boolean>> {
  try {
    return await requestFetch<Record<string, boolean>>(`/api/teams/${teamSlug}/can`, {
      query: { actions: actions.join(',') }
    })
  } catch (e) {
    if (statusOf(e) === 403) {
      throw createError({ status: 403, statusText: 'Forbidden', message: 'You are not a member of this team' })
    }
    console.error('[@crouton/auth] can middleware: could not verify access', e)
    throw createError({ status: 401, statusText: 'Unauthorized', message: 'Could not verify access' })
  }
}

/**
 * Allow the navigation only when every action is allowed in the route's team.
 * Signed out → login redirect; super-admins skip the check; refused → 403.
 */
export async function checkRouteCan(to: RouteLike | RouteLocationNormalized, actions: string[]) {
  const { data: sessionData, isPending, isAuthenticated } = useSession()
  const { switchTeamBySlug } = useTeam()
  // Taken before any await — see the header comment.
  const requestFetch = useRequestFetch()
  const nuxtApp = useNuxtApp()

  await waitForSession(isPending)

  if (!isAuthenticated.value) {
    return nuxtApp.runWithContext(() => navigateTo({ path: '/auth/login', query: { redirect: to.fullPath } }))
  }

  const teamSlug = to.params.team as string | undefined
  if (!teamSlug) {
    throw createError({ status: 400, statusText: 'Bad Request', message: 'Team parameter is required' })
  }

  // Super admins bypass the team checks (kept from team-admin)
  const user = sessionData.value?.user as { superAdmin?: boolean } | undefined
  const superAdmin = user?.superAdmin === true
  await switchTeamOnClient(switchTeamBySlug, teamSlug, superAdmin)
  if (superAdmin) return

  // A page that names no action is a mistake: refuse it rather than let it through.
  if (actions.length === 0) {
    console.error(`[@crouton/auth] can middleware: ${to.fullPath} names no meta.can action — refusing`)
    throw createError({ status: 403, statusText: 'Forbidden', message: 'Not allowed: no action declared' })
  }

  const allowed = await fetchAllowed(requestFetch, teamSlug, actions)

  const refused = actions.find(a => allowed?.[a] !== true)
  if (refused) {
    throw createError({ status: 403, statusText: 'Forbidden', message: `Not allowed: ${refused}` })
  }
}
