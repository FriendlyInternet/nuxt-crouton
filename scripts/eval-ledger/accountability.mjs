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
 * records, returns { authors, gates, transactions }.
 *   authors: [{ agent, net, defects, clean, rate }]  worst-first (rate desc, then net asc)
 *   gates:   [{ agent, net, catches, falsePositives }] best-first (net desc)
 * @param {import('./findings-schema.mjs').FindingRecord[]} findings
 * @param {import('./schema.mjs').LedgerRecord[]} ledger
 */
export function tally(findings, ledger) {
  const authors = new Map() // agent → { net, defects, clean }
  const gates = new Map()   // agent → { net, catches, falsePositives }
  const A = (a) => authors.get(a) || authors.set(a, { agent: a, net: 0, defects: 0, clean: 0 }).get(a)
  const G = (g) => gates.get(g) || gates.set(g, { agent: g, net: 0, catches: 0, falsePositives: 0 }).get(g)

  const transactions = []
  // Author refs that carry a CONFIRMED defect — these runs don't earn the clean reward.
  const dirtyRefs = new Set()

  for (const f of findings) {
    if (f.status === 'confirmed' && f.author_ref) dirtyRefs.add(f.author_ref)
    for (const t of transactionsFor(f)) {
      transactions.push({ ...t, ts: f.ts, gate: f.gate, severity: f.severity })
      if (t.role === 'author') {
        const a = A(t.agent)
        a.net += t.delta
        if (t.delta < 0) a.defects++
      } else {
        const g = G(t.agent)
        g.net += t.delta
        if (t.delta > 0) g.catches++
        else if (t.delta < 0) g.falsePositives++
      }
    }
  }

  // Clean-merge author reward: a merged, successful run with no confirmed defect.
  for (const r of ledger) {
    if (r.outcome !== 'merged' || !isSuccess(r)) continue
    if (r.ref && dirtyRefs.has(r.ref)) continue
    const flow = r.flow
    if (!flow) continue
    const a = A(flow)
    a.net += CLEAN_MERGE_REWARD
    a.clean++
  }

  const authorRows = [...authors.values()]
    .map((a) => ({ ...a, rate: a.defects + a.clean > 0 ? a.defects / (a.defects + a.clean) : 0 }))
    .sort((x, y) => y.rate - x.rate || x.net - y.net || x.agent.localeCompare(y.agent))
  const gateRows = [...gates.values()]
    .sort((x, y) => y.net - x.net || y.catches - x.catches || x.agent.localeCompare(y.agent))

  return { authors: authorRows, gates: gateRows, transactions }
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

  const { authors, gates } = tally(findings, ledger)
  const generated = new Date().toISOString()

  if (asJson) {
    console.log(JSON.stringify({ generated, authors, gates }, null, 2))
    process.exit(0)
  }

  const sign = (n) => (n > 0 ? `+${n}` : `${n}`)

  if (asHtml) {
    const authorRows = authors.length
      ? authors.map((a) => `      <tr><td><code>${esc(a.agent)}</code></td><td class="n">${sign(a.net)}</td>` +
          `<td class="n">${a.defects}</td><td class="n">${a.clean}</td><td class="n">${Math.round(a.rate * 100)}%</td></tr>`).join('\n')
      : '      <tr><td colspan="5" class="empty">No authored runs recorded yet.</td></tr>'
    const gateRows = gates.length
      ? gates.map((g) => `      <tr><td><code>${esc(g.agent)}</code></td><td class="n">${sign(g.net)}</td>` +
          `<td class="n">${g.catches}</td><td class="n">${g.falsePositives}</td></tr>`).join('\n')
      : '      <tr><td colspan="4" class="empty">No findings recorded yet.</td></tr>'
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
  <table><thead><tr><th>Author flow</th><th>Net</th><th>Defects</th><th>Clean</th><th>Rate</th></tr></thead>
    <tbody>
${authorRows}
    </tbody></table>
  <h2>🔎 Review gates <span style="font-weight:400;color:#888">— best-first by net catches</span></h2>
  <table><thead><tr><th>Gate</th><th>Net</th><th>Catches</th><th>False +</th></tr></thead>
    <tbody>
${gateRows}
    </tbody></table>
  <p class="meta">Generated ${esc(generated)}. A finding scores only once confirmed; a rejected (false-positive) finding debits the gate.</p>
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
    lines.push('| Author flow | Net | Defects | Clean | Rate |')
    lines.push('|---|--:|--:|--:|--:|')
    for (const a of authors) lines.push(`| \`${a.agent}\` | ${sign(a.net)} | ${a.defects} | ${a.clean} | ${Math.round(a.rate * 100)}% |`)
  }
  lines.push('')
  lines.push('## 🔎 Review gates — best-first by net catches')
  lines.push('')
  if (!gates.length) {
    lines.push('_No findings recorded yet._')
  } else {
    lines.push('| Gate | Net | Catches | False + |')
    lines.push('|---|--:|--:|--:|')
    for (const g of gates) lines.push(`| \`${g.agent}\` | ${sign(g.net)} | ${g.catches} | ${g.falsePositives} |`)
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
