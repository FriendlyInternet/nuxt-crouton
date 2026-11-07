import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #3424: run the REAL assert…References checks (and the hand-written bookings PATCH route)
// against a real in-memory SQLite database. Only the app's `user` table and the Nitro
// globals are stand-ins. Point a check at the wrong field and these fail.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
const h = vi.hoisted(() => ({ patch: null as any }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'member' } }),
}))
vi.mock('../server/utils/booking-capacity', async orig => ({ ...(await orig() as object), patchBookingGuarded: (...a: any[]) => h.patch(...a) }))

// Only the columns the checks read (id, teamId); drizzle selects nothing else.
const DDL = ['bookings_locations', 'bookings_bookings', 'bookings_emailtemplates']
  .map(t => `CREATE TABLE ${t} (id text primary key, teamId text not null);`).join('\n')

const client = new Database(':memory:')
client.exec(DDL)
client.exec(`
INSERT INTO bookings_locations VALUES ('loc-t1','t1'), ('loc-t2','t2');
INSERT INTO bookings_bookings VALUES ('bk-t1','t1'), ('bk-t2','t2');
INSERT INTO bookings_emailtemplates VALUES ('tpl-t1','t1'), ('tpl-t2','t2');
`)
const db = drizzle(client) as any

const g = globalThis as any
g.useDB = () => db
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.useRuntimeConfig = () => ({})
g.getRouterParam = () => 'bk-t1'
let body: any
g.readBody = async () => body

beforeAll(async () => {
  g.assertRefsInTeam = (await import('../../crouton-core/server/utils/teamRefs')).assertRefsInTeam
})
beforeEach(() => {
  h.patch = vi.fn(async () => ({ id: 'bk-t1' }))
})

const bad = (field: string) => ({ status: 400, statusText: `Invalid reference: ${field}` })

describe('real assert…References checks (#3424)', () => {
  it('booking: own location passes, other team / unknown location → 400, empty skipped', async () => {
    const { assertBookingsBookingReferences: check } = await import('../collections/bookings/server/database/queries')
    await expect(check('t1', { location: 'loc-t1' })).resolves.toBeUndefined()
    await expect(check('t1', { location: 'loc-t2' })).rejects.toMatchObject(bad('location'))
    await expect(check('t1', { location: 'nope' })).rejects.toMatchObject(bad('location'))
    await expect(check('t1', {})).resolves.toBeUndefined()
    await expect(check('t1', { location: null })).resolves.toBeUndefined()
  })

  it('booking: a wrong field name does not satisfy the check (mutation guard)', async () => {
    const { assertBookingsBookingReferences: check } = await import('../collections/bookings/server/database/queries')
    // `locationId` is not what the check reads, so an other-team id under it must NOT be what is validated
    await expect(check('t1', { location: 'loc-t2', locationId: 'loc-t1' })).rejects.toMatchObject(bad('location'))
  })

  it('emaillog: bookingId and templateId are each checked against their own table', async () => {
    const { assertBookingsEmaillogReferences: check } = await import('../collections/emaillogs/server/database/queries')
    await expect(check('t1', { bookingId: 'bk-t1', templateId: 'tpl-t1' })).resolves.toBeUndefined()
    await expect(check('t1', { bookingId: 'bk-t2', templateId: 'tpl-t1' })).rejects.toMatchObject(bad('bookingId'))
    await expect(check('t1', { bookingId: 'bk-t1', templateId: 'tpl-t2' })).rejects.toMatchObject(bad('templateId'))
    // a booking id is not a template id
    await expect(check('t1', { templateId: 'bk-t1' })).rejects.toMatchObject(bad('templateId'))
  })

  it('emailtemplate: locationId must be an own-team location', async () => {
    const { assertBookingsEmailtemplateReferences: check } = await import('../collections/emailtemplates/server/database/queries')
    await expect(check('t1', { locationId: 'loc-t1' })).resolves.toBeUndefined()
    await expect(check('t1', { locationId: 'loc-t2' })).rejects.toMatchObject(bad('locationId'))
    await expect(check('t1', {})).resolves.toBeUndefined()
  })
})

describe('hand-written bookings PATCH route (#3424)', () => {
  const load = async () => (await import('../server/api/crouton-bookings/teams/[id]/bookings/[bookingId]/index.patch')).default

  it("other team's location → 400, nothing updated", async () => {
    body = { location: 'loc-t2' }
    await expect((await load())({})).rejects.toMatchObject(bad('location'))
    expect(h.patch).not.toHaveBeenCalled()
  })

  it('own team location → updated', async () => {
    body = { location: 'loc-t1' }
    await (await load())({})
    expect(h.patch).toHaveBeenCalledTimes(1)
    expect(h.patch.mock.calls[0][1]).toMatchObject({ teamId: 't1', bookingId: 'bk-t1', patch: { location: 'loc-t1' } })
  })

  it('no location in the body → check skipped, updated', async () => {
    body = { status: 'confirmed' }
    await (await load())({})
    expect(h.patch).toHaveBeenCalledTimes(1)
  })
})
