#!/usr/bin/env node
/**
 * ui-touched.mjs — did this change touch something you can SEE? (#2780)
 *
 * work-issue-pidev.yml holds a PR as a draft for visual sign-off when the diff is "visual". The
 * old test was a file-name match, so a comment edit in a `.vue` file or a dead key removed from
 * `app.config.ts` (PR #2720) waited for a sign-off nobody could give. The rule now:
 *
 *   - `.vue` / `.css` / `app/(components|layouts|pages)/**` → visual unless EVERY changed line is
 *     a whole-line comment (`//`, `/* *​/`, `<!-- -->`) or blank, OR (`.vue` only, #3228) sits
 *     inside `<script>` / `<script setup>`. Template, style, unknown region, new or deleted
 *     `.vue` → visual. Removed lines are located in the MERGE-BASE text (patch old-side numbers).
 *   - `app.config.ts` → visual only if a changed line sits under a `ui:` key.
 *
 *   - `fixtures/**` → never visual (regenerated e2e output, #2852).
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
// Regenerated e2e fixture apps: generator output, never a surface a human signs off on (#2852).
const FIXTURE_PATH = /^fixtures\//
const APP_CONFIG = /(^|\/)app\.config\.ts$/

/**
 * Which lines of a file are WHOLE-line comments (or blank)? Scans top to bottom so multi-line
 * `<!-- -->` and block comments are tracked. A comment with text after its close, e.g.
 * `<!-- x --><UButton/>`, is visible content. `//` is a comment only in script (a `.vue`
 * `<script>` block, or a non-.vue/.css source file) -- in a template it is text.
 */
export function commentLines(lines, path) {
  const isVue = /\.vue$/.test(path)
  const st = { inHtml: false, inBlock: false, region: isVue ? 'template' : /\.css$/.test(path) ? 'style' : 'script' }
  return lines.map(raw => {
    const t = raw.trim()
    if (isVue && !st.inHtml && !st.inBlock) st.region = openRegion(t, st.region)
    const result = classify(t, st)
    if (isVue && !st.inHtml && !st.inBlock && /<\/(script|style)>/.test(t)) st.region = 'template'
    return result
  })
}

function openRegion(t, region) {
  if (/^<script\b/.test(t)) return 'script'
  if (/^<style\b/.test(t)) return 'style'
  return region
}

/** Text after `close` ends the comment on this line: whole-line comment only if nothing follows. */
function afterClose(t, close, from) {
  const k = t.indexOf(close, from)
  return k === -1 ? null : t.slice(k + close.length).trim() === ''
}

/** Is this trimmed line a whole-line comment/blank? Mutates the open-comment flags in `st`. */
function classify(t, st) {
  if (st.inHtml) return continueComment(t, '-->', st, 'inHtml')
  if (st.inBlock) return continueComment(t, '*/', st, 'inBlock')
  if (t === '') return true
  if (t.startsWith('<!--')) return startComment(t, '-->', 4, st, 'inHtml')
  if (t.startsWith('/*') && st.region !== 'template') return startComment(t, '*/', 2, st, 'inBlock')
  return t.startsWith('//') && st.region === 'script'
}

function continueComment(t, close, st, flag) {
  const r = afterClose(t, close, 0)
  if (r === null) return true
  st[flag] = false
  return r
}

function startComment(t, close, from, st, flag) {
  const r = afterClose(t, close, from)
  if (r === null) { st[flag] = true; return true }
  return r
}

/** Apply a `--- ` / `+++ ` header line to the current file entry. */
function readHeader(cur, line) {
  if (line.startsWith('--- ')) {
    cur.oldPath = line.slice(4).replace(/^a\//, '')
    cur.isNew = cur.oldPath === '/dev/null'
    return
  }
  const p = line.slice(4).replace(/^b\//, '')
  cur.isDeleted = p === '/dev/null'
  cur.path = cur.isDeleted ? cur.oldPath : p
  cur.isRenamed = !cur.isNew && !cur.isDeleted && cur.oldPath !== cur.path // a rename changes a tag/route
}

/** Parse `git diff -U0` into [{ path, oldPath, changes: [{ side: 'old'|'new', n, text }] }]. */
export function parseDiff(diff) {
  const files = []
  let cur = null
  let oldN = 0
  let newN = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', oldPath: '', isNew: false, isDeleted: false, isRenamed: false, changes: [] }
      files.push(cur)
    } else if (!cur) continue
    else if (line.startsWith('rename from ')) { cur.oldPath = line.slice(12); cur.isRenamed = true }
    else if (line.startsWith('rename to ')) { cur.path = line.slice(10); cur.isRenamed = true }
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) readHeader(cur, line)
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
      if (m) { oldN = Number(m[1]); newN = Number(m[2]) }
    } else if (line.startsWith(' ')) { oldN++; newN++ } // context line: advances both sides (#3228)
    else if (line.startsWith('+')) cur.changes.push({ side: 'new', n: newN++, text: line.slice(1) })
    else if (line.startsWith('-')) cur.changes.push({ side: 'old', n: oldN++, text: line.slice(1) })
  }
  return files
}

/** Per-line SFC region ('script' | 'style' | 'template') for a .vue file. */
export function vueRegions(lines) {
  let region = 'template'
  return lines.map(raw => {
    const t = raw.trim()
    region = openRegion(t, region)
    // the <script>/</script> tag lines themselves stay visual (#3228)
    const r = /^<\/?script\b/.test(t) || /<\/script>/.test(t) ? 'tag' : region
    if (/<\/(script|style)>/.test(t)) region = 'template'
    return r
  })
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

/** .vue / .css / app UI dirs: visual unless every changed line is a whole-line comment or blank. */
function visualFileChanged(f, getLines) {
  if (f.changes.length === 0) return true
  const isVue = /\.vue$/.test(f.path)
  if (isVue && (f.isNew || f.isDeleted || f.isRenamed)) return true
  const cache = {}
  const regions = {}
  return f.changes.some(c => {
    if (isVue) {
      if (!(c.side in regions)) {
        const lines = getLines(c.side, f.path)
        regions[c.side] = lines ? vueRegions(lines) : null
      }
      // #3228: a change inside <script> cannot be seen; unmappable line -> hold
      if (regions[c.side]?.[c.n - 1] === 'script') return false
    }
    if (!(c.side in cache)) {
      const lines = getLines(c.side, f.path)
      cache[c.side] = lines ? commentLines(lines, f.path) : null
    }
    // can't read the file -> can't prove it's a comment -> hold
    return !cache[c.side] || !cache[c.side][c.n - 1]
  })
}

function fileTouchesUi(f, getLines) {
  if (FIXTURE_PATH.test(f.path)) return false
  if (APP_CONFIG.test(f.path)) return appConfigTouchesUi(f, getLines)
  return VISUAL_PATH.test(f.path) && visualFileChanged(f, getLines)
}

/**
 * @param {string} diff `git diff -U0` output
 * @param {(side:'old'|'new', path:string) => string[] | null} getLines full file lines
 * @returns {0|1}
 */
export function uiTouched(diff, getLines) {
  return parseDiff(diff).some(f => fileTouchesUi(f, getLines)) ? 1 : 0
}

/**
 * Same verdict from GitHub `pulls.listFiles` entries (#3228) -- for status.yml, which has no checkout.
 * @param {{filename:string, patch?:string, status?:string, previous_filename?:string}[]} files
 * @param {(ref:'head'|'merge-base', path:string) => string | null | Promise<string|null>} readText
 *   'head' = PR head; 'merge-base' = merge base of base...head (patch old-side line numbers
 *   refer to it, NOT to the base tip).
 * @returns {Promise<0|1>}
 */
export async function uiTouchedFromFiles(files, readText) {
  try {
    let diff = ''
    const cache = {}
    for (const f of files) {
      const path = f.filename || ''
      if (!isCandidatePath(path)) continue
      if (!f.patch) return 1 // too large / binary: can't prove it's invisible
      diff += githubFileDiff(f)
      await cacheSides(cache, f, readText)
    }
    return uiTouched(diff, (side, path) => cache[`${side}:${path}`] ?? null)
  } catch {
    return 1
  }
}

/** A file worth diffing: visual path or app config, and not a fixture. */
export function isCandidatePath(path) {
  if (FIXTURE_PATH.test(path)) return false
  return VISUAL_PATH.test(path) || APP_CONFIG.test(path)
}

/** Rebuild a `git diff` section from a GitHub listFiles entry. */
export function githubFileDiff(f) {
  const path = f.filename || ''
  const oldPath = f.previous_filename || path
  const from = f.status === 'added' ? '/dev/null' : `a/${oldPath}`
  const to = f.status === 'removed' ? '/dev/null' : `b/${path}`
  return `diff --git a/${oldPath} b/${path}\n--- ${from}\n+++ ${to}\n${f.patch}\n`
}

async function cacheSides(cache, f, readText) {
  const path = f.filename || ''
  const oldPath = f.previous_filename || path
  for (const side of ['old', 'new']) {
    let text = null
    try { text = await readText(side === 'old' ? 'merge-base' : 'head', side === 'old' ? oldPath : path) } catch { text = null }
    cache[`${side}:${path}`] = typeof text === 'string' ? text.split('\n') : null
  }
}

function main() {
  const range = process.argv[2]
  try {
    const [base, head = 'HEAD'] = range.split('..')
    const diff = execFileSync('git', ['diff', '-U0', '--no-color', `${base}..${head}`], { encoding: 'utf8', maxBuffer: 1 << 28 })
    // patch old-side line numbers refer to the merge base (#3228), not the base tip
    let oldRef = base
    try { oldRef = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim() || base } catch { /* keep base */ }
    const getLines = (side, path) => {
      try {
        const ref = side === 'old' ? oldRef : head
        return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')
      } catch { return null }
    }
    console.log(uiTouched(diff, getLines))
  } catch {
    console.log(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
