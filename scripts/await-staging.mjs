#!/usr/bin/env node
// Production waits for the staging deploy of the same commit (#1699).
//
// deploy-apps.yml used to order production after staging only by accident (one shared concurrency
// group, which also evicted queued staging runs). With the groups split, this step makes the rule
// explicit: a production dispatch proceeds only once every EARLIER push-to-main run has finished,
// and only if staging actually ran this commit for <app>. Node built-ins only (no install needed).

const POLL_MS = 20_000
const DEADLINE_MS = 50 * 60_000
// A just-merged commit may not have its push run visible in the API yet.
const GRACE_MS = 5 * 60_000

/**
 * Pure decision. `pushRuns`: push-to-main runs of deploy-apps.yml ({id, head_sha, status,
 * conclusion, created_at}); `jobsBySha[sha]`: jobs ({name, conclusion}) of that sha's push run.
 * @returns {{action: 'wait'|'go'|'refuse', reason: string}}
 */
export function decide({ app, sha, dispatchCreatedAt, pushRuns, jobsBySha, commitDate }) {
  const t = Date.parse(dispatchCreatedAt)
  const earlier = pushRuns.filter(r => Date.parse(r.created_at) <= t)
  const pending = earlier.filter(r => r.status !== 'completed')
  if (pending.length) {
    return { action: 'wait', reason: `${pending.length} earlier push run(s) still ${pending.map(r => r.status).join('/')}` }
  }
  const mine = earlier.find(r => r.head_sha === sha)
  if (!mine) {
    const age = commitDate ? Date.now() - Date.parse(commitDate) : Infinity
    if (age < GRACE_MS) return { action: 'wait', reason: 'no push run for this commit yet; commit is recent, waiting for it to appear' }
    return { action: 'go', reason: 'no push run for this commit; staging already serves the latest code' }
  }
  const jobs = jobsBySha[sha] || []
  const appJob = jobs.find(j => j.name.startsWith(`deploy (${app}, staging,`))
  if (appJob) {
    return appJob.conclusion === 'success'
      ? { action: 'go', reason: `staging deploy of ${app} at ${sha} succeeded` }
      : { action: 'refuse', reason: `staging deploy of ${sha} for ${app} was ${appJob.conclusion} — fix or re-run it, then re-dispatch (or use skip_staging_smoke)` }
  }
  if (mine.conclusion === 'cancelled') {
    return { action: 'refuse', reason: `the staging run for ${sha} was cancelled before deploying ${app} — re-run it, then re-dispatch` }
  }
  return { action: 'go', reason: `this merge did not deploy ${app} to staging; staging already serves its latest code` }
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_RUN_ID: runId, GH_TOKEN: token, APP: app } = process.env
  const api = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return res.json()
  }
  const me = await api(`actions/runs/${runId}`)
  const commitDate = (await api(`commits/${sha}`)).commit.committer.date
  const deadline = Date.now() + DEADLINE_MS
  for (;;) {
    const { workflow_runs } = await api('actions/workflows/deploy-apps.yml/runs?event=push&branch=main&per_page=30')
    const jobsBySha = {}
    const mine = workflow_runs.find(r => r.head_sha === sha)
    if (mine) jobsBySha[sha] = (await api(`actions/runs/${mine.id}/jobs?per_page=100`)).jobs
    const d = decide({ app, sha, dispatchCreatedAt: me.created_at, pushRuns: workflow_runs, jobsBySha, commitDate })
    console.log(`${d.action}: ${d.reason}`)
    if (d.action === 'go') return
    if (d.action === 'refuse') {
      console.log(`::error::${d.reason}`)
      process.exit(1)
    }
    if (Date.now() > deadline) {
      console.log('::error::timed out waiting for staging to finish')
      process.exit(1)
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.log(`::error::${e.message}`)
    process.exit(1)
  })
}
