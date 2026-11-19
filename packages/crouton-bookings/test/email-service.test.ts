import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))

const TEMPLATES = `CREATE TABLE bookings_emailtemplates (id text primary key, teamId text not null, owner text not null, "order" integer not null, name text not null, subject text not null, body text not null, fromEmail text not null, triggerType text not null, recipientType text not null, isActive integer, daysOffset integer, locationId text, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`
const LOGS = `CREATE TABLE bookings_emaillogs (id text primary key, teamId text not null, owner text not null, "order" integer not null, bookingId text, templateId text, recipientEmail text not null, triggerType text not null, status text not null, sentAt text, error text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`

let db: any
const send = vi.fn()
const tpl = (id: string, team: string, active: number, subject = 'Hi {{ customer_name }}', body = 'body', translations: Record<string, Record<string, string>> | null = null) =>
  db.$client.prepare(`insert into bookings_emailtemplates values (?,?,'u1',0,'n',?,?,'a@b.c','booking_created','customer',?,null,null,?,1,1,'u1','u1')`).run(id, team, subject, body, active, translations ? JSON.stringify(translations) : null)
const logs = () => db.$client.prepare('select * from bookings_emaillogs').all()
const booking = { id: 'b1', teamId: 't1', owner: 'u1', location: 'l1', date: '2026-11-09', slot: ['am'], status: 'active' }
const opts = { booking, triggerType: 'booking_created', teamId: 't1', userId: 'u1', recipientEmail: 'a@example.com' } as any

async function setup(ddl: string[], croutonI18n?: Record<string, unknown>) {
  const client = new Database(':memory:')
  ddl.forEach(d => client.exec(d))
  db = drizzle(client)
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({ croutonBookings: { email: { enabled: true } }, ...(croutonI18n ? { croutonI18n } : {}) }))
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

const EMPTY = 'Template has no subject or body in any language'

describe('a booking email is never sent blank (#4244)', () => {
  // E2
  it('FR-only template, customer en: sends the French text', async () => {
    const m = await setup([TEMPLATES, LOGS])
    tpl('a', 't1', 1, '', '', { fr: { subject: 'Bonjour', body: 'Corps' } })
    const res = await m.sendBookingEmails({ ...opts, locale: 'en' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ subject: 'Bonjour', html: 'Corps' })
    expect(res.success).toBe(true)
    const rows = logs()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'sent', templateId: 'a' })
  })

  // E3
  it('empty template: not sent, one failed row, other templates still send', async () => {
    const m = await setup([TEMPLATES, LOGS])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    tpl('empty', 't1', 1, '', '')
    tpl('filled', 't1', 1)
    const res = await m.sendBookingEmails({ ...opts, locale: 'en' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(res.success).toBe(false)
    expect(res.errors).toContain(EMPTY)
    const rows = logs()
    expect(rows.find((r: any) => r.templateId === 'empty')).toMatchObject({ status: 'failed', error: EMPTY, recipientEmail: 'a@example.com' })
    expect(rows.find((r: any) => r.templateId === 'filled')).toMatchObject({ status: 'sent' })
    expect(rows).toHaveLength(2)
  })

  it('whitespace subject and a body that renders empty: not sent, failed row', async () => {
    const m = await setup([TEMPLATES, LOGS])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    tpl('a', 't1', 1, '  ', '{{ location_content }}')
    const res = await m.sendBookingEmails({ ...opts, locale: 'en' })
    expect(send).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(logs()).toEqual([expect.objectContaining({ status: 'failed', error: EMPTY })])
  })

  // E4
  it('no locale: uses the app default language before the empty main fields', async () => {
    const m = await setup([TEMPLATES, LOGS], { supportedLocales: ['fr', 'nl', 'en'], defaultLocale: 'fr' })
    tpl('a', 't1', 1, '', '', { fr: { subject: 'Bonjour', body: 'Corps' }, nl: { subject: 'Hallo', body: 'Tekst' } })
    await m.sendBookingEmails(opts)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ subject: 'Bonjour', html: 'Corps' })
    expect(logs()[0]).toMatchObject({ status: 'sent' })
  })
})
