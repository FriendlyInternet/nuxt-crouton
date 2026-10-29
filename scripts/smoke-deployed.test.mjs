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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'smoke-e2e-'))
  server = createServer((req, res) => {
    const send = (code, body, headers = {}) => { res.writeHead(code, headers); res.end(body) }
    if (req.url === '/api/auth/sign-in/email') return send(200, '{}', { 'set-cookie': 'sid=1; Path=/' })
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
], { timeout: 120000 }, (err, stdout, stderr) => done({ status: err ? (err.code ?? 1) : 0, stdout, stderr })))

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

test('reads declared but no login fails instead of silently skipping', async () => {
  const r = await run()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /reads: declared but not logged in/)
})
