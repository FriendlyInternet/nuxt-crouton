// Contract for the e2e console guard (#2916). Run: node --test scripts/lib/console-guard.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import guard from '../../e2e/console-guard.cjs'

const { evaluate, formatFailures } = guard
const url = 'http://localhost:3000/admin/t/crouton/things'

test('a failed-to-resolve warning fails and names the component and the URL', () => {
  const f = evaluate([{ type: 'warning', text: '[Vue warn]: Failed to resolve component: Foo', url }])
  assert.equal(f.length, 1)
  const out = formatFailures(f)
  assert.match(out, /Foo/)
  assert.match(out, /things/)
})

test('a clean page passes', () => {
  assert.deepEqual(evaluate([]), [])
})

test('unrelated console noise does not fail', () => {
  assert.deepEqual(evaluate([
    { type: 'log', text: '[Vue warn]: Failed to resolve component: Foo', url },
    { type: 'info', text: 'hello', url },
    { type: 'warning', text: '[Vue warn]: something else', url }
  ]), [])
})

test('an uncaught page error fails', () => {
  assert.equal(evaluate([{ type: 'pageerror', text: 'boom', url }]).length, 1)
})

test('an allow-listed pattern is skipped', () => {
  const msgs = [{ type: 'error', text: '[Vue warn]: Failed to resolve component: Foo', url }]
  assert.deepEqual(evaluate(msgs, [{ pattern: 'component: Foo', reason: 'known' }]), [])
})
