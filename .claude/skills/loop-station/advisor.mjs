#!/usr/bin/env node
/**
 * Loop Station advisor — the "should we bother the human?" gate (WS5, #933).
 *
 *   node .claude/skills/loop-station/advisor.mjs            # → findings JSON on stdout
 *   node .claude/skills/loop-station/advisor.mjs --pretty   # + human summary on stderr
 *
 * DETERMINISTIC by design. It reads the committed inventory history (WS1) and
 * surfaces *candidate* findings — scorecard reds, threshold crossings, sudden
 * growth — and decides whether anything is worth a human's attention. It writes
 * NO issue and runs NO LLM: it's the cheap gate in front of the (separate) LLM
 * advisor step, so the model only ever runs when there's genuinely something to
 * say (and never touches the deterministic trend — epic #926's boundary).
 *
 * Output: { actionable, generatedAt, tokenizer, latest, findings[] }. The CI
 * workflow sets `actionable` as a step output; only then does it invoke the LLM
 * to open/update ONE issue assigned to the maintainer with recommendations.
 *
 * Two inputs, one gate: the INVENTORY (size/redundancy trend, WS1) and — when
 * the committed WS-A rollup exists — the USAGE record (invocation counts,
 * #1064), which powers the dead-weight rule (#1066). The usage side NEVER
 * judges blind: no rollup, thin coverage, or too few runs ⇒ no dead-weight
 * findings, and the output says why.
 *
 * No deps. Pure ESM. Also importable: `import { analyze } from './advisor.mjs'`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS } from './lib/scorecard.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const HISTORY = join(ROOT, 'writeups/loop-station/history.jsonl')
const USAGE = join(ROOT, 'writeups/loop-station/usage.jsonl')

// Tunable thresholds for what's worth flagging. Absolute reds reuse the scorecard;
// growth/redundancy-jump are advisor-specific deltas between consecutive points.
export const ADVISOR = {
  growthTokens: 2000, // always-on jumped this many tokens since last point
  growthPct: 12, // …or this %
  redundancyJumpPct: 5, // corpus redundancy rose this many points
  // Dead-weight rule (#1066): a skill ≥ the scorecard's oversized-artifact amber
  // band that provably never fired. "Provably" needs real coverage — both gates
  // below must hold before the rule may judge at all.
  deadWeightMinCoverageDays: 60, // cumulative windowDays across usage records
  deadWeightMinRuns: 5 // total observed CI runs — a near-empty window proves nothing
}

function tok(r) {
  return r?.totals?.alwaysOnTokens ?? null
}

/**
 * @param {object[]} records  parsed history.jsonl records, oldest→newest
 * @param {object[]} [usageRecords]  parsed usage.jsonl records (WS-A, #1064), oldest→newest
 * @returns {{actionable:boolean, tokenizer:string|null, latest:object|null, findings:object[], usage:object}}
 */
export function analyze(records, usageRecords = []) {
  const recs = (records || []).filter(Boolean)
  const latest = recs[recs.length - 1] || null
  const prev = recs.length > 1 ? recs[recs.length - 2] : null
  const findings = []
  const usage = usageCoverage(usageRecords)
  if (!latest) return { actionable: false, tokenizer: null, latest: null, findings, usage }

  const card = latest.scorecard || {}
  const push = (dim, severity, message, evidence) => findings.push({ dim, severity, message, evidence })

  // Absolute scorecard reds (the deterministic bands from WS1).
  if (card.length?.score === 'red') {
    push('length', 'high', 'Always-on context (CLAUDE.md) is in the red band.', {
      alwaysOnTokens: card.length.alwaysOnTokens ?? tok(latest),
      oversized: (card.length.oversized || []).slice(0, 5)
    })
  }
  if (card.redundancy?.score === 'red') {
    push('redundancy', 'medium', 'Corpus redundancy is in the red band.', {
      pct: card.redundancy.pct,
      topPairs: (latest.redundancy?.topPairs || []).slice(0, 3)
    })
  }
  if (card.driftRisk?.score === 'red') {
    push('drift-risk', 'medium', 'Several artifact pairs must be kept in sync (drift risk).', {
      pairs: card.driftRisk.pairs,
      examples: (card.driftRisk.examples || []).slice(0, 3)
    })
  }

  // Deltas vs the previous point (only meaningful with ≥2 points AND the same
  // tokenizer — comparing a heuristic point to an API point is apples/oranges).
  if (prev && prev.tokenizer === latest.tokenizer) {
    const dTok = (tok(latest) ?? 0) - (tok(prev) ?? 0)
    const pct = tok(prev) ? (dTok / tok(prev)) * 100 : 0
    if (dTok >= ADVISOR.growthTokens || pct >= ADVISOR.growthPct) {
      push('growth', 'high', 'Always-on context grew sharply since the last merge.', {
        from: tok(prev),
        to: tok(latest),
        deltaTokens: dTok,
        deltaPct: Math.round(pct * 10) / 10,
        causedBy: latest.pr ? `#${latest.pr}` : latest.commit?.slice(0, 8)
      })
    }
    const dRed = (latest.redundancy?.pct ?? 0) - (prev.redundancy?.pct ?? 0)
    if (dRed >= ADVISOR.redundancyJumpPct) {
      push('redundancy-growth', 'medium', 'Redundancy rose noticeably since the last merge.', {
        from: prev.redundancy?.pct,
        to: latest.redundancy?.pct,
        delta: Math.round(dRed * 10) / 10
      })
    }
  }

  // Dead weight (#1066): oversized skill × provably zero invocations. Judged ONLY
  // with real coverage — otherwise the rule stays silent and `usage.judged` says why.
  if (usage.judged) {
    const fired = new Set()
    for (const u of usageRecords) for (const name of Object.keys(u?.byName || {})) fired.add(name)
    const candidates = (latest.artifacts || [])
      .filter((a) => a.kind === 'skill' && a.tokens >= THRESHOLDS.artifact.amber && a.name && !fired.has(a.name))
      .map((a) => ({ name: a.name, tokens: a.tokens, invocations: 0 }))
      .sort((x, y) => y.tokens - x.tokens)
    if (candidates.length > 0) {
      push(
        'dead-weight',
        'medium',
        `${candidates.length} oversized skill(s) never fired in CI across the covered window.`,
        {
          scope: 'pipeline', // 0 = never fired IN CI — interactive sessions aren't covered (#1067)
          coverageDays: usage.coverageDays,
          runs: usage.runs,
          candidates: candidates.slice(0, 8)
        }
      )
    }
  }

  return { actionable: findings.length > 0, tokenizer: latest.tokenizer ?? null, latest, findings, usage }
}

/**
 * Coverage summary of the WS-A usage records — the "may the dead-weight rule
 * judge at all?" gate. Meta-only records (a quiet week) still count as covered
 * window: the collector ran and saw nothing, which is a fact about the window —
 * but the minRuns gate keeps a run-starved window from flagging everything.
 */
export function usageCoverage(usageRecords = []) {
  const recs = (usageRecords || []).filter((r) => r && r.source === 'ci-rollup')
  const coverageDays = recs.reduce((sum, r) => sum + (r.windowDays || 0), 0)
  const runs = recs.reduce((sum, r) => sum + (r.runs || 0), 0)
  const judged = coverageDays >= ADVISOR.deadWeightMinCoverageDays && runs >= ADVISOR.deadWeightMinRuns
  const why = judged
    ? null
    : recs.length === 0
      ? 'no usage rollup yet (#1064)'
      : coverageDays < ADVISOR.deadWeightMinCoverageDays
        ? `coverage ${coverageDays}d < ${ADVISOR.deadWeightMinCoverageDays}d`
        : `only ${runs} runs < ${ADVISOR.deadWeightMinRuns}`
  return { judged, coverageDays, runs, records: recs.length, scope: 'pipeline', ...(why ? { why } : {}) }
}

function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function readHistory(file = HISTORY) {
  return readJsonl(file)
}

export function readUsage(file = USAGE) {
  return readJsonl(file)
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const records = readHistory()
  const result = analyze(records, readUsage())
  const out = {
    actionable: result.actionable,
    generatedAt: process.env.LOOP_STATION_NOW || new Date().toISOString(),
    tokenizer: result.tokenizer,
    latest: result.latest
      ? { commit: result.latest.commit, pr: result.latest.pr, alwaysOnTokens: tok(result.latest), scorecard: result.latest.scorecard?.overall }
      : null,
    usage: result.usage,
    findings: result.findings
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')

  // Step output for the workflow gate (only invoke the LLM when actionable).
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_OUTPUT, `actionable=${result.actionable}\n`)
  }

  if (process.argv.includes('--pretty')) {
    const u = result.usage
    process.stderr.write(
      `\n── Loop Station advisor ────────────────────────────────\n` +
        `points        ${records.length}\n` +
        `tokenizer     ${result.tokenizer}\n` +
        `usage         ${u.judged ? `${u.coverageDays}d · ${u.runs} runs · pipeline scope` : `not judged — ${u.why}`}\n` +
        `actionable    ${result.actionable ? 'YES' : 'no — nothing to report'}\n` +
        result.findings.map((f) => `  • [${f.severity}] ${f.dim}: ${f.message}`).join('\n') +
        (result.findings.length ? '\n' : '') +
        `────────────────────────────────────────────────────────\n`
    )
  }
}
