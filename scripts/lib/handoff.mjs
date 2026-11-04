// Pipeline hand-off deferral (#3306). Pure: no I/O. A hand-off (read + dispatch / stage label) that
// hits the GitHub API limit or a GitHub server error is recorded as pending and replayed by the
// hourly sweep — never lost, never doubled. Anything else still fails.
import { isRateLimitError, isServerError, fromGhStderr, serverErrorFromGhStderr, rateLimitResetAt } from './rate-limit.mjs'

export const PENDING_LABEL = 'handoff:pending'
export const BOT = 'nuxt-harness[bot]'

// Classify the failing call's OWN error (never a job log): defer (limit / server) or throw.
export function classifyHandoffError(e) {
  if (!e) return { action: 'throw' }
  if (isRateLimitError(e)) return { action: 'defer', reason: 'limit', resetAt: rateLimitResetAt(e) }
  if (isServerError(e)) return { action: 'defer', reason: 'server' }
  // execFileSync errors carry status=1 (the exit code), so read gh's own stderr regardless of status.
  const text = typeof e.stderr === 'string' && e.stderr ? e.stderr : e.message || ''
  if (fromGhStderr(text)) return { action: 'defer', reason: 'limit', resetAt: null }
  if (serverErrorFromGhStderr(text)) return { action: 'defer', reason: 'server' }
  return { action: 'throw' }
}

const enc = (o) => JSON.stringify(o).replace(/-->/g, '--\\u003e')

export function handoffMarker(obj) {
  return `<!-- handoff-pending:v1 ${enc(obj)} -->`
}

export function parseHandoff(body) {
  const m = /<!-- handoff-pending:v1 (\{.*?\}) -->/s.exec(body || '')
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

// Same step (kind + issue + inputs/label) → same key, so a second deferral updates one marker.
export function handoffKey(step) {
  return enc({ kind: step.kind, issue: step.issue, workflow: step.workflow, label: step.label, inputs: step.inputs || {}, feedback: step.feedback })
}

// One definition of the run title; the workflows' `run-name:` is pinned to it by a test.
export const RUN_NAME = {
  'work-issue-pidev.yml':
    "${{ github.event_name != 'workflow_dispatch' && format('work #{0} label {1}', github.event.issue.number, github.event.label.name) || format('work #{0} {1} {2}', inputs.issue, inputs.feedback != '' && 'revise' || inputs.mode, inputs.plan || inputs.feedback || '-') }}",
  'build-review.yml':
    "${{ github.event_name == 'workflow_dispatch' && format('build-review #{0}', inputs.pr) || 'Build review (workflow run)' }}",
  'fix-ci-on-failure.yml':
    "${{ github.event_name == 'workflow_dispatch' && format('fix-ci #{0}', inputs.pr) || 'Fix CI on failure (workflow run)' }}",
  'ticket-review.yml': 'ticket-review #${{ inputs.epic }}',
}

export function handoffRunTitle(workflow, inputs = {}) {
  const i = inputs
  switch (workflow) {
    case 'work-issue-pidev.yml':
      return `work #${i.issue} ${i.feedback ? 'revise' : i.mode || 'build'} ${i.plan || i.feedback || '-'}`
    case 'build-review.yml': return `build-review #${i.pr}`
    case 'fix-ci-on-failure.yml': return `fix-ci #${i.pr}`
    case 'ticket-review.yml': return `ticket-review #${i.epic}`
    default: return null // no run-name: replay can't prove it, so it dispatches once more
  }
}

// Proof that a label hand-off landed: a `labeled` event for it by the App at/after `since`.
export function labelHandoffDone(events, { label, since }) {
  const t0 = Date.parse(since)
  return (events || []).some(
    (ev) => ev.event === 'labeled' && ev.label?.name === label && ev.actor?.login === BOT && Date.parse(ev.created_at) >= t0,
  )
}

// Proof that a dispatch landed: a run of the workflow created at/after `since` with the exact title.
export function dispatchHandoffDone(runs, { title, since }) {
  if (!title) return false
  const t0 = Date.parse(since)
  return (runs || []).some((r) => r.display_title === title && Date.parse(r.created_at) >= t0)
}

export const STALE_MS = 24 * 3600 * 1000
export const isStale = (since, now = Date.now()) => now - Date.parse(since) >= STALE_MS
