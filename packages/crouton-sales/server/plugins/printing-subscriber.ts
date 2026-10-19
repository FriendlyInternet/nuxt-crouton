/**
 * @crouton-package crouton-sales
 * @description Subscribe sales to the generic printing lifecycle hooks (#329).
 *
 * crouton-printing emits `printing:job:{created,completed,failed}` (db rides
 * each payload) and never imports a domain. This Nitro plugin is sales' side of
 * that contract: it wires the three pure reactions in
 * `server/utils/printing-reactions.ts` to those hooks, filtering to
 * `source === 'sales'` so a shared queue (sales + bookings, …) only triggers
 * the right domain.
 *
 * The reactions are the order-completion + cloud-sync-outbox logic that used to
 * live in the deleted `print-job-complete.ts` and the thermal spooler callbacks
 * — now driven off the generic queue instead. The generic `print_jobs` table is
 * imported from crouton-printing; `salesOrders` (this package's
 * `collections/orders`) is loaded lazily.
 *
 * Every handler is best-effort: it logs and swallows so a sales reaction can
 * never fail a print transition (crouton-printing has already committed the
 * print_jobs row before the hook fires).
 */
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { isCloudSyncEnabled, recordOutboxEvents } from '../utils/sync-outbox'
import {
  onJobCompleted,
  onJobCreated,
  onJobFailed,
  type CreatedJob,
  type JobOutcome,
  type PrintingReactionDeps
} from '../utils/printing-reactions'

const loadOrdersSchema = () =>
  import('../../collections/orders/server/database/schema')

const deps: PrintingReactionDeps = {
  recordOutboxEvents,
  isCloudSyncEnabled,
  loadOrdersSchema,
  printJobs
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('printing:job:created', async (payload: { db: any, job: CreatedJob }) => {
    if (payload?.job?.source !== 'sales') return
    try {
      await onJobCreated(payload.db, payload.job, deps)
    }
    catch (err) {
      console.error('[crouton-sales] printing:job:created reaction failed:', err)
    }
  })

  nitroApp.hooks.hook('printing:job:completed', async (payload: { db: any } & JobOutcome) => {
    if (payload?.source !== 'sales') return
    try {
      const { db, ...outcome } = payload
      await onJobCompleted(db, outcome, deps)
    }
    catch (err) {
      console.error('[crouton-sales] printing:job:completed reaction failed:', err)
    }
  })

  nitroApp.hooks.hook('printing:job:failed', async (payload: { db: any } & JobOutcome) => {
    if (payload?.source !== 'sales') return
    try {
      const { db, ...outcome } = payload
      await onJobFailed(db, outcome, deps)
    }
    catch (err) {
      console.error('[crouton-sales] printing:job:failed reaction failed:', err)
    }
  })
})
