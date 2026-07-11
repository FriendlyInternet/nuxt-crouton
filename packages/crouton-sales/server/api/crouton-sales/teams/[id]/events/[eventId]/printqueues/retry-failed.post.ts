/**
 * Requeue print jobs so the transport picks them up again on its next drain.
 * Reads/writes the generic crouton-printing `print_jobs` queue (epic #325)
 * filtered to this team's sales jobs. Two callers, one route (#1517):
 *
 * - **Failed/stale retry** (no `orderId`) — used after a printer recovers
 *   (paper reloaded, cover closed, back online). Requeues failed jobs (status
 *   9) and jobs stuck at "printing" (status 1) for over 2 minutes — the
 *   transport fetched them (which flips the status) but its completion callback
 *   never landed (crash, network drop, truncated poll response). Optionally
 *   narrowed to one printer or one job.
 * - **Whole-order reprint** (`{ orderId }`) — the Reprint button on the
 *   expanded order. Resets the order's *existing* jobs from a terminal status
 *   (2 done / 9 failed) back to 0 pending so they re-drain and reprint,
 *   reusing the stored ESC/POS payload. No new jobs, no forced receipt.
 *
 * `planRequeue` (server/utils) owns the branch decision; this handler
 * translates the plan into drizzle conditions.
 */
import { eq, and, or, lt, inArray } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { planRequeue, type RequeueRequest } from '../../../../../../../utils/plan-requeue'

const STATUS_PENDING = '0'
const STATUS_PRINTING = '1'
const STALE_PRINTING_MS = 2 * 60 * 1000

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')

  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const body = await readBody<RequeueRequest>(event).catch(() => null)
  const plan = planRequeue(body)

  const conditions = [
    eq(printJobs.teamId, team.id),
    eq(printJobs.eventId, eventId),
    eq(printJobs.source, 'sales'),
  ]

  if (plan.scope === 'order') {
    // Whole-order reprint: the order's own jobs (refType='order'/refId=orderId),
    // limited to terminal statuses so pending/printing jobs are left alone.
    conditions.push(
      eq(printJobs.refType, 'order'),
      eq(printJobs.refId, plan.orderId!),
      inArray(printJobs.status, plan.resetStatuses)
    )
  }
  else {
    // Failed/stale retry sweep. Stale-printing jobs join the failed set via OR.
    const staleBefore = new Date(Date.now() - STALE_PRINTING_MS)
    conditions.push(
      or(
        inArray(printJobs.status, plan.resetStatuses),
        and(
          eq(printJobs.status, STATUS_PRINTING),
          lt(printJobs.updatedAt, staleBefore)
        )
      )!
    )
    if (plan.printerId) {
      conditions.push(eq(printJobs.printerId, plan.printerId))
    }
    // Single-job retry (the per-line button in the expanded order).
    if (plan.jobId) {
      conditions.push(eq(printJobs.id, plan.jobId))
    }
  }

  const db = useDB()

  const requeued = await db
    .update(printJobs)
    .set({ status: STATUS_PENDING, errorMessage: null, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: printJobs.id })

  return { success: true, requeued: requeued.length }
})
