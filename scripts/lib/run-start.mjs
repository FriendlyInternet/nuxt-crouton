// Validate the run-start time (t0) an end-of-run artifact gate compares against (#3324).
// An empty/invalid value makes every `>= sinceMs` check false AND drops the `since` filter
// from listComments (returns every comment), so the gate must refuse to run instead.
export function parseRunStart(raw) {
  const since = typeof raw === 'string' ? raw.trim() : ''
  if (!since) return { ok: false, reason: 'run-start time (t0) is empty' }
  const sinceMs = new Date(since).getTime()
  if (Number.isNaN(sinceMs)) return { ok: false, reason: `run-start time (t0) is invalid: ${since}` }
  return { ok: true, sinceMs, since }
}
