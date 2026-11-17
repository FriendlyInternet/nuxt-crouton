// The reply behind .github/workflows/on-comment.yml `explain-skipped-approval` (#1665, #4038): an
// approval on an issue that is NOT status:blocked starts nothing (the resume job needs the label).
// It used to explain that only when an epic/* gate PR was open, so every other `ok` got silence
// (run 43957677096). Now it always answers once, saying what the issue waits on.
// skippedApprovalNote() is pure; runSkippedApproval() reads GitHub over the injected github/core.
import { decideAutoClose, readAutoCloseInputs } from '../epic-auto-close.mjs'
import { crossReferencedPrs } from './pr-merge-gate-io.mjs'

export const NOTICE = '<!-- skipped-approval-notice -->'
const HEAD = '<!-- pipeline-note -->\n' + NOTICE + '\n'
  + '> 🤖 **pi.dev harness** · agent pipeline (CI) · _approval reply on a non-blocked issue_\n\n'
const isEpicBase = (pr) => /^epic\//.test(String(pr?.base?.ref || ''))

/**
 * @param {{ isEpic?: boolean, labels?: string[], openPrs?: object[], epicWaiting?: string[], recentComments?: object[] }} input
 *   openPrs: open, unmerged PRs cross-referenced from the issue · epicWaiting: decideAutoClose(...).waiting
 * @returns {string|null} the comment body, or null when one was posted in the last 3 comments
 */
export function skippedApprovalNote({ isEpic = false, labels = [], openPrs = [], epicWaiting = [], recentComments = [] } = {}) {
  if ((recentComments || []).slice(-3).some((c) => String(c?.body || '').includes(NOTICE))) return null
  const gatePR = (openPrs || []).find(isEpicBase)
  if (gatePR && !labels.includes('status:blocked')) {
    return HEAD
      + `🤷 **Your approval did not start anything** — and that is a bug, not a decision. PR #${gatePR.number} `
      + `is still open into \`${gatePR.base.ref}\`, so a gate IS pending here.\n\n`
      + 'The resume workflow only runs while this issue carries `status:blocked`, and the label is gone. '
      + 'Add `status:blocked` back and reply again, and it will run.\n\n'
      + '<sub>Root cause of the label going missing: #1665.</sub>'
  }
  if (isEpic && epicWaiting.length) {
    return HEAD + 'Your `ok` did not start anything — this epic waits on:\n\n'
      + epicWaiting.map((w) => `- ${w}`).join('\n')
  }
  if (isEpic) return HEAD + 'Your `ok` did not start anything — nothing on this issue waits for a reply.'
  if (openPrs.length) {
    return HEAD + 'Your `ok` did not start anything — this issue has open PRs:\n\n'
      + openPrs.map((p) => `- #${p.number} into \`${p.base?.ref}\``).join('\n') + '\n\n'
      + '`status:blocked` is not on this issue, so a reply here starts nothing. Review and merge happen on the PR.'
  }
  return HEAD + 'Your `ok` did not start anything — nothing on this issue waits for a reply.'
}

const labelNames = (ls) => (ls || []).map((l) => (typeof l === 'string' ? l : l.name))

/** Read the issue's PRs/labels (and the epic's waits), post the note once. */
export async function runSkippedApproval({ github, context, core }) {
  const issue_number = context.payload.issue.number
  let openPrs = []
  let labels = []
  try {
    for (const n of await crossReferencedPrs({ github, context }, issue_number)) {
      const pr = (await github.rest.pulls.get({ ...context.repo, pull_number: n })).data
      if (pr.state === 'open' && !pr.merged) openPrs.push(pr)
    }
    labels = labelNames((await github.rest.issues.get({ ...context.repo, issue_number })).data.labels)
  } catch (e) { core.warning(`skipped-approval probe failed: ${e.message}`); return }
  const isEpic = labels.includes('epic')
  let epicWaiting = []
  if (isEpic) {
    try {
      const { input } = await readAutoCloseInputs({ github, context }, issue_number)
      epicWaiting = decideAutoClose(input).waiting
    } catch (e) { core.warning(`epic waits read failed: ${e.message}`) }
  }
  let recentComments = []
  try {
    recentComments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number, per_page: 100 })
  } catch (e) { core.warning(`comments read failed: ${e.message}`); return }
  const body = skippedApprovalNote({ isEpic, labels, openPrs, epicWaiting, recentComments })
  if (!body) { core.info('Already explained recently — staying quiet.'); return }
  await github.rest.issues.createComment({ ...context.repo, issue_number, body })
  core.info(`Explained the skipped approval on #${issue_number}.`)
}
