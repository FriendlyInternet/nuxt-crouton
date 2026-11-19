// End-to-end: run scripts/smoke-deployed.mjs itself against a local fake app and assert the
// exit code — the rule is "an endpoint the app uses that breaks makes the smoke fail" (#3077).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'smoke-deployed.mjs')
let server, url, dir
let syncStatus = 200
// sign-in fault injection (#3654): the next `signInFailures` sign-ins answer `signInFailStatus`
let signInFailures = 0
let signInFailStatus = 500
let signInFailBody = '{"code":"D1_ERROR"}'
let signInCount = 0

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'smoke-e2e-'))
  server = createServer((req, res) => {
    const send = (code, body, headers = {}) => { res.writeHead(code, headers); res.end(body) }
    if (req.url === '/api/auth/sign-in/email') {
      signInCount++
      if (signInFailures > 0) { signInFailures--; return send(signInFailStatus, signInFailBody) }
      return send(200, '{}', { 'set-cookie': 'sid=1; Path=/' })
    }
    if (req.url === '/api/auth/get-session') {
      return send(200, JSON.stringify({ user: { id: 'u1' }, session: { activeOrganizationId: 't1' } }))
    }
    if (req.url === '/api/pkg/teams/t1/sync-status') return send(syncStatus, '{"ok":true}')
    send(404, '')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}`
  writeFileSync(join(dir, 'm.json'), JSON.stringify({
    smoke: { reads: [{ path: '/api/pkg/teams/{teamId}/sync-status', expectIncludes: 'ok' }] },
  }))
})
after(() => server.close())

// async, not spawnSync: the fake server lives in this process and must keep answering
const run = (extra = []) => new Promise(done => execFile(process.execPath, [
  script, '--url', url, '--manifest', join(dir, 'm.json'), '--out', dir, '--app', 'e2e', ...extra,
], { timeout: 120000, env: { ...process.env, SMOKE_LOGIN_RETRY_DELAYS_MS: '10,10,10' } }, (err, stdout, stderr) => done({ status: err ? (err.code ?? 1) : 0, stdout, stderr })))

test('a read that returns 500 makes the smoke exit non-zero', async () => {
  syncStatus = 500
  const r = await run(['--email', 'a@b.c', '--password', 'x'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /sync-status.*HTTP 500/)
})

test('the same read returning 200 passes', async () => {
  syncStatus = 200
  const r = await run(['--email', 'a@b.c', '--password', 'x'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /reads \/api\/pkg\/teams\/t1\/sync-status → 200/)
})

const resetSignIn = (failures, status = 500) => {
  signInFailures = failures; signInFailStatus = status; signInCount = 0; syncStatus = 200
}

test('a sign-in that returns 500 once then 200 still passes (retried)', async () => {
  resetSignIn(1, 500)
  const r = await run(['--email', 'a@b.c', '--password', 'x'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /sign-in returned HTTP 500 — retrying in 0\.01s \(attempt 1\/4\)/)
  assert.equal(signInCount, 2)
})

test('a sign-in that always returns 500 fails with attempt count and body excerpt', async () => {
  resetSignIn(99, 500)
  const r = await run(['--email', 'a@b.c', '--password', 'x'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /login: sign-in returned HTTP 500 after 4 attempt\(s\)/)
  assert.match(r.stderr, /D1_ERROR/)
  assert.equal(signInCount, 4)
})

test('a 401 on sign-in is not retried', async () => {
  resetSignIn(99, 401)
  const r = await run(['--email', 'a@b.c', '--password', 'x'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /login: sign-in returned HTTP 401 after 1 attempt\(s\)/)
  assert.equal(signInCount, 1)
  resetSignIn(0)
})

test('reads declared but no login fails instead of silently skipping', async () => {
  const r = await run()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /reads: declared but not logged in/)
})
