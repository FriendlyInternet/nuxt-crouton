// postmortem-run.mjs — GitHub I/O for the pipeline epic postmortem (#3425). The decisions are pure,
// in postmortem.mjs. `target` and `post` take the github-script `{ github, context, core }` (same
// shape as owner-quiz-run.mjs) and are called from postmortem.yml. The prompt is written by the CLI:
//   node scripts/postmortem-run.mjs prompt <epic> <outFile> > prompt.txt
// `post` never throws: a GitHub error is logged and the skip + close path is still tried, so a
// broken postmortem never holds an epic open.
//
// Numbers (#3253): `post` appends the epic's numbers (numbers.md, written by epic-numbers-run.mjs in the
// `write` job next to the model's file) and stores numbers.json as `epics/<N>.json` on `pipeline-data`.
// Both are report-only: a missing or failed numbers step only changes one line, never the post/close.
// `dryRun`: a hand-started run that posts nothing — the body goes to the job summary.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRecord } from './eval-ledger/record-run.mjs'
import { parseEpicNumber } from './epic-ready.mjs'
import { decidePostmortemRun, postmortemState, pendingClose, finalizeBody, renderSkipped, buildPostmortemPrompt } from './postmortem.mjs'
import { stepsPending } from './lib/epic-steps.mjs'

const labelNames = ls => (ls || []).map(l => (typeof l === 'string' ? l : l.name))
const listComments = ({ github, context }, issue_number) =>
  github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number, per_page: 100 })
const listSubIssues = ({ github, context }, issue_number) =>
  github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...context.repo, issue_number, per_page: 100 })

/** Which epic, and whether to run. Sets outputs `go` and `epic`. */
export async function target({ github, context, core }, { epic, headRef, closedIssue, manual, dryRun }) {
  const out = (go, n, why) => {
    core.info(`postmortem target: epic ${n ?? '-'} go=${go} (${why})`)
    core.setOutput('go', String(go)); core.setOutput('epic', String(n ?? ''))
    return { go, epic: n }
  }
  let n = Number(epic) || parseEpicNumber(headRef) || null
  if (!n && Number(closedIssue)) {
    try {
      n = (await github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/parent', { ...context.repo, issue_number: Number(closedIssue) })).data.number
    } catch (e) {
      if (e.status === 404) return out(false, null, `#${closedIssue} is not a sub-issue`)
      throw e
    }
  }
  if (!n) return out(false, null, 'no epic to look at')
  const issue = (await github.rest.issues.get({ ...context.repo, issue_number: n })).data
  const labels = labelNames(issue.labels)
  const subIssues = await listSubIssues({ github, context }, n)
  const comments = await listComments({ github, context }, n)
  const d = decidePostmortemRun({
    isEpic: labels.includes('epic'),
    subIssues,
    comments,
    manual: !!manual,
    dryRun: !!dryRun,
    pendingSteps: stepsPending({ labels, comments, subIssues }) // #3846: a rolling epic waits for its last step
  })
  return out(d.go, n, d.reason)
}

/**
 * The `write` job re-checks just before the model runs (#3425 review): runs started by different events
 * queue on one epic, and the check in `target` happened before the queue — so a run that waited behind
 * one which already posted must not spend another model run. Sets output `done` ('true' | 'false').
 */
export async function alreadyPosted({ github, context, core }, { epic, dryRun }) {
  const n = Number(epic)
  const posted = postmortemState(await listComments({ github, context }, n)) === 'done'
  const done = posted && !dryRun
  if (posted && dryRun) core.info(`postmortem: #${n} already has a postmortem — dry run — running the model anyway.`)
  else core.info(`postmortem: #${n} ${done ? 'already has a postmortem — skipping the model run' : 'has no postmortem yet'}.`)
  core.setOutput('done', String(done))
  return done
}

const safe = async (core, what, fn) => {
  try { return await fn() } catch (e) { core.warning(`postmortem: ${what} failed — ${e.message}`); return undefined }
}

const readOr = (file, fallback = null) => { try { return readFileSync(file, 'utf8') } catch { return fallback } }

/** The numbers files next to the model's file. A missing numbers.md with no failed file has a reason too. */
export function readNumbers(modelFile) {
  const dir = dirname(modelFile)
  const failed = readOr(join(dir, 'numbers-failed.txt'))
  const numbers = readOr(join(dir, 'numbers.md'))
  let json = null
  try { json = JSON.parse(readOr(join(dir, 'numbers.json'), 'null')) } catch { /* unreadable → not stored */ }
  const numbersFailed = failed?.trim() || (numbers?.trim() ? null : 'the numbers step wrote nothing')
  return { numbers: numbersFailed ? null : numbers, numbersFailed, json: numbersFailed ? null : json }
}

const summarize = async (core, heading, text) => {
  if (!core.summary) return core.info(`${heading}\n${text}`)
  await core.summary.addHeading(heading, 2).addRaw(`\n\n${text}\n`).write()
}

// Store the numbers as `epics/<N>.json` (overwrite: a hand retry updates it). Never throws; a failure is
// visible in the job summary and the `numbers_stored` output, not only a log line.
async function storeNumbers({ core }, { n, json, runUrl, dataToken, repo, store }) {
  let reason = null
  if (!json) reason = 'no numbers to store'
  else if (!dataToken) reason = 'no data token'
  else {
    try {
      const record = { ...json, epic: n, run: runUrl || null, stored_at: new Date().toISOString() }
      await store({ repo: `${repo.owner}/${repo.repo}`, token: dataToken, record, path: `epics/${n}.json`, message: `data: epic ${n} numbers`, overwrite: true })
      core.info(`postmortem: stored epics/${n}.json on pipeline-data.`)
    } catch (e) { reason = e.message }
  }
  core.setOutput('numbers_stored', String(!reason))
  if (reason) {
    core.warning(`postmortem: numbers not stored — ${reason}`)
    await safe(core, 'writing the summary', () => summarize(core, '📊 Numbers not stored', `📊 Numbers not stored — ${reason}`))
  }
  return !reason
}

/** Post the model's postmortem (or the skipped note), flip the labels, close a pending epic. */
export async function post({ github, context, core }, { epic, modelFile, runUrl, writeResult, dryRun = false, dataToken, store = writeRecord }) {
  const n = Number(epic)
  const repo = context.repo
  // A cancelled `write` is a run that another start for the same epic replaced in the queue (GitHub
  // keeps one waiting job per concurrency group), or a run a human cancelled. Either way another run
  // owns this epic: posting "didn't run" + closing here would close it while the real postmortem is
  // still being written. A model that hangs is a FAILURE, not a cancel: the step's own timeout fires
  // before the job's, so the never-blocks path below still covers it.
  if (writeResult === 'cancelled') {
    return core.info(`postmortem: the model run for #${n} was cancelled (replaced by a newer run) — posting nothing, closing nothing.`)
  }
  const nums = readNumbers(modelFile)
  const tail = { numbers: nums.numbers, numbersFailed: nums.numbersFailed, runUrl }
  if (dryRun) {
    const body = finalizeBody({ epic: n, text: readOr(modelFile, ''), ...tail }) || renderSkipped({ epic: n, ...tail })
    await safe(core, 'writing the dry-run summary', () => summarize(core, 'Dry run — nothing was posted', body))
    return core.info(`postmortem: dry run for #${n} — posted nothing, changed no label, stored nothing, closed nothing.`)
  }
  const say = body => github.rest.issues.createComment({ ...repo, issue_number: n, body })
  const comments = (await safe(core, 'reading comments', () => listComments({ github, context }, n))) || []
  let state = postmortemState(comments)
  const alreadyDone = state === 'done'
  if (alreadyDone) {
    core.info(`postmortem: #${n} already has a postmortem — posting nothing.`)
  } else {
    const text = readOr(modelFile, '') // '' = the model wrote nothing
    const body = finalizeBody({ epic: n, text, ...tail })
    const posted = body && await safe(core, 'posting the postmortem', () => say(body))
    if (posted) {
      state = 'done'
      core.info(`postmortem: posted on #${n}`)
    } else {
      state = 'skipped'
      await safe(core, 'posting the skipped note', () => say(renderSkipped({ epic: n, ...tail })))
      core.warning(`postmortem: no usable postmortem for #${n} — posted the skipped note.`)
    }
    // Flip the labels now (the daily labeller agrees: done or skipped → ready-to-close, never blocks).
    await safe(core, 'removing needs-postmortem', () => github.rest.issues.removeLabel({ ...repo, issue_number: n, name: 'status:needs-postmortem' }))
    // remove-then-add so the `labeled` event fires even when the label was already there
    await safe(core, 'removing ready-to-close', () => github.rest.issues.removeLabel({ ...repo, issue_number: n, name: 'status:ready-to-close' }))
    await safe(core, 'adding ready-to-close', () => github.rest.issues.addLabels({ ...repo, issue_number: n, labels: ['status:ready-to-close'] }))
  }
  await safe(core, 'closing the pending epic', () => closePending({ github, context, core }, { n, comments, state }))
  // Last, so posting, labels and the close never wait on it (#3253).
  if (!alreadyDone) await storeNumbers({ core }, { n, json: nums.json, runUrl, dataToken, repo, store })
}

// The close `/close-epic` left waiting (#3425). Only a pipeline-authored pending marker arms it.
// A `verified` marker (written before #3012) no longer closes here: the `auto-close` job decides.
async function closePending({ github, context, core }, { n, comments, state }) {
  const via = pendingClose(comments)
  if (!via) return core.info(`postmortem: no close is waiting on #${n}.`)
  if (via !== 'close-epic') return core.info(`postmortem: #${n} pending via ${via} — the auto-close job decides.`)
  const repo = context.repo
  const issue = (await github.rest.issues.get({ ...repo, issue_number: n })).data
  if (issue.state !== 'open') return core.info(`postmortem: #${n} is already closed.`)
  await github.rest.issues.update({ ...repo, issue_number: n, state: 'closed', state_reason: 'completed' })
  const why = state === 'done' ? 'postmortem posted' : "postmortem didn't run, closing anyway"
  await github.rest.issues.createComment({ ...repo, issue_number: n,
    body: `<!-- pipeline-note -->\n✅ **Closed — ${why}** (waiting since \`/close-epic\`).` })
  core.info(`postmortem: closed #${n} (${via}).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const [cmd, epic, outFile] = argv
  if (cmd !== 'prompt' || !Number(epic) || !outFile) {
    console.error('usage: node scripts/postmortem-run.mjs prompt <epic> <outFile> [--numbers <f>] [--steps <f>] [--dry-run]')
    process.exit(1)
  }
  process.stdout.write(buildPostmortemPrompt({
    epic: Number(epic), outFile, numbersFile: flag('--numbers'), stepsFile: flag('--steps'), dryRun: argv.includes('--dry-run')
  }) + '\n')
}
