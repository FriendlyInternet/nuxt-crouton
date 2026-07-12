#!/usr/bin/env node
// ingest-findings.mjs — resolve captured finding CANDIDATES into committed findings (#1570).
// The main-context rollup (loop-station-findings.yml) runs this after downloading the
// gate workflows' `loop-station-finding-*` candidate artifacts. Confirmation comes from
// the DURABLE PR-merge fact, not an ephemeral CI state machine:
//
//   PR merged  → the 🔴 that blocked it was fixed → a CONFIRMED caught defect (author −w, gate +w)
//   PR closed  → the defect never shipped          → DROP the candidate (no score)
//   PR open    → not yet resolved                  → SKIP (a later run re-evaluates)
//
// Idempotent: skips a candidate whose (gate, ref, escaped) identity is already recorded.
//
// Usage:
//   node scripts/eval-ledger/ingest-findings.mjs --status-map states.json cand1.json cand2.json
//   states.json = { "999": "merged", "1000": "closed", "1001": "open" }
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate, dedupKey, parseFindings } from './findings-schema.mjs'
import { parseArgs } from '../lib/cli-args.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Pure core (importable + tested). Given candidate objects, a { pr: state } map, and
 * the existing findings, return the confirmed records to append + a per-candidate outcome.
 * @param {any[]} candidates  parsed candidate objects (carry `_pr`)
 * @param {Record<string,string>} statusMap  pr number → "merged"|"closed"|"open"
 * @param {import('./findings-schema.mjs').FindingRecord[]} existing
 */
export function resolveCandidates(candidates, statusMap, existing) {
  const seen = new Set(existing.map(dedupKey))
  const toAppend = []
  const outcomes = []
  for (const c of candidates) {
    const pr = c._pr != null ? String(c._pr) : null
    const state = pr ? statusMap[pr] : undefined
    if (state === 'merged') {
      const { _pr, ...fields } = c
      const rec = validate({ ...fields, status: 'confirmed', confirmed_via: 'fix-merged' })
      if (!rec.ok) { outcomes.push({ pr, outcome: 'invalid' }); continue }
      const key = dedupKey(rec.record)
      if (seen.has(key)) { outcomes.push({ pr, outcome: 'dup' }); continue }
      seen.add(key)
      toAppend.push(rec.record)
      outcomes.push({ pr, outcome: 'confirmed' })
    } else if (state === 'closed') {
      outcomes.push({ pr, outcome: 'dropped' })
    } else {
      outcomes.push({ pr, outcome: 'skipped' }) // open / unknown
    }
  }
  return { toAppend, outcomes }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { boolean: ['dry-run'] })
  const findingsPath = args.findings ? String(args.findings) : join(ROOT, 'writeups/loop-station/findings.jsonl')
  const statusMap = args['status-map'] && existsSync(String(args['status-map']))
    ? JSON.parse(readFileSync(String(args['status-map']), 'utf8'))
    : {}
  const files = process.argv.slice(2).filter((a) => a.endsWith('.json') && existsSync(a))
  const candidates = files.map((f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }).filter(Boolean)
  const { records: existing } = parseFindings(existsSync(findingsPath) ? readFileSync(findingsPath, 'utf8') : '')

  const { toAppend, outcomes } = resolveCandidates(candidates, statusMap, existing)
  for (const o of outcomes) console.error(`  PR #${o.pr}: ${o.outcome}`)

  if (!toAppend.length) {
    console.log('ingest-findings: no new confirmed findings')
    process.exit(0)
  }
  if ('dry-run' in args) {
    console.log(`ingest-findings: would append ${toAppend.length} confirmed finding(s)`)
    process.exit(0)
  }
  appendFileSync(findingsPath, toAppend.map((f) => JSON.stringify(f)).join('\n') + '\n')
  console.log(`ingest-findings: appended ${toAppend.length} confirmed finding(s)`)
}
