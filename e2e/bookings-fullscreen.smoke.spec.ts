/**
 * Bookings full screen ↔ inline smoke (#3079) — the rule: every Panel on one
 * screen shows the same week, filters, day and view. The admin page mounts the
 * Panel twice (inline + full-screen modal on a phone); each used to own its own
 * store, so closing full screen lost everything the user had picked.
 *
 * Fixture-scoped: only the `with-bookings` fixture has the admin bookings page.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, FIXTURE, ensureAuthed, surfaceUrl, TEAM_FILE } from './helpers'

const FIRST_HIT = 180000

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
    await page.getByRole('button', { name: 'Open full screen' }).click()
    await expect(dialog).toBeVisible({ timeout: 5000 })
  }).toPass({ timeout: FIRST_HIT })
  return dialog
}

async function closeFullScreen(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe('bookings full screen', () => {
  test.skip(FIXTURE !== 'with-bookings', 'only the with-bookings fixture has the admin bookings page')

  test('phone: full screen → inline keeps the week, the filter and the day', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, baseURL)
    const dialog = await openFullScreen(page)

    await dialog.getByRole('button', { name: 'Next week' }).click()
    await showCancelled(page, dialog, true)
    await page.keyboard.press('Escape')
    await cells(dialog).nth(3).click()
    const fullScreenCells = await cells(dialog).allTextContents()
    await closeFullScreen(page, dialog)

    const inline = page.locator('.booking-panel').first()
    expect(await cells(inline).allTextContents()).toEqual(fullScreenCells)
    expect(await showCancelled(page, inline)).toBe('true')
    await expect(cells(inline).nth(3)).toHaveClass(/bg-elevated/)
  })

  test('phone: the view carries over', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, baseURL)
    const dialog = await openFullScreen(page)
    await dialog.getByRole('button', { name: 'Month' }).click()
    await closeFullScreen(page, dialog)
    await expect(page.locator('.booking-panel').first().getByRole('button', { name: 'Next week' })).toHaveCount(0)
  })

  test('desktop: no full-screen button, inline week navigation still works', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPage(page, baseURL)
    await expect(page.getByRole('button', { name: 'Open full screen' })).toBeHidden()
    const inline = page.locator('.booking-panel').first()
    const before = await cells(inline).allTextContents()
    await inline.getByRole('button', { name: 'Next week' }).click()
    await expect.poll(async () => cells(inline).allTextContents()).not.toEqual(before)
  })
})
