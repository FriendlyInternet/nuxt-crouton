/**
 * Card-renders smoke (#2824) — with component auto-registration no longer global,
 * `<CroutonCollection>` finds `<Pascal>Card` through the build-time map. If that
 * resolution breaks the row silently falls back to the default card (or renders
 * nothing), so assert text only the fixture's own card prints.
 *
 * Manifest-driven (`cardRenders`); fixtures without it skip. Uses the saved auth state.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { collectionUrl, ensureAuthed, fixtureManifest, TEAM_FILE, FIXTURE } from './helpers'

const { cardRenders: card } = fixtureManifest()

test.describe(`fixture "${FIXTURE}" card`, () => {
  test.skip(!card, 'fixture declares no cardRenders check')

  test('the collection card renders in the list layout', async ({ page, baseURL }) => {
    test.setTimeout(240000)
    const base = baseURL || 'http://localhost:3000'
    const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
    const stamp = Date.now()

    await ensureAuthed(page, base)
    // Seed into the team the page lists (by slug), not whichever team is active.
    const orgsRes = await page.request.get(`${base}/api/auth/organization/list`, { headers: { Origin: base, Referer: `${base}/` } })
    const orgs = orgsRes.ok() ? await orgsRes.json().catch(() => []) : []
    const teamId = (Array.isArray(orgs) ? orgs : []).find((o: any) => o.slug === slug)?.id
    expect(teamId, `team id for slug ${slug}`).toBeTruthy()

    const [firstKey, firstValue] = Object.entries(card!.create)[0]!
    const name = `${firstValue} ${stamp}`
    const res = await page.request.post(`${base}/api/teams/${teamId}/${card!.apiPath}`, {
      headers: { Origin: base, Referer: `${base}/` },
      data: { ...card!.create, [firstKey]: name }
    })
    expect(res.ok(), `seed row failed: ${res.status()} ${await res.text()}`).toBeTruthy()

    await page.goto(collectionUrl(base, slug, card!.collectionKey), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Switch to the List layout — the switcher buttons are labelled by layout name.
    const listButton = page.getByRole('button', { name: 'List', exact: true }).first()
    await expect(async () => {
      await listButton.click()
      await expect(listButton).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 })
    }).toPass({ timeout: 180000 })

    await expect(page.getByText(`${card!.marker} · ${name}`)).toBeVisible({ timeout: 60000 })
  })
})
