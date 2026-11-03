/**
 * Tests for the pi.dev telemetry adapter (#944). Runs against the REAL captured fixtures in
 * pocs/loop-station/data/pi-telemetry-sample/ (sanitized samples from the mac-mini, #938).
 * Dependency-free: `node .claude/skills/loop-station/pi-telemetry.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  subagentMetaToRunOutcome,
  sessionUsageFromJsonl,
  subagentMetasToWs2Events,
  runOutcomeToLedgerRecord,
  buildPiTrace,
  outcomeFromExitCode,
  providerFromModel,
  normalizeModel,
} from './pi-telemetry.mjs'
import { validate } from '../../../scripts/eval-ledger/schema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE = path.join(HERE, '..', '..', '..', 'pocs', 'loop-station', 'data', 'pi-telemetry-sample')
const meta = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'subagent-artifacts', '8a6fa2d3_worker_0_meta.json'), 'utf8'))
const jsonl = fs.readFileSync(path.join(SAMPLE, 'session-sample.jsonl'), 'utf8')

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`) }

// ── helpers ──
test('providerFromModel splits on "/"', () => {
  assert.equal(providerFromModel('anthropic/claude-haiku-4-5-20251001:high'), 'anthropic')
  assert.equal(providerFromModel('claude-haiku-4-5'), null)
})
test('normalizeModel strips the :thinking qualifier', () => {
  assert.equal(normalizeModel('anthropic/claude-haiku-4-5-20251001:high'), 'anthropic/claude-haiku-4-5-20251001')
  assert.equal(normalizeModel('claude-haiku-4-5'), 'claude-haiku-4-5')
})
test('outcomeFromExitCode maps 0→success, else→failure', () => {
  assert.equal(outcomeFromExitCode(0), 'success')
  assert.equal(outcomeFromExitCode(1), 'failure')
  assert.equal(outcomeFromExitCode(undefined), 'error')
})

// ── subagent meta → PiRunOutcome ──
test('subagentMetaToRunOutcome maps the real worker sample', () => {
  const o = subagentMetaToRunOutcome(meta)
  assert.equal(o.runId, '8a6fa2d3')
  assert.equal(o.agent, 'worker')
  assert.equal(o.harness, 'pi')
  assert.equal(o.provider, 'anthropic')
  assert.equal(o.model, 'anthropic/claude-haiku-4-5-20251001') // :high stripped
  assert.equal(o.costUsd, 0.4202159)
  assert.equal(o.turns, 45)
  assert.equal(o.durationMs, 192340)
  assert.equal(o.outcome, 'success')
  assert.equal(o.tokens.total, 459 + 9236 + 2772244 + 77082)
})
test('PRIVACY: the outcome carries no task/prompt/content', () => {
  const o = subagentMetaToRunOutcome(meta)
  const blob = JSON.stringify(o)
  assert.ok(!('task' in o), 'task field must not be forwarded')
  assert.ok(!/REDACTED/.test(blob), 'no redacted prompt text may leak through')
})

// ── session JSONL → usage rollup (no content) ──
test('sessionUsageFromJsonl sums assistant usage only', () => {
  const u = sessionUsageFromJsonl(jsonl)
  assert.equal(u.messageCount, 1) // one assistant message in the sample
  assert.equal(u.model, 'claude-haiku-4-5-20251001')
  assert.equal(u.costUsd, 0.05511375)
  assert.equal(u.tokens.cacheWrite, 43751)
  assert.ok(!/REDACTED/.test(JSON.stringify(u)), 'no content leaks into the rollup')
})

// ── WS2 events ──
test('subagentMetasToWs2Events emits a valid agent node', () => {
  const events = subagentMetasToWs2Events([meta])
  assert.equal(events.length, 1)
  const e = events[0]
  assert.equal(e.kind, 'agent')      // the app renders 'agent' (orange)
  assert.equal(e.name, 'worker')
  assert.equal(e.parent, 'root')
  assert.equal(e.depth, 0)
  assert.equal(e.agentId, '8a6fa2d3')
  assert.equal(e.durMs, 192340)
  assert.ok(typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts)))
})
test('buildPiTrace reads the fixture dir and adds a meta header', () => {
  const trace = buildPiTrace(SAMPLE)
  assert.ok(trace, 'fixture dir should yield a trace')
  assert.equal(trace.meta.source, 'pi')
  assert.equal(trace.meta.eventCount, trace.events.length)
  assert.ok(trace.events.length >= 1)
})

// ── ledger feed: the slice must pass the REAL #883 validator ──
test('runOutcomeToLedgerRecord produces a record the #883 schema accepts', () => {
  const o = subagentMetaToRunOutcome(meta)
  const rec = runOutcomeToLedgerRecord(o, { flow: 'decompose-pidev', skill: 'task-decompose', ref: 'https://github.com/x/y/pull/1', artifact_gate: 'pass', ci: 'pass', outcome: 'merged' })
  const res = validate(rec)
  assert.ok(res.ok, 'ledger validate() must accept the mapped record: ' + JSON.stringify(res.errors))
  assert.equal(res.record.harness, 'pi')
  assert.equal(res.record.model, 'anthropic/claude-haiku-4-5-20251001')
  assert.equal(res.record.cost_usd, 0.4202159)
  assert.equal(res.record.turns, 45)
  assert.equal(res.record.wall_s, 192) // 192340ms → 192s
})

// ── #3158: cost + always-trace + per-run isolation ─────────────────────────────────────
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { costForPiUsage } from '../../../scripts/lib/session-cost.mjs'

const mainLine = (u, cost = 0, model = 'claude-sonnet-5') =>
  JSON.stringify({ type: 'message', message: { role: 'assistant', model, usage: { ...u, cost: { total: cost } } } })
const U = { input: 1000, output: 2000, cacheRead: 5000, cacheWrite: 300 }
const r6 = (n) => Math.round(n * 1e6) / 1e6
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pitel-'))
const metaFile = (dir, name, ts, usage = U, model = 'claude-sonnet-5') => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name + '_meta.json'), JSON.stringify({ runId: name, agent: 'worker', exitCode: 0, timestamp: ts, model, usage: { ...usage, cost: 0, turns: 1 } }))
}

test('(a,b) session with tokens, no subagents/skills → meta-only trace with workflow, run, cost', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 's.jsonl'), mainLine(U) + '\n')
  process.env.GITHUB_WORKFLOW = 'Work issue (pi.dev · single-use worker)'
  process.env.GITHUB_RUN_ID = '77'
  const t = buildPiTrace(d, { sessionDir: d })
  assert.equal(t.events.length, 0)
  assert.equal(t.meta.workflow, 'Work issue (pi.dev · single-use worker)')
  assert.equal(t.meta.run, '77')
  assert.equal(t.meta.cost.usd, r6(costForPiUsage(U, 'claude-sonnet-5')))
  assert.equal(t.meta.cost.estimatedUsd, t.meta.cost.usd)
})

test('(h) no session and no events → null', () => {
  assert.equal(buildPiTrace('/nonexistent-x', { sessionDir: '/nonexistent-x' }), null)
})

test('(j,k) top-level main + one helper meta → cost = main + helper exactly; event stream/transcript never priced', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 's.jsonl'), mainLine(U) + '\n')
  const sub = path.join(d, 'subagent-artifacts')
  metaFile(sub, 'h1', 1000)
  fs.writeFileSync(path.join(sub, 'h1.jsonl'), mainLine(U) + '\n')
  fs.writeFileSync(path.join(sub, 'h1_transcript.jsonl'), mainLine(U) + '\n')
  const t = buildPiTrace(d, { sessionDir: d })
  assert.equal(t.meta.cost.usd, r6(2 * costForPiUsage(U, 'claude-sonnet-5')))
  // a nested .jsonl alone prices 0 main turns
  const d2 = tmp()
  fs.mkdirSync(path.join(d2, 'x'))
  fs.writeFileSync(path.join(d2, 'x', 'n.jsonl'), mainLine(U) + '\n')
  assert.equal(buildPiTrace(d2, { sessionDir: d2 }), null)
})

test('(m) nested helper folders: both helpers counted once each', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 's.jsonl'), mainLine(U) + '\n')
  metaFile(path.join(d, 'subagent-artifacts'), 'a', 1000)
  metaFile(path.join(d, 'sub', 'subagent-artifacts'), 'b', 2000)
  const t = buildPiTrace(d, { sessionDir: d })
  assert.equal(t.events.length, 2)
  assert.equal(t.meta.cost.usd, r6(3 * costForPiUsage(U, 'claude-sonnet-5')))
})

test('(i,l) CLI from a mirrored layout resolves its import; shared-folder runs are isolated', () => {
  const root = tmp()
  const skillsDst = path.join(root, '.claude', 'skills')
  fs.mkdirSync(skillsDst, { recursive: true })
  fs.cpSync(HERE, path.join(skillsDst, 'loop-station'), { recursive: true })
  fs.cpSync(path.join(HERE, '..', '..', '..', 'scripts', 'lib'), path.join(root, 'scripts', 'lib'), { recursive: true })
  const shared = path.join(root, 'shared')
  metaFile(path.join(shared, 'other', 'subagent-artifacts'), 'other', 1)
  const run = path.join(root, 'run')
  fs.mkdirSync(run)
  fs.writeFileSync(path.join(run, 's.jsonl'), mainLine(U) + '\n')
  metaFile(path.join(run, 'subagent-artifacts'), 'mine', 2)
  const out = execFileSync('node', [path.join(skillsDst, 'loop-station', 'pi-telemetry.mjs'), run, '--session', run], { encoding: 'utf8' })
  const lines = out.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.length, 2) // meta + exactly my helper
  assert.equal(lines[1].agentId, 'mine')
  assert.equal(lines[0].cost.usd, r6(2 * costForPiUsage(U, 'claude-sonnet-5')))
})

console.log(`\npi-telemetry adapter: ${passed} tests passed`)
