/**
 * The pure "which jobs does a requeue touch?" decision behind the team-authed
 * `printqueues/retry-failed` endpoint (#1517). One route serves two callers:
 *
 *  - the per-line failed-job retry in the Printers tab (existing behaviour), and
 *  - the whole-order **Reprint** button — reset the order's *existing* print_jobs
 *    from a terminal status (2 done / 9 failed) back to 0 pending so the transport
 *    re-drains them, reusing the stored ESC/POS payload. No new jobs, no forced
 *    receipt.
 *
 * This module only makes the DECISION; the endpoint translates the returned plan
 * into drizzle conditions. Keeping it pure makes the branch logic unit-testable
 * without a Nitro/DB context (see test/plan-requeue.test.ts).
 */

// print_jobs.status enum (text, matching the on-site spooler contract):
// '0'=pending | '1'=printing | '2'=done | '9'=error.
const STATUS_DONE = '2'
const STATUS_FAILED = '9'

export interface RequeueRequest {
  /** Narrow the failed-retry to one printer (event scope only). */
  printerId?: string
  /** Requeue a single job by id — the per-line reprint (event scope only). */
  jobId?: string
  /** Reprint a WHOLE order: reset all its terminal jobs. Takes precedence. */
  orderId?: string
}

export interface RequeuePlan {
  /**
   * 'order' — a deliberate whole-order reprint (all the order's done+failed jobs).
   * 'event' — the failed/stale retry sweep (one job, one printer, or the lot).
   */
  scope: 'order' | 'event'
  /** Statuses eligible to be reset to pending '0'. Never includes '0' or '1'. */
  resetStatuses: string[]
  /** Also requeue jobs stuck at 'printing' (status 1) past the stale threshold. */
  includeStalePrinting: boolean
  /** Set only in 'order' scope — the order whose jobs are reprinted. */
  orderId?: string
  /** Passed through only in 'event' scope. */
  jobId?: string
  /** Passed through only in 'event' scope. */
  printerId?: string
}

/**
 * Decide which jobs a requeue request touches.
 *
 * A whole-order reprint (`orderId` present) wins over the per-job/per-printer
 * narrowing: it resets the order's done AND failed tickets, so tapping Reprint
 * re-fires exactly what the order first produced. Everything else is the
 * existing failed-retry sweep (failed jobs + stale printing), optionally
 * narrowed to one job or printer. A null body (failed parse) degrades to the
 * event-scope failed retry.
 */
export function planRequeue(body: RequeueRequest | null | undefined): RequeuePlan {
  if (body?.orderId) {
    return {
      scope: 'order',
      // Reprint what the order produced: both completed and failed tickets.
      resetStatuses: [STATUS_DONE, STATUS_FAILED],
      // A deliberate whole-order reprint does not sweep in stale printing jobs.
      includeStalePrinting: false,
      orderId: body.orderId,
    }
  }

  return {
    scope: 'event',
    resetStatuses: [STATUS_FAILED],
    includeStalePrinting: true,
    jobId: body?.jobId,
    printerId: body?.printerId,
  }
}
