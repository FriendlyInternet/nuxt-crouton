/**
 * Bookings panel location tabs (#4471).
 *
 * The panel's locations are one sideways-scrolling row of tabs under the calendar:
 * "All" first and active, then one tab per location. Tapping a location filters
 * the list to it (one at a time); "All" brings everything back.
 *
 * One location (no tabs, only the admin "+") is covered by
 * packages/crouton-bookings/test/location-tabs-template.test.ts: every spec shares
 * one test team that already holds several locations, and none are ever deleted.
 *
 * Fixture-scoped: only the `with-bookings` fixture has the admin bookings page.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, FIXTURE, ensureAuthed, ensureBookingLocations, surfaceUrl, TEAM_FILE } from './helpers'

const FIRST_HIT = 180000
const PHONE = { width: 390, height: 844 }

async function openFullScreen(page: Page, baseURL: string | undefined): Promise<Locator> {
  const base = baseURL || 'http://localhost:3000'
  const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  await ensureAuthed(page, base)
  await page.goto(surfaceUrl(base, slug, '/admin/{team}/bookings'), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const dialog = page.getByRole('dialog')
  // A click before hydration does nothing, so retry until the modal is open.
  await expect(async () => {
    await page.getByRole('button', { name: 'Open bookings tool' }).click()
    await expect(dialog).toBeVisible({ timeout: 5000 })
  }).toPass({ timeout: FIRST_HIT })
  return dialog
}

/** The panel's own row: the tablist in the fixed top block that holds "All". */
function panelRow(dialog: Locator): Locator {
  return dialog.locator('.booking-panel > :first-child')
    .getByRole('tablist')
    .filter({ has: dialog.page().getByRole('tab', { name: 'All', exact: true }) })
}

/** Team id + headers for the fixture team (the way ensureBookingLocations finds it). */
async function team(page: Page, base: string) {
  const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  const headers = { Origin: base, Referer: `${base}/` }
  const orgsRes = await page.request.get(`${base}/api/auth/organization/list`, { headers })
  const orgs = orgsRes.ok() ? await orgsRes.json().catch(() => []) : []
  const teamId = (Array.isArray(orgs) ? orgs : []).find((o: any) => o.slug === slug)?.id
  expect(teamId, `team id for slug ${slug}`).toBeTruthy()
  return { teamId: teamId as string, headers }
}

test.describe('bookings panel location tabs (#4471)', () => {
  if (FIXTURE !== 'with-bookings') return

  // covers: T9
  test('phone: one row of location tabs, "All" active, scrolls sideways', async ({ page, baseURL }) => {
    await ensureBookingLocations(page, baseURL, 8)
    await page.setViewportSize(PHONE)
    const dialog = await openFullScreen(page, baseURL)
    const row = panelRow(dialog)
    await expect(row).toBeVisible({ timeout: FIRST_HIT })

    await expect(row.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true')

    const tabs = row.getByRole('tab')
    const count = await tabs.count()
    expect(count).toBeGreaterThanOrEqual(9) // All + 8 locations
    const firstY = (await tabs.first().boundingBox())!.y
    for (let i = 1; i < count; i++) {
      const box = await tabs.nth(i).boundingBox()
      expect(box, `tab ${i} box`).toBeTruthy()
      expect(Math.abs(box!.y - firstY), `tab ${i} on the same line`).toBeLessThanOrEqual(4)
    }
    const m = await row.evaluate((e: HTMLElement) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    expect(m.sw, 'more tabs than fit, so it scrolls sideways').toBeGreaterThan(m.cw)
  })

  // covers: T10
  test('tapping a location filters the list; "All" restores it; one at a time', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    await ensureBookingLocations(page, baseURL, 8)
    const { teamId, headers } = await team(page, base)

    // One booking at e2e loc 1 and one at e2e loc 2, today (slot ids from ensureBookingLocations).
    const locRes = await page.request.get(`${base}/api/teams/${teamId}/bookings-locations`, { headers })
    const locData = await locRes.json()
    const locs: any[] = Array.isArray(locData) ? locData : (locData?.items ?? [])
    const loc1 = locs.find(l => l.title === 'e2e loc 1')
    const loc2 = locs.find(l => l.title === 'e2e loc 2')
    expect(loc1 && loc2, 'e2e loc 1 and 2 exist').toBeTruthy()
    const today = new Date().toISOString().slice(0, 10)
    // Re-runnable: the fixture DB persists across runs/retries and a slot holds one
    // booking, so a second POST gets 409 "No room left". Create only what is missing.
    // The server stores the day in the bookings timezone (default Europe/Brussels).
    const listRes = await page.request.get(`${base}/api/teams/${teamId}/bookings-bookings`, { headers })
    expect(listRes.ok(), `list bookings failed: ${listRes.status()}`).toBeTruthy()
    const listData = await listRes.json()
    const existing: any[] = Array.isArray(listData) ? listData : (listData?.items ?? [])
    const dayOf = (d: unknown) => new Date(d as string).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
    const slotsOf = (s: unknown): string[] => {
      if (Array.isArray(s)) return s.map(String)
      try { const p = JSON.parse(String(s)); return Array.isArray(p) ? p.map(String) : [String(s)] } catch { return [String(s)] }
    }
    for (const [loc, slot] of [[loc1, 's1-0'], [loc2, 's1-1']] as const) {
      const booked = existing.some(b => b.location === loc.id && dayOf(b.date) === today && slotsOf(b.slot).includes(slot))
      if (booked) continue
      const res = await page.request.post(`${base}/api/teams/${teamId}/bookings-bookings`, {
        headers,
        data: { location: loc.id, date: today, slot: [slot], quantity: 1, status: 'confirmed' }
      })
      expect(res.ok(), `create booking failed: ${res.status()} ${await res.text()}`).toBeTruthy()
    }

    await page.setViewportSize(PHONE)
    const dialog = await openFullScreen(page, baseURL)
    const row = panelRow(dialog)
    await expect(row).toBeVisible({ timeout: FIRST_HIT })
    const list = dialog.locator('.booking-panel > :nth-child(2)')
    const tab = (name: string) => row.getByRole('tab', { name, exact: true })
    const selected = row.locator('[role="tab"][aria-selected="true"]')

    await expect(list).toContainText('e2e loc 1', { timeout: FIRST_HIT })
    await expect(list).toContainText('e2e loc 2')

    await tab('e2e loc 2').click()
    await expect(selected).toHaveCount(1)
    await expect(tab('e2e loc 2')).toHaveAttribute('aria-selected', 'true')
    await expect(list).toContainText('e2e loc 2')
    await expect(list).not.toContainText('e2e loc 1')

    await tab('All').click()
    await expect(tab('All')).toHaveAttribute('aria-selected', 'true')
    await expect(list).toContainText('e2e loc 1')
    await expect(list).toContainText('e2e loc 2')

    await tab('e2e loc 1').click()
    await tab('e2e loc 2').click()
    await expect(selected).toHaveCount(1)
    await expect(tab('e2e loc 2')).toHaveAttribute('aria-selected', 'true')
  })
})
