#!/usr/bin/env node
/**
 * #1689 — reachability probe for `issue-sanity-check`.
 *
 * An issue can name a target file that is dead code. Building exactly to spec then ships
 * something nobody can reach, while satisfying every acceptance criterion. That happened on
 * #1657: it specified an Import button in `ProductsTab.vue`, a component mounted in no
 * template. It was caught by reading the package docs, not by any gate.
 *
 * This answers one question per named path: **is anything going to render/execute this?**
 *
 * IT REPORTS A HYPOTHESIS, NEVER A VERDICT (the #1149 deletion protocol, in reverse).
 * Zero static references does not prove death — this repo mounts things dynamically via
 * directory scanners, `croutonBlocks`/`croutonLayoutBlocks` registries, and @nuxt/kit
 * resolver paths. So an unreachable finding is a *reshape* prompt for a human, never a drop.
 *
 *   node scripts/check-issue-targets.mjs 1657          # probe an issue's named paths
 *   node scripts/check-issue-targets.mjs path/to/a.vue # probe paths directly
 *   node --test scripts/check-issue-targets.test.mjs
 */
import { execFileSync } from 'node:child_process'

/** Roots whose files are worth probing. Anything else in a body is prose, not a target. */
const REPO_ROOTS = ['packages/', 'apps/', 'pocs/', 'workers/', 'scripts/', 'e2e/', 'fixtures/']

/**
 * Paths that are reachable *by convention* — the file IS its own registration, so a
 * zero-reference result means nothing. Probing these only produces false positives.
 */
const FILE_ROUTED = [
  /(^|\/)server\/api\//,
  /(^|\/)server\/routes\//,
  /(^|\/)server\/plugins\//,
  /(^|\/)server\/middleware\//,
  /(^|\/)server\/utils\//, // Nitro auto-import
  /(^|\/)app\/pages\//,
  /(^|\/)app\/middleware\//,
  /(^|\/)app\/plugins\//,
  /(^|\/)app\/composables\//, // Nuxt auto-import
  /(^|\/)app\/utils\//, // Nuxt auto-import
  /(^|\/)app\.config\.ts$/,
  /(^|\/)nuxt\.config\.ts$/,
  /(^|\/)crouton\.config\.js$/,
]

/** Extract repo-relative paths from free text (an issue body). */
export function extractPaths(text) {
  if (!text) return []
  const re = /\b((?:packages|apps|pocs|workers|scripts|e2e|fixtures)\/[\w@./[\]-]+\.(?:vue|ts|mjs|js|json))\b/g
  const found = [...String(text).matchAll(re)].map(m => m[1])
  return [...new Set(found)].filter(p => REPO_ROOTS.some(r => p.startsWith(r)))
}

/** What kind of target is this, and is it reachable purely by convention? */
export function classifyTarget(path) {
  if (FILE_ROUTED.some(re => re.test(path))) {
    return { kind: 'convention', symbol: basename(path) }
  }
  if (path.endsWith('.vue')) return { kind: 'component', symbol: basename(path) }
  if (/\.(ts|mjs|js)$/.test(path)) return { kind: 'module', symbol: basename(path) }
  return { kind: 'other', symbol: basename(path) }
}

function basename(path) {
  return path.split('/').pop().replace(/\.(vue|ts|mjs|js|json)$/, '')
}

/**
 * Decide one target's status from the references a caller found.
 *
 * `references` = [{ file, line }] — hits for the target's symbol ANYWHERE except the target
 * file itself. The caller does the searching so this stays pure and testable.
 */
export function assessTarget({ path, references = [] }) {
  const { kind, symbol } = classifyTarget(path)
  if (kind === 'convention') {
    return { path, symbol, kind, status: 'convention', evidence: 'file-based routing / auto-import — the file is its own registration' }
  }

  const outside = references.filter(r => r.file !== path)
  const code = outside.filter(r => !/\.(md|mdc|txt)$/.test(r.file))
  const registry = code.filter(r => /app\.config\.ts$|\.manifest\.ts$/.test(r.file))

  if (registry.length) {
    return { path, symbol, kind, status: 'registry', evidence: `registered in ${registry.map(r => r.file).join(', ')}` }
  }
  if (code.length) {
    return { path, symbol, kind, status: 'reachable', evidence: `referenced in ${code.length} file(s), e.g. ${code[0].file}` }
  }
  const docsOnly = outside.length > 0
  return {
    path,
    symbol,
    kind,
    status: 'unreachable',
    evidence: docsOnly
      ? `only mentioned in prose (${outside.map(r => r.file).join(', ')}) — no code references it`
      : 'no references anywhere outside the file itself',
  }
}

/** Render the sanity-check line(s). Unreachable targets are a RESHAPE prompt, never a drop. */
export function formatReport(assessments) {
  const bad = assessments.filter(a => a.status === 'unreachable')
  if (!assessments.length) return '7. **Target reachable?** — n/a (the issue names no repo paths).'
  if (!bad.length) {
    return `7. **Target reachable?** — ✅ all ${assessments.length} named path(s) are reachable.`
  }
  const lines = bad.map(a => `   - \`${a.path}\` — ${a.evidence}`)
  return [
    `7. **Target reachable?** — 🔁 **${bad.length} of ${assessments.length} named path(s) appear unreachable:**`,
    ...lines,
    '',
    '   Building here may ship something nobody can reach. **Confirm where it should live before building.**',
    '   ⚠️ Zero references is a hypothesis, not proof — this repo mounts things dynamically',
    '   (directory scanners, `croutonBlocks` registries, `@nuxt/kit` resolver paths). Verify, then reshape.',
  ].join('\n')
}

/**
 * What counts as *using* a target — deliberately not a bare symbol grep.
 *
 * A plain `git grep ProductsTab` "finds" it in two files that merely mention it in a code
 * COMMENT, and reports the deadest component in the package as reachable. (Verified: that
 * false negative is exactly what the first version of this script did.) So:
 *
 *  - a component is used when a TAG bears its name — `<SalesEventWorkspaceProductsTab`,
 *    `<ProductsTab`, or the kebab form — with any auto-import prefix in front;
 *  - a module is used when it is IMPORTED, not merely named.
 */
export function referenceQuery(kind, symbol) {
  const kebab = symbol.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()
  if (kind === 'component') {
    // The trailing class MUST allow end-of-line: a multi-line tag
    // (`<SalesEventWorkspaceProductImportPreview\n  :rows="…"`) has nothing after the
    // name on its own line, and requiring a character there flagged live components.
    return `<([A-Za-z0-9]*${symbol}|[a-z0-9-]*${kebab})([[:space:]/>]|$)`
  }
  return `(from|import|require)[^\\n]*${symbol}`
}

/**
 * Registries mount by NAME, not by tag — `croutonBlocks`/`croutonLayoutBlocks` entries in an
 * `app.config.ts`, and package manifests. A tag grep misses those entirely, so they get a
 * plain name search scoped to just those files.
 */
export const REGISTRY_GLOBS = ['*app.config.ts', '*.manifest.ts']

// ── CLI ──────────────────────────────────────────────────────────────────────
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }) }
  catch (e) { return e.stdout ?? '' }
}

const EXCLUDE = [':!*/dist/*', ':!*/node_modules/*', ':!*/.nuxt/*']

/** Grep the repo for real usage of a target, excluding build output. */
function findReferences(path) {
  const { kind, symbol } = classifyTarget(path)
  const lines = out => out.split('\n').filter(Boolean).map(file => ({ file }))

  // 1. Real usage — a tag for a component, an import for a module.
  const used = lines(sh('git', ['grep', '-l', '-E', referenceQuery(kind, symbol), '--', ...EXCLUDE]))
  // 2. Registry mounts, which are names in a config rather than tags in a template.
  const registered = lines(sh('git', ['grep', '-l', '-F', symbol, '--', ...REGISTRY_GLOBS, ...EXCLUDE]))

  const seen = new Set()
  return [...used, ...registered].filter(r => !seen.has(r.file) && seen.add(r.file))
}

function main(argv) {
  const args = argv.slice(2)
  if (!args.length) {
    console.error('usage: check-issue-targets.mjs <issue-number | path...>')
    process.exit(2)
  }
  let paths = args.filter(a => a.includes('/'))
  if (!paths.length && /^\d+$/.test(args[0])) {
    const body = sh('gh', ['issue', 'view', args[0], '--json', 'body', '--jq', '.body'])
    paths = extractPaths(body)
  }
  const assessments = paths.map(path => assessTarget({ path, references: findReferences(path) }))
  console.log(formatReport(assessments))
  // Exit 0 always — this informs a human verdict, it does not gate anything.
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv)
