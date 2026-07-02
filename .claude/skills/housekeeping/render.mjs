#!/usr/bin/env node
/**
 * Render the housekeeping digest data (from gather.mjs) into Markdown.
 *
 *   node render.mjs housekeeping.data.json [--out-dir .]
 *
 * Render-only: it transforms JSON → text and writes a file. It never calls GitHub.
 * Each section is a skimmable list and is OMITTED entirely when it has no findings —
 * a quiet week renders to "✨ Nothing needs your eyes." so an empty digest reads as a
 * win, not a wall. Mirrors the shape of .claude/skills/epic-digest/render.mjs.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// Brand identity SSOT — shared with crouton-email. Plain ESM, no install needed.
import { BRAND_NAME, BRAND_URL } from '../../../packages/crouton-email/brand/email-brand.mjs'

const args = process.argv.slice(2)
const dataPath = args.find((a) => !a.startsWith('--'))
if (!dataPath) {
  console.error('render.mjs: pass the path to housekeeping.data.json')
  process.exit(1)
}
const outDir = (() => {
  const i = args.indexOf('--out-dir')
  return i >= 0 ? args[i + 1] : '.'
})()

const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const N = data.staleDays
const link = (n, t, url) => `[#${n}](${url}) — ${t}`

// Each entry: [heading, lines[]]. A section with no lines is dropped.
const sections = []

if (data.staleBranches === null) {
  sections.push([
    '🌿 Stale unmerged branches',
    ['_Branch data unavailable this run (shallow checkout) — skipped._']
  ])
} else if (data.staleBranches.length) {
  sections.push([
    '🌿 Stale unmerged branches',
    [
      `Not contained in \`main\` and untouched for >${N}d — review then merge or delete (not auto-touched):`,
      ...data.staleBranches.map((b) => `- \`${b.name}\` — last commit ${b.lastCommit} (${b.ageDays}d ago)`)
    ]
  ])
}

if (data.unlabeled?.length) {
  sections.push([
    '🏷️ Issues missing labels',
    [
      'Open issues without a `type:*` and/or a component (`pkg`/`app`/`worker`/`poc`) label:',
      ...data.unlabeled.map((i) => `- ${link(i.number, i.title, i.url)} — missing **${i.missing.join('**, **')}**`)
    ]
  ])
}

if (data.labelCoverage?.length) {
  sections.push([
    '🏗️ Label coverage',
    [
      'Source dirs with no matching label in `.github/labels.yml` (add the label — CLAUDE.md treats a missing one as a build failure):',
      ...data.labelCoverage.map((m) => `- \`${m.dir}\` — missing label \`${m.expected}\``)
    ]
  ])
}

if (data.stuck?.length) {
  sections.push([
    '⏳ Stuck in-progress',
    [
      `\`status:in-progress\` with no activity in >${N}d (likely no PR moving it):`,
      ...data.stuck.map((i) => `- ${link(i.number, i.title, i.url)} — idle ${i.ageDays}d`)
    ]
  ])
}

if (data.staleEpics?.length) {
  // Split by the action each epic needs (#763): postmortem-first vs just-close.
  const needsPm = data.staleEpics.filter((e) => e.state !== 'ready-to-close')
  const ready = data.staleEpics.filter((e) => e.state === 'ready-to-close')
  const lines = ['All sub-issues are closed but the epic is still open:']
  if (needsPm.length) {
    lines.push('', '**Run the postmortem, then close:**',
      ...needsPm.map((e) => `- ${link(e.number, e.title, e.url)} — ${e.children}/${e.children} children closed`))
  }
  if (ready.length) {
    lines.push('', '**Postmortem done — ready to close:**',
      ...ready.map((e) => `- ${link(e.number, e.title, e.url)} — ${e.children}/${e.children} children closed`))
  }
  sections.push(['✅ Epics ready to close', lines])
}

if (data.epicsMissingInProgress?.length) {
  sections.push([
    '🚧 Epics with active work but not marked in-progress',
    [
      'A child is `status:in-progress` but the epic isn\'t — so it reads as "open, not started". `label-ready-epics.mjs --apply` reconciles this:',
      ...data.epicsMissingInProgress.map(
        (e) => `- ${link(e.number, e.title, e.url)} — active: ${e.activeChildren.map((n) => `#${n}`).join(', ')}`
      )
    ]
  ])
}

if (data.orphanedInProgress?.length) {
  sections.push([
    '🧭 In-progress under a non-open-epic parent',
    [
      '`status:in-progress` issues whose parent isn\'t a currently-open epic — a closed epic left with unfinished work, or a parent missing the `epic` label:',
      ...data.orphanedInProgress.map((i) => `- ${link(i.number, i.title, i.url)} — parent #${i.parent}`)
    ]
  ])
}

if (data.idlePRs?.length) {
  sections.push([
    '🔀 Idle PRs',
    [
      `Open PRs with no activity in >${N}d:`,
      ...data.idlePRs.map((p) => `- ${link(p.number, p.title, p.url)}${p.draft ? ' _(draft)_' : ''} — idle ${p.ageDays}d`)
    ]
  ])
}

// 📚 Skill freshness (#1100 WS3) — knowledge skills whose cited paths drifted or whose
// `verified:` stamp aged out. Report-only; a re-verified/re-stamped skill drops off next run.
const sf = data.skillFreshness
if (sf && (sf.flagged?.length || sf.malformed?.length)) {
  const lines = [
    `Knowledge skills (\`verified:\` provenance) that need a re-check — nothing was modified:`
  ]
  for (const s of sf.flagged) {
    const tags = []
    if (s.vanished.length) tags.push(`🔴 ${s.vanished.length} vanished`)
    if (s.possiblyStale.length) tags.push(`🟡 ${s.possiblyStale.length} possibly-stale`)
    if (s.overdue) tags.push(`🔵 stamp ${s.ageDays}d old`)
    lines.push(`- \`/${s.name}\` (stamped ${s.stamp}) — ${tags.join(', ')}`)
    for (const p of s.vanished) lines.push(`  - 🔴 vanished: \`${p}\``)
    for (const p of s.possiblyStale) lines.push(`  - 🟡 \`${p.path}\` — changed ${p.lastCommit}, after the stamp`)
  }
  for (const m of sf.malformed) lines.push(`- \`/${m.name}\` — ⚠️ ${m.reason}`)
  lines.push('', `_Re-run \`node scripts/skill-freshness.mjs --pretty\` locally; re-verify the facts, then bump the \`verified:\` stamp._`)
  sections.push(['📚 Skill freshness', lines])
}

// Loop Station budget readout (#934, WS4) — one read-only line, always shown when
// the inventory has produced data. Sourced from the latest committed history.jsonl
// record (gathered, not recomputed). Omitted when WS1 hasn't run yet.
function loopStationLine(ls) {
  if (!ls || ls.alwaysOnTokens == null) return null
  const k = (n) => (n / 1000).toFixed(1) + 'k'
  const dot = ls.scorecard === 'green' ? '🟢' : ls.scorecard === 'amber' ? '🟡' : ls.scorecard === 'red' ? '🔴' : '⚪'
  const delta =
    ls.deltaTokens == null
      ? 'baseline'
      : ls.deltaTokens === 0
        ? 'Δ +0'
        : `Δ ${ls.deltaTokens > 0 ? '+' : '−'}${k(Math.abs(ls.deltaTokens))}`
  const red = ls.redundancyPct == null ? '' : ` · redundancy ${ls.redundancyPct}%`
  const tk = ls.tokenizer ? ` _(${ls.tokenizer})_` : ''
  return `📟 **Context budget:** ${k(ls.alwaysOnTokens)} always-on tok${red} · scorecard ${dot} · ${delta}${tk}`
}

const when = new Date(data.generatedAt).toISOString().slice(0, 10)
const lsLine = loopStationLine(data.loopStation)
const head = [`## 🧹 Housekeeping — ${when}`, '', ...(lsLine ? [lsLine, ''] : [])]
const body = sections.length
  ? sections.flatMap(([h, lines]) => [`### ${h}`, ...lines, ''])
  : ['✨ Nothing needs your eyes — branches, labels, and issue state look clean.', '']
const foot = [
  '---',
  `_[${BRAND_NAME}](${BRAND_URL}) · Render-only digest · drift threshold ${N}d · nothing here was modified. Generated by \`.github/workflows/housekeeping.yml\`._`
]
const md = [...head, ...body, ...foot].join('\n') + '\n'

const outFile = join(outDir, `housekeeping-${when}.md`)
writeFileSync(outFile, md)
process.stdout.write(`Wrote ${outFile}\n`)
