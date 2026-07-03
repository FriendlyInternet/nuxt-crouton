/**
 * ensure-team — every logged-in user always has an ACTIVE team.
 *
 * `/builder` is a root route (no `[team]` param), so team context comes entirely from the
 * session's active organization. The auth package self-heals the "has orgs, none active"
 * case (useSession's `trySetDefaultOrg` sets the first active), and `autoCreateOnSignup`
 * gives every NEW signup an org. The gap this closes: an **already-accountless** session
 * (a user who signed up before auto-create, or a seeded member whose org row is missing) —
 * zero orgs means `trySetDefaultOrg` has nothing to activate, so `teamId` stays null and
 * the "New page" button sits in "Preparing…" forever (verified on the deployed build: a
 * fresh account had zero orgs).
 *
 * We create a personal workspace via the better-auth HTTP endpoints (NOT `useAuthClient`,
 * which isn't defined in a plugin — that threw at init and blanked the app), then let
 * `session.refresh()` re-run the package's activation. Fully defensive: it must never throw
 * at plugin init.
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return

  let session: ReturnType<typeof useSession>
  try {
    session = useSession()
  } catch {
    return
  }
  const { isAuthenticated, activeOrganization, isPending } = session

  let ensuring = false
  async function ensureActiveTeam() {
    if (ensuring) return
    if (isPending.value || !isAuthenticated.value || activeOrganization.value) return
    ensuring = true
    try {
      const orgs = await $fetch<Array<{ id: string }>>('/api/auth/organization/list').catch(() => [])
      if (Array.isArray(orgs) && orgs.length) {
        // Has an org but none active — nudge the package to activate it.
        await session.refresh()
        return
      }
      // Zero orgs — create a personal workspace, then let the session pick it up + activate.
      await $fetch('/api/auth/organization/create', {
        method: 'POST',
        body: { name: 'My workspace', slug: `ws-${Math.random().toString(36).slice(2, 10)}` },
      }).catch(() => null)
      await session.refresh()
    } catch (err) {
      console.warn('[ensure-team] could not ensure an active team', err)
    } finally {
      ensuring = false
    }
  }

  watch([isPending, isAuthenticated, activeOrganization], ensureActiveTeam, { immediate: true })
})
