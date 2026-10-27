/**
 * Two-client live-sync smoke — proves crouton-collab actually syncs, not just that
 * it mounts. Driven by the fixture manifest's `collab` block (omit it and this
 * file registers no tests).
 *
 * Two browser contexts share the saved auth + team and open the same collection
 * list over the local crossws socket:
 *   (a) both clients hold an open socket to the team sync room
 *       (/api/collab/team:<id>:sync/ws). The sync room is a version-signal channel
 *       only — it never announces awareness — so its /users endpoint is always empty
 *       and can't prove membership; we watch the sockets themselves instead;
 *   (b) a save by client B refreshes client A's list without a reload
 *       (crouton:mutation -> Yjs version bump -> crouton:remoteChange -> refetch).
 *
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { collectionUrl, ensureAuthed, fixtureManifest, fillField, AUTH_FILE, TEAM_FILE, FIXTURE } from './helpers'

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
      const syncSockets = new Map<typeof a, boolean>()
      for (const page of [a, b]) {
        page.on('websocket', (ws) => {
          if (/\/api\/collab\/team:[^/]+:sync\/ws/.test(decodeURIComponent(ws.url()))) {
            syncSockets.set(page, true)
            ws.on('close', () => syncSockets.set(page, false))
          }
        })
        await ensureAuthed(page, base)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => {})
        await expect(page.getByRole('button', { name: /create|add|new/i }).first())
          .toBeVisible({ timeout: 180000 })
      }

      // (a) both clients are connected to the team sync room
      await expect.poll(() => [syncSockets.get(a), syncSockets.get(b)], { timeout: 60000 })
        .toEqual([true, true])

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
