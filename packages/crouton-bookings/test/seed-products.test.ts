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

describe('package seed writes products (#4044)', () => {
  // covers: T4
  it('S1 catalog + bookings seed: 3 locations, 4 bookings, 2 products; every location lists products, every booking has a seeded product', async () => {
    const client = new Database(':memory:')
    client.exec(DDL)
    // bookings listed first on purpose: dependsOn must still run catalog before it
    const seedSql = await collectSeedSql({ providers: [bookingsProvider, catalogProvider], teamSlug: 'acme', teamId: 't1', locale: 'nl' })
    for (const statement of seedSql.split('\n').map(s => s.trim()).filter(Boolean)) client.exec(statement)

    const count = (t: string) => (client.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n
    expect(count('bookings_locations')).toBe(3)
    expect(count('bookings_bookings')).toBe(4)
    expect(count('catalog_products')).toBe(2)

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
})
