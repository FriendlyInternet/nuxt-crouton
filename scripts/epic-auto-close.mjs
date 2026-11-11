// epic-auto-close.mjs — close a finished epic by itself (#3012). An epic closes only when ALL hold:
//   1. its epic/<N>-… → main PR has merged;
//   2. its staging test card got the owner's `ok` (status:verified) — or it never gets a card
//      (the merged PR touched nothing Deploy Apps deploys, e.g. a pipeline-only epic);
//   3. its postmortem is posted (<!-- postmortem:done -->; a `skipped` one waits — re-run or /close-epic).
// Plus a guard: every sub-issue is closed. `/close-epic` stays as the owner's fallback.
//
// decideAutoClose() is pure; runAutoClose() does the I/O with the github-script context. It runs
// from the `auto-close` job in postmortem.yml (Harness App token, so the close cascades into
// on-issue-close.yml). That workflow starts on the merge, on a sub-issue close, after a postmortem
// posts, and by dispatch from the test-card `ok` handler — so whichever moment is last closes it.
import { postmortemState, isPipelineAuthor } from './postmortem.mjs'
import { CARD_MARKER } from './test-card.mjs'
import { fileMatchesAny } from './deploy-detect.mjs'

/** Copy of `on.push.paths` in .github/workflows/deploy-apps.yml (drift-guarded by the test). */
export const DEPLOY_PATHS = [
  'apps/**',
  'packages/**',
  'pnpm-lock.yaml',
  '.github/workflows/deploy-apps.yml',
  '.github/workflows/deploy-app.yml'
]

const labelNames = ls => (ls || []).map(l => (typeof l === 'string' ? l : l.name))
const epicPrs = (pulls, n) => (pulls || []).filter(p => String(p?.head?.ref || '').startsWith(`epic/${n}-`))

/**
 * @param {{ state?: string, labels?: string[], subIssues?: object[], prs?: object[], comments?: object[], prFiles?: string[] }} input
 *   prs: the epic's epic/<N>- → main PRs · prFiles: the files the merged ones changed
 * @returns {{ action: 'none'|'wait'|'close', reason: string, waiting: string[] }}
 */
export function decideAutoClose({ state = 'open', labels = [], subIssues = [], prs = [], comments = [], prFiles = [] } = {}) {
  if (state === 'closed') return { action: 'none', reason: 'epic already closed', waiting: [] }
  if (!labels.includes('epic')) return { action: 'none', reason: 'not an epic', waiting: [] }
  const waiting = []
  for (const k of subIssues || []) if (k.state !== 'closed') waiting.push(`#${k.number} (sub-issue still open)`)
  const openPrs = (prs || []).filter(p => p.state === 'open')
  for (const p of openPrs) waiting.push(`#${p.number} (epic→main PR still open)`)
  const merged = (prs || []).some(p => p.merged_at)
  if (!merged && !openPrs.length) waiting.push('not on main yet')
  const hasCard = (comments || []).some(c => isPipelineAuthor(c) && String(c.body || '').includes(CARD_MARKER))
  if (labels.includes('status:failed')) waiting.push('test card answered not ok — fix sub-issue')
  else if (labels.includes('status:to-test')) waiting.push('test card waiting on your ok')
  else if (!labels.includes('status:verified') && !hasCard && merged && (prFiles || []).some(f => fileMatchesAny(f, DEPLOY_PATHS))) {
    waiting.push('test card not posted yet — waits for the staging deploy')
  }
  const pm = postmortemState(comments)
  if (pm === null) waiting.push('postmortem not posted')
  else if (pm === 'skipped') waiting.push("postmortem didn't run — re-run postmortem.yml or /close-epic")
  if (waiting.length) return { action: 'wait', reason: waiting.join(', '), waiting }
  return { action: 'close', reason: 'on main, test card ok (or none needed), postmortem posted', waiting: [] }
}

/** Every input decideAutoClose needs, read with the github-script octokit. */
export async function readAutoCloseInputs({ github, context }, n) {
  const repo = context.repo
  const issue = (await github.rest.issues.get({ ...repo, issue_number: n })).data
  const subIssues = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...repo, issue_number: n, per_page: 100 })
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: n, per_page: 100 })
  const prs = epicPrs((await github.rest.pulls.list({ ...repo, state: 'all', base: 'main', per_page: 100 })).data, n)
  const prFiles = []
  for (const p of prs.filter(x => x.merged_at)) {
    const files = await github.paginate(github.rest.pulls.listFiles, { ...repo, pull_number: p.number, per_page: 100 })
    prFiles.push(...files.map(f => f.filename))
  }
  return { issue, input: { state: issue.state, labels: labelNames(issue.labels), subIssues, prs, comments, prFiles } }
}

/** Decide, and on `close` close the epic as completed + strip its status:* labels + say so once. */
export async function runAutoClose({ github, context, core }, { epic, via = 'dispatch' }) {
  const n = Number(epic)
  if (!n) return core.info('epic-auto-close: no epic number — nothing to do.')
  const repo = context.repo
  const { issue, input } = await readAutoCloseInputs({ github, context }, n)
  const d = decideAutoClose(input)
  if (d.action !== 'close') return core.info(`epic-auto-close: #${n} ${d.action} — ${d.reason}`)
  // Two runs can race (merge + sub-issue close): re-read right before closing.
  const now = (await github.rest.issues.get({ ...repo, issue_number: n })).data
  if (now.state !== 'open') return core.info(`epic-auto-close: #${n} is already closed.`)
  await github.rest.issues.update({ ...repo, issue_number: n, state: 'closed', state_reason: 'completed' })
  for (const name of labelNames(now.labels || issue.labels).filter(l => l.startsWith('status:'))) {
    try { await github.rest.issues.removeLabel({ ...repo, issue_number: n, name }) } catch { /* already gone */ }
  }
  await github.rest.issues.createComment({ ...repo, issue_number: n,
    body: `<!-- pipeline-note -->\n✅ **Epic closed by itself** — on main, test card ok (or none needed), postmortem posted. _(checked on: ${via})_` })
  core.info(`epic-auto-close: closed #${n} (${via}).`)
}
