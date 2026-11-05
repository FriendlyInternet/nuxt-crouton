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
