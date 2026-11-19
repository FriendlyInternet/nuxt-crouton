import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #4044 — a booking always carries a product of its own location. The REAL write
// routes (generic POST, both PATCH routes, the cart batch) over an in-memory SQLite,
// set up like booking-capacity.test.ts.
const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
`

const hoisted = vi.hoisted(() => ({ body: {} as any, params: { bookingId: 'b1' } as any }))
const member = { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' }, membership: { role: 'admin' } }
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => member,
  requireTeamAdmin: async () => member,
}))
// Reference checks (#3378) are covered in team-references.test.ts; the DB here has no auth/team tables
vi.mock('../collections/bookings/server/database/queries', () => ({ assertBookingsBookingReferences: async () => undefined }))
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
vi.mock('../server/utils/booking-emails', () => ({ isBookingEmailEnabled: () => false, resolveTranslatedField: () => '', resolveSlotLabels: () => '' }))
vi.mock('../server/utils/email-service', () => ({ triggerBookingCreatedEmail: async () => ({ success: true }) }))

let db: any
const rows = () => db.$client.prepare('select * from bookings_bookings order by id').all()
const row = (id: string) => db.$client.prepare('select * from bookings_bookings where id = ?').get(id)
const DAY = Date.parse('2026-11-09T23:00:00Z') / 1000
const SLOTS = JSON.stringify([{ id: 'am' }, { id: 'pm' }])
const loc = (id: string, products: unknown) =>
  db.$client.prepare(`insert into bookings_locations (id,teamId,title,slots,products) values (?,'t1',?,?,?)`).run(id, id, SLOTS, JSON.stringify(products))
const book = (id: string, over: Record<string, unknown> = {}) =>
  db.$client.prepare(`insert into bookings_bookings values (@id,'t1','u1',0,@location,@date,@slot,null,1,@status,1,1,'u1','u1',@product)`)
    .run({ id, location: 'one', date: DAY, slot: '["am"]', status: 'active', product: 'p-one', ...over })

type Handler = (e: any) => Promise<any>
const handlers: Record<string, Handler> = {}

beforeEach(async () => {
  const client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  loc('one', [{ product: 'p-one', stock: 1 }])
  loc('other', [{ product: 'p-other', stock: 1 }])
  loc('two', [{ product: 'p-a', stock: 1 }, { product: 'p-b', stock: 1 }])
  loc('none', [])
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e, { statusCode: e.status }))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('assertRefsInTeam', async () => undefined)
  vi.stubGlobal('useRuntimeConfig', () => ({}))
  vi.stubGlobal('readBody', async () => hoisted.body)
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(hoisted.body))
  vi.stubGlobal('getRouterParams', () => hoisted.params)
  vi.stubGlobal('getRouterParam', (_e: any, k: string) => hoisted.params[k])
  handlers.post = (await import('../collections/bookings/server/api/teams/[id]/bookings-bookings/index.post')).default as any
  handlers.patchA = (await import('../collections/bookings/server/api/teams/[id]/bookings-bookings/[bookingId].patch')).default as any
  handlers.patchB = (await import('../server/api/crouton-bookings/teams/[id]/bookings/[bookingId]/index.patch')).default as any
  handlers.cart = (await import('../server/api/crouton-bookings/teams/[id]/customer-bookings-batch.post')).default as any
})
afterEach(() => { db.$client.close(); vi.unstubAllGlobals() })

const send = (h: string, body: any) => { hoisted.body = body; return handlers[h]!({}) }
const post = (location: string, over: Record<string, unknown> = {}) =>
  send('post', { location, date: '2026-11-10', slot: ['am'], quantity: 1, status: 'active', ...over })

describe('every booking write resolves a product of its location (#4044)', () => {
  // covers: T3
  it('B1 generic POST without product at a one-product location stores that product', async () => {
    const r = await post('one')
    expect(r.product).toBe('p-one')
    expect(rows()).toHaveLength(1)
    expect(rows()[0].product).toBe('p-one')
  })

  // covers: T3
  it('B2 POST naming a product the location does not list → 400, nothing written', async () => {
    await expect(post('one', { product: 'p-other' })).rejects.toMatchObject({ status: 400, statusText: 'Unknown product' })
    expect(rows()).toHaveLength(0)
  })

  // covers: T3
  it('B3 POST without product at a two-product location → 400 "Pick a product", nothing written', async () => {
    await expect(post('two')).rejects.toMatchObject({ status: 400, statusText: 'Pick a product' })
    expect(rows()).toHaveLength(0)
    // naming one of its products is fine
    expect((await post('two', { product: 'p-b' })).product).toBe('p-b')
  })

  // covers: T3
  it('B4 location with products [] → 400, nothing written', async () => {
    await expect(post('none')).rejects.toMatchObject({ status: 400, statusText: 'Nothing to book at this location' })
    expect(rows()).toHaveLength(0)
  })

  // covers: T3
  it('B5 cart batch without productId: every row carries its own location\'s product; a non-string productId → 400, nothing written', async () => {
    const item = (locationId: string, over: Record<string, unknown> = {}) => ({ id: 'c', locationId, locationTitle: locationId, date: '2026-11-10T00:00:00.000Z', slotIds: ['am'], ...over })
    await expect(send('cart', { bookings: [item('one'), item('other', { productId: 42 })] })).rejects.toMatchObject({ status: 400 })
    expect(rows()).toHaveLength(0)
    const res = await send('cart', { bookings: [item('one'), item('other')] })
    expect(res.count).toBe(2)
    expect(rows().map((r: any) => [r.location, r.product]).sort()).toEqual([['one', 'p-one'], ['other', 'p-other']])
  })

  for (const h of ['patchA', 'patchB'] as const) {
    describe(h, () => {
      // covers: T3
      it('B6 moving a booking to another one-product location without a product takes the new location\'s product', async () => {
        book('b1')
        const r = await send(h, { location: 'other' })
        expect(r.location).toBe('other')
        expect(row('b1').product).toBe('p-other')
      })

      // covers: T3
      it('B7 PATCH of a cancelled booking sending a product the location does not list → 400, row unchanged', async () => {
        book('b1', { status: 'cancelled' })
        const before = row('b1')
        await expect(send(h, { product: 'p-other' })).rejects.toMatchObject({ status: 400, statusText: 'Unknown product' })
        expect(row('b1')).toEqual(before)
      })

      // covers: T3
      it('B8 moving a cancelled booking to another one-product location takes the new location\'s product', async () => {
        book('b1', { status: 'cancelled' })
        await send(h, { location: 'other' })
        expect(row('b1')).toMatchObject({ location: 'other', product: 'p-other', status: 'cancelled' })
      })
    })
  }
})
