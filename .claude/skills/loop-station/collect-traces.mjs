#!/usr/bin/env node
/**
 * Cross-CI-run trace collector (Loop Station WS2, #929).
 *
 *   node .claude/skills/loop-station/collect-traces.mjs [--out <file>] [--all]
 *
 * Each CI runner is ephemeral: the agent runs, writes its session transcript
 * under ~/.claude/projects/<slug>/, and the runner is then discarded. This script
 * runs at job end, reconstructs the trace (via parse-transcripts.mjs), tags it
 * with the run identity, and writes ONE file the CI step uploads as an artifact —
 * so every run's topology lands in one place for the all-runs view (WS3).
 *
 * Output is NDJSON: a `meta` header line then one tagged event per line, so the
 * all-runs dataset is just `cat` of every run's file. Each event gains a `run`
 * field; nothing else changes (still names + ids + durations, NEVER payloads).
 *
 * The runner doesn't know the project slug, so we discover the most-recently
 * active session across every project dir under ~/.claude/projects.
 *
 * Defensive: if no transcript is found (e.g. the action wrote elsewhere) it emits
 * a meta-only file and exits 0 — never fails the agent job it rides along with.
 *
 * No deps. Pure ESM.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseSession } from './parse-transcripts.mjs'
import { costFromFile } from '../../../scripts/lib/session-cost.mjs'

/**
 * This session's metered cost from its transcript token usage (#1268) — the shared
 * reader (claude turns priced from tokens; a pi turn's exact cost.total is used if present).
 * Returns null when the session left no billable turn, so the meta stays clean.
 */
function sessionCost(projDir, session) {
  const r = costFromFile(path.join(projDir, session + '.jsonl'))
  return r.turns > 0 ? { usd: r.usd, tokens: r.tokens, turns: r.turns, model: r.model } : null
}

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const PROJECTS = process.env.CLAUDE_PROJECTS_DIR || path.join(process.env.HOME || '/root', '.claude/projects')
const OUT = flag('--out', process.env.LOOP_STATION_TRACE_OUT || 'loop-station-trace.jsonl')
const ALL = process.argv.includes('--all')

/** Every project dir under ~/.claude/projects (each holds <session>.jsonl files). */
function projectDirs() {
  try {
    return fs
      .readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(PROJECTS, d.name))
  } catch {
    return []
  }
}

/** All sessions across all projects, each tagged with its transcript mtime. */
function allSessions() {
  const out = []
  for (const dir of projectDirs()) {
    let files = []
    try {
      files = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      let mtime = 0
      try {
        mtime = fs.statSync(path.join(dir, f)).mtimeMs
      } catch {}
      out.push({ projDir: dir, session: f.replace(/\.jsonl$/, ''), mtime })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

const run = {
  run: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  workflow: process.env.GITHUB_WORKFLOW || null,
  job: process.env.GITHUB_JOB || null,
  repo: process.env.GITHUB_REPOSITORY || null,
  sha: process.env.GITHUB_SHA || null
}

const sessions = allSessions()
const picked = ALL ? sessions : sessions.slice(0, 1)

const lines = []
let totalEvents = 0
const parsed = []
const cost = { usd: 0, tokens: 0, turns: 0, model: null } // #1268 — metered spend for this run
for (const { projDir, session } of picked) {
  const result = parseSession({ projDir, session })
  if (result.events.length === 0) continue
  const c = sessionCost(projDir, session)
  parsed.push({ session: result.session, layout: result.layout, events: result.events.length, cost: c })
  if (c) {
    cost.usd += c.usd
    cost.tokens += c.tokens
    cost.turns += c.turns
    cost.model = c.model || cost.model
  }
  for (const e of result.events) {
    lines.push(JSON.stringify({ ...e, run: run.run, session: result.session }))
    totalEvents++
  }
}
cost.usd = Math.round(cost.usd * 1e6) / 1e6

const meta = {
  kind: 'meta',
  generatedAt: process.env.LOOP_STATION_NOW || new Date().toISOString(),
  ...run,
  sessions: parsed,
  eventCount: totalEvents,
  // Metered cost for this run, computed from transcript tokens (#1268). null-ish (0 turns)
  // for pi/subscription runs that leave no priced claude transcript here.
  cost: cost.turns > 0 ? cost : null
}

fs.writeFileSync(OUT, [JSON.stringify(meta), ...lines].join('\n') + '\n')
process.stderr.write(
  `collect-traces: ${totalEvents} events from ${parsed.length} session(s) → ${OUT}` +
    (run.run ? ` (run ${run.run}, ${run.workflow})` : ' (no CI run id — local)') +
    '\n'
)
