import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

let db: any
const hoisted = vi.hoisted(() => ({ member: { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' } } }))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
vi.mock('../server/utils/booking-emails', () => ({ isBookingEmailEnabled: () => false, resolveTranslatedField: () => '', resolveSlotLabels: () => '' }))
vi.mock('../server/utils/email-service', () => ({ triggerBookingCreatedEmail: async () => ({ success: true }) }))

export const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer, offerFullDay integer);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`
const DATE = '2026-11-10T00:00:00.000Z'
let dir: string
let handler: any

function call(bookings: any[]) {
  vi.stubGlobal('readBody', async () => ({ bookings }))
  return handler({})
}
const rows = () => db.$client.prepare('select * from bookings_bookings').all()
const loc = (id: string, over: Record<string, unknown> = {}) => {
  const l = { id, teamId: 't1', title: id, slots: null, quantity: null, inventoryMode: 0, offerFullDay: 0, ...over }
  db.$client.prepare('insert into bookings_locations (id,teamId,title,slots,quantity,inventoryMode,offerFullDay) values (@id,@teamId,@title,@slots,@quantity,@inventoryMode,@offerFullDay)').run(l)
}
const item = (locationId: string, over: Record<string, unknown> = {}) => ({ id: 'c', locationId, locationTitle: locationId, date: DATE, ...over })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'batch-'))
  const client = new Database(join(dir, 'db.sqlite'))
  client.pragma('journal_mode = WAL')
  client.exec(DDL)
  db = drizzle(client)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e, { statusCode: e.status }))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({}))
  handler = (await import('../server/api/crouton-bookings/teams/[id]/customer-bookings-batch.post')).default
})
afterEach(() => { db.$client.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals() })

describe('customer-bookings-batch (#3139)', () => {
  it('refuses negative and fractional quantity', async () => {
    loc('inv', { inventoryMode: 1, quantity: 5 })
    await expect(call([item('inv', { quantity: -1 })])).rejects.toMatchObject({ status: 400 })
    await expect(call([item('inv', { quantity: 1.5 })])).rejects.toMatchObject({ status: 400 })
    expect(rows()).toHaveLength(0)
  })

  it('refuses over-limit incl. [+5,-5]', async () => {
    loc('inv', { inventoryMode: 1, quantity: 9, maxBookingsPerMonth: 3 })
    db.$client.prepare('update bookings_locations set maxBookingsPerMonth = 3').run()
    await expect(call([item('inv', { quantity: 5 }), item('inv', { quantity: -5 })])).rejects.toMatchObject({ status: 400 })
    await expect(call([item('inv', { quantity: 5 })])).rejects.toMatchObject({ status: 400 })
    expect(rows()).toHaveLength(0)
  })

  it('refuses another team\'s location', async () => {
    loc('other', { teamId: 't2' })
    await expect(call([item('other')])).rejects.toMatchObject({ status: 404 })
    expect(rows()).toHaveLength(0)
  })

  it('day location with empty quantity: 1 ok, 2nd refused', async () => {
    loc('inv', { inventoryMode: 1 })
    await call([item('inv')])
    await expect(call([item('inv')])).rejects.toMatchObject({ status: 409 })
    expect(rows()).toHaveLength(1)
  })

  it('slot location with empty capacity: 1 per slot', async () => {
    loc('s', { slots: JSON.stringify([{ id: 'am' }, { id: 'pm' }]) })
    await call([item('s', { slotIds: ['am'] })])
    await expect(call([item('s', { slotIds: ['am'] })])).rejects.toMatchObject({ status: 409 })
    await call([item('s', { slotIds: ['pm'] })])
    expect(rows()).toHaveLength(2)
  })

  it('normal multi-item batch succeeds', async () => {
    loc('inv', { inventoryMode: 1, quantity: 5 })
    loc('s', { slots: JSON.stringify([{ id: 'am' }]) })
    const res = await call([item('inv', { quantity: 3 }), item('s', { slotIds: ['am'] })])
    expect(res.count).toBe(2)
    expect(rows().map((r: any) => r.quantity).sort()).toEqual([1, 3])
    expect(rows().map((r: any) => r.date)).toEqual([Date.parse(DATE) / 1000, Date.parse(DATE) / 1000])
  })

  it('a failing item rolls back earlier rows of the request', async () => {
    loc('inv', { inventoryMode: 1, quantity: 2 })
    loc('s', { slots: JSON.stringify([{ id: 'am' }]) })
    await call([item('s', { slotIds: ['am'] })])
    await expect(call([item('inv', { quantity: 2 }), item('s', { slotIds: ['am'] })])).rejects.toMatchObject({ status: 409 })
    expect(rows()).toHaveLength(1)
  })

  it('stock booking stores JSON text null in the NOT NULL slot column', async () => {
    loc('inv', { inventoryMode: 1, quantity: 5 })
    await call([item('inv', { quantity: 2 })])
    expect(rows()[0].slot).toBe('null')
  })

  it('race: two threads, own connections, last place — exactly one booking stored', async () => {
    loc('inv', { inventoryMode: 1, quantity: 1 })
    const barrier = new SharedArrayBuffer(8) // [0]=release flag, [1]=threads ready
    const flag = new Int32Array(barrier)
    const spawn = () => new Promise<{ ok: boolean, status?: number }>((resolve, reject) => {
      const w = new Worker(new URL('./race-worker.mjs', import.meta.url), {
        workerData: { dbPath: join(dir, 'db.sqlite'), barrier, body: { bookings: [item('inv')] } },
      })
      w.once('message', resolve)
      w.once('error', reject)
    })
    const both = Promise.all([spawn(), spawn()])
    while (Atomics.load(flag, 1) < 2) await new Promise(r => setTimeout(r, 10))
    Atomics.store(flag, 0, 1)
    Atomics.notify(flag, 0)
    const res = await both
    expect(res.filter(r => r.ok)).toHaveLength(1)
    expect(res.filter(r => !r.ok).map(r => r.status)).toEqual([409])
    expect(rows()).toHaveLength(1)
  }, 30000)

  it('Brussels pick of 10 Nov is stored as sent and blocks only 10 Nov', async () => {
    loc('inv', { inventoryMode: 1, quantity: 1 })
    await call([item('inv', { date: '2026-11-09T23:00:00Z' })])
    expect(rows()[0].date).toBe(Date.parse('2026-11-09T23:00:00Z') / 1000)
    await expect(call([item('inv', { date: '2026-11-10T10:00:00Z' })])).rejects.toMatchObject({ status: 409 })
    await call([item('inv', { date: '2026-11-08T23:00:00Z' })]) // 9 Nov
    await call([item('inv', { date: '2026-11-10T23:00:00Z' })]) // 11 Nov
    expect(rows()).toHaveLength(3)
  })

  it('DST day (29 Mar 2026, 23h long) counts as one day', async () => {
    loc('inv', { inventoryMode: 1, quantity: 1 })
    await call([item('inv', { date: '2026-03-28T23:00:00Z' })]) // 29 Mar 00:00 CET
    await expect(call([item('inv', { date: '2026-03-29T21:30:00Z' })])).rejects.toMatchObject({ status: 409 }) // 23:30 CEST
    await call([item('inv', { date: '2026-03-29T22:00:00Z' })]) // 30 Mar 00:00 CEST
    expect(rows()).toHaveLength(2)
  })

  it('race: different times of day on the same day — exactly one stored', async () => {
    loc('inv', { inventoryMode: 1, quantity: 1 })
    const barrier = new SharedArrayBuffer(8)
    const flag = new Int32Array(barrier)
    const spawn = (date: string) => new Promise<{ ok: boolean, status?: number }>((resolve, reject) => {
      const w = new Worker(new URL('./race-worker.mjs', import.meta.url), {
        workerData: { dbPath: join(dir, 'db.sqlite'), barrier, body: { bookings: [item('inv', { date })] } },
      })
      w.once('message', resolve)
      w.once('error', reject)
    })
    const both = Promise.all([spawn('2026-11-10T09:00:00Z'), spawn('2026-11-10T09:00:30Z')])
    while (Atomics.load(flag, 1) < 2) await new Promise(r => setTimeout(r, 10))
    Atomics.store(flag, 0, 1)
    Atomics.notify(flag, 0)
    const res = await both
    expect(res.filter(r => r.ok)).toHaveLength(1)
    expect(rows()).toHaveLength(1)
  }, 30000)

  it('500 body carries no DB error text', async () => {
    loc('inv', { inventoryMode: 1, quantity: 2 })
    db.$client.exec('drop table bookings_bookings')
    const err: any = await call([item('inv')]).catch(e => e)
    expect(err.status).toBe(500)
    expect(err.statusText).toBe('Failed to create bookings')
  })

  describe('capacity gaps (#3379)', () => {
    const slots = (cap?: number, n = 1) => JSON.stringify(Array.from({ length: n }, (_, k) => ({ id: k === 0 ? 'am' : `s${k}`, ...(cap ? { capacity: cap } : {}) })))

    it('empty slot selection at a slotted location is refused', async () => {
      loc('s', { slots: slots() })
      await expect(call([item('s', { slotIds: [] })])).rejects.toMatchObject({ status: 400 })
      expect(rows()).toHaveLength(0)
    })

    it('unknown slot id is 400, not 500', async () => {
      loc('s', { slots: slots() })
      await expect(call([item('s', { slotIds: ['zzz'] })])).rejects.toMatchObject({ status: 400 })
    })

    it('part-day refused on a day booked full-day, and the reverse', async () => {
      loc('s', { slots: slots(2), offerFullDay: 1 })
      await call([item('s', { slotIds: ['all-day'] })])
      await expect(call([item('s', { slotIds: ['am'] })])).rejects.toMatchObject({ status: 409 })
      expect(rows()).toHaveLength(1)
      loc('t', { slots: slots(2), offerFullDay: 1 })
      await call([item('t', { slotIds: ['am'] })])
      await expect(call([item('t', { slotIds: ['all-day'] })])).rejects.toMatchObject({ status: 409 })
      expect(rows()).toHaveLength(2)
    })

    it('all or nothing: a refused 3rd item leaves no rows; same slot twice over capacity too', async () => {
      loc('s', { slots: slots() })
      loc('inv', { inventoryMode: 1, quantity: 5 })
      await call([item('s', { slotIds: ['am'] })])
      await expect(call([item('inv', { quantity: 1 }), item('inv', { quantity: 1 }), item('s', { slotIds: ['am'] })])).rejects.toMatchObject({ status: 409 })
      expect(rows()).toHaveLength(1)
      await expect(call([item('inv', { quantity: 3 }), item('inv', { quantity: 3 })])).rejects.toMatchObject({ status: 409 })
      expect(rows()).toHaveLength(1)
    })

    it('the SQL guard alone aborts the whole batch (pre-check bypassed)', async () => {
      loc('inv', { inventoryMode: 1, quantity: 1 })
      const { guardSql, guardedInsert, runAtomic, dayRange, validateSelection } = await import('../server/utils/booking-capacity')
      const sel = validateSelection({ inventoryMode: 1, quantity: 1 }, [], 1)
      const range = dayRange(DATE, 'Europe/Brussels')!
      const mk = (id: string) => guardedInsert({ id, teamId: 't1', owner: 'u', location: 'inv', storedTs: range.storedTs, slot: null, group: null, quantity: 1, status: 'active', by: 'u', nowTs: 1 }, guardSql({ teamId: 't1', locationId: 'inv', range, selection: sel }))
      await expect(runAtomic(db, [mk('a'), mk('b')])).rejects.toMatchObject({ status: 409 })
      expect(rows()).toHaveLength(0)
    })

    it('a 20-slot full day stays under 100 bound params', async () => {
      loc('s', { slots: slots(1, 20), offerFullDay: 1 })
      const counts: number[] = []
      db = drizzle(db.$client, { logger: { logQuery: (_q: string, p: unknown[]) => { counts.push(p.length) } } })
      await call([item('s', { slotIds: ['all-day'] })])
      expect(rows()).toHaveLength(1)
      expect(Math.max(...counts)).toBeLessThanOrEqual(100)
    })

    it('a plain day is stored as Brussels midnight and blocks only that day', async () => {
      loc('inv', { inventoryMode: 1, quantity: 1 })
      await call([item('inv', { date: '2026-11-09T15:00:00.000Z', day: '2026-11-10' })])
      expect(rows()[0].date).toBe(Date.parse('2026-11-09T23:00:00Z') / 1000)
      await expect(call([item('inv', { date: '2026-11-10T10:00:00Z' })])).rejects.toMatchObject({ status: 409 })
      await call([item('inv', { day: '2026-11-11' })])
      expect(rows()).toHaveLength(2)
    })
  })
})
