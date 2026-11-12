// close-epic.mjs — the `/close-epic` comment command (#856), moved out of on-comment.yml (#3425).
// A maintainer comments `/close-epic` on an epic carrying `epic` + `status:ready-to-close` → closed.
// New (#3425): when the only thing missing is `status:ready-to-close` and the epic is done but has no
// postmortem yet, the pipeline postmortem is started and the close is left pending; postmortem.yml
// closes the epic once the postmortem posts (or once it fails — it never blocks).
// Decisions are pure (decideCloseEpic); runCloseEpic does the I/O with the github-script context
// (on-comment.yml `close-epic`, Harness App token, so the close cascades into on-issue-close.yml).
import { decidePostmortemRun, pendingClose, renderPending } from './postmortem.mjs'

export const COMMAND_RE = /(^|\s)\/close-epic(\s|$)/i
const REQUIRED = ['epic', 'status:ready-to-close']

/**
 * @returns {{ action: 'ignore', reason: string }
 *   | { action: 'refuse', missing: string[] }
 *   | { action: 'pending' } | { action: 'already-pending' } | { action: 'close' }}
 */
export function decideCloseEpic({ labels = [], perm = 'none', state = 'open', postmortemGo = false, pending = null } = {}) {
  if (state === 'closed') return { action: 'ignore', reason: 'epic already closed' }
  if (!['admin', 'write'].includes(perm)) return { action: 'ignore', reason: `no push access (perm=${perm})` }
  const missing = REQUIRED.filter(l => !labels.includes(l))
  if (!missing.length) return { action: 'close' }
  if (missing.length === 1 && missing[0] === 'status:ready-to-close') {
    if (pending) return { action: 'already-pending' }
    if (postmortemGo) return { action: 'pending' }
  }
  return { action: 'refuse', missing }
}

export function refuseBody({ missing, runUrl }) {
  const fixes = []
  if (missing.includes('epic')) fixes.push('add the `epic` label (the pipeline now adds it when it splits an issue, #2501)')
  if (missing.includes('status:ready-to-close')) fixes.push('close every sub-issue first — the pipeline then writes the postmortem, which stamps `status:ready-to-close` (#856, #3425)')
  return '<!-- pipeline-note -->\n' + '> 🤖 **Claude Code** · agent pipeline (CI) · _close-epic on comment (#856)_\n\n'
    + `🔴 **Not closed — this issue is missing ${missing.map(l => `\`${l}\``).join(' and ')}.**\n\n`
    + `**You:** ${fixes.join('; then ')}, and comment \`/close-epic\` again.\n`
    + `**Depth:** ${runUrl}`
}

export async function runCloseEpic({ github, context, core }) {
  const issue_number = context.payload.issue.number
  const actor = context.payload.comment.user.login
  const body = context.payload.comment.body || ''
  const repo = context.repo
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`
  // Whole-word /close-epic (the `if:` substring test would also match e.g. "/close-epically").
  if (!COMMAND_RE.test(body)) return core.info('Comment does not invoke /close-epic as a command — ignoring.')

  const issue = (await github.rest.issues.get({ ...repo, issue_number })).data
  // Only a maintainer (push access) may close. getCollaboratorPermissionLevel collapses to admin/write/read/none.
  let perm = 'none'
  if (issue.state !== 'closed') {
    try {
      perm = (await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: actor })).data.permission
    } catch (e) { return core.info(`Permission check failed for @${actor}: ${e.message}`) }
  }
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name))
  let postmortemGo = false
  let pending = null
  if (['admin', 'write'].includes(perm) && labels.includes('epic') && !labels.includes('status:ready-to-close')) {
    const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number, per_page: 100 })
    const subIssues = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...repo, issue_number, per_page: 100 })
    postmortemGo = decidePostmortemRun({ isEpic: true, subIssues, comments }).go
    pending = pendingClose(comments)
  }
  const d = decideCloseEpic({ labels, perm, state: issue.state, postmortemGo, pending })

  if (d.action === 'ignore') return core.info(`Not closing #${issue_number}: ${d.reason}.`)
  if (d.action === 'refuse') {
    await github.rest.issues.createComment({ ...repo, issue_number, body: refuseBody({ missing: d.missing, runUrl }) })
    return core.info(`Not closing #${issue_number}: missing ${d.missing.join(', ')} — replied.`)
  }
  if (d.action === 'already-pending') return core.info(`#${issue_number}: the postmortem is already running; the close is pending.`)
  if (d.action === 'pending') {
    await github.rest.issues.createComment({ ...repo, issue_number, body: renderPending({ epic: issue_number, via: 'close-epic', runUrl }) })
    const { handoffGuard } = await import('./handoff-exec.mjs')
    await handoffGuard({ kind: 'dispatch', issue: issue_number, workflow: 'postmortem.yml', inputs: { epic: String(issue_number) } },
      () => github.rest.actions.createWorkflowDispatch({ ...repo, workflow_id: 'postmortem.yml', ref: 'main', inputs: { epic: String(issue_number) } }))
    return core.info(`#${issue_number}: postmortem started; it closes the epic when it posts.`)
  }

  // Close as completed + strip the managed status labels directly (idempotent;
  // strip-status-on-close also handles this, but don't rely on the cascade).
  await github.rest.issues.update({ ...repo, issue_number, state: 'closed', state_reason: 'completed' })
  for (const name of ['status:ready-to-close', 'status:needs-postmortem']) {
    try { await github.rest.issues.removeLabel({ ...repo, issue_number, name }) } catch (e) {}
  }
  await github.rest.issues.createComment({
    ...repo, issue_number,
    body: '<!-- pipeline-note -->\n' + `✅ **Epic closed** via \`/close-epic\` by @${actor}.\n\n`
      + '<sub>🤖 agent pipeline (CI) · close-epic on comment (#856) · was status:ready-to-close</sub>',
  })
  core.info(`Closed epic #${issue_number} (requested by @${actor}).`)
}
