/**
 * Bookings full screen smoke (#3079, #3046).
 *
 * #3079 — every Panel on one screen shows the same week, filters, day and view.
 * The admin page mounts the Panel twice (inline + full-screen modal); each used
 * to own its own store, so closing full screen lost everything the user had picked.
 *
 * #3046 — on a phone (below lg) the page shows no inline calendar, only the
 * "Open bookings tool" launcher. Full screen has no title bar: one toolbar row that
 * ends in a single labelled close. Month view leaves room for the booking list.
 * Desktop keeps the inline calendar.
 *
 * Fixture-scoped: only the `with-bookings` fixture has the admin bookings page.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, FIXTURE, ensureAuthed, surfaceUrl, TEAM_FILE } from './helpers'

const FIRST_HIT = 180000
const PHONE = { width: 390, height: 667 }

// The visible week's day cells (the hidden sizing grid is aria-hidden).
const cells = (scope: Locator | Page) => scope.locator('.grid:not([aria-hidden="true"]) > div > [role="button"]')

async function showCancelled(page: Page, scope: Locator | Page, toggle = false): Promise<string | null> {
  await scope.getByRole('button', { name: 'Calendar settings' }).first().click()
  const item = page.getByRole('menuitemcheckbox', { name: /show cancelled/i })
  if (toggle) await item.click()
  else {
    const state = await item.getAttribute('aria-checked')
    await page.keyboard.press('Escape')
    return state
  }
  const state = await item.getAttribute('aria-checked').catch(() => null)
  await page.keyboard.press('Escape')
  return state
}

async function openPage(page: Page, baseURL: string | undefined) {
  const base = baseURL || 'http://localhost:3000'
  const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  await ensureAuthed(page, base)
  await page.goto(surfaceUrl(base, slug, '/admin/{team}/bookings'), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
}

async function openFullScreen(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog')
  // A click before hydration does nothing, so retry until the modal is open.
  await expect(async () => {
    await page.getByRole('button', { name: 'Open bookings tool' }).click()
    await expect(dialog).toBeVisible({ timeout: 5000 })
  }).toPass({ timeout: FIRST_HIT })
  return dialog
}

async function closeFullScreen(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close full screen' }).click()
  await expect(dialog).toHaveCount(0)
}

/** Make sure the fixture team has at least `count` locations (idempotent across retries). */
async function ensureLocations(page: Page, baseURL: string | undefined, count: number) {
  const base = baseURL || 'http://localhost:3000'
  const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  await ensureAuthed(page, base)
  const headers = { Origin: base, Referer: `${base}/` }
  const orgsRes = await page.request.get(`${base}/api/auth/organization/list`, { headers })
  const orgs = orgsRes.ok() ? await orgsRes.json().catch(() => []) : []
  const teamId = (Array.isArray(orgs) ? orgs : []).find((o: any) => o.slug === slug)?.id
  expect(teamId, `team id for slug ${slug}`).toBeTruthy()

  const url = `${base}/api/teams/${teamId}/bookings-locations`
  const listRes = await page.request.get(url, { headers })
  expect(listRes.ok(), `list locations failed: ${listRes.status()}`).toBeTruthy()
  const existing = await listRes.json()
  const have = Array.isArray(existing) ? existing.length : (existing?.items?.length ?? 0)
  const colors = ['#3b82f6', '#22c55e', '#f97316', '#a855f7']
  for (let n = have; n < count; n++) {
    const res = await page.request.post(url, {
      headers,
      data: {
        title: `e2e loc ${n + 1}`,
        color: colors[n % colors.length],
        slots: [
          { id: `s1-${n}`, label: 'Morning' },
          { id: `s2-${n}`, label: 'Afternoon' },
          { id: `s3-${n}`, label: 'Evening' }
        ]
      }
    })
    expect(res.ok(), `create location failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  }
}

// Only the with-bookings fixture has the admin bookings page; other fixtures don't register this suite.
test.describe(FIXTURE === 'with-bookings' ? 'bookings full screen' : 'bookings full screen (not this fixture)', () => {
  if (FIXTURE !== 'with-bookings') return

  test('phone: no inline calendar, only the full-screen button', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openPage(page, baseURL)
    await expect(page.getByRole('button', { name: 'Open bookings tool' })).toBeVisible({ timeout: FIRST_HIT })
    await expect(page.getByText('Tap to see and manage bookings')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.booking-panel').first()).toBeHidden()
  })

  test('phone: closing and reopening full screen keeps the week, the filter and the day', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openPage(page, baseURL)
    let dialog = await openFullScreen(page)

    await dialog.getByRole('button', { name: 'Next week' }).click()
    await showCancelled(page, dialog, true)
    await page.keyboard.press('Escape')
    await cells(dialog).nth(3).click()
    const fullScreenCells = await cells(dialog).allTextContents()
    await closeFullScreen(page, dialog)

    dialog = await openFullScreen(page)
    expect(await cells(dialog).allTextContents()).toEqual(fullScreenCells)
    expect(await showCancelled(page, dialog)).toBe('true')
    await expect(cells(dialog).nth(3)).toHaveClass(/bg-elevated/)
  })

  test('phone: the view carries over', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openPage(page, baseURL)
    let dialog = await openFullScreen(page)
    await dialog.getByRole('button', { name: 'Month' }).click()
    await closeFullScreen(page, dialog)
    dialog = await openFullScreen(page)
    await expect(dialog.getByRole('button', { name: 'Next week' })).toHaveCount(0)
  })

  test('phone: full screen has one toolbar row and one close', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openPage(page, baseURL)
    const dialog = await openFullScreen(page)

    // Hidden screen-reader title, no visible title bar.
    await expect(dialog).toHaveAccessibleName('Bookings')
    await expect(dialog.locator('[data-slot="header"]')).toHaveCount(0)

    const close = dialog.getByRole('button', { name: 'Close full screen' })
    await expect(close).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)

    // Same row as the view toggle.
    const closeBox = await close.boundingBox()
    const monthBox = await dialog.getByRole('button', { name: 'Month' }).boundingBox()
    expect(closeBox && monthBox).toBeTruthy()
    expect(Math.abs(closeBox!.y - monthBox!.y)).toBeLessThanOrEqual(8)

    await close.click()
    await expect(dialog).toHaveCount(0)
  })

  test('phone: month view leaves room for the list', async ({ page, baseURL }) => {
    await ensureLocations(page, baseURL, 3)
    await page.setViewportSize(PHONE)
    await openPage(page, baseURL)
    const dialog = await openFullScreen(page)
    await dialog.getByRole('button', { name: 'Month' }).click()
    await expect(dialog.getByRole('button', { name: 'Next week' })).toHaveCount(0)

    // The scroll area (map + list) under the fixed filters + calendar.
    const list = dialog.locator('.booking-panel > :nth-child(2)')
    await expect.poll(async () => (await list.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(200)

    // No dots clipped: a rendered month cell holds its whole stack.
    const cell = dialog.locator('[style*="min-height"]').first()
    const fits = await cell.evaluate(el => el.scrollHeight <= el.clientHeight)
    expect(fits).toBe(true)
  })

  test('desktop: no full-screen button, inline week navigation still works', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPage(page, baseURL)
    // The phone launcher card (hint + big button) must stay off the desktop page.
    await expect(page.getByRole('button', { name: 'Open bookings tool' })).toBeHidden()
    await expect(page.getByText('Tap to see and manage bookings')).toBeHidden()
    const inline = page.locator('.booking-panel').first()
    await expect(inline).toBeVisible()
    const before = await cells(inline).allTextContents()
    await inline.getByRole('button', { name: 'Next week' }).click()
    await expect.poll(async () => cells(inline).allTextContents()).not.toEqual(before)
  })
})
