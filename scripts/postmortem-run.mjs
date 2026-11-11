// postmortem-run.mjs — GitHub I/O for the pipeline epic postmortem (#3425). The decisions are pure,
// in postmortem.mjs. `target` and `post` take the github-script `{ github, context, core }` (same
// shape as owner-quiz-run.mjs) and are called from postmortem.yml. The prompt is written by the CLI:
//   node scripts/postmortem-run.mjs prompt <epic> <outFile> > prompt.txt
// `post` never throws: a GitHub error is logged and the skip + close path is still tried, so a
// broken postmortem never holds an epic open.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseEpicNumber } from './epic-ready.mjs'
import { decidePostmortemRun, postmortemState, pendingClose, finalizeBody, renderSkipped, buildPostmortemPrompt } from './postmortem.mjs'
import { decideEpicClose } from './handle-test-reply.mjs'

const labelNames = ls => (ls || []).map(l => (typeof l === 'string' ? l : l.name))
const listComments = ({ github, context }, issue_number) =>
  github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number, per_page: 100 })
const listSubIssues = ({ github, context }, issue_number) =>
  github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...context.repo, issue_number, per_page: 100 })

/** Which epic, and whether to run. Sets outputs `go` and `epic`. */
export async function target({ github, context, core }, { epic, headRef, closedIssue, manual }) {
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
  const d = decidePostmortemRun({
    isEpic: labelNames(issue.labels).includes('epic'),
    subIssues: await listSubIssues({ github, context }, n),
    comments: await listComments({ github, context }, n),
    manual: !!manual
  })
  return out(d.go, n, d.reason)
}

const safe = async (core, what, fn) => {
  try { return await fn() } catch (e) { core.warning(`postmortem: ${what} failed — ${e.message}`); return undefined }
}

/** Post the model's postmortem (or the skipped note), flip the labels, close a pending epic. */
export async function post({ github, context, core }, { epic, modelFile, runUrl }) {
  const n = Number(epic)
  const repo = context.repo
  const say = body => github.rest.issues.createComment({ ...repo, issue_number: n, body })
  const comments = (await safe(core, 'reading comments', () => listComments({ github, context }, n))) || []
  let state = postmortemState(comments)
  if (state === 'done') {
    core.info(`postmortem: #${n} already has a postmortem — posting nothing.`)
  } else {
    let text = ''
    try { text = readFileSync(modelFile, 'utf8') } catch { /* the model wrote nothing */ }
    const body = finalizeBody({ epic: n, text })
    const posted = body && await safe(core, 'posting the postmortem', () => say(body))
    if (posted) {
      state = 'done'
      core.info(`postmortem: posted on #${n}`)
    } else {
      state = 'skipped'
      await safe(core, 'posting the skipped note', () => say(renderSkipped({ epic: n, runUrl })))
      core.warning(`postmortem: no usable postmortem for #${n} — posted the skipped note.`)
    }
    // Flip the labels now (the daily labeller agrees: done or skipped → ready-to-close, never blocks).
    await safe(core, 'removing needs-postmortem', () => github.rest.issues.removeLabel({ ...repo, issue_number: n, name: 'status:needs-postmortem' }))
    // remove-then-add so the `labeled` event fires even when the label was already there
    await safe(core, 'removing ready-to-close', () => github.rest.issues.removeLabel({ ...repo, issue_number: n, name: 'status:ready-to-close' }))
    await safe(core, 'adding ready-to-close', () => github.rest.issues.addLabels({ ...repo, issue_number: n, labels: ['status:ready-to-close'] }))
  }
  await safe(core, 'closing the pending epic', () => closePending({ github, context, core }, { n, comments, state }))
}

// The close the two close paths left waiting (#3425). Only a pipeline-authored pending marker arms it.
async function closePending({ github, context, core }, { n, comments, state }) {
  const via = pendingClose(comments)
  if (!via) return core.info(`postmortem: no close is waiting on #${n}.`)
  const repo = context.repo
  const issue = (await github.rest.issues.get({ ...repo, issue_number: n })).data
  if (issue.state !== 'open') return core.info(`postmortem: #${n} is already closed.`)
  if (via === 'verified') {
    const subIssues = await listSubIssues({ github, context }, n)
    const pulls = (await github.rest.pulls.list({ ...repo, state: 'all', base: 'main', per_page: 100 })).data
    const prs = pulls.filter(p => p.head.ref.startsWith(`epic/${n}-`))
    const c = decideEpicClose({ subIssues, prs, postmortem: state })
    if (!c.close) {
      await github.rest.issues.createComment({ ...repo, issue_number: n, body: `<!-- pipeline-note -->\n${c.comment}` })
      return core.info(`postmortem: #${n} left open — ${c.comment}`)
    }
  }
  await github.rest.issues.update({ ...repo, issue_number: n, state: 'closed', state_reason: 'completed' })
  const why = state === 'done' ? 'postmortem posted' : "postmortem didn't run, closing anyway"
  await github.rest.issues.createComment({ ...repo, issue_number: n,
    body: `<!-- pipeline-note -->\n✅ **Closed — ${why}** (waiting since \`${via === 'verified' ? 'verified' : '/close-epic'}\`).` })
  core.info(`postmortem: closed #${n} (${via}).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, epic, outFile] = process.argv.slice(2)
  if (cmd !== 'prompt' || !Number(epic) || !outFile) {
    console.error('usage: node scripts/postmortem-run.mjs prompt <epic> <outFile>')
    process.exit(1)
  }
  process.stdout.write(buildPostmortemPrompt({ epic: Number(epic), outFile }) + '\n')
}
