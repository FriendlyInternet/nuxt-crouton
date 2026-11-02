import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let db: any
const hoisted = vi.hoisted(() => ({ member: { team: { id: 't1', name: 'T', metadata: {} }, user: { id: 'u1', name: 'U', email: 'u@x' } } }))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
vi.mock('../server/utils/booking-emails', () => ({ isBookingEmailEnabled: () => false, resolveTranslatedField: () => '', resolveSlotLabels: () => '' }))
vi.mock('../server/utils/email-service', () => ({ triggerBookingCreatedEmail: async () => ({ success: true }) }))

export const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer);
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
  const l = { id, teamId: 't1', title: id, slots: null, quantity: null, inventoryMode: 0, ...over }
  db.$client.prepare('insert into bookings_locations (id,teamId,title,slots,quantity,inventoryMode) values (@id,@teamId,@title,@slots,@quantity,@inventoryMode)').run(l)
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

  it('race through the handler: two connections, last place, exactly one wins', async () => {
    loc('inv', { inventoryMode: 1, quantity: 1 })
    const other = drizzle(new Database(join(dir, 'db.sqlite')))
    const first = call([item('inv')])
    vi.stubGlobal('useDB', () => other)
    const second = call([item('inv')])
    const res = await Promise.allSettled([first, second])
    other.$client.close()
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(rows()).toHaveLength(1)
  })

  it('500 body carries no DB error text', async () => {
    loc('inv', { inventoryMode: 1, quantity: 2 })
    db.$client.exec('drop table bookings_bookings')
    const err: any = await call([item('inv')]).catch(e => e)
    expect(err.status).toBe(500)
    expect(err.statusText).toBe('Failed to create bookings')
  })
})
