/**
 * Generic package-surface smoke — the "does this package's own UI mount" check.
 *
 * Fixture-agnostic, same contract as collection.smoke.spec.ts: it reads the
 * active fixture's e2e.manifest.json `surfaces[]` (if any) and, for each, visits
 * the route and asserts the declared element/heading is visible. This is how a
 * fixture proves the package it exercises actually renders its admin UI — not
 * just that the app still boots and does generic CRUD.
 *
 * Fixtures with nothing package-specific to assert simply omit `surfaces`; this
 * file then registers no tests for them.
 *
 * Uses the saved auth state (see auth.setup.ts).
 */
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, surfaceUrl, ensureAuthed, fixtureManifest, TEAM_FILE, FIXTURE } from './helpers'

const manifest = fixtureManifest()
const surfaces = manifest.surfaces ?? []

test.describe(`fixture "${FIXTURE}" surfaces`, () => {
  // Nothing to assert for this fixture — keep the file a no-op rather than failing.
  test.skip(surfaces.length === 0, 'fixture declares no surfaces')

  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  for (const surface of surfaces) {
    test(surface.name, async ({ page, baseURL }) => {
      const base = baseURL || 'http://localhost:3000'
      // The reused storageState session may have been invalidated by the auth
      // smoke specs; re-establish it before hitting a protected surface route.
      await ensureAuthed(page, base)
      await page.goto(surfaceUrl(base, slug, surface.path), { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})

      const { visible, heading } = surface.expect
      // Generous timeout: the dev server compiles the route on first hit.
      // `.first()` keeps "is this surface present" robust when a selector legitimately
      // matches more than one element (e.g. a nav link in both sidebar and in-page tabs).
      if (visible) {
        await expect(page.locator(visible).first()).toBeVisible({ timeout: 180000 })
      }
      if (heading) {
        await expect(page.getByRole('heading', { name: new RegExp(heading, 'i') }).first())
          .toBeVisible({ timeout: 180000 })
      }
    })
  }
})
