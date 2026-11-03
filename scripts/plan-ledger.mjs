#!/usr/bin/env node
/**
 * #2757 — one ledger row per plan-reviewed issue, so epic #2754's success measure can be counted.
 *   node scripts/plan-ledger.mjs <issue>   → prints ONE JSON line on stdout
 * The build worker appends it to writeups/reports/plan-review-ledger.jsonl (so it lands in the
 * build PR). Row: { issue, planRounds, verdict, fixRounds } — planRounds = plans posted,
 * verdict = the last review verdict, fixRounds = owner revise rounds after the build (0 when the
 * row is written; a later row for the same issue supersedes an earlier one).
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function ledgerRow(issue, comments) {
  const bodies = comments.map((c) => c.body || '')
  const plans = bodies.filter((b) => b.includes('<!-- pipeline-plan:v1 -->')).length
  const verdicts = bodies.flatMap((b) => [...b.matchAll(/<!-- plan-review-verdict:([a-z-]+) -->/g)].map((m) => m[1]))
  return { issue: Number(issue), planRounds: plans, verdict: verdicts.at(-1) || 'none', fixRounds: 0 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issue = process.argv[2]
  if (!issue) { console.error('usage: plan-ledger.mjs <issue>'); process.exit(2) }
  const out = execFileSync('gh', ['api', '--paginate', `repos/{owner}/{repo}/issues/${issue}/comments?per_page=100`, '--jq', '.[] | {body}'], { encoding: 'utf8' })
  const comments = out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  console.log(JSON.stringify(ledgerRow(issue, comments)))
}
