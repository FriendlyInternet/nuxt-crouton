#!/usr/bin/env node
/**
 * Deploy the crouton-collab live-sync Worker for an app (#2693) — the deploy-time half of
 * `"collab": true` in deploy.config.json. Order: Worker -> D1 migration -> (caller builds app).
 *
 *   COLLAB_TOKEN_SECRET=<secret> node scripts/deploy-collab-worker.mjs --name <worker> --db <d1-name>
 *
 * The Worker comes from packages/crouton-collab/worker-template, deployed IN PLACE through a
 * generated id-less config (D1 auto-provisions, like the app's own first deploy), so nothing
 * is copied and no ids are committed. COLLAB_TOKEN_SECRET is REQUIRED: a deterministic value the
 * workflow derives and also sets on the app (secrets can't be read back, so we never copy one).
 *
 * Prints `url=<worker url>` (also appended to $GITHUB_OUTPUT). Fails loudly — never exits 0
 * having deployed nothing.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyD1Ids } from './lib/pr-preview-db-id.mjs'
import { buildCollabConfig, extractWorkerUrl } from './lib/collab-worker.mjs'

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}
const name = arg('--name')
const db = arg('--db')
const tokenSecret = process.env.COLLAB_TOKEN_SECRET
if (!name || !db) {
  console.error('usage: deploy-collab-worker.mjs --name <worker> --db <d1-name>')
  process.exit(2)
}
if (!tokenSecret) {
  console.error('::error::COLLAB_TOKEN_SECRET is not set — refusing to deploy a collab Worker whose tokens could not verify.')
  process.exit(2)
}

const pkg = resolve(import.meta.dirname, '../packages/crouton-collab')
const dir = mkdtempSync(join(tmpdir(), 'collab-worker-'))
const cfgPath = join(dir, 'wrangler.json')
const config = buildCollabConfig({ name, db, main: join(pkg, 'worker-template/src/index.ts') })
writeFileSync(cfgPath, JSON.stringify(config, null, 2))

const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts })

// 1. Worker (provisions the D1 on first run)
const out = wrangler(['deploy', '--config', cfgPath])
process.stdout.write(out)
let url
try { url = extractWorkerUrl(out, name) } catch (e) {
  console.error(`::error::${e.message}`)
  process.exit(1)
}

// 2. Shared token secret (set on every deploy; the workflow sets the same value on the app)
wrangler(['secret', 'put', 'COLLAB_TOKEN_SECRET', '--config', cfgPath], { input: tokenSecret })
console.log('Collab Worker COLLAB_TOKEN_SECRET set.')

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
