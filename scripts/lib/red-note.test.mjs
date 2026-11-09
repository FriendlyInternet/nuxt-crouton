import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusScope, causesOf, redNoteAction, rollupChildNote } from './red-note.mjs'

const f = (...n) => n.map(name => ({ name }))

test('statusScope', () => {
  assert.equal(statusScope({ head: 'work-12', base: 'epic/1-x' }), 'leaf')
  assert.equal(statusScope({ head: 'epic/227-forms', base: 'main' }), 'epic')
  assert.equal(statusScope({ head: 'epic/227-forms', base: 'epic/1-x' }), null)
  assert.equal(statusScope({ head: 'epic/abc', base: 'main' }), null)
  assert.equal(statusScope({ head: 'feature/x', base: 'main' }), null)
  assert.equal(statusScope({ head: 'main', base: 'main' }), null)
})

test('causesOf', () => {
  assert.deepEqual(causesOf(f('CI Gate', 'Type Check Apps', 'Test Suite')).map(x => x.name), ['Type Check Apps', 'Test Suite'])
  assert.deepEqual(causesOf(f('CI Gate')).map(x => x.name), ['CI Gate'])
  assert.deepEqual(causesOf([]), [])
})

test('redNoteAction', () => {
  assert.equal(redNoteAction({ scope: 'leaf', failing: f('Test Suite') }), 'create')
  assert.equal(redNoteAction({ scope: 'leaf', failing: f('Test Suite'), existingForSha: true }), 'update')
  assert.equal(redNoteAction({ scope: 'epic', failing: f('CI Gate', 'Type Check Apps', 'Test Suite') }), 'create')
  assert.equal(redNoteAction({ scope: 'epic', failing: f('simplify') }), 'skip')
  assert.equal(redNoteAction({ scope: 'epic', failing: f('E2E Gate', 'E2E (with-sales)') }), 'create')
  assert.equal(redNoteAction({ scope: 'leaf', failing: [] }), 'skip')
  assert.equal(redNoteAction({ scope: 'epic', failing: [] }), 'skip')
  assert.equal(redNoteAction({ scope: null, failing: f('Test Suite') }), 'skip')
})

test('rollupChildNote', () => {
  const open = { number: 7, state: 'open' }
  const r = rollupChildNote({ pr: open, failing: f('CI Gate', 'Type Check Apps', 'Test Suite') })
  assert.equal(r.icon, '🔴')
  assert.match(r.note, /Type Check Apps/)
  assert.match(r.note, /Test Suite/)
  assert.doesNotMatch(r.note, /CI Gate/)
  assert.match(rollupChildNote({ pr: open, failing: f('a', 'b', 'c', 'd', 'e') }).note, /\+2 more/)
  assert.equal(rollupChildNote({ pr: open, failing: [] }).icon, '🔨')
  assert.equal(rollupChildNote({ pr: { number: 7, state: 'closed', merged_at: 'x' } }).icon, '✅')
  assert.equal(rollupChildNote({ pr: null }), null)
})
