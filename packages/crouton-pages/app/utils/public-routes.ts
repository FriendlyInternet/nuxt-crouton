/**
 * Public route options (build time)
 *
 * Pure helpers — no Nuxt imports — so both the layer's `pages:extend` hook in
 * nuxt.config.ts and the vitest suite can use them.
 *
 * - `locale` / `custom` routing mode: the package's two public routes
 *   (`team-locale-slug`, `team-slug`) are removed so the app owns its routes.
 * - `team` mode + `hideLocaleInUrl`: the app must have exactly one locale; the
 *   locale route is pinned to that code (`/:team()/:locale(en)/:slug(.*)*`) so a
 *   plain address like `/acme/about` falls through to `team-slug`, which then
 *   renders the page instead of forwarding.
 * - Setting off: the routes are left exactly as Nuxt generated them.
 */

export interface PublicRouteOptions {
  routingMode: string
  hideLocaleInUrl: boolean
  locales: string[]
}

const PUBLIC_ROUTE_NAMES = new Set(['team-locale-slug', 'team-slug'])

/**
 * When `hideLocaleInUrl` is on, require exactly one locale and return it.
 * Returns null when the setting is off.
 */
export function assertSingleLocale(hideLocaleInUrl: boolean, locales: string[]): string | null {
  if (!hideLocaleInUrl) return null
  if (locales.length !== 1) {
    throw new Error(
      `[crouton-pages] hideLocaleInUrl needs exactly one locale, but this app has: ${locales.join(', ') || '(none)'}. `
      + 'Remove extra locales from crouton.config.js or turn hideLocaleInUrl off.',
    )
  }
  return locales[0]!
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type RoutePage = { name?: string, path: string }

function isAppOwnedMode(routingMode: string): boolean {
  return routingMode === 'locale' || routingMode === 'custom'
}

/** locale/custom mode: the app provides its own routes — drop ours. */
function removePublicRoutes(pages: RoutePage[]): void {
  for (let i = pages.length - 1; i >= 0; i--) {
    if (PUBLIC_ROUTE_NAMES.has(pages[i]?.name ?? '')) pages.splice(i, 1)
  }
}

/** team mode + hideLocaleInUrl: the locale route only matches the one locale. */
function pinLocaleRoute(pages: RoutePage[], code: string): void {
  const route = pages.find(p => p.name === 'team-locale-slug')
  if (route) route.path = `/:team()/:locale(${escapeRegex(code)})/:slug(.*)*`
}

export function applyPublicRouteOptions(pages: RoutePage[], opts: PublicRouteOptions): void {
  const routingMode = opts.routingMode || 'team'

  if (isAppOwnedMode(routingMode)) {
    if (opts.hideLocaleInUrl) {
      console.warn(`[crouton-pages] hideLocaleInUrl only applies in 'team' routing mode — ignored in '${routingMode}' mode.`)
    }
    removePublicRoutes(pages)
    return
  }

  if (routingMode === 'team' && opts.hideLocaleInUrl) {
    pinLocaleRoute(pages, assertSingleLocale(true, opts.locales)!)
  }
}

/**
 * Runtime check used by [team]/[...slug].vue's layout middleware: does the
 * no-locale route render pages (rather than forward)? Team mode + setting on.
 */
export function rendersWithoutLocale(cfg: { hideLocaleInUrl?: boolean, routingMode?: string } | undefined): boolean {
  return cfg?.hideLocaleInUrl === true && (cfg.routingMode || 'team') === 'team'
}
