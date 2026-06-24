/**
 * Crouton E2E Helpers
 *
 * Drives current crouton-auth (modal-based) against a fixture app:
 *   - login/register happen in a RouteModal overlay (no dedicated form page)
 *   - signup does NOT auto-create a team; we create one via the better-auth org API
 *
 * Target: fixtures/minimal (pkg "e2e-fixture-minimal").
 */
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which fixture app the run targets. Each fixture is a generated crouton app
 * under fixtures/<name> (pkg "e2e-fixture-<name>") exercising a different set
 * of packages. Defaults to the minimal fixture.
 */
export const FIXTURE = process.env.E2E_FIXTURE || 'minimal'
export const FIXTURE_PKG = `e2e-fixture-${FIXTURE}`

/** One collection the smoke should exercise on the active fixture. */
export interface CollectionSpec {
  /** Registered collection key, e.g. "mainItems" (the /admin/:team/crouton/:key segment). */
  key: string
  /** Visible list heading, e.g. "Main Items". */
  heading: string
  /** Field label/name -> value to fill when creating a row (text fields only). */
  create?: Record<string, string>
  /**
   * Field label/name -> value for the edit step. Omit to derive it: the first
   * create field gets " edited" appended (enough to prove an update persists).
   */
  update?: Record<string, string>
  /**
   * Name of a required field to clear for the invalid-submit check. Set it only
   * when the field is actually required (so validation blocks the submit);
   * omit to skip that check for this collection.
   */
  requiredField?: string
  /**
   * Opt this collection's list page OUT of the axe-core a11y scan
   * (a11y.smoke.spec.ts). Set `false` to quarantine a known-bad surface while a
   * fix is tracked — leave a note in the manifest pointing at the issue. Omit
   * (default) to scan it.
   */
  a11y?: boolean
}

/**
 * A package-specific surface to smoke beyond generic collection CRUD — e.g. the
 * pages package's own `/admin/:team/workspace`. Lets a fixture assert that the
 * package it exercises actually mounts its UI, not just that the app still boots.
 */
export interface SurfaceSpec {
  /** Human label for the test title, e.g. "pages workspace". */
  name: string
  /** Route to visit. `{team}` is replaced with the active team slug. */
  path: string
  /** What must be visible for the surface to count as working. At least one. */
  expect: {
    /** CSS selector that must be visible, e.g. "#pages-sidebar". */
    visible?: string
    /** Visible heading (role=heading) name, matched case-insensitively. */
    heading?: string
    /**
     * Opt this surface OUT of the axe-core a11y scan (a11y.smoke.spec.ts). Set
     * `false` to quarantine a known-bad surface while a fix is tracked (leave a
     * note pointing at the issue). Omit (default) to scan it.
     */
    a11y?: boolean
  }
}

/**
 * A locale-switch check exercising the crouton-i18n LanguageSwitcher. A plain
 * `surface` can only assert a static element renders; this one *interacts* —
 * flips locale via the package-owned switcher and asserts a known UI string
 * changes language — so an i18n regression (broken switcher, stuck locale,
 * missing-key fallthrough) goes red. Needs a fixture with ≥2 configured locales.
 */
export interface I18nSpec {
  /** Page that renders the switcher + a translated string. `{team}` is substituted. */
  path: string
  /** Switcher option to pick — the uppercase locale code label, e.g. "NL". */
  switchTo: string
  /** A known translated string visible in the *default* locale (before switching). */
  before: string
  /** The same string in the *target* locale (visible after switching). */
  after: string
}

/**
 * A maps + geocoding check exercising crouton-maps. A `surface` can only assert a
 * static element renders; this one proves the package's two live behaviours:
 *   1. the CroutonMapsMap (MapLibre) actually mounts inside a generated form, and
 *   2. the /api/maps/geocode proxy converts an address to coordinates.
 * The geocode step hits the live public Nominatim, so it skips gracefully when
 * the network is unavailable (a blocked CI runner must not go red). Omit for
 * fixtures that don't extend crouton-maps.
 */
export interface MapsSpec {
  /** Collection whose generated form embeds the map picker (e.g. "mainVenues"). */
  collectionKey: string
  /** That collection's visible list heading, e.g. "Main Venues". */
  heading: string
  /**
   * Optional name of the form tab the map field lives on (e.g. "Address"). The
   * generated form groups fields into tabs (CroutonFormLayout → UTabs) and tab
   * content is lazily rendered, so when the map isn't on the default tab the smoke
   * must activate this tab before `.crouton-map-wrapper` exists. Omit if the map is
   * on the first/default tab.
   */
  formTab?: string
  /** Address → coordinates check against the /api/maps/geocode proxy. */
  geocode: {
    /** Free-text address to forward-geocode. */
    query: string
    /** Expected result, [lng, lat] — asserted within `tolerance` degrees. */
    near: [number, number]
    /** Allowed deviation in degrees (generous, to avoid brittleness). */
    tolerance: number
  }
}

export interface FixtureManifest {
  collections: CollectionSpec[]
  /** Optional package-specific surfaces; omit for fixtures with nothing extra. */
  surfaces?: SurfaceSpec[]
  /** Optional locale-switch check; omit for fixtures with a single locale. */
  i18n?: I18nSpec
  /** Optional maps + geocoding check; omit for fixtures without crouton-maps. */
  maps?: MapsSpec
  /**
   * Opt the WHOLE fixture out of the axe-core a11y scan (a11y.smoke.spec.ts).
   * Set `false` to skip every collection/surface scan for this fixture. Omit
   * (default) to scan. Prefer the per-collection / per-surface `a11y: false`
   * over this blanket switch so coverage stays as wide as possible.
   */
  a11y?: boolean
}

/** Read the active fixture's e2e manifest (what to smoke). */
export function fixtureManifest(): FixtureManifest {
  const path = join(__dirname, '..', 'fixtures', FIXTURE, 'e2e.manifest.json')
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureManifest
}

// Saved-state paths, anchored to this e2e/ dir so setup-write and spec/config-read
// always agree regardless of the cwd Playwright is invoked from.
export const AUTH_DIR = join(__dirname, '.auth')
export const AUTH_FILE = join(AUTH_DIR, 'user.json')
export const TEAM_FILE = join(AUTH_DIR, 'team.json')

export const config = {
  testUser: {
    name: 'E2E User',
    email: 'e2e-user@example.com',
    password: 'TestPassword123!'
  },
  team: {
    name: 'E2E Team',
    slug: 'e2e-team'
  }
}

/** Better-auth blocks state-changing requests without an Origin header (CSRF). */
function authHeaders(base: string) {
  return { Origin: base, Referer: `${base}/` }
}

/**
 * The current better-auth session payload (`{ user, session }`) or null.
 *
 * crouton-auth enables better-auth's cookie cache (a signed `session_data`
 * cookie, 5-min TTL), so the default get-session can report a *stale* user for
 * up to 5 min after sign-out. We pass `disableCookieCache=true` to force a DB
 * read, so this always reflects the true session state — essential for the auth
 * smoke to observe logout.
 */
export async function getSession(page: Page, base: string): Promise<any | null> {
  const res = await page.request
    .get(`${base}/api/auth/get-session?disableCookieCache=true`)
    .catch(() => null)
  if (!res || !res.ok()) return null
  return res.json().catch(() => null)
}

/** True when a session exists for the current browser context. */
export async function isAuthenticated(page: Page, base: string): Promise<boolean> {
  const session = await getSession(page, base)
  return !!session?.user
}

/**
 * Sign the active session out. Clears the context's session cookie.
 *
 * Passes an empty JSON body so Playwright sets `Content-Type: application/json`
 * — better-auth rejects the POST with 415 otherwise (it requires that header).
 */
export async function signOut(page: Page, base: string): Promise<void> {
  await page.request.post(`${base}/api/auth/sign-out`, { headers: authHeaders(base), data: {} })
}

/** The active organization (team) id on the current session, or null. */
export async function activeTeamId(page: Page, base: string): Promise<string | null> {
  const session = await getSession(page, base)
  return session?.session?.activeOrganizationId ?? null
}

/** Create an organization (team) and return it. Needs an Origin header (CSRF). */
export async function createTeam(page: Page, base: string, name: string, slug: string): Promise<{ id: string; slug: string }> {
  const res = await page.request.post(`${base}/api/auth/organization/create`, {
    headers: authHeaders(base),
    data: { name, slug }
  })
  if (!res.ok()) throw new Error(`Failed to create team: ${res.status()} ${await res.text()}`)
  return res.json()
}

/** Make an organization (team) the active one for the session. */
export async function setActiveTeam(page: Page, base: string, organizationId: string): Promise<void> {
  await page.request.post(`${base}/api/auth/organization/set-active`, {
    headers: authHeaders(base),
    data: { organizationId }
  })
}

// Cold dev-server compiles the auth modal on first hit — be patient. CI runners
// compile much slower than local, so this is deliberately very generous (a high
// cap is free when the route compiles fast; it only matters on a slow first hit).
const MODAL_TIMEOUT = 120000

/** Register the test user via the auth modal. Returns true if a session results. */
async function register(page: Page, base: string): Promise<boolean> {
  await page.goto(`${base}/auth/register`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const name = page.locator('input[type="text"]').first()
  await name.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT })
  await name.fill(config.testUser.name)
  await page.locator('input[type="email"]').fill(config.testUser.email)
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill(config.testUser.password)
  await pw.nth(1).fill(config.testUser.password)
  await page.getByRole('button', { name: /create account/i }).first().click()
  await page.waitForTimeout(2500)
  return isAuthenticated(page, base)
}

/** Log the test user in via the auth modal. Returns true if a session results. */
async function login(page: Page, base: string): Promise<boolean> {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const email = page.locator('input[type="email"]')
  await email.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT }).catch(() => {})
  if (!(await email.isVisible().catch(() => false))) return false
  await email.fill(config.testUser.email)
  await page.locator('input[type="password"]').first().fill(config.testUser.password)
  await page.getByRole('button', { name: /sign in/i }).first().click()
  await page.waitForTimeout(2500)
  return isAuthenticated(page, base)
}

/** Ensure the test user exists and is logged in (login first, register on miss). */
export async function loginOrRegister(page: Page, base: string): Promise<void> {
  if (await isAuthenticated(page, base)) return
  if (await login(page, base)) return
  // User may not exist yet — register. If registration is rejected (already
  // exists), fall back to one more login attempt.
  if (await register(page, base)) return
  if (await login(page, base)) return
  throw new Error('Could not authenticate test user (login and register both failed)')
}

/**
 * Ensure the active session has a team (organization) and return its slug.
 * Signup creates no team, so we create one via the better-auth org API if absent.
 */
export async function ensureTeam(page: Page, base: string): Promise<string> {
  const listRes = await page.request.get(`${base}/api/auth/organization/list`, { headers: authHeaders(base) })
  const orgs = listRes.ok() ? await listRes.json().catch(() => []) : []
  const org = (Array.isArray(orgs) ? orgs[0] : null)
    ?? await createTeam(page, base, config.team.name, config.team.slug)

  await setActiveTeam(page, base, org.id)
  return org.slug as string
}

/**
 * Ensure the current page's context is authenticated, re-establishing the
 * session if the reused storageState one is dead.
 *
 * The auth smoke specs log the *shared* test user in and out in their own
 * contexts; better-auth's session lifecycle is per-user and server-side, so that
 * churn can invalidate the setup session before the content specs (which run
 * after it) reuse it via storageState. Rather than depend on the setup session
 * surviving the whole run, the content specs call this first so they re-login
 * on demand — self-healing regardless of what invalidated the session.
 */
export async function ensureAuthed(page: Page, base: string): Promise<void> {
  if (await isAuthenticated(page, base)) return
  await loginOrRegister(page, base)
  await ensureTeam(page, base)
}

/** Build the admin URL for a generated collection (key, e.g. "mainItems"). */
export function collectionUrl(base: string, teamSlug: string, collectionKey: string): string {
  return `${base}/admin/${teamSlug}/crouton/${collectionKey}`
}

/** Resolve a surface path against the base URL, substituting `{team}`. */
export function surfaceUrl(base: string, teamSlug: string, path: string): string {
  return `${base}${path.replace('{team}', teamSlug)}`
}

/**
 * Fill a form field within a scope (e.g. the create dialog), trying label,
 * then name attribute, then placeholder. Used by the generic create flow.
 */
export async function fillField(scope: Page | ReturnType<Page['getByRole']>, field: string, value: string): Promise<void> {
  const byLabel = scope.getByLabel(new RegExp(`^${field}$`, 'i'))
  if (await byLabel.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await byLabel.first().fill(value)
    return
  }
  const byName = scope.locator(`input[name="${field}" i], textarea[name="${field}" i]`)
  if (await byName.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await byName.first().fill(value)
    return
  }
  const byPlaceholder = scope.locator(`input[placeholder*="${field}" i], textarea[placeholder*="${field}" i]`)
  if (await byPlaceholder.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await byPlaceholder.first().fill(value)
    return
  }
  throw new Error(`Could not find form field "${field}"`)
}

/**
 * axe-core impacts that FAIL the a11y smoke. We start lenient (epic #726 WS2):
 * only `critical`/`serious` go red — these block a screen-reader / keyboard user
 * (missing names, keyboard traps, contrast). `moderate`/`minor` are reported as
 * advisory annotations, not failures, so the gate lands without walling existing
 * generated templates red. Tighten by adding `moderate` here once the backlog is
 * clear.
 */
export const A11Y_BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['critical', 'serious'])

/**
 * axe rules excluded from the gate because they're owned by the DESIGN SYSTEM, not
 * the per-template markup this harness scans.
 *
 * - `color-contrast` — determined by the active theme's colour tokens (Nuxt UI 4 /
 *   crouton-themes), identical across every generated template, so gating each
 *   fixture on it would just re-fail the same theme-level finding on every PR and
 *   wall the whole suite red. Contrast is a theme concern, tracked separately
 *   (epic #726 follow-up / the Unlighthouse sweep, #731). The gate keeps every
 *   STRUCTURAL rule a template actually controls — names, labels, roles,
 *   `image-alt`, keyboard operability — as hard fails.
 */
export const A11Y_EXCLUDED_RULES: readonly string[] = ['color-contrast']

/**
 * Critical/serious rules currently violated by the SHARED admin shell (crouton-core
 * layout) and Nuxt UI 4 / reka-ui chrome — so they appear identically on EVERY
 * fixture and are fixable only in `packages/` (out of this harness's scope). They're
 * downgraded from blocking to ADVISORY so the gate could land green on today's code;
 * tracked in #735 to drive to zero. As each is fixed in the shell, delete it here so
 * the gate starts failing on any regression of it.
 *
 * This is a baseline by RULE, not a blanket disable: a NEW violation of any OTHER
 * rule (e.g. `image-alt`, `label`, `link-name`, `select-name`) on a scanned page
 * still fails the gate — so a template that ships an inaccessible element is caught.
 *
 *   aria-allowed-attr — `aria-controls` on reka-ui collapsible nav trailing-icon
 *     elements (`data-slot="linkTrailing"`), emitted by Nuxt UI 4 `UNavigationMenu`
 *     internals. Our code never adds `aria-controls` (verified #735) — it's an
 *     upstream reka-ui/Nuxt UI bug, so it stays baselined pending an upstream fix.
 *
 * REMOVED (now enforced — the gate FAILS on any regression):
 *   button-name — driven to zero across every fixture in #735 by naming the
 *     icon-only buttons in crouton-core (layout switcher, rows-per-page select,
 *     tree node menus, workspace create), crouton-pages (workspace reorder +
 *     create), crouton-bookings (WeekStrip), and crouton-assets (Picker clear).
 *     Verified green on all six fixtures via @axe-core/playwright.
 */
export const A11Y_KNOWN_SHELL_RULES: readonly string[] = ['aria-allowed-attr']

/** A flattened axe violation — enough to fail a test with an actionable message. */
export interface A11yViolation {
  /** axe rule id, e.g. "image-alt", "color-contrast", "label". */
  id: string
  /** axe impact: "critical" | "serious" | "moderate" | "minor" (may be null). */
  impact: string
  /** Human description of the rule. */
  help: string
  /** Deep link to the axe rule docs. */
  helpUrl: string
  /** How many DOM nodes violated it. */
  nodes: number
  /** Up to 5 offending CSS selectors (the rest are elided). */
  targets: string[]
}

/**
 * Run axe-core against the current page DOM and return the violations, flattened.
 *
 * Injects axe-core (via @axe-core/playwright) into the live page and analyses the
 * rendered DOM — so it catches what static lint can't (computed roles, contrast,
 * focus order). Scoped to the standard WCAG 2.0/2.1 A+AA rule set so best-practice
 * noise (e.g. `region`) doesn't fail the gate; the caller decides which impacts
 * are blocking (see A11Y_BLOCKING_IMPACTS).
 *
 * Call it only AFTER the page has rendered (await a heading/element first) so axe
 * scans real content, not a cold-compile spinner.
 */
export async function scanA11y(page: Page): Promise<A11yViolation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules([...A11Y_EXCLUDED_RULES])
    .analyze()
  return results.violations.map(v => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    targets: v.nodes.flatMap(n => n.target.map(String)).slice(0, 5)
  }))
}

/**
 * Split a scan's violations into what FAILS the gate vs what's only ADVISORY.
 *
 * Blocking = `critical`/`serious` impact AND not a known shared-shell baseline rule
 * (`A11Y_KNOWN_SHELL_RULES`). Everything else — `moderate`/`minor`, plus the
 * baselined shell rules — is advisory: reported in the run, not failed. See the
 * `A11Y_*` constants above for the rationale behind each bucket.
 */
export function classifyA11y(
  violations: A11yViolation[]
): { blocking: A11yViolation[], advisory: A11yViolation[] } {
  const blocking = violations.filter(
    v => A11Y_BLOCKING_IMPACTS.has(v.impact) && !A11Y_KNOWN_SHELL_RULES.includes(v.id)
  )
  const advisory = violations.filter(v => !blocking.includes(v))
  return { blocking, advisory }
}

/** Format violations into a readable multi-line block for a test message / annotation. */
export function formatA11yViolations(violations: A11yViolation[]): string {
  if (!violations.length) return 'no violations'
  return violations
    .map(v => `  [${v.impact}] ${v.id} (${v.nodes} node${v.nodes === 1 ? '' : 's'}) — ${v.help}\n`
      + `    ${v.helpUrl}\n`
      + `    ${v.targets.join(' , ')}`)
    .join('\n')
}
