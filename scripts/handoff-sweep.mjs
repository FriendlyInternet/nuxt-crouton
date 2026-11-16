#!/usr/bin/env node
// Hourly replay of pending pipeline hand-offs (#3306). Finds tickets by the `handoff:pending` label,
// pages ALL their comments, replays each pending marker (checking its own proof first, so a step
// that half-worked is finished, not redone) and closes it. Red if one is still pending after 24 h.
import { pathToFileURL } from 'node:url'
import { PENDING_LABEL, classifyHandoffError, handoffMarker, isStale } from './lib/handoff.mjs'
import { makeDeps, perform, listMarkers } from './handoff-exec.mjs'

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
    let stillPending = 0
    for (const m of await listMarkers(d, issue)) if (await replayMarker(d, issue, m, out)) stillPending++
    if (!stillPending) await dropPendingLabel(d, issue, out)
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
