#!/usr/bin/env node
/**
 * rearm-deploy — the #2110 re-arm sweep for two failure modes the #2091 pattern
 * (automerge-epic-subpr.yml) doesn't cover for the PREVIEW-DEPLOY workflow:
 *
 *   1. A dropped `pull_request` webhook event — the preview-deploy workflow's check
 *      never starts at all (GitHub intermittently drops delivery; measured 1-in-16 on
 *      2026-08-05, #1698/#1942).
 *   2. A starved/auto-cancelled run — a run sat queued too long and Actions cancelled
 *      it before it ever started (its own concurrent-job cap), leaving no red check to
 *      notice and no green one either.
 *
 * Pure decision logic (mirrors scripts/deploy-detect.mjs / scripts/deploy-failure-report.mjs):
 * the scheduled workflow (.github/workflows/rearm-deploy.yml) does all GitHub I/O and acts
 * on what these functions return. Each candidate is meant to be re-dispatched AT MOST ONCE —
 * the sweep re-runs on a clock, so a genuinely-still-broken case is simply found again next
 * time, but this module never retries silently: `findStarvedRuns` treats the existence of a
 * LATER run for the same head SHA + workflow as proof a retry already happened, so it never
 * re-flags the same starved run twice.
 */

const DEFAULT_GRACE_MINUTES = 10             // let a legitimate pending check start before calling it dropped
const DEFAULT_QUEUE_THRESHOLD_MINUTES = 15   // Actions' own starvation window is usually well under this

function minutesBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000
}

/**
 * Find open PRs touching `watchPathPrefixes` whose head SHA has NO check run at all
 * matching `workflowCheckName` — i.e. the `pull_request` event that should have started
 * the preview-deploy workflow never arrived. A PR with ANY check run for that workflow
 * (queued/in-progress/completed, any conclusion) is left alone — that proves the event
 * WAS received, so a red/pending run is someone else's problem (CI, not delivery).
 *
 * @param {Array<{number:number, headSha:string, updatedAt:string, changedFiles:string[]}>} openPRs
 * @param {Array<{headSha:string, workflowName:string}>} checkRuns - one row per (PR head SHA, check)
 * @param {string[]} watchPathPrefixes
 * @param {string} workflowCheckName
 * @param {string} nowIso
 * @param {number} [graceMinutes]
 */
export function findDroppedPreviewEvents({
  openPRs, checkRuns, watchPathPrefixes, workflowCheckName, nowIso, graceMinutes = DEFAULT_GRACE_MINUTES
}) {
  const shasWithCheck = new Set(
    checkRuns.filter(c => c.workflowName === workflowCheckName).map(c => c.headSha)
  )
  return openPRs.filter(pr => {
    if (shasWithCheck.has(pr.headSha)) return false
    const touchesWatched = (pr.changedFiles || []).some(f =>
      watchPathPrefixes.some(prefix => f.startsWith(prefix))
    )
    if (!touchesWatched) return false
    return minutesBetween(pr.updatedAt, nowIso) >= graceMinutes
  })
}

/**
 * Find workflow runs that queued too long and were cancelled before ever starting
 * (Actions' starvation auto-cancel), which have NOT already been re-dispatched.
 *
 * A run counts as "starved" when: conclusion === 'cancelled', it never reached
 * in_progress (runStartedAt is missing or equal to createdAt), and it sat queued at
 * least `thresholdMinutes` (updatedAt - createdAt).
 *
 * "Already retried" is derived, never stored: if a LATER run exists for the same
 * headSha + workflowId, a retry has already happened (by a prior sweep or a normal
 * re-run) — only the single newest run per (headSha, workflowId) is ever a live
 * candidate, which is what caps retries at one without any persisted state.
 *
 * @param {Array<{id:number, workflowId:number, headSha:string, conclusion:string|null,
 *   createdAt:string, updatedAt:string, runStartedAt:string|null}>} runs
 * @param {number} [thresholdMinutes]
 */
export function findStarvedRuns({ runs, thresholdMinutes = DEFAULT_QUEUE_THRESHOLD_MINUTES }) {
  const latestByShaWorkflow = new Map()
  for (const r of runs) {
    const key = `${r.headSha}::${r.workflowId}`
    const existing = latestByShaWorkflow.get(key)
    if (!existing || new Date(r.createdAt) > new Date(existing.createdAt)) {
      latestByShaWorkflow.set(key, r)
    }
  }

  return runs.filter(r => {
    if (r.conclusion !== 'cancelled') return false
    const neverStarted = !r.runStartedAt || r.runStartedAt === r.createdAt
    if (!neverStarted) return false
    if (minutesBetween(r.createdAt, r.updatedAt) < thresholdMinutes) return false
    const key = `${r.headSha}::${r.workflowId}`
    const latest = latestByShaWorkflow.get(key)
    return latest?.id === r.id   // only the newest run per (sha, workflow) is a live candidate
  })
}

export const DEFAULTS = { DEFAULT_GRACE_MINUTES, DEFAULT_QUEUE_THRESHOLD_MINUTES }
