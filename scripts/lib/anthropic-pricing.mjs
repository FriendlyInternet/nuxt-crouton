/**
 * Anthropic API price table + a token→USD cost function (#1268).
 *
 * Claude Code transcripts (~/.claude/projects/**) record per-message token `usage`
 * but NO dollar figure — unlike pi sessions, which report `usage.cost.total` directly.
 * So to attribute claude-code-action (CI gate / resume / decompose) spend we COMPUTE
 * it from tokens here. pi cost stays exact (read straight from the session); only the
 * claude side is a computed estimate — keep that asymmetry in mind when reading totals.
 *
 * Rates are USD per 1M tokens, standard tier. Cache-write = 1.25×input, cache-read =
 * 0.1×input (Anthropic's published multipliers). EDIT THESE when prices change — this
 * table is the single source of truth for every cost-report / ledger row.
 *
 * No deps. Pure ESM.
 */

// USD per 1M tokens. Keyed by a substring matched against the model id (longest match wins).
export const PRICES = {
  'opus':     { input: 15, output: 75 },
  'sonnet':   { input: 3,  output: 15 },
  'haiku':    { input: 1,  output: 5 },
  // fallbacks by family generation if the id is unusual
  'claude-3': { input: 3,  output: 15 },
}

const DEFAULT = { input: 3, output: 15 } // unknown model → assume sonnet-class
const num = (v) => Number(v) || 0

/** Resolve a model id to its {input, output} per-Mtoken rates (longest substring match). */
export function ratesFor(model) {
  const id = String(model || '').toLowerCase()
  const hit = Object.entries(PRICES)
    .filter(([key]) => id.includes(key))
    .sort((a, b) => b[0].length - a[0].length)[0]
  return hit ? hit[1] : DEFAULT
}

/**
 * Compute USD for one message's token usage. Handles the cache tiers explicitly:
 * cache-creation is billed at 1.25× input, cache-read at 0.1× input.
 * @param {object} usage - a Claude `message.usage` object (input_tokens, output_tokens,
 *   cache_creation_input_tokens, cache_read_input_tokens)
 * @param {string} model
 * @returns {number} USD
 */
export function costForUsage(usage, model) {
  if (!usage) return 0
  const r = ratesFor(model)
  const perM =
    num(usage.input_tokens) * r.input +
    num(usage.output_tokens) * r.output +
    num(usage.cache_creation_input_tokens) * r.input * 1.25 +
    num(usage.cache_read_input_tokens) * r.input * 0.1
  return perM / 1_000_000
}

/** Total billable tokens for a usage object (for reporting/sanity). */
export function tokensForUsage(usage) {
  if (!usage) return 0
  return (
    num(usage.input_tokens) +
    num(usage.output_tokens) +
    num(usage.cache_creation_input_tokens) +
    num(usage.cache_read_input_tokens)
  )
}
