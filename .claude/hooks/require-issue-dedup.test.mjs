import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HOOK = fileURLToPath(new URL('./require-issue-dedup.mjs', import.meta.url))
const run = tool_input => spawnSync('node', [HOOK], { input: JSON.stringify({ tool_input }), encoding: 'utf8' })
const DEDUP = 'Dedup-checked: searched «x» → none'

test('epic without How to test is blocked', () => {
  const r = run({ method: 'create', labels: ['epic'], body: `Goal\n\n${DEDUP}` })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /How to test/)
})

test('epic with How to test passes', () => {
  const r = run({ method: 'create', labels: ['epic'], body: `Goal\n\n## 🧪 How to test\n1. Open it\n\n${DEDUP}` })
  assert.equal(r.status, 0)
})

test('non-epic issue is unchanged', () => {
  assert.equal(run({ method: 'create', labels: ['type:feat'], body: DEDUP }).status, 0)
})
