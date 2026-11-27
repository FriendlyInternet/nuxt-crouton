/**
 * Tab rows scroll sideways only (#4330, #4386).
 *
 * On a phone, a row of tabs that is wider than the screen must scroll left and
 * right, but a vertical swipe/wheel over it must not nudge the row up or down.
 * The fix is `SCROLL_ROW_X` (crouton-core `app/utils/scroll-row.ts`); this spec
 * checks the behaviour on screen for every row that uses it:
 *   - with-bookings: the shared tab bar (`CroutonTabsPanel`) and the booking
 *     card's location tabs (scoped to the list, so it never matches the panel
 *     row above it);
 *   - with-sales: kassa's category tabs, in view mode (UTabs) and edit mode
 *     (the sortable `<ul role="tablist">`).
 *
 * Two checks per row: computed `overflow-y` is `hidden` (catches the class
 * coming off even on rows with no vertical overflow, like kassa's pills), and
 * `scrollTop` stays 0 after a vertical wheel (the bug the owner felt). We do NOT
 * assert `scrollHeight === clientHeight`: it is false on the fixed rows too.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  test,
  FIXTURE,
  activeTeamId,
  ensureAuthed,
  ensureBookingLocations,
  surfaceUrl,
  TEAM_FILE
} from './helpers'

const FIRST_HIT = 180000
const PHONE = { width: 390, height: 844 }

/** The row must scroll sideways but never vertically (#4330, #4386). */
async function expectSidewaysOnly(page: Page, inside: Locator) {
  await expect(inside).toBeVisible({ timeout: FIRST_HIT })
  const row = await inside.evaluateHandle(e => e.closest('.overflow-x-auto'))
  expect(row.asElement(), 'scrolling row').toBeTruthy()
  await row.asElement()!.hover()
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(300)
  const m = await row.evaluate((e: any) => ({
    oy: getComputedStyle(e).overflowY,
    top: e.scrollTop,
    sw: e.scrollWidth,
    cw: e.clientWidth
  }))
  expect(m.oy, 'computed overflow-y').toBe('hidden')
  expect(m.top, 'scrollTop after a vertical wheel').toBe(0)
  expect(m.sw, 'more tabs than fit, so it scrolls sideways').toBeGreaterThan(m.cw)
}

/** Click `opener` until `dialog` shows (a click before hydration does nothing). */
async function openDialog(page: Page, opener: Locator): Promise<Locator> {
  const dialog = page.getByRole('dialog')
  await expect(async () => {
    await opener.click()
    await expect(dialog).toBeVisible({ timeout: 5000 })
  }).toPass({ timeout: FIRST_HIT })
  return dialog
}

async function openBookingsPage(page: Page, baseURL: string | undefined) {
  const base = baseURL || 'http://localhost:3000'
  const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  await ensureAuthed(page, base)
  await page.goto(surfaceUrl(base, slug, '/admin/{team}/bookings'), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
}

// Each fixture registers only its own rows (same pattern as bookings-fullscreen).
test.describe('tab rows scroll sideways only', () => {
  if (FIXTURE === 'with-bookings') test.describe('with-bookings', () => {

    // covers: T1
    test('phone: the shared tab bar scrolls sideways only', async ({ page, baseURL }) => {
      await page.setViewportSize(PHONE)
      await openBookingsPage(page, baseURL)
      await expectSidewaysOnly(page, page.getByRole('link', { name: 'Email logs' }))
    })

    // covers: T1
    test('phone: the booking card location tabs scroll sideways only', async ({ page, baseURL }) => {
      await ensureBookingLocations(page, baseURL, 8)
      await page.setViewportSize(PHONE)
      await openBookingsPage(page, baseURL)
      const dialog = await openDialog(page, page.getByRole('button', { name: 'Open bookings tool' }))
      await dialog.getByRole('button', { name: /^Add booking:/ }).nth(3).click({ force: true })
      // Every e2e location is `e2e loc N` (bookings-fullscreen adds 1–3, this adds the rest).
      // Scoped to the scroll area: the panel's own row (#4471) sits above it and has "All".
      const list = dialog.locator('.booking-panel > :nth-child(2)')
      await expect(list.getByRole('tab', { name: 'All', exact: true })).toHaveCount(0)
      await expectSidewaysOnly(page, list.getByRole('tab', { name: /e2e loc \d+/ }).first())
    })
  })

  if (FIXTURE === 'with-sales') test.describe('with-sales', () => {

    // covers: T2
    test('phone: kassa category tabs scroll sideways only, in view and edit mode', async ({ page, baseURL }) => {
      const base = baseURL || 'http://localhost:3000'
      const headers = { Origin: base, Referer: `${base}/` }
      await ensureAuthed(page, base)

      // The auth specs switch the active team, so take it from the live session
      // (as printing.smoke.spec.ts does) — the seed keys the event on (teamId, slug).
      const teamId = await activeTeamId(page, base)
      expect(teamId, 'active team id').toBeTruthy()
      const orgsRes = await page.request.get(`${base}/api/auth/organization/list`, { headers })
      const orgs = orgsRes.ok() ? await orgsRes.json().catch(() => []) : []
      const teamSlug = (Array.isArray(orgs) ? orgs : []).find((o: any) => o.id === teamId)?.slug
      expect(teamSlug, 'active team slug').toBeTruthy()

      const seedRes = await page.request.post(`${base}/api/_seed`, { headers, data: { teamId, teamSlug } })
      expect(seedRes.ok(), `seed failed: ${seedRes.status()} ${await seedRes.text()}`).toBeTruthy()
      const seed = await seedRes.json()
      expect(seed.eventId, 'seeded event id').toBeTruthy()

      // The seed has 2 categories; top up to 8 on this event so the row overflows.
      const url = `${base}/api/teams/${teamId}/sales-categories`
      const listRes = await page.request.get(`${url}?eventId=${encodeURIComponent(seed.eventId)}`, { headers })
      expect(listRes.ok(), `list categories failed: ${listRes.status()}`).toBeTruthy()
      const existing = await listRes.json()
      const rows = (Array.isArray(existing) ? existing : (existing?.items ?? []))
        .filter((c: any) => c.eventId === seed.eventId)
      for (let n = rows.length; n < 8; n++) {
        const res = await page.request.post(url, {
          headers,
          data: { eventId: seed.eventId, title: `e2e category ${n + 1}`, displayOrder: n + 1 }
        })
        expect(res.ok(), `create category failed: ${res.status()} ${await res.text()}`).toBeTruthy()
      }

      await page.setViewportSize(PHONE)
      await page.goto(surfaceUrl(base, teamSlug, '/admin/{team}/sales/events/vlaamsekermis'), { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      const dialog = await openDialog(page, page.getByRole('button', { name: 'Open register' }))

      // View mode: UTabs.
      await expectSidewaysOnly(page, dialog.getByRole('tab', { name: /e2e category/ }).first())

      // Edit mode: the hand-built sortable `<ul role="tablist">`.
      await dialog.getByRole('button', { name: 'Edit', exact: true }).click()
      await expectSidewaysOnly(page, dialog.locator('ul[role="tablist"]').getByRole('tab', { name: /e2e category/ }).first())
    })
  })
})
