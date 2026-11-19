/**
 * #2587 — a failed PR-preview deploy must NAME its cause in the CI-failure message.
 *
 * The failure picker (scripts/lib/log-tail.mjs) only quotes a line as the cause when it is a
 * `##[error]` annotation (or another CAUSE_LINES shape). The three preview CLIs used to exit 1
 * with plain stderr text, so the message showed no `Stopped at:` line at all. These tests spawn
 * the REAL CLIs (the entry point the deploy workflow runs) and check every fatal exit opens with
 * a `::error::<script>:` workflow command on stderr — and that the happy path prints none.
 *
 *   node --test scripts/pr-preview-cli.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = (name) => join(here, `${name}.mjs`)

/** A fresh app dir (no wrangler.jsonc) to run the CLI from, like the workflow's working-directory. */
const appDir = () => mkdtempSync(join(tmpdir(), 'pr-preview-cli-'))

function run(name, args, cwd) {
  const r = spawnSync(process.execPath, [script(name), ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const annotated = (stderr, name) =>
  stderr.split('\n').some((l) => l.startsWith(`::error::${name}:`))

function builtConfig(dir, d1) {
  const file = join(dir, 'wrangler.json')
  writeFileSync(file, JSON.stringify({
    name: 'velo',
    main: 'index.js',
    d1_databases: [{ binding: 'DB', database_name: 'velo-staging-db', database_id: 'X', ...d1 }],
  }))
  return file
}

// covers: T1
test('pr-preview-wrangler: a D1 binding with no migrations_dir exits 1 with an ::error:: line', () => {
  const dir = appDir()
  const r = run('pr-preview-wrangler', [builtConfig(dir, {}), 'velo', '9999'], dir)
  assert.equal(r.code, 1)
  assert.ok(annotated(r.stderr, 'pr-preview-wrangler'), r.stderr)
  assert.match(r.stderr, /^::error::pr-preview-wrangler: d1 binding DB has NO migrations_dir/m)
})

// covers: T2
test('pr-preview-wrangler: a migrations_dir missing on disk exits 1 with an ::error:: line', () => {
  const dir = appDir()
  const r = run('pr-preview-wrangler', [builtConfig(dir, { migrations_dir: join(dir, 'nope') }), 'velo', '9999'], dir)
  assert.equal(r.code, 1)
  assert.match(r.stderr, /^::error::pr-preview-wrangler: migrations_dir does not exist/m)
})

// covers: T3
test('pr-preview-reuse: a missing config exits 1 with an ::error:: line', () => {
  const dir = appDir()
  const r = run('pr-preview-reuse', [join(dir, 'none.json')], dir)
  assert.equal(r.code, 1)
  assert.match(r.stderr, /^::error::pr-preview-reuse: .* not found/m)
})

// covers: T4
test('pr-preview-db-id: a missing config exits 1 with an ::error:: line', () => {
  const dir = appDir()
  const r = run('pr-preview-db-id', [join(dir, 'none.json')], dir)
  assert.equal(r.code, 1)
  assert.match(r.stderr, /^::error::pr-preview-db-id: .* not found/m)
})

// covers: T5
test('pr-preview-wrangler: a valid config exits 0, prints no ::error::, and still emits worker=/db=', () => {
  const dir = appDir()
  mkdirSync(join(dir, 'migrations'))
  const r = run('pr-preview-wrangler', [builtConfig(dir, { migrations_dir: 'migrations' }), 'velo', '9999'], dir)
  assert.equal(r.code, 0, r.stderr)
  assert.ok(!r.stderr.includes('::error::'), r.stderr)
  assert.ok(!r.stdout.includes('::error::'), r.stdout)
  assert.match(r.stdout, /^worker=velo-pr9999$/m)
  assert.match(r.stdout, /^db=velo-pr9999-db$/m)
})
