// #3501: the `pipeline:v1` (any `pipeline:*`) label is read ONLY by the decomposer. Judged by BEHAVIOUR:
// every `issues: labeled` listener is inventoried, and the real `if:` / label map of each is evaluated.
// (A text grep for `pipeline:` would trip on comments such as status.yml's.) A new `issues: labeled`
// listener fails the inventory test until someone adds a behaviour case for it here.
// PR-label listeners: automerge-epic-subpr.yml (tested below) and packages-guard.yml (a read-only declaration check).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const DIR = new URL('../.github/workflows/', import.meta.url)
const read = (f) => readFileSync(new URL(f, DIR), 'utf8')

/** Lines of the `issues:` event block under `on:` (2-space layout), or null. */
function issuesBlock(text) {
  const lines = text.split('\n')
  const on = lines.findIndex((l) => /^["']?on["']?:/.test(l))
  if (on < 0) return null
  const rest = lines.slice(on + 1)
  const body = rest.slice(0, Math.max(0, rest.findIndex((l) => /^\S/.test(l))) || rest.length)
  const i = body.findIndex((l) => /^  issues:/.test(l))
  if (i < 0) return null
  const after = body.slice(i + 1)
  const end = after.findIndex((l) => /^  \S/.test(l))
  return end < 0 ? after : after.slice(0, end)
}
const labeledTypes = (blk) => {
  const m = blk.join('\n').match(/types:\s*\[([^\]]*)\]/)
  return m ? m[1].split(',').map((s) => s.trim().toLowerCase()) : []
}

test('inventory: the issues-labeled listeners are exactly label-router.yml and status.yml', () => {
  const hits = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).filter((f) => {
    const b = issuesBlock(read(f))
    return b && labeledTypes(b).includes('labeled')
  }).sort()
  assert.deepEqual(hits, ['label-router.yml', 'status.yml'])
})

test('label-router: pipeline:v1 never routes (work-this does)', () => {
  const m = read('label-router.yml').match(/\n    if: \|\n((?:      .*\n)+)/)
  const expr = m[1].replace(/\s+/g, ' ').trim().replace(/==/g, '===').replace(/!=/g, '!==')
  const run = (actor, label) => new Function('github', 'contains', 'fromJSON', `return !!(${expr})`)(
    { actor, event: { label: { name: label } } }, (a, b) => a.includes(b), JSON.parse)
  assert.equal(run('pmcp', 'pipeline:v1'), false)
  assert.equal(run('nuxt-harness[bot]', 'pipeline:v1'), false)
  assert.equal(run('pmcp', 'work-this'), true)
})

test('status.yml: pipeline:v1 moves no card', () => {
  const m = read('status.yml').match(/const labelToStatus = \(name\) => \{[\s\S]*?\n            \}\n/)
  assert.ok(m, 'labelToStatus not found')
  const labelToStatus = new Function(`${m[0]}; return labelToStatus`)()
  assert.equal(labelToStatus('pipeline:v1'), null)
  assert.equal(labelToStatus('status:blocked'), 'Blocked')
})

test('automerge (PR labels): pipeline:v1 skipped', () => {
  const m = read('automerge-epic-subpr.yml').match(/\n    if: >\n((?:      .*\n)+)/)
  const expr = m[1].replace(/\s+/g, ' ').trim().replace(/==/g, '===').replace(/!=/g, '!==')
  const run = (event) => new Function('github', `return !!(${expr})`)({ event_name: 'pull_request', event })
  assert.equal(run({ action: 'labeled', label: { name: 'pipeline:v1' } }), false)
  assert.equal(run({ action: 'labeled', label: { name: 'build:approved' } }), true)
})
