// GET /api/status/clock — each clock job: last due slot, whether the clock ran it then, next due (owner-only, #4216).
// One workflow's failed read makes that row `unknown` with the reason; it never fails the whole tab.
// A 14th row, the inbox stuck check (#4234), comes from the clock sync's KV record, not from GitHub;
// its read errors are that row's text and never the tab-wide error.
// A cancelled clock run that never started a job (/runs/<id>/jobs total_count 0) counts as ran when a run of the
// same workflow created within 20 min after it succeeded (#4269); those two reads happen only for such a row.
import { CLOCK_JOBS } from '../../utils/clock-jobs'
import { CARDS_SYNC_KEY } from '../../utils/clock-tick'
import type { CardsSyncRecord } from '../../utils/cards-sync-clock'
import { GRACE_MS, cardsSyncStatus, jobStatus, readError, unknownStatus, type GhRun, type JobStatus } from '../../utils/clock-status-core'

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
    const list = runs.data?.workflow_runs ?? []
    const first = jobStatus(job, now, list, wf.data.name)
    const id = first.lastRun?.id
    if (first.state !== 'failed' || first.lastRun?.conclusion !== 'cancelled' || !id) return first
    const jobs = await ghFetch<{ total_count?: number }>(event, `/repos/${REPO}/actions/runs/${id}/jobs?per_page=1`)
    if (jobs.error || jobs.data?.total_count !== 0) return first
    const from = first.lastRun.createdAt
    const to = new Date(Date.parse(from) + GRACE_MS).toISOString()
    const later = await ghFetch<{ workflow_runs?: GhRun[] }>(event, `${base}/runs?per_page=20&created=${from}..${to}`)
    if (later.error) return first
    return jobStatus(job, now, list, wf.data.name, later.data?.workflow_runs ?? [])
  }))
  // Surface a read error once at the top too (e.g. every row 403s on a token without Actions: read).
  const firstError = rows.find(r => r.error)?.error ?? null

  let record: CardsSyncRecord | null = null
  try {
    record = (await useStorage('kv').getItem<CardsSyncRecord>(CARDS_SYNC_KEY)) ?? null
  } catch {
    record = null // an unreadable record reads as no record
  }
  const env = (event?.context as { cloudflare?: { env?: Record<string, unknown> } } | undefined)?.cloudflare?.env
  rows.push(cardsSyncStatus(record, now, env?.CLOCK_ENABLED === '1'))
  return { data: rows, error: firstError }
})
