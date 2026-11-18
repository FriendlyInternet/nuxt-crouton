import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #4112 (S10, server) — the booking card's edit sends `quantity`; the REAL
// bookings/[bookingId]/index.patch.ts must store it, re-checked against the
// product's stock (409 when it doesn't fit). Harness copied from booking-product.test.ts.
const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
`

const hoisted = vi.hoisted(() => ({ body: {} as any, params: { bookingId: 'b1' } as any }))
// A plain member who owns the booking (not an admin)
const member = { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' }, membership: { role: 'member' } }
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => member,
  requireTeamAdmin: async () => member,
}))
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
  db.$client.prepare(`insert into bookings_locations (id,teamId,title,slots,inventoryMode,products) values ('one','t1','one',?,0,?)`)
    .run(SLOTS, JSON.stringify([{ product: 'p-one', stock: 2 }]))
  db.$client.prepare(`insert into bookings_bookings values ('b1','t1','u1',0,'one',?,'["am"]',null,1,'active',1,1,'u1','u1','p-one')`).run(DAY)
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
