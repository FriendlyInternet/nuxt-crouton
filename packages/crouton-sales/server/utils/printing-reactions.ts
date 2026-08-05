/**
 * @crouton-package crouton-sales
 * @description Sales domain reactions to the generic printing lifecycle (#329).
 *
 * crouton-printing owns the generic `print_jobs` queue and emits
 * `printing:job:{created,completed,failed}` hooks (db rides each payload); it
 * knows nothing about orders. These pure functions are sales' reaction to those
 * hooks — they replicate the behaviour that used to live in the deleted
 * `print-job-complete.ts` + the thermal spooler callbacks:
 *
 *  - created   → mirror the new job to the cloud-sync outbox (printstatus row,
 *                minus the bulky base64 payload)
 *  - completed → mirror the status transition + auto-complete the order once
 *                none of its jobs remain in a non-completed state (a failed
 *                ticket keeps the order open until reprinted)
 *  - failed    → mirror the status transition + flag the order `print_failed`
 *                (unless already completed/cancelled)
 *
 * They're extracted as pure functions (deps injected) so they're unit-testable
 * without a Nitro app; the plugin (`server/plugins/printing-subscriber.ts`)
 * wires them to the hooks and the real deps. Every reaction is best-effort —
 * the plugin logs+swallows, so a sales reaction can never fail a print
 * transition (crouton-printing has already committed the print_jobs row).
 *
 * Status values are the generic print_jobs TEXT codes ('2'=done, '9'=failed).
 */
import { and, count, eq, ne, notInArray } from 'drizzle-orm'
import type { OutboxEvent } from './sync-outbox'
import { SALES_PRINT_STATUS } from '../../shared/utils/print-status'

const STATUS_COMPLETED = SALES_PRINT_STATUS.COMPLETED
const STATUS_FAILED = SALES_PRINT_STATUS.FAILED

/** The shape the lazy orders-schema loader must resolve (the generated layer). */
export interface OrdersSchema {
  salesOrders: any
}

/** Dependencies injected into each reaction so they stay pure + testable. */
export interface PrintingReactionDeps {
  recordOutboxEvents: (db: any, events: OutboxEvent[]) => Promise<void>
  isCloudSyncEnabled: () => boolean
  loadOrdersSchema: () => Promise<OrdersSchema>
  /** The generic crouton-printing `print_jobs` drizzle table. */
  printJobs: any
}

/** The full `print_jobs` row carried on `printing:job:created`. */
export interface CreatedJob {
  id: string
  source: string
  refType: string | null
  refId: string | null
  teamId: string | null
  eventId: string | null
  status: string
  payload: string
  [key: string]: unknown
}

/** The terminal outcome carried on `printing:job:{completed,failed}`. */
export interface JobOutcome {
  id: string
  source: string
  refType: string | null
  refId: string | null
  teamId: string | null
  eventId: string | null
  status: string
  errorMessage?: string
}

/**
 * Build the `printstatus` cloud-sync outbox event for one job's status
 * transition (#176). `statusPayload` carries the transition-specific fields
 * (status + completedAt | errorMessage + updatedAt); `id` is always the job id.
 */
function mirrorTransition(
  outcome: JobOutcome,
  orderId: string | null,
  statusPayload: Record<string, unknown>
): OutboxEvent {
  return {
    entityType: 'printstatus',
    entityId: outcome.id,
    orderId,
    teamId: outcome.teamId ?? null,
    eventId: outcome.eventId ?? null,
    payload: { id: outcome.id, ...statusPayload }
  }
}

/**
 * `printing:job:created` — mirror the new job to the cloud-sync outbox so the
 * D1 mirror sees pending jobs (#176). Drops the bulky base64 `payload` (the
 * cloud shows status, it never prints), mirroring the old generate-print-queues
 * behaviour. No-op unless cloud sync is on.
 */
export async function onJobCreated(db: any, job: CreatedJob, deps: PrintingReactionDeps): Promise<void> {
  if (!deps.isCloudSyncEnabled()) return

  // Mirror the new job, blanking the bulky base64 `payload` — the cloud shows
  // status, it never prints (keeps events kilobytes, #176). `payload: ''` (not
  // dropped) because the mirror target print_jobs.payload is NOT NULL.
  const mirror = { ...job, payload: '' }
  await deps.recordOutboxEvents(db, [{
    entityType: 'printstatus',
    entityId: job.id,
    orderId: job.refType === 'order' ? job.refId : null,
    teamId: job.teamId ?? null,
    eventId: job.eventId ?? null,
    payload: mirror
  }])
}

/**
 * `printing:job:completed` — mirror the status transition and auto-complete the
 * order once none of its print_jobs remain in a non-completed state. Only acts
 * on order-backed jobs (`refType === 'order'`); a failed ticket keeps the order
 * out of 'completed' until it's reprinted.
 */
export async function onJobCompleted(db: any, outcome: JobOutcome, deps: PrintingReactionDeps): Promise<void> {
  const isOrder = outcome.refType === 'order'
  const orderId = isOrder ? outcome.refId : null

  let orderCompleted = false
  if (orderId) {
    const { salesOrders } = await deps.loadOrdersSchema()
    const now = new Date()

    const [remaining] = await db
      .select({ n: count() })
      .from(deps.printJobs)
      .where(and(
        eq(deps.printJobs.refType, 'order'),
        eq(deps.printJobs.refId, orderId),
        ne(deps.printJobs.status, STATUS_COMPLETED)
      ))

    if (!remaining || remaining.n === 0) {
      await db
        .update(salesOrders)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(salesOrders.id, orderId))
      orderCompleted = true
    }

    // Mirror the print-status transition (#176): the job → done, plus the order
    // row when it auto-completed. Guarded so disabled processes pay nothing.
    if (deps.isCloudSyncEnabled()) {
      const events: OutboxEvent[] = [
        mirrorTransition(outcome, orderId, { status: STATUS_COMPLETED, completedAt: now.toISOString(), updatedAt: now })
      ]
      if (orderCompleted) {
        const [orderRow] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1)
        if (orderRow) {
          events.push({ entityType: 'order', entityId: orderId, orderId, teamId: orderRow.teamId, eventId: orderRow.eventId, payload: orderRow })
        }
      }
      await deps.recordOutboxEvents(db, events)
    }
    return
  }

  // Tab-level / non-order job (e.g. end-of-tab receipt): no order to complete,
  // but still mirror the status transition for the cloud.
  if (deps.isCloudSyncEnabled()) {
    const now = new Date()
    await deps.recordOutboxEvents(db, [
      mirrorTransition(outcome, null, { status: STATUS_COMPLETED, completedAt: now.toISOString(), updatedAt: now })
    ])
  }
}

/**
 * `printing:job:failed` — mirror the status transition and flag the order
 * `print_failed` (unless already completed/cancelled), so the orders list
 * surfaces the printer problem.
 */
export async function onJobFailed(db: any, outcome: JobOutcome, deps: PrintingReactionDeps): Promise<void> {
  const isOrder = outcome.refType === 'order'
  const orderId = isOrder ? outcome.refId : null
  const errorMessage = outcome.errorMessage ?? 'Print job failed'

  if (orderId) {
    const { salesOrders } = await deps.loadOrdersSchema()
    const now = new Date()

    await db
      .update(salesOrders)
      .set({ status: 'print_failed', updatedAt: now })
      .where(and(
        eq(salesOrders.id, orderId),
        notInArray(salesOrders.status, ['completed', 'cancelled'])
      ))

    // Mirror the print-status transition (#176): the job → failed, plus the
    // current order row (its status may have flipped to print_failed).
    if (deps.isCloudSyncEnabled()) {
      const events: OutboxEvent[] = [
        mirrorTransition(outcome, orderId, { status: STATUS_FAILED, errorMessage, updatedAt: now })
      ]
      const [orderRow] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1)
      if (orderRow) {
        events.push({ entityType: 'order', entityId: orderId, orderId, teamId: orderRow.teamId, eventId: orderRow.eventId, payload: orderRow })
      }
      await deps.recordOutboxEvents(db, events)
    }
    return
  }

  // Non-order job: still mirror the status transition.
  if (deps.isCloudSyncEnabled()) {
    const now = new Date()
    await deps.recordOutboxEvents(db, [
      mirrorTransition(outcome, null, { status: STATUS_FAILED, errorMessage, updatedAt: now })
    ])
  }
}
