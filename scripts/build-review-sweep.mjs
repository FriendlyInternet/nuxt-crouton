/**
 * Safety-net sweep (#3218): which green pipeline PRs never got a build review?
 * At most ONE dispatch per head SHA. Handled for SHA X = a build-review-sha:X comment, a
 * build-review-sweep:X comment (already dispatched), or a build-review-failed comment
 * (failed-sha:X, or an unsigned one created after the head commit).
 */
import { isPipelinePr } from './build-review-pick.mjs'

const AGE_MS = 15 * 60 * 1000

function latestGate(checks) {
  return checks
    .filter((c) => c.name === 'CI Gate')
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0]
}

function gateGreenAndOld(gate, now) {
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') return false
  const done = Date.parse(gate.completed_at || '')
  return Number.isFinite(done) && now - done >= AGE_MS
}

function isHandled(body, sha, createdAt, headAt) {
  if (body.includes(`<!-- build-review-sha:${sha} -->`)) return true
  if (body.includes(`<!-- build-review-sweep:${sha} -->`)) return true
  if (body.includes(`<!-- build-review-failed-sha:${sha} -->`)) return true
  const unsignedFailure = body.includes('<!-- build-review-failed -->') &&
    !body.includes('<!-- build-review-failed-sha:')
  return unsignedFailure && Number.isFinite(headAt) && Date.parse(createdAt) > headAt
}

export function needsReview({ pr, checks = [], comments = [], headCommitDate, now = Date.now() }) {
  const sha = pr.headRefOid
  if (!isPipelinePr(pr) || !sha) return false
  if (!gateGreenAndOld(latestGate(checks), now)) return false
  const headAt = Date.parse(headCommitDate || '')
  return !comments.some((c) => isHandled(c.body || '', sha, c.created_at, headAt))
}

/** An event run does a full sweep when the last one is older than this (#3385). */
export const FULL_SWEEP_MS = 60 * 60 * 1000

/**
 * Run `checkOne` for every PR, each in its own try/catch. `stampAt` (the time to store as "last full
 * sweep") is set only when every read succeeded — a half-finished sweep must not reset the clock.
 */
export async function sweepAll(prs, checkOne, { warn = () => {}, now = () => new Date() } = {}) {
  let checked = 0
  let failed = 0
  for (const p of prs) {
    checked++
    try {
      await checkOne(p)
    } catch (e) {
      failed++
      warn(`build-review sweep #${p.number}: ${e.message}`)
    }
  }
  return { checked, failed, stampAt: failed === 0 ? now().toISOString() : null }
}

function parseCandidates(c) {
  let v = c
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = [] }
  }
  if (!Array.isArray(v)) return []
  const out = []
  for (const x of v) {
    const n = Number(x)
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/** Which PRs should the safety-net sweep read on this event? */
export function sweepScope({ eventName, inputsPr, candidates, lastFullSweepAt, now = Date.now() }) {
  if (eventName === 'schedule' || (eventName === 'workflow_dispatch' && !inputsPr)) return { all: true, prs: [] }
  const last = Date.parse(lastFullSweepAt || '')
  if (!Number.isFinite(last) || now - last > FULL_SWEEP_MS) return { all: true, prs: [] }
  let prs = parseCandidates(candidates)
  if (!prs.length && eventName === 'workflow_dispatch') prs = parseCandidates([inputsPr])
  return { all: false, prs }
}
