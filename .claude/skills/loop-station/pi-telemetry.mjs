/**
 * pi.dev telemetry → Loop Station WS2 events + the #883 run-outcome ledger.
 *
 * #944 (epic #669) — the convergence adapter. Reads the telemetry surfaces pinned (from
 * REAL captures) in writeups/architecture/pi-telemetry-schema.md and maps them to the two
 * consumers, so a pi run feeds BOTH the trace view and the cost ledger from ONE feed:
 *
 *   - Loop Station WS2 trace events  { ts, kind, name, parent, depth, agentId?, durMs? }
 *     (same shape parse-transcripts.mjs emits for the claude-code-action harness)
 *   - #883 run-outcome LedgerRecord slice  { ts, flow, harness:'pi', model, cost_usd, turns, wall_s }
 *     (validated by scripts/eval-ledger/schema.mjs)
 *
 * CAPTURED SURFACES (the primary feed — built-in, always present):
 *   1. Native session JSONL      ~/.pi/agent/sessions/<slug>/<ts>_<id>.jsonl  (per-message usage)
 *   2. Subagent meta JSON        <slug>/subagent-artifacts/<runId>_<agent>_<idx>_meta.json
 * pi-otel GenAI spans (richer, tool-level nesting) are NOT collected yet — no OTLP receiver
 * is wired — so WS2 from pi is at AGENT granularity for now (one node per subagent). When
 * pi-otel spans are collected, tool-level children can be layered in (TODO, see schema doc §3).
 *   3. Skill loads (#2403)       from the native session JSONL: pi has no skill tool — the model
 *      `read`s `.claude/skills/<name>/SKILL.md`, so each such read is a `kind:'skill'` event
 *      (lib/skill-loads.mjs). This is the usage side of the dead-weight join; a single-use
 *      worker with no subagents still produces a trace from these.
 *
 * HARD PRIVACY RULE (parity with the WS2 transcript parser): forward names + ids + durations
 * + token counts + cost ONLY. NEVER forward message content, task/prompt text, cwd, or tool I/O.
 * Every mapper below picks a whitelist of fields by construction — it never spreads the source.
 *
 * Dependency-free (node built-ins only) so it runs in any CI step without an install — same
 * constraint as scripts/eval-ledger/schema.mjs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { skillLoadsFromSession } from './lib/skill-loads.mjs'

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "anthropic/claude-haiku-4-5-20251001:high" → provider "anthropic" (null if no "/"). */
export function providerFromModel(model) {
  if (typeof model !== 'string' || !model.includes('/')) return null
  return model.slice(0, model.indexOf('/')) || null
}

/** Strip the trailing ":<thinking>" qualifier pi appends to a worker's model id. */
export function normalizeModel(model) {
  if (typeof model !== 'string') return ''
  const noThinking = model.includes(':') ? model.slice(0, model.lastIndexOf(':')) : model
  return noThinking
}

/** pi exitCode → the run's own terminal verdict (NOT the ledger merge/ci state). */
export function outcomeFromExitCode(exitCode) {
  const n = num(exitCode)
  if (n === null) return 'error'
  return n === 0 ? 'success' : 'failure'
}

/**
 * Subagent meta JSON (schema doc §2) → a PiRunOutcome. Whitelist only — `meta.task` (the
 * full prompt) and `meta.modelAttempts[].*` content are deliberately dropped.
 * @returns {{
 *   runId:string, agent:string, exitCode:number, durationMs:number, toolCount:number,
 *   timestamp:number, model:string, provider:string|null,
 *   tokens:{input:number,output:number,cacheRead:number,cacheWrite:number,total:number},
 *   turns:number|null, costUsd:number, harness:'pi', outcome:'success'|'failure'|'error'
 * }}
 */
export function subagentMetaToRunOutcome(meta) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const u = m.usage && typeof m.usage === 'object' ? m.usage : {}
  const input = num(u.input) ?? 0
  const output = num(u.output) ?? 0
  const cacheRead = num(u.cacheRead) ?? 0
  const cacheWrite = num(u.cacheWrite) ?? 0
  const model = typeof m.model === 'string' ? m.model : ''
  return {
    runId: String(m.runId ?? ''),
    agent: String(m.agent ?? 'unknown'),
    exitCode: num(m.exitCode) ?? 0,
    durationMs: num(m.durationMs) ?? 0,
    toolCount: num(m.toolCount) ?? 0,
    timestamp: num(m.timestamp) ?? 0,
    model: normalizeModel(model),
    provider: providerFromModel(model),
    tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite },
    turns: num(u.turns),
    costUsd: num(u.cost) ?? 0,
    harness: 'pi',
    outcome: outcomeFromExitCode(m.exitCode),
  }
}

/**
 * Native session JSONL (schema doc §1) → a usage rollup. Sums the assistant `message` lines'
 * `usage` only; never reads `content`. Useful when there's no subagent meta (e.g. a single
 * decompose run) — gives the {model, provider, tokens, cost} slice the ledger wants.
 */
export function sessionUsageFromJsonl(text) {
  let model = null
  let provider = null
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  let costUsd = 0
  let messageCount = 0
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'model_change') {
      if (typeof o.provider === 'string') provider = o.provider
      if (typeof o.modelId === 'string') model = o.modelId
      continue
    }
    if (o.type === 'message' && o.message && o.message.role === 'assistant') {
      const msg = o.message
      const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : {}
      if (typeof msg.model === 'string') model = msg.model
      if (typeof msg.provider === 'string') provider = msg.provider
      tokens.input += num(u.input) ?? 0
      tokens.output += num(u.output) ?? 0
      tokens.cacheRead += num(u.cacheRead) ?? 0
      tokens.cacheWrite += num(u.cacheWrite) ?? 0
      costUsd += num(u.cost && u.cost.total) ?? 0
      messageCount++
    }
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  return { model, provider, tokens, costUsd, messageCount }
}

/**
 * Subagent metas → WS2 trace events (one `agent`-kind node per subagent). Sorted by start
 * time; each is a child of `root` at depth 0 — the spawn tree isn't in the meta alone (that
 * needs pi-otel spans), so we don't fabricate nesting. Privacy: name = agent ROLE, never task.
 */
export function subagentMetasToWs2Events(metas) {
  const list = Array.isArray(metas) ? metas : []
  return list
    .map((m) => subagentMetaToRunOutcome(m))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .map((o) => {
      const ev = {
        ts: new Date(o.timestamp || 0).toISOString(),
        kind: 'agent',
        name: o.agent,
        parent: 'root',
        depth: 0,
        agentId: o.runId,
      }
      if (o.durationMs) ev.durMs = o.durationMs
      return ev
    })
}

/**
 * PiRunOutcome → a #883 ledger record SLICE (the bits pi telemetry owns: model/cost/turns/
 * wall). Gate/CI/terminal-outcome stay the caller's to fill from the artifact-gate + CI, per
 * "the ledger CONSUMES pi telemetry rather than re-deriving it". Returns a plain object you
 * pass to scripts/eval-ledger/schema.mjs `validate()` (which fills the remaining defaults).
 */
export function runOutcomeToLedgerRecord(outcome, opts = {}) {
  const o = outcome || {}
  const ts = opts.ts ?? (o.timestamp ? new Date(o.timestamp).toISOString() : new Date().toISOString())
  const rec = {
    ts,
    flow: opts.flow ?? `pi-${o.agent ?? 'run'}`,
    skill: opts.skill ?? null,
    harness: 'pi',
    model: o.model ?? '',
    cost_usd: num(o.costUsd),
    turns: num(o.turns),
    wall_s: o.durationMs ? Math.round(o.durationMs / 1000) : null,
    ref: opts.ref ?? null,
  }
  // Let the caller pass through the gate/ci/outcome verdicts it already holds.
  if (opts.artifact_gate) rec.artifact_gate = opts.artifact_gate
  if (opts.ci) rec.ci = opts.ci
  if (opts.outcome) rec.outcome = opts.outcome
  if (opts.notes) rec.notes = opts.notes
  return rec
}

/**
 * Read all subagent meta JSON files under a pi sessions tree (or a flat dir of *_meta.json),
 * returning their parsed objects. Defensive: skips unreadable/invalid files. Local FS only.
 */
export function readSubagentMetas(dir) {
  const out = []
  if (!dir || !fs.existsSync(dir)) return out
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!e.name.endsWith('_meta.json') && !(e.name.endsWith('.json') && /meta/.test(e.name))) continue
      try { out.push(JSON.parse(fs.readFileSync(full, 'utf8'))) } catch { /* skip bad file */ }
    }
  }
  return out
}

/**
 * Read every pi session JSONL under `dir` (the per-run `--session-dir`, or a sessions tree)
 * and return the skill-load events across them (#2403). Local FS only; skips unreadable files.
 */
export function readSessionSkillLoads(dir) {
  const out = []
  if (!dir || !fs.existsSync(dir)) return out
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!e.name.endsWith('.jsonl')) continue
      try { out.push(...skillLoadsFromSession(fs.readFileSync(full, 'utf8'))) } catch { /* skip bad file */ }
    }
  }
  return out
}

/**
 * One-shot: a pi telemetry directory (+ optionally the run's session dir) → WS2 trace events
 * (with the leading `meta` header line the data seam expects). Agent events come from the
 * subagent metas; skill events from the session JSONL (#2403). Returns { events, meta } or
 * null when neither surface yielded anything.
 */
export function buildPiTrace(dir, opts = {}) {
  const metas = readSubagentMetas(dir)
  const events = [
    ...subagentMetasToWs2Events(metas),
    ...readSessionSkillLoads(opts.sessionDir),
  ].sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0))
  if (!events.length) return null
  return {
    meta: { kind: 'meta', source: 'pi', harness: 'pi', eventCount: events.length },
    events,
  }
}

// ── CLI: `node pi-telemetry.mjs <pi-telemetry-dir> [--session <dir>] [--ledger]` ───────────
// Default prints WS2 trace.jsonl (meta header + events). `--session` adds the run's pi
// session dir so skill loads are traced too (#2403). With --ledger, prints one ledger record
// slice per subagent (JSONL). Used by prepare-data.mjs and for manual inspection.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const sessIdx = args.indexOf('--session')
  const sessionDir = sessIdx >= 0 ? args[sessIdx + 1] : undefined
  const dir = args.find((a, i) => !a.startsWith('--') && !(sessIdx >= 0 && i === sessIdx + 1))
  const ledger = args.includes('--ledger')
  if (!dir && !sessionDir) {
    console.error('usage: node pi-telemetry.mjs <pi-telemetry-dir> [--session <pi-session-dir>] [--ledger]')
    process.exit(1)
  }
  if (ledger) {
    for (const m of readSubagentMetas(dir)) {
      console.log(JSON.stringify(runOutcomeToLedgerRecord(subagentMetaToRunOutcome(m))))
    }
  } else {
    const trace = buildPiTrace(dir, { sessionDir })
    if (!trace) { console.error('no subagent metas and no skill loads found'); process.exit(1) }
    console.log(JSON.stringify(trace.meta))
    for (const e of trace.events) console.log(JSON.stringify(e))
  }
}
