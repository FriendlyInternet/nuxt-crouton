// "Useful screenshots: X of Y this week" (#2700, epic #2690). The record of each capture outcome is
// the "Preview screenshot" check run preview-screenshot.yml leaves on every PR head: success = a
// usable shot was committed, failure = none. `neutral` (no preview deployed, nothing to capture) is
// not an attempt, so it counts toward neither side.

export const CHECK_NAME = 'Preview screenshot'

/** Reduce the check runs of PR heads (one array per PR) to { useful, total }. Newest run per PR wins. */
export function tallyScreenshotChecks(checkRunsPerPr) {
  let useful = 0
  let total = 0
  for (const runs of checkRunsPerPr) {
    const mine = (runs || [])
      .filter(r => r?.name === CHECK_NAME && (r.conclusion === 'success' || r.conclusion === 'failure'))
      .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
    if (!mine.length) continue
    total++
    if (mine[0].conclusion === 'success') useful++
  }
  return { useful, total }
}

/** The one digest line. Empty when there was nothing to measure, so the digest stays quiet. */
export function screenshotLine(s) {
  if (!s || !s.total) return ''
  return `Useful screenshots: ${s.useful} of ${s.total} this week`
}
