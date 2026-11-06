#!/usr/bin/env node
/**
 * #2757 — one ledger row per plan-reviewed issue, so epic #2754's success measure can be counted.
 *   node scripts/plan-ledger.mjs <issue>   → prints ONE JSON line on stdout
 *   node scripts/plan-ledger.mjs --write <issue> → writes the row to the pipeline-data branch
 * (plan-ledger/<issue>-<run>-<attempt>.json), from record-outcome; never fails the run (#3457).
 * writeups/reports/plan-review-ledger.jsonl is frozen history. Row: { issue, planRounds, verdict, fixRounds } — planRounds = plans posted,
 * verdict = the last review verdict, fixRounds = owner revise rounds after the build (0 when the
 * row is written; a later row for the same issue supersedes an earlier one).
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeRecord } from './eval-ledger/record-run.mjs'
import { hasMarker, markerValue } from './lib/marker.mjs'

export function ledgerRow(issue, comments) {
  const bodies = comments.map((c) => c.body || '')
  const plans = bodies.filter((b) => hasMarker(b, '<!-- pipeline-plan:v1 -->')).length
  const verdicts = bodies.map((b) => markerValue(b, /<!-- plan-review-verdict:([a-z-]+) -->/)).filter(Boolean)
  return { issue: Number(issue), planRounds: plans, verdict: verdicts.at(-1) || 'none', fixRounds: 0 }
}

export const ledgerPath = (row, runId, attempt) => `plan-ledger/${row.issue}-${runId}-${attempt}.json`

function fetchComments(issue) {
  const out = execFileSync('gh', ['api', '--paginate', `repos/{owner}/{repo}/issues/${issue}/comments?per_page=100`, '--jq', '.[] | {body}'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function writeMode(issue) {
  const env = process.env
  try {
    if (!env.DATA_TOKEN) { console.log('::notice::plan-ledger row not written: no DATA_TOKEN'); return }
    const row = ledgerRow(issue, fetchComments(issue))
    const runId = env.RUN_ID || 'local'
    const attempt = env.RUN_ATTEMPT || '1'
    const path = ledgerPath(row, runId, attempt)
    const record = { ...row, run_id: runId, at: new Date().toISOString() }
    await writeRecord({ repo: env.REPO, token: env.DATA_TOKEN, record, path, message: `data: plan-ledger #${issue}` })
    console.log(`::notice::plan-ledger row written: ${path}`)
  } catch (e) {
    console.log(`::notice::plan-ledger row not written: ${e.message}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv[2] === '--write'
  const issue = write ? process.argv[3] : process.argv[2]
  if (!issue) { console.error('usage: plan-ledger.mjs [--write] <issue>'); process.exit(2) }
  if (write) await writeMode(issue)
  else console.log(JSON.stringify(ledgerRow(issue, fetchComments(issue))))
}
