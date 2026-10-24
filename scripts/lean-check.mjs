#!/usr/bin/env node
/**
 * lean-check.mjs — a REPORT-ONLY leanness check for the two dead-code shapes a JS import
 * graph (and so `fallow-audit`) structurally cannot see (#2190):
 *
 *   1. an i18n key defined in `**\/i18n/locales/*.json` whose last static `t('<key>')` /
 *      `$t('<key>')` caller was removed in the diff, and that no surviving source still calls;
 *   2. a Nuxt page under `app/pages/**` whose only inbound link (`to="/x"`, `navigateTo('/x')`,
 *      …) was removed in the diff, and that no surviving source still references.
 *
 * The live miss this prevents: #2186 dropped a button whose handler was the last caller of
 * `sales.events.openPos` and the last link to the `/order` page, leaving both dead — invisible
 * to fallow because neither is a JS import.
 *
 *   node scripts/lean-check.mjs [--base <ref>]   diff-scoped (default: origin/main)
 *   node scripts/lean-check.mjs --corpus         whole-repo candidate count (sizing only)
 *   node scripts/lean-check.mjs --json           machine-readable output
 *
 * DESIGN CONTRACT (AGENTS.md *Authoring a gate*):
 *   • Report-only — ALWAYS exits 0. It never blocks, never deletes. Even an uncaught crash
 *     exits 0 (a leanness hint must never be the thing that reddens CI).
 *   • No silent no-op — it always prints WHAT it scanned (locale files, defined keys, source
 *     files, page files), so a mis-globbed path that finds nothing can't masquerade as "clean".
 *   • #1957 false-positive guards — a key reached via a dynamic key (`t('a.b.' + x)` /
 *     `` t(`a.b.${x}`) ``) is NOT flagged; a page whose route is still referenced anywhere is
 *     NOT flagged; an all-dynamic route (`/[id]`) is skipped.
 *
 * All decision logic lives in the PURE, exported helpers below (no I/O), so
 * `lean-check.test.mjs` drives them with literals. main() only orchestrates.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findFiles } from './corpus-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const LOCALE_GLOB = '**/i18n/locales/*.json'
const SOURCE_GLOBS = ['**/*.vue', '**/*.ts', '**/*.js']
const PAGE_GLOB = '**/app/pages/**/*.vue'

// ── Pure helpers (no I/O) ──────────────────────────────────────────────────────────────────

/** Flatten a nested locale object into dotted keys: `{a:{b:1}}` → `['a.b']`. */
export function flattenKeys(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj || {})) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flattenKeys(v, full))
    else keys.push(full)
  }
  return keys
}

// Static `t('a.b')` / `$t("a.b")` / `` t(`a.b`) `` — the char class excludes `$`, so an
// interpolated template literal (a DYNAMIC key) never matches here.
const STATIC_CALL = /\$?t\(\s*(['"`])([^'"`$]+?)\1\s*[),]/g
/** The set of i18n keys referenced by a STATIC string-literal `t()`/`$t()` call in `text`. */
export function staticKeyCalls(text) {
  const keys = new Set()
  let m
  while ((m = STATIC_CALL.exec(text)) !== null) keys.add(m[2])
  return keys
}

// Dynamic calls whose STATIC prefix we can recover: `t('a.b.' + x)` and `` t(`a.b.${x}`) ``.
const DYNAMIC_CONCAT = /\$?t\(\s*(['"])([^'"]*?)\1\s*\+/g
const DYNAMIC_TMPL = /\$?t\(\s*`([^`]*?)\$\{/g
/** Static prefixes of dynamic `t()` calls in `text` (used to suppress false positives). */
export function dynamicKeyPrefixes(text) {
  const prefixes = new Set()
  let m
  while ((m = DYNAMIC_CONCAT.exec(text)) !== null) prefixes.add(m[2])
  while ((m = DYNAMIC_TMPL.exec(text)) !== null) prefixes.add(m[1])
  return prefixes
}

/** True when `key` could be produced by one of the dynamic `prefixes` (#1957 guard). */
export function isCoveredByPrefix(key, prefixes) {
  for (const p of prefixes) if (p && key.startsWith(p)) return true
  return false
}

/**
 * Keys whose last caller went away in the diff and that nothing surviving still reaches.
 * PURE — the caller supplies the sets, so a test needs no git or fs.
 */
export function orphanedKeyCandidates({ definedKeys, removedCalls, remainingCalls, dynamicPrefixes }) {
  const defined = new Set(definedKeys)
  const remaining = new Set(remainingCalls)
  const prefixes = new Set(dynamicPrefixes)
  return [...new Set(removedCalls)]
    .filter(key => defined.has(key))
    .filter(key => !remaining.has(key))
    .filter(key => !isCoveredByPrefix(key, prefixes))
    .sort()
}

/** True when EVERY segment of `route` is dynamic (`:id` / `[id]`) — un-linkable, so skipped. */
export function isAllDynamicRoute(route) {
  const segs = route.split('/').filter(Boolean)
  if (segs.length === 0) return false
  return segs.every(s => s.startsWith(':') || (s.startsWith('[') && s.endsWith(']')))
}

/** True when any surviving reference points at `route` or a path beneath it. */
export function routeIsReferenced(route, remainingRefs) {
  for (const r of remainingRefs) if (r === route || r.startsWith(route + '/')) return true
  return false
}

/**
 * Pages whose only inbound link went away in the diff and that nothing surviving references.
 * PURE — the caller supplies the sets.
 */
export function strandedPageCandidates({ pageRoutes, removedLinks, remainingRefs }) {
  const removed = new Set(removedLinks)
  const refs = new Set(remainingRefs)
  return [...new Set(pageRoutes)]
    .filter(route => removed.has(route))
    .filter(route => !isAllDynamicRoute(route))
    .filter(route => !routeIsReferenced(route, refs))
    .sort()
}

/** The content of lines DELETED by a unified diff (`-` lines, not the `---` file header). */
export function removedLines(diffText) {
  return diffText.split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1))
}

/** Map a page file path to its route: `app/pages/order/index.vue` → `/order`, `app/pages/index.vue` → `/`. */
export function routeForPageFile(file) {
  const m = file.replace(/\\/g, '/').match(/app\/pages\/(.+)\.vue$/)
  if (!m) return null
  let p = m[1].replace(/\/index$/, '')
  if (p === 'index') p = ''
  p = p.split('/').filter(Boolean).map(s => s.replace(/^\[(.+)\]$/, ':$1')).join('/')
  return '/' + p
}

// Quoted absolute paths — `to="/order"`, `navigateTo('/order')`, `href="/order/new"`.
const ROUTE_STR = /(['"])(\/[a-zA-Z0-9_\-/:[\]]*)\1/g
/** Route-like strings referenced in `text` (normalised: no trailing slash except root). */
export function extractRouteLinks(text) {
  const routes = new Set()
  let m
  while ((m = ROUTE_STR.exec(text)) !== null) {
    let r = m[2]
    if (r.length > 1) r = r.replace(/\/+$/, '') || '/'
    routes.add(r)
  }
  return routes
}

/** Parse argv into `{ base, corpus, json }`. */
export function parseArgs(argv) {
  const args = { base: 'origin/main', corpus: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--corpus') args.corpus = true
    else if (a === '--json') args.json = true
  }
  return args
}

/** Render one titled list section for the human report. */
function listSection(title, items, render) {
  if (items.length === 0) return `  ${title}: none`
  return [`  ${title}: ${items.length}`, ...items.map(i => `    • ${render(i)}`)].join('\n')
}

/** Human report. The scanned line is part of the verdict — "0 files, clean" is NOT clean. */
export function formatReport(result) {
  const s = result.scanned
  const lines = [
    `lean-check (${result.mode}) — report-only, never blocks (#2190)`,
    `  scanned: ${s.localeFiles} locale file(s) · ${s.definedKeys} defined key(s) · ${s.sourceFiles} source file(s) · ${s.pageFiles} page file(s)`,
  ]
  if (s.localeFiles === 0 || s.sourceFiles === 0) {
    lines.push('  ⚠️  a glob matched NOTHING — the scan is probably mis-pathed; treat this run as inconclusive, not clean.')
  }
  lines.push('')
  lines.push(listSection('Orphaned i18n keys', result.orphanedKeys, k => k))
  lines.push(listSection('Stranded Nuxt pages', result.strandedPages, p => p))
  const total = result.orphanedKeys.length + result.strandedPages.length
  lines.push('')
  lines.push(total === 0
    ? '✅ nothing orphaned'
    : `⚠️  ${total} candidate(s) — remove the dead leftover, or say on the PR why it stays. This check never blocks.`)
  return lines.join('\n')
}

// ── I/O layer ──────────────────────────────────────────────────────────────────────────────

/** All defined i18n keys across every locale file (+ the file/key counts). */
function readLocaleScan() {
  const files = findFiles(LOCALE_GLOB, ROOT)
  const defined = new Set()
  for (const file of files) {
    try { flattenKeys(JSON.parse(readFileSync(join(ROOT, file), 'utf8'))).forEach(k => defined.add(k)) }
    catch { /* a locale file that doesn't parse contributes no keys — reported via the count */ }
  }
  return { files, defined }
}

/** Read every source file once, accumulating surviving key calls, dynamic prefixes, and route refs. */
function readSourceScan() {
  const files = new Set()
  for (const g of SOURCE_GLOBS) for (const f of findFiles(g, ROOT)) files.add(f)
  const remainingCalls = new Set()
  const dynamicPrefixes = new Set()
  const remainingRefs = new Set()
  for (const file of files) {
    const text = safeRead(file)
    staticKeyCalls(text).forEach(k => remainingCalls.add(k))
    dynamicKeyPrefixes(text).forEach(p => dynamicPrefixes.add(p))
    extractRouteLinks(text).forEach(r => remainingRefs.add(r))
  }
  return { files: [...files], remainingCalls, dynamicPrefixes, remainingRefs }
}

/** Every page route declared under `app/pages/**`. */
function readPageScan() {
  const files = findFiles(PAGE_GLOB, ROOT)
  const routes = files.map(routeForPageFile).filter(Boolean)
  return { files, routes }
}

function safeRead(file) {
  try { return readFileSync(join(ROOT, file), 'utf8') } catch { return '' }
}

/** What the diff DELETED: static key calls and route links. */
function readDiffScan(base) {
  let diff = ''
  try { diff = execFileSync('git', ['diff', base, '--', '.'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch { /* no such base / not a repo → empty diff → "nothing orphaned"; still exits 0 */ }
  const removed = removedLines(diff)
  const removedCalls = new Set()
  const removedLinks = new Set()
  for (const line of removed) {
    staticKeyCalls(line).forEach(k => removedCalls.add(k))
    extractRouteLinks(line).forEach(r => removedLinks.add(r))
  }
  return { removedCalls, removedLinks }
}

/** Assemble the scanned-counts block shared by both modes. */
function scannedCounts(locale, source, page) {
  return {
    localeFiles: locale.files.length,
    definedKeys: locale.defined.size,
    sourceFiles: source.files.length,
    pageFiles: page.files.length,
  }
}

/** Diff mode: candidates are things whose caller/link was removed by THIS diff. */
function runDiff(base, locale, source, page) {
  const diff = readDiffScan(base)
  return {
    mode: 'diff',
    scanned: scannedCounts(locale, source, page),
    orphanedKeys: orphanedKeyCandidates({
      definedKeys: locale.defined,
      removedCalls: diff.removedCalls,
      remainingCalls: source.remainingCalls,
      dynamicPrefixes: source.dynamicPrefixes,
    }),
    strandedPages: strandedPageCandidates({
      pageRoutes: page.routes,
      removedLinks: diff.removedLinks,
      remainingRefs: source.remainingRefs,
    }),
  }
}

/** Corpus mode: size the whole-repo dead surface — everything defined-but-never-reached. */
function runCorpus(locale, source, page) {
  return {
    mode: 'corpus',
    scanned: scannedCounts(locale, source, page),
    orphanedKeys: orphanedKeyCandidates({
      definedKeys: locale.defined,
      removedCalls: locale.defined,
      remainingCalls: source.remainingCalls,
      dynamicPrefixes: source.dynamicPrefixes,
    }),
    strandedPages: strandedPageCandidates({
      pageRoutes: page.routes,
      removedLinks: page.routes,
      remainingRefs: source.remainingRefs,
    }),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const locale = readLocaleScan()
  const source = readSourceScan()
  const page = readPageScan()
  const result = args.corpus ? runCorpus(locale, source, page) : runDiff(args.base, locale, source, page)
  console.log(args.json ? JSON.stringify(result, null, 2) : formatReport(result))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // Report-only: ANY failure still exits 0 (a leanness hint must never redden CI).
  try { main() } catch (err) { console.error(`lean-check: crashed (reported as clean): ${err?.message || err}`) }
  process.exit(0)
}
