import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dayRange } from '../server/utils/booking-capacity'
import { pickChartLocale, groupByMonth } from '../server/utils/booking-charts'

// #4565: run the REAL chart handlers over an in-memory SQLite, with the REAL slot
// labels (booking-emails is not mocked). Only the auth helper (switchable role) and
// the Nitro globals are stand-ins — the same pattern as booking-authz.test.ts.
const h = vi.hoisted(() => ({ role: 'owner', asked: [] as string[] }))
const ctx = () => ({ team: { id: 't1', metadata: {} }, user: { id: 'u1' }, membership: { role: h.role } })
vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => {
  const { teamAuthStub } = await import('./stubs/team-auth')
  const stub = teamAuthStub(() => ctx())
  h.asked = stub.asked
  return stub.module
})

const TZ = 'Europe/Brussels'
const stored = (day: string) => dayRange(day, TZ)!.storedTs

const client = new Database(':memory:')
client.exec(`
CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text, "order" integer, title text, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, openDays text, slotSchedule text, blockedDates text, offerFullDay integer, maxBookingsPerMonth integer, translations text, createdAt integer, updatedAt integer, createdBy text, updatedBy text, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text, "order" integer, location text, date integer, slot text, "group" text, quantity integer, status text, createdAt integer, updatedAt integer, createdBy text, updatedBy text, product text);
`)
const db = drizzle(client) as any

function reset(bookings: [id: string, location: string, day: string, slot: string][]) {
  client.exec('DELETE FROM bookings_locations; DELETE FROM bookings_bookings;')
  const loc = client.prepare('INSERT INTO bookings_locations (id, teamId, title, slots) VALUES (?, ?, ?, ?)')
  loc.run('l1', 't1', 'Gent', JSON.stringify([{ id: 'm1', label: 'Matin' }]))
  loc.run('l2', 't1', 'Brugge', JSON.stringify([{ id: 'm2', label: 'Matin' }]))
  const b = client.prepare(`INSERT INTO bookings_bookings VALUES (?, 't1', 'u1', 0, ?, ?, ?, 'kids', 1, 'confirmed', 1, 1, 'u1', 'u1', null)`)
  for (const [id, location, day, slot] of bookings) b.run(id, location, stored(day), slot)
}

const g = globalThis as any
let query: Record<string, unknown> = {}
let cookies: Record<string, string> = {}
g.useDB = () => db
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.getQuery = () => query
g.getCookie = (_e: any, k: string) => cookies[k]
g.useRuntimeConfig = () => ({
  croutonI18n: { supportedLocales: ['fr', 'nl'], defaultLocale: 'fr' },
  croutonBookings: { timezone: TZ }
})

beforeEach(() => {
  h.role = 'owner'
  h.asked.length = 0
  query = {}
  cookies = {}
  reset([])
})

const C = '../server/api/crouton-bookings/teams/[id]/charts'
const call = async (name: string) => (await import(`${C}/${name}.get`)).default({})
const frMonth = (y: number, m: number) => new Intl.DateTimeFormat('fr', { month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(Date.UTC(y, m - 1, 15)))

describe('bookings-by-slot', () => {
  // covers: T1
  it('merges the same label across two locations', async () => {
    reset([['b1', 'l1', '2026-01-03', '["m1"]'], ['b2', 'l2', '2026-01-04', '["m2"]']])
    expect((await call('bookings-by-slot')).items).toEqual([{ slot: 'Matin', count: 2 }])
  })

  // covers: T2
  it('labels in the page language from the query, ignores the cookie, keeps unknown ids', async () => {
    reset([['b1', 'l1', '2026-01-03', '["all-day"]']])
    query = { locale: 'nl' }
    expect((await call('bookings-by-slot')).items).toEqual([{ slot: 'Hele dag', count: 1 }])

    query = {}
    cookies = { i18n_redirected: 'nl' }
    expect((await call('bookings-by-slot')).items).toEqual([{ slot: 'Toute la journée', count: 1 }])

    reset([['b1', 'l1', '2026-01-03', '["x9"]']])
    expect((await call('bookings-by-slot')).items).toEqual([{ slot: 'x9', count: 1 }])
  })

  // covers: T2
  it('counts each id of a multi-slot booking', async () => {
    reset([['b1', 'l1', '2026-01-03', '["m1","all-day"]'], ['b2', 'l2', '2026-01-04', '["m2"]']])
    expect((await call('bookings-by-slot')).items).toEqual([
      { slot: 'Matin', count: 2 },
      { slot: 'Toute la journée', count: 1 }
    ])
  })
})

describe('pickChartLocale', () => {
  // covers: T2 (T2b)
  it('falls back to the default locale for an unsupported query locale', () => {
    expect(pickChartLocale('de', ['fr', 'nl'], 'fr')).toBe('fr')
    expect(pickChartLocale('nl', ['fr', 'nl'], 'fr')).toBe('nl')
    expect(pickChartLocale(undefined, ['fr', 'nl'], 'fr')).toBe('fr')
  })
})

describe('bookings-by-date', () => {
  // covers: T3
  it('groups per month, in month order, labelled in the page language', async () => {
    reset([['b1', 'l1', '2026-01-03', '["m1"]'], ['b2', 'l1', '2026-01-20', '["m1"]'], ['b3', 'l1', '2026-02-02', '["m1"]']])
    query = { locale: 'fr' }
    expect((await call('bookings-by-date')).items).toEqual([
      { date: frMonth(2026, 1), count: 2 },
      { date: frMonth(2026, 2), count: 1 }
    ])
    expect(frMonth(2026, 1)).toBe('janv. 2026')
  })

  // covers: T8
  it('counts a booking on the 1st of a month in that month (bookings timezone, summer time too)', async () => {
    expect(new Date(stored('2026-02-01') * 1000).toISOString()).toBe('2026-01-31T23:00:00.000Z')
    expect(new Date(stored('2026-07-01') * 1000).toISOString()).toBe('2026-06-30T22:00:00.000Z')
    reset([['b1', 'l1', '2026-02-01', '["m1"]'], ['b2', 'l1', '2026-01-31', '["m1"]'], ['b3', 'l1', '2026-07-01', '["m1"]']])
    query = { locale: 'fr' }
    expect((await call('bookings-by-date')).items).toEqual([
      { date: 'janv. 2026', count: 1 },
      { date: 'févr. 2026', count: 1 },
      { date: 'juil. 2026', count: 1 }
    ])
  })

  // covers: T8
  it('groupByMonth uses the timezone it is given', () => {
    const feb1 = new Date(stored('2026-02-01') * 1000)
    expect(groupByMonth([{ date: feb1, count: 1 }], 'fr', 'UTC')).toEqual([{ date: 'janv. 2026', count: 1 }])
    expect(groupByMonth([{ date: feb1, count: 1 }], 'fr', TZ)).toEqual([{ date: 'févr. 2026', count: 1 }])
  })
})

describe('chart endpoints need bookings:manage (the rule)', () => {
  const endpoints = ['bookings-by-date', 'bookings-by-group', 'bookings-by-location', 'bookings-by-slot', 'bookings-by-status']
  for (const name of endpoints) {
    // covers: T4
    it(`${name}: member → 403, no numbers; owner → 200 with items`, async () => {
      reset([['b1', 'l1', '2026-01-03', '["m1"]']])
      h.role = 'member'
      let result: any
      let status = 200
      try { result = await call(name) }
      catch (e: any) { status = e.status }
      expect(status).toBe(403)
      expect(result?.items).toBeUndefined()
      expect(h.asked).toContain('bookings:manage')

      h.role = 'owner'
      const ok = await call(name)
      expect(ok.items.length).toBeGreaterThan(0)
    })
  }
})
