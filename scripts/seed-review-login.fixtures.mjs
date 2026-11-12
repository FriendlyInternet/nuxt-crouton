// Shared #3141 (R4) fixtures for seed-review-login.test.mjs (bare Node) and
// seed-review-login.deps-test.mjs (needs better-auth installed). Node core only:
// they run the real script against a real sqlite file and a fake Worker.
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const SCRIPT = fileURLToPath(new URL('./seed-review-login.mjs', import.meta.url))

export const R4_EMAIL = 'review+t@example.com'

export function r4Db({ withUser }) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-3141-'))
  const file = join(dir, 'sqlite.db')
  const d = new DatabaseSync(file)
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT, "emailVerified" INTEGER DEFAULT 0);
    CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT);
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT, "providerId" TEXT, "password" TEXT);
  `)
  if (withUser) {
    d.exec(`INSERT INTO "user" VALUES ('u1', '${R4_EMAIL}', 0);
      INSERT INTO "account" VALUES ('a1', 'u1', 'credential', 'hash-of-an-old-password');`)
  }
  d.close()
  return file
}

export const row = (file, sql) => {
  const d = new DatabaseSync(file)
  try { return d.prepare(sql).get() } finally { d.close() }
}

export async function runR4(file, handle) {
  const calls = []
  const server = createServer(async (req, res) => {
    calls.push({ url: req.url, cookie: req.headers.cookie || '' })
    const { status = 200, body = {}, headers = {} } = (await handle(req.url)) || {}
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--url', url, '--email', R4_EMAIL, '--password', 'pw', '--sqlite', file],
      { env: { ...process.env, SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }))
  })
  await new Promise(r => server.close(r))
  return { ...result, calls }
}

export const SESSION_COOKIE = { 'set-cookie': 'better-auth.session_token=tok; Path=/; HttpOnly' }
