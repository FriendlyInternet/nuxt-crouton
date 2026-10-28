#!/usr/bin/env node
// layer: harness
/**
 * traffic-control.mjs — same-package tickets run one after another (#2786).
 *
 * THE PROBLEM. Two `delegate`d tickets for the same package are built at the same time, open
 * two PRs touching the same files and collide at merge. Different packages are fine.
 *
 * THE RULE. Before a worker starts, look at the ticket's scope labels (`pkg:*`, `app:*`,
 * `poc:*`). If another open pipeline ticket with a shared scope label is already being worked
 * (`status:in-progress`, or an open `work-<n>` PR), the new ticket waits for it. The decision
 * is `decideTraffic` — pure, no I/O — so the shipped guard IS the tested function. The
 * workflow steps only gather facts (`gatherTrafficFacts`) and apply the verdict.
 *
 * RELEASE. `work-issue-pidev.yml` marks a waiting ticket with `WAIT_MARKER` in its comment.
 * When any `work-*` PR closes (or an issue closes / loses a label), `releaseWaiting` re-checks each waiting ticket and, if clear,
 * removes `status:blocked` and does REMOVE-then-ADD of `work-this` — adding a label the issue
 * already carries fires no event (#1750).
 */

export const WAIT_MARKER = '<!-- traffic-wait -->'
export const SCOPE_PREFIXES = ['pkg:', 'app:', 'poc:']

const names = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l.name))

/** The scope labels (`pkg:*`, `app:*`, `poc:*`) of a label list. */
export function scopeLabels(labels) {
  return names(labels).filter((n) => SCOPE_PREFIXES.some((p) => n.startsWith(p)))
}

export const PIPELINE_LABELS = ['delegate', 'delegate-pi', 'work-this']

/**
 * Does this ticket count as open pipeline work? Never an epic; otherwise an open `work-<n>` PR,
 * or `status:in-progress` AND pipeline-owned (a hand-held in-progress ticket has no PR coming).
 */
function isBlocker(o) {
  const n = names(o.labels)
  if (n.includes('epic')) return false
  if (o.openPr) return true
  return n.includes('status:in-progress') && n.some((l) => PIPELINE_LABELS.includes(l))
}

/**
 * Decide whether a ticket must wait.
 *
 * @param {object}   o
 * @param {number}   o.issue           the ticket about to start
 * @param {string[]|object[]} o.labels the ticket's labels
 * @param {Array<{number:number,labels:any[],openPr?:boolean}>} o.others
 *        open pipeline tickets (issues, not PRs). `openPr` = an open `work-<number>` PR exists.
 * @returns {{action:'proceed'|'wait', waitingFor:number[], reason:string}}
 */
export function decideTraffic({ issue, labels, others }) {
  const mine = scopeLabels(labels)
  if (!mine.length) return { action: 'proceed', waitingFor: [], reason: 'ticket has no pkg:/app:/poc: label' }
  const blockers = (others || [])
    .filter((o) => o.number !== issue)
    .filter((o) => isBlocker(o))
    .filter((o) => scopeLabels(o.labels).some((l) => mine.includes(l)))
    .map((o) => o.number)
    .sort((a, b) => a - b)
  if (!blockers.length) return { action: 'proceed', waitingFor: [], reason: 'no open pipeline work on the same scope' }
  return {
    action: 'wait',
    waitingFor: blockers,
    reason: `waiting for ${blockers.map((n) => `#${n}`).join(', ')} (same ${mine.join(', ')})`,
  }
}

/** Open issues sharing a scope label with `labels`, with whether each has an open work PR. */
export async function gatherTrafficFacts({ github, context, issueNumber, labels }) {
  const { owner, repo } = context.repo
  const seen = new Map()
  for (const label of scopeLabels(labels)) {
    const items = await github.paginate(github.rest.issues.listForRepo,
      { owner, repo, state: 'open', labels: label, per_page: 100 })
    for (const it of items) if (!it.pull_request && it.number !== issueNumber) seen.set(it.number, it)
  }
  const others = []
  for (const it of seen.values()) {
    const { data: prs } = await github.rest.pulls.list(
      { owner, repo, state: 'open', head: `${owner}:work-${it.number}`, per_page: 5 })
    others.push({ number: it.number, labels: names(it.labels), openPr: prs.length > 0 })
  }
  return others
}

/** Park the ticket: `status:blocked`, `work-this` off (so it can be re-added), one comment. */
export async function applyWait({ github, context, issueNumber, verdict }) {
  const { owner, repo } = context.repo
  await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ['status:blocked'] })
  try {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: 'work-this' })
  } catch { /* already gone (workflow_dispatch) */ }
  await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body:
    `⏸️ **${verdict.reason}.**\n\nAnother ticket on the same package is still being built. This one starts by itself when that work lands.\n\n`
    + `> 🤖 **pi.dev harness** · agent pipeline (CI) · _traffic control (#2786)_\n\n${WAIT_MARKER}` })
}

/** Re-check every waiting ticket; start the ones that are clear. Returns released numbers. */
export async function releaseWaiting({ github, context }) {
  const { owner, repo } = context.repo
  const waiting = await github.paginate(github.rest.issues.listForRepo,
    { owner, repo, state: 'open', labels: 'status:blocked', per_page: 100 })
  const released = []
  const claimed = new Set() // scopes already released this pass: one ticket per scope
  waiting.sort((a, b) => a.number - b.number)
  for (const it of waiting) {
    if (it.pull_request) continue
    if (scopeLabels(it.labels).some((l) => claimed.has(l))) continue
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number: it.number, per_page: 100 })
    if (!comments.some((c) => String(c.body || '').includes(WAIT_MARKER))) continue
    const labels = names(it.labels)
    const others = await gatherTrafficFacts({ github, context, issueNumber: it.number, labels })
    if (decideTraffic({ issue: it.number, labels, others }).action !== 'proceed') continue
    await github.rest.issues.removeLabel({ owner, repo, issue_number: it.number, name: 'status:blocked' })
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: it.number, name: 'work-this' })
    } catch { /* not present */ }
    await github.rest.issues.addLabels({ owner, repo, issue_number: it.number, labels: ['work-this'] })
    released.push(it.number)
    for (const l of scopeLabels(labels)) claimed.add(l)
  }
  return released
}
