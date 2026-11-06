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

/** Every multi-line run:/script: block in one workflow or composite-action file. */
export function inlineBlocks(text, file) {
  const lines = text.split('\n')
  const blocks = []
  let job = file.includes('/actions/') ? 'runs' : '?'
  let inJobs = false
  let stepIdx = -1
  let stepName = null
  let stepId = null

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue }
    if (/^runs:\s*$/.test(l)) { job = 'runs'; stepIdx = -1; continue }
    if (inJobs) {
      const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(l)
      if (m) { job = m[1]; stepIdx = -1; stepName = null; stepId = null }
    }
    // a new step item
    const item = /^(\s*)- (.*)$/.exec(l)
    if (item && /^\s*steps:\s*$/.test(lines.slice(0, i).reverse().find(x => indentOf(x) < item[1].length && x.trim()) ?? '')) {
      stepIdx++; stepName = null; stepId = null
    }
    const idm = /^\s*(?:- )?id:\s*(.+?)\s*$/.exec(l)
    const nm = /^\s*(?:- )?name:\s*(.+?)\s*$/.exec(l)
    if (idm && stepIdx >= 0 && !stepId) stepId = idm[1]
    if (nm && stepIdx >= 0 && !stepName) stepName = nm[1].replace(/^['"]|['"]$/g, '')

    const h = HEADER.exec(l)
    if (!h) continue
    const keyIndent = h[1].length + (/^\s*- /.test(l) ? 2 : 0)
    let last = i
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue
      if (indentOf(lines[j]) > keyIndent - (/^\s*- /.test(l) ? 2 : 0) && indentOf(lines[j]) >= keyIndent) { last = j } else break
    }
    const count = last - i
    if (count < 2) continue
    // step id/name may come AFTER the run key; look ahead within the step
    let id = stepId, name = stepName
    for (let j = last + 1; j < lines.length; j++) {
      const t = lines[j]
      if (t.trim() && (/^\s*- /.test(t) && indentOf(t) < keyIndent || indentOf(t) < keyIndent - 2)) break
      const a = /^\s*id:\s*(.+?)\s*$/.exec(t); if (a && !id) id = a[1]
      const b = /^\s*name:\s*(.+?)\s*$/.exec(t); if (b && !name && indentOf(t) === keyIndent) name = b[1].replace(/^['"]|['"]$/g, '')
    }
    const step = id || name || `#${stepIdx}`
    blocks.push({ key: `${file} › ${job} › ${step} › ${h[2]}`, file, line: i + 1, kind: h[2], lines: count })
  }
  return blocks
}

/** Compare blocks to the baseline. failures are fatal; stale are advisory. */
export function check(blocks, baseline = {}, limit = LIMIT) {
  const failures = []
  const stale = []
  const seen = new Set()
  for (const b of blocks) {
    seen.add(b.key)
    const base = baseline[b.key]
    if (base === undefined) {
      if (b.lines > limit) failures.push(`${b.key}: new inline block of ${b.lines} lines (limit ${limit}) — move the logic into scripts/ with a test`)
    } else if (b.lines > base) {
      failures.push(`${b.key}: grew from ${base} to ${b.lines} lines — move logic out, or raise the baseline on purpose (--update)`)
    } else if (b.lines < base) {
      stale.push(`${b.key}: shrunk from ${base} to ${b.lines} — lower the baseline`)
    }
  }
  for (const k of Object.keys(baseline)) if (!seen.has(k)) stale.push(`${k}: gone — remove from baseline`)
  return { failures, stale }
}

export function scan(root = '.') {
  const files = []
  const wf = join(root, '.github/workflows')
  if (existsSync(wf)) for (const f of readdirSync(wf)) if (/\.ya?ml$/.test(f)) files.push(`.github/workflows/${f}`)
  const ac = join(root, '.github/actions')
  if (existsSync(ac)) for (const d of readdirSync(ac)) {
    for (const n of ['action.yml', 'action.yaml']) if (existsSync(join(ac, d, n))) files.push(`.github/actions/${d}/${n}`)
  }
  return files.sort().flatMap(f => inlineBlocks(readFileSync(join(root, f), 'utf8'), f))
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
