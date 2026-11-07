#!/usr/bin/env node
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
 * RELEASE. `work-issue-pidev.yml` parks a ticket with `status:blocked` + `traffic:waiting` (the walk
 * lists only those, so held tickets traffic did not park are never read) and `WAIT_MARKER` in its
 * comment (the ownership/dedup check, #3311).
 * When any `work-*` PR closes (or an issue closes / loses a label), `releaseWaiting` re-checks each waiting ticket and, if clear,
 * removes `status:blocked` and does REMOVE-then-ADD of `work-this` — adding a label the issue
 * already carries fires no event (#1750).
 */

import { routeIssue } from './lib/plan-route.mjs'
import { handoffGuard } from './handoff-exec.mjs'

export const WAIT_MARKER = '<!-- traffic-wait -->'
export const WAITING_LABEL = 'traffic:waiting'
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
  // #3214: a ticket still in plan mode (no approved plan, no PR) changes no code — never a blocker.
  if (o.planning) return false
  return n.includes('status:in-progress') && n.some((l) => PIPELINE_LABELS.includes(l))
}

/**
 * Issue numbers named on `Unblocks: #n[, #m]` lines (line start, case-insensitive). A ticket that
 * declares it unblocks #n may run while #n is open — #n is waiting on it (#3280).
 */
export function parseUnblocks(body) {
  const out = new Set()
  const re = /^\s*Unblocks:\s*(#\d+(?:[\s,]+#\d+)*)/gim
  for (const m of String(body || '').matchAll(re)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]))
  }
  return [...out]
}

/**
 * Decide whether a ticket must wait.
 *
 * @param {object}   o
 * @param {number}   o.issue           the ticket about to start
 * @param {string[]|object[]} o.labels the ticket's labels
 * @param {string}   [o.body]          the ticket body (`Unblocks: #n` lines let it pass #n)
 * @param {Array<{number:number,labels:any[],openPr?:boolean,planning?:boolean}>} o.others
 *        open pipeline tickets (issues, not PRs). `openPr` = an open `work-<number>` PR exists.
 * @returns {{action:'proceed'|'wait', waitingFor:number[], reason:string}}
 */
export function decideTraffic({ issue, labels, body, others }) {
  const mine = scopeLabels(labels)
  if (!mine.length) return { action: 'proceed', waitingFor: [], reason: 'ticket has no pkg:/app:/poc: label' }
  const unblocks = parseUnblocks(body)
  const all = (others || [])
    .filter((o) => o.number !== issue)
    .filter((o) => isBlocker(o))
    .filter((o) => scopeLabels(o.labels).some((l) => mine.includes(l)))
    .map((o) => o.number)
    .sort((a, b) => a - b)
  const blockers = all.filter((n) => !unblocks.includes(n))
  const unblocking = all.filter((n) => unblocks.includes(n))
  const extra = unblocking.length ? { unblocking } : {}
  if (!blockers.length) {
    return {
      action: 'proceed', waitingFor: [], ...extra,
      reason: unblocking.length
        ? `proceeding before ${unblocking.map((n) => `#${n}`).join(', ')} — this ticket unblocks it`
        : 'no open pipeline work on the same scope',
    }
  }
  return {
    action: 'wait',
    waitingFor: blockers,
    ...extra,
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
    const lbls = names(it.labels)
    const openPr = prs.length > 0
    let planning = false
    try {
      planning = !openPr && !lbls.includes('plan:approved')
        && routeIssue({ labels: lbls, text: `${it.title || ''}\n${it.body || ''}` }).mode === 'plan'
    } catch { /* unreadable routing config: treat as a builder (safe side) */ }
    others.push({ number: it.number, labels: lbls, openPr, planning })
  }
  return others
}

/** Park the ticket: `status:blocked`, `work-this` off (so it can be re-added), one comment. */
export async function applyWait({ github, context, issueNumber, verdict }) {
  const { owner, repo } = context.repo
  await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ['status:blocked', WAITING_LABEL] })
  try {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: 'work-this' })
  } catch { /* already gone (workflow_dispatch) */ }
  await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body:
    `<!-- pipeline-note -->\n⏸️ **${verdict.reason}.**\n\nAnother ticket on the same package is still being built. This one starts by itself when that work lands.\n\n`
    + `> 🤖 **pi.dev harness** · agent pipeline (CI) · _traffic control (#2786)_\n\n${WAIT_MARKER}` })
}

/**
 * (#3311) The wait comment of a hold traffic control still owns, else null: no one blocked the
 * ticket after the wait comment (applyWait labels first, then comments), and no open work PR
 * (that is a revision, not a fresh run).
 */
async function ownedWaitComment({ github, context, issue, comments }) {
  const { owner, repo } = context.repo
  const waitC = comments.filter((c) => String(c.body || '').includes(WAIT_MARKER)).at(-1)
  if (!waitC) return null
  const events = await github.paginate(github.rest.issues.listEvents,
    { owner, repo, issue_number: issue, per_page: 100 })
  const lastBlock = events.filter((e) => e.event === 'labeled' && e.label?.name === 'status:blocked')
    .map((e) => Date.parse(e.created_at)).filter((t) => !Number.isNaN(t)).sort((a, b) => b - a)[0]
  if (lastBlock !== undefined && lastBlock > Date.parse(waitC.created_at)) return null
  const { data: ownPrs } = await github.rest.pulls.list(
    { owner, repo, state: 'open', head: `${owner}:work-${issue}`, per_page: 5 })
  return ownPrs.length ? null : waitC
}

async function markReleased({ github, context, waitC }) {
  const { owner, repo } = context.repo
  try {
    await github.rest.issues.updateComment({ owner, repo, comment_id: waitC.id,
      body: String(waitC.body).replaceAll(WAIT_MARKER, '<!-- traffic-released -->') })
  } catch { /* cannot edit: the event guard still protects a later pass */ }
}

/** Remove a label; false when it was already gone (404), any other error rethrows. */
async function removeLabelIfPresent(github, params) {
  try {
    await github.rest.issues.removeLabel(params)
    return true
  } catch (e) {
    if (e?.status === 404) return false
    throw e
  }
}

/** Release one waiting ticket if its wait comment is ours and traffic is clear. Returns the scope labels it took, or null. */
async function releaseOne({ github, context, it }) {
  const { owner, repo } = context.repo
  const comments = await github.paginate(github.rest.issues.listComments,
    { owner, repo, issue_number: it.number, per_page: 100 })
  const waitC = await ownedWaitComment({ github, context, issue: it.number, comments })
  if (!waitC) return null
  const labels = names(it.labels)
  const others = await gatherTrafficFacts({ github, context, issueNumber: it.number, labels })
  if (decideTraffic({ issue: it.number, labels, body: it.body, others }).action !== 'proceed') return null
  const ref = { owner, repo, issue_number: it.number }
  // 404 = a peer release run already took this ticket (#3323): skip it, don't release twice.
  if (!(await removeLabelIfPresent(github, { ...ref, name: 'status:blocked' }))) return scopeLabels(labels)
  await removeLabelIfPresent(github, { ...ref, name: WAITING_LABEL })
  await removeLabelIfPresent(github, { ...ref, name: 'work-this' })
  // A limit / 5xx on the start label is saved and replayed hourly (#3306), not lost.
  await handoffGuard({ kind: 'label', issue: it.number, label: 'work-this' },
    () => github.rest.issues.addLabels({ ...ref, labels: ['work-this'] }))
  await markReleased({ github, context, waitC })
  return { released: true, scopes: scopeLabels(labels) }
}

/** Re-check every waiting ticket; start the ones that are clear. Returns released numbers. */
export async function releaseWaiting({ github, context }) {
  const { owner, repo } = context.repo
  const waiting = await github.paginate(github.rest.issues.listForRepo,
    { owner, repo, state: 'open', labels: `status:blocked,${WAITING_LABEL}`, per_page: 100 })
  const released = []
  const claimed = new Set() // scopes already released this pass: one ticket per scope
  waiting.sort((a, b) => a.number - b.number)
  for (const it of waiting) {
    if (it.pull_request || scopeLabels(it.labels).some((l) => claimed.has(l))) continue
    const res = await releaseOne({ github, context, it })
    if (!res) continue
    const scopes = Array.isArray(res) ? res : res.scopes
    if (!Array.isArray(res)) released.push(it.number)
    for (const l of scopes) claimed.add(l)
  }
  return released
}
