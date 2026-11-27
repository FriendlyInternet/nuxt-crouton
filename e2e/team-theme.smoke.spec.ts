/**
 * Team theme smoke (#4551, #4563). A session that starts on /auth/login (the
 * one-tap review link always does) boots with no team. Uiterlijk must still
 * load its controls (#4551), and the team's own theme must apply straight
 * after sign-in, with no reload (#4563).
 *
 * Isolation: own browser context + fresh session, so the app really boots on
 * the sign-in page; navigation to the team pages goes through the in-app
 * router (no reload), exactly like a user clicking through.
 */
import { expect, type Browser, type Page } from '@playwright/test'
import {
  test, loginOrRegister, ensureTeam, isAuthenticated, activeTeamId,
  config, SIGN_IN_BUTTON, FIXTURE
} from './helpers'

/** A context with no saved session at all (the project default reuses one). */
const EMPTY_STATE = { cookies: [], origins: [] }

/** Make sure the user + team exist (may sign in via the API only); return the slug. */
async function prepareTeam(browser: Browser, base: string, theme?: Record<string, unknown>): Promise<string> {
  const setup = await browser.newContext({ storageState: EMPTY_STATE })
  try {
    const setupPage = await setup.newPage()
    await loginOrRegister(setupPage, base)
    const slug = await ensureTeam(setupPage, base)
    if (theme) await patchTheme(setupPage, base, theme)
    return slug
  }
  finally {
    await setup.close()
  }
}

async function patchTheme(page: Page, base: string, theme: Record<string, unknown>): Promise<void> {
  const id = await activeTeamId(page, base)
  if (!id) throw new Error('No active team to set the theme on')
  const res = await page.request.patch(`${base}/api/teams/${id}/settings/theme`, {
    headers: { Origin: base, Referer: `${base}/` },
    data: theme
  })
  if (!res.ok()) throw new Error(`Theme PATCH failed: ${res.status()} ${await res.text()}`)
}

/** Boot the app on the sign-in page (no team, no session) and sign in through the real form. */
async function signInFromLogin(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  const email = page.locator('input[type="email"]')
  await email.waitFor({ state: 'visible', timeout: 120_000 })
  await email.fill(config.testUser.email)
  await page.locator('input[type="password"]').first().fill(config.testUser.password)
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).first().click()
  await expect.poll(() => isAuthenticated(page, base), { timeout: 15_000 }).toBe(true)
  await page.waitForLoadState('networkidle').catch(() => {})
}

/** Navigate through the in-app router (no reload). */
async function routerPush(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    return app.config.globalProperties.$router.push(to)
  }, path)
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 15_000 })
}

test.describe(`fixture "${FIXTURE}" team theme`, () => {
  test('look-and-feel loads after signing in, without a reload', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug = await prepareTeam(browser, base)

    const context = await browser.newContext({ storageState: EMPTY_STATE })
    const page = await context.newPage()
    try {
      await signInFromLogin(page, base)
      await routerPush(page, `/admin/${slug}/team/look-and-feel`)
      await expect(page.getByTestId('team-theme-controls')).toBeVisible({ timeout: 15_000 })
    }
    finally {
      await context.close()
    }
  })

  // covers: T5
  test('T5: the team theme applies right after signing in, without a reload (#4563)', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug = await prepareTeam(browser, base, { preset: 'editorial' })

    const context = await browser.newContext({ storageState: EMPTY_STATE })
    const page = await context.newPage()
    try {
      await signInFromLogin(page, base)
      await routerPush(page, `/admin/${slug}`)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? null), { timeout: 15_000 })
        .toBe('editorial')
    }
    finally {
      await patchTheme(page, base, { preset: 'custom' }).catch(() => {})
      await context.close()
    }
  })
})
