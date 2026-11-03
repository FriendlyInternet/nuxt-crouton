/**
 * i18n locale-switch smoke — proves crouton-i18n's locale switching still works,
 * not just that the package loads.
 *
 * crouton-i18n is bundled by core, so every fixture already *boots* it — but
 * nothing asserts it *behaves*. A broken LanguageSwitcher, a stuck locale, or
 * missing-key fallthrough would pass every other spec. This one flips locale
 * through the user pill's Language submenu and asserts a known UI
 * string changes language; if locale state regresses, the target string never
 * appears and this goes red.
 *
 * Fixture-agnostic: driven entirely by the active fixture's manifest `i18n`
 * block. Fixtures with a single locale omit it and register no test here.
 * Uses the saved auth state (the switcher + the asserted string live on the
 * authenticated home page).
 */
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, surfaceUrl, ensureAuthed, fixtureManifest, TEAM_FILE, FIXTURE } from './helpers'

const i18n = fixtureManifest().i18n

test.describe(`fixture "${FIXTURE}" i18n`, () => {
  // No second locale to switch to — keep the file a no-op rather than failing.
  test.skip(!i18n, 'fixture declares no i18n locale-switch check')

  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  test('switching locale via the crouton-i18n switcher changes the UI language', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const { path, switchTo, before, after } = i18n!

    // The reused storageState session may have been invalidated by the auth
    // smoke specs; re-establish it before asserting authenticated content.
    await ensureAuthed(page, base)
    await page.goto(surfaceUrl(base, slug, path), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Default locale renders the known string in its original language.
    // Generous: the dev server compiles the route on first hit.
    await expect(page.getByText(before, { exact: false }).first()).toBeVisible({ timeout: 180000 })

    // The control lives in the bottom-left user pill's menu (Language submenu),
    // which lists each locale as "<flag> <native name>" (or the uppercase code
    // when the locale has no known name).
    await page.getByRole('button', { name: 'Account and status' }).click()
    await page.getByRole('menuitem', { name: 'Language' }).click()
    const nativeName = new Intl.DisplayNames([switchTo.toLowerCase()], { type: 'language' }).of(switchTo.toLowerCase()) ?? switchTo
    await page.getByRole('menuitem', { name: new RegExp(`(^|\\s)(${switchTo}|${nativeName})$`, 'i') }).click()

    // The same string now renders in the target language — proof the switcher
    // drove a real locale change, not just a cosmetic select value.
    await expect(page.getByText(after, { exact: false }).first()).toBeVisible({ timeout: 60000 })
    await expect(page.getByText(before, { exact: true })).toHaveCount(0)
  })
})
