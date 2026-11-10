import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseOkReply } from './ok-reply.mjs'

const r = (kind, o = {}) => chooseOkReply({ state: { kind }, ownerOk: true, ...o })

test('pending / round1 / failed / ok-again each get their own non-empty text', () => {
  const got = [r('pending'), r('round1'), r('failed'), r('final', { okBeforeFinal: true })]
  assert.deepEqual(got.map(x => x.reason), ['pending', 'round1', 'failed', 'ok-again'])
  for (const x of got) assert.ok(x.text.length > 10)
  assert.equal(new Set(got.map(x => x.text)).size, 4)
})
test('final with a valid later ok → no reply (it merges)', () => assert.equal(r('final', { okBeforeFinal: false }), null))
test('needs-owner: ok before → ok-again; ok after → null', () => {
  assert.equal(chooseOkReply({ state: { kind: 'needs-owner' }, ownerOk: true, okBeforeFinal: true }).reason, 'ok-again')
  assert.equal(chooseOkReply({ state: { kind: 'needs-owner' }, ownerOk: true }), null)
})
test('other (go) → no reply', () => assert.equal(r('other'), null))
test('no owner ok → never a reply', () => {
  for (const kind of ['pending', 'round1', 'failed', 'final', 'other']) assert.equal(chooseOkReply({ state: { kind }, ownerOk: false, okBeforeFinal: true }), null)
})
