import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detect } from './ci-detect.mjs'
import { loadStages } from './harness-stages.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

test('docs-only: stage none', () => {
  const r = run(['docs/x.md'])
  assert.equal(r.stage, 'none')
})

test('docs flag (#3166): docs/** or packages/** changes set it, an app-only change does not', () => {
  assert.equal(run(['docs/content/1.getting-started/x.md']).docs, true)
  assert.equal(run(['packages/crouton-core/app/x.ts']).docs, true)
  assert.equal(run(['apps/velo/app/pages/index.vue']).docs, false)
})

test('docs-only PR through the real CLI prints docs=true (what the changes job hands on)', () => {
  const out = execFileSync('node', ['scripts/ci-detect.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, FILES: 'docs/content/1.getting-started/x.md', EVENT: 'pull_request', GITHUB_OUTPUT: '' }
  })
  assert.match(out, /^stage=none$/m)
  assert.match(out, /^docs=true$/m)
})

// The workflow rule itself: ci.yml must hand `docs` on and run the doc checks in the installing job.
const job = (yml, name) => yml.slice(yml.indexOf(`\n  ${name}:\n`) + 1).split(/\n {2}[a-z][\w-]*:\n/)[0]
test('ci.yml: a docs-only PR runs the doc checks in the Build packages job (#3166)', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8')
  assert.match(job(yml, 'changes'), /docs: \$\{\{ steps\.filter\.outputs\.docs \}\}/)
  const prepare = job(yml, 'prepare')
  assert.match(prepare.match(/^ {4}if: (.*)$/m)[1], /needs\.changes\.outputs\.docs == 'true'/)
  assert.match(prepare, /run: node scripts\/check-doc-claims\.mjs/)
  assert.doesNotMatch(job(yml, 'node-checks'), /check-doc-claims/, 'bare Node job has no typescript: the check would not run')
})
