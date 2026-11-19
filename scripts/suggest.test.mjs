import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./suggest.mjs', import.meta.url))
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } })

test('CLI: an invalid call (no evidence) exits 1', () => {
  const r = run(['One idea', '--area', 'pipeline', '--dry-run'])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /evidence \(one https:\/\/ URL\) is required/)
})

test('CLI: a valid --dry-run prints the line and exits 0', () => {
  const r = run(['One idea', '--area', 'pipeline', '--evidence', 'https://github.com/FriendlyInternet/nuxt-crouton/issues/4223', '--source', 'test', '--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^dry run — not saved: /)
  const line = JSON.parse(r.stdout.replace(/^dry run — not saved: /, ''))
  assert.equal(line.text, 'One idea')
  assert.equal(line.area, 'pipeline')
  assert.equal(line.source, 'test')
})
