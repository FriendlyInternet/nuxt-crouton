#!/usr/bin/env node
// packages-guard.mjs — the PR-time half of the packages/ HARD GATE (#1611).
//
// The local PreToolUse hook (.claude/hooks/gate-package-edits.sh) only runs inside an
// agent session, so a PR can quietly change shared `packages/**` code with nothing catching
// it on the way to main. This is the authoritative, PR-time version: a PR that touches
// `packages/**` must *declare* the edit — shared packages ripple across every consuming app.
//
// This module is PURE + unit-tested (packages-guard.test.mjs). All impure lookups (the PR's
// changed files, labels, body, and the labels of any linked issue) are resolved by the caller
// — the CI workflow (`.github/workflows/packages-guard.yml`) via github-script — and passed in
// as plain data, so the decision itself is deterministic and testable. Run locally via the CLI
// at the bottom: `node scripts/packages-guard.mjs <input.json>`.
//
// Distinct from guard-package-approval.yml, which only fails a *committed*
// `.claude/.package-edit-approved` override file — a narrower safety net.
//
// It also serves the RUN-TIME side (#3701): `packagesApprovalFor()` tells the pi worker, on its
// first write in a package, whether the ticket approves it (`.pi/extensions/packages-notice.ts`),
// and the `--pr-note` CLI gives the finish step the ticket's `Packages-approved:` line to copy
// into the PR body. Both go through `evaluatePackagesGuard`, so they never disagree with CI.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PACKAGES_PREFIX = 'packages/'
export const APPROVED_LABEL = 'packages:approved'
// A body attestation line, mirroring the `Dedup-checked:` / provenance-header hook patterns.
export const ATTESTATION_RE = /^\s*Packages-approved:/im
export const COMMENT_MARKER = '<!-- packages-guard -->'

/** The changed files that live under `packages/` — the blast radius. */
export function packagesTouched(changedFiles = []) {
  return changedFiles.filter(f => typeof f === 'string' && f.startsWith(PACKAGES_PREFIX))
}

/** Group touched files by package name → `{ 'crouton-sales': [files…], … }`. */
export function blastRadius(changedFiles = []) {
  const byPkg = {}
  for (const f of packagesTouched(changedFiles)) {
    const pkg = f.slice(PACKAGES_PREFIX.length).split('/')[0] || '(root)'
    ;(byPkg[pkg] ||= []).push(f)
  }
  return byPkg
}

/**
 * The decision. Pure — the caller resolves and passes in the impure data.
 * @param {{changedFiles?: string[], prLabels?: string[], body?: string, linkedIssueLabels?: string[]}} input
 * @returns {{touched: string[], packages: string[], declared: boolean, signal: string|null, reason: string}}
 */
export function evaluatePackagesGuard({
  changedFiles = [],
  prLabels = [],
  body = '',
  linkedIssueLabels = [],
} = {}) {
  const touched = packagesTouched(changedFiles)
  if (touched.length === 0) {
    return { touched, packages: [], declared: true, signal: 'none', reason: 'No packages/** files changed — no-op.' }
  }

  const hasLabel = prLabels.includes(APPROVED_LABEL)
  const hasAttestation = ATTESTATION_RE.test(body)
  const hasPkgIssue = linkedIssueLabels.some(l => typeof l === 'string' && l.startsWith('pkg:'))
  const declared = hasLabel || hasAttestation || hasPkgIssue
  const signal = hasLabel ? 'label' : hasAttestation ? 'attestation' : hasPkgIssue ? 'pkg-issue' : null

  return {
    touched,
    packages: Object.keys(blastRadius(changedFiles)).sort(),
    declared,
    signal,
    reason: declared
      ? `Packages edit declared via ${signal}.`
      : `This PR changes ${touched.length} packages/** file(s) across [${Object.keys(blastRadius(changedFiles)).sort().join(', ')}] with no declared approval.`,
  }
}

/**
 * Every `Packages-approved:` line found in the given bodies (epic body, children's bodies),
 * de-duplicated, in first-seen order. PURE (#2748). Code spans/fences are skipped so a quoted
 * example never counts as a declaration. Moved here from epic-ready.mjs (#3701), re-exported there.
 */
export function collectApprovalLines(bodies = []) {
  const seen = new Set()
  for (const b of bodies) {
    const prose = String(b || '').replace(/```[\s\S]*?```/g, '')
    for (const l of prose.split('\n')) {
      const t = l.trim()
      if (ATTESTATION_RE.test(t) && !t.startsWith('`')) seen.add(t)
    }
  }
  return [...seen]
}

/** The part of the pi finish-step PR body the guard reads: the `Closes #N` + the copied line. */
export function finishStepBody(issue, note = '') {
  return `Closes #${issue}\n\n${note}`
}

/** Package names an approval line names (`pkg:<name>` or `packages/<name>/`), `*` ignored. */
function scopeFromLine(line) {
  const names = new Set()
  for (const m of String(line || '').matchAll(/(?:pkg:|packages\/)([A-Za-z0-9._-]+)/g)) {
    if (m[1] !== '*') names.add(m[1])
  }
  return [...names].sort()
}

/**
 * Run-time decision (#3701): does this ticket approve the package files being changed?
 * The yes/no is CI's own (`evaluatePackagesGuard` on the body the finish step will write), so the
 * notice never disagrees with the check. `scope` (pkg:* labels, else names in the line, else all)
 * only adds an advisory 'partial' for a package the ticket does not name — CI is unscoped.
 */
export function packagesApprovalFor({ changedFiles = [], ticketBody = '', ticketLabels = [] } = {}) {
  const touched = Object.keys(blastRadius(changedFiles)).sort()
  const line = collectApprovalLines([ticketBody])[0] || null
  const prNote = line ? `\n\n${line}` : ''
  const base = { line, touched }
  if (touched.length === 0) {
    return { ...base, status: 'none', via: null, prNote: '', scope: null, approved: [], unapproved: [] }
  }
  const labels = (ticketLabels || []).filter(l => typeof l === 'string')
  const ci = evaluatePackagesGuard({ changedFiles, body: finishStepBody(0, prNote.trim()), linkedIssueLabels: labels })
  if (!ci.declared) {
    return { ...base, status: 'not-approved', via: null, prNote, scope: null, approved: [], unapproved: touched }
  }
  const via = ci.signal === 'attestation' ? 'line' : 'pkg-label'
  const fromLabels = labels.filter(l => l.startsWith('pkg:')).map(l => l.slice(4)).filter(Boolean).sort()
  const fromLine = scopeFromLine(line)
  const scope = fromLabels.length ? fromLabels : fromLine.length ? fromLine : null
  const approved = scope ? touched.filter(p => scope.includes(p)) : touched
  const unapproved = touched.filter(p => !approved.includes(p))
  return { ...base, status: unapproved.length ? 'partial' : 'approved', via, prNote, scope, approved, unapproved }
}

/** The one message the worker gets on its first write in `pkg` (#3701). */
export function formatPackagesNotice(result, pkg) {
  const undo = `undo the change under packages/${pkg}/, or stop and say in your final message which package file you need and why.`
  const scope = result?.scope?.length ? result.scope.map(s => `\`${s}\``).join(', ') : null
  if (result?.status === 'approved' || (result?.status === 'partial' && result.approved.includes(pkg))) {
    if (result.via === 'line') {
      return `Package edit allowed: this ticket approves \`${pkg}\`. The finish step copies this exact line into the PR body, so you do not need to: ${result.line}${scope ? ` It names: ${scope}.` : ''}`
    }
    return `Package edit allowed: this ticket's pkg:* labels approve \`${pkg}\`${scope ? ` (${scope})` : ''}. There is no line to copy; the PR's \`Closes #N\` carries the approval.`
  }
  if (result?.status === 'partial') {
    return `This ticket approves ${scope || 'other packages'}, not \`${pkg}\`: ${undo}`
  }
  return `This ticket has no package approval for \`${pkg}\`: ${undo} (Docs files like README.md and CLAUDE.md count as package files.)`
}

/** The blast-radius comment body (markdown) — marker-deduped + 🤖 provenance. */
export function formatComment(changedFiles = []) {
  const byPkg = blastRadius(changedFiles)
  const lines = [
    COMMENT_MARKER,
    '🚫 **This PR changes shared `packages/**` code but declares no approval.**',
    '',
    'Shared packages ripple across every consuming app, so a package edit must be *declared* (not prohibited). To make this check pass, do **one** of:',
    '',
    '- add the **`packages:approved`** label to this PR, **or**',
    '- add a body line **`Packages-approved: <why / who signed off>`**, **or**',
    '- link a signed-off **`pkg:*`** issue (`Closes #NN` / `Refs #NN`).',
    '',
    '**Blast radius — changed `packages/**` files:**',
  ]
  for (const pkg of Object.keys(byPkg).sort()) {
    lines.push('', `- **${pkg}** (${byPkg[pkg].length})`)
    for (const f of byPkg[pkg]) lines.push(`  - \`${f}\``)
  }
  lines.push('', '<sub>🤖 agent pipeline (CI) · packages-guard (#1611) · required check — declare the edit to pass</sub>')
  return lines.join('\n')
}

// ── CLI ────────────────────────────────────────────────────────────────────────
// `node scripts/packages-guard.mjs <input.json> [<output.json>]`
// input.json:  { changedFiles, prLabels, body, linkedIssueLabels }
// output.json: { ...evaluate(), commentBody }  (also printed to stdout)
function main(argv) {
  const [inPath, outPath] = argv
  if (!inPath) {
    console.error('usage: node scripts/packages-guard.mjs <input.json> [<output.json>]')
    process.exit(2)
  }
  const input = JSON.parse(readFileSync(inPath, 'utf8'))
  const result = evaluatePackagesGuard(input)
  const out = { ...result, commentBody: result.declared ? null : formatComment(input.changedFiles || []) }
  const json = JSON.stringify(out, null, 2)
  if (outPath) writeFileSync(outPath, json)
  console.log(json)
}

// `git diff --name-only … | node scripts/packages-guard.mjs --pr-note --body <file> [--labels <json-file>]`
// prints the ready-to-insert `\n\n<Packages-approved line>` (or nothing). Always exits 0 (#3701).
export function prNoteCli(argv, stdinText) {
  try {
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
    const bodyPath = arg('--body')
    if (!bodyPath) throw new Error('--body <file> is required')
    const ticketBody = readFileSync(bodyPath, 'utf8')
    let ticketLabels = []
    const labelsPath = arg('--labels')
    if (labelsPath) {
      try { ticketLabels = JSON.parse(readFileSync(labelsPath, 'utf8')) } catch { ticketLabels = [] }
      if (!Array.isArray(ticketLabels)) ticketLabels = []
    }
    const changedFiles = String(stdinText || '').split('\n').map(s => s.trim()).filter(Boolean)
    return packagesApprovalFor({ changedFiles, ticketBody, ticketLabels }).prNote
  } catch (e) {
    console.error(`[packages-guard] --pr-note error: ${e?.message || e} — ignored`)
    return ''
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2)
  if (argv[0] === '--pr-note') {
    let stdinText = ''
    try { stdinText = readFileSync(0, 'utf8') } catch { stdinText = '' }
    process.stdout.write(prNoteCli(argv, stdinText))
  } else {
    main(argv)
  }
}
