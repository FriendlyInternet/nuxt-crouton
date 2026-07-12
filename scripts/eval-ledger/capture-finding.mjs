#!/usr/bin/env node
// capture-finding.mjs — turn a gate's verdict file into a finding CANDIDATE (#1570).
// Runs inside a gate's PR workflow (frontend-review / a11y / red-team), which each
// write `<gate>-verdict.json` = {"highest":"none|note|warning|critical",...}.
//
// It emits a candidate to stdout — it does NOT write findings.jsonl. PR-branch runs
// must never commit the committed ledger; the candidate is uploaded as an artifact
// and the merge/scheduled rollup (loop-station-findings.yml) resolves + commits it
// to main. The candidate carries `_pr` so the rollup can check the durable merge fact.
//
// DEFECT gates (default --class defect): captured ONLY for a 🔴 critical verdict —
// critical BLOCKS merge, so a later merge means the author fixed it → a confirmed
// CAUGHT defect. Warnings/notes are advisory (don't block, can merge unaddressed) → not scored.
//
// QUALITY gates (--class quality, e.g. /simplify): a cleanup on CORRECT code, not a
// defect. Captured whenever the verdict reports ≥1 change, at a low severity, into the
// SEPARATE quality lane (never touches an author's defect Net). The gate emits a count
// as `fixes`/`count`, or a non-`none` `highest`. Default severity `low` (override --severity).
//
// Usage:
//   node scripts/eval-ledger/capture-finding.mjs --gate frontend-review \
//     --verdict frontend-review-verdict.json --pr 123 \
//     --author_ref https://github.com/o/r/pull/123 [--out finding-candidate.json]
//   # quality gate (the /simplify CI step calls this):
//   node scripts/eval-ledger/capture-finding.mjs --gate simplify --class quality \
//     --verdict simplify-verdict.json --pr 123 --author_ref https://github.com/o/r/pull/123
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseArgs } from '../lib/cli-args.mjs'

const args = parseArgs(process.argv.slice(2))
const gate = args.gate
const verdictPath = args.verdict
const pr = args.pr ? Number(args.pr) : null
const authorRef = args.author_ref ?? null

if (!gate || !verdictPath) {
  console.error('capture-finding: --gate and --verdict are required')
  process.exit(2)
}
if (!existsSync(verdictPath)) {
  // No verdict = the gate produced nothing (or an outage handled elsewhere). Nothing to capture.
  console.error(`capture-finding: no verdict at ${verdictPath} — nothing to capture`)
  process.exit(0)
}

let verdict
try {
  verdict = JSON.parse(readFileSync(verdictPath, 'utf8'))
} catch {
  console.error(`capture-finding: ${verdictPath} is not valid JSON — nothing to capture`)
  process.exit(0)
}

const cls = args.class === 'quality' ? 'quality' : 'defect'
const highest = String(verdict.highest ?? 'none').toLowerCase()

// Capture gate + severity + note differ by lane.
let severity, note
if (cls === 'quality') {
  // A cleanup on correct code: capture on any reported change, low severity by default.
  const fixes = Number(verdict.fixes ?? verdict.count ?? (highest !== 'none' ? 1 : 0)) || 0
  if (fixes <= 0) {
    console.error('capture-finding: quality verdict reports 0 changes — nothing to capture')
    process.exit(0)
  }
  severity = args.severity ?? 'low'
  note = `captured by ${gate} quality gate on PR #${pr ?? '?'}; ${fixes} cleanup(s)`
} else {
  if (highest !== 'critical') {
    console.error(`capture-finding: highest=${highest} (only 🔴 critical is captured for a defect gate) — nothing to capture`)
    process.exit(0)
  }
  severity = args.severity ?? 'critical'
  note = `captured by ${gate} CI gate on PR #${pr ?? '?'}; ${verdict.critical ?? 1} critical`
}

// A pending candidate: confirmed later by the PR's merge (the rollup does that).
const candidate = {
  ts: new Date().toISOString(),
  gate,
  severity,
  class: cls,
  author_ref: authorRef,
  author_flow: args.author_flow ?? null,
  status: 'pending',
  confirmed_via: null,
  escaped: false,
  missed_gate: null,
  finding_ref: authorRef,
  notes: note,
  _pr: pr,
}

const json = JSON.stringify(candidate, null, 2)
if (args.out) {
  writeFileSync(String(args.out), json + '\n')
  console.error(`capture-finding: wrote candidate → ${args.out}`)
}
console.log(json)
