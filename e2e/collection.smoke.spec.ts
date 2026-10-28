/**
 * Generic collection smoke — the core "does a crouton app still work" check.
 *
 * Fixture-agnostic: it reads the active fixture's e2e.manifest.json (set via
 * E2E_FIXTURE, default "minimal") and runs the same list + full-CRUD checks for
 * every collection the fixture declares. Adding a new fixture means adding a
 * manifest, not test code.
 *
 * Covers the whole lifecycle: list loads, then create → edit → delete a row, plus
 * (when the manifest names a `requiredField`) an invalid-submit check proving
 * crouton-core form validation still blocks bad data.
 *
 * Uses the saved auth state (see auth.setup.ts).
 */
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, collectionUrl, ensureAuthed, fixtureManifest, fillField, TEAM_FILE, FIXTURE } from './helpers'

const manifest = fixtureManifest()

test.describe(`fixture "${FIXTURE}"`, () => {
  let slug: string
  test.beforeAll(() => {
    slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug
  })

  for (const collection of manifest.collections) {
    test.describe(collection.key, () => {
      // Navigate to the list and wait out the cold route compile on first hit.
      async function gotoList(page: import('@playwright/test').Page, base: string) {
        // The reused storageState session may have been invalidated by the auth
        // smoke specs; re-establish it before hitting a protected route.
        await ensureAuthed(page, base)
        await page.goto(collectionUrl(base, slug, collection.key), { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => {})
      }

      // Open the create form (slideover/modal/dialog all expose role=dialog) and
      // wait for its first text input to render.
      async function openCreateForm(page: import('@playwright/test').Page) {
        await expect(page.getByRole('button', { name: /create|add|new/i }).first())
          .toBeVisible({ timeout: 180000 })
        await page.getByRole('button', { name: /create|add|new/i }).first().click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible({ timeout: 60000 })
        await dialog.getByRole('textbox').first().waitFor({ state: 'visible', timeout: 60000 })
        return dialog
      }

      test('list page loads', async ({ page, baseURL }) => {
        const base = baseURL || 'http://localhost:3000'
        await gotoList(page, base)

        // Generous timeout: the dev server compiles the route on first hit.
        await expect(page.getByRole('heading', { name: new RegExp(collection.heading, 'i') }))
          .toBeVisible({ timeout: 180000 })
        await expect(page.getByRole('table')).toBeVisible()
      })

      // Only collections that declare a `create` payload get the CRUD cycle.
      const create = collection.create
      if (create && Object.keys(create).length) {
        test('create, edit, then delete a row', async ({ page, baseURL }) => {
          const base = baseURL || 'http://localhost:3000'
          const stamp = Date.now()
          // Stamp the first text field so the row is uniquely findable.
          const createFields = Object.fromEntries(
            Object.entries(create).map(([k, v], i) => [k, i === 0 ? `${v} ${stamp}` : v])
          )
          const firstField = Object.keys(createFields)[0]
          const marker = String(Object.values(createFields)[0])
          const editedMarker = `${marker} edited`
          // Edit values: explicit manifest `update`, else the first field + " edited".
          const editFields = collection.update ?? { [firstField]: editedMarker }

          await gotoList(page, base)

          // --- CREATE ---
          const createDialog = await openCreateForm(page)
          for (const [field, value] of Object.entries(createFields)) {
            await fillField(createDialog, field, value)
          }
          await createDialog.getByRole('button', { name: /create|save|add/i }).first().click()
          await expect(page.getByRole('cell', { name: marker })).toBeVisible({ timeout: 60000 })

          // --- EDIT --- open the row's pencil (the LAST button in the row's ACTIONS
          // cell — the [delete, update] pair). Scope to that cell (the one holding the
          // delete button, reliably the row's first button — the select checkbox is
          // role=checkbox, not button) rather than the whole row, so extra buttons in
          // other cells (e.g. the crouton-maps preview button in the coordinates
          // column) don't make `.last()` grab the wrong control (#624). Then change the
          // field, save, and assert the new value replaced the old one in the list.
          const row = page.getByRole('row', { name: new RegExp(marker) })
          const rowActionsCell = row.getByRole('button').first().locator('xpath=ancestor::td[1]')
          await rowActionsCell.getByRole('button').last().click()
          const editDialog = page.getByRole('dialog')
          await expect(editDialog).toBeVisible({ timeout: 60000 })
          await editDialog.getByRole('textbox').first().waitFor({ state: 'visible', timeout: 60000 })
          for (const [field, value] of Object.entries(editFields)) {
            await fillField(editDialog, field, value)
          }
          await editDialog.getByRole('button', { name: /update|save|create/i }).first().click()
          await expect(page.getByRole('cell', { name: editedMarker })).toBeVisible({ timeout: 60000 })
          await expect(page.getByRole('cell', { name: marker, exact: true })).toHaveCount(0, { timeout: 20000 })

          // --- DELETE --- the row's trash (first button) opens a confirm dialog.
          const editedRow = page.getByRole('row', { name: new RegExp(editedMarker) })
          await editedRow.getByRole('button').first().click()
          const deleteDialog = page.getByRole('dialog')
          await expect(deleteDialog).toBeVisible({ timeout: 20000 })
          await deleteDialog.getByRole('button', { name: /delete|confirm|yes|remove/i }).first().click()
          await expect(page.getByRole('cell', { name: editedMarker })).toHaveCount(0, { timeout: 20000 })
        })

        // Validation check — only when the manifest names a required field.
        const requiredField = collection.requiredField
        if (requiredField) {
          test('rejects an invalid submit (required field empty)', async ({ page, baseURL }) => {
            const base = baseURL || 'http://localhost:3000'
            await gotoList(page, base)

            const dialog = await openCreateForm(page)
            // Clear the required field and try to submit.
            await fillField(dialog, requiredField, '')
            await dialog.getByRole('button', { name: /create|save|add/i }).first().click()

            // crouton-core's UForm blocks the submit: a field error renders
            // (Nuxt UI puts it in an element whose id ends in "-error") and the
            // form stays open instead of closing on a successful create.
            await expect(dialog.locator('[id$="-error"]').first()).toBeVisible({ timeout: 20000 })
            await expect(dialog).toBeVisible()
          })
        }
      }
    })
  }
})
