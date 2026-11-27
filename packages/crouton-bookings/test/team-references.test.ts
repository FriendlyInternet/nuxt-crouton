import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// Route wiring for #3378/#3424: hand-owned POST/PATCH handlers must reject references to
// another team's records before writing. The queries modules are REAL (partial mocks): only the
// create/update writes are stubbed; the assert…References checks run against a real in-memory DB.
const h = vi.hoisted(() => ({ create: null as any, update: null as any, createLoc: null as any, updateLoc: null as any }))

vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'member' } }),
}))
// Guarded routes (requireCan, #4108) run as an admin; a member's can() is false (the no-config default)
vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => {
  const { roleCan } = await import('./stubs/team-auth')
  return {
    can: async (_t: string, _u: string, action: string) => roleCan('member', action),
    requireCan: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } }),
  }
})
vi.mock('../collections/bookings/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  createBookingsBooking: (d: any) => h.create(d),
  updateBookingsBooking: (...a: any[]) => h.update(...a),
}))
vi.mock('../collections/locations/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  createBookingsLocation: (d: any) => h.createLoc(d),
  updateBookingsLocation: (...a: any[]) => h.updateLoc(...a),
}))
// create/update are stubbed here, so there is no stored row; the own-product path runs for real in location-own-product.test.ts (#4044)
vi.mock('../server/utils/location-products', () => ({ ensureLocationProducts: async () => undefined }))
vi.mock('../server/utils/booking-capacity', async (orig) => ({ ...(await orig() as object), patchBookingGuarded: (...a: any[]) => h.update(...a) }))
vi.mock('../collections/emaillogs/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  createBookingsEmaillog: (d: any) => h.create(d),
  updateBookingsEmaillog: (...a: any[]) => h.update(...a),
}))

const DDL = `
CREATE TABLE bookings_emailtemplates (id text primary key, teamId text not null);
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
CREATE TABLE catalog_products (id text primary key, teamId text not null);
INSERT INTO catalog_products VALUES ('prod-t1','t1'), ('prod-t2','t2');
`
// Real in-memory DB: the bookings POST writes through the capacity guard, not create()
const makeDb = (withLocation: boolean) => {
  const client = new Database(':memory:')
  client.exec(DDL)
  if (withLocation) client.prepare(`insert into bookings_locations (id,teamId,title,slots,products) values ('l1','t1','s',?,?)`).run(JSON.stringify([{ id: 'a' }]), JSON.stringify([{ product: 'prod-t1', stock: 1 }]))
  client.exec(`insert into bookings_bookings (id,teamId,owner,"order",location,date,slot,quantity,status,createdAt,updatedAt,createdBy,updatedBy) values ('b-other','t2','u',0,'l1',0,'a',1,'x',0,0,'u','u')`)
  return drizzle(client) as any
}
const bookingRows = (db: any) => db.$client.prepare('select * from bookings_bookings where teamId = \'t1\'').all()

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.useRuntimeConfig = () => ({})
g.useDB = () => ({})
g.getRouterParams = () => ({ bookingId: 'b1', emaillogId: 'l1', locationId: 'l1' })

let body: any
g.readBody = async () => body
g.readValidatedBody = async (_e: any, parse: (b: unknown) => unknown) => parse(body)

const dir = '../collections'
const loadPost = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/index.post.ts`)).default
const loadPatch = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/[bookingId].patch.ts`)).default
const loadLogPost = async () => (await import(`${dir}/emaillogs/server/api/teams/[id]/bookings-emaillogs/index.post.ts`)).default
const loadLocPost = async () => (await import(`${dir}/locations/server/api/teams/[id]/bookings-locations/index.post.ts`)).default
const loadLocPatch = async () => (await import(`${dir}/locations/server/api/teams/[id]/bookings-locations/[locationId].patch.ts`)).default

beforeAll(async () => {
  g.assertRefsInTeam = (await import('../../crouton-core/server/utils/teamRefs')).assertRefsInTeam
})

beforeEach(() => {
  g.useDB = () => ({})
  h.create = vi.fn(async d => d)
  h.update = vi.fn(async () => ({}))
  h.createLoc = vi.fn(async d => d)
  h.updateLoc = vi.fn(async () => ({}))
})

describe('bookings routes check references against the team (#3378)', () => {
  it('booking with own team location is created', async () => {
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
    g.useDB = () => makeDb(false)
    await (await loadPatch())({})
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it("emaillog with another team's bookingId → 400", async () => {
    const db = makeDb(false)
    g.useDB = () => db
    body = { bookingId: 'b-other', recipientEmail: 'a@b.c', triggerType: 'x', status: 'sent' }
    await expect((await loadLogPost())({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: bookingId' })
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('location routes check listed products against the team (#3967)', () => {
  const refused = { status: 400, statusText: 'Invalid reference: products' }
  const zodPath = async (p: Promise<unknown>) => {
    const err: any = await p.then(() => null, e => e)
    expect(err, 'expected the body to be refused').toBeTruthy()
    return err.issues?.[0]?.path?.[0]
  }

  beforeEach(() => {
    const db = makeDb(true)
    g.useDB = () => db
  })

  // covers: T3
  it("POST with another team's product → 400, nothing created", async () => {
    body = { title: 'Hall', products: [{ product: 'prod-t2', stock: 1 }] }
    await expect((await loadLocPost())({})).rejects.toMatchObject(refused)
    expect(h.createLoc).not.toHaveBeenCalled()
  })

  // covers: T3
  it("PATCH with another team's product → 400, nothing updated", async () => {
    body = { products: [{ product: 'prod-t2', stock: 1 }] }
    await expect((await loadLocPatch())({})).rejects.toMatchObject(refused)
    expect(h.updateLoc).not.toHaveBeenCalled()
  })

  // covers: T3
  it('POST with an own-team product passes the list to create', async () => {
    body = { title: 'Hall', products: [{ product: 'prod-t1', stock: 2 }] }
    await (await loadLocPost())({})
    expect(h.createLoc).toHaveBeenCalledTimes(1)
    expect(h.createLoc.mock.calls[0][0]).toMatchObject({ teamId: 't1', products: [{ product: 'prod-t1', stock: 2 }] })
  })

  // covers: T3
  it('PATCH with an own-team product passes the list to update', async () => {
    body = { products: [{ product: 'prod-t1', stock: 3 }] }
    await (await loadLocPatch())({})
    expect(h.updateLoc).toHaveBeenCalledTimes(1)
    expect(h.updateLoc.mock.calls[0][3]).toMatchObject({ products: [{ product: 'prod-t1', stock: 3 }] })
  })

  // covers: T3
  it('POST with stock 0 is refused by body validation, nothing created', async () => {
    body = { title: 'Hall', products: [{ product: 'prod-t1', stock: 0 }] }
    expect(await zodPath((await loadLocPost())({}))).toBe('products')
    expect(h.createLoc).not.toHaveBeenCalled()
  })

  // covers: T3
  it('POST listing the same product twice is refused by body validation, nothing created', async () => {
    body = { title: 'Hall', products: [{ product: 'prod-t1', stock: 1 }, { product: 'prod-t1', stock: 2 }] }
    expect(await zodPath((await loadLocPost())({}))).toBe('products')
    expect(h.createLoc).not.toHaveBeenCalled()
  })
})
