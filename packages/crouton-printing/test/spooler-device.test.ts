/**
 * Device-scoped spooler (#1366): the team-wide jobs listing that replaces the
 * per-event EVENT_ID poll, and the server-rendered pairing ticket.
 *
 * The per-event transport gate (#1324) is what makes "serve all the team's
 * events" safe: a second claimed router on the same app can never receive
 * another venue's jobs, and events flipped to local-drainer/none stay
 * invisible to the router.
 */
import { describe, it, expect } from 'vitest'
import { listTeamSpoolerJobs } from '../server/utils/spooler-device'
import { formatPairingTicket } from '../server/utils/receipt-formatter'
import { printJobs, printTransports } from '../server/database/schema'

// Same fake-drizzle idiom as print-transport.test.ts: selects return the
// configured rows per table; the REAL in-JS gating is what's under test.
function fakeDb({ jobs = [], transports = [] }: { jobs?: any[], transports?: any[] } = {}) {
  const updates: Array<{ table: any, set: any }> = []
  const rowsFor = (t: any) => (t === printJobs ? jobs : t === printTransports ? transports : [])
  const selectable = (rows: any[]): any => ({
    where: () => selectable(rows),
    limit: () => selectable(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej)
  })
  return {
    updates,
    select: () => ({ from: (t: any) => selectable(rowsFor(t)) }),
    update: (t: any) => ({
      set: (set: any) => ({
        where: () => {
          updates.push({ table: t, set })
          return { then: (res: any, rej: any) => Promise.resolve(undefined).then(res, rej) }
        }
      })
    })
  }
}

const job = (id: string, eventId: string) => ({
  id,
  printData: 'AAA=',
  printMode: 'kitchen',
  locationId: null,
  printerId: 'p1',
  retryCount: 0,
  printerIp: '192.168.1.72',
  printerPort: 9100,
  printerTitle: 'Keuken',
  eventId
})

describe('listTeamSpoolerJobs', () => {
  it('serves jobs of events with no transport row (router-spooler default)', async () => {
    const db = fakeDb({ jobs: [job('j1', 'ev1')], transports: [] })
    const rows = await listTeamSpoolerJobs(db, 'team-a', false)
    expect(rows.map((r: any) => r.id)).toEqual(['j1'])
  })

  it('excludes events routed to local-drainer or none — no cross-transport leak', async () => {
    const db = fakeDb({
      jobs: [job('j1', 'ev-router'), job('j2', 'ev-drainer'), job('j3', 'ev-none')],
      transports: [
        { eventId: 'ev-router', transport: 'router-spooler', lastSpoolerPollAt: null },
        { eventId: 'ev-drainer', transport: 'local-drainer', lastSpoolerPollAt: null },
        { eventId: 'ev-none', transport: 'none', lastSpoolerPollAt: null }
      ]
    })
    const rows = await listTeamSpoolerJobs(db, 'team-a', false)
    expect(rows.map((r: any) => r.id)).toEqual(['j1'])
  })

  it('keeps the legacy job-row shape (no eventId leaks to the script)', async () => {
    const db = fakeDb({ jobs: [job('j1', 'ev1')], transports: [] })
    const [row] = await listTeamSpoolerJobs(db, 'team-a', false)
    expect(row).not.toHaveProperty('eventId')
    expect(row).toMatchObject({ id: 'j1', printData: 'AAA=', printerIp: '192.168.1.72', printerPort: 9100 })
  })

  it('claim flips only the served jobs to printing', async () => {
    const db = fakeDb({
      jobs: [job('j1', 'ev-router'), job('j2', 'ev-drainer')],
      transports: [{ eventId: 'ev-drainer', transport: 'local-drainer', lastSpoolerPollAt: null }]
    })
    await listTeamSpoolerJobs(db, 'team-a', true)
    const flips = db.updates.filter(u => u.table === printJobs)
    expect(flips).toHaveLength(1)
    expect(flips[0]!.set.status).toBe('1')
  })

  it('stamps the throttled heartbeat on router-spooler transport rows only', async () => {
    const db = fakeDb({
      jobs: [],
      transports: [
        { eventId: 'ev-router', transport: 'router-spooler', lastSpoolerPollAt: null },
        { eventId: 'ev-drainer', transport: 'local-drainer', lastSpoolerPollAt: null },
        // fresh heartbeat → throttled, no write needed
        { eventId: 'ev-fresh', transport: 'router-spooler', lastSpoolerPollAt: new Date().toISOString() }
      ]
    })
    await listTeamSpoolerJobs(db, 'team-a', false)
    const stamps = db.updates.filter(u => u.table === printTransports)
    expect(stamps).toHaveLength(1)
    expect(stamps[0]!.set.lastSpoolerPollAt).toBeTruthy()
  })
})

describe('formatPairingTicket', () => {
  it('weaves the device id and code into the printable bytes', () => {
    const { rawBuffer } = formatPairingTicket({ deviceId: 'rut-a1b2c3', code: '824241' })
    const bytes = rawBuffer.toString('latin1')
    expect(bytes).toContain('rut-a1b2c3')
    expect(bytes).toContain('824241')
  })

  it('renders localized labels (nl default, en override)', () => {
    const nl = formatPairingTicket({ deviceId: 'rut-x', code: '1111' }).rawBuffer.toString('latin1')
    const en = formatPairingTicket({ deviceId: 'rut-x', code: '1111', locale: 'en' }).rawBuffer.toString('latin1')
    expect(nl).toContain('KOPPEL DEZE ROUTER')
    expect(en).toContain('PAIR THIS ROUTER')
  })

  it('shows the app url so the installer knows where to go', () => {
    const bytes = formatPairingTicket({ deviceId: 'rut-x', code: '1111', appUrl: 'https://kassa.pmcp.dev' })
      .rawBuffer.toString('latin1')
    expect(bytes).toContain('https://kassa.pmcp.dev')
  })
})
