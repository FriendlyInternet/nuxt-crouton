/**
 * #1688 — the wave scheduler's green-branch gate.
 *
 * `schedule-waves.yml` releases a dependent workstream when all its `Blocked-by:` issues are
 * closed. "Closed" is not the same as "works": on epic #1652, #1655's job was to land a
 * DELIBERATELY FAILING test contract (that is what the test-first gate is for), and the
 * follow-up run that writes the implementation died on a provider quota. #1655 closed anyway,
 * wave 2 released, and the epic branch carried 35 red tests and a throwing parser for about an
 * hour. Nothing surfaced it — it was caught only because wave 2 went to call the parser.
 *
 * So the release also asks: **is the branch this work lands on actually green?**
 *
 * The decision lives here, pure and unit-tested, because the workflow it gates is the thing
 * that releases every workstream in the repo — a bug here stalls or mis-starts all of them.
 *
 *   node --test scripts/wave-gate.test.mjs
 */

/** Dedupe marker so a held wave is explained once, not on every re-check. */
export const HOLD_MARKER = '<!-- wave-gate:held -->'

/** `Blocked-by: #454` / `Blocked-by: #275, #276` → [454] / [275, 276]. */
export function parseBlockers(body) {
  const m = String(body || '').match(/Blocked-by:\s*([#\d,\s]+)/i)
  if (!m) return []
  return [...new Set((m[1].match(/\d+/g) || []).map(Number))]
}

/**
 * Already dispatched or being worked — never re-release.
 *
 * `work-this` counts (#1750). The event-driven pipeline dispatches a LEAF straight to the
 * single-use worker with that label, never `delegate` — so before this, a leaf already being
 * built looked un-dispatched to the scheduler, which would add `delegate` on top and start a
 * redundant decompose run against an issue a worker was mid-way through. `delegate-pi` is the
 * same story one rung up (a child that still needs splitting).
 */
export function isDispatched(labels = []) {
  const names = labels.map(l => (typeof l === 'string' ? l : l.name))
  return names.includes('delegate') || names.includes('delegate-pi') ||
    names.includes('work-this') || names.includes('status:in-progress')
}

/**
 * Collapse a branch's check runs into one verdict.
 *
 * `queued`/`in_progress` ⇒ `pending`: CI that has not finished is NOT evidence of green, and
 * releasing on it would reintroduce the very race this gate exists to stop. An empty list is
 * `unknown` — no CI configured for that ref, which must not hard-block the chain.
 */
export function summarizeChecks(checkRuns = []) {
  if (!checkRuns.length) return 'unknown'
  const relevant = checkRuns.filter(r => !/^(skipped|neutral)$/.test(r.conclusion ?? ''))
  if (!relevant.length) return 'unknown'
  if (relevant.some(r => r.status !== 'completed')) return 'pending'
  const bad = new Set(['failure', 'timed_out', 'action_required', 'cancelled'])
  return relevant.some(r => bad.has(r.conclusion)) ? 'failure' : 'success'
}

/**
 * Should this dependent be released?
 *
 * `branchStatus` is `summarizeChecks` over the epic branch head, or `unknown` when the work
 * did not land on an `epic/*` branch at all (nothing to gate on).
 *
 * Deliberate asymmetry: only an outright `failure` holds. `pending` and `unknown` release.
 * A gate that waits for green would deadlock the chain on any repo without CI for that ref,
 * and this workflow has no timer to rescue it — the failure mode we are fixing is a SILENT
 * bad release, not a slow one.
 */
export function shouldRelease({ blockerStates = [], labels = [], branchStatus = 'unknown' } = {}) {
  if (isDispatched(labels)) return { release: false, reason: 'already-dispatched' }
  if (!blockerStates.length) return { release: false, reason: 'no-blockers' }
  if (blockerStates.some(s => s !== 'closed')) return { release: false, reason: 'blockers-open' }
  if (branchStatus === 'failure') return { release: false, reason: 'branch-red' }
  return { release: true, reason: branchStatus === 'success' ? 'green' : `ungated-${branchStatus}` }
}

/** The comment posted when a wave is held because its branch is red. */
export function formatHoldComment({ issueNumber, branch, doneNumber }) {
  return `${HOLD_MARKER}\n`
    + `⏸️ **Not starting this workstream yet — \`${branch}\` is red.**\n\n`
    + `Its last blocker (#${doneNumber}) closed, so the dependency chain is satisfied — but the branch it builds on currently fails CI. `
    + `Starting here would build on top of code that does not work (epic #1652: a merged test contract whose implementation never landed left 35 red tests, and wave 2 released onto a throwing stub).\n\n`
    + `**This releases itself** as soon as CI goes green on \`${branch}\` — no action needed. `
    + `If the branch is red for an unrelated reason, apply \`delegate\` by hand to override.\n\n`
    + `<sub>🤖 wave scheduler · green-branch gate (#1688/#283)</sub>`
}

/** The comment posted on a normal release. */
export function formatReleaseComment({ doneNumber, branchStatus }) {
  const suffix = branchStatus === 'success'
    ? ' Its branch is green.'
    : ''
  return `🟢 **Unblocked — starting this workstream now.** Its last blocker (#${doneNumber}) just closed.${suffix}\n\n`
    + `<sub>🤖 wave scheduler (#283) · applied \`delegate\`</sub>`
}
