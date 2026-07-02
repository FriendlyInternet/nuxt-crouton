#!/usr/bin/env node
/**
 * Cross-run usage aggregator (Loop Station WS-A, #1064).
 *
 *   node aggregate-usage.mjs [--window <days>] <trace.jsonl ...>
 *
 * Reads N collect-traces NDJSON files (one per CI run: a `meta` header line then
 * tagged events) and emits ONE aggregate usage record on stdout — per-name
 * invocation counts for skills/agents/tools across all runs in the window.
 *
 * This is the record the weekly workflow appends to the COMMITTED
 * writeups/loop-station/usage.jsonl (via append-usage.mjs). Privacy holds by
 * construction: the inputs are already payload-free (names + ids + durations,
 * #929), and the output is aggregate names + counts only — the same granularity
 * history.jsonl commits for size.
 *
 * Zero input files / zero events ⇒ a meta-only record (runs: 0, byName: {}),
 * NOT silence — a gap in the trend must be visible (#1037's fail-loud lesson).
 *
 * No deps. Pure ESM. Importable: aggregate(texts, opts).
 */

import fs from 'node:fs'

/**
 * @param {string[]} texts - contents of collect-traces NDJSON files (one per run)
 * @param {{windowDays?: number, now?: string}} [opts]
 * @returns {object} one usage record
 */
export function aggregate(texts, opts = {}) {
  const windowDays = opts.windowDays ?? 7
  const generatedAt = opts.now || process.env.LOOP_STATION_NOW || new Date().toISOString()

  const runs = new Set()
  const workflows = new Set()
  const byName = {}
  let events = 0

  for (const text of texts) {
    if (!text) continue
    let meta = null
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let obj
      try {
        obj = JSON.parse(t)
      } catch {
        continue // tolerate a corrupt line, keep the rest of the file
      }
      if (obj.kind === 'meta') {
        meta = obj
        if (obj.run) runs.add(String(obj.run))
        if (obj.workflow) workflows.add(obj.workflow)
        continue
      }
      if (!obj.kind || !obj.name) continue
      events++
      const entry = (byName[obj.name] ||= {
        kind: obj.kind,
        count: 0,
        runs: new Set(),
        workflows: new Set(),
        firstSeen: null,
        lastSeen: null
      })
      entry.count++
      // Prefer the non-tool labelling when a name appears as both (same rule as the view).
      if (obj.kind === 'agent' || obj.kind === 'skill') entry.kind = obj.kind
      const run = obj.run || meta?.run
      if (run) entry.runs.add(String(run))
      if (meta?.workflow) entry.workflows.add(meta.workflow)
      if (obj.ts) {
        if (!entry.firstSeen || obj.ts < entry.firstSeen) entry.firstSeen = obj.ts
        if (!entry.lastSeen || obj.ts > entry.lastSeen) entry.lastSeen = obj.ts
      }
    }
  }

  // Sets → counts/lists for the committed record.
  const byNameOut = {}
  for (const name of Object.keys(byName).sort()) {
    const e = byName[name]
    byNameOut[name] = {
      kind: e.kind,
      count: e.count,
      runs: e.runs.size,
      workflows: [...e.workflows].sort(),
      ...(e.firstSeen ? { firstSeen: e.firstSeen } : {}),
      ...(e.lastSeen ? { lastSeen: e.lastSeen } : {})
    }
  }

  const record = {
    schema: 1,
    generatedAt,
    windowDays,
    source: 'ci-rollup',
    scope: 'pipeline',
    runs: runs.size,
    workflows: [...workflows].sort(),
    events,
    byName: byNameOut
  }
  if (events === 0) record.note = 'no trace events in window'
  return record
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const args = process.argv.slice(2)
  let windowDays = 7
  const files = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--window') windowDays = Number(args[++i]) || 7
    else files.push(args[i])
  }
  const texts = files.map((f) => {
    try {
      return fs.readFileSync(f, 'utf8')
    } catch {
      process.stderr.write(`aggregate-usage: unreadable ${f} — skipped\n`)
      return ''
    }
  })
  const record = aggregate(texts, { windowDays })
  process.stdout.write(JSON.stringify(record) + '\n')
  process.stderr.write(
    `aggregate-usage: ${record.events} events · ${Object.keys(record.byName).length} names · ` +
      `${record.runs} runs · ${record.workflows.length} workflows (window ${windowDays}d)\n`
  )
}
