#!/usr/bin/env node
// Post-deploy check that the docs @nuxt/content DB is ready (#3183).
// Healthy = _content_info.ready = 1 for checksum_<c> AND a valid query answers
// HTTP 200 in < 15 s. If not, delete that collection's checksum row once (the
// DB is a rebuildable cache) and re-check until a deadline; exit 1 if never healthy.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

export const COLLECTIONS = ['docs', 'landing']
export const BASE_URL = 'https://docs.friendlyinter.net'
export const QUERY_TIMEOUT_MS = 15000
export const REPAIR_DEADLINE_MS = 4 * 60 * 1000
export const GAP_MS = 5000

const wranglerArgs = sql => [
  'wrangler', 'd1', 'execute', 'docs-db', '--remote', '--json',
  '--config', '.output/server/wrangler.json', '--command', sql,
]

export async function defaultExec(sql) {
  const { stdout } = await run('npx', wranglerArgs(sql), { cwd: 'docs', maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

function parseRows(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr.flatMap(r => r?.results ?? [])
  }
  catch {
    return []
  }
}

// @nuxt/content 3.16 only accepts `COUNT(x) as count` (security.js SQL_COUNT_REGEX).
export const probeSql = c => `SELECT COUNT(*) as count FROM _content_${c} ORDER BY "stem" ASC`

/** Returns { healthy, ready, status, elapsed, count, message, probeFault } and never throws. */
export async function checkCollection(c, { exec, fetch: doFetch, now }) {
  let ready = null
  try {
    const rows = parseRows(await exec('SELECT id, ready FROM _content_info'))
    const row = rows.find(r => r.id === `checksum_${c}`)
    ready = row ? Number(row.ready) : null
  }
  catch {
    ready = null
  }
  const start = now()
  let status = 0
  let count = null
  let message = ''
  try {
    const res = await doFetch(`${BASE_URL}/__nuxt_content/${c}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: probeSql(c) }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
    status = res.status
    const text = (await res.text?.()) ?? ''
    message = String(text).slice(0, 200)
    try {
      const p = JSON.parse(text)
      count = Array.isArray(p) ? Number(p[0]?.count) : null
    }
    catch {
      count = null
    }
  }
  catch {
    status = 0
  }
  const elapsed = now() - start
  const healthy = ready === 1 && status === 200 && elapsed < QUERY_TIMEOUT_MS && count > 0
  // A fast HTTP error while ready=1 means our probe is wrong, not a stuck DB.
  const probeFault = ready === 1 && status >= 400
  return { healthy, ready, status, elapsed, count, message, probeFault }
}

export async function verifyCollection(c, deps) {
  const { exec, now, sleep, log = () => {} } = deps
  const check = async (label) => {
    const r = await checkCollection(c, deps)
    log(`[${c}] ${label}: ready=${r.ready} status=${r.status} elapsed=${r.elapsed}ms count=${r.count} healthy=${r.healthy}`)
    return r
  }
  const first = await check('check')
  if (first.healthy) return true
  if (first.probeFault) {
    log(`[${c}] probe rejected (status=${first.status}): ${first.message} — not touching D1`)
    return false
  }

  log(`[${c}] unhealthy: deleting checksum_${c} once`)
  await exec(`DELETE FROM _content_info WHERE id = 'checksum_${c}'`)

  const deadline = now() + (deps.deadlineMs ?? REPAIR_DEADLINE_MS)
  while (now() < deadline) {
    if ((await check('re-check')).healthy) return true
    await sleep(deps.gapMs ?? GAP_MS)
  }
  return false
}

export async function main(deps = {}) {
  const full = {
    exec: defaultExec,
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    log: console.log,
    ...deps,
  }
  let ok = true
  for (const c of COLLECTIONS) {
    if (!(await verifyCollection(c, full))) {
      console.error(`[${c}] never became healthy`)
      ok = false
    }
  }
  return ok ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code))
}
