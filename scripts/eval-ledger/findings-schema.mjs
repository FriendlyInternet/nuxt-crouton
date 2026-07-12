// findings-schema.mjs — the DEFECT-FINDING record shape + validation + the
// asymmetric scoring rules. One record per confirmed (or pending/rejected)
// defect a review gate raised against an authored change.
//
// This is the reviewer-vs-author side of the eval ledger (#1570, epic #926/#883):
// where schema.mjs records ONE run-outcome per author run, this records ONE
// finding per defect. accountability.mjs joins the two into the two leaderboards.
//
// Dependency-free on purpose (node built-ins only) so it runs in any CI step
// without install — same contract as schema.mjs.
//
// ── The asymmetric scoring model (decided on #1570) ───────────────────────────
// Every CONFIRMED finding is a zero-sum-ish transaction, severity-weighted:
//
//   caught in review   → author −w        · catcher(gate) +w
//   escaped review,     → author −w·ESCAPE · catcher       +w · missed_gate −w
//     caught later
//   rejected (false +)  → gate   −w        · author 0   (noise penalty on the gate)
//   pending             → nothing scores yet (a find scores only once confirmed)
//
// The clean-merge author reward (+1 for a merged run with no confirmed defect)
// is NOT a finding — it comes from the run-outcome ledger and is applied in
// accountability.mjs, so findings.jsonl stays the single record of *defects*.

/**
 * @typedef {Object} FindingRecord
 * @property {string}  ts            ISO-8601 timestamp (UTC)
 * @property {string}  gate          the reviewing gate/skill that raised it, e.g.
 *                                    "code-review", "red-team", "a11y", or the
 *                                    later catcher for an escaped defect ("human-revert").
 * @property {"critical"|"high"|"medium"|"low"} severity  the gate's own severity rating.
 * @property {string|null} author_ref  the run-outcome ledger `ref` (PR/run URL) of the
 *                                    introducing run — the JOIN KEY to schema.mjs records.
 * @property {string|null} author_flow  denormalized author flow (e.g. "task-worker") — used
 *                                    when no ledger row matches author_ref, so a finding can
 *                                    still be attributed to a flow.
 * @property {"pending"|"confirmed"|"rejected"} status  pending = not scored yet; confirmed =
 *                                    a real defect (scores); rejected = false-positive (penalizes the gate).
 * @property {"fix-merged"|"reverted"|"lgtm"|"incident"|null} confirmed_via  HOW it was confirmed.
 * @property {boolean} escaped        false = caught during review; true = shipped, caught later.
 * @property {string|null} missed_gate  for an escaped defect: the gate that SHOULD have caught it (takes −w).
 * @property {string|null} finding_ref  URL of the finding itself (PR comment / review). Names + refs only — NO payload.
 * @property {string|null} notes
 */

/** Severity → weight. The one place to tune the relative cost of a defect class. */
export const SEVERITY_WEIGHT = { critical: 5, high: 3, medium: 2, low: 1 }

/** Multiplier on the author penalty when a defect ESCAPED review (heavier than a caught one). */
export const ESCAPE_MULT = 2

/** The flat reward a clean merged run earns its author (applied in accountability.mjs). */
export const CLEAN_MERGE_REWARD = 1

export const ENUMS = {
  severity: ['critical', 'high', 'medium', 'low'],
  status: ['pending', 'confirmed', 'rejected'],
  confirmed_via: ['fix-merged', 'reverted', 'lgtm', 'incident', null],
  // A finding's LANE. `defect` = a correctness/security/a11y/convention failure the author
  // is culpable for (the main board). `quality` = a preference on correct code (e.g. a
  // /simplify cleanup) — kept in a SEPARATE low-weight lane so it never dilutes the defect
  // signal or punishes verbose-but-correct code. Default `defect` (back-compat: old lines
  // have no class field). (#1570)
  class: ['defect', 'quality'],
}

const REQUIRED_STR = ['ts', 'gate']

/**
 * Validate a finding. Returns { ok:true, record } with defaults filled, or
 * { ok:false, errors }. Never throws on bad input. Mirrors schema.mjs::validate.
 * @param {any} rec
 */
export function validate(rec) {
  if (rec == null || typeof rec !== 'object') {
    return { ok: false, errors: ['record is not an object'] }
  }

  const errors = []
  checkRawFields(rec, errors)
  const withDefaults = applyDefaults(rec)
  checkEnums(withDefaults, errors)
  checkAttribution(withDefaults, errors)

  if (errors.length) return { ok: false, errors }
  return { ok: true, record: withDefaults }
}

/** Required non-empty strings + a parseable timestamp, read off the RAW record. */
function checkRawFields(rec, errors) {
  for (const k of REQUIRED_STR) {
    if (typeof rec[k] !== 'string' || rec[k].length === 0) {
      errors.push(`"${k}" is required and must be a non-empty string`)
    }
  }
  if (typeof rec.ts === 'string' && Number.isNaN(Date.parse(rec.ts))) {
    errors.push(`"ts" is not a parseable ISO-8601 date: ${rec.ts}`)
  }
}

/** Fill every optional field with its default; `escaped` normalizes to a strict boolean. */
function applyDefaults(rec) {
  return {
    ts: rec.ts,
    gate: rec.gate,
    severity: rec.severity ?? 'medium',
    class: rec.class ?? 'defect',
    author_ref: rec.author_ref ?? null,
    author_flow: rec.author_flow ?? null,
    status: rec.status ?? 'pending',
    confirmed_via: rec.confirmed_via ?? null,
    escaped: rec.escaped === true,
    missed_gate: rec.missed_gate ?? null,
    finding_ref: rec.finding_ref ?? null,
    notes: rec.notes ?? null,
  }
}

/** Every enum-typed field must hold one of its allowed values. */
function checkEnums(withDefaults, errors) {
  for (const k of ['severity', 'status', 'confirmed_via', 'class']) {
    if (!ENUMS[k].includes(withDefaults[k])) {
      errors.push(`"${k}" must be one of ${JSON.stringify(ENUMS[k])} (got ${JSON.stringify(withDefaults[k])})`)
    }
  }
}

/** A confirmed, caught finding needs SOMETHING to blame — a ledger ref or a flow. */
function checkAttribution(withDefaults, errors) {
  if (withDefaults.status === 'confirmed' && !withDefaults.author_ref && !withDefaults.author_flow && !withDefaults.escaped) {
    errors.push('a confirmed, caught finding needs "author_ref" or "author_flow" to attribute the −w')
  }
}

/** @param {FindingRecord} f — is this finding one that moves the board? */
export function scores(f) {
  return f.status === 'confirmed' || f.status === 'rejected'
}

/**
 * The scoring transactions a single finding produces — the heart of the model.
 * Returns [] for a finding that doesn't score yet (pending). Each transaction is
 * { agent, role: 'author'|'gate', delta }. Pure + deterministic → unit-tested.
 * @param {FindingRecord} f
 * @returns {{agent:string, role:'author'|'gate', delta:number}[]}
 */
export function transactionsFor(f) {
  const w = SEVERITY_WEIGHT[f.severity] ?? SEVERITY_WEIGHT.medium
  const author = f.author_flow || f.author_ref
  const out = []

  if (f.status === 'rejected') {
    // False-positive: the gate ate the noise penalty; the author is untouched.
    out.push({ agent: f.gate, role: 'gate', delta: -w })
    return out
  }

  if (f.status !== 'confirmed') return out // pending → nothing

  if (f.escaped) {
    // Shipped, caught later. The author pays the heavier penalty; whoever caught
    // it (the `gate` field, e.g. "human-revert") is credited; the gate that
    // should have caught it — if named — is debited for the miss.
    if (author) out.push({ agent: author, role: 'author', delta: -w * ESCAPE_MULT })
    out.push({ agent: f.gate, role: 'gate', delta: +w })
    if (f.missed_gate) out.push({ agent: f.missed_gate, role: 'gate', delta: -w })
    return out
  }

  // Caught cleanly in review: author −w, catcher +w.
  if (author) out.push({ agent: author, role: 'author', delta: -w })
  out.push({ agent: f.gate, role: 'gate', delta: +w })
  return out
}

/**
 * Stable identity of a finding for idempotent capture — a rollup re-runs, so the
 * same defect must never be appended twice. Keyed by the gate, what it's attributed
 * to, and whether it escaped (a caught + an escaped finding on the same ref are
 * distinct events). Status is deliberately NOT in the key: a pending finding that
 * later resolves to confirmed is the SAME finding, updated in place — not a new one.
 * @param {FindingRecord} f
 */
export function dedupKey(f) {
  return [f.class || 'defect', f.gate, f.author_ref || f.author_flow || '?', f.escaped ? 'escaped' : 'caught'].join('|')
}

/** Parse a JSONL string into validated findings, collecting parse/validation errors. */
export function parseFindings(text) {
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
