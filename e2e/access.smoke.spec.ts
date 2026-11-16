/**
 * Generated-endpoint access smoke (#3148) — proves the per-collection `access`
 * declaration in crouton.config is enforced by the generated handlers on a real
 * app, not just that the generator wrote the guard text. Runs only on fixtures
 * whose manifest has an `access` block (minimal); the others skip.
 *
 *   admindocs   access: { create: 'admin', reorder: 'admin' }  (hierarchy → move too)
 *   membernotes access: { create: 'member', list: 'own' }
 */
import { expect } from '@playwright/test'
import { test, ensureAuthed, fixtureManifest, activeTeamId } from './helpers'
import { addMember, type TeamMember } from './members'

const access = fixtureManifest().access

test.describe.configure({ mode: 'serial' })

test.describe('generated endpoint access', () => {
  test.skip(!access, 'fixture declares no access check')

  let base: string
  let teamId: string
  let a: TeamMember
  let b: TeamMember

  test('setup: two plain members join the team', async ({ page, baseURL }) => {
    base = baseURL || 'http://localhost:3000'
    await ensureAuthed(page, base)
    teamId = (await activeTeamId(page, base))!
    expect(teamId, 'active team id').toBeTruthy()
    a = await addMember(page, base, teamId, 'a')
    b = await addMember(page, base, teamId, 'b')
  })

  test('a member cannot create, reorder or move admindocs; the admin can', async ({ page }) => {
    await ensureAuthed(page, base)
    const docs = `${base}/api/teams/${teamId}/${access!.admindocs.apiPath}`

    expect((await a.ctx.post(docs, { data: { title: 'nope' } })).status()).toBe(403)
    expect((await a.ctx.patch(`${docs}/reorder`, { data: { updates: [] } })).status()).toBe(403)
    expect((await a.ctx.patch(`${docs}/some-id/move`, { data: { order: 0 } })).status()).toBe(403)

    const created = await page.request.post(docs, { data: { title: 'admin doc' } })
    expect(created.status()).toBe(200)
    const doc = await created.json()
    const reorder = await page.request.patch(`${docs}/reorder`, { data: { updates: [{ id: doc.id, order: 1 }] } })
    expect(reorder.status()).toBe(200)
    const move = await page.request.patch(`${docs}/${doc.id}/move`, { data: { order: 2, parentId: null } })
    expect(move.status()).toBe(200)
  })

  test('list: own — each member sees only their own membernotes; the admin sees both', async ({ page }) => {
    await ensureAuthed(page, base)
    const notes = `${base}/api/teams/${teamId}/${access!.membernotes.apiPath}`

    const noteA = await (await a.ctx.post(notes, { data: { title: 'note of A' } })).json()
    const noteB = await (await b.ctx.post(notes, { data: { title: 'note of B' } })).json()
    expect(noteA.id).toBeTruthy()
    expect(noteB.id).toBeTruthy()

    const listA = await (await a.ctx.get(notes)).json() as { id: string }[]
    expect(listA.map(n => n.id)).toContain(noteA.id)
    expect(listA.map(n => n.id)).not.toContain(noteB.id)

    // The ?ids= read path must be scoped too
    const byId = await (await a.ctx.get(`${notes}?ids=${noteB.id}`)).json() as unknown[]
    expect(byId).toHaveLength(0)

    const listAdmin = await (await page.request.get(notes)).json() as { id: string }[]
    expect(listAdmin.map(n => n.id)).toEqual(expect.arrayContaining([noteA.id, noteB.id]))
  })

  test.afterAll(async () => {
    await a?.ctx.dispose()
    await b?.ctx.dispose()
  })
})
