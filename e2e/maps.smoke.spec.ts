/**
 * Maps + geocoding smoke — proves crouton-maps actually works, not just that the
 * package loads. Two checks, both driven by the active fixture's manifest `maps`
 * block (omit it and this file registers no tests):
 *
 *   1. The CroutonMapsMap (MapLibre via @geoql/v-maplibre) mounts inside a
 *      generated form. This is offline-safe — the map container + loading state
 *      render even if OpenFreeMap tiles can't be fetched, so it always runs.
 *   2. The /api/maps/geocode proxy converts an address to coordinates. This hits
 *      the *live* public Nominatim, so it skips gracefully when the network is
 *      unavailable (a blocked CI runner must not turn this red).
 *
 * Uses the saved auth state (the form lives on an authenticated admin route).
 */
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, collectionUrl, ensureAuthed, fixtureManifest, TEAM_FILE, FIXTURE } from './helpers'

const maps = fixtureManifest().maps

test.describe(`fixture "${FIXTURE}" maps`, () => {
  // No crouton-maps surface on this fixture — keep the file a no-op.
  test.skip(!maps, 'fixture declares no maps check')

  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  test('the map component mounts inside the generated form', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const { collectionKey } = maps!

    await ensureAuthed(page, base)
    await page.goto(collectionUrl(base, slug, collectionKey), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Open the create form (slideover/modal/dialog all expose role=dialog).
    // Generous timeout: the dev server compiles the route on first hit.
    await expect(page.getByRole('button', { name: /create|add|new/i }).first())
      .toBeVisible({ timeout: 180000 })
    await page.getByRole('button', { name: /create|add|new/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60000 })

    // The map field may live on a secondary form tab (CroutonFormLayout → UTabs),
    // whose content is lazily rendered — so the `.crouton-map-wrapper` only exists
    // once that tab is active. Activate it when the manifest names one.
    if (maps!.formTab) {
      const tab = new RegExp(maps!.formTab, 'i')
      await dialog.getByRole('tab', { name: tab })
        .or(dialog.getByRole('button', { name: tab }))
        .first().click()
    }

    // The crouton-maps form picker renders its wrapper regardless of whether the
    // tiles load — so this asserts the package mounted, not that the network is up.
    await expect(dialog.locator('.crouton-map-wrapper').first())
      .toBeVisible({ timeout: 60000 })
  })

  test('geocoding converts an address to coordinates (live Nominatim)', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const { query, near, tolerance } = maps!.geocode

    // The proxy calls live Nominatim. If the network is blocked (common in CI
    // sandboxes), skip rather than fail — this is an integration check, not a gate.
    let payload: any
    try {
      const res = await page.request.get(`${base}/api/maps/geocode`, {
        params: { q: query },
        timeout: 30000
      })
      test.skip(!res.ok(), `geocode proxy returned ${res.status()} — Nominatim likely unreachable`)
      payload = await res.json()
    } catch (e) {
      test.skip(true, `geocode request failed (network blocked?): ${(e as Error).message}`)
      return
    }

    // Shape check: our proxy normalises Nominatim into { features: [{ center, ... }] }.
    expect(Array.isArray(payload?.features)).toBe(true)
    test.skip(payload.features.length === 0, 'Nominatim returned no results for the query')

    const [lng, lat] = payload.features[0].center as [number, number]
    expect(typeof lng).toBe('number')
    expect(typeof lat).toBe('number')

    // Roughly where we expect — generous tolerance keeps it from being brittle
    // against Nominatim result drift while still proving real geocoding happened.
    expect(Math.abs(lng - near[0])).toBeLessThan(tolerance)
    expect(Math.abs(lat - near[1])).toBeLessThan(tolerance)
  })
})
