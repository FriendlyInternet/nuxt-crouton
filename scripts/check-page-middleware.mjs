#!/usr/bin/env node
/**
 * check-page-middleware.mjs — guard the silent unctx gap behind #1839 (#1845).
 *
 * Nuxt binds its context only for the SYNCHRONOUS part of a route middleware. It
 * compensates with a build-time unctx transform that rewrites each `await` into an
 * `__executeAsync` / `__restore()` pair, re-binding the context afterwards. Which
 * entry points get that treatment is config (`@nuxt/schema`
 * `optimization.asyncTransforms`) — and unctx only descends into a property whose
 * value is DIRECTLY a function (`transform.mjs` → `transformFunctionBody` returns
 * early on anything that is not a Function/Arrow expression).
 *
 * So the array form is a blind spot:
 *
 *   defineNuxtRouteMiddleware(async () => …)              ✅ transformed
 *   definePageMeta({ middleware: async () => … })          ✅ transformed
 *   definePageMeta({ middleware: [async () => …] })        ❌ NOT transformed
 *
 * Only the last one loses the Nuxt instance across an `await`, and only during
 * SSR — so `navigateTo()` after the await throws "[nuxt] instance unavailable"
 * and the page 500s. It typechecks, it builds, and eslint does not run in CI, so
 * nothing else in the toolchain can see it. That is #1839: the root page 500'd for
 * every signed-in load, while presenting as if a DIFFERENT page were broken.
 *
 * A callback that re-binds the context itself (`nuxtApp.runWithContext(...)`) is
 * fine — that is the sanctioned fix — so it is not reported.
 *
 * Deliberately dependency-free (Node core only), because the `scripts-tests` and
 * `sync-validation` CI jobs run without `pnpm install`. That rules out a real
 * parser, so this works on a comment/string-masked copy of the source and matches
 * brackets by hand — accurate enough for a shape this specific, and it cannot be
 * fooled by braces inside strings or comments.
 *
 *   node scripts/check-page-middleware.mjs [--json] [paths...]
 *
 * Exits 1 when anything is flagged.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Roots scanned when no explicit paths are given. */
export const DEFAULT_ROOTS = ['apps', 'packages', 'pocs', 'fixtures']

const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', '.data', 'coverage', '.git'])

/** definePageMeta keys the unctx transform is configured to descend into. */
export const TRANSFORMED_KEYS = ['middleware', 'validate']

const OPENERS = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set([')', ']', '}'])

/**
 * Blank out comments and string/template literals, preserving length and newlines
 * so every offset still lines up with the original. Bracket matching then can't be
 * thrown off by a `}` inside a string or a commented-out block.
 *
 * @param {string} code
 * @returns {string}
 */
export function maskLiteralsAndComments(code) {
  const out = code.split('')
  const blank = (from, to) => {
    for (let k = Math.max(from, 0); k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  let i = 0
  while (i < code.length) {
    const span = literalSpanAt(code, i)
    if (!span) { i++; continue }
    blank(span.blankFrom, span.blankTo)
    i = span.next
  }
  return out.join('')
}

/**
 * If a comment or string literal starts at `i`, describe the region to blank and
 * where scanning resumes. Returns null when `i` is ordinary code.
 */
function literalSpanAt(code, i) {
  const two = code.slice(i, i + 2)
  if (two === '//') {
    const end = code.indexOf('\n', i)
    const stop = end === -1 ? code.length : end
    return { blankFrom: i, blankTo: stop, next: stop }
  }
  if (two === '/*') {
    const end = code.indexOf('*/', i + 2)
    const stop = end === -1 ? code.length : end + 2
    return { blankFrom: i, blankTo: stop, next: stop }
  }
  const quote = code[i]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  const close = closingQuote(code, i, quote)
  // Keep the quotes themselves so the code still reads as a literal; blank the body.
  return { blankFrom: i + 1, blankTo: close - 1, next: close }
}

/** Index just past the quote closing the literal opened at `open`. */
function closingQuote(code, open, quote) {
  let j = open + 1
  while (j < code.length) {
    if (code[j] === '\\') { j += 2; continue }
    if (code[j] === quote) return j + 1
    j++
  }
  return code.length
}

/**
 * Index of the bracket closing the one at `open`, or -1.
 *
 * @param {string} masked Output of maskLiteralsAndComments.
 * @param {number} open Index of an opening bracket.
 */
export function matchBracket(masked, open) {
  const want = OPENERS[masked[open]]
  if (!want) return -1
  const stack = [want]
  for (let i = open + 1; i < masked.length; i++) {
    const ch = masked[i]
    if (OPENERS[ch]) stack.push(OPENERS[ch])
    else if (CLOSERS.has(ch)) {
      if (stack[stack.length - 1] !== ch) return -1
      stack.pop()
      if (!stack.length) return i
    }
  }
  return -1
}

/** Split an array/argument body on its TOP-LEVEL commas. Returns [start, end) spans. */
function topLevelElements(masked, from, to) {
  const spans = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    const ch = masked[i]
    if (OPENERS[ch]) depth++
    else if (CLOSERS.has(ch)) depth--
    else if (ch === ',' && depth === 0) {
      spans.push([start, i])
      start = i + 1
    }
  }
  spans.push([start, to])
  return spans.filter(([a, b]) => masked.slice(a, b).trim().length > 0)
}

/**
 * Find async callbacks sitting inside the ARRAY form of a transformed
 * definePageMeta key, which therefore never receive the await-restore shim.
 *
 * Works on raw source (TypeScript included) — no parse step.
 *
 * @param {string} code
 * @returns {Array<{ key: string, index: number, protected: boolean }>}
 */
export function findUntransformedAsyncMiddleware(code) {
  const masked = maskLiteralsAndComments(code)
  const findings = []
  for (const { braceAt, braceEnd } of pageMetaObjects(masked)) {
    for (const key of TRANSFORMED_KEYS) {
      for (const [valueAt, arrayEnd] of arrayValuesFor(masked, key, braceAt, braceEnd)) {
        findings.push(...asyncElements(masked, key, valueAt, arrayEnd))
      }
    }
  }
  return findings
}

/** Spans of each `definePageMeta({ … })` object literal in the masked source. */
function pageMetaObjects(masked) {
  const objects = []
  const callRe = /\bdefinePageMeta\s*\(/g
  let call
  while ((call = callRe.exec(masked)) !== null) {
    const parenAt = call.index + call[0].length - 1
    const parenEnd = matchBracket(masked, parenAt)
    if (parenEnd === -1) continue
    const braceAt = masked.indexOf('{', parenAt)
    if (braceAt === -1 || braceAt > parenEnd) continue
    const braceEnd = matchBracket(masked, braceAt)
    if (braceEnd !== -1) objects.push({ braceAt, braceEnd })
  }
  return objects
}

/**
 * Spans of `key: [ … ]` values on the object literal spanning [braceAt, braceEnd].
 * The single-function form IS transformed by unctx, so only arrays are returned.
 */
function arrayValuesFor(masked, key, braceAt, braceEnd) {
  const spans = []
  const keyRe = new RegExp(`\\b${key}\\s*:`, 'g')
  keyRe.lastIndex = braceAt
  let keyMatch
  while ((keyMatch = keyRe.exec(masked)) !== null && keyMatch.index < braceEnd) {
    let valueAt = keyMatch.index + keyMatch[0].length
    while (valueAt < braceEnd && /\s/.test(masked[valueAt])) valueAt++
    if (masked[valueAt] !== '[') continue
    const arrayEnd = matchBracket(masked, valueAt)
    if (arrayEnd !== -1) spans.push([valueAt, arrayEnd])
  }
  return spans
}

/** Array elements that are async AND await — the shape that loses the context. */
function asyncElements(masked, key, valueAt, arrayEnd) {
  const findings = []
  for (const [start, end] of topLevelElements(masked, valueAt + 1, arrayEnd)) {
    const element = masked.slice(start, end)
    // An await is what loses the context; no await, no exposure.
    if (!/\basync\b/.test(element) || !/\bawait\b/.test(element)) continue
    findings.push({
      key,
      // Point at the callback itself, not the `[` it follows.
      index: start + (element.match(/^\s*/)?.[0].length ?? 0),
      // Re-binding explicitly is the sanctioned fix (#1839).
      protected: /runWithContext\s*\(/.test(element)
    })
  }
  return findings
}

/** Extract the `<script>` / `<script setup>` blocks of an SFC with their offsets. */
export function scriptBlocks(source) {
  const blocks = []
  const re = /<script\b[^>]*>/gi
  let open
  while ((open = re.exec(source)) !== null) {
    const start = open.index + open[0].length
    const close = source.indexOf('</script>', start)
    if (close === -1) continue
    blocks.push({ start, content: source.slice(start, close) })
    re.lastIndex = close
  }
  return blocks
}

/**
 * Scan one `.vue` source.
 *
 * @returns {Array<{ key: string, line: number, protected: boolean }>}
 */
export function scanSfc(source) {
  if (!source.includes('definePageMeta')) return []

  const findings = []
  for (const block of scriptBlocks(source)) {
    if (!block.content.includes('definePageMeta')) continue
    for (const finding of findUntransformedAsyncMiddleware(block.content)) {
      const absolute = block.start + finding.index
      findings.push({
        key: finding.key,
        protected: finding.protected,
        line: source.slice(0, absolute).split('\n').length
      })
    }
  }
  return findings
}

/** Recursively collect `.vue` files under a root, skipping build/vendor dirs. */
export function collectVueFiles(root, out = []) {
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
    if (entry.isDirectory()) collectVueFiles(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** Expand roots (dirs or explicit files) into the `.vue` files to scan. */
function resolveFiles(roots) {
  const files = []
  for (const root of roots) {
    try {
      if (statSync(root).isDirectory()) collectVueFiles(root, files)
      else files.push(root)
    } catch { /* a root that isn't present is not a failure */ }
  }
  return files
}

function report(violations, scanned) {
  if (!violations.length) {
    console.log(`✓ No untransformed async page middleware (${scanned} .vue files scanned)`)
    return
  }
  console.error(`\n✖ ${violations.length} untransformed async page middleware (#1839, #1845):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    async callback inside the ARRAY form of definePageMeta({ ${v.key}: [...] }).`)
    console.error('    unctx does not inject the await-restore shim here, so the Nuxt context is')
    console.error('    lost after the first `await` and navigateTo() throws "[nuxt] instance')
    console.error('    unavailable" during SSR — that request 500s.')
    console.error('')
  }
  console.error('  Fix: capture `const nuxtApp = useNuxtApp()` BEFORE the await and issue the')
  console.error('  post-await navigation via `nuxtApp.runWithContext(() => navigateTo(...))`.')
  console.error('  See apps/kassa/app/pages/index.vue for the worked example.\n')
}

function main(argv) {
  const paths = argv.filter(a => !a.startsWith('--'))
  const files = resolveFiles(paths.length ? paths : DEFAULT_ROOTS)

  const violations = []
  for (const file of files) {
    for (const finding of scanSfc(readFileSync(file, 'utf8'))) {
      if (finding.protected) continue
      const rel = relative(process.cwd(), file)
      violations.push({ file: rel.startsWith('..') ? file : rel, ...finding })
    }
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ scanned: files.length, violations }, null, 2))
  } else {
    report(violations, files.length)
  }

  return violations.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
