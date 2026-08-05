#!/usr/bin/env node
// graduation-plan.mjs — render a POC's graduation plan as a mobile-first, self-contained HTML page.
//
// The plan is DERIVED from two data files so it can't drift from the contract:
//   • the frozen spec ledger   pocs/<poc>-demo/spec.json   (the 26-entry behaviour contract)
//   • a plan overlay           pocs/<poc>/graduation-plan.json   (phases, increments, build status)
//
// Every card in the output is a real spec entry (looked up by id), so "the plan" and "the contract"
// stay the same artifact. Update the overlay's statuses as increments land, then re-render:
//
//   node scripts/graduation-plan.mjs crouton-builder
//   → pocs/crouton-builder/graduation-plan.html   (open on a phone; it's designed for 390px)
//
// Repo convention: this mirrors the digests' gather → render split (no LLM, pure data → HTML).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const poc = process.argv[2] || 'crouton-builder'
const planPath = resolve(ROOT, 'pocs', poc, 'graduation-plan.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const specPath = resolve(dirname(planPath), plan.specSource)
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const specById = new Map(spec.map(e => [e.id, e]))

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// The three graduation buckets a spec entry falls into, keyed off its ledger status.
const BUCKET = {
  settled: { label: 'Preserve', hint: 'proven experience — must survive C1 verbatim' },
  stopgap: { label: 'Replace', hint: 'a POC fake → the real crouton thing (an expected C1 diff)' },
  new: { label: 'Add', hint: 'completeness the POC left open — its own gate, not the comparison' },
  proposed: { label: 'Proposed', hint: 'drafted, not yet signed off' }
}

const STATUS_ORDER = ['active', 'next', 'done', 'blocked', 'later']

function specCard(id) {
  const e = specById.get(id)
  if (!e) return `<div class="spec missing">unknown spec id: <code>${esc(id)}</code></div>`
  const bucket = BUCKET[e.status] || { label: e.status, hint: '' }
  const signed = e.signedOff ? `<span class="signed">✓ ${esc(e.signedOff)}</span>` : ''
  return `<details class="spec b-${esc(e.status)}">
  <summary>
    <span class="bkt">${esc(bucket.label)}</span>
    <span class="beh">${esc(e.behaviour)}</span>
    ${signed}
  </summary>
  <div class="spec-body">
    <p class="expect"><b>Expect:</b> ${esc(e.expect || '')}</p>
    ${e.hook ? `<p class="hook"><b>Hook:</b> <code>${esc(e.hook)}</code></p>` : ''}
    ${e.howToTest ? `<p class="howto"><b>🧪 How to test:</b> ${esc(e.howToTest)}</p>` : ''}
    <p class="meta">spec <code>${esc(e.id)}</code> · ${esc(bucket.hint)}</p>
  </div>
</details>`
}

function counts(ids) {
  const c = {}
  for (const id of ids) {
    const e = specById.get(id)
    const b = (BUCKET[e?.status]?.label) || '?'
    c[b] = (c[b] || 0) + 1
  }
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(' · ')
}

function increment(inc) {
  return `<div class="inc s-${esc(inc.status)}">
  <div class="inc-head">
    <span class="tag">${esc(inc.id)}</span>
    <h4>${esc(inc.name)}</h4>
    <span class="pill st-${esc(inc.status)}">${esc(inc.status)}</span>
  </div>
  ${inc.flow ? `<div class="flow flow-${esc(inc.flow)}">${esc(flowLabel(inc.flow))}</div>` : ''}
  ${inc.note ? `<p class="note">${esc(inc.note)}</p>` : ''}
  ${inc.worksNow ? `<p class="worksnow"><b>▶ Should work now:</b> ${esc(inc.worksNow)}</p>` : ''}
  <div class="spec-count">${counts(inc.specs)}</div>
  <div class="specs">${inc.specs.map(specCard).join('\n')}</div>
</div>`
}

function flowLabel(flow) {
  return { sequential: '→ sequential', staggered: '⇥ staggered — verify each as it lands', parallel: '⇉ parallel — independent' }[flow] || flow
}

function step(s) {
  return `<div class="step s-${esc(s.status)}">
    <span class="pill st-${esc(s.status)}">${esc(s.status)}</span>
    <span class="step-name">${esc(s.name)}</span>
    ${s.test ? `<span class="step-test">🧪 ${esc(s.test)}</span>` : ''}
  </div>`
}

function phase(p) {
  return `<section class="phase p-${esc(p.status)}">
  <div class="phase-head">
    <span class="phase-id">${esc(p.id)}</span>
    <h2>${esc(p.name)}</h2>
    <span class="pill st-${esc(p.status)}">${esc(p.status)}</span>
  </div>
  <p class="summary">${esc(p.summary)}</p>
  ${p.worksNow ? `<p class="worksnow phase-works"><b>▶ Should work now:</b> ${esc(p.worksNow)}</p>` : ''}
  ${p.gate ? `<p class="gate"><b>🔒 Gate:</b> ${esc(p.gate)}</p>` : ''}
  ${p.steps ? `<div class="steps">${p.steps.map(step).join('\n')}</div>` : ''}
  ${p.increments ? `<div class="incs">${p.increments.map(increment).join('\n')}</div>` : ''}
</section>`
}

const legend = Object.entries(plan.statusLegend || {})
  .map(([k, v]) => `<span class="lg"><span class="pill st-${esc(k)}">${esc(k)}</span> ${esc(v)}</span>`).join('')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plan.title)}</title>
<style>
  :root {
    --bg: #fbfbfa; --fg: #1a1a1a; --muted: #6b7280; --card: #fff; --line: #e5e7eb;
    --done: #16a34a; --active: #2563eb; --next: #7c3aed; --blocked: #9ca3af; --later: #d1d5db;
    --preserve: #16a34a; --replace: #d97706; --add: #2563eb;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111214; --fg: #e8e8e8; --muted: #9ca3af; --card: #1a1c1f; --line: #2a2d31;
      --later: #3a3d42; --blocked: #52565c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 16px; max-width: 760px; margin-inline: auto; }
  header h1 { font-size: 22px; margin: 0 0 4px; }
  header .sub { color: var(--muted); font-size: 14px; margin: 0 0 12px; }
  header .links { font-size: 13px; margin: 0 0 12px; }
  header .links a { color: var(--active); text-decoration: none; }
  .intro { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px; font-size: 13.5px; color: var(--fg); margin-bottom: 14px; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 12px; color: var(--muted);
    margin-bottom: 20px; }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; }
  .pill { display: inline-block; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .03em; padding: 2px 7px; border-radius: 999px; color: #fff; white-space: nowrap; }
  .st-done { background: var(--done); } .st-active { background: var(--active); }
  .st-next { background: var(--next); } .st-blocked { background: var(--blocked); }
  .st-later { background: var(--later); color: #555; }
  .phase { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 14px 16px; margin-bottom: 16px; }
  .phase.p-active { border-color: var(--active); box-shadow: 0 0 0 1px var(--active) inset; }
  .phase-head, .inc-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .phase-id { font-weight: 800; font-size: 18px; color: var(--muted);
    border: 2px solid var(--line); border-radius: 8px; width: 30px; height: 30px;
    display: grid; place-items: center; }
  .phase h2 { font-size: 18px; margin: 0; flex: 1; }
  .phase .summary { color: var(--fg); font-size: 14px; margin: 10px 0; }
  .worksnow { background: color-mix(in srgb, var(--active) 8%, transparent);
    border-left: 3px solid var(--active); padding: 8px 11px; border-radius: 0 8px 8px 0;
    font-size: 13.5px; margin: 10px 0; }
  .gate { font-size: 13.5px; color: var(--muted); margin: 8px 0; }
  .steps { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .step { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
  .step-name { font-weight: 600; } .step-test { color: var(--muted); font-size: 12.5px; }
  .incs { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
  .inc { border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; }
  .inc.s-active { border-color: var(--active); }
  .inc.s-done { opacity: .92; }
  .inc.s-later { opacity: .6; }
  .inc h4 { font-size: 15px; margin: 0; flex: 1; }
  .tag { font-weight: 800; font-size: 12px; color: var(--muted); background: var(--bg);
    border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
  .flow { font-size: 12px; font-weight: 600; margin: 8px 0 2px; }
  .flow-sequential { color: var(--muted); } .flow-staggered { color: var(--active); }
  .flow-parallel { color: var(--next); }
  .note { font-size: 13px; color: var(--muted); margin: 6px 0; }
  .spec-count { font-size: 11.5px; color: var(--muted); margin: 8px 0 6px; font-weight: 600; }
  .specs { display: flex; flex-direction: column; gap: 5px; }
  .spec { border: 1px solid var(--line); border-radius: 8px; background: var(--bg); overflow: hidden; }
  .spec summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
    padding: 8px 10px; cursor: pointer; list-style: none; }
  .spec summary::-webkit-details-marker { display: none; }
  .spec summary::before { content: "▸"; color: var(--muted); font-size: 11px; }
  .spec[open] summary::before { content: "▾"; }
  .bkt { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em;
    padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
  .b-settled .bkt { background: color-mix(in srgb, var(--preserve) 18%, transparent); color: var(--preserve); }
  .b-stopgap .bkt { background: color-mix(in srgb, var(--replace) 20%, transparent); color: var(--replace); }
  .b-new .bkt { background: color-mix(in srgb, var(--add) 18%, transparent); color: var(--add); }
  /* behaviour text always gets its own full-width line so a nowrap ✓ badge can't crush it */
  .beh { flex: 1 1 100%; min-width: 0; font-size: 13.5px; order: 3; }
  .signed { font-size: 11px; color: var(--done); font-weight: 600; white-space: nowrap; }
  .spec-body { padding: 2px 12px 12px; font-size: 13px; border-top: 1px solid var(--line); }
  .spec-body p { margin: 8px 0; }
  .spec-body .meta { color: var(--muted); font-size: 11.5px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em;
    background: color-mix(in srgb, var(--muted) 15%, transparent); padding: 1px 4px; border-radius: 4px; }
  footer { color: var(--muted); font-size: 11.5px; margin-top: 24px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>${esc(plan.title)}</h1>
  <p class="sub">${esc(plan.subtitle)}</p>
  <p class="links">
    ${plan.epic ? `<a href="https://github.com/FriendlyInternet/nuxt-crouton/issues/${plan.epic}">Epic #${plan.epic}</a>` : ''}
    ${plan.pr ? ` · <a href="https://github.com/FriendlyInternet/nuxt-crouton/pull/${plan.pr}">PR #${plan.pr}</a>` : ''}
    · ${spec.length} spec entries
  </p>
</header>
<p class="intro">${esc(plan.intro)}</p>
<div class="legend">${legend}</div>
${plan.phases.map(phase).join('\n')}
<footer>Derived from <code>${esc(plan.specSource)}</code> — re-render: <code>node scripts/graduation-plan.mjs ${esc(poc)}</code></footer>
</body>
</html>`

const outPath = resolve(dirname(planPath), 'graduation-plan.html')
writeFileSync(outPath, html)
console.log(`✓ wrote ${outPath.replace(ROOT + '/', '')} (${spec.length} spec entries, ${plan.phases.length} phases)`)
