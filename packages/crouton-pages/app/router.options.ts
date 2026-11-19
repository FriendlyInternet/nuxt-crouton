/**
 * Router options (#4175)
 *
 * On a connected domain in team routing mode, install the team-host history:
 * the router keeps team-ful paths (`/acme/fr/about`, so the `[team]` page
 * routes and their `validate` match) while the address bar and every `href`
 * stay plain (`/fr/about`). Anywhere else return `undefined`, so Nuxt picks its
 * default history and the app host is unchanged.
 *
 * Nuxt calls `history(base)` inside the router plugin's setup (before any
 * await, after the payload is restored), so composables work here.
 */
import type { RouterConfig } from 'nuxt/schema'
import { createMemoryHistory, createWebHistory } from 'vue-router'
import { useDomainContext } from './composables/useDomainContext'
import { teamHostHistory } from './utils/team-host-history'

export default <RouterConfig>{
  history: (base) => {
    const { isTeamHost, resolvedTeamSlug, appSegments } = useDomainContext()
    if (!isTeamHost.value) return undefined
    return teamHostHistory(
      import.meta.client ? createWebHistory(base) : createMemoryHistory(base),
      resolvedTeamSlug.value!,
      appSegments.value
    )
  }
}
