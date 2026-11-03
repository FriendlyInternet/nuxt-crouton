#!/usr/bin/env node
/**
 * Append one inventory record to writeups/loop-station/history.jsonl (WS1, #927).
 *
 *   node gather.mjs | node append-history.mjs
 *   node append-history.mjs < record.json
 *
 * Reads the JSON record from stdin and appends it as one line. IDEMPOTENT per
 * commit: if the last recorded line already has this commit sha, it's a no-op
 * (re-running the workflow on the same merge doesn't double-count), and likewise if the
 * totals equal the previous row's (nothing measurable changed). Prints
 * `appended` or `skipped <reason>` to stderr and sets the exit-status-free
 * `LOOP_STATION_APPENDED` marker on stdout (`true`/`false`) for CI to gate the
 * commit-back step.
 *
 * history.jsonl is COMMITTED (small, in-repo so the metric travels with the code
 * it measures and stays `git blame`-able). The runtime trace (WS2) is the only
 * Loop Station dataset that is gitignored — not this.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const HISTORY = join(ROOT, 'writeups/loop-station/history.jsonl')

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const raw = readStdin().trim()
if (!raw) {
  console.error('append-history: no record on stdin')
  process.stdout.write('false\n')
  process.exit(1)
}

let record
try {
  record = JSON.parse(raw)
} catch (err) {
  console.error(`append-history: stdin is not valid JSON: ${err.message}`)
  process.stdout.write('false\n')
  process.exit(1)
}

function lastRecord() {
  if (!existsSync(HISTORY)) return null
  const lines = readFileSync(HISTORY, 'utf8').trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  try {
    return JSON.parse(lines[lines.length - 1])
  } catch {
    return null
  }
}

const last = lastRecord()

if (record.commit && record.commit === last?.commit) {
  console.error(`append-history: skipped — commit ${record.commit.slice(0, 8)} already recorded`)
  process.stdout.write('false\n')
  process.exit(0)
}

// A merge that left every total unchanged adds no information, only a commit on main (#2892).
if (last?.totals && JSON.stringify(record.totals) === JSON.stringify(last.totals)) {
  console.error('append-history: skipped — totals identical to the previous row')
  process.stdout.write('false\n')
  process.exit(0)
}

mkdirSync(dirname(HISTORY), { recursive: true })
appendFileSync(HISTORY, JSON.stringify(record) + '\n')
console.error(
  `append-history: appended — ${record.totals?.alwaysOnTokens} always-on tok, ` +
    `${record.redundancy?.pct}% redundancy (commit ${record.commit?.slice(0, 8) || '?'})`
)
process.stdout.write('true\n')
