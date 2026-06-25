// schema.mjs — the run-outcome ledger record shape + validation + scoring helpers.
// WS6b.1 of epic #669 (#883, parent #865). One record per agent run; the scoreboard
// (#884) and golden-task eval (#885) both read records that pass validate() here.
//
// Dependency-free on purpose (node built-ins only) so it runs in any CI step without install.

/**
 * A single agent-run outcome. Most fields already exist as signals elsewhere
 * (artifact-gate #461, CI, the merge/revert event) — capturing here is tag + append,
 * not generation.
 *
 * @typedef {Object} LedgerRecord
 * @property {string}  ts            ISO-8601 timestamp (UTC)
 * @property {string}  flow          the workflow/flow, e.g. "a11y-reports", "task-worker", "decompose-spike", "golden-crud"
 * @property {string|null} skill     the skill driving it, e.g. "a11y", "task-decompose" (null if none)
 * @property {"claude"|"pi"} harness  which in-job agent ran it
 * @property {string}  model         concrete model id, e.g. "claude-haiku-4-5-20251001", "deepseek-v3.2"
 * @property {number|null} cost_usd  run cost in USD (null = unknown/not captured yet)
 * @property {number|null} turns     agent turns (null = n/a)
 * @property {number|null} wall_s    wall-clock seconds (null = n/a)
 * @property {"pass"|"fail"|"na"} artifact_gate  the #461 artifact-gate verdict
 * @property {"pass"|"fail"|"na"} ci             CI verdict on the produced PR
 * @property {"merged"|"reverted"|"abandoned"|"report"|"pending"} outcome  terminal state ("report" = reports-only deliverable)
 * @property {"up"|"down"|null} human  human 👍/👎 (null = none yet)
 * @property {number|null} fix_rounds  rounds of fix-CI/feedback before terminal (null = n/a)
 * @property {string|null} ref         PR / issue / run URL for traceability
 * @property {string|null} notes       free text
 */

export const ENUMS = {
  harness: ['claude', 'pi'],
  artifact_gate: ['pass', 'fail', 'na'],
  ci: ['pass', 'fail', 'na'],
  outcome: ['merged', 'reverted', 'abandoned', 'report', 'pending'],
  human: ['up', 'down', null],
}

const REQUIRED_STR = ['ts', 'flow', 'harness', 'model']

/**
 * Validate a record. Returns { ok: true, record } with defaults filled, or
 * { ok: false, errors: string[] }. Never throws on bad input.
 * @param {any} rec
 */
export function validate(rec) {
  const errors = []
  if (rec == null || typeof rec !== 'object') {
    return { ok: false, errors: ['record is not an object'] }
  }

  for (const k of REQUIRED_STR) {
    if (typeof rec[k] !== 'string' || rec[k].length === 0) {
      errors.push(`"${k}" is required and must be a non-empty string`)
    }
  }
  if (typeof rec.ts === 'string' && Number.isNaN(Date.parse(rec.ts))) {
    errors.push(`"ts" is not a parseable ISO-8601 date: ${rec.ts}`)
  }

  // Enum fields (with sensible defaults for the optional ones).
  const withDefaults = {
    ts: rec.ts,
    flow: rec.flow,
    skill: rec.skill ?? null,
    harness: rec.harness,
    model: rec.model,
    cost_usd: num(rec.cost_usd),
    turns: num(rec.turns),
    wall_s: num(rec.wall_s),
    artifact_gate: rec.artifact_gate ?? 'na',
    ci: rec.ci ?? 'na',
    outcome: rec.outcome ?? 'pending',
    human: rec.human ?? null,
    fix_rounds: num(rec.fix_rounds),
    ref: rec.ref ?? null,
    notes: rec.notes ?? null,
  }

  for (const k of ['harness', 'artifact_gate', 'ci', 'outcome', 'human']) {
    if (!ENUMS[k].includes(withDefaults[k])) {
      errors.push(`"${k}" must be one of ${JSON.stringify(ENUMS[k])} (got ${JSON.stringify(withDefaults[k])})`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, record: withDefaults }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A run "succeeded" when no gate failed and it reached a positive terminal state.
 * Reports-only flows have no merge, so "report" counts as success; "pending" does not.
 * @param {LedgerRecord} r
 */
export function isSuccess(r) {
  if (r.artifact_gate === 'fail' || r.ci === 'fail') return false
  return r.outcome === 'merged' || r.outcome === 'report'
}

/** @param {LedgerRecord} r */
export function isRevert(r) {
  return r.outcome === 'reverted'
}

/** Parse a JSONL string into validated records, collecting parse/validation errors. */
export function parseLedger(text) {
  const records = []
  const errors = []
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      errors.push(`line ${i + 1}: invalid JSON`)
      return
    }
    const res = validate(obj)
    if (res.ok) records.push(res.record)
    else errors.push(`line ${i + 1}: ${res.errors.join('; ')}`)
  })
  return { records, errors }
}
