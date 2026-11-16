#!/usr/bin/env node
/**
 * Runtime-cost check, part 1 (#3910, epic #3896).
 *
 * Counts two patterns in every `.vue` template under packages/, apps/, pocs/:
 *   A · overlay per item — a UPopover/UTooltip/UModal/USlideover/UDrawer/UDropdownMenu/
 *       UContextMenu under a `v-for` (on itself or an ancestor) or under a per-item slot
 *       (`#…-cell`, `#day`, `#week-day`, `#item…`, `#option…`, `#row…`, `#cell…`).
 *   B · hover-only — a static class list that hides an element and reveals it only on
 *       hover (no matching `pointer-coarse:` reveal), or `<UPopover mode="hover">` without
 *       `enable-touch`.
 *
 * On a PR (`--base-ref <branch>`) it fails when a changed `.vue` file has more hits of a
 * kind at HEAD than the same file (or its pre-rename path) had at the merge-base. Without
 * a base ref it only prints totals. Always prints `[runtime-cost] files=… A=… B=… allowed=…`.
 *
 * Allow comment: `<!-- runtime-cost-ok: <reason, ≥10 chars> -->` as the hit's previous sibling.
 *
 * Only `node:` imports at the top; `@vue/compiler-sfc` is loaded inside main() so the pure
 * helpers stay importable (same pattern as verify-touched-compiles.mjs).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const OVERLAYS = new Set(['UPopover', 'UTooltip', 'UModal', 'USlideover', 'UDrawer', 'UDropdownMenu', 'UContextMenu'])
const NODE_ELEMENT = 1
const NODE_TEXT = 2
const NODE_COMMENT = 3
const PROP_ATTR = 6
const PROP_DIR = 7

/** Hide class → the regex its reveal utility must match. */
const HIDE_PAIRS = [
  [/^opacity-0$/, /^opacity-(?!0$)\d+$/],
  [/^invisible$/, /^visible$/],
  [/^hidden$/, /^(block|inline-block|inline|flex|inline-flex|grid)$/],
  [/^w-0$/, /^w-(?!0$).+/],
  [/^max-w-0$/, /^max-w-(?!0$).+/],
  [/^h-0$/, /^h-(?!0$).+/],
]
const HOVER_PREFIX = /^(hover:|group-hover:|group-hover\/[^:]+:)/
const ALLOW_RE = /^runtime-cost-ok:(.*)$/s

export const A_HINT = 'Use one shared overlay, or add <!-- runtime-cost-ok: <reason> --> on the line above if the list is short and capped.'
export const B_HINT = 'Add a pointer-coarse: class or a tap/focus path.'
export const GENERATED_HINT = 'generated file: change the generator template, then regenerate'

/** True when a static slot name looks like it renders once per item. */
export function isPerItemSlot(name) {
  return name.endsWith('-cell') || name === 'day' || name === 'week-day' || /^(item|option|row|cell)/.test(name)
}

function staticAttr(node, name) {
  return node.props.find(p => p.type === PROP_ATTR && p.name === name)
}

function hasProp(node, name) {
  return node.props.some(p =>
    (p.type === PROP_ATTR && p.name === name)
    || (p.type === PROP_DIR && p.name === 'bind' && p.arg?.isStatic && p.arg.content === name))
}

/** The scope label a node opens (v-for or per-item slot), or null. */
function scopeLabel(node) {
  const line = node.loc.start.line
  if (node.props.some(p => p.type === PROP_DIR && p.name === 'for')) return `v-for@${line}`
  if (node.tag === 'template') {
    const slot = node.props.find(p => p.type === PROP_DIR && p.name === 'slot' && p.arg?.isStatic)
    if (slot && isPerItemSlot(slot.arg.content)) return `#${slot.arg.content}@${line}`
  }
  return null
}

/** Why a node is hover-only, or null. At most one reason per element. */
export function hoverOnlyReason(node) {
  const cls = staticAttr(node, 'class')?.value?.content
  if (cls) {
    const list = cls.split(/\s+/).filter(Boolean)
    const set = new Set(list)
    for (const [hide, reveal] of HIDE_PAIRS) {
      const hider = list.find(c => hide.test(c))
      if (!hider) continue
      const reveals = list
        .filter(c => HOVER_PREFIX.test(c))
        .map(c => c.replace(HOVER_PREFIX, ''))
        .filter(u => reveal.test(u))
      if (reveals.length === 0) continue
      if (reveals.every(u => set.has(`pointer-coarse:${u}`))) continue
      return `${hider} revealed only by ${list.find(c => HOVER_PREFIX.test(c) && reveal.test(c.replace(HOVER_PREFIX, '')))}`
    }
  }
  if (node.tag === 'UPopover' && staticAttr(node, 'mode')?.value?.content === 'hover' && !hasProp(node, 'enable-touch')) {
    return 'mode="hover" without enable-touch'
  }
  return null
}

/** True when the node's previous non-whitespace sibling is a valid allow comment. */
function isAllowed(siblings, index) {
  for (let i = index - 1; i >= 0; i--) {
    const s = siblings[i]
    if (s.type === NODE_TEXT && !s.content.trim()) continue
    if (s.type !== NODE_COMMENT) return false
    const m = s.content.trim().match(ALLOW_RE)
    return Boolean(m && m[1].trim().length >= 10)
  }
  return false
}

/**
 * Count one file's hits. `parse` is `@vue/compiler-sfc`'s parse.
 * @returns {{ A: {line:number,tag:string,under:string}[], B: {line:number,tag:string,why:string}[], allowed: number, unparsable: boolean }}
 */
export function countHits(source, parse) {
  const out = { A: [], B: [], allowed: 0, unparsable: false }
  const { descriptor, errors } = parse(source, { templateParseOptions: { comments: true } })
  if (errors && errors.length > 0) {
    out.unparsable = true
    return out
  }
  const ast = descriptor?.template?.ast
  if (!ast) return out
  const walk = (children, under) => {
    children.forEach((node, i) => {
      if (node.type !== NODE_ELEMENT) return
      const scope = scopeLabel(node) || under
      const line = node.loc.start.line
      const allowed = isAllowed(children, i)
      if (OVERLAYS.has(node.tag) && scope) {
        if (allowed) out.allowed++
        else out.A.push({ line, tag: node.tag, under: scope })
      }
      const why = hoverOnlyReason(node)
      if (why) {
        if (allowed) out.allowed++
        else out.B.push({ line, tag: node.tag, why })
      }
      walk(node.children || [], scope)
    })
  }
  walk(ast.children || [], null)
  return out
}

/**
 * Files whose A or B count went up. `baseCounts`/`headCounts` map path → countHits result;
 * `renames` maps new path → old path. A missing base means 0.
 */
export function compare(baseCounts, headCounts, renames = {}) {
  const regressions = []
  for (const [file, head] of Object.entries(headCounts)) {
    const base = baseCounts[renames[file] ?? file]
    for (const kind of ['A', 'B']) {
      const b = base ? base[kind].length : 0
      const h = head[kind].length
      if (h > b) regressions.push({ file, kind, base: b, head: h, hits: head[kind] })
    }
  }
  return regressions
}

/** Parse `git diff -M -z --name-status` output into { path, old } entries (A/M/R, .vue under the three roots). */
export function parseNameStatus(raw) {
  const parts = raw.split('\0').filter(Boolean)
  const entries = []
  let i = 0
  while (i < parts.length) {
    const kind = parts[i][0]
    const paths = parts.slice(i + 1, i + 1 + (PATHS_PER_STATUS[kind] ?? 1))
    i += 1 + paths.length
    entries.push(ENTRY_FOR_STATUS[kind]?.(paths) ?? null)
  }
  return entries.filter(e => e && isScanned(e.path))
}

/** Renames and copies carry two NUL-separated paths (old, new); every other status one. */
const PATHS_PER_STATUS = { R: 2, C: 2 }
/** Only added, modified and renamed files are compared; `old` is the path to read at the base. */
const ENTRY_FOR_STATUS = {
  A: ([path]) => ({ path, old: null }),
  M: ([path]) => ({ path, old: path }),
  R: ([old, path]) => ({ path, old }),
  C: ([, path]) => ({ path, old: null }),
}

export function isScanned(path) {
  return Boolean(path) && path.endsWith('.vue') && /^(packages|apps|pocs)\//.test(path)
}

function isGenerated(source) {
  return source.split('\n').slice(0, 5).some(l => l.includes('@crouton-generated'))
}

/** Totals over every head file's counts. */
export function summarize(headCounts) {
  const totals = { A: 0, B: 0, allowed: 0, unparsable: [] }
  for (const [file, c] of Object.entries(headCounts)) {
    totals.A += c.A.length
    totals.B += c.B.length
    totals.allowed += c.allowed
    if (c.unparsable) totals.unparsable.push(file)
  }
  return totals
}

/**
 * Decide what one changed file contributes: a failure (unparsable at head), a warning
 * (unparsable at base — comparison skipped), or a head entry plus its base count.
 */
export function classifyChange({ path, old }, head, readBase, parse) {
  if (head.unparsable) return { failure: `${path}: does not parse — fix the template so it can be checked` }
  const baseSrc = old ? readBase(old) : null
  if (baseSrc === null) return { head }
  const base = countHits(baseSrc, parse)
  if (base.unparsable) return { warning: `[runtime-cost] warning: ${old} does not parse at the base — skipping the comparison for ${path}` }
  return { head, base, old }
}

/** The output lines for one regression (header, each new hit, the hint). */
export function formatRegression(r, source = '') {
  const hit = r.kind === 'A'
    ? h => `  ${r.file}:${h.line} ${h.tag} under ${h.under}`
    : h => `  ${r.file}:${h.line} ${h.tag} ${h.why}`
  const lines = [`${r.file}: ${r.kind} ${r.base} → ${r.head}`, ...r.hits.map(hit), `  ${r.kind === 'A' ? A_HINT : B_HINT}`]
  if (isGenerated(source)) lines.push(`  ${GENERATED_HINT}`)
  return lines
}

/**
 * Compare the changed files against the base. `readBase(oldPath)` returns the base text or
 * null. Returns { failures, warnings } as printable lines.
 */
export function checkChanged(changed, headCounts, readBase, parse) {
  const failures = []
  const warnings = []
  const changedHead = {}
  const baseCounts = {}
  const renames = {}
  for (const entry of changed.filter(e => headCounts[e.path])) {
    const c = classifyChange(entry, headCounts[entry.path], readBase, parse)
    if (c.failure) failures.push(c.failure)
    if (c.warning) warnings.push(c.warning)
    if (c.head) changedHead[entry.path] = c.head
    if (c.base) { baseCounts[c.old] = c.base; renames[entry.path] = c.old }
  }
  for (const r of compare(baseCounts, changedHead, renames)) failures.push(...formatRegression(r, changedHead[r.file].source))
  return { failures, warnings }
}

// ── runtime (skipped when imported, e.g. by the test) ────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()

async function main() {
  const baseRef = argValue(process.argv.slice(2), '--base-ref')
  const { parse } = await import('@vue/compiler-sfc')
  const { root, git } = repoGit()
  const files = git('ls-files', '-z', '--', 'packages/*.vue', 'apps/*.vue', 'pocs/*.vue').split('\0').filter(isScanned)
  const headCounts = readHeadCounts(root, files, parse)
  const totals = summarize(headCounts)
  console.log(`[runtime-cost] files=${files.length} A=${totals.A} B=${totals.B} allowed=${totals.allowed} unparsable=${totals.unparsable.length}`)
  if (!baseRef) return printUnparsable(totals.unparsable)

  const base = git('merge-base', `origin/${baseRef}`, 'HEAD').trim()
  const changed = parseNameStatus(git('diff', '-M', '-z', '--name-status', base, 'HEAD'))
  const readBase = old => readAtBase(git, base, old)
  const result = checkChanged(changed, headCounts, readBase, parse)
  for (const w of result.warnings) console.log(w)
  if (result.failures.length) fail(result.failures)
  console.log(`[runtime-cost] ok — ${changed.length} changed .vue file(s), no file gained hits`)
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i === -1 ? '' : String(argv[i + 1] ?? '').trim()
}

/** Git bound to the repo that contains the current folder (not the script's folder). */
function repoGit() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { root, git }
}

function readHeadCounts(root, files, parse) {
  const headCounts = {}
  for (const f of files) {
    const source = readFileSync(join(root, f), 'utf8')
    headCounts[f] = { ...countHits(source, parse), source }
  }
  return headCounts
}

function readAtBase(git, base, old) {
  try { return git('show', `${base}:${old}`) } catch { return null }
}

function printUnparsable(files) {
  for (const f of files) console.log(`[runtime-cost] unparsable (not checked): ${f}`)
}

function fail(lines) {
  console.log('[runtime-cost] FAILED — this PR adds per-item overlays or hover-only controls:')
  for (const l of lines) console.log(l)
  process.exit(1)
}
