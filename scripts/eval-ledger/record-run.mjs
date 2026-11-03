#!/usr/bin/env node
// record-run.mjs — write ONE record per workflow RUN to the `pipeline-data` branch (#3251).
//
// Called by the final `record-outcome` job of each agent workflow (`needs:` every other job,
// `if: always()`). Read-only against issues/PRs: it only GETs, then PUTs one file
//   records/<yyyy-mm-dd>/<run_id>-<attempt>.json
// on an orphan branch. Distinct paths never conflict, and main/epic branches are untouched.
//
// Silent no-op guard: the record job's output says what it wrote (or why it could not). A ledger
// failure NEVER fails the run — this script always exits 0.
//
// Env: REPO, RUN_ID, RUN_ATTEMPT, WORKFLOW_FILE, STAGE, ISSUE | PR | BRANCH, NEEDS_JSON, RL_START,
//      TOKEN_KIND, GH_TOKEN (read), DATA_TOKEN (contents:write on the data branch).
import { pathToFileURL } from 'node:url'
import { validate } from './schema.mjs'
import { classify, joinRuns, legacyClassifyComment } from '../lib/run-outcome.mjs'
import { readRateLimit, diffRateLimit } from '../lib/rate-limit.mjs'

const BOT = 'nuxt-harness[bot]'
export const DATA_BRANCH = 'pipeline-data'

export function conclusionOf(needsJson) {
  let needs = {}
  try { needs = JSON.parse(needsJson || '{}') } catch { /* unreadable → unknown */ }
  const results = Object.values(needs).map((n) => n?.result)
  if (results.includes('cancelled')) return 'cancelled'
  if (results.includes('failure')) return 'failure'
  if (results.includes('success')) return 'success'
  return results.length ? 'skipped' : 'unknown'
}

/**
 * Build the record. `api(path)` → parsed JSON (GET); `listRecords(date)` → sibling records.
 * Everything is injectable so the tests never touch the network.
 */
export async function buildRecord({ env, api, listRecords, rlEnd, now = new Date() }) {
  const repo = env.REPO
  const run = await api(`/repos/${repo}/actions/runs/${env.RUN_ID}`)
  const start = run.run_started_at || run.created_at
  const end = now.toISOString()
  // (backfill passes the run's own end time as `now`)
  const win = { start, end }

  // Subjects: the issue, and the PR whose head is the work branch.
  let issue = env.ISSUE ? Number(env.ISSUE) : null
  let pr = env.PR ? Number(env.PR) : null
  const branch = env.BRANCH || (issue ? `work-${issue}` : null)
  if (!pr && branch) {
    try {
      const [owner] = repo.split('/')
      const prs = await api(`/repos/${repo}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}&per_page=5`)
      pr = prs?.[0]?.number ?? null
    } catch { /* no PR yet */ }
  }
  const subjects = [...new Set([issue, pr].filter(Boolean))]

  const comments = []
  for (const n of subjects) {
    try {
      const list = await api(`/repos/${repo}/issues/${n}/comments?since=${encodeURIComponent(start)}&per_page=100`)
      comments.push(...list.filter((c) => c.user?.login === BOT))
    } catch { /* unreadable subject → counted as no comments */ }
  }
  let reviews = []
  if (pr) {
    try { reviews = (await api(`/repos/${repo}/pulls/${pr}/reviews?per_page=100`)).filter((r) => r.user?.login === BOT) } catch { /* ignore */ }
  }
  let commits = []
  try {
    commits = pr
      ? await api(`/repos/${repo}/pulls/${pr}/commits?per_page=100`)
      : branch ? await api(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(start)}&per_page=100`) : []
  } catch { /* ignore */ }

  // Overlap: sibling records for the same workflow + subject whose window intersects ours.
  let siblings = []
  try {
    siblings = (await listRecords(start.slice(0, 10)))
      .filter((r) => r.workflow === env.WORKFLOW_FILE && ((issue && r.issue === issue) || (pr && r.pr === pr)))
      .map((r) => ({ run_id: r.run_id, start: r.started_at, end: r.ended_at }))
  } catch { /* ignore */ }
  const joined = joinRuns({ run_id: env.RUN_ID, start, end }, siblings, comments)
  const mine = comments.filter((c) => !joined.excludeIds.includes(c.id))

  const { produced, produced_ids } = classify({ comments: mine, reviews, commits }, win, env.RULE === 'legacy' ? legacyClassifyComment : undefined)
  const rl = diffRateLimit(env.RL_START ? safeJson(env.RL_START) : null, rlEnd)

  const record = {
    ts: end,
    flow: env.WORKFLOW_FILE,
    harness: env.HARNESS || 'unknown',
    model: env.MODEL || 'unknown',
    issue, pr,
    stage: env.STAGE || 'unknown',
    run_id: env.RUN_ID,
    attempt: env.RUN_ATTEMPT || '1',
    workflow: env.WORKFLOW_FILE,
    started_at: start,
    ended_at: end,
    conclusion: conclusionOf(env.NEEDS_JSON),
    produced,
    produced_ids,
    overlap: joined.overlap,
    attribution: joined.attribution,
    source: env.SOURCE || 'live',
    rule: env.RULE === 'legacy' ? 'legacy' : 'marker',
    api_calls: rl.api_calls,
    api_calls_reason: rl.reason,
    token: env.TOKEN_KIND === 'app' ? 'app' : 'github_token',
    ref: `https://github.com/${repo}/actions/runs/${env.RUN_ID}`,
  }
  const res = validate(record)
  if (!res.ok) throw new Error(`record invalid: ${res.errors.join('; ')}`)
  return res.record
}

const safeJson = (s) => { try { return JSON.parse(s) } catch { return null } }

/** Write one file via the contents API. Creates the orphan branch on first use. Retries 409/422. */
export async function writeRecord({ repo, token, record, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com'
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    let json = null
    try { json = await res.json() } catch { /* empty body */ }
    return { status: res.status, json }
  }

  const ref = await call('GET', `/repos/${repo}/git/ref/heads/${DATA_BRANCH}`)
  if (ref.status === 404) {
    const blob = await call('POST', `/repos/${repo}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: 'Per-run pipeline records (#3251). One JSON file per workflow run under records/<date>/. Machine-written; do not edit.\n' }] })
    if (blob.status >= 300) throw new Error(`could not create data tree: HTTP ${blob.status}`)
    const commit = await call('POST', `/repos/${repo}/git/commits`, { message: 'chore(data): init pipeline-data', tree: blob.json.sha, parents: [] })
    if (commit.status >= 300) throw new Error(`could not create data commit: HTTP ${commit.status}`)
    const mk = await call('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.json.sha })
    if (mk.status >= 300 && mk.status !== 422) throw new Error(`could not create ${DATA_BRANCH}: HTTP ${mk.status}`) // 422 = a parallel run made it first
  } else if (ref.status >= 300) {
    throw new Error(`could not read ${DATA_BRANCH}: HTTP ${ref.status}`)
  }

  const path = `records/${record.started_at.slice(0, 10)}/${record.run_id}-${record.attempt}.json`
  const content = Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64')
  for (let attempt = 1; attempt <= 3; attempt++) {
    const put = await call('PUT', `/repos/${repo}/contents/${path}`, { message: `data: run ${record.run_id} (${record.workflow})`, content, branch: DATA_BRANCH })
    if (put.status < 300) return path
    if ((put.status === 409 || put.status === 422) && attempt < 3) { await sleep(200 + Math.random() * 800 * attempt); continue }
    throw new Error(`write ${path} failed: HTTP ${put.status}`)
  }
  return path
}

async function main() {
  const env = process.env
  try {
    const base = env.GITHUB_API_URL || 'https://api.github.com'
    const api = async (path) => {
      const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
      return res.json()
    }
    const listRecords = async (date) => {
      const res = await fetch(`${base}/repos/${env.REPO}/contents/records/${date}?ref=${DATA_BRANCH}`, { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' } })
      if (!res.ok) return []
      const files = await res.json()
      const out = []
      for (const f of files.slice(-50)) {
        try { out.push(await (await fetch(f.download_url)).json()) } catch { /* skip */ }
      }
      return out
    }
    const rlEnd = await readRateLimit(env.GH_TOKEN)
    const record = await buildRecord({ env, api, listRecords, rlEnd })
    if (!env.DATA_TOKEN) {
      console.log(`::notice::run record not written (no data token). Would have been: ${JSON.stringify(record)}`)
      return
    }
    const path = await writeRecord({ repo: env.REPO, token: env.DATA_TOKEN, record })
    console.log(`recorded run ${record.run_id} → ${DATA_BRANCH}:${path} produced=${record.produced.join(',')} api_calls=${record.api_calls}`)
  } catch (e) {
    console.log(`::notice::run record skipped: ${e?.message || e}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main()
  process.exit(0)
}
