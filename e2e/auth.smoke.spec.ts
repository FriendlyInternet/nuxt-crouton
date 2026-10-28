/**
 * Auth smoke — proves crouton-auth itself still works, not just that a saved
 * session lets us in.
 *
 * The rest of the suite uses auth only as *setup* (log in once, reuse the saved
 * storageState), so a regression in logout, the logged-out guard, or team
 * switching would never fail those specs. This file exercises the auth feature
 * directly: log out, log back in through the real modal, confirm an anonymous
 * visitor can't reach a protected route, and switch the active team.
 *
 * Isolation: every test here runs in its **own** browser context with its own
 * session, never the shared storageState. That's essential — better-auth's
 * sign-out destroys the *current* session, so logging out of the shared session
 * would invalidate the token every other spec reuses. Logging in here (same test
 * user) mints a separate session, so signing it out / switching its team leaves
 * the setup session untouched.
 *
 * Fixture-agnostic — the auth flow is the same across fixtures; it reads the
 * active fixture's first collection only to have a real protected route to hit.
 */
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  test,
  loginOrRegister, ensureTeam, isAuthenticated, signOut,
  activeTeamId, createTeam, setActiveTeam, collectionUrl,
  fixtureManifest, TEAM_FILE, FIXTURE
} from './helpers'

const firstCollection = fixtureManifest().collections[0]

test.describe(`fixture "${FIXTURE}" auth`, () => {
  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  test('logout clears the session, then re-login via the modal restores it', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    // Own context + own fresh session — signing out here must not touch the
    // shared storageState session the other specs depend on.
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await loginOrRegister(page, base)
      expect(await isAuthenticated(page, base)).toBe(true)

      await signOut(page, base)
      expect(await isAuthenticated(page, base)).toBe(false)

      // Re-login through the real auth modal — the flow a returning user hits.
      await loginOrRegister(page, base)
      expect(await isAuthenticated(page, base)).toBe(true)
    } finally {
      await context.close()
    }
  })

  test('a logged-out visitor cannot reach a protected admin route', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    // Fresh context with NO saved session — a genuine anonymous visitor.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    try {
      expect(await isAuthenticated(page, base)).toBe(false)

      await page.goto(collectionUrl(base, slug, firstCollection.key), { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})

      // The security-relevant invariant: the protected collection content is
      // never shown to an anonymous visitor (crouton-auth bounces them to the
      // login modal), and no session is silently established.
      await expect(page.getByRole('table')).toHaveCount(0, { timeout: 180000 })
      await expect(page.getByRole('heading', { name: new RegExp(firstCollection.heading, 'i') }))
        .toHaveCount(0)
      expect(await isAuthenticated(page, base)).toBe(false)
    } finally {
      await context.close()
    }
  })

  test('create a second team and switch the active team', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    // Own context + session: switching the active team mutates session state, so
    // do it on a throwaway session, not the shared one.
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await loginOrRegister(page, base)
      await ensureTeam(page, base)
      const firstTeamId = await activeTeamId(page, base)
      expect(firstTeamId).toBeTruthy()

      // Create a distinct second team and make it active.
      const second = await createTeam(page, base, 'E2E Team Two', `e2e-team-two-${Date.now()}`)
      await setActiveTeam(page, base, second.id)

      const switched = await activeTeamId(page, base)
      expect(switched).toBe(second.id)
      expect(switched).not.toBe(firstTeamId)
    } finally {
      await context.close()
    }
  })
})
