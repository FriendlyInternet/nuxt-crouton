import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isServerPushError, pushWithRetry } from './git-push-retry.mjs'

const E500 = ' ! [remote rejected] HEAD -> work-3341 (Internal Server Error)\nerror: failed to push some refs'
const mk = (outs, remote = 'aaa') => {
  const calls = { push: 0, sleeps: [] }
  return {
    calls,
    opts: {
      push: async () => outs[Math.min(calls.push++, outs.length - 1)],
      remoteHead: async () => remote, localHead: async () => 'bbb',
      sleep: async (s) => { calls.sleeps.push(s) },
    },
  }
}

test('10a: #3341 line verbatim, then success → two pushes, one 15 s sleep', async () => {
  const { calls, opts } = mk([{ code: 1, output: E500 }, { code: 0, output: 'ok' }])
  const r = await pushWithRetry(opts)
  assert.equal(r.code, 0); assert.equal(calls.push, 2); assert.deepEqual(calls.sleeps, [15])
})
test('10b: transport 500 (exit 128) retried', async () => {
  const { calls, opts } = mk([{ code: 128, output: "fatal: unable to access 'x': The requested URL returned error: 500" }, { code: 0, output: '' }])
  assert.equal((await pushWithRetry(opts)).code, 0); assert.equal(calls.push, 2)
})
test('10c: 500 but remote already has the commit → no second push', async () => {
  const { calls, opts } = mk([{ code: 1, output: E500 }], 'bbb')
  assert.equal((await pushWithRetry(opts)).code, 0); assert.equal(calls.push, 1)
})
test('10d: refusals are not retried', async () => {
  for (const out of [' ! [rejected] HEAD -> b (stale info)', ' ! [rejected] HEAD -> b (non-fast-forward)', ' ! [rejected] b (fetch first)', 'remote: HTTP 403 Forbidden']) {
    const { calls, opts } = mk([{ code: 1, output: out }])
    const r = await pushWithRetry(opts)
    assert.equal(r.code, 1); assert.equal(r.output, out); assert.equal(calls.push, 1); assert.deepEqual(calls.sleeps, [])
  }
})
test('10e: 500 on all four attempts → 3 sleeps then git failure unchanged', async () => {
  const { calls, opts } = mk([{ code: 1, output: E500 }])
  const r = await pushWithRetry(opts)
  assert.equal(r.code, 1); assert.equal(calls.push, 4); assert.deepEqual(calls.sleeps, [15, 45, 90])
})
test('10f: a successful push is never retried even if output says Internal Server Error', async () => {
  const { calls, opts } = mk([{ code: 0, output: 'remote: Internal Server Error (earlier)' }])
  assert.equal((await pushWithRetry(opts)).code, 0); assert.equal(calls.push, 1)
  assert.equal(isServerPushError('(stale info)'), false)
})
