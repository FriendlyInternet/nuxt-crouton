import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldRunOnEvent } from './lib/automerge-trigger.mjs'

test('labeled + build:approved runs', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled', label: { name: 'build:approved' } }), true)
})

test('labeled + any other label is skipped', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled', label: { name: 'bug' } }), false)
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled' }), false)
})

test('synchronize and other events run', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'synchronize' }), true)
  assert.equal(shouldRunOnEvent('schedule', {}), true)
})

test('workflow subscribes to labeled', () => {
  const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  assert.match(wf, /types: \[opened, ready_for_review, synchronize, labeled\]/)
})
