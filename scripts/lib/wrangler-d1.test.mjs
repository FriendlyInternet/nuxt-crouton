/**
 * Regression for #1056 — a teardown re-run must be idempotent: an already-absent
 * Worker/D1/KV is "already gone", not a failure. The bug was that runWrangler's
 * thrown Error didn't carry wrangler's stderr, and the classifier missed the real
 * Cloudflare phrasings ("Couldn't find DB", "[code: 10007]").
 *
 *   node --test scripts/lib/wrangler-d1.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAlreadyGone, isUserTable } from './wrangler-d1.mjs'

test('Worker already gone — the real CF phrasing (#1056)', () => {
  assert.equal(isAlreadyGone('This Worker does not exist on your account. [code: 10007]'), true)
  assert.equal(isAlreadyGone('wrangler exited with code 1: npx wrangler delete --name x\nThis Worker does not exist on your account. [code: 10007]'), true)
})

test('D1 already gone — the contraction the old regex missed (#1056)', () => {
  assert.equal(isAlreadyGone("Couldn't find DB with name 'three-demo-staging-db'"), true)
  assert.equal(isAlreadyGone('Could not find database'), true)
})

test('KV already gone', () => {
  assert.equal(isAlreadyGone('KV namespace not found'), true)
  assert.equal(isAlreadyGone('no such namespace'), true)
})

test('a genuine failure is NOT treated as already-gone', () => {
  assert.equal(isAlreadyGone('Authentication error [code: 10000]'), false)
  assert.equal(isAlreadyGone('A request to the Cloudflare API failed: 403 Forbidden'), false)
  assert.equal(isAlreadyGone('connect ETIMEDOUT'), false)
  assert.equal(isAlreadyGone(''), false)
  assert.equal(isAlreadyGone(undefined), false)
})

test('isUserTable skips SQLite/Cloudflare internals, keeps app tables (#3416)', () => {
  for (const n of ['_cf_KV', '_cf_METADATA', 'sqlite_sequence']) assert.equal(isUserTable(n), false, n)
  for (const n of ['user', 'auth_email_log', 'd1_migrations', 'bookings_bookings', 'xcfy_table', 'a_cf_b', 'cf_notes']) assert.equal(isUserTable(n), true, n)
})
