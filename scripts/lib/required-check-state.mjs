// required-check-state.mjs — is a required check-run finished? (#3429)
// GitHub can leave a check-run `status: in_progress` while it already carries a
// `conclusion` + `completed_at`; trusting `status` alone holds a green PR forever.

/** A run is done if completed, or it already has a verdict and a completion time. */
export function isDone(run) {
  return run.status === 'completed' || Boolean(run.conclusion && run.completed_at)
}

/** 'success' | 'pending' | 'missing' for the newest run named `name`. */
export function requiredCheckState(runs, name) {
  const mine = runs.filter(r => r.name === name)
  if (!mine.length) return 'missing'
  mine.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))
  const latest = mine[0]
  if (!isDone(latest)) return 'pending'
  return latest.conclusion === 'success' ? 'success' : 'pending'
}

/**
 * Drop check-runs that belong to a workflow run a newer run replaced (#2950).
 * `workflowRuns` = Actions runs for the same head SHA. Within one (workflow_id, event) the
 * newest run (by run_started_at, then id) is live; the rest are superseded and their
 * check-runs (matched via check_suite.id) are removed. Names are NOT compared: they repeat
 * across workflows. No workflow runs → identity (never looser than the old rule).
 */
export function liveCheckRuns(checkRuns, workflowRuns) {
  if (!Array.isArray(checkRuns)) return checkRuns
  if (!Array.isArray(workflowRuns) || !workflowRuns.length) return checkRuns
  const newest = new Map()
  const t = r => new Date(r.run_started_at || r.created_at || 0).getTime()
  const newer = (a, b) => t(a) > t(b) || (t(a) === t(b) && a.id > b.id)
  for (const w of workflowRuns) {
    const k = `${w.workflow_id}:${w.event}`
    const cur = newest.get(k)
    if (!cur || newer(w, cur)) newest.set(k, w)
  }
  const live = new Set([...newest.values()].map(w => w.id))
  const superseded = new Set(workflowRuns.filter(w => !live.has(w.id)).map(w => w.check_suite_id))
  return checkRuns.filter(c => !superseded.has(c.check_suite?.id))
}
