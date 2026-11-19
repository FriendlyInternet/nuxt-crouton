// #3968 — runAtomic on Cloudflare D1. drizzle's `db.batch([db.run(sql)])` crashes on D1
// ("Cannot read properties of undefined (reading 'bind')"), and the better-sqlite3 tests
// never reach that branch. Here a REAL `drizzle-orm/d1` db runs over a fake D1 binding
// backed by better-sqlite3, so the D1 session code path is the one under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/d1'
import { guardedInsert, runAtomic } from '../server/utils/booking-capacity'
import { sql } from 'drizzle-orm'

const hoisted = vi.hoisted(() => ({ member: { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' } } }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
vi.mock('../server/utils/booking-emails', () => ({ isBookingEmailEnabled: () => false, resolveTranslatedField: () => '', resolveSlotLabels: () => '' }))
vi.mock('../server/utils/email-service', () => ({ triggerBookingCreatedEmail: async () => ({ success: true }) }))

// Same tables as test/customer-bookings-batch.test.ts (copied: importing that file would run its suite).
const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
`

const BOUND = Symbol('bound')

/** Minimal D1Database: prepare/bind/all/raw/run/first + an atomic batch of bound statements. */
function fakeD1(sqlite: Database.Database) {
  const toSqlite = (p: unknown[]) => p.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
  const exec = (q: string, params: unknown[], mode: 'all' | 'raw' | 'run' | 'first') => {
    const st = sqlite.prepare(q)
    const p = toSqlite(params)
    if (!st.reader) {
      const info = st.run(...p)
      return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
    }
    if (mode === 'raw') return st.raw(true).all(...p)
    const results = st.all(...p)
    if (mode === 'first') return results[0] ?? null
    return { results, success: true, meta: {} }
  }
  const statement = (q: string, params: unknown[] = []): any => ({
    [BOUND]: true,
    q,
    params,
    bind: (...p: unknown[]) => statement(q, p),
    all: async () => exec(q, params, 'all'),
    raw: async () => exec(q, params, 'raw'),
    run: async () => exec(q, params, 'run'),
    first: async () => exec(q, params, 'first'),
  })
  return {
    prepare: (q: string) => statement(q),
    batch: async (items: any[]) => {
      for (const it of items) {
        if (!it?.[BOUND]) throw new TypeError('D1_TYPE_ERROR: batch expects bound D1PreparedStatements')
      }
      return sqlite.transaction(() => items.map(it => exec(it.q, it.params, 'all')))()
    },
  }
}

let sqlite: Database.Database
let db: any
const rows = () => sqlite.prepare('select * from bookings_bookings').all() as any[]
const row = (id: string, ts: number) => ({ id, teamId: 't1', owner: 'u1', location: 'L', storedTs: ts, slot: null, group: null, quantity: 1, status: 'pending', product: 'loc-L', by: 'u1', nowTs: 1 })
const loc = (id: string, over: Record<string, unknown> = {}, stock = 1) => {
  // every location lists one product (#4044); its stock is what counts (#4061)
  const l = { id, teamId: 't1', title: id, slots: null, offerFullDay: 0, products: JSON.stringify([{ product: `loc-${id}`, stock }]), ...over }
  sqlite.prepare('insert into bookings_locations (id,teamId,title,slots,offerFullDay,products) values (@id,@teamId,@title,@slots,@offerFullDay,@products)').run(l)
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(DDL)
  db = drizzle(fakeD1(sqlite) as any)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e, { statusCode: e.status }))
})
afterEach(() => { sqlite.close(); vi.unstubAllGlobals() })

describe('runAtomic on D1 (#3968)', () => {
  it('T1 saves every statement of a multi-row batch', async () => {
    await runAtomic(db, [guardedInsert(row('a', 100), sql`1 = ${1}`), guardedInsert(row('b', 200), sql`1 = ${1}`)])
    expect(rows().map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('T2 a refused guard rejects with 409 and leaves no rows', async () => {
    const run = runAtomic(db, [guardedInsert(row('a', 100), sql`1 = ${1}`), guardedInsert(row('b', 200), sql`1 = ${0}`)], 'No room left')
    await expect(run).rejects.toMatchObject({ status: 409 })
    expect(rows()).toHaveLength(0)
  })

  it('T3 customer-bookings-batch books one location for two dates on D1', async () => {
    vi.stubGlobal('defineEventHandler', (fn: any) => fn)
    vi.stubGlobal('useDB', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({}))
    const handler = (await import('../server/api/crouton-bookings/teams/[id]/customer-bookings-batch.post')).default as any
    loc('inv', {}, 5)
    const bookings = ['2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z']
      .map(date => ({ id: 'c', locationId: 'inv', locationTitle: 'inv', date }))
    vi.stubGlobal('readBody', async () => ({ bookings }))
    const res = await handler({})
    expect(res.count).toBe(2)
    expect(rows()).toHaveLength(2)
  })
})
