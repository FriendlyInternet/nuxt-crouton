import { describe, it, expect, beforeEach, vi } from 'vitest'

// Lock the batch-enqueue contract that enables parallel printing (#1539):
// an order's N tickets must go in as ONE insert (so they become `pending`
// together and one poll hands the fan-out the whole order), while STILL firing
// one `printing:job:created` hook per job (the sales cloud-sync outbox mirror
// and order-status tracking depend on per-job hooks — only the timing changed).
const { hookCalls } = vi.hoisted(() => ({ hookCalls: [] as Array<{ name: string, payload: any }> }))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({
    hooks: { callHook: async (name: string, payload: any) => { hookCalls.push({ name, payload }) } }
  })
}))

// Fake drizzle db that records each insert().values() call separately, so we
// can assert the batch went in as a SINGLE insert of N rows (not N inserts).
function fakeDb() {
  const batches: any[] = []
  const inserted: any[] = []
  return {
    batches,
    inserted,
    insert: () => ({
      values: async (v: any) => { batches.push(v); inserted.push(...(Array.isArray(v) ? v : [v])) }
    })
  }
}

// The three per-printer kitchen tickets of one order (the shape
// generate-print-queues.ts hands enqueuePrintJobs — same denormalized fields).
function orderInputs() {
  return [
    { source: 'sales', printerId: 'bar', printerIp: '192.168.1.72', printerPort: 9100, printerTitle: 'Bar', driver: 'network-escpos', payload: 'AAAA', printMode: 'normal', locationId: 'loc-bar', refType: 'order', refId: 'order-1', eventId: 'evt-1', teamId: 'team-1' },
    { source: 'sales', printerId: 'keuken', printerIp: '192.168.1.70', printerPort: 9100, printerTitle: 'Keuken', driver: 'network-escpos', payload: 'BBBB', printMode: 'normal', locationId: 'loc-keuken', refType: 'order', refId: 'order-1', eventId: 'evt-1', teamId: 'team-1' },
    { source: 'sales', printerId: 'kassa', printerIp: '192.168.1.73', printerPort: 9100, printerTitle: 'Kassa', driver: 'network-escpos', payload: 'CCCC', printMode: 'normal', locationId: 'loc-kassa', refType: 'order', refId: 'order-1', eventId: 'evt-1', teamId: 'team-1' }
  ]
}

describe('enqueuePrintJobs — batch contract (#1539)', () => {
  beforeEach(() => { hookCalls.length = 0 })

  it("inserts an order's N tickets in a SINGLE batch insert", async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()
    const inputs = orderInputs()

    const ids = await enqueuePrintJobs(db, inputs)

    // One insert call, carrying all N rows as an array (the timing property).
    expect(db.batches).toHaveLength(1)
    expect(Array.isArray(db.batches[0])).toBe(true)
    expect(db.batches[0]).toHaveLength(inputs.length)
    // Ids returned in input order; rows preserve per-ticket payload order.
    expect(db.inserted.map((r: any) => r.id)).toEqual(ids)
    expect(db.inserted.map((r: any) => r.payload)).toEqual(['AAAA', 'BBBB', 'CCCC'])
  })

  it('fires ONE printing:job:created hook per job, with the right fields', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()
    const inputs = orderInputs()

    const ids = await enqueuePrintJobs(db, inputs)

    // Exactly N hooks — never one hook for the whole batch.
    const created = hookCalls.filter(h => h.name === 'printing:job:created')
    expect(created).toHaveLength(inputs.length)
    // Each hook carries the shared db handle + its own job row (correct fields).
    created.forEach((h, i) => {
      expect(h.payload.db).toBe(db)
      expect(h.payload.job.id).toBe(ids[i])
      expect(h.payload.job).toMatchObject({
        source: 'sales',
        refType: 'order',
        refId: 'order-1',
        eventId: 'evt-1',
        teamId: 'team-1',
        driver: 'network-escpos',
        printerId: inputs[i].printerId,
        printerIp: inputs[i].printerIp,
        printerTitle: inputs[i].printerTitle,
        payload: inputs[i].payload,
        status: '0' // PENDING — all become pending together
      })
    })
  })

  it('an empty order enqueues nothing and fires no hook', async () => {
    const { enqueuePrintJobs } = await import('../server/utils/print-job-queue')
    const db = fakeDb()
    expect(await enqueuePrintJobs(db, [])).toEqual([])
    expect(db.batches).toHaveLength(0)
    expect(hookCalls).toHaveLength(0)
  })
})
