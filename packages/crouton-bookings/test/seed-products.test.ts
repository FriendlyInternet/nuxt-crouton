import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { collectSeedSql } from '@fyit/crouton-core/shared/seed'
import { provider as catalogProvider } from '@fyit/crouton-catalog/seed'
import { provider as bookingsProvider } from '../seed'

// #4044 — the package seed writes products: run the REAL catalog + bookings providers'
// SQL into SQLite and read the rows back (never grep the SQL text).
const DDL = `
CREATE TABLE bookings_settings (id text primary key, teamId text not null, owner text not null, "order" integer not null, statuses text, groups text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, products text, openDays text, slotSchedule text, blockedDates text, offerFullDay integer, maxBookingsPerMonth integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, product text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
CREATE TABLE catalog_products (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, description text, active integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`

async function seeded(providers: Parameters<typeof collectSeedSql>[0]['providers']) {
  const client = new Database(':memory:')
  client.exec(DDL)
  const seedSql = await collectSeedSql({ providers, teamSlug: 'acme', teamId: 't1', locale: 'nl' })
  for (const statement of seedSql.split('\n').map(s => s.trim()).filter(Boolean)) client.exec(statement)
  return client
}

describe('package seed writes products (#4044)', () => {
  // covers: T1
  it('S1 catalog + bookings seed: 4 locations, 6 bookings, 4 products; every location lists products, every booking has a seeded product', async () => {
    // bookings listed first on purpose: dependsOn must still run catalog before it
    const client = await seeded([bookingsProvider, catalogProvider])

    const count = (t: string) => (client.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n
    expect(count('bookings_locations')).toBe(4)
    expect(count('bookings_bookings')).toBe(6)
    // one cancelled booking so "Show cancelled" has something to show (#4562)
    expect((client.prepare(`select count(*) as n from bookings_bookings where status = 'cancelled'`).get() as { n: number }).n).toBe(1)
    expect(count('catalog_products')).toBe(4)

    const productIds = new Set((client.prepare('select id from catalog_products').all() as { id: string }[]).map(r => r.id))
    const locations = client.prepare('select id, products from bookings_locations').all() as { id: string, products: string | null }[]
    const listed = new Map<string, string[]>()
    for (const l of locations) {
      expect(l.products, `location ${l.id} has products`).not.toBeNull()
      const list = JSON.parse(l.products!) as { product: string, stock: number }[]
      expect(list.length).toBeGreaterThan(0)
      for (const p of list) expect(productIds.has(p.product)).toBe(true)
      listed.set(l.id, list.map(p => p.product))
    }
    for (const b of client.prepare('select location, product from bookings_bookings').all() as { location: string, product: string | null }[]) {
      expect(b.product).not.toBeNull()
      expect(productIds.has(b.product!)).toBe(true)
      expect(listed.get(b.location)).toContain(b.product)
    }
    client.close()
  })

  // covers: T2
  it('S1b Bike Shed lists three products with full day and two slots; its booking is a cargo bike; the other locations keep one product', async () => {
    const client = await seeded([bookingsProvider, catalogProvider])
    const pid = (key: string) => `seed:catalog-product:acme:${key}`
    const loc = (key: string) => client.prepare('select products, offerFullDay, slots from bookings_locations where id = ?')
      .get(`seed:bookings-location:acme:${key}`) as { products: string, offerFullDay: number, slots: string } | undefined

    const shed = loc('bike-shed')
    expect(shed).toBeDefined()
    expect(JSON.parse(shed!.products)).toEqual([
      { product: pid('cargo-bike'), stock: 3 },
      { product: pid('kids-bike'), stock: 5 },
      { product: pid('kayak'), stock: 8 }
    ])
    expect(shed!.offerFullDay).toBe(1)
    expect((JSON.parse(shed!.slots) as { id: string }[]).map(s => s.id)).toEqual(['slot-morning', 'slot-afternoon'])

    const shedBookings = client.prepare('select product, quantity, slot from bookings_bookings where location = ?')
      .all('seed:bookings-location:acme:bike-shed') as { product: string, quantity: number, slot: string }[]
    expect(shedBookings).toHaveLength(1)
    expect(shedBookings[0]!.product).toBe(pid('cargo-bike'))
    expect(shedBookings[0]!.quantity).toBe(2)
    expect(JSON.parse(shedBookings[0]!.slot)).toEqual(['slot-morning'])

    for (const [key, product, stock] of [['center-court', 'court', 2], ['park-court', 'court', 1], ['kayak-rental', 'kayak', 8]] as const) {
      const row = loc(key)
      expect(row, key).toBeDefined()
      expect(JSON.parse(row!.products)).toEqual([{ product: pid(product), stock }])
      expect(row!.offerFullDay, key).toBe(0)
    }
    client.close()
  })

  // covers: T3
  it('S2 catalog seed alone writes exactly 4 products for the team', async () => {
    const client = await seeded([catalogProvider])
    const rows = client.prepare('select id from catalog_products where teamId = ? order by "order"').all('t1') as { id: string }[]
    expect(rows.map(r => r.id)).toEqual(['court', 'kayak', 'cargo-bike', 'kids-bike'].map(k => `seed:catalog-product:acme:${k}`))
    client.close()
  })
})
