#!/usr/bin/env node
// diagnosis-review.mjs — the review loop between the fix-bot's 🩺 diagnosis and any fix (#3668).
//
// Rule: on a pipeline PR, no fix (fix-bot commit OR worker hand-back) starts on a repeat red unless
// a pipeline-bot review comment APPROVED a diagnosis for that exact head sha and check. A diagnosis
// is rejected at most MAX_REVIEW_ROUNDS times; then the owner gets both views. Folded in:
//   - #3277: the try counter only counts while the head is the fix-bot's own commit; a stuck head
//     pages the owner once (gaveUpMarker / gaveUpPosted), not once per red workflow.
//   - #3270: a failure the base branch also has (same failureSignature) is not this PR's to fix.
//
// Pure functions + a small CLI (`precheck|route|render-review|fix-go|base|owner-ask|handback-marker`). Imports only
// files the fix-ci workflow copies next to it into $RUNNER_TEMP/lib (log-tail, diagnosis-marker, ci-fix-commit,
// failed-job-logs).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanLine, failingLines, NOISE_LINES, EXIT_LINE } from './log-tail.mjs'
import { parseDiagnosisMarker } from './diagnosis-marker.mjs'
import { isCiFixCommit } from './ci-fix-commit.mjs'
import { pickFailedJobs } from './failed-job-logs.mjs'

export const MAX_REVIEW_ROUNDS = 2
export const REVIEW_CHECKS = ['stopped-at', 'cause', 'since-when', 'proof', 'known-before']

// The pipeline posts with the Harness App (nuxt-harness[bot]) or the workflow token
// (github-actions[bot]). Only those count: on a public repo anyone can paste a lookalike marker.
export const PIPELINE_BOTS = ['nuxt-harness[bot]', 'github-actions[bot]']
export const isPipelineBot = (c) =>
  c?.user?.type === 'Bot' && PIPELINE_BOTS.includes(String(c?.user?.login || '').toLowerCase())

// ── Review marker ───────────────────────────────────────────────────────────────────────────
const REVIEW_RE = /<!--\s*diagnosis-review:v1\s+sha=(\S+)\s+check=(\S+)\s+round=(\d+)\s+verdict=(approve|reject)\s*-->/

/** @param {{ sha:string, check:string, round:number, verdict:'approve'|'reject' }} p */
export function reviewMarker({ sha, check, round, verdict }) {
  return `<!-- diagnosis-review:v1 sha=${sha} check=${encodeURIComponent(String(check))} round=${Number(round)} verdict=${verdict} -->`
}

/** @returns {{ sha:string, check:string, round:number, verdict:'approve'|'reject' } | null} */
export function parseReviewMarker(body) {
  const m = REVIEW_RE.exec(String(body || ''))
  if (!m) return null
  let check
  try { check = decodeURIComponent(m[2]) } catch { return null }
  return { sha: m[1], check, round: Number(m[3]), verdict: /** @type {any} */ (m[4]) }
}

// ── The mechanical check that runs before the model reviewer ────────────────────────────────
/** The first line of the fenced block under `#### Stopped at`, with a `1234: ` line-number prefix dropped. */
export function stoppedAtLine(diagnosisBody) {
  const s = String(diagnosisBody || '')
  const at = s.search(/^####\s+Stopped at\s*$/m)
  if (at < 0) return ''
  const rest = s.slice(at).split('\n').slice(1)
  const stop = rest.findIndex(l => /^####\s/.test(l))
  const section = (stop < 0 ? rest : rest.slice(0, stop))
  const open = section.findIndex(l => /^\s*(```|~~~)/.test(l))
  if (open < 0) return ''
  const line = section.slice(open + 1).find(l => l.trim() && !/^\s*(```|~~~)/.test(l)) || ''
  return cleanLine(line).replace(/^\s*\d+:\s/, '').trim()
}

/**
 * @param {{ diagnosisBody:string, rawLog:string }} p
 * @returns {{ ok:boolean, line:string, points:string[] }}
 */
export function precheck({ diagnosisBody, rawLog }) {
  const line = stoppedAtLine(diagnosisBody)
  const points = []
  if (!line) {
    points.push('The diagnosis has no quoted line under `#### Stopped at` — quote the line where the job stopped, in a fenced block.')
    return { ok: false, line, points }
  }
  if (EXIT_LINE.test(line)) points.push(`\`${line}\` is the runner's closing exit-code line, never the cause — quote the line above it that names the failure.`)
  const noise = NOISE_LINES.find(re => re.test(line))
  if (noise) points.push(`\`${line.slice(0, 200)}\` is a known noise line (matches \`${noise}\`), not the failure — find the line where the job really stopped.`)
  const logLines = String(rawLog || '').split(/\r?\n/).map(l => cleanLine(l).trim())
  if (!logLines.some(l => l === line || (line.length >= 10 && l.includes(line)))) {
    points.push(`The Stopped-at line \`${line.slice(0, 200)}\` is not in the failed job's log — quote a line that is.`)
  }
  return { ok: points.length === 0, line, points }
}

// ── The model reviewer's verdict file ───────────────────────────────────────────────────────
/** The body of the `### <name>` section, up to the next `###` heading ('' when absent). */
function reviewSection(s, name) {
  const m = new RegExp(`^###\\s+${name}\\s*$`, 'm').exec(s)
  if (!m) return ''
  const rest = s.slice(m.index + m[0].length)
  const end = rest.search(/^###\s/m)
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

/** `- <name>: PASS|FAIL — evidence` lines of the Checks section. */
function reviewChecks(body) {
  const checks = []
  for (const l of body.split('\n')) {
    const m = /^\s*-\s*([\w-]+):\s*(PASS|FAIL)\b\s*(?:[—–-]\s*)?(.*)$/i.exec(l)
    if (m) checks.push({ name: m[1].toLowerCase(), pass: m[2].toUpperCase() === 'PASS', evidence: m[3].trim() })
  }
  return checks
}

/** What is wrong with the file's shape: header, verdict word, a missing check. */
function reviewShapeErrors(s, v, checks) {
  const errors = []
  if (!s.includes('<!-- diagnosis-review:v1 -->')) errors.push('the verdict file lacks the `<!-- diagnosis-review:v1 -->` header')
  if (v !== 'approve' && v !== 'reject') errors.push(`the verdict is \`${v || '(missing)'}\`, not approve or reject`)
  for (const name of REVIEW_CHECKS) if (!checks.some(c => c.name === name)) errors.push(`check \`${name}\` is missing`)
  return errors
}

/**
 * Reads the reviewer's file. Closed by default: a missing/malformed file is `reject` with `errors`.
 * @returns {{ verdict:'approve'|'reject', checks:{ name:string, pass:boolean, evidence:string }[], points:string[], errors:string[] }}
 */
export function parseReviewVerdict(text) {
  const s = String(text || '')
  if (!s.trim()) return { verdict: 'reject', checks: [], points: [], errors: ['no review verdict file (the reviewer did not run or wrote nothing)'] }
  const v = reviewSection(s, 'Verdict').split('\n')[0].trim().toLowerCase()
  const checks = reviewChecks(reviewSection(s, 'Checks'))
  const errors = reviewShapeErrors(s, v, checks)
  const points = reviewSection(s, 'Points').split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  for (const c of checks) if (!c.pass) points.push(`${c.name}: ${c.evidence || 'failed'}`)
  const verdict = v === 'approve' && !errors.length && checks.every(c => c.pass) ? 'approve' : 'reject'
  return { verdict, checks, points: [...new Set(points)], errors }
}

/** @returns {'fix'|'redo'|'owner'} */
export function routeReview({ verdict, round }) {
  if (verdict === 'approve') return 'fix'
  return Number(round) < MAX_REVIEW_ROUNDS ? 'redo' : 'owner'
}

const truthy = (v) => v === true || v === 'true'

/**
 * THE rule: may a fix start now, and from what? `diagnosis` = from an approved diagnosis.
 * @returns {{ go:boolean, from:'log'|'diagnosis'|null, reason:string }}
 */
export function fixGo({ mode, baseSkip, headMoved, route1, route2 } = {}) {
  if (truthy(baseSkip)) return { go: false, from: null, reason: 'the same failure is red on the base branch' }
  if (truthy(headMoved)) return { go: false, from: null, reason: 'a newer commit landed; its own red run handles it' }
  if (mode === 'fix') return { go: true, from: 'log', reason: 'first red: fix from the log' }
  if (mode === 'diagnose' && (route1 === 'fix' || route2 === 'fix')) return { go: true, from: 'diagnosis', reason: 'a review approved the diagnosis' }
  return { go: false, from: null, reason: mode === 'diagnose' ? 'no approved diagnosis' : `unknown mode \`${mode || ''}\`` }
}

// ── Approved diagnoses in the PR thread ─────────────────────────────────────────────────────
const botReviews = (comments, pred) => (comments || [])
  .filter(isPipelineBot)
  .map(c => ({ c, r: parseReviewMarker(c.body) }))
  .filter(x => x.r && x.r.verdict === 'approve' && pred(x.r))

const diagnosisFor = (comments, { sha, check, round }) => {
  const d = (comments || []).filter(isPipelineBot).filter(c => {
    const p = parseDiagnosisMarker(c.body)
    return p && p.sha === sha && p.check === check && p.round === round
  })
  return d.length ? String(d[d.length - 1].body) : null
}

/** The diagnosis a pipeline-bot review approved for exactly this sha + check, or null. */
export function approvedDiagnosis(comments, { sha, check }) {
  const ok = botReviews(comments, r => r.sha === sha && r.check === check)
  for (let i = ok.length - 1; i >= 0; i--) {
    const body = diagnosisFor(comments, ok[i].r)
    if (body) return body
  }
  return null
}

/** What the fixer is handed: the approved diagnosis first, then the original failing lines. */
export function handoffLog({ approved, failingLog }) {
  if (!approved) return failingLog
  return `### Approved diagnosis — fix this cause\n\n${approved}\n\n${failingLog || ''}`
}

/** URL origins, PR numbers, issue refs and shas differ between a PR run and a base run of the same failure. */
export function normaliseLine(s) {
  return cleanLine(String(s || ''))
    .replace(/https?:\/\/[^/\s"]+/g, '')
    .replace(/\bpr-?\d+\b/gi, '')
    .replace(/#\d+\b/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .trim()
}

/** The older sha whose approved diagnosis quoted this same failing line, or null (a "miss"). */
export function missOf({ comments, check, sha, failingLine }) {
  const want = normaliseLine(failingLine)
  if (!want) return null
  for (const { r } of botReviews(comments, r => r.check === check && r.sha !== sha)) {
    const body = diagnosisFor(comments, r)
    if (body && normaliseLine(stoppedAtLine(body)) === want) return r.sha
  }
  return null
}
export const isMiss = (p) => missOf(p) !== null
/** The hidden marker on a miss note (#3669 tallies these). */
export const missMarker = ({ sha, check, prev }) =>
  `<!-- diagnosis-miss:v1 sha=${sha} check=${encodeURIComponent(String(check))} prev=${prev} -->`

// ── #3270: the same failure on the base branch ──────────────────────────────────────────────
const STAMPED = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/
/**
 * [first failing line, first TIMESTAMPED `[tag] ✗ …` line], both normalised. A line with no
 * timestamp is a script body echoed into the log (e.g. a step's `l.includes('✗')`), never output.
 */
export function failureSignature(raw) {
  const first = failingLines(raw, { max: 1 })[0]?.text || ''
  const cross = String(raw || '').split(/\r?\n/)
    .find(l => STAMPED.test(l) && /^\[[\w-]+\] ✗ /.test(cleanLine(l))) || ''
  return [normaliseLine(first), normaliseLine(cross)].filter(Boolean)
}

/** The newest completed base-branch run (any conclusion), ignoring pull_request events. */
export function pickBaseRun(runs = []) {
  return (runs || [])
    .filter(r => r && r.status === 'completed' && r.event !== 'pull_request')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null
}

/**
 * @param {{ prJobs:{name:string, raw:string}[], baseRun:{conclusion:string}|null, baseJobs:{name:string, conclusion:string, raw:string}[] }} p
 * @returns {{ skip:boolean, mainRed:string[], own:string[] }}
 */
export function baseVerdict({ prJobs = [], baseRun = null, baseJobs = [] }) {
  const mainRed = []
  const own = []
  for (const j of prJobs) {
    const b = baseRun && baseRun.conclusion !== 'success' ? baseJobs.find(x => x.name === j.name) : null
    const a = failureSignature(j.raw)
    const same = b && b.conclusion === 'failure' && a.length && JSON.stringify(a) === JSON.stringify(failureSignature(b.raw))
    ;(same ? mainRed : own).push(j.name)
  }
  return { skip: own.length === 0 && mainRed.length > 0, mainRed, own }
}

// ── #3277: the try counter and the one-page rule ────────────────────────────────────────────
/**
 * The label count while the head is the fix-bot's own commit, or while `carry` says a worker head
 * still fails on the same line (see carriesCount); any other head is new code → 0.
 */
export function effectiveAttempts({ labels = [], headCommit, carry = false }) {
  const l = (labels || []).find(n => /^ci-fix-attempts:\d+$/.test(n))
  const n = l ? Number(l.split(':')[1]) : 0
  return isCiFixCommit(headCommit) || truthy(carry) ? n : 0
}

// ── The count across a worker revision (#3668 review): guard refused a fix → worker → same red ──
const HANDBACK_RE = /<!--\s*fix-bot-handback:v1\s+sha=(\S+)\s+check=(\S+)\s+line=(\S*)\s*-->/
/** The hidden marker on the guard's hand-back comment: the check and the (normalised) failing line. */
export const handbackMarker = ({ sha, check, line }) =>
  `<!-- fix-bot-handback:v1 sha=${sha} check=${encodeURIComponent(String(check))} line=${encodeURIComponent(normaliseLine(line))} -->`
/** @returns {{ sha:string, check:string, line:string } | null} */
export function parseHandbackMarker(body) {
  const m = HANDBACK_RE.exec(String(body || ''))
  if (!m) return null
  try { return { sha: m[1], check: decodeURIComponent(m[2]), line: decodeURIComponent(m[3]) } } catch { return null }
}

/** The first failing line of each job log (empty ones dropped), in order. */
export const firstFailingLines = (raws = []) =>
  (raws || []).map(r => failingLines(String(r || ''), { max: 1 })[0]?.text || '').filter(Boolean)

/**
 * Does the try count carry over to a head that is not the fix-bot's commit? Yes while the same line
 * keeps failing: the newest pipeline-bot hand-back for this check (the guard refused a fix and re-ran
 * the worker) quoted it, or an approved diagnosis on an older head did (a miss). Else → false.
 */
export function carriesCount({ comments = [], check, sha, failingLines: lines = [] }) {
  const want = (lines || []).map(normaliseLine).filter(Boolean)
  const hb = (comments || []).filter(isPipelineBot).map(c => parseHandbackMarker(c.body)).filter(h => h && h.check === check).pop()
  // An empty line = the guard's marker CLI crashed (fix-bot-guard.sh): fail closed, the count carries.
  if (hb && hb.line === '') return true
  if (!want.length) return false
  if (hb && want.includes(hb.line)) return true
  return (lines || []).some(failingLine => missOf({ comments, check, sha, failingLine }) !== null)
}

/**
 * The gate's call (fix-ci-on-failure.yml): reads the failed run's job logs and the PR thread, only
 * when it matters — a non-fix-bot head on a PR that already has a counted try. Any read error → false
 * (the old behaviour: a worker head starts at 0).
 */
export async function carriedTry({ github, owner, repo, pr, sha, runId, check, labels = [], headCommit }) {
  if (isCiFixCommit(headCommit) || !runId) return false
  if (!(labels || []).some(n => /^ci-fix-attempts:[1-9]\d*$/.test(n))) return false
  try {
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, { owner, repo, run_id: Number(runId), filter: 'latest', per_page: 100 })
    const raws = []
    for (const j of pickFailedJobs(jobs)) raws.push(String((await github.rest.actions.downloadJobLogsForWorkflowRun({ owner, repo, job_id: j.id })).data || ''))
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: Number(pr), per_page: 100 })
    return carriesCount({ comments, check, sha, failingLines: firstFailingLines(raws) })
  } catch { return false }
}

export const gaveUpMarker = (sha) => `<!-- fix-bot-gave-up:v1 sha=${sha} -->`
export function gaveUpPosted(comments, { sha }) {
  const m = gaveUpMarker(sha)
  return (comments || []).some(c => isPipelineBot(c) && String(c.body || '').includes(m))
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────
const bullets = (xs) => (xs && xs.length ? xs.map(x => `- ${x}`).join('\n') : '- (none)')

/** The 🔎 review comment the route step posts on the PR. */
export function renderReview({ sha, check, round, verdict, next, checks = [], points = [], errors = [] }) {
  const word = verdict === 'approve' ? 'approved' : 'rejected'
  const then = { fix: 'The fix starts from this diagnosis.', redo: 'The diagnosis is redone with the points below.', owner: 'Two reviews rejected it, so it goes to the owner on the linked issue.' }[next] || ''
  return [
    '<!-- pipeline-note -->',
    reviewMarker({ sha, check, round, verdict }),
    `🔎 **Diagnosis review** — ${word} (round ${round} of ${MAX_REVIEW_ROUNDS}) for \`${check}\` on \`${String(sha).slice(0, 7)}\`. ${then}`,
    '',
    '<details><summary>Checks and points</summary>',
    '',
    checks.length ? checks.map(c => `- ${c.name}: ${c.pass ? 'PASS' : 'FAIL'} — ${c.evidence}`).join('\n') : '- (no checks recorded)',
    '',
    '**Points**',
    bullets(points),
    ...(errors.length ? ['', '**Problems with the review itself**', bullets(errors)] : []),
    '',
    '</details>',
    '',
    '<sub>🤖 fix-bot · diagnosis review (#3668)</sub>',
  ].join('\n')
}

/** The owner ask after two rejections (ask-human shape: heading, Needs, recommendation, depth collapsed). */
export function ownerAsk({ check, sha, pr, rounds = [] }) {
  const last = rounds[rounds.length - 1] || {}
  const depth = rounds.map((r, i) => [
    `**Round ${i + 1}** — [diagnosis](${r.diagnosisUrl || '#'}) · [review](${r.reviewUrl || '#'})`,
    bullets(r.points),
  ].join('\n')).join('\n\n')
  return [
    `## 🔀 Blocked — two reviews rejected the diagnosis of \`${check}\``,
    '**Needs:** answer',
    '',
    `@pmcp — PR #${pr} is red on \`${String(sha).slice(0, 7)}\` and the fix-bot could not produce a diagnosis the reviewer accepts, so no fix was made.`,
    '',
    `**Recommendation:** reply \`**Worker:** <the cause>\` to send the worker straight at a cause you name (the reviewer's latest points, ${(last.points || []).length}, are below).`,
    '',
    'A fresh session must not lose: nothing was committed; both diagnoses and both reviews are linked below.',
    '',
    '> 🤖 **pi.dev harness** · agent pipeline (CI) · _fix-bot diagnosis review (#3668)_',
    '',
    '<details><summary>Both rounds</summary>',
    '',
    depth || '(no rounds recorded)',
    '',
    '</details>',
  ].join('\n')
}

/** Issues (#N / issue URLs, at most 5) and run ids a diagnosis links, for the token-less reviewer. */
export function linkedRefs(body, { max = 5 } = {}) {
  const s = String(body || '')
  const issues = []
  for (const m of s.matchAll(/(?:github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/|(?<![\w/&])#)(\d{2,6})\b/g)) {
    const n = Number(m[1])
    if (!issues.includes(n) && issues.length < max) issues.push(n)
  }
  const runs = [...new Set([...s.matchAll(/\/actions\/runs\/(\d+)/g)].map(m => Number(m[1])))].slice(0, 20)
  return { issues, runs }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
const read = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '')
/** All files under the given paths (dirs are walked one level, `.log` only), concatenated. */
const readLogs = (paths) => paths.flatMap(p => {
  if (!p || !existsSync(p)) return []
  if (statSync(p).isDirectory()) return readdirSync(p).filter(f => f.endsWith('.log')).map(f => read(join(p, f)))
  return [read(p)]
}).join('\n')
const readJson = (p) => JSON.parse(read(p) || '{}')
const REJECTED = { verdict: 'reject', checks: [], points: [], errors: [] }

// route <round> <diagnosis.md> <verdict.md> <raw log paths...>
function cliRoute(a) {
  const round = Number(a[0])
  const pre = precheck({ diagnosisBody: read(a[1]), rawLog: readLogs(a.slice(3)) })
  const v = pre.ok ? parseReviewVerdict(read(a[2])) : REJECTED
  const verdict = pre.ok ? v.verdict : 'reject'
  return { round, verdict, next: routeReview({ verdict, round }), precheck: pre, checks: v.checks, points: [...pre.points, ...v.points], errors: v.errors }
}

function cliBase(a) {
  const p = readJson(a[0])
  const withRaw = (js) => (js || []).map(j => ({ ...j, raw: j.raw ?? read(j.log) }))
  return baseVerdict({ prJobs: withRaw(p.prJobs), baseRun: p.baseRun || null, baseJobs: withRaw(p.baseJobs) })
}

/** Paths as given, except a directory expands to its `.log` files (one level). */
const expandLogDirs = (paths) => paths.flatMap(p => (p && existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.log')).map(f => join(p, f)) : [p]))

// handback-marker <sha> <check> <raw log paths...> — '' when no job log has a failing line
function cliHandbackMarker(a) {
  const line = firstFailingLines(expandLogDirs(a.slice(2)).map(read))[0]
  return line ? handbackMarker({ sha: a[0], check: a[1], line }) : ''
}

const COMMANDS = {
  'precheck': (a) => precheck({ diagnosisBody: read(a[0]), rawLog: readLogs(a.slice(1)) }),
  'route': cliRoute,
  // render-review <route.json> <sha> <check> — the 🔎 comment for a `route` result
  'render-review': (a) => renderReview({ ...readJson(a[0]), sha: a[1], check: a[2] }),
  'fix-go': (a) => fixGo(JSON.parse(a[0] || '{}')),
  'base': cliBase,
  'owner-ask': (a) => ownerAsk(readJson(a[0])),
  'handback-marker': cliHandbackMarker,
}

function cli(argv) {
  const [cmd, ...a] = argv
  const run = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null
  if (!run) throw new Error(`usage: diagnosis-review.mjs precheck|route|render-review|fix-go|base|owner-ask|handback-marker … (got ${cmd})`)
  return run(a)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = cli(process.argv.slice(2))
  process.stdout.write((typeof out === 'string' ? out : JSON.stringify(out)) + '\n')
}
