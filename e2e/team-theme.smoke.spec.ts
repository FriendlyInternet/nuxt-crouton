/**
 * Team theme smoke (#4551) — the Team › Uiterlijk (look-and-feel) page must
 * load its controls when the app booted on a page with no team.
 *
 * The team-theme plugin runs once per app boot. A session that starts on
 * /auth/login (the one-tap review link always does) boots with no team, so
 * the plugin skipped the load and the page spun forever until a reload.
 * useTeamTheme() now loads the theme itself once the team is known.
 *
 * Isolation: own browser context + fresh session, so the app really boots on
 * the sign-in page; navigation to the settings page goes through the in-app
 * router (no reload), exactly like a user clicking through.
 */
import { expect } from '@playwright/test'
import {
  test, loginOrRegister, ensureTeam, isAuthenticated,
  config, SIGN_IN_BUTTON, FIXTURE
} from './helpers'

/** A context with no saved session at all (the project default reuses one). */
const EMPTY_STATE = { cookies: [], origins: [] }

test.describe(`fixture "${FIXTURE}" team theme`, () => {
  test('look-and-feel loads after signing in, without a reload', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    // Make sure the user + team exist (may sign in via the API only).
    const setup = await browser.newContext({ storageState: EMPTY_STATE })
    let slug: string
    try {
      const setupPage = await setup.newPage()
      await loginOrRegister(setupPage, base)
      slug = await ensureTeam(setupPage, base)
    }
    finally {
      await setup.close()
    }

    const context = await browser.newContext({ storageState: EMPTY_STATE })
    const page = await context.newPage()
    try {
      // Boot the app on the sign-in page (no team, no session) and sign in
      // through the real form, so the app keeps running from that boot.
      await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
      const email = page.locator('input[type="email"]')
      await email.waitFor({ state: 'visible', timeout: 120_000 })
      await email.fill(config.testUser.email)
      await page.locator('input[type="password"]').first().fill(config.testUser.password)
      await page.getByRole('button', { name: SIGN_IN_BUTTON }).first().click()
      await expect.poll(() => isAuthenticated(page, base), { timeout: 15_000 }).toBe(true)
      await page.waitForLoadState('networkidle').catch(() => {})

      const path = `/admin/${slug}/team/look-and-feel`
      await page.evaluate((to) => {
        const app = (document.querySelector('#__nuxt') as any).__vue_app__
        return app.config.globalProperties.$router.push(to)
      }, path)
      await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 15_000 })

      await expect(page.getByTestId('team-theme-controls')).toBeVisible({ timeout: 15_000 })
    }
    finally {
      await context.close()
    }
  })
})
