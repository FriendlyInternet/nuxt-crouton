import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillPlaceholders, runCrud } from './smoke-crud.mjs'

const ok = json => ({ res: { ok: true, status: 200 }, json })
const bad = status => ({ res: { ok: false, status }, json: null })

/** Fake http recording calls; `routes` maps "METHOD path" → response (or fn). */
function fake(routes) {
  const calls = []
  const http = async (method, path, body, opts = {}) => {
    calls.push({ method, path, body, auth: opts.auth })
    const r = routes[`${method} ${path}`]
    return typeof r === 'function' ? r(body) : (r ?? bad(404))
  }
  return { http, calls }
}

const crud = {
  create: { path: '/api/teams/{teamId}/things', body: { title: 'smoke-{rand}' } },
  update: { path: '/api/teams/{teamId}/things/{id}', body: { title: 'smoke-{rand}-b' } },
  read: { path: '/api/teams/{teamId}/things?ids={id}', expectIncludes: 'smoke-{rand}-b' },
  delete: { path: '/api/teams/{teamId}/things/{id}' }
}
const deps = (http, extra = {}) => ({ http, getTeamId: async () => 't1', rand: 'abc', ...extra })
const happy = {
  'POST /api/teams/t1/things': ok({ id: 'r1' }),
  'PATCH /api/teams/t1/things/r1': ok({ id: 'r1' }),
  'GET /api/teams/t1/things?ids=r1': ok([{ id: 'r1', title: 'smoke-abc-b' }]),
  'DELETE /api/teams/t1/things/r1': ok({})
}

test('fillPlaceholders: replaces in nested strings, leaves unknown ones', () => {
  assert.deepEqual(fillPlaceholders({ a: ['{id}-{rand}'], b: '{nope}' }, { id: 1, rand: 'x' }), { a: ['1-x'], b: '{nope}' })
})

test('runCrud: full create → update → read → delete passes with placeholders resolved', async () => {
  const { http, calls } = fake(happy)
  assert.deepEqual(await runCrud(crud, deps(http)), [])
  assert.deepEqual(calls.map(c => c.method), ['POST', 'PATCH', 'GET', 'DELETE'])
  assert.deepEqual(calls[0].body, { title: 'smoke-abc' })
})

test('runCrud: fails when the read does not show the updated value, and still deletes', async () => {
  const { http, calls } = fake({ ...happy, 'GET /api/teams/t1/things?ids=r1': ok([{ title: 'smoke-abc' }]) })
  const f = await runCrud(crud, deps(http))
  assert.equal(f.length, 1)
  assert.match(f[0], /crud\.read.*missing "smoke-abc-b"/)
  assert.equal(calls.at(-1).method, 'DELETE')
})

test('runCrud: a failing update is reported and cleanup is still attempted', async () => {
  const { http, calls } = fake({ ...happy, 'PATCH /api/teams/t1/things/r1': bad(500) })
  const f = await runCrud(crud, deps(http))
  assert.match(f.join(), /crud\.update: HTTP 500/)
  assert.equal(calls.at(-1).method, 'DELETE')
})

test('runCrud: create failure stops early (nothing to clean up)', async () => {
  const { http, calls } = fake({ 'POST /api/teams/t1/things': bad(404) })
  assert.deepEqual(await runCrud(crud, deps(http)), ['crud.create: HTTP 404'])
  assert.equal(calls.length, 1)
})

test('runCrud: a failed delete is reported', async () => {
  const { http } = fake({ ...happy, 'DELETE /api/teams/t1/things/r1': bad(500) })
  assert.match((await runCrud(crud, deps(http))).join(), /crud\.delete: HTTP 500/)
})

test('runCrud: {teamId} without an active team fails before any request', async () => {
  const { http, calls } = fake(happy)
  const f = await runCrud(crud, deps(http, { getTeamId: async () => undefined }))
  assert.match(f[0], /no active team/)
  assert.equal(calls.length, 0)
})

test('runCrud: readPublic is requested anonymously, read authenticated', async () => {
  const { http, calls } = fake({ ...happy, 'GET /pub/r1': ok({ t: 'x' }) })
  await runCrud({ ...crud, readPublic: { path: '/pub/{id}' } }, deps(http))
  assert.equal(calls.find(c => c.path === '/pub/r1').auth, false)
  assert.equal(calls.find(c => c.path.includes('ids=')).auth, true)
})
