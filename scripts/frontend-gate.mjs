#!/usr/bin/env node
/**
 * frontend-gate.mjs — decide the frontend-review check from the DIFF, not from one model line (#4071).
 *
 * The check used to go red or green on `frontend-review-verdict.json` → `highest`, a line the
 * reviewer writes with nothing tying it to the code. Now two things decide it:
 *
 *   1. Lint hits — `vue/no-restricted-html-elements` (eslint.frontend-gate.config.mjs) on a line
 *      the PR ADDS. Plain `<button>/<input>/<select>/<textarea>` already in the code never count.
 *   2. Counted reviewer findings — a `critical` finding counts only when the first line of its
 *      trimmed `quote` equals a trimmed added line in its `file` (the reported `line` first, then
 *      any added line of that file). Anything else is downgraded to a warning.
 *
 * Fails closed (R3): a `.vue` file ESLint could not parse, a missing/unreadable input, or ESLint
 * output with no result for a file that needed linting is exit 2 — never a silent pass. Whether
 * lint output is needed is decided here from the diff, so a failed lint step can't look like
 * "nothing to lint".
 *
 *   node scripts/frontend-gate.mjs --diff review-diff/pr.diff --eslint eslint-frontend.json \
 *     --verdict frontend-review-verdict.json [--out gate-verdict.json] [--root <repo>]
 *   exit 0 green · 1 red · 2 error (R3)
 *
 *   node --test scripts/frontend-gate.test.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parseDiff } from './ui-touched.mjs'

export const RULE = 'vue/no-restricted-html-elements'
const FIXTURES = /(?:^|\/)fixtures\//

const addedLines = file => new Map(file.changes.filter(c => c.side === 'new').map(c => [c.n, c.text]))
const toPosix = p => p.split(path.sep).join('/')
const isCritical = f => String(f?.severity ?? '').toLowerCase() === 'critical'
const criticalFindings = verdict => (Array.isArray(verdict?.findings) ? verdict.findings : []).filter(isCritical)
const firstLine = q => String(q ?? '').trim().split('\n')[0].trim()
const num = v => Number(v) || 0

/** The `.vue` files of a parsed diff that ESLint must have seen: not deleted, not fixtures. */
export function lintNeeded(files) {
  return files
    .filter(f => !f.isDeleted && f.path.endsWith('.vue') && !FIXTURES.test(f.path))
    .map(f => f.path)
}

/** Index ESLint results by repo-relative path; `{ error }` on the first fatal (unparseable) file. */
function resultsByFile(eslintJson, repoRoot) {
  const byFile = new Map()
  for (const r of eslintJson) {
    const rel = toPosix(path.relative(repoRoot, r?.filePath ?? ''))
    const fatal = (r?.messages ?? []).find(m => m.fatal)
    if (fatal) return { error: `${rel}:${fatal.line ?? 0} ESLint could not parse this file: ${fatal.message}` }
    byFile.set(rel, r)
  }
  return { byFile }
}

/** RULE messages of one ESLint result that sit on a line the diff adds to `file`. */
function hitsIn(file, result) {
  const added = addedLines(file)
  return (result.messages ?? [])
    .filter(m => m.ruleId === RULE && added.has(m.line))
    .map(m => ({ file: file.path, line: m.line, message: m.message }))
}

/**
 * Lint messages for RULE on an added line. ESLint's `filePath`s are absolute; they are made
 * relative to `repoRoot` before matching the diff's paths.
 * @returns {{ hits: {file: string, line: number, message: string}[] } | { error: string }} hits, or an R3 error
 */
export function lintHits(eslintJson, files, repoRoot) {
  if (!Array.isArray(eslintJson)) return { error: 'ESLint output is not a JSON array of results' }
  const indexed = resultsByFile(eslintJson, repoRoot)
  if (indexed.error) return indexed
  const needed = new Set(lintNeeded(files))
  const missing = [...needed].filter(p => !indexed.byFile.has(p))
  if (missing.length) return { error: `ESLint output has no result for: ${missing.join(', ')}` }
  return { hits: files.filter(f => needed.has(f.path)).flatMap(f => hitsIn(f, indexed.byFile.get(f.path))) }
}

/** The added line a finding's quote matches: the reported `line` first, else any added line. */
function matchLine(finding, files) {
  const quote = firstLine(finding.quote)
  const file = files.find(d => d.path === finding.file && !d.isDeleted)
  if (!quote || !file) return undefined
  const added = addedLines(file)
  if (added.get(Number(finding.line))?.trim() === quote) return Number(finding.line)
  return [...added].find(([, text]) => text.trim() === quote)?.[0]
}

/** Split the reviewer's `critical` findings into counted (quote matches an added line) and downgraded. */
export function countedFindings(verdict, files) {
  const counted = []
  const downgraded = []
  for (const f of criticalFindings(verdict)) {
    const matchedLine = matchLine(f, files)
    if (matchedLine === undefined) downgraded.push(f)
    else counted.push({ ...f, matchedLine })
  }
  return { counted, downgraded }
}

/** red on an error, a lint hit or a counted finding; else green. */
export function decide({ lint = [], counted = [], error } = {}) {
  return error || lint.length || counted.length ? 'red' : 'green'
}

/** The `--out` verdict: only lint hits + counted findings are `critical`; the rest is `warning`. */
export function gateVerdict(verdict, lint, counted, downgraded) {
  // A `critical` count with no quotable finding behind it is a warning too.
  const unlisted = Math.max(0, num(verdict?.critical) - criticalFindings(verdict).length)
  const critical = lint.length + counted.length
  const warning = num(verdict?.warning) + downgraded.length + unlisted
  const note = num(verdict?.note)
  const highest = ['critical', 'warning', 'note'].find(k => ({ critical, warning, note })[k]) ?? 'none'
  return { highest, critical, warning, note }
}

function readJson(file, label) {
  if (!file) throw new Error(`missing --${label}`)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`cannot read --${label} ${file}: ${e.message}`)
  }
}

/** Read every input the diff says is needed; throws on a missing/unreadable one (R3). */
function readInputs(values) {
  if (!values.diff) throw new Error('missing --diff')
  const files = parseDiff(readFileSync(values.diff, 'utf8'))
  const verdict = readJson(values.verdict, 'verdict')
  if (!lintNeeded(files).length) return { files, verdict, lint: [] }
  const res = lintHits(readJson(values.eslint, 'eslint'), files, values.root ?? process.cwd())
  if (res.error) throw new Error(res.error)
  return { files, verdict, lint: res.hits }
}

function report(log, { lint, counted, downgraded }) {
  for (const h of lint) log(`${h.file}:${h.line} lint ${RULE}: ${h.message}`)
  for (const c of counted) log(`${c.file}:${c.matchedLine} reviewer 🔴 ${c.rule ?? 'finding'}: ${c.quote}`)
  for (const d of downgraded) log(`downgraded (quote matches no added line): ${d.file ?? '?'}:${d.line ?? '?'} ${d.rule ?? ''} ${JSON.stringify(d.quote ?? '')}`)
}

/** CLI body; returns the exit code. */
export function main(argv, log = console.log) {
  const { values } = parseArgs({ args: argv, options: {
    diff: { type: 'string' }, eslint: { type: 'string' }, verdict: { type: 'string' },
    out: { type: 'string' }, root: { type: 'string' }
  } })
  let inputs
  try {
    inputs = readInputs(values)
  } catch (e) {
    log(`frontend-gate: error — ${e.message}`)
    return 2
  }
  const { files, verdict, lint } = inputs
  const { counted, downgraded } = countedFindings(verdict, files)
  report(log, { lint, counted, downgraded })
  const out = gateVerdict(verdict, lint, counted, downgraded)
  if (values.out) writeFileSync(values.out, `${JSON.stringify(out)}\n`)
  const word = decide({ lint, counted })
  log(`frontend-gate: ${word} — ${lint.length} lint hit(s), ${counted.length} counted 🔴, ${out.warning - num(verdict?.warning)} downgraded`)
  return word === 'red' ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
