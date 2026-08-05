#!/usr/bin/env node
// append-bundle-history.mjs — append ONE bundle record to the committed trend (#1581).
// Reads a record (from bundle-size.mjs) on stdin, appends to
// writeups/perf/bundle-history.jsonl. Idempotent per (app, commit): a re-run on the
// same merge never adds a second point. Mirrors loop-station/append-history.mjs.
//
// Usage:
//   node scripts/perf/bundle-size.mjs --app velo --dir <dir> --commit $SHA \
//     | node scripts/perf/append-bundle-history.mjs
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HISTORY = join(ROOT, 'writeups/perf/bundle-history.jsonl')

let record
try {
  record = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  console.error('append-bundle-history: stdin is not a valid JSON record')
  process.exit(1)
}
if (!record || !record.app) {
  console.error('append-bundle-history: record needs an "app"')
  process.exit(1)
}

// Idempotent per (app, commit) when a commit is recorded.
if (record.commit && existsSync(HISTORY)) {
  const dup = readFileSync(HISTORY, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .some((r) => r && r.app === record.app && r.commit === record.commit)
  if (dup) {
    console.log(`false`) // already recorded for this (app, commit)
    process.exit(0)
  }
}

if (!existsSync(dirname(HISTORY))) mkdirSync(dirname(HISTORY), { recursive: true })
appendFileSync(HISTORY, JSON.stringify(record) + '\n')
console.log(`true`) // appended (the workflow reads this to decide whether to commit)
console.error(`append-bundle-history: ${record.app} · ${(record.totalGzip / 1024).toFixed(1)} KB gzip · ${record.scorecard?.overall ?? '?'}`)
