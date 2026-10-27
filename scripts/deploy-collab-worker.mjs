#!/usr/bin/env node
/**
 * Deploy the crouton-collab live-sync Worker for an app (#2693) — the deploy-time half of
 * `"collab": true` in deploy.config.json. Order: Worker -> D1 migration -> (caller builds app).
 *
 *   node scripts/deploy-collab-worker.mjs --name <worker> --db <d1-name> [--secret-file <path>]
 *
 * The Worker comes from packages/crouton-collab/worker-template, deployed IN PLACE through a
 * generated id-less config (D1 auto-provisions, like the app's own first deploy), so nothing
 * is copied and no ids are committed. Reads the shared secret from COLLAB_AUTH_SECRET (the
 * app's BETTER_AUTH_SECRET, when the secrets bundle supplies it); otherwise sets one only if
 * the Worker has none, and writes it to --secret-file so the app's secret step can reuse it.
 *
 * Prints `url=<worker url>` (also appended to $GITHUB_OUTPUT). Fails loudly — never exits 0
 * having deployed nothing.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyD1Ids } from './lib/pr-preview-db-id.mjs'

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}
const name = arg('--name')
const db = arg('--db')
const secretFile = arg('--secret-file')
if (!name || !db) {
  console.error('usage: deploy-collab-worker.mjs --name <worker> --db <d1-name> [--secret-file <path>]')
  process.exit(2)
}

const pkg = resolve(import.meta.dirname, '../packages/crouton-collab')
const dir = mkdtempSync(join(tmpdir(), 'collab-worker-'))
const cfgPath = join(dir, 'wrangler.json')
const config = {
  name,
  main: join(pkg, 'worker-template/src/index.ts'),
  compatibility_date: '2024-09-02',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{ binding: 'DB', database_name: db }],
  durable_objects: { bindings: [{ name: 'COLLAB_ROOMS', class_name: 'CollabRoom' }] },
  migrations: [{ tag: 'collab-v1', new_classes: ['CollabRoom'] }],
}
writeFileSync(cfgPath, JSON.stringify(config, null, 2))

const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts })

// 1. Worker (provisions the D1 on first run)
const out = wrangler(['deploy', '--config', cfgPath])
process.stdout.write(out)
const url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0]
if (!url) {
  console.error(`::error::Collab Worker ${name} deployed but no workers.dev URL was printed — the app could not be pointed at it.`)
  process.exit(1)
}

// 2. Shared secret
let secrets = ''
try { secrets = wrangler(['secret', 'list', '--config', cfgPath]) } catch { /* treated as none */ }
const supplied = process.env.COLLAB_AUTH_SECRET
if (supplied) {
  wrangler(['secret', 'put', 'BETTER_AUTH_SECRET', '--config', cfgPath], { input: supplied })
  console.log('Collab Worker BETTER_AUTH_SECRET set from the secrets bundle.')
} else if (!secrets.includes('BETTER_AUTH_SECRET')) {
  const generated = randomBytes(32).toString('hex')
  wrangler(['secret', 'put', 'BETTER_AUTH_SECRET', '--config', cfgPath], { input: generated })
  if (secretFile) writeFileSync(secretFile, generated, { mode: 0o600 })
  console.log('Collab Worker BETTER_AUTH_SECRET generated; the app will be given the same value if it has none.')
} else {
  console.log('::warning::Collab Worker already has a BETTER_AUTH_SECRET and no secrets bundle supplies one — assuming it matches the app\'s.')
}

// 3. D1 migration (idempotent: CREATE ... IF NOT EXISTS). Needs the id the deploy just provisioned.
const list = JSON.parse(wrangler(['d1', 'list', '--json']).replace(/^[^[{]*/, ''))
const { missing } = applyD1Ids(config, list)
if (missing.length) {
  console.error(`::error::No provisioned D1 found for the collab Worker: ${missing.join(', ')}`)
  process.exit(1)
}
writeFileSync(cfgPath, JSON.stringify(config, null, 2))
wrangler(['d1', 'execute', db, '--remote', '--config', cfgPath,
  '--file', join(pkg, 'server/database/migrations/0001_yjs_collab_states.sql')])
console.log(`Collab migration applied to ${db}.`)

console.log(`url=${url}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`)
