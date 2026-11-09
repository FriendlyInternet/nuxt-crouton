import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { findViolations, scanRepo } from './check-collection-body-validation.mjs'

const P = 'packages/x/collections/a/server/api/teams/[id]/x-a'

test('a route reading the raw body is reported', () => {
  const v = findViolations({ [`${P}/index.post.ts`]: 'const b = await readBody(event)' }, {})
  assert.equal(v.length, 1)
})

test('a route using readValidatedBody is clean', () => {
  assert.deepEqual(findViolations({ [`${P}/[aId].patch.ts`]: 'await readValidatedBody(event, s.parse)' }, {}), [])
})

test('allow-listed path is clean; one that validates or is gone is reported', () => {
  const path = `${P}/index.post.ts`
  assert.deepEqual(findViolations({ [path]: 'readBody(event)' }, { [path]: 'why' }), [])
  assert.equal(findViolations({ [path]: 'readValidatedBody(e, p)' }, { [path]: 'why' }).length, 1)
  assert.equal(findViolations({ [path]: null }, { [path]: 'why' }).length, 1)
  assert.equal(findViolations({}, { [path]: 'why' }).length, 1)
})

test('reorder/move routes are ignored', () => {
  assert.deepEqual(findViolations({
    [`${P}/reorder.patch.ts`]: 'readBody(e)',
    [`${P}/move.patch.ts`]: 'readBody(e)'
  }, {}), [])
})

test('the real repo: every package collection create/edit route validates its body', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files = scanRepo(root)
  assert.ok(Object.keys(files).length >= 12, 'scan found the package routes (not a silent no-op)')
  assert.deepEqual(findViolations(files), [])
})
