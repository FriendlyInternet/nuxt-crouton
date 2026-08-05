/**
 * Spooler-callback: mark a print job as successfully completed.
 *
 * Generic — updates only print_jobs (via completePrintJob, which emits the
 * `printing:job:completed` lifecycle hook). Domain reactions (e.g. sales order
 * auto-complete) subscribe to that hook (#329); this endpoint stays
 * domain-agnostic.
 */
import { requireSpoolerCallbackAuth } from '../../../../utils/print-server-auth'
import { getPrintJobTeamId } from '../../../../utils/spooler-device'
import { completePrintJob } from '../../../../utils/print-job-status'

export default defineEventHandler(async (event) => {
  const jobId = getRouterParam(event, 'jobId')
  if (!jobId) {
    throw createError({ status: 400, statusText: 'Job ID is required' })
  }

  // Device callers (#1366) are scoped to their claimed team's jobs; the
  // legacy script authenticates with the shared x-api-key instead.
  await requireSpoolerCallbackAuth(event, await getPrintJobTeamId(useDB(), jobId) ?? null)

  const outcome = await completePrintJob(useDB(), jobId)
  if (!outcome) {
    throw createError({ status: 404, statusText: 'Print job not found' })
  }

  return { success: true, id: jobId }
})
