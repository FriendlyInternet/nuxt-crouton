#!/usr/bin/env node
/**
 * lean-check.mjs — report-first "keep it lean" check (#2190).
 *
 *   node scripts/lean-check.mjs [--base <ref>]   # diff-scoped: what did THIS change orphan?
 *   node scripts/lean-check.mjs --corpus         # whole-repo: how many candidates exist today?
 *
 * The `fallow-audit` gate (#1120) judges a diff for dead code, but two kinds of orphan sit
 * OUTSIDE a JS import graph and slipped through on PR #2187 (the #2186 miss):
 *   • an i18n key left in a `<layer>/i18n/locales/*.json` file after its last `t('<key>')` caller
 *     — JSON locale keys aren't fallow dependencies;
 *   • a Nuxt page under `app/pages/**` left with zero inbound links after the button linking to it
 *     went away — a page is an auto-registered ENTRY POINT, so a static importer graph never calls
 *     it "dead".
 *
 * This flags those as CANDIDATES a change introduced. It follows AGENTS.md "Authoring a gate":
 *   • REPORT-ONLY. It always exits 0 (never blocks). Warning/blocking is a later, deliberate step
 *     and only after the `--corpus` run is understood — see writeups/reports/lean-check-design.md.
 *   • NEVER auto-deletes. A zero-reference finding is a HYPOTHESIS (#1149): the human/agent rules
 *     out the dynamic loader (a `t('a.b.' + x)` key, a string-built `NuxtLink`) before deleting.
 *   • NO SILENT NO-OP (AGENTS.md). It always prints what it scanned (locale files, defined keys,
 *     source files, page files, changed lines) so a mis-globbed path can't "pass" by finding nothing.
 *   • Handles the #1957 false-refusal trap: a key reached only via a DYNAMIC key, or a page whose
 *     route segment is still referenced anywhere, is NOT reported.
 *
 * The pure helpers below take literals (no I/O) so lean-check.test.mjs can exercise every branch,
 * including the #2186 regression (`sales.events.openPos` + the `/order` page) and its dynamic-key
 * false-positive counterpart.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories never worth scanning — build output and vendored code, not source. */
export const SKIP_DIRS = ['node_modules', '.git', '.nuxt', '.output', '.wrangler', 'dist']

/** Source extensions that can hold a `t(...)` reference or a `<NuxtLink>` / `navigateTo`. */
export const SOURCE_EXT = ['.vue', '.ts', '.js', '.mjs', '.cjs', '.jsx', '.tsx']

// ── pure helpers (unit-tested; no I/O) ───────────────────────────────────────

/** Flatten a nested locale JSON object into dot-notation keys (leaves only). */
export function flattenKeys(obj, prefix = '') {
  const out = []
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v != null && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenKeys(v, key))
    else out.push(key)
  }
  return out
}

/**
 * Every STATIC key referenced by a `t('...')` / `$t('...')` call in `text`.
 * A call whose argument is built dynamically (`t('a.' + x)`, `t(`a.${x}`)`) is deliberately NOT a
 * static reference — those namespaces are surfaced separately by {@link extractDynamicPrefixes}.
 * The `\b` before `t` stops `emit(`, `format(`, `wait(` etc. from matching.
 */
export function extractTKeys(text) {
  const out = new Set()
  const re = /\$?\bt\(\s*(['"`])([^'"`$]+?)\1/g
  let m
  while ((m = re.exec(String(text)))) out.add(m[2])
  return [...out]
}

/**
 * Namespace prefixes reached ONLY dynamically: `t('sales.events.' + status)` or `t(`a.b.${x}`)`.
 * A defined key under such a prefix is NOT dead — this is the #1957 false-refusal guard.
 */
export function extractDynamicPrefixes(text) {
  const out = new Set()
  const s = String(text)
  let m
  const concat = /\$?\bt\(\s*['"]([^'"]*?)['"]\s*\+/g
  while ((m = concat.exec(s))) if (m[1]) out.add(m[1])
  const tmpl = /\$?\bt\(\s*`([^`$]*)\$\{/g
  while ((m = tmpl.exec(s))) if (m[1]) out.add(m[1])
  return [...out]
}

/** Keys whose `t('<key>')` caller was DELETED in this diff (a `-` line, not the `--- a/…` header). */
export function removedTKeys(diff) {
  const out = new Set()
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) {
      for (const k of extractTKeys(line.slice(1))) out.add(k)
    }
  }
  return [...out]
}

/**
 * The orphaned-key CANDIDATES a diff introduced — diff-scoped and false-positive-guarded.
 * A key is a candidate iff its caller was removed AND it is still defined AND nothing else still
 * references it statically AND it is not covered by a surviving dynamic prefix.
 */
export function findOrphanKeys({ definedKeys = [], referencedKeys = [], dynamicPrefixes = [], removedKeys = [] }) {
  const defined = new Set(definedKeys)
  const referenced = new Set(referencedKeys)
  const covered = key => dynamicPrefixes.some(p => p && key.startsWith(p))
  const out = []
  for (const key of new Set(removedKeys)) {
    if (!defined.has(key)) continue     // caller removed AND the key was removed too → already lean
    if (referenced.has(key)) continue   // another static caller remains → alive
    if (covered(key)) continue          // reached via a dynamic key → NOT dead (#1957)
    out.push(key)
  }
  return out.sort()
}

/**
 * Every defined key with zero static reference and no dynamic-prefix cover — the WHOLE-REPO
 * corpus view (`--corpus`), used to size the false-positive surface before this may ever warn.
 */
export function findAllOrphanKeys({ definedKeys = [], referencedKeys = [], dynamicPrefixes = [] }) {
  const referenced = new Set(referencedKeys)
  const covered = key => dynamicPrefixes.some(p => p && key.startsWith(p))
  return [...new Set(definedKeys)].filter(k => !referenced.has(k) && !covered(k)).sort()
}

/** Route-ish target strings removed in the diff: `to=`, `:to=`, `href=`, `navigateTo/push/replace(...)`. */
export function removedLinkTargets(diff) {
  const out = new Set()
  const re = /(?:\bto|\bhref)\s*[=:]\s*["'`]([^"'`]+)["'`]|(?:navigateTo|push|replace)\(\s*["'`]([^"'`]+)["'`]/g
  for (const line of String(diff).split('\n')) {
    if (!line.startsWith('-') || line.startsWith('---')) continue
    const s = line.slice(1)
    let m
    while ((m = re.exec(s))) { const v = m[1] || m[2]; if (v) out.add(v) }
  }
  return [...out]
}

/** Nuxt route for a page file: strip up to `/pages/`, drop `.vue`, `[slug]`→`:slug`, `index`→''. */
export function pageRoute(path) {
  let p = String(path).replace(/\\/g, '/')
  const idx = p.lastIndexOf('/pages/')
  if (idx === -1) return null
  p = p.slice(idx + '/pages/'.length).replace(/\.vue$/, '')
  const segs = p.split('/')
    .map(s => s.replace(/^\[\.\.\.(.+)\]$/, ':$1(.*)*').replace(/^\[(.+)\]$/, ':$1'))
  if (segs[segs.length - 1] === 'index') segs.pop()
  return '/' + segs.filter(Boolean).join('/')
}

/** The page's last STATIC route segment (e.g. `order`), or null when every segment is dynamic. */
export function pageTerminal(path) {
  const route = pageRoute(path)
  if (!route) return null
  const segs = route.split('/').filter(Boolean)
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!segs[i].startsWith(':')) return segs[i]
  }
  return null // all-dynamic route → too fuzzy to match a link string → conservatively skip
}

/**
 * Stranded-page CANDIDATES a diff introduced. A page is a candidate iff a link to its terminal
 * segment was removed in the diff AND that segment is no longer referenced anywhere. `referenced`
 * is the set of terminals still present in the current tree (the runtime greps it; a test stubs it).
 */
export function findStrandedPages({ pageFiles = [], removedTargets = [], referenced = new Set() }) {
  const removedSegs = new Set()
  for (const t of removedTargets) for (const seg of String(t).split(/[/?#]/)) if (seg) removedSegs.add(seg)
  const ref = referenced instanceof Set ? referenced : new Set(referenced)
  const out = []
  for (const file of pageFiles) {
    const terminal = pageTerminal(file)
    if (!terminal) continue
    if (!removedSegs.has(terminal)) continue // this page's link wasn't removed in the diff
    if (ref.has(terminal)) continue          // still linked somewhere → alive (#1957 page analog)
    out.push({ file, route: pageRoute(file), terminal })
  }
  return out
}

// ── I/O (skipped when imported, e.g. by the test) ────────────────────────────

/** Translate a glob (`**`, `*`) into an anchored RegExp over forward-slashed paths. */
function globToRegExp(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { out += '(?:[^/]*\\/)*'; i += 2 } else { out += '.*'; i += 1 }
      } else out += '[^/]*'
    } else out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

function findFiles(pattern, root = ROOT) {
  const re = globToRegExp(pattern)
  const found = []
  const walk = dir => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { if (!SKIP_DIRS.includes(entry.name)) walk(full) }
      else { const rel = relative(root, full).replace(/\\/g, '/'); if (re.test(rel)) found.push(rel) }
    }
  }
  walk(root)
  return found.sort()
}

function safeGit(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }) } catch { return '' }
}

/** Resolve the diff base: `--base <ref>`, else $LEAN_CHECK_BASE, else merge-base with origin/main. */
function resolveBase(argv) {
  const i = argv.indexOf('--base')
  if (i !== -1 && argv[i + 1]) return argv[i + 1]
  if (process.env.LEAN_CHECK_BASE) return process.env.LEAN_CHECK_BASE
  const mb = safeGit(['merge-base', 'origin/main', 'HEAD']).trim()
  return mb || ''
}

function allSourceText() {
  const files = SOURCE_EXT.flatMap(ext => findFiles(`**/*${ext}`))
  let text = ''
  for (const f of files) { try { text += readFileSync(join(ROOT, f), 'utf8') + '\n' } catch { /* skip */ } }
  return { files, text }
}

function localeDefs() {
  const files = findFiles('**/i18n/locales/*.json')
  const keyToFiles = new Map()
  for (const f of files) {
    let json
    try { json = JSON.parse(readFileSync(join(ROOT, f), 'utf8')) } catch { continue }
    for (const k of flattenKeys(json)) {
      if (!keyToFiles.has(k)) keyToFiles.set(k, [])
      keyToFiles.get(k).push(f)
    }
  }
  return { files, keyToFiles }
}

async function main() {
  const argv = process.argv.slice(2)
  const corpus = argv.includes('--corpus')
  const base = corpus ? '' : resolveBase(argv)
  const diff = corpus ? '' : safeGit(['diff', base ? `${base}...HEAD` : 'HEAD'])
  const diffLines = diff ? diff.split('\n').length : 0

  const { files: localeFiles, keyToFiles } = localeDefs()
  const definedKeys = [...keyToFiles.keys()]
  const { files: sourceFiles, text: sourceText } = allSourceText()
  const referencedKeys = extractTKeys(sourceText)
  const dynamicPrefixes = extractDynamicPrefixes(sourceText)
  const pageFiles = [...new Set([...findFiles('**/app/pages/**/*.vue'), ...findFiles('**/pages/**/*.vue')])]

  // No silent no-op: always report what was scanned.
  console.log(`[lean-check] ${corpus ? 'corpus (whole-repo)' : `diff vs ${base || 'HEAD (working tree)'}`}`)
  console.log(`[lean-check] scanned: ${localeFiles.length} locale file(s), ${definedKeys.length} defined key(s), ` +
    `${sourceFiles.length} source file(s), ${pageFiles.length} page file(s), ${diffLines} diff line(s)`)
  console.log(`[lean-check] dynamic i18n prefixes in use (not dead): ${dynamicPrefixes.length}`)
  if (!corpus && !base) console.log('[lean-check] NOTE: no diff base resolved (origin/main missing?) — using working tree')

  let orphanKeys, strandedPages = []
  if (corpus) {
    orphanKeys = findAllOrphanKeys({ definedKeys, referencedKeys, dynamicPrefixes })
  } else {
    orphanKeys = findOrphanKeys({ definedKeys, referencedKeys, dynamicPrefixes, removedKeys: removedTKeys(diff) })
    const removedTargets = removedLinkTargets(diff)
    const wantTerminals = new Set(pageFiles.map(pageTerminal).filter(Boolean))
    const referenced = new Set([...wantTerminals].filter(seg =>
      new RegExp(`["'\`/]${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|["'\`/?#])`).test(sourceText)))
    strandedPages = findStrandedPages({ pageFiles, removedTargets, referenced })
  }

  console.log('')
  if (!orphanKeys.length && !strandedPages.length) {
    console.log(corpus
      ? '✅ no orphan i18n keys repo-wide (every defined key is referenced or dynamically reached)'
      : '✅ nothing orphaned by this change')
    process.exit(0) // report-only: always succeeds
  }

  if (orphanKeys.length) {
    console.log(`🔎 ${orphanKeys.length} candidate orphaned i18n key(s) — a HYPOTHESIS (#1149), not a verdict.`)
    console.log('   Rule out a dynamic caller (t(\'prefix.\' + x)) before removing any:')
    for (const k of orphanKeys.slice(0, 50)) console.log(`   • ${k}  [${(keyToFiles.get(k) || []).join(', ')}]`)
    if (orphanKeys.length > 50) console.log(`   … and ${orphanKeys.length - 50} more`)
  }
  if (strandedPages.length) {
    console.log(`🔎 ${strandedPages.length} candidate stranded page(s) — rule out a string-built link before removing:`)
    for (const p of strandedPages) console.log(`   • ${p.file}  (route ${p.route})`)
  }
  console.log('')
  console.log('REPORT-ONLY: this never blocks and never deletes. Confirm each candidate by hand, then')
  console.log('remove the callee (or state why it stays) per the AGENTS.md "remove what you orphan" rule.')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error(err); process.exit(0) }) // report-only: even a crash must not block CI
}
