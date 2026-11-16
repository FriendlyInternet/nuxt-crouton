import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))

const TEMPLATES = `CREATE TABLE bookings_emailtemplates (id text primary key, teamId text not null, owner text not null, "order" integer not null, name text not null, subject text not null, body text not null, fromEmail text not null, triggerType text not null, recipientType text not null, isActive integer, daysOffset integer, locationId text, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`
const LOGS = `CREATE TABLE bookings_emaillogs (id text primary key, teamId text not null, owner text not null, "order" integer not null, bookingId text, templateId text, recipientEmail text not null, triggerType text not null, status text not null, sentAt text, error text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`

let db: any
const send = vi.fn()
const tpl = (id: string, team: string, active: number) =>
  db.$client.prepare(`insert into bookings_emailtemplates values (?,?,'u1',0,'n','Hi {{ customer_name }}','body','a@b.c','booking_created','customer',?,null,null,null,1,1,'u1','u1')`).run(id, team, active)
const logs = () => db.$client.prepare('select * from bookings_emaillogs').all()
const booking = { id: 'b1', teamId: 't1', owner: 'u1', location: 'l1', date: '2026-11-09', slot: ['am'], status: 'active' }
const opts = { booking, triggerType: 'booking_created', teamId: 't1', userId: 'u1', recipientEmail: 'a@example.com' } as any

async function setup(ddl: string[]) {
  const client = new Database(':memory:')
  ddl.forEach(d => client.exec(d))
  db = drizzle(client)
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({ croutonBookings: { email: { enabled: true } } }))
  const mod = await import('../server/utils/email-service')
  mod.registerEmailProvider({ send } as any)
  return mod
}

beforeEach(() => { send.mockReset(); send.mockResolvedValue({ success: true }) })
afterEach(() => { db.$client.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('booking email service reads the package tables', () => {
  it('finds the active template for the team', async () => {
    const m = await setup([TEMPLATES, LOGS])
    tpl('a', 't1', 1); tpl('b', 't1', 0); tpl('c', 't2', 1)
    const r = await m.getActiveTemplatesForTrigger('t1', 'booking_created')
    expect(r.map((x: any) => x.id)).toEqual(['a'])
  })

  it('writes one log row for a sent email', async () => {
    const m = await setup([TEMPLATES, LOGS])
    tpl('a', 't1', 1)
    await m.sendBookingEmails(opts)
    expect(send).toHaveBeenCalledTimes(1)
    const rows = logs()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ teamId: 't1', bookingId: 'b1', recipientEmail: 'a@example.com', triggerType: 'booking_created', status: 'sent', templateId: 'a' })
  })

  it('marks the row failed when the provider fails', async () => {
    const m = await setup([TEMPLATES, LOGS])
    tpl('a', 't1', 1)
    send.mockResolvedValue({ success: false, error: 'boom' })
    const res = await m.sendBookingEmails(opts)
    expect(res.success).toBe(false)
    expect(logs()[0]).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('log table missing: error logged, nothing sent, no throw', async () => {
    const m = await setup([TEMPLATES])
    tpl('a', 't1', 1)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await m.sendBookingEmails(opts)
    expect(res.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(err.mock.calls.some(c => String(c[0]).includes('[booking-email]'))).toBe(true)
  })

  it('templates table missing: error logged, no throw', async () => {
    const m = await setup([])
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await m.getActiveTemplatesForTrigger('t1', 'booking_created')).toEqual([])
    expect(err).toHaveBeenCalled()
  })
})
