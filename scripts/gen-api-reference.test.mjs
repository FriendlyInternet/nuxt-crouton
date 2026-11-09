import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const run = () => spawnSync('node', ['scripts/gen-api-reference.mjs', '--check'], { encoding: 'utf8' })

test('committed api-reference pages match the code', () => {
  assert.equal(run().status, 0)
})

test('--check fails when a component prop is renamed', () => {
  const f = 'packages/crouton-core/app/components/ConfirmButton.vue'
  const orig = readFileSync(f, 'utf8')
  try {
    writeFileSync(f, orig.replace('confirmLabel?: string', 'confirmText?: string'))
    const r = run()
    assert.equal(r.status, 1)
    assert.match(r.stderr, /components\.md/)
  } finally {
    writeFileSync(f, orig)
  }
})
