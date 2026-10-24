import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * D1 refuses a query carrying more than 100 BOUND PARAMETERS
 * (https://developers.cloudflare.com/d1/platform/limits/), and a multi-row INSERT binds one
 * per column per row. `enqueuePrintJobs` wrote an order's whole ticket batch in one
 * statement, so a big enough order failed to enqueue ANY ticket — on the checkout path,
 * mid-service, where the only symptom is "nothing printed" (#1710).
 *
 * THE SUBTLE PART, and why these cases count parameters rather than rows: drizzle also binds
 * the table's `$default` columns that the row object does NOT contain. `buildRow` returns 16
 * keys, but `printJobs` adds `createdAt` + `updatedAt` — 18 real parameters per row. A chunk
 * size derived from `Object.keys(row).length` would allow 6 rows (96 by its own count, 108 in
 * reality) and still blow the cap. So the ceiling must be computed from the TRUE column count.
 */

const { hookCalls } = vi.hoisted(() => ({ hookCalls: [] as Array<{ name: string, payload: any }> }))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({
    hooks: { callHook: async (name: string, payload: any) => { hookCalls.push({ name, payload }) } }
  })
}))

/** Records each insert().values() call separately, so we can size every statement. */
function fakeDb() {
  const batches: any[][] = []
  return {
    batches,
    get inserted() { return this.batches.flat() },
    insert: () => ({
      values: async (v: any) => { batches.push(Array.isArray(v) ? v : [v]) }
    })
  }
}

/** The real per-row cost: 16 keys from buildRow + createdAt/updatedAt that drizzle binds. */
const DRIZZLE_ADDED_COLUMNS = 2
const boundParams = (batch: any[]) =>
  batch.length * (Object.keys(batch[0] ?? {}).length + DRIZZLE_ADDED_COLUMNS)

const ticket = (n: number) => ({
  source: 'sales',
  printerId: `printer-${n}`,
  printerIp: `192.168.1.${70 + n}`,
  printerPort: 9100,
  printerTitle: `Station ${n}`,
  driver: 'network-escpos',
  payload: `TICKET-${n}`,
  printMode: 'normal',
  locationId: `loc-${n}`,
  refType: 'order',
  refId: 'order-1',
  eventId: 'evt-1',
  teamId: 'team-1'
})
const order = (n: number) => Array.from({ length: n }, (_, i) => ticket(i))

describe('enqueuePrintJobs — D1 bound-parameter cap (#1710)', () => {
  beforeEach(() => { hookCalls.length = 0 })

  it('keeps every statement under the cap for an 8-station order', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()

    await enqueuePrintJobs(db, order(8))

    // Guard: one statement really would have blown it (8 × 18 = 144).
    expect(8 * (16 + DRIZZLE_ADDED_COLUMNS)).toBeGreaterThan(100)
    expect(db.batches.length).toBeGreaterThan(0)
    for (const batch of db.batches) expect(boundParams(batch)).toBeLessThanOrEqual(100)
  })

  it('still enqueues every ticket, and returns ids in input order', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()

    const ids = await enqueuePrintJobs(db, order(8))

    expect(db.inserted).toHaveLength(8)
    expect(ids).toHaveLength(8)
    expect(db.inserted.map((r: any) => r.id)).toEqual(ids)
    expect(db.inserted.map((r: any) => r.payload))
      .toEqual(['TICKET-0', 'TICKET-1', 'TICKET-2', 'TICKET-3', 'TICKET-4', 'TICKET-5', 'TICKET-6', 'TICKET-7'])
  })

  it('does NOT split an order that already fits — the #1539 single-insert contract holds where physics allows', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()

    await enqueuePrintJobs(db, order(5)) // 5 × 18 = 90, under the cap

    expect(db.batches).toHaveLength(1)
  })

  it('fires one printing:job:created per job across the split', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()

    await enqueuePrintJobs(db, order(8))

    // The cloud-sync outbox mirror and order-status tracking depend on per-job
    // hooks (#1539) — chunking may change the timing, never the count.
    const created = hookCalls.filter(h => h.name === 'printing:job:created')
    expect(created).toHaveLength(8)
  })
})
