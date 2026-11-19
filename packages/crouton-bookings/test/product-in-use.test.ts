import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #4278 — a catalog product a location of the team still lists may not be
// deleted. Runs the REAL productBlockers query over an in-memory SQLite (its
// json_each / json_valid are SQLite's, as on D1) and the REAL plugin wiring;
// only the Nitro globals are stand-ins.
const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, products text, openDays text, slotSchedule text, blockedDates text, offerFullDay integer, maxBookingsPerMonth integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, location text, product text, date integer, quantity integer, slot text, status text);
`

let client: Database.Database
let db: any
const loc = (id: string, teamId: string, order: number, title: string, products: string | null, translations: string | null = null) =>
  client.prepare(`INSERT INTO bookings_locations (id, teamId, owner, "order", title, products, translations, createdAt, updatedAt, createdBy, updatedBy) VALUES (?,?,?,?,?,?,?,1,1,'u1','u1')`)
    .run(id, teamId, 'u1', order, title, products, translations)
const offers = (product: string, stock = 1) => JSON.stringify([{ product, stock }])

const load = async () => (await import('../server/utils/product-in-use')).productBlockers

beforeEach(() => {
  client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({ croutonI18n: { defaultLocale: 'nl', supportedLocales: ['nl', 'en'] } }))
})
afterEach(() => { client.close(); vi.unstubAllGlobals() })

describe('productBlockers — only the team\'s locations that list the product block it (#4278)', () => {
  // covers: T2
  it('G2 names exactly the own-team locations listing it (default-language title), ignores junk products', async () => {
    loc('A', 't1', 0, 'Kayak Rental', JSON.stringify([{ product: 'other', stock: 1 }, { product: 'prod-x', stock: 2 }]), JSON.stringify({ nl: { title: 'Kajakverhuur' } }))
    loc('B', 't1', 1, 'Bike Shed', offers('prod-x'))
    loc('C', 't1', 2, 'Court', offers('prod-y'))
    loc('T2', 't2', 0, 'Other team', offers('prod-x'))
    loc('N', 't1', 3, 'Null products', null)
    loc('J', 't1', 4, 'Not json', 'not json')
    loc('S', 't1', 5, 'Strings', '["prod-x"]')
    loc('O', 't1', 6, 'Object', '{}')
    loc('X', 't1', 7, 'Bad translations', offers('prod-y'), 'not json')
    const productBlockers = await load()
    expect(await productBlockers(db, 't1', 'prod-x')).toEqual([
      'Still offered by 2 locations: Kajakverhuur, Bike Shed. Remove it there first.',
    ])
  })

  // covers: T2
  it('G2 one location → singular sentence; unreadable translations fall back to the title', async () => {
    loc('A', 't1', 0, 'Kayak Rental', offers('prod-x'), 'not json')
    const productBlockers = await load()
    expect(await productBlockers(db, 't1', 'prod-x')).toEqual([
      'Still offered by 1 location: Kayak Rental. Remove it there first.',
    ])
  })

  // covers: T2
  it('G3 a product only used by bookings, listed by no location → []', async () => {
    loc('A', 't1', 0, 'Court', offers('prod-y'))
    client.prepare(`INSERT INTO bookings_bookings (id, teamId, location, product, date, quantity, slot, status) VALUES ('b1','t1','A','prod-x',1,1,'[]','confirmed')`).run()
    const productBlockers = await load()
    expect(await productBlockers(db, 't1', 'prod-x')).toEqual([])
  })

  // covers: T2
  it('G4 more than 5 locations → 5 titles, ", …" and the real count', async () => {
    for (let i = 1; i <= 7; i++) loc(`L${i}`, 't1', i, `Loc ${i}`, offers('prod-x'))
    const productBlockers = await load()
    const [msg] = await productBlockers(db, 't1', 'prod-x')
    expect(msg).toBe('Still offered by 7 locations: Loc 1, Loc 2, Loc 3, Loc 4, Loc 5, …. Remove it there first.')
    expect(msg).not.toContain('Loc 6')
  })

  // covers: T2
  it('wiring: the plugin listens on crouton:catalog:before-delete-product and pushes the blocker', async () => {
    loc('A', 't1', 0, 'Kayak Rental', offers('prod-x'), JSON.stringify({ nl: { title: 'Kajakverhuur' } }))
    const hooks: Record<string, (p: any) => any> = {}
    vi.stubGlobal('defineNitroPlugin', (fn: any) => fn)
    const plugin = (await import('../server/plugins/catalog-delete-guard')).default as any
    plugin({ hooks: { hook: (name: string, fn: any) => { hooks[name] = fn } } })
    const payload = { teamId: 't1', productId: 'prod-x', blockers: [] as string[] }
    await hooks['crouton:catalog:before-delete-product'](payload)
    expect(payload.blockers).toEqual(['Still offered by 1 location: Kajakverhuur. Remove it there first.'])
    const free = { teamId: 't1', productId: 'prod-z', blockers: [] as string[] }
    await hooks['crouton:catalog:before-delete-product'](free)
    expect(free.blockers).toEqual([])
  })
})
