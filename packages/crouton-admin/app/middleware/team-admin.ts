/**
 * Team Admin Middleware
 *
 * @deprecated use crouton-auth's `can` middleware + `meta.can` (#4105):
 * `definePageMeta({ middleware: ['auth', 'can'], can: 'team:manage' })`.
 * Kept for apps outside this repo; no package page uses it. It now asks
 * `team:manage` (default: owner, admin — the same people as before).
 */
export default defineNuxtRouteMiddleware(to => checkRouteCan(to, ['team:manage']))
