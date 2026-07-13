import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { enqueuePrintJobs } from '../server/utils/print-job-queue'
import { listTeamSpoolerJobs } from '../server/utils/spooler-device'
import { printJobs, printTransports } from '../server/database/schema'
// Uses a real better-sqlite3 DB (native bindings); the CI Test Suite container
// doesn't build them, so run this as LOCAL proof only. Batch behaviour is also
// covered in CI by enqueue-batch-contract.test.ts.
const CI_SKIP = !!process.env.CI

// Reproduce the REAL app→poll chain for a multi-station order, no hardware
// (#1539). enqueuePrintJobs is exactly what generateAndInsertPrintQueues now
// calls; listTeamSpoolerJobs is exactly what /api/print-server/jobs (the router
// spooler poll) calls. Real in-memory sqlite via drizzle — the same query
// builder the app uses.

const DDL = `
CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'sales', printer_id TEXT NOT NULL,
  printer_ip TEXT, printer_port INTEGER NOT NULL DEFAULT 9100, printer_title TEXT,
  location_id TEXT, team_id TEXT, event_id TEXT, ref_type TEXT, ref_id TEXT,
  driver TEXT NOT NULL DEFAULT 'network-escpos', status TEXT NOT NULL DEFAULT '0',
  payload TEXT NOT NULL, print_mode TEXT NOT NULL DEFAULT 'normal', error_message TEXT,
  retry_count TEXT NOT NULL DEFAULT '0', completed_at TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE print_transports (
  event_id TEXT PRIMARY KEY, team_id TEXT, transport TEXT NOT NULL DEFAULT 'router-spooler',
  last_spooler_poll_at TEXT, last_drainer_tick_at TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`

const TEAM = 'team-1'
const EVENT = 'evt-1'

// The 3 per-station kitchen tickets of ONE order → 3 distinct printer IPs.
function orderInputs() {
  return ['192.168.1.70', '192.168.1.72', '192.168.1.73'].map((ip, i) => ({
    source: 'sales',
    printerId: `p${i}`,
    printerIp: ip,
    printerPort: 9100,
    printerTitle: `Station ${i}`,
    driver: 'network-escpos',
    payload: `TICKET-${i}`,
    printMode: 'normal',
    locationId: `loc-${i}`,
    refType: 'order',
    refId: 'order-1',
    eventId: EVENT,
    teamId: TEAM
  }))
}

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(DDL)
  return drizzle(sqlite, { schema: { printJobs, printTransports } })
}

describe.skipIf(CI_SKIP)('app→poll chain — one order → one poll returns ALL tickets (#1539)', () => {
  let db: any
  beforeEach(() => { db = makeDb() })

  it('enqueues the order atomically: 3 rows, effectively-identical createdAt', async () => {
    await enqueuePrintJobs(db, orderInputs())
    const rows = await db.select().from(printJobs)
    expect(rows).toHaveLength(3)
    const stamps = rows.map((r: any) => new Date(r.createdAt).getTime())
    expect(Math.max(...stamps) - Math.min(...stamps)).toBeLessThanOrEqual(50)
    expect(rows.every((r: any) => r.status === '0')).toBe(true) // all PENDING together
  })

  it('a SINGLE spooler poll returns ALL 3 tickets and claims them (mark_as_printing)', async () => {
    await enqueuePrintJobs(db, orderInputs())

    // The exact call the router spooler makes, with the claim/flip behaviour.
    const served = await listTeamSpoolerJobs(db, TEAM, true)

    expect(served).toHaveLength(3) // ← the whole order in one poll, not one-per-poll
    expect(served.map((j: any) => j.printerIp).sort())
      .toEqual(['192.168.1.70', '192.168.1.72', '192.168.1.73'])

    // Claimed atomically → a second poll returns nothing (no re-delivery).
    const second = await listTeamSpoolerJobs(db, TEAM, true)
    expect(second).toHaveLength(0)

    // All flipped pending → printing.
    const printing = (await db.select().from(printJobs)).filter((r: any) => r.status === '1')
    expect(printing).toHaveLength(3)
  })
})
