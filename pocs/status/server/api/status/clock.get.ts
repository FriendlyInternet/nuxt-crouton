// GET /api/status/clock — each clock job: last due slot, whether the clock ran it then, next due (owner-only, #4216).
// One workflow's failed read makes that row `unknown` with the reason; it never fails the whole tab.
import { CLOCK_JOBS } from '../../utils/clock-jobs'
import { jobStatus, readError, unknownStatus, type GhRun, type JobStatus } from '../../utils/clock-status-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const now = new Date()
  const rows: JobStatus[] = await Promise.all(CLOCK_JOBS.map(async (job) => {
    const base = `/repos/${REPO}/actions/workflows/${job.workflow}`
    const [wf, runs] = await Promise.all([
      ghFetch<{ name?: string }>(event, base),
      ghFetch<{ workflow_runs?: GhRun[] }>(event, `${base}/runs?event=workflow_dispatch&actor=nuxt-harness%5Bbot%5D&per_page=10`)
    ])
    const error = wf.error ?? runs.error
    if (error || !wf.data?.name) return unknownStatus(job, now, readError(error ?? 'No workflow name from GitHub'))
    return jobStatus(job, now, runs.data?.workflow_runs ?? [], wf.data.name)
  }))
  // Surface a read error once at the top too (e.g. every row 403s on a token without Actions: read).
  const firstError = rows.find(r => r.error)?.error ?? null
  return { data: rows, error: firstError }
})
