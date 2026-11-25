/**
 * #3086 contract — every piece of code that removes `status:blocked` by name is marked with the
 * kind of hold it clears, and the list stays exactly what the on-issue-close.yml / on-pr-close.yml
 * headers name. A seventh remover fails here until it is marked and the headers are updated.
 * The two close-time strippers (`startsWith('status:')`) are not matched, on purpose.
 *
 *   node --test scripts/status-blocked-removers.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MARKER = 'status:blocked remover (#3086)'

function walk(dir, keep) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, keep))
    else if (keep(e.name)) out.push(p)
  }
  return out
}

/** Every `removeLabel…(` line naming status:blocked, and every name-loop over it that feeds one. */
function removers() {
  const files = [
    ...walk(join(ROOT, 'scripts'), (n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs')),
    ...walk(join(ROOT, '.github/workflows'), (n) => n.endsWith('.yml')),
  ]
  const hits = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => {
      const direct = /removeLabel\w*\(/.test(l) && l.includes("'status:blocked'")
      const loop = /for \(const \w+ of \[[^\]]*'status:blocked'[^\]]*\]\)/.test(l)
        && lines.slice(i + 1, i + 4).some((x) => /removeLabel\w*\(/.test(x))
      if (direct || loop) hits.push({ file: relative(ROOT, f), line: i + 1, above: lines[i - 1] || '' })
    })
  }
  return hits
}

// covers: T4
test('exactly six status:blocked removers, each marked with its kind of hold', () => {
  const hits = removers()
  const unmarked = hits.filter((h) => !h.above.includes(MARKER)).map((h) => `${h.file}:${h.line}`)
  assert.deepEqual(unmarked, [], 'add `// status:blocked remover (#3086): <kind of hold>` above each')
  assert.deepEqual(hits.map((h) => h.file).sort(), [
    '.github/workflows/on-comment.yml',
    '.github/workflows/on-comment.yml',
    '.github/workflows/on-pr-close.yml',
    'scripts/lib/pr-merge-gate-io.mjs',
    'scripts/plan-held.mjs',
    'scripts/traffic-control.mjs',
  ])
})
