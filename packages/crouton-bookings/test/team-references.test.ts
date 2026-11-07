import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// Route wiring for #3378: hand-owned POST/PATCH handlers must reject references to
// another team's records before writing. The queries module is mocked, but its
// assert* functions use the REAL assertRefsInTeam from crouton-core.
const h = vi.hoisted(() => ({ rows: [] as Array<{ id: string }>, select: null as any, create: null as any, update: null as any }))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'member' } }),
}))
vi.mock('../collections/bookings/server/database/queries', async () => {
  const { assertRefsInTeam } = await import('../../crouton-core/server/utils/teamRefs')
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  const t = sqliteTable('x', { id: text('id'), teamId: text('teamId') })
  return {
    createBookingsBooking: (d: any) => h.create(d),
    updateBookingsBooking: (...a: any[]) => h.update(...a),
    assertBookingsBookingReferences: (teamId: string, d: any) =>
      assertRefsInTeam({ select: h.select }, teamId, [{ field: 'location', table: t, value: d.location }]),
  }
})
vi.mock('../server/utils/booking-capacity', async (orig) => ({ ...(await orig() as object), patchBookingGuarded: (...a: any[]) => h.update(...a) }))
vi.mock('../collections/emaillogs/server/database/queries', async () => {
  const { assertRefsInTeam } = await import('../../crouton-core/server/utils/teamRefs')
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  const t = sqliteTable('x', { id: text('id'), teamId: text('teamId') })
  return {
    createBookingsEmaillog: (d: any) => h.create(d),
    updateBookingsEmaillog: (...a: any[]) => h.update(...a),
    assertBookingsEmaillogReferences: (teamId: string, d: any) =>
      assertRefsInTeam({ select: h.select }, teamId, [
        { field: 'bookingId', table: t, value: d.bookingId },
        { field: 'templateId', table: t, value: d.templateId },
      ]),
  }
})

const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer, offerFullDay integer);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`
// Real in-memory DB: the bookings POST writes through the capacity guard, not create()
const makeDb = (withLocation: boolean) => {
  const client = new Database(':memory:')
  client.exec(DDL)
  if (withLocation) client.prepare(`insert into bookings_locations (id,teamId,title,slots,inventoryMode) values ('l1','t1','s',?,0)`).run(JSON.stringify([{ id: 'a' }]))
  return drizzle(client) as any
}
const bookingRows = (db: any) => db.$client.prepare('select * from bookings_bookings').all()

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.useRuntimeConfig = () => ({})
g.useDB = () => ({})
g.getRouterParams = () => ({ bookingId: 'b1', emaillogId: 'l1' })

let body: any
g.readBody = async () => body
g.readValidatedBody = async (_e: any, parse: (b: unknown) => unknown) => parse(body)

const dir = '../collections'
const loadPost = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/index.post.ts`)).default
const loadPatch = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/[bookingId].patch.ts`)).default
const loadLogPost = async () => (await import(`${dir}/emaillogs/server/api/teams/[id]/bookings-emaillogs/index.post.ts`)).default

beforeEach(() => {
  g.useDB = () => ({})
  h.rows = []
  h.select = vi.fn(() => ({ from: () => ({ where: async () => h.rows }) }))
  h.create = vi.fn(async d => d)
  h.update = vi.fn(async () => ({}))
})

describe('bookings routes check references against the team (#3378)', () => {
  it('booking with own team location is created', async () => {
    h.rows = [{ id: 'loc1' }]
    const db = makeDb(true)
    g.useDB = () => db
    body = { location: 'l1', date: '2026-11-10T00:00:00.000Z', slot: ['a'], quantity: 1, status: 'pending' }
    await (await loadPost())({})
    expect(bookingRows(db)).toHaveLength(1)
  })

  it("booking with another team's location → 400, nothing created", async () => {
    body = { location: 'other', date: '2026-11-10T00:00:00.000Z', slot: ['s'], quantity: 1, status: 'pending' }
    const db = makeDb(true)
    g.useDB = () => db
    await expect((await loadPost())({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: location' })
    expect(bookingRows(db)).toHaveLength(0)
  })

  it('PATCH without location skips the check', async () => {
    body = { status: 'x' }
    await (await loadPatch())({})
    expect(h.select).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it("emaillog with another team's bookingId → 400", async () => {
    body = { bookingId: 'other', recipientEmail: 'a@b.c', triggerType: 'x', status: 'sent' }
    await expect((await loadLogPost())({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: bookingId' })
    expect(h.create).not.toHaveBeenCalled()
  })
})
