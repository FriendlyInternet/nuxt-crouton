#!/usr/bin/env node
/**
 * Report-only, diff-scoped check for NET-NEW orphaned i18n keys (#2194).
 *
 * A key is a net-new orphan when it was referenced via t('key')/$t('key')/tString('key')
 * somewhere in the codebase BEFORE a diff, has ZERO static references AFTER the diff, and
 * is STILL DEFINED in a locale file — dead weight nobody will notice, exactly what happened
 * to `sales.events.openPos` on PR #2187 after #2186 deleted its last call site.
 *
 * Design constraints (AGENTS.md "Authoring a gate"):
 *   - Report-only / warn, never blocking, never auto-deletes — it only prints candidates.
 *   - A key reached only via a *dynamic* reference (e.g. `t(\`sales.events.${status}\`)`) is
 *     a false positive; its prefix is detected and excluded from the report.
 *   - No silent no-op: always prints what it scanned (files / keys) even when clean.
 *
 * Usage:
 *   node scripts/i18n-check-orphans.mjs                # diff HEAD~1..working tree (default)
 *   node scripts/i18n-check-orphans.mjs --base <ref>    # diff <ref>..working tree
 *   node scripts/i18n-check-orphans.mjs --full          # whole-repo dead-key sweep (NOT diff-scoped;
 *                                                        # includes pre-existing dead keys too)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- pure functions (unit-tested in i18n-check-orphans.test.mjs) ----------------------

/** Flatten a nested locale JSON object into dot-notation leaf keys. */
export function flattenLocaleKeys(obj, prefix = '') {
  const out = []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenLocaleKeys(v, key))
    } else {
      out.push(key)
    }
  }
  return out
}

// t('key'), tString('key') — a word-boundary-guarded bare call
const CALL_RE = /\b(?:t|tString)\(\s*(['"])((?:(?!\1).)+)\1/g
// $t('key') — $ is a non-word char so \b doesn't apply before it
const DOLLAR_CALL_RE = /\$t\(\s*(['"])((?:(?!\1).)+)\1/g
// t(`prefix.${...`) / $t(`prefix.${...`) — captures the dynamic prefix, not a key
const DYNAMIC_RE = /\b(?:\$?t|tString)\(\s*`([^`]*)\$\{/g

/** Extract statically-referenced i18n keys from a source file's content. */
export function extractUsedKeys(content) {
  const keys = new Set()
  for (const re of [CALL_RE, DOLLAR_CALL_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(content))) keys.add(m[2])
  }
  return keys
}

/** Extract dynamic-key PREFIXES (e.g. `sales.events.${status}` -> "sales.events") so a
 * key reached only dynamically isn't flagged as a false-positive orphan. */
export function extractDynamicPrefixes(content) {
  const prefixes = new Set()
  DYNAMIC_RE.lastIndex = 0
  let m
  while ((m = DYNAMIC_RE.exec(content))) {
    const prefix = m[1].replace(/\.$/, '')
    if (prefix) prefixes.add(prefix)
  }
  return prefixes
}

function matchesDynamicPrefix(key, dynamicPrefixes) {
  for (const prefix of dynamicPrefixes) {
    if (key === prefix || key.startsWith(`${prefix}.`)) return true
  }
  return false
}

/**
 * Net-new orphans: a locale key used BEFORE the diff, with zero references AFTER, still
 * DEFINED in a locale file, and not reachable via a detected dynamic-key prefix.
 */
export function findNetNewOrphans({ localeKeys, usedBefore, usedAfter, dynamicPrefixes }) {
  const orphans = []
  for (const key of localeKeys) {
    if (!usedBefore.has(key)) continue // never used before this diff — pre-existing, out of scope
    if (usedAfter.has(key)) continue // still used — not orphaned
    if (matchesDynamicPrefix(key, dynamicPrefixes)) continue // reachable dynamically — false positive
    orphans.push(key)
  }
  return orphans.sort()
}

// ---- I/O (git + fs) --------------------------------------------------------------------

const SOURCE_EXT = new Set(['.vue', '.ts', '.js', '.mts', '.mjs'])
const EXCLUDE_DIR_RE = /(^|\/)(node_modules|\.nuxt|\.output|dist|_archive|retired)(\/|$)/

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function listTrackedFiles(ref) {
  const args = ref ? ['ls-tree', '-r', '--name-only', ref] : ['ls-files']
  return git(args).split('\n').filter(Boolean)
}

function isSourceFile(f) {
  return SOURCE_EXT.has(path.extname(f)) && !EXCLUDE_DIR_RE.test(f)
}

function isLocaleFile(f) {
  return /(^|\/)i18n\/locales\/[a-z]{2}\.json$/.test(f) && !EXCLUDE_DIR_RE.test(f)
}

function readAtRef(ref, file) {
  try {
    return git(['show', `${ref}:${file}`])
  } catch {
    return null // file didn't exist at ref
  }
}

function readWorkingTree(file) {
  const abs = path.join(ROOT, file)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf8')
}

function scanSourceFiles(files, readFn) {
  const used = new Set()
  const dynamicPrefixes = new Set()
  let scanned = 0
  for (const f of files) {
    const content = readFn(f)
    if (content == null) continue
    scanned++
    for (const k of extractUsedKeys(content)) used.add(k)
    for (const p of extractDynamicPrefixes(content)) dynamicPrefixes.add(p)
  }
  return { used, dynamicPrefixes, scanned }
}

function collectLocaleKeys(files, readFn) {
  const keys = new Set()
  let scanned = 0
  for (const f of files) {
    const content = readFn(f)
    if (content == null) continue
    scanned++
    let json
    try {
      json = JSON.parse(content)
    } catch {
      continue // malformed JSON isn't this check's concern
    }
    for (const k of flattenLocaleKeys(json)) keys.add(k)
  }
  return { keys, scanned }
}

function resolveBase(explicitBase) {
  if (explicitBase) return explicitBase
  try {
    return git(['rev-parse', 'HEAD~1']).trim()
  } catch {
    return null
  }
}

function fmtPrefixes(set) {
  return set.size ? [...set].sort().join(', ') : 'none'
}

function runDiffScoped(base) {
  const resolvedBase = resolveBase(base)
  if (!resolvedBase) {
    console.log('## i18n orphan check: skipped')
    console.log('No base commit to diff against (single-commit history) — nothing to compare.')
    return
  }

  const beforeSourceFiles = listTrackedFiles(resolvedBase).filter(isSourceFile)
  const afterSourceFiles = listTrackedFiles(null).filter(isSourceFile)
  const afterLocaleFiles = listTrackedFiles(null).filter(isLocaleFile)

  const before = scanSourceFiles(beforeSourceFiles, (f) => readAtRef(resolvedBase, f))
  const after = scanSourceFiles(afterSourceFiles, readWorkingTree)
  const locale = collectLocaleKeys(afterLocaleFiles, readWorkingTree)

  const dynamicPrefixes = new Set([...before.dynamicPrefixes, ...after.dynamicPrefixes])
  const orphans = findNetNewOrphans({
    localeKeys: locale.keys,
    usedBefore: before.used,
    usedAfter: after.used,
    dynamicPrefixes,
  })

  console.log('## i18n orphan check (diff-scoped, report-only)')
  console.log(`Base: ${resolvedBase.slice(0, 12)}\n`)
  console.log(
    `Scanned: ${before.scanned} source files @ base, ${after.scanned} source files @ working tree, ` +
      `${afterLocaleFiles.length} locale files, ${locale.keys.size} locale keys checked.`,
  )
  console.log(`Dynamic-key prefixes excluded: ${fmtPrefixes(dynamicPrefixes)}`)

  if (orphans.length === 0) {
    console.log('\n✅ No net-new orphaned i18n keys found.')
    return
  }

  console.log(
    `\n⚠️  ${orphans.length} net-new orphaned i18n key(s) — referenced before this diff, unreferenced now, still defined:`,
  )
  for (const k of orphans) console.log(`  - ${k}`)
  console.log(
    '\nThis is a report only — nothing was deleted. If these are genuinely dead, remove them from the locale files by hand.',
  )
}

function runFullSweep() {
  const files = listTrackedFiles(null)
  const sourceFiles = files.filter(isSourceFile)
  const localeFiles = files.filter(isLocaleFile)

  const { used, dynamicPrefixes, scanned } = scanSourceFiles(sourceFiles, readWorkingTree)
  const locale = collectLocaleKeys(localeFiles, readWorkingTree)

  const dead = [...locale.keys].filter((k) => !used.has(k) && !matchesDynamicPrefix(k, dynamicPrefixes)).sort()

  console.log('## i18n orphan check (--full, whole-repo sweep, report-only)\n')
  console.log(`Scanned: ${scanned} source files, ${locale.scanned} locale files, ${locale.keys.size} locale keys checked.`)
  console.log(`Dynamic-key prefixes excluded: ${fmtPrefixes(dynamicPrefixes)}`)
  console.log(`\nCandidates with zero static references anywhere in the repo: ${dead.length}`)
  console.log(
    '(Includes long-standing dead keys, not just net-new ones — inspect a sample before trusting it; a false ' +
      'positive here means the key is reached dynamically via a pattern this check does not recognize.)',
  )
  for (const k of dead.slice(0, 50)) console.log(`  - ${k}`)
  if (dead.length > 50) console.log(`  ... and ${dead.length - 50} more`)
}

function main() {
  const args = process.argv.slice(2)
  const fullMode = args.includes('--full')
  const baseIdx = args.indexOf('--base')
  const base = baseIdx !== -1 ? args[baseIdx + 1] : null

  if (fullMode) {
    runFullSweep()
  } else {
    runDiffScoped(base)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
