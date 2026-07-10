import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PRINT_TRANSPORT,
  PRINT_TRANSPORT,
  isPrintTransport,
  transportAllows,
  shouldStampHeartbeat,
  upsertPrintTransport
} from '../server/utils/print-transport'
import { drainPendingEscposJobs } from '../server/utils/escpos-drainer'
import { printJobs, printTransports } from '../server/database/schema'

// ---------------------------------------------------------------------------
// Fake drizzle db, routed by table reference (same idiom as print-job-queue
// tests). Selects return the configured rows for the table regardless of the
// where clause — the point is to exercise the REAL in-JS gating/filtering
// logic, not SQL composition.
// ---------------------------------------------------------------------------
function fakeDb({ jobs = [], transports = [] }: { jobs?: any[], transports?: any[] } = {}) {
  const updates: Array<{ table: any, set: any }> = []
  const inserted: any[] = []
  const rowsFor = (t: any) => (t === printJobs ? jobs : t === printTransports ? transports : [])
  const selectable = (rows: any[]): any => ({
    where: () => selectable(rows),
    limit: () => selectable(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej)
  })
  return {
    updates,
    inserted,
    select: () => ({ from: (t: any) => selectable(rowsFor(t)) }),
    update: (t: any) => ({
      set: (set: any) => ({
        where: () => {
          updates.push({ table: t, set })
          return {
            returning: () => Promise.resolve([{ id: 'x', source: 'sales', refType: null, refId: null, teamId: null, eventId: null }]),
            then: (res: any, rej: any) => Promise.resolve(undefined).then(res, rej)
          }
        }
      })
    }),
    insert: (t: any) => ({
      values: (v: any) => ({
        onConflictDoUpdate: async (_conf: any) => { inserted.push({ table: t, values: v }) }
      })
    })
  }
}

const jobUpdates = (db: any) => db.updates.filter((u: any) => u.table === printJobs)
const transportUpdates = (db: any) => db.updates.filter((u: any) => u.table === printTransports)

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------
describe('transportAllows', () => {
  it('no row resolves to the default (router-spooler) — the choice is always exclusive', () => {
    expect(DEFAULT_PRINT_TRANSPORT).toBe('router-spooler')
    expect(transportAllows(undefined, PRINT_TRANSPORT.ROUTER_SPOOLER)).toBe(true)
    expect(transportAllows(undefined, PRINT_TRANSPORT.LOCAL_DRAINER)).toBe(false)
    expect(transportAllows(null, PRINT_TRANSPORT.LOCAL_DRAINER)).toBe(false)
  })

  it('local-drainer row: drainer yes, spooler no', () => {
    expect(transportAllows('local-drainer', PRINT_TRANSPORT.LOCAL_DRAINER)).toBe(true)
    expect(transportAllows('local-drainer', PRINT_TRANSPORT.ROUTER_SPOOLER)).toBe(false)
  })

  it('router-spooler row: spooler yes, drainer no', () => {
    expect(transportAllows('router-spooler', PRINT_TRANSPORT.ROUTER_SPOOLER)).toBe(true)
    expect(transportAllows('router-spooler', PRINT_TRANSPORT.LOCAL_DRAINER)).toBe(false)
  })

  it('none: nobody delivers — jobs stay pending', () => {
    expect(transportAllows('none', PRINT_TRANSPORT.LOCAL_DRAINER)).toBe(false)
    expect(transportAllows('none', PRINT_TRANSPORT.ROUTER_SPOOLER)).toBe(false)
  })

  it('isPrintTransport validates the PUT payload', () => {
    expect(isPrintTransport('local-drainer')).toBe(true)
    expect(isPrintTransport('router-spooler')).toBe(true)
    expect(isPrintTransport('none')).toBe(true)
    expect(isPrintTransport('browser-print')).toBe(false)
    expect(isPrintTransport('')).toBe(false)
    expect(isPrintTransport(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Liveness heartbeat throttle
// ---------------------------------------------------------------------------
describe('shouldStampHeartbeat', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')

  it('stamps when never stamped', () => {
    expect(shouldStampHeartbeat(null, now)).toBe(true)
    expect(shouldStampHeartbeat(undefined, now)).toBe(true)
  })

  it('skips a fresh stamp (< 30s old)', () => {
    expect(shouldStampHeartbeat('2026-07-10T11:59:55.000Z', now)).toBe(false)
  })

  it('stamps a stale one (>= 30s old)', () => {
    expect(shouldStampHeartbeat('2026-07-10T11:59:30.000Z', now)).toBe(true)
    expect(shouldStampHeartbeat('2026-07-10T11:00:00.000Z', now)).toBe(true)
  })

  it('stamps over an unparseable value', () => {
    expect(shouldStampHeartbeat('not-a-date', now)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Drainer respects the per-event transport rows
// ---------------------------------------------------------------------------
describe('drainPendingEscposJobs transport gating', () => {
  // Jobs deliberately carry no printerIp: the drain loop then fails them fast
  // (failPrintJob) without touching the network, and each processed job leaves
  // a status-'9' update we can count.
  const job = (id: string, eventId: string | null) => ({ id, payload: 'QQ==', printerIp: null, printerPort: 9100, eventId })

  it('drains local-drainer events and event-less jobs; skips router-spooler, none, and unset (default)', async () => {
    const db = fakeDb({
      jobs: [job('j1', 'e-spooler'), job('j2', 'e-drainer'), job('j3', 'e-unset'), job('j4', 'e-none'), job('j5', null)],
      transports: [
        { eventId: 'e-spooler', transport: 'router-spooler', lastDrainerTickAt: null },
        { eventId: 'e-drainer', transport: 'local-drainer', lastDrainerTickAt: new Date().toISOString() },
        { eventId: 'e-none', transport: 'none', lastDrainerTickAt: null }
      ]
    })
    const { processed } = await drainPendingEscposJobs(db as any)
    // j2 (explicit local-drainer) + j5 (event-less: only the drainer can ever
    // deliver those — the spooler endpoint is per-event). j3's unset event
    // defaults to router-spooler, so it is NOT drained.
    expect(processed).toBe(2)
    const fails = jobUpdates(db).filter(u => u.set.status === '9')
    expect(fails).toHaveLength(2)
  })

  it('processes nothing when every event routes elsewhere — and never claims', async () => {
    const db = fakeDb({
      jobs: [job('j1', 'e1'), job('j2', 'e2'), job('j3', 'e-unset')],
      transports: [
        { eventId: 'e1', transport: 'router-spooler', lastDrainerTickAt: null },
        { eventId: 'e2', transport: 'none', lastDrainerTickAt: null }
      ]
    })
    const { processed } = await drainPendingEscposJobs(db as any)
    expect(processed).toBe(0)
    expect(jobUpdates(db)).toHaveLength(0)
  })

  it('stamps lastDrainerTickAt on stale local-drainer rows, even with zero jobs', async () => {
    const db = fakeDb({
      jobs: [],
      transports: [
        { eventId: 'e-stale', transport: 'local-drainer', lastDrainerTickAt: null },
        { eventId: 'e-fresh', transport: 'local-drainer', lastDrainerTickAt: new Date().toISOString() },
        { eventId: 'e-other', transport: 'router-spooler', lastDrainerTickAt: null }
      ]
    })
    await drainPendingEscposJobs(db as any)
    const stamps = transportUpdates(db)
    expect(stamps).toHaveLength(1) // only the stale local-drainer row
    expect(stamps[0].set.lastDrainerTickAt).toBeTruthy()
  })

  it('does not stamp when all local-drainer heartbeats are fresh', async () => {
    const db = fakeDb({
      jobs: [],
      transports: [{ eventId: 'e1', transport: 'local-drainer', lastDrainerTickAt: new Date().toISOString() }]
    })
    await drainPendingEscposJobs(db as any)
    expect(transportUpdates(db)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Settings upsert
// ---------------------------------------------------------------------------
describe('upsertPrintTransport', () => {
  it('upserts eventId + transport (+ optional teamId) into print_transports', async () => {
    const db = fakeDb()
    await upsertPrintTransport(db as any, { eventId: 'e1', transport: 'local-drainer', teamId: 't1' })
    expect(db.inserted).toHaveLength(1)
    expect(db.inserted[0].table).toBe(printTransports)
    expect(db.inserted[0].values).toMatchObject({ eventId: 'e1', transport: 'local-drainer', teamId: 't1' })
  })

  it('rejects an invalid transport value', async () => {
    const db = fakeDb()
    await expect(upsertPrintTransport(db as any, { eventId: 'e1', transport: 'carrier-pigeon' as any })).rejects.toThrow()
    expect(db.inserted).toHaveLength(0)
  })
})
