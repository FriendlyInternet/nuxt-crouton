/**
 * Two-client live-sync smoke — proves crouton-collab actually syncs, not just that
 * it mounts. Driven by the fixture manifest's `collab` block (omit it and this
 * file registers no tests).
 *
 * Two browser contexts share the saved auth + team and open the same collection
 * list over the local crossws socket:
 *   (a) both clients are connected to the team sync room — the room's users
 *       endpoint (/api/collab/team:<id>:sync/users) lists a participant;
 *   (b) a save by client B refreshes client A's list without a reload
 *       (crouton:mutation -> Yjs version bump -> crouton:remoteChange -> refetch).
 *
 * Both contexts use the same user, and the room dedupes awareness per user id, so
 * (a) asserts presence (>= 1) rather than a count of 2.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { collectionUrl, activeTeamId, ensureAuthed, fixtureManifest, fillField, AUTH_FILE, TEAM_FILE, FIXTURE } from './helpers'

const collab = fixtureManifest().collab

test.describe(`fixture "${FIXTURE}" collab`, () => {
  test.skip(!collab, 'fixture declares no collab check')

  test('a save by client B refreshes client A and both join the team room', async ({ browser, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug: string = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
    const url = collectionUrl(base, slug, collab!.collectionKey)

    const ctxA = await browser.newContext({ storageState: AUTH_FILE })
    const ctxB = await browser.newContext({ storageState: AUTH_FILE })
    try {
      const a = await ctxA.newPage()
      const b = await ctxB.newPage()
      for (const page of [a, b]) {
        await ensureAuthed(page, base)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => {})
        await expect(page.getByRole('button', { name: /create|add|new/i }).first())
          .toBeVisible({ timeout: 180000 })
      }

      // (a) presence in the team sync room
      const teamId = await activeTeamId(a, base)
      expect(teamId).toBeTruthy()
      const roomId = encodeURIComponent(`team:${teamId}:sync`)
      await expect.poll(async () => {
        const res = await a.request.get(`${base}/api/collab/${roomId}/users`, {
          params: { type: 'sync', teamId: teamId! }
        })
        return res.ok() ? (await res.json()).count : -1
      }, { timeout: 60000 }).toBeGreaterThanOrEqual(1)

      // (b) B saves -> A's list refreshes without a reload
      const name = `collab-sync-${Date.now()}`
      await b.getByRole('button', { name: /create|add|new/i }).first().click()
      const dialog = b.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 60000 })
      await dialog.getByRole('textbox').first().waitFor({ state: 'visible', timeout: 60000 })
      await fillField(dialog, collab!.field, name)
      await dialog.getByRole('button', { name: /create|save|add/i }).first().click()

      await expect(a.getByText(name).first()).toBeVisible({ timeout: 60000 })
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })
})
