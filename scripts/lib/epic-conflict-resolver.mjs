// Shared epic → main conflict handling (#2875 sweep, #3227 owner `ok`).
// GitHub calls are injected via `github` (octokit shape) so this is unit-testable.

const RESOLVER_WINDOW_MS = 30 * 60 * 1000

export const isConflicting = pr => pr?.mergeable_state === 'dirty'

/** Poll until GitHub has computed mergeable_state (it is lazy). Returns the latest pr. */
export async function waitForMergeableState({
  github, owner, repo, pull_number, tries = 6, delayMs = 5000,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
}) {
  let pr
  for (let i = 0; i < tries; i++) {
    pr = (await github.rest.pulls.get({ owner, repo, pull_number })).data
    if (pr.merged || pr.state !== 'open') break
    if (pr.mergeable_state && pr.mergeable_state !== 'unknown') break
    if (i < tries - 1) await sleep(delayMs)
  }
  return pr
}

/** Start the conflict resolver once per head (marker) and once per 30 min (any resolver note). */
export async function startConflictResolver({ github, owner, repo, pr, now = Date.now }) {
  const pull_number = pr.number
  const marker = `<!-- epic-conflict-resolve:${pr.head.sha} -->`
  const prior = await github.paginate(github.rest.issues.listComments,
    { owner, repo, issue_number: pull_number, per_page: 100 })
  if (prior.some(x => (x.body || '').includes(marker))) return { started: false, reason: 'marker-exists' }
  // Concurrent runs all see "no marker yet" for the same head (#2914): hold off while ANY note is fresh.
  const recent = prior.some(x => (x.body || '').includes('<!-- epic-conflict-resolve:')
    && now() - Date.parse(x.created_at) < RESOLVER_WINDOW_MS)
  if (recent) return { started: false, reason: 'recent-resolver' }
  const epicIssue = Number(/^epic\/(\d+)-/.exec(pr.head.ref)?.[1])
  try {
    const note = await github.rest.issues.createComment({ owner, repo, issue_number: pull_number,
      body: `${marker}\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _epic PR conflicts with main (#2875)_\n\n`
        + `🔧 **This PR conflicts with \`main\`.** The pi worker is merging \`main\` into \`${pr.head.ref}\` and resolving the conflicts (a merge, never a rebase). Instruction: bring this branch up to date with main.` })
    await github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: 'work-issue-pidev.yml', ref: 'main',
      inputs: { issue: String(epicIssue), feedback: String(note.data.id), branch: pr.head.ref } })
    return { started: true, reason: 'started' }
  } catch (e) {
    return { started: false, reason: 'dispatch-failed', error: e.message }
  }
}

/** approve-epic ordering: a conflict check precedes the wait/merge split. */
export function approveEpicPlan({ decision, pr }) {
  const action = decision?.action
  if (action === 'wait' || action === 'merge') return isConflicting(pr) ? 'resolve-conflict' : action
  if (action === 'red') return 'red'
  return 'ignore'
}
