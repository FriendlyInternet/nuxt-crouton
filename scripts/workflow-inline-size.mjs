#!/usr/bin/env node
// Inline workflow block size check (#3452).
//
// Decision logic belongs in scripts/*.mjs with a test, not in a `run:` / `script:` block.
// A NEW block over LIMIT lines fails; a baselined block may not GROW. Shrunk/removed
// baseline entries are printed (never fatal) so the baseline can be lowered.
//
// Dependency-free (no YAML parser): node-checks runs with no install. Relies on the
// repo's uniform 2-space layout.
//
//   node scripts/workflow-inline-size.mjs            # check
//   node scripts/workflow-inline-size.mjs --update   # rewrite the baseline from the tree
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIMIT = 40
const BASELINE = fileURLToPath(new URL('./workflow-inline-size.baseline.json', import.meta.url))
const HEADER = /^(\s*)(?:- )?(run|script):\s*[|>][-+0-9]*\s*$/
const indentOf = (l) => l.length - l.trimStart().length

const stripQuotes = (v) => v.replace(/^['"]|['"]$/g, '')
const isStepItem = (lines, i, item) => /^\s*steps:\s*$/.test(
  lines.slice(0, i).reverse().find(x => indentOf(x) < item[1].length && x.trim()) ?? '')

/** Update job/step tracking for one line (mutates `st`). */
function trackScope(st, lines, i) {
  const l = lines[i]
  if (/^jobs:\s*$/.test(l)) { st.inJobs = true; return true }
  if (/^runs:\s*$/.test(l)) { st.job = 'runs'; st.stepIdx = -1; return true }
  const m = st.inJobs ? /^  ([A-Za-z0-9_-]+):\s*$/.exec(l) : null
  if (m) Object.assign(st, { job: m[1], stepIdx: -1, stepName: null, stepId: null })
  const item = /^(\s*)- (.*)$/.exec(l)
  if (item && isStepItem(lines, i, item)) Object.assign(st, { stepIdx: st.stepIdx + 1, stepName: null, stepId: null })
  const idm = /^\s*(?:- )?id:\s*(.+?)\s*$/.exec(l)
  const nm = /^\s*(?:- )?name:\s*(.+?)\s*$/.exec(l)
  if (idm && st.stepIdx >= 0 && !st.stepId) st.stepId = idm[1]
  if (nm && st.stepIdx >= 0 && !st.stepName) st.stepName = stripQuotes(nm[1])
  return false
}

/** Index of the last line belonging to the block whose header is at line i. */
function blockEnd(lines, i, keyIndent, isItem) {
  let last = i
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') continue
    const ind = indentOf(lines[j])
    if (ind > keyIndent - (isItem ? 2 : 0) && ind >= keyIndent) last = j
    else break
  }
  return last
}

/** Step id/name may come AFTER the run key; look ahead within the step. */
function stepLabel(st, lines, last, keyIndent) {
  let id = st.stepId
  let name = st.stepName
  for (let j = last + 1; j < lines.length; j++) {
    const t = lines[j]
    const leavesStep = /^\s*- /.test(t) && indentOf(t) < keyIndent || indentOf(t) < keyIndent - 2
    if (t.trim() && leavesStep) break
    const a = /^\s*id:\s*(.+?)\s*$/.exec(t)
    if (a && !id) id = a[1]
    const b = /^\s*name:\s*(.+?)\s*$/.exec(t)
    if (b && !name && indentOf(t) === keyIndent) name = stripQuotes(b[1])
  }
  return id || name || `#${st.stepIdx}`
}

/** Every multi-line run:/script: block in one workflow or composite-action file. */
export function inlineBlocks(text, file) {
  const lines = text.split('\n')
  const blocks = []
  const st = { job: file.includes('/actions/') ? 'runs' : '?', inJobs: false, stepIdx: -1, stepName: null, stepId: null }
  for (let i = 0; i < lines.length; i++) {
    if (trackScope(st, lines, i)) continue
    const h = HEADER.exec(lines[i])
    if (!h) continue
    const isItem = /^\s*- /.test(lines[i])
    const keyIndent = h[1].length + (isItem ? 2 : 0)
    const last = blockEnd(lines, i, keyIndent, isItem)
    const count = last - i
    if (count < 2) continue
    const step = stepLabel(st, lines, last, keyIndent)
    blocks.push({ key: `${file} › ${st.job} › ${step} › ${h[2]}`, file, line: i + 1, kind: h[2], lines: count })
  }
  return blocks
}

/** Verdict for one block against the baseline: `{ fail }`, `{ stale }` or `{}`. */
function judge(b, base, limit) {
  if (base === undefined) {
    return b.lines > limit ? { fail: `${b.key}: new inline block of ${b.lines} lines (limit ${limit}) — move the logic into scripts/ with a test` } : {}
  }
  if (b.lines > base) return { fail: `${b.key}: grew from ${base} to ${b.lines} lines — move logic out, or raise the baseline on purpose (--update)` }
  if (b.lines < base) return { stale: `${b.key}: shrunk from ${base} to ${b.lines} — lower the baseline` }
  return {}
}

/** Compare blocks to the baseline. failures are fatal; stale are advisory. */
export function check(blocks, baseline = {}, limit = LIMIT) {
  const verdicts = blocks.map(b => judge(b, baseline[b.key], limit))
  const seen = new Set(blocks.map(b => b.key))
  return {
    failures: verdicts.map(v => v.fail).filter(Boolean),
    stale: [
      ...verdicts.map(v => v.stale).filter(Boolean),
      ...Object.keys(baseline).filter(k => !seen.has(k)).map(k => `${k}: gone — remove from baseline`),
    ],
  }
}

const listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : [])

function workflowFiles(root) {
  const wf = listDir(join(root, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)).map(f => `.github/workflows/${f}`)
  const ac = listDir(join(root, '.github/actions')).flatMap(d =>
    ['action.yml', 'action.yaml'].filter(n => existsSync(join(root, '.github/actions', d, n))).map(n => `.github/actions/${d}/${n}`))
  return [...wf, ...ac].sort()
}

export function scan(root = '.') {
  return workflowFiles(root).flatMap(f => inlineBlocks(readFileSync(join(root, f), 'utf8'), f))
}

export function loadBaseline(path = BASELINE) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { limit: LIMIT, blocks: {} }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const blocks = scan('.')
  if (blocks.length === 0) { console.error('workflow-inline-size: scanned 0 blocks — layout assumption broken'); process.exit(1) }
  if (process.argv.includes('--update')) {
    const entries = {}
    for (const b of blocks.filter(b => b.lines > LIMIT).sort((a, b) => a.key.localeCompare(b.key))) entries[b.key] = b.lines
    writeFileSync(BASELINE, JSON.stringify({
      $comment: `Inline run:/script: blocks over ${LIMIT} lines that predate #3452. Logic belongs in scripts/*.mjs with a test. New blocks over the limit fail CI; baselined ones may not grow. Regenerate: node scripts/workflow-inline-size.mjs --update`,
      limit: LIMIT,
      blocks: entries,
    }, null, 2) + '\n')
    console.log(`baseline written: ${Object.keys(entries).length} entries`)
    process.exit(0)
  }
  const base = loadBaseline()
  const { failures, stale } = check(blocks, base.blocks, base.limit ?? LIMIT)
  for (const s of stale) console.log(`note: ${s}`)
  for (const f of failures) console.error(`FAIL: ${f}`)
  console.log(`checked ${blocks.length} blocks, ${Object.keys(base.blocks).length} baselined`)
  process.exit(failures.length ? 1 : 0)
}
