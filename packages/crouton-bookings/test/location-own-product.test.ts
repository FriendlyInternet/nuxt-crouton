import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #4044 — the REAL location POST/PATCH handlers and the REAL createBookingsLocation /
// updateBookingsLocation, over an in-memory SQLite with every column of both tables.
// Only auth and the Nitro globals are stand-ins. `assertRefsInTeam` is stubbed: the
// own-team product check itself is covered in team-reference-checks.test.ts.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  requireTeamAdmin: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } }),
}))

const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, products text, openDays text, slotSchedule text, blockedDates text, offerFullDay integer, inventoryMode integer, quantity integer, maxBookingsPerMonth integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
CREATE TABLE catalog_products (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, description text, active integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
INSERT INTO catalog_products VALUES ('prod-t1','t1','u1',0,'Court',null,1,null,1,1,'u1','u1');
`

let db: any
let body: any
let params: Record<string, string> = {}
const L = '../collections/locations/server/api/teams/[id]/bookings-locations'
const run = async (p: string) => (await import(p)).default({})
const locRow = (id: string) => db.$client.prepare('select * from bookings_locations where id = ?').get(id)
const products = () => db.$client.prepare('select * from catalog_products order by id').all()

beforeEach(() => {
  const client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('assertRefsInTeam', async () => undefined)
  vi.stubGlobal('getRouterParams', () => params)
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(body))
})
afterEach(() => { db.$client.close(); vi.unstubAllGlobals() })

describe('a location saved without products gets its own product (#4044)', () => {
  // covers: T2
  it('L1 POST without products stores [{ product: loc-<id>, stock }] and creates that catalog product in the same team', async () => {
    body = { title: 'Kayak Rental', inventoryMode: true, quantity: 6, translations: { nl: { title: 'Kajakverhuur' } } }
    const res = await run(`${L}/index.post`)
    const stored = locRow(res.id)
    expect(JSON.parse(stored.products)).toEqual([{ product: `loc-${res.id}`, stock: 6 }])
    expect(res.products).toEqual([{ product: `loc-${res.id}`, stock: 6 }])
    const own = products().find((p: any) => p.id === `loc-${res.id}`)
    expect(own).toMatchObject({ teamId: 't1', title: 'Kayak Rental', createdBy: 'u1', updatedBy: 'u1' })
    expect(JSON.parse(own.translations)).toEqual({ nl: { title: 'Kajakverhuur' }, en: { title: 'Kayak Rental' } })
  })

  // covers: T2
  it('L2 (guard) POST with an own-team product keeps its list and creates no loc- product', async () => {
    body = { title: 'Hall', products: [{ product: 'prod-t1', stock: 3 }] }
    const res = await run(`${L}/index.post`)
    expect(JSON.parse(locRow(res.id).products)).toEqual([{ product: 'prod-t1', stock: 3 }])
    expect(products().map((p: any) => p.id)).toEqual(['prod-t1'])
  })

  // covers: T2
  it('L3 PATCH sending products: null gets the own product back', async () => {
    body = { title: 'Court', slots: [{ id: 'a', label: 'A', capacity: 3 }], products: [{ product: 'prod-t1', stock: 1 }] }
    const created = await run(`${L}/index.post`)
    params = { locationId: created.id }
    body = { products: null }
    const res = await run(`${L}/[locationId].patch`)
    expect(JSON.parse(locRow(created.id).products)).toEqual([{ product: `loc-${created.id}`, stock: 3 }])
    expect(res.products).toEqual([{ product: `loc-${created.id}`, stock: 3 }])
    expect(products().some((p: any) => p.id === `loc-${created.id}` && p.teamId === 't1')).toBe(true)
  })
})
