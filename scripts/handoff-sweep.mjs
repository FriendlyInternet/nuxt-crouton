#!/usr/bin/env node
// Hourly replay of pending pipeline hand-offs (#3306). Finds tickets by the `handoff:pending` label,
// pages ALL their comments, replays each pending marker (checking its own proof first, so a step
// that half-worked is finished, not redone) and closes it. Red if one is still pending after 24 h.
// A labelled ticket with no saved step is skipped for 10 min, then reported as a failure unless a
// done note newer than the label explains it (#4202).
import { pathToFileURL } from 'node:url'
import { PENDING_LABEL, classifyHandoffError, handoffMarker, isStale, parseHandoff } from './lib/handoff.mjs'
import { makeDeps, perform } from './handoff-exec.mjs'

export const GRACE_MS = 10 * 60e3
const DONE = '<!-- handoff-done:v1 -->'
const jsonLines = (out) => String(out).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))

// All comments on the ticket, split into pending markers and done notes.
export async function listNotes(d, issue) {
  const all = jsonLines(await d.gh(['api', '--paginate', `repos/${d.repo}/issues/${issue}/comments?per_page=100`, '--jq', '.[] | {id, body, updated_at}']))
  const pending = []; const done = []
  for (const c of all) {
    const step = parseHandoff(c.body)
    if (step) pending.push({ id: c.id, step })
    else if (String(c.body || '').startsWith(DONE)) done.push({ id: c.id, updated_at: c.updated_at })
  }
  return { pending, done }
}

// When `handoff:pending` was last added (ms), or null when no event says so.
export async function pendingLabelSince(d, issue) {
  const evs = jsonLines(await d.gh(['api', '--paginate', `repos/${d.repo}/issues/${issue}/events?per_page=100`, '--jq', '.[] | {event, created_at, label}']))
  let t = null
  for (const e of evs) {
    if (e.event !== 'labeled' || e.label?.name !== PENDING_LABEL) continue
    const ms = Date.parse(e.created_at)
    if (Number.isFinite(ms) && (t === null || ms > t)) t = ms
  }
  return t
}

// A label with no saved step: wait out the grace period, drop it if a newer done note explains it, else report.
async function labelWithoutNote(d, issue, done, out) {
  const t = await pendingLabelSince(d, issue)
  if (t !== null && d.now() - t < GRACE_MS) return
  if (t !== null && done.some((n) => Date.parse(n.updated_at) >= t)) return dropPendingLabel(d, issue, out)
  out.failures.push(`#${issue} handoff:pending without a saved step`)
}

const patchComment = (d, id, body) => d.gh(['api', '-X', 'PATCH', `repos/${d.repo}/issues/comments/${id}`, '-f', `body=${body}`])

// Replay one saved marker. Returns true if it is still pending afterwards.
async function replayMarker(d, issue, m, out) {
  try {
    await perform({ ...m.step, issue }, d, { check: true })
    await patchComment(d, m.id, `<!-- handoff-done:v1 -->\n✅ replayed at ${new Date(d.now()).toISOString().slice(11, 16)} UTC`)
    out.replayed++
    return false
  } catch (e) {
    const c = classifyHandoffError(e)
    if (c.action !== 'defer') { out.failures.push(`#${issue} ${m.step.kind}: ${e.stderr || e.message}`); return true }
    await patchComment(d, m.id, `${handoffMarker({ ...m.step, attempts: (m.step.attempts || 0) + 1 })}\n🔁 still waiting on GitHub (${c.reason}), retrying at the next hourly sweep`)
    if (isStale(m.step.since, d.now())) out.stale.push(`#${issue} ${m.step.kind}`)
    return true
  }
}

async function dropPendingLabel(d, issue, out) {
  try { await d.gh(['api', '-X', 'DELETE', `repos/${d.repo}/issues/${issue}/labels/${encodeURIComponent(PENDING_LABEL)}`]) } catch (e) {
    if (!/HTTP 404/.test(e.stderr || e.message || '')) out.failures.push(`#${issue} label removal: ${e.message}`)
  }
}

export async function sweep(d = makeDeps()) {
  const remaining = Number(String(await d.gh(['api', 'rate_limit', '--jq', '.resources.core.remaining'])).trim())
  if (Number.isFinite(remaining) && remaining < 200) {
    d.log(`rate limit remaining ${remaining} < 200 — sweeping next hour`)
    return { skipped: true, failures: [], stale: [], replayed: 0 }
  }
  const tickets = String(await d.gh(['api', '--paginate', `repos/${d.repo}/issues?labels=${encodeURIComponent(PENDING_LABEL)}&state=open&per_page=100`, '--jq', '.[].number']))
    .split('\n').map((s) => s.trim()).filter(Boolean).map(Number)
  const out = { skipped: false, failures: [], stale: [], replayed: 0 }
  for (const issue of tickets) {
    const { pending, done } = await listNotes(d, issue)
    if (!pending.length) { await labelWithoutNote(d, issue, done, out); continue }
    let closed = 0
    for (const m of pending) if (!(await replayMarker(d, issue, m, out))) closed++
    // List again before dropping the label: a new step may have been saved during the replay.
    if (closed && !(await listNotes(d, issue)).pending.length) await dropPendingLabel(d, issue, out)
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  sweep().then((r) => {
    console.log(JSON.stringify(r))
    for (const f of r.failures) console.error(`::error::${f}`)
    for (const s of r.stale) console.error(`::error::hand-off still pending after 24 h: ${s}`)
    process.exit(r.failures.length || r.stale.length ? 1 : 0)
  }).catch((e) => { console.error(`::error::${e.stderr || e.message}`); process.exit(1) })
}
