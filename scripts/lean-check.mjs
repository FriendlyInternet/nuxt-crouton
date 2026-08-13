#!/usr/bin/env node
/**
 * lean-check.mjs — report-only, diff-scoped check for two dead-code shapes fallow-audit's
 * JS import graph cannot see (#2192, tooling half of #2190):
 *
 *   - an i18n key whose only remaining call site was removed by a diff, but the key itself
 *     is still defined in a locale JSON (JSON keys aren't fallow dependencies, nothing
 *     deletes them automatically);
 *   - a Nuxt page route file whose only remaining inbound link was removed by a diff, but
 *     the page file itself still exists (a page is an auto-registered entry point, so a
 *     static importer graph never calls it "dead").
 *
 * Both were the live miss on #2186 / PR #2187 (`sales.events.openPos`, `/order`).
 *
 * REPORT-ONLY (#1965 "Authoring a gate"): never fails the build, never deletes anything. A
 * hit here is a HYPOTHESIS (#1149) — rule out a dynamic loader (a key built as
 * `t('prefix.' + var)`, a route reached only via a computed `:to`) before deleting.
 *
 *   node scripts/lean-check.mjs                 # diff-scoped: working tree vs HEAD
 *   node scripts/lean-check.mjs --base <ref>     # diff-scoped: working tree vs <ref>
 *   node scripts/lean-check.mjs --whole-repo     # corpus mode (#1965): every currently
 *                                                 # defined key/page, not diff-scoped
 *   node scripts/lean-check.mjs --json
 *
 * No silent no-op: the report always states how many locale/page/source files it scanned,
 * so a mis-globbed path can't "pass" by finding nothing (AGENTS.md "Authoring a gate").
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = ['node_modules', '.git', '.nuxt', '.output', '.wrangler', 'dist', '.data']

function walk(dir, filter) {
  const out = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) out.push(...walk(full, filter))
    } else if (filter(full)) {
      out.push(full)
    }
  }
  return out
}

/** All `**\/i18n/locales/*.json` files (packages + apps), repo-relative. */
export function findLocaleFiles(root = ROOT) {
  return walk(root, f => /\/i18n\/locales\/[a-z]{2}\.json$/.test(f.replace(/\\/g, '/')))
    .map(f => relative(root, f).replace(/\\/g, '/'))
}

/** All Nuxt page route files, repo-relative. */
export function findPageFiles(root = ROOT) {
  return walk(root, (f) => {
    const rel = f.replace(/\\/g, '/')
    return /\/app\/pages\//.test(rel) && rel.endsWith('.vue')
  }).map(f => relative(root, f).replace(/\\/g, '/'))
}

/** Every source file worth grepping for references. */
export function findSourceFiles(root = ROOT) {
  return walk(root, f => ['.vue', '.ts', '.tsx', '.js', '.mjs'].includes(extname(f)))
    .map(f => relative(root, f).replace(/\\/g, '/'))
}

/** Flatten a nested locale JSON object to dot-notation keys. */
export function flattenKeys(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenKeys(v, key))
    else out.push(key)
  }
  return out
}

/** Every i18n key defined anywhere in the repo → the locale file(s) that define it. */
export function collectDefinedKeys(root = ROOT) {
  const defined = new Map() // key -> Set<file>
  for (const file of findLocaleFiles(root)) {
    let json
    try { json = JSON.parse(readFileSync(join(root, file), 'utf8')) } catch { continue }
    for (const key of flattenKeys(json)) {
      if (!defined.has(key)) defined.set(key, new Set())
      defined.get(key).add(file)
    }
  }
  return defined
}

// Requires the closing quote to be immediately followed by `)` or `,` (ignoring
// whitespace) — a quoted literal that's then concatenated (`'sales.' + status`) does
// NOT match, so it can't be mistaken for a real reference to that literal string.
const T_CALL_RE = /\$?\bt\(\s*(['"`])([\w.-]+)\1\s*[),]/g

/**
 * Literal `t('key')` / `$t('key')` references found in a chunk of source text.
 * Only literal string first-args count — a dynamically built key (`t('sales.' + status)`)
 * is NOT extracted here and so cannot itself be treated as a "reference", but critically it
 * also means we never claim we've proven a dynamic key dead: see collectKeyReferenceCounts.
 */
export function extractLiteralKeyRefs(text) {
  const keys = new Set()
  let m
  T_CALL_RE.lastIndex = 0
  while ((m = T_CALL_RE.exec(text))) keys.add(m[2])
  return keys
}

/**
 * Does this source text contain ANY `t(` / `$t(` call with a non-literal (dynamic) first
 * argument? If so, the file is opted OUT of "zero references" conclusions for the enclosing
 * key namespace — see `hasDynamicKeyBuilder`. This is the #1957 false-refusal guard: a key
 * reached only via `t('sales.events.' + status)` must never be reported as orphaned.
 */
export function hasDynamicKeyBuilder(text) {
  return (
    /\$?\bt\(\s*[^'"` )]/.test(text) // bare identifier/expression as first arg
    || /\$?\bt\(\s*`[^`]*\$\{/.test(text) // template literal with interpolation
    || /\$?\bt\(\s*(['"])[^'"]*\1\s*\+/.test(text) // literal immediately concatenated
  )
}

/** How many source files literally reference each defined key, repo-wide. */
export function collectKeyReferenceCounts(root, sourceFiles) {
  const counts = new Map()
  for (const file of sourceFiles) {
    let text
    try { text = readFileSync(join(root, file), 'utf8') } catch { continue }
    for (const key of extractLiteralKeyRefs(text)) {
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return counts
}

/** Does any source file contain a dynamic `t(...)` builder at all (repo-wide guard)? */
export function repoHasDynamicKeyBuilder(root, sourceFiles) {
  for (const file of sourceFiles) {
    let text
    try { text = readFileSync(join(root, file), 'utf8') } catch { continue }
    if (hasDynamicKeyBuilder(text)) return true
  }
  return false
}

/** `app/pages/foo/[slug]/order.vue` → `/foo/:slug/order` (loose — good enough for substring matching). */
export function pageFileToRoutePath(file) {
  const m = file.match(/\/app\/pages\/(.*)\.vue$/)
  if (!m) return null
  const route = m[1]
    .replace(/(^|\/)index$/, '')
    .replace(/\[\[?\.\.\.[\w-]+\]?\]/g, '') // catch-all segments
    .replace(/\[([\w-]+)\]/g, ':$1')
  return '/' + route.replace(/^\/+/, '')
}

/**
 * Does any OTHER source file reference this page's route? Loose on purpose: matches the
 * route's static segments as a substring, so a dynamically built `:to` (`` `/orders/${id}` ``)
 * or a redirect string still counts as a reference. False NEGATIVES here are safe (we just
 * miss flagging a truly dead page); false POSITIVES are not (#1957) — so we err toward "has
 * a reference" whenever the route is too short/ambiguous to judge.
 */
export function pageHasInboundReference(root, pageFile, sourceFiles) {
  const route = pageFileToRoutePath(pageFile)
  if (!route) return true // couldn't parse the path — don't claim it's dead
  const staticSegments = route.split('/').filter(s => s && !s.startsWith(':'))
  if (staticSegments.length === 0) return true // root or fully-dynamic route: too ambiguous
  const needle = staticSegments.join('/')
  if (needle.length < 4) return true // too short to be a meaningful, non-noisy substring match
  for (const file of sourceFiles) {
    if (file === pageFile) continue
    let text
    try { text = readFileSync(join(root, file), 'utf8') } catch { continue }
    if (text.includes(needle)) return true
  }
  return false
}

/** Lines removed by a diff (unified `git diff` text), i.e. lines starting with a single `-`. */
export function removedLines(diffText) {
  return diffText
    .split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1))
}

function gitDiff(base, root) {
  try {
    return execFileSync('git', ['diff', base], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
  } catch (err) {
    throw new Error(`git diff ${base} failed: ${err.message}`)
  }
}

/**
 * Diff-scoped check: only i18n keys / pages whose reference count dropped to zero because of
 * lines THIS diff removed. Pre-existing whole-repo dead code is out of scope — see checkWholeRepo.
 */
export function checkDiff({ root = ROOT, diffText }) {
  const removed = removedLines(diffText).join('\n')
  const touchedKeys = extractLiteralKeyRefs(removed)

  const sourceFiles = findSourceFiles(root)
  const definedKeys = collectDefinedKeys(root)
  const refCounts = collectKeyReferenceCounts(root, sourceFiles)
  const dynamicBuilderExists = repoHasDynamicKeyBuilder(root, sourceFiles)

  const orphanedKeys = []
  for (const key of touchedKeys) {
    if (!definedKeys.has(key)) continue // the key itself was deleted too — nothing orphaned
    if ((refCounts.get(key) || 0) > 0) continue // still referenced elsewhere
    orphanedKeys.push({
      key,
      definedIn: [...definedKeys.get(key)],
      note: dynamicBuilderExists ? 'repo contains dynamic t() builders — verify this key is not reached dynamically before deleting' : undefined,
    })
  }

  const allPages = findPageFiles(root)
  const strandedPages = []
  for (const page of allPages) {
    const route = pageFileToRoutePath(page)
    if (!route) continue
    const staticSegments = route.split('/').filter(s => s && !s.startsWith(':'))
    if (staticSegments.length === 0) continue
    const needle = staticSegments.join('/')
    if (needle.length < 4 || !removed.includes(needle)) continue // this diff didn't touch a reference to this page
    if (!pageHasInboundReference(root, page, sourceFiles)) {
      strandedPages.push({ page, route })
    }
  }

  return {
    scanned: { localeFiles: findLocaleFiles(root).length, sourceFiles: sourceFiles.length, pageFiles: allPages.length },
    orphanedKeys,
    strandedPages,
  }
}

/** Whole-repo corpus mode (#1965): every currently-defined key/page with zero references. */
export function checkWholeRepo({ root = ROOT } = {}) {
  const sourceFiles = findSourceFiles(root)
  const definedKeys = collectDefinedKeys(root)
  const refCounts = collectKeyReferenceCounts(root, sourceFiles)
  const dynamicBuilderExists = repoHasDynamicKeyBuilder(root, sourceFiles)

  const orphanedKeys = []
  for (const [key, files] of definedKeys) {
    if ((refCounts.get(key) || 0) === 0) {
      orphanedKeys.push({
        key,
        definedIn: [...files],
        note: dynamicBuilderExists ? 'repo contains dynamic t() builders — verify this key is not reached dynamically before deleting' : undefined,
      })
    }
  }

  const allPages = findPageFiles(root)
  const strandedPages = []
  for (const page of allPages) {
    if (!pageHasInboundReference(root, page, sourceFiles)) {
      strandedPages.push({ page, route: pageFileToRoutePath(page) })
    }
  }

  return {
    scanned: {
      localeFiles: findLocaleFiles(root).length,
      sourceFiles: sourceFiles.length,
      pageFiles: allPages.length,
      definedKeys: definedKeys.size,
    },
    orphanedKeys,
    strandedPages,
  }
}

export function formatReport(result, { mode }) {
  const lines = [
    `lean-check (${mode}): scanned ${result.scanned.localeFiles} locale file(s), ${result.scanned.pageFiles} page file(s), ${result.scanned.sourceFiles} source file(s)`,
  ]
  if (result.scanned.localeFiles === 0 && result.scanned.pageFiles === 0) {
    lines.push('', '⚠️  MATCHED NOTHING — the locale/page globs found zero files. Check paths before trusting "clean".')
    return lines.join('\n')
  }
  if (result.orphanedKeys.length === 0 && result.strandedPages.length === 0) {
    lines.push('', '✅ nothing orphaned by this check.')
    return lines.join('\n')
  }
  if (result.orphanedKeys.length) {
    lines.push('', `🔑 ${result.orphanedKeys.length} i18n key(s) with zero t()/$t() references:`)
    for (const { key, definedIn, note } of result.orphanedKeys) {
      lines.push(`  - ${key}  (defined in ${definedIn.join(', ')})${note ? `  [${note}]` : ''}`)
    }
  }
  if (result.strandedPages.length) {
    lines.push('', `📄 ${result.strandedPages.length} page(s) with zero inbound references:`)
    for (const { page, route } of result.strandedPages) lines.push(`  - ${page}  (route ${route})`)
  }
  lines.push('', 'These are HYPOTHESES (#1149) — rule out a dynamic key/route builder before deleting.')
  lines.push('Report-only: this never fails the build and never deletes anything.')
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { base: 'HEAD', wholeRepo: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--whole-repo') args.wholeRepo = true
    else if (a === '--json') args.json = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = args.wholeRepo
    ? checkWholeRepo({ root: ROOT })
    : checkDiff({ root: ROOT, diffText: gitDiff(args.base, ROOT) })

  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatReport(result, { mode: args.wholeRepo ? 'whole-repo' : `diff vs ${args.base}` }))

  process.exit(0) // report-only — never fails the build
}

if (import.meta.url === `file://${process.argv[1]}`) main()
