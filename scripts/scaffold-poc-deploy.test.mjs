// #4142 case 6 — after `crouton init <name> --poc --domain pmcp.dev`, running
// scaffold-poc-deploy must leave stagingUrl equal to the env.staging route.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { resolveStagingUrl } from './scaffold-poc-deploy.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// What tmplWranglerJsonc (packages/crouton-cli/lib/scaffold-app.ts) writes for poc + pmcp.dev
// (inline: an .mjs test cannot import the .ts template).
const POC_WRANGLER = `{
  // Cloudflare WORKERS (static assets) config for demo.
  "name": "demo",
  "compatibility_date": "2024-09-02",
  "compatibility_flags": ["nodejs_compat"],

  "d1_databases": [
    { "binding": "DB", "database_name": "demo-db", "migrations_dir": "server/db/migrations/sqlite" }
  ],
  "kv_namespaces": [
    { "binding": "KV" }
  ],
  "env": {
    "staging": {
      "routes": [{ "pattern": "demo.pmcp.dev", "custom_domain": true }],
      "d1_databases": [
        { "binding": "DB", "database_name": "demo-staging-db", "migrations_dir": "server/db/migrations/sqlite" }
      ],
      "kv_namespaces": [
        { "binding": "KV" }
      ]
    }
  }
}
`

// crate-style app: a prod route at top level AND a -staging route under env.staging.
const CRATE_WRANGLER = `{
  "name": "demo",
  "routes": [{ "pattern": "demo.pmcp.dev", "custom_domain": true }],
  "env": {
    "staging": {
      "routes": [{ "pattern": "demo-staging.pmcp.dev", "custom_domain": true }]
    }
  }
}`

const NO_ROUTE_WRANGLER = `{ "name": "demo", "env": { "staging": { "kv_namespaces": [{ "binding": "KV" }] } } }`

test('poc + pmcp.dev wrangler → stagingUrl equals the env.staging route', () => {
  assert.equal(resolveStagingUrl('demo', POC_WRANGLER, {}), 'https://demo.pmcp.dev')
})

test('crate-style -staging route wins over the top-level prod route and a stale prev', () => {
  assert.equal(
    resolveStagingUrl('demo', CRATE_WRANGLER, { stagingUrl: 'https://demo.pmcp.dev' }),
    'https://demo-staging.pmcp.dev'
  )
})

test('no route → keeps an existing stagingUrl, else falls back to https://<name>.pmcp.dev', () => {
  assert.equal(resolveStagingUrl('demo', NO_ROUTE_WRANGLER, { stagingUrl: 'https://x.example' }), 'https://x.example')
  assert.equal(resolveStagingUrl('demo', NO_ROUTE_WRANGLER, { stagingUrl: '' }), 'https://demo.pmcp.dev')
  assert.equal(resolveStagingUrl('demo', '', {}), 'https://demo.pmcp.dev')
})

// Real entry point: run the CLI against a temp repo layout and read the file it writes.
test('CLI run leaves deploy.config.json stagingUrl equal to the route', () => {
  const root = mkdtempSync(join(tmpdir(), 'poc-deploy-'))
  try {
    mkdirSync(join(root, 'scripts'))
    cpSync(join(here, 'scaffold-poc-deploy.mjs'), join(root, 'scripts', 'scaffold-poc-deploy.mjs'))
    const poc = join(root, 'pocs', 'demo')
    mkdirSync(poc, { recursive: true })
    writeFileSync(join(poc, 'wrangler.jsonc'), CRATE_WRANGLER)
    writeFileSync(join(poc, 'deploy.config.json'), JSON.stringify({ stagingUrl: 'https://demo-staging.pmcp.dev', layerPackages: 'a b' }))
    execFileSync(process.execPath, [join(root, 'scripts', 'scaffold-poc-deploy.mjs'), 'demo'], { stdio: 'pipe' })
    const cfg = JSON.parse(readFileSync(join(poc, 'deploy.config.json'), 'utf8'))
    assert.equal(cfg.stagingUrl, 'https://demo-staging.pmcp.dev')
    assert.equal(cfg.layerPackages, 'a b')

    writeFileSync(join(poc, 'wrangler.jsonc'), POC_WRANGLER)
    execFileSync(process.execPath, [join(root, 'scripts', 'scaffold-poc-deploy.mjs'), 'demo'], { stdio: 'pipe' })
    assert.equal(JSON.parse(readFileSync(join(poc, 'deploy.config.json'), 'utf8')).stagingUrl, 'https://demo.pmcp.dev')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
