// pipeline-review-run.mjs — GitHub + file I/O for the pipeline review every 10 closed epics (#3254).
// Decisions are pure, in pipeline-review.mjs. pipeline-review.yml calls:
//   count  (github-script { github, context, core })  — open the review issue when ≥ threshold epics closed
//   node scripts/pipeline-review-run.mjs gather <issue> <since> <until> <outDir> --data-dir <dir>
//          read-only: writes the bundle the model reads (the model gets NO token)
//   node scripts/pipeline-review-run.mjs prompt <bundleDir> <outFile>   → the prompt on stdout (#3331)
//   post   (github-script)  — post the review, or the skipped note; never throws
//
// Lookups use the REST list API, never search: search's index lags right after an issue is created,
// so a second count run could miss the review just opened and open a duplicate.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadRecords, runEpicNumbers } from './epic-numbers-run.mjs'
import { isTrustedAuthor, stripCode } from './postmortem.mjs'
import {
  LABEL, DEFAULT_THRESHOLD, decideReview, renderReviewIssue, parseWindow, gatherArgs, qualityDigestFile,
  windowDays, cutDiff, finalizeReport, renderSkipped, reviewState, buildReviewPrompt
} from './pipeline-review.mjs'

const isIssue = i => !i.pull_request
const toEpic = i => ({ number: i.number, title: i.title, closedAt: i.closed_at, url: i.html_url })

/** Count completed epics since the last review; open the review issue when the threshold is met. */
export async function count({ github, context, core }, { threshold = DEFAULT_THRESHOLD, dryRun = false, runUrl, now } = {}) {
  const repo = context.repo
  const out = (go, d, issue = '') => {
    core.setOutput('go', String(go)); core.setOutput('issue', String(issue))
    core.setOutput('since', d?.since || ''); core.setOutput('until', d?.until || '')
    return { go, issue: issue || null, decision: d }
  }
  const last = (await github.rest.issues.listForRepo({ ...repo, labels: LABEL, state: 'all', sort: 'created', direction: 'desc', per_page: 10 })).data.find(isIssue)
  const lastReview = last ? { number: last.number, createdAt: last.created_at } : null
  const since = lastReview?.createdAt
  const items = await github.paginate(github.rest.issues.listForRepo, { ...repo, labels: 'epic', state: 'closed', ...(since ? { since } : {}), per_page: 100 })
  const epics = items
    .filter(i => isIssue(i) && i.state_reason === 'completed' && i.closed_at && (!since || Date.parse(i.closed_at) > Date.parse(since)))
    .map(toEpic)
  const d = decideReview({ lastReview, epics, threshold: Number(threshold) || DEFAULT_THRESHOLD, now: now || new Date().toISOString() })
  core.info(`pipeline review: open=${d.open} (${d.reason})`)
  if (!d.open) return out(false, d)
  const { title, body } = renderReviewIssue({ since: d.since, until: d.until, epics: d.epics, runUrl, repo: `${repo.owner}/${repo.repo}` })
  if (dryRun) {
    core.info(`pipeline review: dry run — would open:\n${title}\n\n${body}`)
    return out(false, d)
  }
  const created = (await github.rest.issues.create({ ...repo, title, body, labels: [LABEL, 'meta:agents'] })).data
  core.info(`pipeline review: opened #${created.number}`)
  return out(true, d, created.number)
}

// ── gather (read-only; CLI) ───────────────────────────────────────────────────

const realGh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const realGit = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const realRunGather = ({ args, cwd, env }) =>
  execFileSync(process.execPath, ['scripts/quality-digest/gather.mjs', ...args], { cwd, env, stdio: 'inherit' })

const lines = s => String(s || '').split('\n').filter(Boolean).map(l => JSON.parse(l))
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n')

/** The trusted comment carrying `marker`, or null. */
const markedComment = (comments, re) => comments.find(c => isTrustedAuthor(c) && re.test(stripCode(c.body))) || null

/** Up to `max` PRs merged into main inside the window, newest first. Stops paging once updates predate the window. */
function mergedPrs({ gh, repo, since, until, max = 20 }) {
  const lo = Date.parse(since), hi = Date.parse(until)
  const found = []
  for (let page = 1; page <= 30; page++) {
    const items = JSON.parse(gh(['api', `repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`]))
    for (const p of items) {
      const t = Date.parse(p.merged_at || '')
      if (p.merged_at && t >= lo && t <= hi) found.push(p)
    }
    if (items.length < 100 || items.every(p => Date.parse(p.updated_at) < lo)) break
  }
  return found.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at)).slice(0, max)
}

/**
 * Write the review bundle. Throws (→ the CLI exits non-zero) only on a broken job: no `records/`
 * folder (the pipeline-data fetch broke) or no quality-digest file after gather.mjs ran.
 */
export async function gather({ issue, since, until, outDir, dataDir, repoDir = process.cwd(), env = process.env, gh = realGh, git = realGit, runGather = realRunGather }) {
  const repo = env.GITHUB_REPOSITORY || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner
  const recordsDir = join(dataDir, 'records')
  if (!existsSync(recordsDir)) throw new Error(`no run records folder at ${recordsDir} — the pipeline-data fetch broke`)
  mkdirSync(outDir, { recursive: true })
  const gaps = { records: null, cutDiffs: [], noDiff: [], metricsMissing: false }
  const c = { gh, git, repo, outDir, dataDir, recordsDir, repoDir, env, since, until, gaps }
  const reviewIssue = JSON.parse(gh(['api', `repos/${repo}/issues/${issue}`]))
  const epicNums = parseWindow(reviewIssue.body)?.epics || []
  const epics = gatherEpics(c, epicNums)
  gatherPrevious(c, issue)
  gatherQuality(c, runGather)
  const prs = gatherPrs(c)
  gatherRecords(c)
  gatherMetrics(c)
  await gatherNumbers(c, epicNums)
  writeJson(join(outDir, 'gaps.json'), gaps)
  return { epics, prs, gaps }
}

// epics.json — each epic plus its postmortem comment.
function gatherEpics({ gh, repo, outDir }, epicNums) {
  const epics = epicNums.map(n => {
    const e = JSON.parse(gh(['api', `repos/${repo}/issues/${n}`]))
    const comments = lines(gh(['api', '--paginate', '--jq', '.[]', `repos/${repo}/issues/${n}/comments?per_page=100`]))
    const pm = markedComment(comments, /<!--\s*postmortem:done\b/)
    return { number: n, title: e.title, url: e.html_url, closedAt: e.closed_at, postmortem: pm?.body || null }
  })
  writeJson(join(outDir, 'epics.json'), epics)
  return epics
}

// previous-review.md — the last review's report, or empty.
function gatherPrevious({ gh, repo, outDir }, issue) {
  const reviews = JSON.parse(gh(['api', `repos/${repo}/issues?labels=${LABEL}&state=all&sort=created&direction=desc&per_page=10`]))
  const prev = reviews.find(r => !r.pull_request && Number(r.number) !== Number(issue))
  let previous = ''
  if (prev) {
    const cs = lines(gh(['api', '--paginate', '--jq', '.[]', `repos/${repo}/issues/${prev.number}/comments?per_page=100`]))
    previous = markedComment(cs, /<!--\s*pipeline-review:report\b/)?.body || ''
  }
  writeFileSync(join(outDir, 'previous-review.md'), previous)
}

// quality.json — gather.mjs, then its own dash-free output file. Missing file = broken job.
function gatherQuality({ since, until, repoDir, env, outDir }, runGather) {
  const args = gatherArgs({ since, until })
  runGather({ args, cwd: repoDir, env })
  const qFile = join(repoDir, qualityDigestFile(args[3]))
  if (!existsSync(qFile)) throw new Error(`quality digest not written — expected ${qFile}`)
  copyFileSync(qFile, join(outDir, 'quality.json'))
}

// merged-prs.json + diffs/<N>.diff — each PR's net change (merge^1..merge), cut to a fixed size.
function gatherPrs(c) {
  const { gh, repo, since, until, outDir } = c
  mkdirSync(join(outDir, 'diffs'), { recursive: true })
  const prs = mergedPrs({ gh, repo, since, until }).map(p => prEntry(c, p))
  writeJson(join(outDir, 'merged-prs.json'), prs)
  return prs
}

function prEntry({ gh, git, repo, repoDir, outDir, gaps }, p) {
  const files = lines(gh(['api', '--paginate', '--jq', '.[] | .filename | tojson', `repos/${repo}/pulls/${p.number}/files?per_page=100`]))
  const entry = { number: p.number, title: p.title, url: p.html_url, mergeCommit: p.merge_commit_sha, files, diffFile: null, diffBytes: 0, keptBytes: 0, cut: false }
  try {
    const d = cutDiff(git(['diff', `${p.merge_commit_sha}^1`, p.merge_commit_sha], repoDir))
    writeFileSync(join(outDir, 'diffs', `${p.number}.diff`), d.text)
    Object.assign(entry, { diffFile: `diffs/${p.number}.diff`, diffBytes: d.bytes, keptBytes: d.keptBytes, cut: d.cut })
    if (d.cut) gaps.cutDiffs.push(p.number)
  } catch (e) {
    entry.diffError = String(e?.message || e).split('\n')[0].slice(0, 200)
    gaps.noDiff.push(p.number)
  }
  return entry
}

// records.json — the window's day folders, read with #3253's loadRecords; none → records-missing.txt.
function gatherRecords({ recordsDir, since, until, outDir, gaps }) {
  const days = windowDays({ since, until }).filter(d => existsSync(join(recordsDir, d)))
  if (days.length) {
    writeJson(join(outDir, 'records.json'), days.flatMap(d => loadRecords(join(recordsDir, d))))
  } else {
    gaps.records = 'no run records in this span'
    writeFileSync(join(outDir, 'records-missing.txt'), `no run records in this span: ${since}…${until}\n`)
  }
}

// metrics.json — the hourly metrics, or metrics-missing.txt.
function gatherMetrics({ dataDir, outDir, gaps }) {
  const metrics = join(dataDir, 'metrics', 'latest.json')
  if (existsSync(metrics)) copyFileSync(metrics, join(outDir, 'metrics.json'))
  else {
    gaps.metricsMissing = true
    writeFileSync(join(outDir, 'metrics-missing.txt'), `no metrics/latest.json in pipeline-data\n`)
  }
}

// epic-numbers/<N>.json — the stored file, else computed by #3253's runEpicNumbers. Never the model.
async function gatherNumbers({ gh, repo, env, dataDir, recordsDir, outDir }, epicNums) {
  const numDir = join(outDir, 'epic-numbers')
  mkdirSync(numDir, { recursive: true })
  const missing = []
  const tmp = mkdtempSync(join(tmpdir(), 'review-numbers-'))
  for (const n of epicNums) {
    const stored = join(dataDir, 'epics', `${n}.json`)
    if (existsSync(stored)) { copyFileSync(stored, join(numDir, `${n}.json`)); continue }
    const dir = join(tmp, String(n))
    await runEpicNumbers({ epic: n, outDir: dir, recordsDir, gh, env: { ...env, GITHUB_REPOSITORY: repo } })
    if (existsSync(join(dir, 'numbers.json'))) copyFileSync(join(dir, 'numbers.json'), join(numDir, `${n}.json`))
    else missing.push(`#${n} — ${failedReason(dir)}`)
  }
  if (missing.length) writeFileSync(join(numDir, 'missing.txt'), missing.join('\n') + '\n')
}

const failedReason = dir => readOr(join(dir, 'numbers-failed.txt'), '').trim() || 'the numbers step wrote nothing'

// ── post ──────────────────────────────────────────────────────────────────────

const readOr = (file, fallback) => { try { return readFileSync(file, 'utf8') } catch { return fallback } }

/** Post the review (or the skipped note) on the review issue. Never throws. */
export async function post({ github, context, core }, { issue, modelFile, gapsFile, runUrl, writeResult } = {}) {
  const n = Number(issue)
  try {
    const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: n, per_page: 100 })
    if (reviewState(comments) === 'report') return core.info(`pipeline review: #${n} already has a report — posting nothing.`)
    let gaps = null
    try { gaps = JSON.parse(readOr(gapsFile, 'null')) } catch { /* unreadable → no gaps line */ }
    const body = finalizeReport({ text: readOr(modelFile, ''), gaps }) || renderSkipped({ runUrl, gaps })
    await github.rest.issues.createComment({ ...context.repo, issue_number: n, body })
    core.info(`pipeline review: posted ${body.includes('pipeline-review:report') ? 'the report' : `the skipped note (write: ${writeResult || '?'})`} on #${n}`)
  } catch (e) {
    core.warning(`pipeline review: posting on #${n} failed — ${e.message}`)
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (cmd === 'prompt') {
    const [, bundleDir, outFile] = argv
    process.stdout.write(buildReviewPrompt({ bundleDir, outFile }) + '\n')
  } else if (cmd === 'gather') {
    const i = argv.indexOf('--data-dir')
    const dataDir = i >= 0 ? argv[i + 1] : null
    const [, issue, since, until, outDir] = i < 0 ? argv : argv.filter((_, j) => j !== i && j !== i + 1)
    if (!dataDir || !outDir) {
      console.error('usage: node scripts/pipeline-review-run.mjs gather <issue> <since> <until> <outDir> --data-dir <dir>')
      process.exit(2)
    }
    try {
      const { epics, prs, gaps } = await gather({ issue, since, until, outDir, dataDir })
      console.log(`pipeline review bundle: ${epics.length} epics, ${prs.length} PRs, gaps ${JSON.stringify(gaps)}`)
    } catch (e) {
      console.error(`::error::pipeline review gather failed — ${e.message}`)
      process.exit(1)
    }
  } else {
    console.log('usage: node scripts/pipeline-review-run.mjs gather|prompt …')
  }
}
