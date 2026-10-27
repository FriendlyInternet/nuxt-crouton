#!/usr/bin/env node
/**
 * ui-touched.mjs — did this change touch something you can SEE? (#2780)
 *
 * work-issue-pidev.yml holds a PR as a draft for visual sign-off when the diff is "visual". The
 * old test was a file-name match, so a comment edit in a `.vue` file or a dead key removed from
 * `app.config.ts` (PR #2720) waited for a sign-off nobody could give. The rule now:
 *
 *   - `.vue` / `.css` / `app/(components|layouts|pages)/**` → visual unless EVERY changed line is
 *     a whole-line comment (`//`, `/* *​/`, `<!-- -->`) or blank. Script-only edits still count:
 *     script can move layout.
 *   - `app.config.ts` → visual only if a changed line sits under a `ui:` key.
 *
 * Fails toward holding: if the diff can't be read, prints 1. Never toward skipping.
 *
 *   node scripts/ui-touched.mjs <base>..<head>     # prints 0 or 1
 *   node --test scripts/ui-touched.test.mjs
 *
 * Dependency-free (Node core only), like the other scripts the CI jobs run without install.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VISUAL_PATH = /\.(vue|css)$|\/app\/(components|layouts|pages)\//
const APP_CONFIG = /(^|\/)app\.config\.ts$/

/** A whole line that is only a comment or whitespace (block comments judged line by line). */
export function isCommentOrBlank(line) {
  const t = line.trim()
  if (t === '') return true
  if (/^(\/\/|\/\*|<!--|-->|\*\/)/.test(t)) return true
  // continuation line of a /* */ block: `* text` — but not the CSS universal selector `* {`
  if (/^\*(\s|$)/.test(t) && !/^\*\s*[{,:]/.test(t)) return true
  return false
}

/** Parse `git diff -U0` into [{ path, oldPath, changes: [{ side: 'old'|'new', n, text }] }]. */
export function parseDiff(diff) {
  const files = []
  let cur = null
  let oldN = 0
  let newN = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', oldPath: '', changes: [] }
      files.push(cur)
    } else if (!cur) continue
    else if (line.startsWith('--- ')) cur.oldPath = line.slice(4).replace(/^a\//, '')
    else if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '')
      cur.path = p === '/dev/null' ? cur.oldPath : p
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
      if (m) { oldN = Number(m[1]); newN = Number(m[2]) }
    } else if (line.startsWith('+')) cur.changes.push({ side: 'new', n: newN++, text: line.slice(1) })
    else if (line.startsWith('-')) cur.changes.push({ side: 'old', n: oldN++, text: line.slice(1) })
  }
  return files
}

const indentOf = s => s.length - s.trimStart().length

/** Is the 1-based line `n` of `lines` nested under a `ui:` key (by indentation)? */
export function underUiKey(lines, n) {
  let indent = indentOf(lines[n - 1] ?? '')
  if (/^\s*ui\s*:/.test(lines[n - 1] ?? '')) return true
  for (let i = n - 2; i >= 0 && indent > 0; i--) {
    const l = lines[i]
    if (l.trim() === '' || indentOf(l) >= indent) continue
    indent = indentOf(l)
    if (/^\s*ui\s*:/.test(l)) return true
  }
  return false
}

/** app.config.ts: visual only if a changed line sits under a `ui:` key (unreadable file → hold). */
function appConfigTouchesUi(f, getLines) {
  return f.changes.some(c => {
    const lines = getLines(c.side, f.path)
    // can't read the file → can't prove it's not visual → hold
    return !lines || underUiKey(lines, c.n)
  })
}

/** .vue / .css / app UI dirs: visual unless every changed line is a comment or blank. */
function visualFileChanged(f) {
  return f.changes.length === 0 || f.changes.some(c => !isCommentOrBlank(c.text))
}

function fileTouchesUi(f, getLines) {
  if (APP_CONFIG.test(f.path)) return appConfigTouchesUi(f, getLines)
  return VISUAL_PATH.test(f.path) && visualFileChanged(f)
}

/**
 * @param {string} diff `git diff -U0` output
 * @param {(side:'old'|'new', path:string) => string[] | null} getLines full file lines
 * @returns {0|1}
 */
export function uiTouched(diff, getLines) {
  return parseDiff(diff).some(f => fileTouchesUi(f, getLines)) ? 1 : 0
}

function main() {
  const range = process.argv[2]
  try {
    const [base, head = 'HEAD'] = range.split('..')
    const diff = execFileSync('git', ['diff', '-U0', '--no-color', `${base}..${head}`], { encoding: 'utf8', maxBuffer: 1 << 28 })
    const getLines = (side, path) => {
      try {
        const ref = side === 'old' ? base : head
        return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')
      } catch { return null }
    }
    console.log(uiTouched(diff, getLines))
  } catch {
    console.log(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
