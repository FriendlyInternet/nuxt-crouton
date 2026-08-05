import { describe, it, expect } from 'vitest'
import { planRequeue } from '../server/utils/plan-requeue'

/**
 * The pure "which jobs does a requeue touch?" decision behind the team-authed
 * `printqueues/retry-failed` endpoint (#1517). It generalises the endpoint so
 * one route serves two callers:
 *
 *  - the per-line failed-job retry in the Printers tab (existing behaviour), and
 *  - the new whole-order **Reprint** button — reset the order's *existing*
 *    print_jobs from a terminal status (2 done / 9 failed) back to 0 pending so
 *    the transport re-drains them, reusing the stored ESC/POS payload. No new
 *    jobs, no forced receipt.
 *
 * planRequeue never touches jobs already pending (0) or actively printing (1) —
 * resetting those would be pointless or destructive. The endpoint translates the
 * returned plan into drizzle conditions; this contract is about the DECISION.
 */
describe('planRequeue', () => {
  it('whole-order reprint resets the order\'s completed AND failed jobs', () => {
    const plan = planRequeue({ orderId: 'order-1' })
    expect(plan.scope).toBe('order')
    expect(plan.orderId).toBe('order-1')
    // Reprints exactly what the order produced: done (2) + failed (9) tickets.
    expect([...plan.resetStatuses].sort()).toEqual(['2', '9'])
    // A deliberate whole-order reprint does not sweep in stale "printing" jobs.
    expect(plan.includeStalePrinting).toBe(false)
  })

  it('whole-order reprint ignores jobId/printerId narrowing — it is the WHOLE order', () => {
    const plan = planRequeue({ orderId: 'order-1', jobId: 'job-9', printerId: 'printer-1' })
    expect(plan.scope).toBe('order')
    expect(plan.jobId).toBeUndefined()
    expect(plan.printerId).toBeUndefined()
  })

  it('failed-retry (no orderId) resets only failed jobs plus stale printing', () => {
    const plan = planRequeue({})
    expect(plan.scope).toBe('event')
    expect(plan.resetStatuses).toEqual(['9'])
    expect(plan.includeStalePrinting).toBe(true)
  })

  it('single-job retry passes the jobId through in event scope', () => {
    const plan = planRequeue({ jobId: 'job-1' })
    expect(plan.scope).toBe('event')
    expect(plan.jobId).toBe('job-1')
    expect(plan.orderId).toBeUndefined()
  })

  it('printer-scoped retry passes the printerId through in event scope', () => {
    const plan = planRequeue({ printerId: 'printer-1' })
    expect(plan.scope).toBe('event')
    expect(plan.printerId).toBe('printer-1')
  })

  it('never resets pending or actively-printing jobs (no 0 or 1 in resetStatuses)', () => {
    for (const body of [{ orderId: 'o' }, {}, { jobId: 'j' }, { printerId: 'p' }]) {
      const { resetStatuses } = planRequeue(body)
      expect(resetStatuses).not.toContain('0')
      expect(resetStatuses).not.toContain('1')
    }
  })

  it('tolerates a null body (failed body parse) as an event-scope failed retry', () => {
    const plan = planRequeue(null)
    expect(plan.scope).toBe('event')
    expect(plan.resetStatuses).toEqual(['9'])
    expect(plan.includeStalePrinting).toBe(true)
  })
})
