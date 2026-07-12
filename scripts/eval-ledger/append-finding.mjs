#!/usr/bin/env node
// append-finding.mjs — validate + append ONE defect-finding to findings.jsonl (#1570).
// The capture entry point a review gate (code-review, red-team, …) calls when it
// raises — or a human confirms/rejects — a defect. Mirrors append.mjs.
//
// Usage (flags map 1:1 to findings-schema fields; --ts defaults to now):
//   node scripts/eval-ledger/append-finding.mjs \
//     --gate code-review --severity high --status confirmed --confirmed_via fix-merged \
//     --author_flow task-worker --author_ref https://github.com/.../pull/123 \
//     --finding_ref https://github.com/.../pull/123#discussion_r1 --notes "off-by-one in pager"
//
//   # or pipe a full JSON object on stdin:
//   echo '{"gate":"code-review","severity":"low","status":"pending"}' | node scripts/eval-ledger/append-finding.mjs --stdin
//
// --check   validate without writing (exit 1 on invalid) — for CI / pre-commit.
// --findings  override the path (default writeups/loop-station/findings.jsonl).
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './findings-schema.mjs'
import { parseArgs } from '../lib/cli-args.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_FINDINGS = join(ROOT, 'writeups/loop-station/findings.jsonl')

const args = parseArgs(process.argv.slice(2), { boolean: ['stdin', 'check', 'escaped'] })
const findingsPath = args.findings ? String(args.findings) : DEFAULT_FINDINGS
const checkOnly = 'check' in args

let input
if ('stdin' in args) {
  input = JSON.parse(readFileSync(0, 'utf8'))
} else {
  input = {
    ts: args.ts ?? new Date().toISOString(),
    gate: args.gate,
    severity: args.severity,
    author_ref: args.author_ref,
    author_flow: args.author_flow,
    status: args.status,
    confirmed_via: args.confirmed_via,
    escaped: 'escaped' in args ? true : undefined,
    missed_gate: args.missed_gate,
    finding_ref: args.finding_ref,
    notes: args.notes,
  }
}

if (input && (input.ts === undefined || input.ts === null || input.ts === '')) {
  input.ts = new Date().toISOString()
}

const res = validate(input)
if (!res.ok) {
  console.error('✗ invalid finding record:')
  for (const e of res.errors) console.error(`  - ${e}`)
  process.exit(1)
}

if (checkOnly) {
  console.log('✓ finding valid (not written — --check)')
  process.exit(0)
}

if (!existsSync(dirname(findingsPath))) mkdirSync(dirname(findingsPath), { recursive: true })
appendFileSync(findingsPath, JSON.stringify(res.record) + '\n')
console.log(`✓ appended to ${findingsPath.replace(ROOT + '/', '')} (${res.record.gate} · ${res.record.severity} · ${res.record.status})`)
