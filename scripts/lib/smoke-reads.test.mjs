import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runReads } from './smoke-reads.mjs'

const resp = (status, text = '') => ({ res: { ok: status < 400, status }, text })

function fake(routes) {
  const calls = []
  const http = async (method, path) => {
    calls.push({ method, path })
    return routes[path] ?? resp(404)
  }
  return { http, calls }
}
const deps = (http, extra = {}) => ({ http, getTeamId: async () => 't1', ...extra })

test('passes when every read answers the expected status and text', async () => {
  const { http, calls } = fake({
    '/api/x/teams/t1/sync-status': resp(200, '{"ok":true}'),
    '/api/x/sync/pull': resp(403),
  })
  const failed = await runReads([
    { path: '/api/x/teams/{teamId}/sync-status', expectIncludes: 'ok' },
    { path: '/api/x/sync/pull', expectStatus: 403 },
  ], deps(http))
  assert.deepEqual(failed, [])
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET'])
})

test('a 500 (the #2850 sync-status shape) is a failure carrying the body', async () => {
  const { http } = fake({ '/api/x/teams/t1/sync-status': resp(500, 'no such column') })
  const failed = await runReads([{ path: '/api/x/teams/{teamId}/sync-status' }], deps(http))
  assert.equal(failed.length, 1)
  assert.match(failed[0], /HTTP 500, expected 200.*no such column/)
})

test('a missing expectIncludes fails; later reads still run', async () => {
  const { http, calls } = fake({ '/a': resp(200, 'hello'), '/b': resp(200, 'ok') })
  const failed = await runReads([
    { path: '/a', expectIncludes: 'devices' },
    { path: '/b' },
  ], deps(http))
  assert.equal(failed.length, 1)
  assert.match(failed[0], /missing "devices"/)
  assert.equal(calls.length, 2)
})

test('{teamId} with no active team fails without calling anything', async () => {
  const { http, calls } = fake({})
  const failed = await runReads([{ path: '/t/{teamId}' }], deps(http, { getTeamId: async () => undefined }))
  assert.match(failed[0], /no active team/)
  assert.equal(calls.length, 0)
})

test('no reads declared is a pass', async () => {
  assert.deepEqual(await runReads(undefined, deps(fake({}).http)), [])
})

test('expectStatus may be a list; any listed status passes, others fail', async () => {
  const { http } = fake({ '/a': resp(503), '/b': resp(403), '/c': resp(200) })
  const failed = await runReads([
    { path: '/a', expectStatus: [403, 503] },
    { path: '/b', expectStatus: [403, 503] },
    { path: '/c', expectStatus: [403, 503] },
  ], deps(http))
  assert.equal(failed.length, 1)
  assert.match(failed[0], /\/c: HTTP 200, expected 403\|503/)
})
