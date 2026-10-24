#!/usr/bin/env node
/**
 * check-parked-tests.mjs — #1730: a parked test must link an issue, not an excuse.
 *
 * `packages/crouton-auth/tests/unit/composables/useTeam.test.ts` carried, for months:
 *
 *   // TODO: Better Auth nanostore mock complexity - tracked for future refactoring
 *   it.todo('should return currentTeam when active organization exists', ...)
 *
 * "Tracked for future refactoring" — tracked WHERE? No issue, no owner. Worse: the
 * diagnosis was wrong (#1703) — the code under test could never run at all, a product bug
 * that got filed as a test-harness excuse and sat unread because the comment sounded like a
 * known, benign limitation.
 *
 * This scans `packages` test directories for `it.todo` / `test.todo` / `it.skip` /
 * `test.skip` / `describe.skip` and flags any that carry no `#NNN` issue reference — either
 * on the call's own line(s), or in a contiguous `//` comment block immediately above it.
 *
 * Deliberately NOT a ban on parked tests (they're a legitimate way to record intent) — only
 * on an UNLINKED one whose stated reason discourages re-examination.
 *
 *   node scripts/check-parked-tests.mjs [--json] [paths...]
 *
 * Exits 1 when anything is flagged.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** A parked-test call, matched with its (it|test|describe) receiver + method. */
const CALL_RE = /\b(it|test)\.(todo|skip)\(|\b(describe)\.(skip)\(/g

const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', 'coverage', '.git'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|mts|js|mjs)$/

/** Recursively collect test files under a root, skipping build/vendor dirs. */
export function collectTestFiles(root, out = []) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) collectTestFiles(full, out)
    else if (TEST_FILE_RE.test(entry.name)) out.push(full)
  }
  return out
}

/** Every package's `tests/` dir — the scope the issue names. */
export function defaultRoots(packagesDir = 'packages') {
  let pkgs
  try {
    pkgs = readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return []
  }
  return pkgs
    .filter(e => e.isDirectory())
    .map(e => join(packagesDir, e.name, 'tests'))
    .filter(dir => {
      try { return statSync(dir).isDirectory() } catch { return false }
    })
}

/**
 * Does this parked-test call carry a `#NNN` issue reference, either inline (its own call —
 * which may span several lines, e.g. a trailing `/* see #1234 *\/`) or in a contiguous `//`
 * comment block immediately above it?
 */
export function hasIssueRef(lines, callLineIndex) {
  // 1. A contiguous block of `//` comment lines directly above the call.
  let i = callLineIndex - 1
  while (i >= 0 && /^\s*\/\//.test(lines[i])) {
    if (/#\d+/.test(lines[i])) return true
    i--
  }

  // 2. The call itself, which may span multiple lines before its parens balance.
  let depth = 0
  let j = callLineIndex
  const limit = Math.min(lines.length, callLineIndex + 20)
  do {
    const line = lines[j]
    if (/#\d+/.test(line)) return true
    for (const ch of line) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    j++
  } while (depth > 0 && j < limit)

  return false
}

/**
 * Find every parked-test call in `source` and report whether each links an issue.
 * Returns `{ line, kind, snippet, linked }[]` (1-indexed lines).
 */
export function findParkedTests(source) {
  const lines = source.split('\n')
  const results = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    CALL_RE.lastIndex = 0
    let match
    while ((match = CALL_RE.exec(line))) {
      const before = line.slice(0, match.index)
      if (before.includes('//')) continue // commented-out code, not a live parked test

      const kind = match[1] ? `${match[1]}.${match[2]}` : `${match[3]}.${match[4]}`
      results.push({
        line: i + 1,
        kind,
        snippet: line.trim(),
        linked: hasIssueRef(lines, i),
      })
    }
  }
  return results
}

/** Render the CLI report. */
export function formatReport(violations, scannedCount) {
  if (!violations.length) {
    return `✓ No unlinked parked tests (${scannedCount} test file(s) scanned)`
  }
  const lines = [`\n✖ ${violations.length} parked test(s) with no linked issue (#1730):\n`]
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line}`)
    lines.push(`    ${v.kind}(...) — no #NNN issue reference nearby.`)
    lines.push(`    ${v.snippet}`)
    lines.push('')
  }
  lines.push('  A parked test must link an issue — `it.todo(\'...\', /* see #1234 */)` or a')
  lines.push('  `// blocked-by: #1234` comment directly above it — and its title should state')
  lines.push('  the assertion it would make, not an excuse for why it doesn\'t. "Tracked for')
  lines.push('  future refactoring" with no number is not tracking.')
  return lines.join('\n')
}

function main(argv) {
  const explicit = argv.filter(a => !a.startsWith('--'))
  const roots = explicit.length ? explicit : defaultRoots()
  const files = roots.flatMap(r => {
    try {
      return statSync(r).isDirectory() ? collectTestFiles(r) : [r]
    } catch {
      return []
    }
  })

  const violations = []
  for (const file of files) {
    const found = findParkedTests(readFileSync(file, 'utf8'))
    const rel = relative(process.cwd(), file)
    for (const v of found) {
      if (!v.linked) violations.push({ file: rel.startsWith('..') ? file : rel, ...v })
    }
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ scanned: files.length, violations }, null, 2))
  } else {
    console.log(formatReport(violations, files.length))
  }

  return violations.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
