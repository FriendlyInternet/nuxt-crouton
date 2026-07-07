#!/usr/bin/env node
// from-pi-session.mjs — turn a pi.dev session jsonl into ONE run-outcome ledger record.
// WS6b.4 (#1203). Reads the native pi telemetry feed documented in #938
// (writeups/architecture/pi-telemetry-feed.md): each assistant turn carries
// `message.usage.{totalTokens,cost.total}` + `provider`/`model`, so a run's cost/tokens/turns
// are already on disk — this just rolls one session up into the #883 ledger shape.
//
// It EMITS a JSON record on stdout (it does not write the ledger itself) — pipe it to the
// single validating writer so there's one append path:
//
//   node scripts/eval-ledger/from-pi-session.mjs --latest --flow a11y-reports \
//     --ref https://github.com/.../runs/123 | node scripts/eval-ledger/append.mjs --stdin
//
// Flags:
//   --latest            use the most recently modified session under ~/.pi/agent/sessions
//   --session <path>    an explicit session jsonl (overrides --latest)
//   --flow <s>          REQUIRED — the flow tag (e.g. a11y-reports, decompose-pidev)
//   --skill <s>         driving skill (default null)
//   --outcome <s>       merged|reverted|abandoned|report|pending (default report)
//   --ref <url>         PR/issue/run URL for traceability
//   --notes <s>         free text (default names the session file)
//   --provider <s>      only count turns from this provider for COST (default anthropic —
//                       pi-claude-cli/subscription reports zero/unreliable usage, #938 caveat)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const SESSIONS_DIR = join(process.env.HOME || '', '.pi', 'agent', 'sessions')

const args = parseArgs(process.argv.slice(2))
if (!args.flow) die('--flow is required (e.g. --flow a11y-reports)')
const costProvider = args.provider || 'anthropic'

// ── locate the session file ───────────────────────────────────────────────────────────────
let file = args.session
if (!file && args.latest) file = newestSession(SESSIONS_DIR)
if (!file) die('no session — pass --session <path> or --latest')
let lines
try { lines = readFileSync(file, 'utf8').split('\n').filter(Boolean) }
catch (e) { die(`cannot read session ${file}: ${e.message}`) }

// ── roll up assistant turns ───────────────────────────────────────────────────────────────
let turns = 0, cost = 0
const modelCount = new Map()      // "provider/model" → count (cost-provider turns only)
let anyModel = null               // fallback if no cost-provider turns
let minTs = Infinity, maxTs = -Infinity

for (const line of lines) {
  let m
  try { m = JSON.parse(line) } catch { continue }
  const msg = m.message
  if (!msg || msg.role !== 'assistant' || !msg.usage) continue
  const ts = Number(msg.timestamp) || Date.parse(m.timestamp)
  if (Number.isFinite(ts)) { minTs = Math.min(minTs, ts); maxTs = Math.max(maxTs, ts) }
  const qualified = `${msg.provider || 'unknown'}/${msg.model || 'unknown'}`
  anyModel = anyModel || qualified
  if (msg.provider === costProvider) {
    turns++
    cost += Number(msg.usage?.cost?.total) || 0
    modelCount.set(qualified, (modelCount.get(qualified) || 0) + 1)
  }
}

if (turns === 0) {
  process.stderr.write(`⚠ no ${costProvider}-provider assistant turns in ${basename(file)} — cost_usd will be null (subscription/pi-claude-cli runs don't report usage, per #938).\n`)
}

const model = topKey(modelCount) || anyModel || 'unknown/unknown'
const wall_s = Number.isFinite(maxTs) && Number.isFinite(minTs) && maxTs > minTs
  ? Math.round((maxTs - minTs) / 1000) : null

const record = {
  ts: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : new Date().toISOString(),
  flow: args.flow,
  skill: args.skill ?? null,
  harness: 'pi',
  model,                                   // provider-qualified per the scoreboard convention
  cost_usd: cost > 0 ? round6(cost) : null,
  turns: turns || null,
  wall_s,
  artifact_gate: args.artifact_gate ?? 'na',
  ci: args.ci ?? 'na',
  outcome: args.outcome ?? 'report',
  human: null,
  fix_rounds: null,
  ref: args.ref ?? null,
  notes: args.notes ?? `from pi session ${basename(file)}`,
}

process.stdout.write(JSON.stringify(record) + '\n')

// ── helpers ───────────────────────────────────────────────────────────────────────────────
function newestSession(dir) {
  let best = null, bestMtime = -1
  for (const f of jsonlFiles(dir)) {
    const mt = statSync(f).mtimeMs
    if (mt > bestMtime) { bestMtime = mt; best = f }
  }
  return best
}
// pi sessions live exactly one level deep: <sessions>/<cwd-slug>/<ts>_<id>.jsonl
function jsonlFiles(dir) {
  const out = []
  for (const slug of readdirSafe(dir)) collectJsonl(join(dir, slug), out)
  return out
}
function collectJsonl(sub, out) {
  if (!isDir(sub)) return
  for (const f of readdirSafe(sub)) if (f.endsWith('.jsonl')) out.push(join(sub, f))
}
function readdirSafe(d) { try { return readdirSync(d) } catch { return [] } }
function isDir(p) { try { return statSync(p).isDirectory() } catch { return false } }
function topKey(map) {
  let best = null, bestN = -1
  for (const [k, n] of map) if (n > bestN) { bestN = n; best = k }
  return best
}
function round6(n) { return Math.round(n * 1e6) / 1e6 }
function die(msg) { process.stderr.write(`ERROR: ${msg}\n`); process.exit(1) }
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    // a bare flag (--latest) or one whose next token is another flag → boolean true
    const takesVal = isValue(argv[i + 1])
    out[a.slice(2)] = takesVal ? argv[++i] : true
  }
  return out
}
function isValue(tok) { return tok !== undefined && !tok.startsWith('--') }
