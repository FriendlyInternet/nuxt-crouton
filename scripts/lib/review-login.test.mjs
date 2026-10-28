// layer: harness
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { previewSessionToken, previewSignIn } from './review-login.mjs'

test('previewSessionToken is sha256(secret:app:preview-session:key), 32 hex', () => {
  const expected = createHash('sha256').update('s:status:preview-session:pr7').digest('hex').slice(0, 32)
  assert.equal(previewSessionToken('s', 'status', 'pr7'), expected)
})

test('previewSessionToken differs per key and secret, and from the password derivation', () => {
  const a = previewSessionToken('s', 'status', 'pr7')
  assert.notEqual(a, previewSessionToken('s', 'status', 'pr8'))
  assert.notEqual(a, previewSessionToken('t', 'status', 'pr7'))
  assert.notEqual(a, createHash('sha256').update('s:status:pr7').digest('hex').slice(0, 24))
})

test('previewSignIn without a token is anonymous and makes no request', async () => {
  assert.deepEqual((await previewSignIn('http://x.invalid', '')).loggedIn, false)
})
