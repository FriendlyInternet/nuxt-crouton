#!/usr/bin/env node
/**
 * "Where did the API money go?" — on-demand cost report (#1268).
 *
 *   node scripts/cost-report.mjs [--since YYYY-MM-DD] [--by day|source|session] [--json]
 *
 * Sums metered Anthropic spend from the agent session logs on THIS machine (the
 * Mac-mini fleet runs the pi/claude CI jobs, so their logs are local):
 *   • pi runs      — ~/.pi/agent/sessions/**    EXACT   (session reports usage.cost.total)
 *   • claude runs  — ~/.claude/projects/**       COMPUTED (tokens × price table, #1268)
 *
 * The claude side is a computed estimate (transcripts carry tokens, not dollars) — the
 * authoritative figure is console.anthropic.com. This closes the local half of the
 * attribution gap that made "where did the €20 go?" unanswerable from our own data.
 *
 * No deps. Pure ESM.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { costFromFile } from './lib/session-cost.mjs'

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const SINCE = flag('--since')
const BY = flag('--by', 'source') // day | source | session
const AS_JSON = process.argv.includes('--json')

const safeReaddir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
const safeMtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** Walk a dir tree for *.jsonl files, returning {file, mtime}. */
// fallow-ignore-next-line complexity -- plain iterative dir walk; CRAP is a zero-coverage artifact on a local diagnostic CLI, not real complexity (#1268)
function jsonlFiles(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const e of safeReaddir(dir)) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name.endsWith('.jsonl')) out.push({ file: p, mtime: safeMtime(p) })
    }
  }
  return out
}

const afterSince = (mtime) => !SINCE || new Date(mtime) >= new Date(SINCE)

// ── gather ────────────────────────────────────────────────────────────────
const piRoot = path.join(os.homedir(), '.pi/agent/sessions')
const claudeRoot = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude/projects')

// Metered vs flat: CI jobs run on a self-hosted runner and bill ANTHROPIC_API_KEY (metered);
// interactive Claude Code on this Mac is the Max SUBSCRIPTION (flat — never touches the API
// key). Pricing a subscription transcript as API tokens is meaningless (it inflated the claude
// total to a nonsense $2k), so those are excluded from the metered total by default. pi always
// uses the API, metered wherever it runs. (#1268)
const isCiRunner = (file) => /actions-runner/.test(file)
const INCLUDE_FLAT = process.argv.includes('--include-subscription')

const rows = []
const flat = [] // subscription (interactive claude) — shown as a footnote, not billed
const rowFor = (source, env, file, mtime) => {
  const r = costFromFile(file)
  return { source, env, file, mtime, cost: r.usd, tokens: r.tokens, turns: r.turns, model: r.model }
}
for (const { file, mtime } of jsonlFiles(piRoot)) {
  if (!afterSince(mtime)) continue
  const row = rowFor('pi', isCiRunner(file) ? 'ci' : 'local', file, mtime)
  if (row.cost > 0) rows.push(row)
}
for (const { file, mtime } of jsonlFiles(claudeRoot)) {
  if (!afterSince(mtime)) continue
  // interactive claude is the Max subscription (flat) — computed cost is notional, not billed
  const subscription = !isCiRunner(file)
  const row = rowFor('claude', subscription ? 'subscription' : 'ci', file, mtime)
  if (row.cost <= 0) continue
  if (!subscription || INCLUDE_FLAT) rows.push(row)
  if (subscription) flat.push(row)
}

// ── group ─────────────────────────────────────────────────────────────────
const keyOf = (r) =>
  BY === 'day'
    ? new Date(r.mtime).toISOString().slice(0, 10)
    : BY === 'session'
      ? path.basename(r.file)
      : r.source
const groups = new Map()
for (const r of rows) {
  const k = keyOf(r)
  const g = groups.get(k) || { key: k, cost: 0, tokens: 0, turns: 0, sessions: 0, sources: new Set() }
  g.cost += r.cost
  g.tokens += r.tokens
  g.turns += r.turns
  g.sessions++
  g.sources.add(r.source)
  groups.set(k, g)
}
const sorted = [...groups.values()].sort((a, b) => b.cost - a.cost)
const total = rows.reduce((s, r) => s + r.cost, 0)
const piTotal = rows.filter((r) => r.source === 'pi').reduce((s, r) => s + r.cost, 0)
const claudeTotal = total - piTotal

if (AS_JSON) {
  console.log(
    JSON.stringify(
      { since: SINCE, by: BY, total, piTotal, claudeTotal, groups: sorted.map((g) => ({ ...g, sources: [...g.sources] })) },
      null,
      2
    )
  )
} else {
  const win = SINCE ? ` since ${SINCE}` : ' (all local history)'
  console.log(`\n💸 Anthropic API spend${win} — grouped by ${BY}\n`)
  console.log(`${'key'.padEnd(24)} ${'cost$'.padStart(9)} ${'sess'.padStart(5)} ${'turns'.padStart(6)}  src`)
  console.log('─'.repeat(60))
  for (const g of sorted) {
    console.log(
      `${g.key.slice(0, 24).padEnd(24)} ${g.cost.toFixed(2).padStart(9)} ${String(g.sessions).padStart(5)} ${String(g.turns).padStart(6)}  ${[...g.sources].join('+')}`
    )
  }
  console.log('─'.repeat(60))
  console.log(`${'TOTAL (metered)'.padEnd(24)} ${total.toFixed(2).padStart(9)}   (pi exact $${piTotal.toFixed(2)} · claude CI est. $${claudeTotal.toFixed(2)})`)
  if (flat.length && !INCLUDE_FLAT) {
    const flatCost = flat.reduce((s, r) => s + r.cost, 0)
    console.log(
      `\n(excluded: ${flat.length} interactive Claude subscription session(s) — flat-rate, NOT billed to the API key; ` +
        `would notionally price at ~$${flatCost.toFixed(0)}. Pass --include-subscription to show.)`
    )
  }
  console.log(`\nNote: pi is exact; claude CI is computed from tokens (#1268). Authoritative: console.anthropic.com/settings/usage\n`)
}
