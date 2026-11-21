import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dayStartMs } from '../server/utils/booking-capacity'
import { DDL } from './scheduled-emails.fixture'

// #3930: the daily reminder / follow-up job, run for real over an in-memory SQLite
// with the package's tables. Only the email provider and the Nitro globals are stand-ins.
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))


const TZ = 'Europe/Brussels'
// 07:00 UTC on 20 Nov 2026 = 08:00 in Brussels → local today is 2026-11-20
const NOW = new Date('2026-11-20T07:00:00Z')

let db: any
const send = vi.fn()

/** Stored booking date: midnight of the local day in Brussels, in seconds */
const day = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  return Math.floor(dayStartMs(y, m, d, TZ) / 1000)
}
const tpl = (id: string, team: string, triggerType: string, daysOffset: number | null, locationId: string | null = null, recipientType = 'customer') =>
  db.$client.prepare(`insert into bookings_emailtemplates values (?,?,'u1',0,'n','Hello {{ customer_name }}','body','a@b.c',?,?,1,?,?,null,1,1,'u1','u1')`).run(id, team, triggerType, recipientType, daysOffset, locationId)
const bk = (id: string, team: string, date: number, { owner = 'cust', location = 'l1', status = 'confirmed' } = {}) =>
  db.$client.prepare(`insert into bookings_bookings values (?,?,?,0,?,null,?,'["am"]',null,1,?,1,1,'x','x')`).run(id, team, owner, location, date, status)
const preLog = (bookingId: string, templateId: string, recipientEmail: string) =>
  db.$client.prepare(`insert into bookings_emaillogs values (?,?,'x',0,?,?,?,'reminder_before','sent',null,null,1,1,'x','x')`).run(`pre-${bookingId}-${recipientEmail}`, 'tA', bookingId, templateId, recipientEmail)
const logs = () => db.$client.prepare('select bookingId, templateId, recipientEmail, status, triggerType from bookings_emaillogs where id not like \'pre-%\' order by bookingId, templateId').all()
const sentTo = () => send.mock.calls.map(c => c[0].to)

async function setup(enabled = true) {
  const client = new Database(':memory:')
  DDL.forEach(d => client.exec(d))
  db = drizzle(client)
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('useRuntimeConfig', () => ({ croutonBookings: { timezone: TZ, email: { enabled } } }))
  const svc = await import('../server/utils/email-service')
  svc.registerEmailProvider({ send } as any)
  return await import('../server/utils/scheduled-emails')
}

beforeEach(() => { send.mockReset(); send.mockResolvedValue({ success: true }) })
afterEach(() => { db.$client.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('daily scheduled booking emails (#3930)', () => {
  it('T1: reminder 2 days ahead → exactly one send and one sent log row', async () => {
    const m = await setup()
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('b1', 'tA', day('2026-11-22'))
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(sentTo()).toEqual(['cust@example.com'])
    expect(send.mock.calls[0][0].subject).toBe('Hello Customer One')
    expect(logs()).toEqual([{ bookingId: 'b1', templateId: 'rem', recipientEmail: 'cust@example.com', status: 'sent', triggerType: 'reminder_before' }])
  })

  it('T2: a second run with the same now sends nothing and adds no row', async () => {
    const m = await setup()
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('b1', 'tA', day('2026-11-22'))
    await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    const again = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(again).toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(logs()).toHaveLength(1)
  })

  it('T3: follow-up 1 day after → booking yesterday gets one, booking today none', async () => {
    const m = await setup()
    tpl('fu', 'tA', 'follow_up_after', 1)
    bk('yesterday', 'tA', day('2026-11-19'))
    bk('today', 'tA', day('2026-11-20'), { owner: 'cust2' })
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r.sent).toBe(1)
    expect(logs()).toEqual([expect.objectContaining({ bookingId: 'yesterday', templateId: 'fu', triggerType: 'follow_up_after', status: 'sent' })])
  })

  it('T4: a cancelled booking on the reminder day and a booking on another day get nothing', async () => {
    const m = await setup()
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('cancelled', 'tA', day('2026-11-22'), { status: 'cancelled' })
    bk('otherday', 'tA', day('2026-11-23'))
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(logs()).toEqual([])
  })

  it('T5: the target day is the Brussels local day, not the UTC one', async () => {
    const m = await setup()
    tpl('rem', 'tA', 'reminder_before', 2)
    // Local midnight 22 Nov in Brussels is 21 Nov 23:00 UTC — still the 22nd locally
    expect(new Date(day('2026-11-22') * 1000).toISOString()).toBe('2026-11-21T23:00:00.000Z')
    bk('local22', 'tA', day('2026-11-22'))
    // 22 Nov 23:30 UTC is 23 Nov locally → not due
    bk('local23', 'tA', Math.floor(Date.parse('2026-11-22T23:30:00Z') / 1000), { owner: 'cust2' })
    await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(logs().map((l: any) => l.bookingId)).toEqual(['local22'])

    // Summer time: 07:00 UTC on 1 Jul is 09:00 in Brussels; local midnight 3 Jul is 2 Jul 22:00 UTC
    send.mockClear()
    bk('summer', 'tA', day('2026-07-03'))
    expect(new Date(day('2026-07-03') * 1000).toISOString()).toBe('2026-07-02T22:00:00.000Z')
    await m.runScheduledBookingEmails({ now: new Date('2026-07-01T07:00:00Z'), tz: TZ })
    expect(sentTo()).toEqual(['cust@example.com'])
    expect(logs().map((l: any) => l.bookingId)).toEqual(['local22', 'summer'])
  })

  it('T6: a location template only reaches its location; two templates each send once', async () => {
    const m = await setup()
    tpl('all', 'tA', 'reminder_before', 2)
    tpl('only-l1', 'tA', 'reminder_before', 2, 'l1')
    bk('at-l1', 'tA', day('2026-11-22'), { location: 'l1' })
    bk('at-l2', 'tA', day('2026-11-22'), { owner: 'cust2', location: 'l2' })
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r.sent).toBe(3)
    expect(send).toHaveBeenCalledTimes(3)
    expect(logs().map((l: any) => `${l.bookingId}:${l.templateId}`)).toEqual(['at-l1:all', 'at-l1:only-l1', 'at-l2:all'])
  })

  it('T7: already sent to this customer → skipped; a log row to an admin does not count', async () => {
    const m = await setup()
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('done', 'tA', day('2026-11-22'))
    bk('admin-resend', 'tA', day('2026-11-22'), { owner: 'cust2' })
    preLog('done', 'rem', 'cust@example.com')
    preLog('admin-resend', 'rem', 'admin@team.be')
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r).toEqual({ sent: 1, skipped: 1, failed: 0 })
    expect(sentTo()).toEqual(['cust2@example.com'])
    expect(logs()).toEqual([expect.objectContaining({ bookingId: 'admin-resend', recipientEmail: 'cust2@example.com', status: 'sent' })])
  })

  it('T8: with booking email switched off, nothing is sent and no row is written', async () => {
    const m = await setup(false)
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('b1', 'tA', day('2026-11-22'))
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(logs()).toEqual([])
  })

  it('T11: one team\'s template never reaches another team\'s booking', async () => {
    const m = await setup()
    tpl('remA', 'tA', 'reminder_before', 2)
    tpl('remB', 'tB', 'reminder_before', 2)
    bk('bookA', 'tA', day('2026-11-22'))
    bk('bookB', 'tB', day('2026-11-22'), { owner: 'cust2', location: 'lb' })

    await m.runScheduledBookingEmails({ now: NOW, tz: TZ, teamId: 'tA' })
    expect(logs().map((l: any) => `${l.bookingId}:${l.templateId}`)).toEqual(['bookA:remA'])

    await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(logs().map((l: any) => `${l.bookingId}:${l.templateId}`)).toEqual(['bookA:remA', 'bookB:remB'])
  })

  it('a booking whose owner has no email is skipped; a provider failure is counted and the run goes on', async () => {
    const m = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    tpl('rem', 'tA', 'reminder_before', 2)
    bk('noaddr', 'tA', day('2026-11-22'), { owner: 'noemail' })
    bk('fails', 'tA', day('2026-11-22'))
    bk('works', 'tA', day('2026-11-22'), { owner: 'cust2' })
    send.mockImplementation(async (o: any) => o.to === 'cust@example.com' ? { success: false, error: 'boom' } : { success: true })
    const r = await m.runScheduledBookingEmails({ now: NOW, tz: TZ })
    expect(r).toEqual({ sent: 1, skipped: 1, failed: 1 })
  })
})
