/**
 * Team-host router history (#4175)
 *
 * On a connected domain (team routing mode) the router works with team-ful
 * paths (`/acme/fr/about`) so the `[team]` page routes and their `validate`
 * match, while the address bar and every rendered `href` stay plain
 * (`/fr/about`). The wrapper adds the team when reading the address bar (same
 * rule as the server rewrite) and strips it whenever it writes the address bar
 * or builds an `href` — including Nuxt's first-load `router.replace`.
 */
import type { RouterHistory } from 'vue-router'
import { rewriteForTeamHost, stripTeamPrefix } from './custom-domain-path'

export function teamHostHistory(inner: RouterHistory, teamSlug: string, appSegments: readonly string[]): RouterHistory {
  const read = (loc: string) => rewriteForTeamHost(loc, teamSlug, appSegments) ?? loc
  const write = (to: string) => stripTeamPrefix(to, teamSlug)

  const wrapped = Object.create(inner) as RouterHistory
  Object.defineProperties(wrapped, {
    location: {
      get: () => read(inner.location),
      enumerable: true
    },
    push: {
      value: (to: string, data?: Parameters<RouterHistory['push']>[1]) => inner.push(write(to), data)
    },
    replace: {
      value: (to: string, data?: Parameters<RouterHistory['replace']>[1]) => inner.replace(write(to), data)
    },
    createHref: {
      value: (to: string) => inner.createHref(write(to))
    },
    listen: {
      value: (cb: Parameters<RouterHistory['listen']>[0]) =>
        inner.listen((to, from, info) => cb(read(to), read(from), info))
    }
  })
  return wrapped
}
