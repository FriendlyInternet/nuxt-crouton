#!/usr/bin/env node
// backfill.mjs — one-off: write `source: "backfill"` records for runs from before the live
// record existed (#3251). Idempotent: a run that already has a record is skipped.
//
//   node scripts/eval-ledger/backfill.mjs --from 2026-10-22 --to 2026-11-02 [--dry-run]
//   (the owner runs this once, after the first live record lands and the `pipeline-data` branch exists;
//    needs GH_TOKEN with read access and DATA_TOKEN with contents:write. Large ranges: split by week —
//    the Actions API serves at most 1000 runs per query.)
//
// Old comments lack the pipeline-note marker, so this uses the FROZEN legacy rule
// (`rule: "legacy"`, see legacyIsNote). The subject (issue/PR) is read from the run's first job
// log; an unreadable log yields `produced: ["unknown"]`, never a guess. Every `nothing` row
// stores the run URL (`ref`) so a human can check it. api_calls is unknowable: null / "backfill".
import { pathToFileURL } from 'node:url'
import { buildRecord, writeRecord, DATA_BRANCH } from './record-run.mjs'
import { parseArgs } from '../lib/cli-args.mjs'

const WORKFLOWS = ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml', 'plan-review.yml', 'build-review.yml', 'ticket-review.yml', 'fix-ci-on-failure.yml', 'on-comment.yml']

/** Subject from a job log or the head branch: `ISSUE: 123`, `EPIC: 123`, `PR: 123`, or branch `work-123`. */
export function subjectFromLog(text, headBranch = '') {
  const t = text || ''
  const pick = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null }
  const issue = pick(/\b(?:ISSUE|EPIC|ISSUE_NUMBER):\s*(\d+)/)
  const pr = pick(/\bPR:\s*(\d+)/)
  const b = /^work-(\d+)/.exec(headBranch)
  return { issue: issue ?? (b ? Number(b[1]) : null), pr }
}

/** A skipped run never ran an agent — it is not a "nothing" row. Cancelled/failed runs are recorded. */
export const isRecordable = (run) => run.conclusion !== 'skipped' && run.status !== 'queued'

/** Every run of `wf` created in `from..to`, paged (GitHub caps a page at 100; the API serves at most 1000 per query). */
export async function listAllRuns(get, repo, wf, from, to) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const { workflow_runs } = await get(`/repos/${repo}/actions/workflows/${wf}/runs?created=${from}..${to}&per_page=100&page=${page}`)
    out.push(...workflow_runs)
    if (workflow_runs.length < 100) break
  }
  return out
}

// fallow-ignore-next-line complexity -- one-shot backfill CLI loop; CRAP is a zero-coverage artifact on a run-once script (#3251)
async function main() {
  const args = parseArgs(process.argv.slice(2), { boolean: ['dry-run'] })
  const from = String(args.from || ''), to = String(args.to || '')
  if (!from || !to) { console.error('usage: backfill.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]'); process.exit(2) }
  const env = process.env
  const repo = env.REPO || env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton'
  const token = env.GH_TOKEN
  const base = env.GITHUB_API_URL || 'https://api.github.com'
  const get = async (path, text = false) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
    return text ? res.text() : res.json()
  }
  let written = 0, skipped = 0
  for (const wf of WORKFLOWS) {
    for (const run of (await listAllRuns(get, repo, wf, from, to)).filter(isRecordable)) {
      const path = `records/${(run.run_started_at || run.created_at).slice(0, 10)}/${run.id}-${run.run_attempt}.json`
      try { await get(`/repos/${repo}/contents/${path}?ref=${DATA_BRANCH}`); skipped++; continue } catch { /* absent → write */ }
      let subject = { issue: null, pr: null }
      try {
        const { jobs } = await get(`/repos/${repo}/actions/runs/${run.id}/jobs`)
        subject = subjectFromLog(await get(`/repos/${repo}/actions/jobs/${jobs[0].id}/logs`, true), run.head_branch)
      } catch { subject = subjectFromLog('', run.head_branch) }
      const e = { REPO: repo, RUN_ID: String(run.id), RUN_ATTEMPT: String(run.run_attempt), WORKFLOW_FILE: wf, STAGE: 'backfill', RULE: 'legacy', SOURCE: 'backfill',
        ISSUE: subject.issue ?? '', PR: subject.pr ?? '', NEEDS_JSON: JSON.stringify({ run: { result: run.conclusion === 'cancelled' ? 'cancelled' : run.conclusion === 'failure' ? 'failure' : 'success' } }) }
      const subjectKnown = subject.issue || subject.pr
      const record = await buildRecord({ env: e, api: get, listRecords: async () => [], rlEnd: { error: 'backfill' }, now: new Date(run.updated_at) })
      record.api_calls = null; record.api_calls_reason = 'backfill'; record.token = 'github_token'
      if (!subjectKnown) { record.produced = ['unknown']; record.produced_ids = [] }
      if (args['dry-run']) { console.log(`${wf} ${run.id} → ${record.produced.join(',')}${record.produced.includes('nothing') ? ' ' + record.ref : ''}`); continue }
      await writeRecord({ repo, token: env.DATA_TOKEN || token, record })
      written++
    }
  }
  console.log(`backfill: ${written} written, ${skipped} already present`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()
