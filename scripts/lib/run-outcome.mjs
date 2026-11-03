// Run-outcome classification (#3251). Pure: no I/O.
//
// A workflow RUN "produced" something only if it left behind work an agent made: a comment the
// agent wrote, a review verdict, or a commit. The workflow's own notes (run note, breadcrumb,
// revise notes, failure alerts…) are NOT output — every one carries NOTE_MARKER at its post site,
// so classification is a marker check, never header-text matching.

export const NOTE_MARKER = '<!-- pipeline-note -->'

// Verdict comments keep their own markers and count as `verdict`.
const VERDICT_RE = /<!-- (?:plan|build|ticket)-review-verdict[^>]*-->|<!-- build-review-sha:/

const WORKFLOW_BOTS = new Set(['github-actions[bot]'])

/**
 * @param {{ body?: string, user?: { login?: string } }} comment
 * @returns {'comment'|'verdict'|null}  null = the workflow's own note (not output)
 */
export function classifyComment(comment) {
  const body = comment?.body || ''
  if (WORKFLOW_BOTS.has(comment?.user?.login)) return null
  if (VERDICT_RE.test(body)) return 'verdict'
  if (body.includes(NOTE_MARKER)) return null
  return 'comment'
}

export const isOutput = (comment) => classifyComment(comment) !== null

const inWindow = (iso, start, end) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= Date.parse(start) && t <= Date.parse(end)
}

/**
 * @param {{ comments?: any[], reviews?: any[], commits?: any[] }} items  already scoped to the subject(s)
 * @param {{ start: string, end: string }} win
 * @returns {{ produced: string[], produced_ids: Array<string|number> }}
 */
export function classify(items, win, classifyOne = classifyComment) {
  const produced = new Set()
  const ids = []
  for (const c of items.comments || []) {
    if (!inWindow(c.created_at, win.start, win.end)) continue
    const kind = classifyOne(c)
    if (!kind) continue
    produced.add(kind)
    ids.push(c.id)
  }
  for (const r of items.reviews || []) {
    if (!inWindow(r.submitted_at, win.start, win.end)) continue
    produced.add('verdict')
    ids.push(r.id)
  }
  for (const c of items.commits || []) {
    const when = c.commit?.committer?.date || c.commit?.author?.date
    if (!inWindow(when, win.start, win.end)) continue
    produced.add('commit')
    ids.push(String(c.sha).slice(0, 7))
  }
  return { produced: produced.size ? [...produced].sort() : ['nothing'], produced_ids: ids }
}

/**
 * Overlap (declared): agent comments carry no run id, so two runs of the same workflow on the same
 * subject with intersecting windows cannot be told apart. They share attribution — except a comment
 * embedding `/actions/runs/<id>` is credited exactly to that run.
 *
 * @param {{ run_id: number|string, start: string, end: string }} me
 * @param {Array<{ run_id: number|string, start: string, end: string }>} others  same workflow + subject
 * @param {any[]} comments  the subject's comments in my window
 */
export function joinRuns(me, others, comments = []) {
  const myId = String(me.run_id)
  const overlap = others
    .filter((o) => String(o.run_id) !== myId)
    .filter((o) => Date.parse(o.start) <= Date.parse(me.end) && Date.parse(o.end) >= Date.parse(me.start))
    .map((o) => String(o.run_id))
  const exactMine = []
  const exactOthers = new Set()
  for (const c of comments) {
    const m = /\/actions\/runs\/(\d+)/.exec(c.body || '')
    if (!m) continue
    if (m[1] === myId) exactMine.push(c.id)
    else if (overlap.includes(m[1])) exactOthers.add(c.id)
  }
  return {
    overlap,
    attribution: overlap.length ? 'shared' : 'exact',
    exactMine,
    // comments credited exactly to a sibling run are removed from my share
    excludeIds: [...exactOthers],
  }
}

/** Median ignoring null/undefined; null when nothing is left. */
export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Frozen rule for backfilled rows: old comments lack the marker, so match the known header texts. */
export function legacyIsNote(comment) {
  const body = comment?.body || ''
  if (WORKFLOW_BOTS.has(comment?.user?.login)) return true
  if (VERDICT_RE.test(body)) return false
  return /<!-- work-run:|run record|_revision \(#|_merge conflict \(#|_plan check \(#|-failed -->|this run produced nothing|Revise stopped|_via the `/.test(body)
}

/** Backfill classifier (rule: "legacy") — same shape as classifyComment, but by the frozen header rule. */
export function legacyClassifyComment(comment) {
  if (legacyIsNote(comment)) return null
  return VERDICT_RE.test(comment?.body || '') ? 'verdict' : 'comment'
}

/**
 * Per-workflow weekly summary: runs joined with their records.
 * @param {Array<{ id: number|string, workflow: string, url?: string }>} runs  e.g. `gh run list`
 * @param {any[]} records
 */
export function summarizeRuns(runs, records) {
  const byRun = new Map(records.map((r) => [String(r.run_id), r]))
  const out = {}
  for (const run of runs) {
    const w = (out[run.workflow] ||= { runs: 0, produced: 0, nothing: 0, shared: 0, missing: 0, unknown: 0, api: [] })
    w.runs++
    const rec = byRun.get(String(run.id))
    if (!rec) { w.missing++; continue }
    if (rec.attribution === 'shared') w.shared++
    else if (rec.produced?.includes('nothing')) w.nothing++
    else if (rec.produced?.includes('unknown')) w.unknown++
    else w.produced++
    w.api.push(rec.api_calls)
  }
  for (const w of Object.values(out)) { w.api_calls_median = median(w.api); delete w.api }
  return out
}
