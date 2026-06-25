#!/usr/bin/env node
// append.mjs — validate + append ONE run-outcome record to the eval ledger (JSONL).
// WS6b.1 (#883). The capture entry point flows call after a run completes.
//
// Usage (flags map 1:1 to schema fields; --ts defaults to now):
//   node scripts/eval-ledger/append.mjs \
//     --flow a11y-reports --harness pi --model claude-haiku-4-5-20251001 \
//     --skill a11y --wall_s 142 --artifact_gate pass --ci na --outcome report \
//     --ref https://github.com/.../runs/123 --notes "first pi a11y run"
//
//   # or pipe a full JSON object on stdin:
//   echo '{"flow":"x","harness":"pi","model":"m"}' | node scripts/eval-ledger/append.mjs --stdin
//
// --check   validate without writing (exit 1 on invalid) — for CI / pre-commit.
// --ledger  override the ledger path (default writeups/reports/eval-ledger.jsonl).
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './schema.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_LEDGER = join(ROOT, 'writeups/reports/eval-ledger.jsonl')

const args = parseArgs(process.argv.slice(2))
const ledgerPath = args.ledger ? String(args.ledger) : DEFAULT_LEDGER
const checkOnly = '--check' in rawFlags(process.argv)

let input
if ('stdin' in args) {
  input = JSON.parse(readFileSync(0, 'utf8'))
} else {
  input = {
    ts: args.ts ?? new Date().toISOString(),
    flow: args.flow,
    skill: args.skill,
    harness: args.harness,
    model: args.model,
    cost_usd: args.cost_usd,
    turns: args.turns,
    wall_s: args.wall_s,
    artifact_gate: args.artifact_gate,
    ci: args.ci,
    outcome: args.outcome,
    human: args.human,
    fix_rounds: args.fix_rounds,
    ref: args.ref,
    notes: args.notes,
  }
}

// `ts` defaults to now in both the flag and --stdin paths.
if (input && (input.ts === undefined || input.ts === null || input.ts === '')) {
  input.ts = new Date().toISOString()
}

const res = validate(input)
if (!res.ok) {
  console.error('✗ invalid ledger record:')
  for (const e of res.errors) console.error(`  - ${e}`)
  process.exit(1)
}

if (checkOnly) {
  console.log('✓ record valid (not written — --check)')
  process.exit(0)
}

if (!existsSync(dirname(ledgerPath))) mkdirSync(dirname(ledgerPath), { recursive: true })
appendFileSync(ledgerPath, JSON.stringify(res.record) + '\n')
console.log(`✓ appended to ${ledgerPath.replace(ROOT + '/', '')} (${res.record.flow} · ${res.record.model} · ${res.record.outcome})`)

// --- tiny arg parser (no deps) ---
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (key === 'stdin' || key === 'check') { out[key] = true; continue }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = true }
    else { out[key] = next; i++ }
  }
  return out
}
function rawFlags(argv) {
  const f = {}
  for (const a of argv) if (a.startsWith('--')) f[a] = true
  return f
}
