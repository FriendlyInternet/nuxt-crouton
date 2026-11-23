import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseJsonc } from './lib/wrangler-d1.mjs'
import { decideOrder, orderLine, planSteps, runSteps, isRealDatabaseId } from './deploy-order.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const SCRIPT = join(here, 'deploy-order.mjs')
const ID = 'b19c76be-5a5a-4580-b722-9323b720fde9'

const binding = (extra = {}) => ({ binding: 'DB', database_name: 'pins-preview-db', ...extra })
const cfg = (stagingDb, topDb = { binding: 'DB', database_name: 'pins-db' }) => ({
  d1_databases: [topDb],
  env: { staging: { d1_databases: [stagingDb] } }
})
const cmds = { deploy: 'DEPLOY', migrate: 'MIGRATE', resync: 'RESYNC' }

test('T1 — a real UUID database_id decides migrate-first; no env / prod reads the top level', () => {
  const d = decideOrder(cfg(binding({ database_id: ID })), 'staging')
  assert.deepEqual(d, { order: 'migrate-first', database: 'pins-preview-db' })
  assert.equal(orderLine(d), 'deploy order: migrate-first (database pins-preview-db exists)')

  const top = cfg(binding(), { binding: 'DB', database_name: 'pins-db', database_id: ID })
  for (const env of [undefined, 'prod', 'production']) {
    assert.deepEqual(decideOrder(top, env), { order: 'migrate-first', database: 'pins-db' })
  }
  // and the staging scope (no id) is not mistaken for the top level
  assert.equal(decideOrder(top, 'staging').order, 'deploy-first')
})

test('T2 — no id, empty id, placeholder or all-zero id decides deploy-first', () => {
  for (const extra of [{}, { database_id: '' }, { database_id: 'placeholder-create-with-wrangler' },
    { database_id: '00000000-0000-0000-0000-000000000000' }]) {
    const d = decideOrder(cfg(binding(extra)), 'staging')
    assert.equal(d.order, 'deploy-first', JSON.stringify(extra))
    assert.equal(orderLine(d), 'deploy order: deploy-first (first deploy, database not created yet)')
  }
  assert.equal(isRealDatabaseId(undefined), false)
  assert.equal(isRealDatabaseId(ID), true)
})

test('T3 — no d1_databases, or an empty list, decides deploy-only with just the deploy step', () => {
  for (const config of [{}, { d1_databases: [] }]) {
    const d = decideOrder(config, undefined)
    assert.deepEqual(d, { order: 'deploy-only' })
    assert.equal(orderLine(d), 'deploy order: deploy-only (no D1 database)')
  }
  assert.deepEqual(decideOrder({ env: { staging: {} } }, 'staging'), { order: 'deploy-only' })
  assert.deepEqual(planSteps('deploy-only', cmds), ['DEPLOY'])
})

test('T4 — unreadable / invalid config or unknown env: CLI exits non-zero and runs nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-order-'))
  const garbage = join(dir, 'garbage.jsonc')
  writeFileSync(garbage, '{ not json ')
  const good = join(dir, 'wrangler.jsonc')
  writeFileSync(good, JSON.stringify(cfg(binding())))
  const cases = [
    ['--config', join(dir, 'missing.jsonc')],
    ['--config', garbage],
    ['--config', good, '--env', 'nope']
  ]
  for (const [i, extra] of cases.entries()) {
    const marker = join(dir, `marker-${i}`)
    const touch = `node -e "require('fs').writeFileSync(process.argv[1],'x')" ${JSON.stringify(marker)}`
    const r = spawnSync(process.execPath, [SCRIPT, ...extra, '--deploy', touch, '--migrate', touch], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, extra.join(' '))
    assert.match(r.stderr, /::error::deploy-order:/)
    assert.equal(existsSync(marker), false, `nothing must run for ${extra.join(' ')}`)
  }
  // missing --migrate also refuses before running anything
  const marker = join(dir, 'marker-nomigrate')
  const touch = `node -e "require('fs').writeFileSync(process.argv[1],'x')" ${JSON.stringify(marker)}`
  const r = spawnSync(process.execPath, [SCRIPT, '--config', good, '--deploy', touch], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.equal(existsSync(marker), false)

  assert.throws(() => decideOrder(cfg(binding()), 'nope'), /no environment "nope"/)
})

test('T5 — a failing migrate stops migrate-first before deploy; deploy-first keeps deploy → resync → migrate', () => {
  const calls = []
  const status = runSteps(planSteps('migrate-first', cmds), (c) => { calls.push(c); return c === 'MIGRATE' ? 1 : 0 })
  assert.equal(status, 1)
  assert.deepEqual(calls, ['MIGRATE'])

  const ok = []
  assert.equal(runSteps(planSteps('migrate-first', cmds), (c) => { ok.push(c); return 0 }), 0)
  assert.deepEqual(ok, ['MIGRATE', 'DEPLOY'])

  assert.deepEqual(planSteps('deploy-first', cmds), ['DEPLOY', 'RESYNC', 'MIGRATE'])
  assert.deepEqual(planSteps('deploy-first', { deploy: 'DEPLOY', migrate: 'MIGRATE' }), ['DEPLOY', 'MIGRATE'])

  // the real CLI: a failing migrate exits non-zero and the deploy never runs
  const dir = mkdtempSync(join(tmpdir(), 'deploy-order-'))
  const good = join(dir, 'wrangler.jsonc')
  writeFileSync(good, JSON.stringify(cfg(binding({ database_id: ID }))))
  const marker = join(dir, 'deployed')
  const touch = `node -e "require('fs').writeFileSync(process.argv[1],'x')" ${JSON.stringify(marker)}`
  const r = spawnSync(process.execPath, [SCRIPT, '--config', good, '--env', 'staging',
    '--deploy', touch, '--migrate', 'node -e "process.exit(3)"'], { encoding: 'utf8' })
  assert.equal(r.status, 3)
  assert.match(r.stdout, /deploy order: migrate-first \(database pins-preview-db exists\)/)
  assert.equal(existsSync(marker), false)
})

test('T6 — pins cf:staging / cf:deploy go through deploy-order.mjs after sync-wrangler-ids', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'pocs/pins/package.json'), 'utf8'))
  for (const name of ['cf:staging', 'cf:deploy']) {
    const s = pkg.scripts[name]
    const at = s.indexOf('scripts/deploy-order.mjs')
    assert.ok(at > 0, `${name} calls deploy-order.mjs`)
    const sync = s.indexOf('scripts/sync-wrangler-ids.mjs')
    assert.ok(sync >= 0 && sync < at, `${name} runs sync-wrangler-ids before deploy-order`)
    // every `wrangler … deploy` lives inside the quoted --deploy argument
    const deployArg = s.match(/--deploy "([^"]*)"/)?.[1]
    assert.ok(deployArg && /wrangler\b.*\bdeploy\b/.test(deployArg), `${name} --deploy runs wrangler deploy`)
    const rest = s.replace(/--deploy "[^"]*"/, '')
    assert.doesNotMatch(rest, /wrangler[^&"]*\bdeploy\b/, `${name} has no wrangler deploy outside --deploy`)
    assert.match(s, /--migrate "[^"]*d1 migrations apply[^"]*"/)
  }
})

test('T7 — the real pins config: deploy-first as committed, migrate-first once the staging id is synced', () => {
  const config = parseJsonc(readFileSync(join(repo, 'pocs/pins/wrangler.jsonc'), 'utf8'))
  const committedId = config.env.staging.d1_databases[0].database_id
  const expected = isRealDatabaseId(committedId) ? 'migrate-first' : 'deploy-first'
  assert.equal(decideOrder(config, 'staging').order, expected)

  const synced = structuredClone(config)
  delete synced.env.staging.d1_databases[0].database_id
  assert.equal(decideOrder(synced, 'staging').order, 'deploy-first')
  synced.env.staging.d1_databases[0].database_id = ID
  assert.deepEqual(decideOrder(synced, 'staging'), { order: 'migrate-first', database: 'pins-preview-db' })
})
