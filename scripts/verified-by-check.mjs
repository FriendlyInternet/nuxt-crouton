#!/usr/bin/env node
/**
 * verified-by-check — the decision behind the "reassigned acceptance criterion" watchdog (#2038).
 *
 * WHY. An epic's "prove it works" step is sometimes reassigned to another issue in prose
 * ("verification moved to #1279"). That hand-off is invisible to every tool — when the target
 * issue dies (closed not_planned / superseded), the parent epic silently believes it's still
 * covered. #590's verification was reassigned to #1279 in a comment; #1279 was later closed
 * `not_planned`; nothing told #590, and this was the SECOND time it happened (the first target,
 * #598's app, had been deleted).
 *
 * Fix: make the reassignment a structured `Verified-by: #NN` line (on its own line, in an
 * issue/epic's body or a comment), and comment back on the parent(s) when the target closes as
 * `not_planned` (or its close comment says "superseded"). Report-only: never reopens, never
 * relabels the child — the whole failure was silence, so the fix is a message.
 *
 * Pure + unit-tested (mirrors scripts/deploy-failure-report.mjs / scripts/packages-guard.mjs);
 * the workflow's github-script does only the GitHub I/O (search for `Verified-by: #NN`, read the
 * closed issue's state_reason + close comment) and then acts on the decision returned here.
 */

// Matches `Verified-by: #NN` on its own line (leading whitespace allowed, e.g. inside a list).
// Deliberately narrow — a prose mention of "verified by #NN somewhere in a sentence" does NOT
// count; only the structured marker line does, so a false match can't fire silently.
const VERIFIED_BY_RE = /^\s*Verified-by:\s*#(\d+)\s*$/im

/** Extract the target issue number from a `Verified-by: #NN` line, or null if absent. */
export function parseVerifiedBy(text = '') {
  const m = VERIFIED_BY_RE.exec(String(text || ''))
  return m ? Number(m[1]) : null
}

// Signals that a target's close was a "verification is now unowned" event, not a normal
// completion: GitHub's own `not_planned` state_reason, or a close comment that says the work
// was superseded/replaced elsewhere (a `completed` close can also be a de-facto reassignment-away
// if the closer says so explicitly).
const SUPERSEDED_RE = /\b(superseded|replaced by|no longer (needed|relevant)|obsolete)\b/i

/**
 * Classify why a closed target issue matters to the parent(s) that named it. PURE.
 *   target: { number, state_reason, closeCommentText }  — GitHub's `state_reason` is
 *           'completed' | 'not_planned' | null; closeCommentText is the closing comment's body
 *           (or '' if none) — used only to catch an explicit "superseded" completed-close.
 */
export function classifyClose(target) {
  const reason = target.state_reason || null
  if (reason === 'not_planned') {
    return { unowned: true, reason: 'closed not_planned' }
  }
  const supersededMatch = SUPERSEDED_RE.exec(String(target.closeCommentText || ''))
  if (reason === 'completed' && supersededMatch) {
    return { unowned: true, reason: `closing comment says "${supersededMatch[0]}"` }
  }
  // A normal completed close (the common, quiet case) is NOT unowned — no comment, no noise.
  return { unowned: false, reason: null }
}

// Marks the parent comment we post so a re-run doesn't double-post for the same target/parent
// pair, and so the housekeeping sweep (or a human) can recognise it later.
export const commentMarker = (parentNumber, targetNumber) =>
  `<!-- verified-by-check parent=#${parentNumber} target=#${targetNumber} -->`

/**
 * Decide what (if anything) to comment on a parent whose body/comments named a now-closed
 * target via `Verified-by: #NN`. PURE.
 *   target: { number, html_url, title, state_reason, closeCommentText }
 *   parent: { number, existingCommentText } — existingCommentText = the parent's comments
 *           joined, used only to detect an already-posted marker (idempotency).
 */
export function decideVerifiedByAlert({ target, parent }) {
  const classification = classifyClose(target)
  if (!classification.unowned) {
    return { action: 'skip', reason: 'target closed normally — no alert needed' }
  }
  const marker = commentMarker(parent.number, target.number)
  if (String(parent.existingCommentText || '').includes(marker)) {
    return { action: 'skip', reason: `already alerted #${parent.number} about target #${target.number}` }
  }
  const body = [
    `⚠️ **#${target.number} was closed \`${target.state_reason}\`** — this issue's acceptance points at it via \`Verified-by: #${target.number}\`, so verification is now unowned.`,
    '',
    `- Target: ${target.html_url || `#${target.number}`}${target.title ? ` — ${target.title}` : ''}`,
    `- Why this matters: ${classification.reason}`,
    '',
    `This is a report-only alert — nothing was reopened or relabelled. Either re-point \`Verified-by:\` at a new issue, or verify this one directly and update the acceptance criteria.`,
    '',
    `<sub>🤖 **pi.dev harness** · agent pipeline (CI) · _reassigned-acceptance-criterion watchdog (#2038)_</sub>`,
    marker
  ].join('\n')
  return { action: 'comment', issueNumber: parent.number, body, labels: ['status:needs-postmortem'] }
}
