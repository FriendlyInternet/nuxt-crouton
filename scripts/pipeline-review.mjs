// pipeline-review.mjs — pure decisions for the pipeline review opened every 10 closed epics (#3254).
// No I/O. GitHub + file I/O lives in pipeline-review-run.mjs; pipeline-review.yml calls it
// (count → gather-and-write → post).
//
// Markers (HTML comments, read from the raw body):
//   <!-- pipeline-review:window since=<iso> until=<iso> epics=<n,n,…> -->  the review issue's window
//   <!-- pipeline-review:report -->    the model's review is posted
//   <!-- pipeline-review:skipped -->   the model run failed or wrote nothing
//
// TRUST: this repo is public, so a marker counts only from the pipeline bots or a collaborator
// (same rule as the postmortem, postmortem.mjs).
import { isTrustedAuthor, stripCode } from './postmortem.mjs'

export const LABEL = 'pipeline-review'
export const PROVENANCE = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _pipeline review every 10 closed epics (#3254)_'
export const DEFAULT_THRESHOLD = 10
export const DIFF_MAX_BYTES = 40000

const ms = iso => Date.parse(iso)
const ymd = t => new Date(t).toISOString().slice(0, 10)
const DAY = 86400000

/**
 * When to open a review. `epics` are completed epics ({ number, title, closedAt, url }).
 * With an earlier review the window starts at its createdAt; with none, the newest `threshold`
 * epics are taken (no backfill of missed batches).
 * @returns {{ open: boolean, since: string|null, until: string, epics: object[], reason: string }}
 */
export function decideReview({ lastReview = null, epics = [], threshold = DEFAULT_THRESHOLD, now = new Date().toISOString() } = {}) {
  const t = Math.max(1, Number(threshold) || DEFAULT_THRESHOLD)
  const until = new Date(now).toISOString()
  const sorted = [...(epics || [])].filter(e => e?.closedAt).sort((a, b) => ms(b.closedAt) - ms(a.closedAt))
  if (lastReview?.createdAt) {
    const since = new Date(lastReview.createdAt).toISOString()
    const inWindow = sorted.filter(e => ms(e.closedAt) > ms(since))
    const open = inWindow.length >= t
    return { open, since, until, epics: inWindow, reason: `${inWindow.length} completed epic(s) since the last review (#${lastReview.number ?? '?'}); threshold ${t}` }
  }
  const taken = sorted.slice(0, t)
  const open = taken.length >= t
  const since = taken.length ? new Date(taken[taken.length - 1].closedAt).toISOString() : null
  return { open, since, until, epics: taken, reason: `no earlier review — ${taken.length} newest completed epic(s); threshold ${t}` }
}

/** The review issue to open. */
export function renderReviewIssue({ since, until, epics = [], runUrl, repo = 'FriendlyInternet/nuxt-crouton' }) {
  const gh = `https://github.com/${repo}`
  const d = iso => String(iso || '').slice(0, 10)
  const title = `Pipeline review: ${epics.length} epics closed ${d(since)}…${d(until)}`
  const body = [
    `<!-- pipeline-review:window since=${since} until=${until} epics=${epics.map(e => e.number).join(',')} -->`,
    PROVENANCE,
    '',
    `The pipeline closed ${epics.length} epics since the last review. A read-only review of them posts here as a comment.`,
    '',
    '**Epics in this window**',
    '',
    ...epics.map((e, i) => `${i + 1}. [#${e.number} — ${e.title || ''}](${e.url || ''}) · closed ${d(e.closedAt)}`),
    '',
    '**Data**',
    '',
    `- Run records: [pipeline-data → records/](${gh}/tree/pipeline-data/records)`,
    `- Hourly metrics: [pipeline-data → metrics/latest.json](${gh}/blob/pipeline-data/metrics/latest.json)`,
    `- This run: ${runUrl || '(no run link)'}`,
    '',
    'Report only — proposals become tickets only after your `ok`.'
  ].join('\n')
  return { title, body }
}

const WINDOW_RE = /<!--\s*pipeline-review:window\s+since=(\S+)\s+until=(\S+)(?:\s+epics=([\d,]*))?\s*-->/

/** The window marker of a review issue body → { since, until, epics: number[] } | null. */
export function parseWindow(body = '') {
  const m = String(body || '').match(WINDOW_RE)
  if (!m) return null
  return { since: m[1], until: m[2], epics: (m[3] || '').split(',').map(Number).filter(Boolean) }
}

/** Args for scripts/quality-digest/gather.mjs: plain dates; `--until` is exclusive, so +1 day. */
export function gatherArgs({ since, until }) {
  return ['--since', ymd(ms(since)), '--until', ymd(Date.parse(ymd(ms(until))) + DAY)]
}

/** gather.mjs's own output name for a `--until` date (dashes removed). */
export function qualityDigestFile(untilDate) {
  return `writeups/reports/quality-digest-${String(untilDate).replace(/-/g, '')}.json`
}

/** The `YYYY-MM-DD` record folders the window touches, start through end inclusive. */
export function windowDays({ since, until }) {
  const out = []
  const end = Date.parse(ymd(ms(until)))
  for (let t = Date.parse(ymd(ms(since))); t <= end; t += DAY) out.push(ymd(t))
  return out
}

/** Cut a diff at the last full line under maxBytes; note the cut. */
export function cutDiff(text = '', maxBytes = DIFF_MAX_BYTES) {
  const buf = Buffer.from(String(text || ''), 'utf8')
  const bytes = buf.length
  if (bytes <= maxBytes) return { text: String(text || ''), cut: false, bytes, keptBytes: bytes }
  let head = buf.subarray(0, maxBytes).toString('utf8')
  if (head.endsWith('\uFFFD')) head = head.replace(/\uFFFD+$/, '')
  const nl = head.lastIndexOf('\n')
  const kept = nl >= 0 ? head.slice(0, nl + 1) : ''
  const keptBytes = Buffer.byteLength(kept, 'utf8')
  return { text: `${kept}# [cut: kept ${keptBytes} of ${bytes} bytes]\n`, cut: true, bytes, keptBytes }
}

/** The one "Data gaps" line, or '' when there are none. Written by code so it shows even if the model ignores the prompt. */
export function gapsLine(gaps) {
  if (!gaps) return ''
  const parts = []
  if (gaps.records) parts.push(String(gaps.records))
  if (gaps.cutDiffs?.length) parts.push(`diff cut for ${gaps.cutDiffs.map(n => `#${n}`).join(', ')}`)
  if (gaps.noDiff?.length) parts.push(`no diff for ${gaps.noDiff.map(n => `#${n}`).join(', ')}`)
  if (gaps.metricsMissing) parts.push('no metrics/latest.json')
  return parts.length ? `**Data gaps:** ${parts.join(' · ')}` : ''
}

const header = (marker, gaps) => [marker, PROVENANCE, ...(gapsLine(gaps) ? ['', gapsLine(gaps)] : [])].join('\n')

/** The model's text → the comment to post, or null when empty. Every model-written marker is removed. */
export function finalizeReport({ text, gaps } = {}) {
  const clean = String(text || '').replace(/<!--[\s\S]*?-->/g, '').trim()
  if (!clean) return null
  return `${header('<!-- pipeline-review:report -->', gaps)}\n\n${clean}\n`
}

export function renderSkipped({ runUrl, gaps } = {}) {
  return [
    header('<!-- pipeline-review:skipped -->', gaps),
    '',
    `⚠️ **The review didn't run** — see ${runUrl ? `[the run](${runUrl})` : 'the run'}. Re-run \`pipeline-review.yml\` by hand to retry.`
  ].join('\n') + '\n'
}

const STATE_RE = /<!--\s*pipeline-review:(report|skipped)\b[^>]*-->/g

/** 'report' | 'skipped' | 'none' — from trusted comments only; report wins. */
export function reviewState(comments = []) {
  let skipped = false
  for (const c of comments || []) {
    if (!isTrustedAuthor(c)) continue
    for (const m of stripCode(c.body).matchAll(STATE_RE)) {
      if (m[1] === 'report') return 'report'
      skipped = true
    }
  }
  return skipped ? 'skipped' : 'none'
}

/** The model prompt. The model has no GitHub token: it reads only the bundle. */
export function buildReviewPrompt({ bundleDir, outFile }) {
  const b = bundleDir
  return [
    'You are writing the pipeline review for this repository, in CI (no human is attached). It covers the',
    'epics the pipeline closed since the last review. You have NO GitHub access: read only files under',
    `\`${b}\`.`,
    '',
    'The bundle:',
    `- \`${b}/epics.json\` — each epic in the window, with its postmortem comment (\`postmortem\`, may be null).`,
    `- \`${b}/epic-numbers/<N>.json\` — each epic's numbers, COMPUTED BY CODE: runs, plan/build rounds, revisions,`,
    '  silent runs per child. They are the source for those numbers — do NOT recount them from records.json.',
    '  `epic-numbers/missing.txt` lists epics whose numbers could not be computed, with the reason.',
    `- \`${b}/records.json\` — every run record in the window. Use it only for cross-epic patterns (failed or`,
    '  empty runs, lost hand-offs, force-pushes). It is large: aggregate it with `jq` or `node`, do not read it whole.',
    `  If \`${b}/records-missing.txt\` exists there are no run records for this span: say "no run records in this`,
    '  span" in the causes section and do not guess run patterns.',
    `- \`${b}/metrics.json\` — the hourly pipeline metrics (or \`metrics-missing.txt\`).`,
    `- \`${b}/quality.json\` — the deterministic quality numbers (merged PRs, churn, reverts, scans). Cite them.`,
    `- \`${b}/previous-review.md\` — the last review (may be empty). Use it for the trend column.`,
    `- \`${b}/merged-prs.json\` + \`${b}/diffs/<N>.diff\` — up to 20 PRs merged into main in the window.`,
    '',
    `Write ONLY the comment body (markdown) to \`${outFile}\` with your file-write tool, in this shape:`,
    '1. **Top 3 causes** of wasted runs or owner work in this window, one line each with evidence (link).',
    '2. A table `cause | count | trend vs previous | ticket (link or **new**)`.',
    '3. **Code quality** — a short section on the sampled merged PRs against one rubric: correctness, tests',
    '   present, follows repo idiom, dead code left behind. Grade ONLY what is in `diffs/<N>.diff`. A PR with no',
    '   diff file (`diffFile: null`) is listed as "not graded (no diff)". For a PR whose diff was cut',
    '   (`cut: true`) say "graded on the first <keptBytes> of <diffBytes> bytes" and make no claim about the rest.',
    '4. Numbered **Proposals**, each answerable with `ok` / `not ok:`.',
    '',
    'Baseline for the first review (4 Nov, #3341): about 4 plan rounds per ticket; 42% of checks failing again',
    'after passing. Compare against it when previous-review.md is empty.',
    '',
    'Rules: do not post, label, create issues or tickets. Do not write any HTML comment marker — a trusted step',
    'adds it. Do not @mention anyone. This is a report only.'
  ].join('\n')
}
