// Start the conflict resolver for an epic → main PR that conflicts with main (#2875, #3227).
// ONE place for the sweep (automerge-epic-subpr.yml) and the owner-`ok` job (on-comment.yml
// approve-epic), so the marker, the 30-minute guard and the dispatch cannot drift apart.
// GitHub runs no checks on a conflicting PR, so without this an `ok` waits forever.

/** `mergeable_state`, re-read while GitHub still says `unknown` (it computes it lazily). */
export async function mergeableState({ github, owner, repo, pull_number, tries = 6, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let pr
  for (let i = 0; i < tries; i++) {
    pr = (await github.rest.pulls.get({ owner, repo, pull_number })).data
    if (pr.merged || pr.state !== 'open') break
    if (pr.mergeable_state && pr.mergeable_state !== 'unknown') break
    if (i < tries - 1) await sleep(5000)
  }
  return { pr, state: pr?.mergeable_state }
}

/** The pipeline's own bot accounts: the ONE list (the sweep imports it too). */
export const PIPELINE_BOTS = ['claude[bot]', 'nuxt-harness[bot]']

/**
 * If `state` is `dirty`, start the resolver once per head. Returns
 * `{ status }`: not-dirty | started | already | recent | error (+ `error`).
 * `handoffGuard` is injected: (descriptor, fn) => Promise.
 */
export async function startConflictResolver({ github, owner, repo, pull_number, pr, state, handoffGuard, now = Date.now() }) {
  if (state !== 'dirty') return { status: 'not-dirty' }
  // The branch name goes into a worker shell line: only a pipeline-authored `epic/…` PR may start it.
  if (!PIPELINE_BOTS.includes(pr.user?.login) || !/^epic\/\d+-[\w.\/-]*$/.test(pr.head.ref)) return { status: 'not-pipeline' }
  const marker = `<!-- epic-conflict-resolve:${pr.head.sha} -->`
  const prior = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: pull_number, per_page: 100 })
  // Concurrent callers all see "no marker yet" for the same head (#2914), so also hold off
  // while ANY resolver note on this PR is under 30 minutes old: one run per branch at a time.
  if (prior.some(x => (x.body || '').includes('<!-- epic-conflict-resolve:') && now - Date.parse(x.created_at) < 30 * 60 * 1000)) return { status: 'recent' }
  if (prior.some(x => (x.body || '').includes(marker))) return { status: 'already' }
  const epicIssue = Number(/^epic\/(\d+)-/.exec(pr.head.ref)?.[1])
  try {
    const note = await github.rest.issues.createComment({ owner, repo, issue_number: pull_number,
      body: `${marker}\n<!-- pipeline-note -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _epic PR conflicts with main (#2875)_\n\n`
        + `🔧 **This PR conflicts with \`main\`.** The pi worker is merging \`main\` into \`${pr.head.ref}\` and resolving the conflicts (a merge, never a rebase). Instruction: bring this branch up to date with main.` })
    const inputs = { issue: String(epicIssue), feedback: String(note.data.id), branch: pr.head.ref }
    await handoffGuard({ kind: 'dispatch', issue: pull_number, workflow: 'work-issue-pidev.yml', inputs },
      () => github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: 'work-issue-pidev.yml', ref: 'main', inputs }))
    return { status: 'started' }
  } catch (e) { return { status: 'error', error: e.message } }
}

/** The owner-facing reply for a resolver result (never "merges when the checks finish"). */
export function resolverReply({ status, error }, head) {
  if (status === 'started') return '🔧 **Approved — this PR conflicts with `main`, so the pipeline is merging `main` in first.** It merges itself once the checks pass after that, while your `ok` stands.'
  if (status === 'already' || status === 'recent') return `🔧 **Approved — this PR conflicts with \`main\`, and the pipeline is already merging \`main\` in** (a resolver note on \`${head}\` is recent). It merges itself once the checks pass after that.`
  if (status === 'not-pipeline') return '🔴 **Approved, but this PR conflicts with `main` and it is not a pipeline PR — resolve the conflict by hand.** Nothing was started; your `ok` stands.'
  return `🔴 **Approved, but this PR conflicts with \`main\` and the resolver could not be started** (${error || 'unknown error'}). Checks cannot run until the conflict is resolved; your \`ok\` stands.`
}

/** The owner-`ok` entry (#3227): true when the PR conflicts and the reply has been said. */
export async function replyIfConflicting({ github, owner, repo, pull_number, handoffGuard, say, sleep }) {
  handoffGuard ??= (await import('../handoff-exec.mjs')).handoffGuard
  const { pr, state } = await mergeableState({ github, owner, repo, pull_number, sleep })
  if (state !== 'dirty') return false
  await say(resolverReply(await startConflictResolver({ github, owner, repo, pull_number, pr, state, handoffGuard }), pr.head.ref))
  return true
}
