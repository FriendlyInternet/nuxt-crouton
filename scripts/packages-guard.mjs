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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
