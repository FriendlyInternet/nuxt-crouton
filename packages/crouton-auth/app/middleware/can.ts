/**
 * `can` page middleware (#4105) — every matched route's `meta.can` must pass.
 *
 * @example
 * ```vue
 * <script setup>
 * definePageMeta({ middleware: ['auth', 'can'], can: 'site:manage' })
 * </script>
 * ```
 *
 * A parent and a child page can each name their own action: both are checked
 * (Nuxt runs a named middleware once per navigation, and this reads all of
 * `to.matched`). Super-admins skip the check; refused → 403.
 */
import { checkRouteCan, routeActions } from '../utils/routeCan'

declare module '#app' {
  interface PageMeta {
    /** Action(s) the signed-in member needs in the route's team (`can` middleware). */
    can?: string | string[]
  }
}

export default defineNuxtRouteMiddleware(to => checkRouteCan(to, routeActions(to)))
