#!/usr/bin/env node
/**
 * Append one usage record to writeups/loop-station/usage.jsonl (WS-A, #1064).
 *
 *   node aggregate-usage.mjs <traces...> | node append-usage.mjs
 *
 * Mirror of append-history.mjs, keyed per WINDOW instead of per commit:
 * IDEMPOTENT per ISO week — if the last recorded line covers the same ISO week
 * as this record's generatedAt, it's a no-op (re-dispatching the weekly job
 * doesn't double-count). Prints `appended`/`skipped` to stderr and writes
 * `true`/`false` on stdout for CI to gate the commit-back step.
 *
 * usage.jsonl is COMMITTED — it's the aggregate (names + counts), never the
 * raw traces, which stay gitignored/artifact-only (#929's privacy rule).
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const USAGE = join(ROOT, 'writeups/loop-station/usage.jsonl')

/** ISO-8601 week key ("2026-W27") for an ISO timestamp — the idempotence unit. */
export function isoWeek(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  // Thursday of this week decides the ISO year/week.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8').trim()
  } catch {}
  if (!raw) {
    console.error('append-usage: no record on stdin')
    process.stdout.write('false\n')
    process.exit(1)
  }

  let record
  try {
    record = JSON.parse(raw)
  } catch (err) {
    console.error(`append-usage: stdin is not valid JSON: ${err.message}`)
    process.stdout.write('false\n')
    process.exit(1)
  }

  const week = isoWeek(record.generatedAt)
  const lastWeek = (() => {
    if (!existsSync(USAGE)) return null
    const lines = readFileSync(USAGE, 'utf8').trim().split('\n').filter(Boolean)
    if (lines.length === 0) return null
    try {
      return isoWeek(JSON.parse(lines[lines.length - 1]).generatedAt)
    } catch {
      return null
    }
  })()

  if (week && week === lastWeek) {
    console.error(`append-usage: skipped — week ${week} already recorded`)
    process.stdout.write('false\n')
    process.exit(0)
  }

  mkdirSync(dirname(USAGE), { recursive: true })
  appendFileSync(USAGE, JSON.stringify(record) + '\n')
  console.error(
    `append-usage: appended — ${record.events ?? 0} events, ${record.runs ?? 0} runs, ` +
      `${Object.keys(record.byName || {}).length} names (week ${week ?? '?'})`
  )
  process.stdout.write('true\n')
}
