#!/usr/bin/env node
// accountability.mjs — the adversarial accountability scoreboard (#1570).
// Joins findings.jsonl (defects) × the run-outcome ledger (author runs) into TWO
// leaderboards: authors (ranked worst-first by defect-rate) and review gates
// (ranked best-first by net catches). Sibling of scoreboard.mjs — same read-only,
// deterministic, no-deps, markdown/--json/--html shape.
//
// Usage:
//   node scripts/eval-ledger/accountability.mjs                 # markdown to stdout
//   node scripts/eval-ledger/accountability.mjs --json          # raw rollup as JSON
//   node scripts/eval-ledger/accountability.mjs --html          # standalone HTML view
//   node scripts/eval-ledger/accountability.mjs --findings <p> --ledger <p>
//
// The tally is deterministic arithmetic over the two JSONL files — no LLM. Severity
// weights + the escape multiplier live in findings-schema.mjs (tune in one place).
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFindings, transactionsFor, CLEAN_MERGE_REWARD } from './findings-schema.mjs'
import { parseLedger, isSuccess } from './schema.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The pure join — importable + unit-tested. Given validated findings + ledger
 * records, returns { authors, gates, qualityGates, transactions }.
 *   authors: [{ agent, net, defects, clean, rate, qualityFixes }]  worst-first (rate desc, then net asc)
 *   gates:   [{ agent, net, catches, falsePositives }]  DEFECT gates, best-first (net desc)
 *   qualityGates: [{ agent, net, fixes }]  the separate low-weight QUALITY lane (e.g. /simplify)
 *
 * Quality-class findings are kept OUT of the defect board (#1570): they never touch an
 * author's defect Net/Rate or the clean-merge reward — a simplification isn't a defect.
 * They only accrue a `qualityFixes` count per author + their own gate lane.
 * @param {import('./findings-schema.mjs').FindingRecord[]} findings
 * @param {import('./schema.mjs').LedgerRecord[]} ledger
 */
export function tally(findings, ledger) {
  const authors = new Map() // agent → { net, defects, clean, qualityFixes }
  const gates = new Map()   // agent → { net, catches, falsePositives }  (defect lane)
  const qGates = new Map()  // agent → { net, fixes }                    (quality lane)
  const acc = {
    A: (a) => authors.get(a) || authors.set(a, { agent: a, net: 0, defects: 0, clean: 0, qualityFixes: 0 }).get(a),
    G: (g) => gates.get(g) || gates.set(g, { agent: g, net: 0, catches: 0, falsePositives: 0 }).get(g),
    Q: (g) => qGates.get(g) || qGates.set(g, { agent: g, net: 0, fixes: 0 }).get(g),
  }

  const transactions = []
  // Author refs that carry a CONFIRMED DEFECT — these runs don't earn the clean reward.
  // A quality-class finding does NOT dirty a ref (correct code isn't a defect).
  const dirtyRefs = new Set()

  for (const f of findings) {
    const isQuality = f.class === 'quality'
    if (!isQuality && f.status === 'confirmed' && f.author_ref) dirtyRefs.add(f.author_ref)
    for (const t of transactionsFor(f)) {
      transactions.push({ ...t, ts: f.ts, gate: f.gate, severity: f.severity, class: f.class || 'defect' })
      applyTransaction(t, isQuality, acc)
    }
  }

  applyCleanMergeRewards(ledger, dirtyRefs, acc.A)

  const authorRows = [...authors.values()]
    .map((a) => ({ ...a, rate: a.defects + a.clean > 0 ? a.defects / (a.defects + a.clean) : 0 }))
    .sort((x, y) => y.rate - x.rate || x.net - y.net || x.agent.localeCompare(y.agent))
  const gateRows = [...gates.values()]
    .sort((x, y) => y.net - x.net || y.catches - x.catches || x.agent.localeCompare(y.agent))
  const qualityGateRows = [...qGates.values()]
    .sort((x, y) => y.net - x.net || x.agent.localeCompare(y.agent))

  return { authors: authorRows, gates: gateRows, qualityGates: qualityGateRows, transactions }
}

/**
 * Route one scoring transaction into the right accumulator. Quality-class findings
 * feed the separate low-weight lane; everything else feeds the defect board.
 * `acc` bundles the get-or-create accessors `{ A, G, Q }`.
 */
function applyTransaction(t, isQuality, acc) {
  if (isQuality) applyQualityTx(t, acc)
  else applyDefectTx(t, acc)
}

/** Quality lane: authors accrue a fix COUNT (not a net); the gate gets its own net. */
function applyQualityTx(t, { A, Q }) {
  if (t.role === 'author') {
    if (t.delta < 0) A(t.agent).qualityFixes++
    return
  }
  const g = Q(t.agent)
  g.net += t.delta
  if (t.delta > 0) g.fixes++
}

/** Defect board: author −w / +clean-reward; gate +w for a catch, −w for a false positive. */
function applyDefectTx(t, { A, G }) {
  if (t.role === 'author') {
    const a = A(t.agent)
    a.net += t.delta
    if (t.delta < 0) a.defects++
    return
  }
  const g = G(t.agent)
  g.net += t.delta
  if (t.delta > 0) g.catches++
  else if (t.delta < 0) g.falsePositives++
}

/** Clean-merge author reward: a merged, successful run with no confirmed defect. */
function applyCleanMergeRewards(ledger, dirtyRefs, A) {
  for (const r of ledger) {
    if (r.outcome !== 'merged' || !isSuccess(r)) continue
    if (r.ref && dirtyRefs.has(r.ref)) continue
    if (!r.flow) continue
    const a = A(r.flow)
    a.net += CLEAN_MERGE_REWARD
    a.clean++
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// Guard the CLI so importing tally() in a test doesn't run argv parsing / file IO.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const argv = process.argv.slice(2)
  const findingsPath = flag('--findings') ?? join(ROOT, 'writeups/loop-station/findings.jsonl')
  const ledgerPath = flag('--ledger') ?? join(ROOT, 'writeups/reports/eval-ledger.jsonl')
  const asJson = argv.includes('--json')
  const asHtml = argv.includes('--html')

  const findingsText = existsSync(findingsPath) ? readFileSync(findingsPath, 'utf8') : ''
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''
  const { records: findings, errors: fErr } = parseFindings(findingsText)
  const { records: ledger, errors: lErr } = parseLedger(ledgerText)
  for (const e of [...fErr, ...lErr]) console.error(`⚠ ${e}`)

  const { authors, gates, qualityGates } = tally(findings, ledger)
  const generated = new Date().toISOString()

  if (asJson) {
    console.log(JSON.stringify({ generated, authors, gates, qualityGates }, null, 2))
    process.exit(0)
  }

  const sign = (n) => (n > 0 ? `+${n}` : `${n}`)

  if (asHtml) {
    const authorRows = authors.length
      ? authors.map((a) => `      <tr><td><code>${esc(a.agent)}</code></td><td class="n">${sign(a.net)}</td>` +
          `<td class="n">${a.defects}</td><td class="n">${a.clean}</td><td class="n">${Math.round(a.rate * 100)}%</td><td class="n">${a.qualityFixes || 0}</td></tr>`).join('\n')
      : '      <tr><td colspan="6" class="empty">No authored runs recorded yet.</td></tr>'
    const gateRows = gates.length
      ? gates.map((g) => `      <tr><td><code>${esc(g.agent)}</code></td><td class="n">${sign(g.net)}</td>` +
          `<td class="n">${g.catches}</td><td class="n">${g.falsePositives}</td></tr>`).join('\n')
      : '      <tr><td colspan="4" class="empty">No defect findings recorded yet.</td></tr>'
    const qualitySection = qualityGates.length
      ? `  <h2>🧹 Quality gates <span style="font-weight:400;color:#888">— separate low-weight lane</span></h2>
  <table><thead><tr><th>Gate</th><th>Net</th><th>Fixes</th></tr></thead>
    <tbody>
${qualityGates.map((g) => `      <tr><td><code>${esc(g.agent)}</code></td><td class="n">${sign(g.net)}</td><td class="n">${g.fixes}</td></tr>`).join('\n')}
    </tbody></table>`
      : ''
    console.log(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Accountability scoreboard</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-size:1.3rem} h2{font-size:1rem;margin-top:1.8rem} table{border-collapse:collapse;width:100%;margin-top:.6rem}
  th,td{padding:.45rem .6rem;border-bottom:1px solid #eaeaea;text-align:left}
  th{font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;color:#666}
  td.n{text-align:right;font-variant-numeric:tabular-nums} code{background:#f5f5f5;padding:.05rem .3rem;border-radius:3px}
  .empty{color:#999;text-align:center} .meta{color:#888;font-size:.8rem;margin-top:1rem}
</style></head><body>
  <h1>⚖️ Accountability scoreboard <span style="font-weight:400;color:#888">· #1570</span></h1>
  <p>Every confirmed defect is severity-weighted: <strong>−w to the author, +w to the gate that caught it</strong>.
     A clean merge earns its author +1. From <code>findings.jsonl</code> × <code>eval-ledger.jsonl</code>.</p>
  <h2>👷 Authors <span style="font-weight:400;color:#888">— worst-first by defect-rate</span></h2>
  <table><thead><tr><th>Author flow</th><th>Net</th><th>Defects</th><th>Clean</th><th>Rate</th><th>Qual</th></tr></thead>
    <tbody>
${authorRows}
    </tbody></table>
  <h2>🔎 Review gates <span style="font-weight:400;color:#888">— best-first by net catches</span></h2>
  <table><thead><tr><th>Gate</th><th>Net</th><th>Catches</th><th>False +</th></tr></thead>
    <tbody>
${gateRows}
    </tbody></table>
${qualitySection}
  <p class="meta">Generated ${esc(generated)}. A finding scores only once confirmed; a rejected (false-positive) finding debits the gate. <code>Qual</code> = quality-lane fixes (e.g. /simplify), a separate low-weight signal — it does not affect Net/Rate.</p>
</body></html>`)
    process.exit(0)
  }

  // Markdown (mirrors scoreboard.mjs).
  const lines = []
  lines.push('<!-- GENERATED by scripts/eval-ledger/accountability.mjs — do not edit by hand. -->')
  lines.push('# ⚖️ Accountability scoreboard (#1570)')
  lines.push('')
  lines.push('Every confirmed defect is severity-weighted: **−w to the author, +w to the gate that caught it**.')
  lines.push('A clean merge earns its author +1. Rolled up from `findings.jsonl` × `eval-ledger.jsonl`.')
  lines.push('')
  lines.push('## 👷 Authors — worst-first by defect-rate')
  lines.push('')
  if (!authors.length) {
    lines.push('_No authored runs recorded yet._')
  } else {
    lines.push('| Author flow | Net | Defects | Clean | Rate | Qual |')
    lines.push('|---|--:|--:|--:|--:|--:|')
    for (const a of authors) lines.push(`| \`${a.agent}\` | ${sign(a.net)} | ${a.defects} | ${a.clean} | ${Math.round(a.rate * 100)}% | ${a.qualityFixes || 0} |`)
    lines.push('')
    lines.push('_`Qual` = quality-lane fixes (e.g. `/simplify` cleanups) — a separate low-weight signal that does NOT affect Net/Rate._')
  }
  lines.push('')
  lines.push('## 🔎 Review gates — best-first by net catches')
  lines.push('')
  if (!gates.length) {
    lines.push('_No defect findings recorded yet._')
  } else {
    lines.push('| Gate | Net | Catches | False + |')
    lines.push('|---|--:|--:|--:|')
    for (const g of gates) lines.push(`| \`${g.agent}\` | ${sign(g.net)} | ${g.catches} | ${g.falsePositives} |`)
  }
  if (qualityGates.length) {
    lines.push('')
    lines.push('## 🧹 Quality gates — separate low-weight lane')
    lines.push('')
    lines.push('| Gate | Net | Fixes |')
    lines.push('|---|--:|--:|')
    for (const g of qualityGates) lines.push(`| \`${g.agent}\` | ${sign(g.net)} | ${g.fixes} |`)
  }
  console.log(lines.join('\n'))

  function flag(name) {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
