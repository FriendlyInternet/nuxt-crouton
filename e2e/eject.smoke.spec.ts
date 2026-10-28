/**
 * Ejected form wins — an app overrides a package's form just by adding a component
 * with the canonical name (`<Layer><Plural>Form`). Driven by the fixture manifest's
 * `ejectedForm` block (omit it and this file registers no tests).
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { collectionUrl, ensureAuthed, fixtureManifest, TEAM_FILE, FIXTURE } from './helpers'

const { ejectedForm: eject, ejectedList } = fixtureManifest()

test.describe(`fixture "${FIXTURE}" ejected form`, () => {
  test.skip(!eject, 'fixture declares no ejectedForm check')

  test('ejected form wins', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug

    await ensureAuthed(page, base)
    await page.goto(collectionUrl(base, slug, eject!.collectionKey), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    const create = page.getByRole('button', { name: /create|add|new/i }).first()
    await expect(create).toBeVisible({ timeout: 180000 })
    await create.click()

    await expect(page.getByRole('dialog').getByText(eject!.marker)).toBeVisible({ timeout: 60000 })
  })
})

test.describe(`fixture "${FIXTURE}" ejected list`, () => {
  test.skip(!ejectedList, 'fixture declares no ejectedList check')

  test('ejected list wins', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3000'
    const slug = JSON.parse(readFileSync(TEAM_FILE, 'utf8')).slug

    await ensureAuthed(page, base)
    await page.goto(collectionUrl(base, slug, ejectedList!.collectionKey), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    await expect(page.getByText(ejectedList!.marker)).toBeVisible({ timeout: 180000 })
  })
})
