import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dayStartMs } from '../server/utils/booking-capacity'
import { DDL } from './scheduled-emails.fixture'

// #3930 T12: the REAL manual-run route + the REAL job over in-memory SQLite. Only the auth
// helper (switchable role, mirrors the real requireTeamAdmin: 403 unless admin/owner),
// the email provider and the Nitro globals are stand-ins.
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
const h = vi.hoisted(() => ({ role: 'member' }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  requireTeamAdmin: async () => {
    if (h.role !== 'admin' && h.role !== 'owner') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { team: { id: 'tA', metadata: {} }, user: { id: 'admin' }, membership: { role: h.role } }
  },
}))

const TZ = 'Europe/Brussels'
const send = vi.fn(async () => ({ success: true }))
let db: any

beforeEach(async () => {
  const client = new Database(':memory:')
  DDL.forEach(d => client.exec(d))
  db = drizzle(client)
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ croutonBookings: { timezone: TZ, email: { enabled: true } } }))
  ;(await import('../server/utils/email-service')).registerEmailProvider({ send } as any)
  // Both teams have a reminder due today (booking two local days ahead)
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()).split('-').map(Number) as [number, number, number]
  const due = Math.floor(dayStartMs(now[0], now[1], now[2] + 2, TZ) / 1000)
  client.exec(`
    INSERT INTO bookings_emailtemplates VALUES ('remA','tA','x',0,'n','s','b','a@b.c','reminder_before','customer',1,2,null,null,1,1,'x','x'), ('remB','tB','x',0,'n','s','b','a@b.c','reminder_before','customer',1,2,null,null,1,1,'x','x');
    INSERT INTO bookings_bookings VALUES ('bookA','tA','cust',0,'l1',null,${due},'["am"]',null,1,'confirmed',1,1,'x','x'), ('bookB','tB','cust2',0,'lb',null,${due},'["am"]',null,1,'confirmed',1,1,'x','x');
  `)
  send.mockClear()
})
afterEach(() => { db.$client.close(); vi.unstubAllGlobals() })

const handler = async () => (await import('../server/api/crouton-bookings/teams/[id]/scheduled-emails/run.post')).default as any
const logs = () => db.$client.prepare('select bookingId from bookings_emaillogs order by bookingId').all().map((r: any) => r.bookingId)

describe('POST /teams/[id]/scheduled-emails/run (#3930)', () => {
  it('a member gets 403 and nothing is sent', async () => {
    h.role = 'member'
    await expect((await handler())({})).rejects.toMatchObject({ status: 403 })
    expect(send).not.toHaveBeenCalled()
    expect(logs()).toEqual([])
  })

  for (const role of ['admin', 'owner']) {
    it(`${role}: runs the job for the URL's team only, and a second run sends nothing`, async () => {
      h.role = role
      expect(await (await handler())({})).toEqual({ sent: 1, skipped: 0, failed: 0 })
      expect(logs()).toEqual(['bookA'])
      expect(await (await handler())({})).toEqual({ sent: 0, skipped: 1, failed: 0 })
      expect(send).toHaveBeenCalledTimes(1)
    })
  }
})
