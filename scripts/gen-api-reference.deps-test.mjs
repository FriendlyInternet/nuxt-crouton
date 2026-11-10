import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const run = () => spawnSync('node', ['scripts/gen-api-reference.mjs', '--check'], { encoding: 'utf8' })

// Needs `typescript` + `@vue/compiler-sfc`, so it runs in a job that installs packages (not the bare-Node set).
// Print stderr on a wrong exit code: the status alone hid the real error in CI.
const expectStatus = (r, want) => assert.equal(r.status, want, `exit ${r.status}, wanted ${want}. stderr:\n${r.stderr}`)

test('committed api-reference pages match the code', () => {
  expectStatus(run(), 0)
})

test('--check fails when a component prop is renamed', () => {
  const f = 'packages/crouton-core/app/components/ConfirmButton.vue'
  const orig = readFileSync(f, 'utf8')
  try {
    writeFileSync(f, orig.replace('confirmLabel?: string', 'confirmText?: string'))
    const r = run()
    expectStatus(r, 1)
    assert.match(r.stderr, /components\.md/)
  } finally {
    writeFileSync(f, orig)
  }
})
