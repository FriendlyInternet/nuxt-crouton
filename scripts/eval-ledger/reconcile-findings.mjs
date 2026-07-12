#!/usr/bin/env node
// reconcile-findings.mjs — derive ESCAPED-DEFECT findings from the run-outcome
// ledger, deterministically (#1570). A run whose outcome is `reverted` is an
// unambiguous, already-confirmed escaped defect: it shipped, then had to be undone.
// The eval-ledger already records these (the "gold negative signal") — so the
// escaped side of the scoreboard needs no CI state machine, just this join.
//
// gate = "revert" (the catcher), escaped = true, status = confirmed, missed_gate
// = null (which gate SHOULD have caught it is unknown from the ledger alone).
// Author penalty is the heavier escaped one (−2w), applied in accountability.mjs.
//
// Idempotent: skips any ref that ALREADY has an escaped finding (in ANY gate), so
// a manually-recorded escape (e.g. the #862 human-revert seed) is never doubled.
//
// Runs in a MAIN-context rollup (loop-station-findings.yml) — writing the committed
// findings.jsonl here is correct; a PR-branch run must not call this.
//
// Usage:
//   node scripts/eval-ledger/reconcile-findings.mjs            # append new escaped findings
//   node scripts/eval-ledger/reconcile-findings.mjs --dry-run  # print what it would add
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLedger } from './schema.mjs'
import { parseFindings, validate } from './findings-schema.mjs'
import { parseArgs } from '../lib/cli-args.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = parseArgs(process.argv.slice(2), { boolean: ['dry-run'] })
const findingsPath = args.findings ? String(args.findings) : join(ROOT, 'writeups/loop-station/findings.jsonl')
const ledgerPath = args.ledger ? String(args.ledger) : join(ROOT, 'writeups/reports/eval-ledger.jsonl')

/**
 * Pure core (importable + tested): given ledger + existing findings, return the
 * NEW escaped findings to append (idempotent by "already has an escaped finding
 * for this ref"). Severity defaults to high — a shipped-then-reverted defect is serious.
 * @param {import('./schema.mjs').LedgerRecord[]} ledger
 * @param {import('./findings-schema.mjs').FindingRecord[]} existing
 */
export function reconcile(ledger, existing) {
  const escapedRefs = new Set(existing.filter((f) => f.escaped && f.author_ref).map((f) => f.author_ref))
  const out = []
  for (const r of ledger) {
    if (r.outcome !== 'reverted' || !r.ref) continue
    if (escapedRefs.has(r.ref)) continue
    escapedRefs.add(r.ref) // guard against dup reverted rows on the same ref
    const rec = validate({
      ts: r.ts,
      gate: 'revert',
      severity: 'high',
      author_ref: r.ref,
      author_flow: r.flow ?? null,
      status: 'confirmed',
      confirmed_via: 'reverted',
      escaped: true,
      missed_gate: null,
      finding_ref: r.ref,
      notes: `derived from reverted run in the eval-ledger (${r.flow ?? 'unknown flow'})`,
    })
    if (rec.ok) out.push(rec.record)
  }
  return out
}

// ── CLI (guarded so importing reconcile() in a test doesn't run file IO / exit) ─
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''
  const findingsText = existsSync(findingsPath) ? readFileSync(findingsPath, 'utf8') : ''
  const { records: ledger } = parseLedger(ledgerText)
  const { records: existing } = parseFindings(findingsText)

  const toAdd = reconcile(ledger, existing)
  if (!toAdd.length) {
    console.log('reconcile-findings: no new escaped defects (all reverts already recorded)')
    process.exit(0)
  }
  if ('dry-run' in args) {
    console.log(`reconcile-findings: would add ${toAdd.length} escaped finding(s):`)
    for (const f of toAdd) console.log(`  ${f.author_ref} (${f.author_flow})`)
    process.exit(0)
  }
  appendFileSync(findingsPath, toAdd.map((f) => JSON.stringify(f)).join('\n') + '\n')
  console.log(`reconcile-findings: appended ${toAdd.length} escaped finding(s) to ${findingsPath.replace(ROOT + '/', '')}`)
}
