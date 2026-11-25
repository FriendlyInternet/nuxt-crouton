import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { editBookingBody } from '../app/utils/booking-form'

// #4112 (S10, server) — the booking card's edit sends `quantity`; the REAL
// bookings/[bookingId]/index.patch.ts must store it, re-checked against the
// product's stock (409 when it doesn't fit). Harness copied from booking-product.test.ts.
const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
`

const hoisted = vi.hoisted(() => ({ body: {} as any, params: { bookingId: 'b1' } as any }))
// A plain member who owns the booking (not an admin)
const member = { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' }, membership: { role: 'member' } }
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => member,
  requireTeamAdmin: async () => member,
}))
// Routes check actions via requireCan / can (#4108); a member has none, so owner-only paths apply
vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => {
  const { teamAuthStub } = await import('./stubs/team-auth')
  return teamAuthStub(() => member).module
})
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))

let db: any
const row = (id: string) => db.$client.prepare('select * from bookings_bookings where id = ?').get(id)
const DAY = Date.parse('2026-11-09T23:00:00Z') / 1000
const SLOTS = JSON.stringify([{ id: 'am' }, { id: 'pm' }])
let patch: (e: any) => Promise<any>

beforeEach(async () => {
  const client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  db.$client.prepare(`insert into bookings_locations (id,teamId,title,slots,products) values ('one','t1','one',?,?)`)
    .run(SLOTS, JSON.stringify([{ product: 'p-one', stock: 2 }]))
  db.$client.prepare(`insert into bookings_bookings values ('b1','t1','u1',0,'one',?,'["am"]',null,1,'active',1,1,'u1','u1','p-one')`).run(DAY)
  // A slotless location: its bookings are full-day
  db.$client.prepare(`insert into bookings_locations (id,teamId,title,slots,products) values ('day','t1','day','[]',?)`)
    .run(JSON.stringify([{ product: 'p-day', stock: 2 }]))
  db.$client.prepare(`insert into bookings_bookings values ('b2','t1','u1',0,'day',?,'["all-day"]',null,1,'active',1,1,'u1','u1','p-day')`).run(DAY)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e, { statusCode: e.status }))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('assertRefsInTeam', async () => undefined)
  vi.stubGlobal('useRuntimeConfig', () => ({}))
  vi.stubGlobal('readBody', async () => hoisted.body)
  vi.stubGlobal('getRouterParam', (_e: any, k: string) => hoisted.params[k])
  patch = (await import('../server/api/crouton-bookings/teams/[id]/bookings/[bookingId]/index.patch')).default as any
})
afterEach(() => { db.$client.close(); vi.unstubAllGlobals() })

const send = (body: any) => { hoisted.body = body; return patch({}) }
beforeEach(() => { hoisted.params.bookingId = 'b1' })

describe('saving an edit from the booking card (#4112)', () => {
  // covers: T1
  it('a timed booking: the card\'s body changes quantity 1 → 2', async () => {
    hoisted.params.bookingId = 'b1'
    await expect(send(editBookingBody({ locationId: 'one', slotIds: ['am'], groupId: null, date: '2026-11-10', productId: 'p-one', quantity: 2 })))
      .resolves.toBeTruthy()
    expect(row('b1').quantity).toBe(2)
    expect(row('b1').slot).toBe('["am"]')
  })

  // covers: T1
  it('a full-day booking (no slot ids): the card\'s body changes quantity 1 → 2', async () => {
    hoisted.params.bookingId = 'b2'
    await expect(send(editBookingBody({ locationId: 'day', slotIds: [], groupId: null, date: '2026-11-10', productId: 'p-day', quantity: 2 })))
      .resolves.toBeTruthy()
    expect(row('b2').quantity).toBe(2)
    expect(row('b2').slot).toBe('["all-day"]')
  })
})

describe('PATCH a booking\'s quantity (#4112)', () => {
  // covers: T2
  it('quantity 2 at a stock-2 product is stored; quantity 3 → 409 and stays 2', async () => {
    await send({ quantity: 2 })
    expect(row('b1').quantity).toBe(2)

    await expect(send({ quantity: 3 })).rejects.toMatchObject({ status: 409 })
    expect(row('b1').quantity).toBe(2)
  })

  // covers: T2
  it('quantity 0 or a fraction → 400, row unchanged', async () => {
    await expect(send({ quantity: 0 })).rejects.toMatchObject({ status: 400 })
    await expect(send({ quantity: 1.5 })).rejects.toMatchObject({ status: 400 })
    expect(row('b1').quantity).toBe(1)
  })
})
