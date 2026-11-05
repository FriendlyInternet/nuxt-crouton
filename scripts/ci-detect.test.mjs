import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detect } from './ci-detect.mjs'
import { loadStages } from './harness-stages.mjs'

const model = await loadStages()
const apps = [
  { name: 'velo', pkg: { dependencies: { '@fyit/crouton-core': 'workspace:*' } } },
  { name: 'kassa', pkg: { dependencies: { '@fyit/crouton-pos': 'workspace:*' } } }
]
const pkgs = {
  'crouton-core': {},
  'crouton-pos': { dependencies: { '@fyit/crouton-core': 'workspace:*' } },
  'crouton-mcp': {}
}
const run = (files, extra = {}) => detect({ files, apps, model, readPkg: n => pkgs[n] ?? null, ...extra })

test('velo-only change: stage app, only velo', () => {
  const r = run(['apps/velo/app/pages/index.vue'])
  assert.equal(r.stage, 'app')
  assert.deepEqual(r.apps, ['velo'])
  assert.equal(r.mcp, false)
})

test('poc-only change: stage poc, no apps', () => {
  const r = run(['pocs/status/app/app.vue'])
  assert.equal(r.stage, 'poc')
  assert.deepEqual(r.apps, [])
  assert.deepEqual(r.pocs, ['status'])
})

test('package change fans out to dependents (transitively)', () => {
  const r = run(['packages/crouton-core/app/x.ts'])
  assert.equal(r.stage, 'package')
  assert.deepEqual(r.apps.sort(), ['kassa', 'velo'])
  assert.deepEqual(r.packages, ['crouton-core'])
})

test('a package only kassa uses does not pull in velo', () => {
  assert.deepEqual(run(['packages/crouton-pos/a.ts']).apps, ['kassa'])
})

test('mcp flag only for crouton-mcp', () => {
  assert.equal(run(['packages/crouton-mcp/src/a.ts']).mcp, true)
  assert.equal(run(['packages/crouton-core/a.ts']).mcp, false)
})

test('infra (scripts, lockfile, ci.yml) is full; push to main is all apps', () => {
  assert.equal(run(['scripts/x.mjs']).stage, 'infra')
  assert.deepEqual(run(['pnpm-lock.yaml']).apps.sort(), ['kassa', 'velo'])
  assert.deepEqual(run(['apps/velo/a.ts'], { event: 'push' }).apps.sort(), ['kassa', 'velo'])
})

test('docs-only: stage none; epic base detected', () => {
  const r = run(['docs/x.md'], { baseRef: 'epic/1-x' })
  assert.equal(r.stage, 'none')
  assert.equal(r.base_is_epic, true)
})
