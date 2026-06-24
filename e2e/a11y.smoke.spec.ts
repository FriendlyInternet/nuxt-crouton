/**
 * Generic accessibility smoke — runs axe-core against each rendered surface.
 *
 * The runtime a11y check (epic #726 WS2). Fixture-agnostic, same contract as the
 * other manifest-driven specs: for every collection list page and every declared
 * `surface`, it waits for the page to render, then runs axe-core on the live DOM
 * and FAILS on any critical/serious violation. Moderate/minor are recorded as
 * advisory annotations (visible in the Playwright report/trace), not failures —
 * we start lenient so the gate lands without walling existing generated templates
 * red (see A11Y_BLOCKING_IMPACTS in helpers.ts).
 *
 * This catches what the static eslint-a11y layer (#727) can't: computed ARIA
 * roles, colour contrast, focus order — because it scans the actually-rendered
 * page (generated templates included), reusing the fixture the smoke already
 * boots + authenticates.
 *
 * Opt-out (to quarantine a known-bad surface while a fix is tracked):
 *   - whole fixture:   manifest `"a11y": false`
 *   - one collection:  collection `"a11y": false`
 *   - one surface:     surface `"expect": { "a11y": false }`
 *
 * Uses the saved auth state (see auth.setup.ts).
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  collectionUrl,
  surfaceUrl,
  ensureAuthed,
  fixtureManifest,
  scanA11y,
  classifyA11y,
  formatA11yViolations,
  TEAM_FILE,
  FIXTURE
} from './helpers'

const manifest = fixtureManifest()
const fixtureEnabled = manifest.a11y !== false
const collections = manifest.collections.filter(c => c.a11y !== false)
const surfaces = (manifest.surfaces ?? []).filter(s => s.expect.a11y !== false)

test.describe(`fixture "${FIXTURE}" a11y (axe-core)`, () => {
  test.skip(!fixtureEnabled, 'fixture opts out of a11y (manifest a11y=false)')
  test.skip(
    collections.length === 0 && surfaces.length === 0,
    'fixture has no collections/surfaces to scan (all opted out)'
  )

  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  /** Scan a rendered page: fail on blocking violations, annotate the advisory ones. */
  async function assertNoBlockingViolations(page: import('@playwright/test').Page, label: string) {
    const { blocking, advisory } = classifyA11y(await scanA11y(page))

    // Surface advisory findings (moderate/minor + baselined shell rules) in the
    // report without failing — they're tracked, not gated.
    if (advisory.length) {
      const summary = formatA11yViolations(advisory)
      test.info().annotations.push({ type: 'a11y-advisory', description: `${label}\n${summary}` })
      console.log(`[a11y advisory] ${label}:\n${summary}`)
    }

    expect(
      blocking,
      `Critical/serious a11y violations on ${label}:\n${formatA11yViolations(blocking)}`
    ).toEqual([])
  }

  for (const collection of collections) {
    test(`collection "${collection.key}" list is accessible`, async ({ page, baseURL }) => {
      const base = baseURL || 'http://localhost:3000'
      // The reused storageState session may have been invalidated by the auth
      // smoke specs; re-establish it before hitting a protected route.
      await ensureAuthed(page, base)
      await page.goto(collectionUrl(base, slug, collection.key), { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      // Wait for real content (the list heading) so axe scans the page, not a
      // cold-compile spinner. Generous: the dev server compiles on first hit.
      await expect(page.getByRole('heading', { name: new RegExp(collection.heading, 'i') }))
        .toBeVisible({ timeout: 180000 })

      await assertNoBlockingViolations(page, `collection list "${collection.key}"`)
    })
  }

  for (const surface of surfaces) {
    test(`surface "${surface.name}" is accessible`, async ({ page, baseURL }) => {
      const base = baseURL || 'http://localhost:3000'
      await ensureAuthed(page, base)
      await page.goto(surfaceUrl(base, slug, surface.path), { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})

      // Wait for the surface's declared element/heading before scanning.
      const { visible, heading } = surface.expect
      if (visible) {
        await expect(page.locator(visible).first()).toBeVisible({ timeout: 180000 })
      } else if (heading) {
        await expect(page.getByRole('heading', { name: new RegExp(heading, 'i') }).first())
          .toBeVisible({ timeout: 180000 })
      }

      await assertNoBlockingViolations(page, `surface "${surface.name}"`)
    })
  }
})
