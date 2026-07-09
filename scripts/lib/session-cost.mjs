/**
 * Read an agent session transcript → its metered cost (#1268).
 *
 * One reader for both harnesses, auto-detecting exact vs computed per turn:
 *   • pi turns report `usage.cost.total` (EXACT — use it verbatim)
 *   • claude turns carry only token counts (COMPUTED — price via anthropic-pricing)
 *
 * Shared by scripts/cost-report.mjs (the on-demand report) and the loop-station
 * trace collector (the CI rollup), so the "what did this run cost?" logic lives
 * in one tested place instead of being copy-pasted.
 *
 * No deps beyond the sibling price table. Pure ESM.
 */

import fs from 'node:fs'
import { costForUsage, tokensForUsage } from './anthropic-pricing.mjs'

/**
 * Parse one NDJSON transcript line → {usage, model} for a billable assistant turn, or null.
 * Only assistant turns carry usage; both harnesses set `message.role='assistant'` there
 * (pi's top-level type is 'message', claude's is 'assistant' — so key off role, not type).
 */
// fallow-ignore-next-line complexity -- defensive two-schema NDJSON parser; cyclomatic is null-guard noise (?./??), not logic. Covered by session-cost.test.mjs (#1268)
export function parseUsageLine(line) {
  let j
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const m = j.message
  if (m?.role && m.role !== 'assistant') return null
  const usage = m?.usage ?? j.usage
  return usage ? { usage, model: m?.model ?? j.model ?? null } : null
}

/** Yield each billable assistant turn from raw NDJSON text. */
export function* usageTurns(text) {
  for (const line of String(text).split('\n')) {
    const turn = line.trim() && parseUsageLine(line)
    if (turn) yield turn
  }
}

/**
 * Sum a session's cost from its NDJSON text. Returns {usd, tokens, turns, model, exact}.
 * `exact` is false if any turn had to be priced from tokens (i.e. a claude/computed session).
 */
// fallow-ignore-next-line complexity -- linear accumulation over turns; the branch count is the exact-vs-computed pick, not nesting. Covered by session-cost.test.mjs (#1268)
export function costFromText(text) {
  let usd = 0, tokens = 0, turns = 0, model = null, exact = true
  for (const { usage, model: m } of usageTurns(text)) {
    const reported = usage.cost?.total
    if (typeof reported === 'number') usd += reported
    else {
      usd += costForUsage(usage, m || model)
      exact = false
    }
    tokens += tokensForUsage(usage)
    turns++
    model = m || model
  }
  return { usd: Math.round(usd * 1e6) / 1e6, tokens, turns, model, exact }
}

/** Same as costFromText but reads the file (returns a zero row on any read error). */
export function costFromFile(file) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { usd: 0, tokens: 0, turns: 0, model: null, exact: true }
  }
  return costFromText(text)
}
