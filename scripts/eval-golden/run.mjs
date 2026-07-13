#!/usr/bin/env node
// run.mjs — score a candidate model on one golden task and append the result to the
// WS6b eval ledger, tagged `flow: golden-<task>`. WS6b.3 (#885), parent #865, epic #669.
//
// This is deliberately the SCORING half only: a candidate model works the task's
// throwaway prompt (see tasks.mjs `promptSummary`) via whatever flow is under test
// (a delegate-pi run, a manual session, etc.) against a FIXTURE / scratch path —
// never `main` — and this script then checks the deterministic acceptance criteria
// and records the outcome. It does not itself drive the model.
//
// Usage:
//   node scripts/eval-golden/run.mjs --task reports-only --model anthropic/claude-haiku-4-5 \
//     --harness pi --report-path writeups/reports/golden-reports-only.md
//
//   node scripts/eval-golden/run.mjs --task small-crud --model ollama/qwen2.5-coder \
//     --harness pi --playwright-report playwright-report/report.json
//
//   node scripts/eval-golden/run.mjs --task scaffold --model anthropic/claude-haiku-4-5 \
//     --harness pi --scaffold-dir /tmp/golden-scaffold
//
//   --dry-run   run the check and print the verdict, but don't append to the ledger.
//   --ledger    override the ledger path (passed through to append.mjs).
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTask, GOLDEN_TASKS } from './tasks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (!args.task || args.task === true) {
  console.error(`Usage: node scripts/eval-golden/run.mjs --task <${GOLDEN_TASKS.map((t) => t.id).join('|')}> --model <provider/model> --harness <claude|pi> [options]`)
  process.exit(1)
}

const task = getTask(String(args.task))
if (!task) {
  console.error(`✗ unknown task "${args.task}" — known: ${GOLDEN_TASKS.map((t) => t.id).join(', ')}`)
  process.exit(1)
}

const ctx = {
  root: ROOT,
  reportPath: args['report-path'] ? resolve(process.cwd(), String(args['report-path'])) : undefined,
  playwrightReport: args['playwright-report'] ? resolve(process.cwd(), String(args['playwright-report'])) : undefined,
  scaffoldDir: args['scaffold-dir'] ? String(args['scaffold-dir']) : undefined,
}

const verdict = task.check(ctx)

console.log(`golden-${task.id}: ${verdict.ok ? 'PASS' : 'FAIL'} — ${verdict.reason}`)

if (args['dry-run']) {
  process.exit(verdict.ok ? 0 : 1)
}

if (!args.model || !args.harness) {
  console.error('✗ --model and --harness are required to append a ledger record (or pass --dry-run to skip)')
  process.exit(1)
}

const appendArgs = [
  join(ROOT, 'scripts/eval-ledger/append.mjs'),
  '--flow', `golden-${task.id}`,
  '--skill', 'eval-golden',
  '--harness', String(args.harness),
  '--model', String(args.model),
  '--artifact_gate', verdict.ok ? 'pass' : 'fail',
  '--ci', 'na',
  '--outcome', verdict.ok ? 'report' : 'abandoned',
  '--notes', verdict.reason,
]
if (args.cost_usd) appendArgs.push('--cost_usd', String(args.cost_usd))
if (args.wall_s) appendArgs.push('--wall_s', String(args.wall_s))
if (args.ref) appendArgs.push('--ref', String(args.ref))
if (args.ledger) appendArgs.push('--ledger', String(args.ledger))

try {
  execFileSync(process.execPath, appendArgs, { stdio: 'inherit' })
} catch (err) {
  process.exit(err.status ?? 1)
}

process.exit(verdict.ok ? 0 : 1)
