/**
 * Assets upload smoke (#2315) — uploads a real file through the media library
 * and asserts it shows up in the grid without a reload. The stale-list bug
 * fixed in #2314 reached staging because no test ever uploaded anything.
 *
 * Fixture-scoped: only runs when the active fixture is `with-assets` (like
 * printing.smoke gates on with-sales).
 *
 * Flow: /admin/{team}/media → Create → file chooser (CroutonImageUpload uses
 * VueUse's useFileDialog, so there is no input in the DOM until it opens) →
 * (Skip crop) → alt text → Upload Asset → the filename appears in the grid.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { FIXTURE, ensureAuthed, surfaceUrl, TEAM_FILE } from './helpers'

const isAssetsFixture = FIXTURE === 'with-assets'

// Cold `nuxt dev` compiles the media route on first hit.
const FIRST_HIT = 180000

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

test.describe('assets upload', () => {
  test.skip(!isAssetsFixture, 'only the with-assets fixture exercises uploads')

  test('an uploaded file appears in the media list without a reload', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
    const filename = `e2e-upload-${Date.now()}.png`

    await ensureAuthed(page, base)
    await page.goto(surfaceUrl(base, slug, '/admin/{team}/media'), { waitUntil: 'domcontentloaded' })

    await page.waitForLoadState('networkidle').catch(() => {})

    // A click before hydration does nothing, so retry until the modal is open.
    const dialog = page.getByRole('dialog')
    await expect(async () => {
      await page.getByRole('button', { name: /^create$/i }).first().click()
      await expect(dialog).toBeVisible({ timeout: 5000 })
    }).toPass({ timeout: FIRST_HIT })

    const chooser = page.waitForEvent('filechooser', { timeout: 60000 })
    // The image drop zone is the dialog's only button without an aria-label (close has one)
    await dialog.locator('button[type="button"]:not([aria-label])').first().click({ timeout: 60000 })
    await (await chooser).setFiles({ name: filename, mimeType: 'image/png', buffer: PNG })

    // The crop step only shows for some images; skip it when it does.
    const skipCrop = dialog.getByRole('button', { name: /skip crop/i })
    const altText = dialog.getByRole('textbox', { name: /alt/i }).first()
    await expect(skipCrop.or(altText).first()).toBeVisible({ timeout: 60000 })
    if (await skipCrop.isVisible()) await skipCrop.click()
    await altText.fill('e2e upload')
    await dialog.getByRole('button', { name: /upload asset/i }).click()

    // The modal closes and the list refetches; no page.reload() on purpose.
    // Wait for the modal to go first: it also shows the filename.
    await expect(dialog).toBeHidden({ timeout: 60000 })
    await expect(page.getByText(filename).first()).toBeVisible({ timeout: 30000 })
  })
})
