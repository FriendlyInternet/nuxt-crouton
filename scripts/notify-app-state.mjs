#!/usr/bin/env node
// layer: stack
/**
 * After a staging deploy of main: tell the owner on every open `status:to-test` epic whose app
 * just broke (or came back) not to test / that they can (#2870). The decision is the pure
 * decideAppNotice() in test-card.mjs; this file is the GitHub I/O.
 *
 *   GITHUB_TOKEN=... RUN_ID=<deploy run id> node scripts/notify-app-state.mjs
 *
 * Env: GITHUB_TOKEN · RUN_ID · DIGEST_REPO · APPLY
 */
import { appsFromJobs, decideAppNotice } from './test-card.mjs'
import { loadApps } from './deploy-detect.mjs'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const APPLY = process.env.APPLY === 'true'
const token = process.env.GITHUB_TOKEN
const runId = process.env.RUN_ID
if (!token || !runId) {
  console.error('notify-app-state.mjs: GITHUB_TOKEN and RUN_ID are required')
  process.exit(1)
}

async function gh(path, init) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'notify-app-state', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}

const appIds = loadApps().map(a => a.app)
const { jobs } = await gh(`/repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`)
const toNotify = [
  ...appsFromJobs(jobs, appIds, 'failure').map(id => ({ id, kind: 'broken' })),
  ...appsFromJobs(jobs, appIds, 'success').map(id => ({ id, kind: 'back' }))
]
const epics = (await gh(`/repos/${REPO}/issues?state=open&labels=epic,status:to-test&per_page=100`)).filter(i => !i.pull_request)
let posted = 0
for (const { id, kind } of toNotify) {
  for (const e of epics.filter(i => (i.labels || []).some(l => (l.name || l) === `app:${id}` || (l.name || l) === `poc:${id}`))) {
    const comments = await gh(`/repos/${REPO}/issues/${e.number}/comments?per_page=100`).catch(() => [])
    const d = decideAppNotice({ kind, comments })
    if (!d.post) { console.log(`  #${e.number} (${id}) skip — ${d.reason}`); continue }
    console.log(`  #${e.number} (${id}) ${APPLY ? 'POST' : 'would post'} ${kind} notice`)
    if (APPLY) await gh(`/repos/${REPO}/issues/${e.number}/comments`, { method: 'POST', body: JSON.stringify({ body: d.body }) })
    posted++
  }
}
console.log(`notify-app-state: ${APPLY ? 'APPLIED' : 'DRY-RUN'} · ${toNotify.length} app state(s) · ${posted} notice(s)`)
