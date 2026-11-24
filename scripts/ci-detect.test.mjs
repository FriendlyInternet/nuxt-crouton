import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detect, pushDiffArgs } from './ci-detect.mjs'
import { loadStages } from './harness-stages.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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

// #4139 T1 — a workflow-only PR still runs the scripts suites.
test('scripts flag: poc + workflow PR (#4135) runs them, docs-only does not, app change does', () => {
  const pr4135 = ['.github/workflows/automerge-epic-subpr.yml', '.github/workflows/deploy-app.yml', 'docs/pipeline/how-it-works.md', 'pocs/status/CLAUDE.md']
  const r = run(pr4135)
  assert.equal(r.stage, 'poc')
  assert.equal(r.scripts, true)
  assert.equal(run(['docs/x.md']).scripts, false)
  assert.equal(run(['apps/velo/app/pages/index.vue']).scripts, true)
})

// #4139 T2 — which git command lists a push's files.
test('pushDiffArgs: before..HEAD, HEAD^1..HEAD for a merge/one commit or bad before, git show for a root', () => {
  const sha = 'a'.repeat(40)
  assert.deepEqual(pushDiffArgs({ before: sha, beforeExists: true, parents: 2 }), ['diff', '--name-only', sha, 'HEAD'])
  assert.deepEqual(pushDiffArgs({ before: '', parents: 2 }), ['diff', '--name-only', 'HEAD^1', 'HEAD'])
  assert.deepEqual(pushDiffArgs({ before: '0'.repeat(40), beforeExists: true, parents: 1 }), ['diff', '--name-only', 'HEAD^1', 'HEAD'])
  assert.deepEqual(pushDiffArgs({ before: sha, beforeExists: false, parents: 1 }), ['diff', '--name-only', 'HEAD^1', 'HEAD'])
  assert.deepEqual(pushDiffArgs({ parents: 0 }), ['show', '--name-only', '--pretty=format:', 'HEAD'])
})

// #4139 T3 — real git: a --no-ff merge commit lists the merged files.
test('--list-files on a real merge commit prints the merged files', () => {
  const script = resolve('scripts/ci-detect.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'ci-detect-'))
  try {
    const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'README.md'), 'x\n'); g('add', '.'); g('commit', '-q', '-m', 'root')
    g('checkout', '-q', '-b', 'feat')
    mkdirSync(join(dir, 'scripts')); writeFileSync(join(dir, 'scripts/a.mjs'), 'x\n'); g('add', '.'); g('commit', '-q', '-m', 'feat')
    g('checkout', '-q', 'main')
    writeFileSync(join(dir, 'other.md'), 'y\n'); g('add', '.'); g('commit', '-q', '-m', 'main moves')
    g('merge', '-q', '--no-ff', '-m', 'Merge feat', 'feat')
    assert.equal(g('show', '--name-only', '--pretty=format:', 'HEAD').trim(), '', 'precondition: git show lists nothing for a merge')
    const env = { ...process.env }; delete env.BEFORE
    const out = execFileSync('node', [script, '--list-files'], { cwd: dir, encoding: 'utf8', env })
    assert.match(out, /^scripts\/a\.mjs$/m)
    assert.doesNotMatch(out, /other\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// #4139 T4 — the workflow wiring.
test('ci.yml: push lists files via --list-files and the scripts suites gate on the scripts output', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8')
  const changes = job(yml, 'changes')
  assert.match(changes, /scripts: \$\{\{ steps\.filter\.outputs\.scripts \}\}/)
  assert.match(changes, /node scripts\/ci-detect\.mjs --list-files/)
  assert.match(changes, /BEFORE: \$\{\{ github\.event\.before \}\}/)
  assert.doesNotMatch(changes, /git show --name-only --pretty=format: HEAD/)
  const nodeChecks = job(yml, 'node-checks')
  const step = nodeChecks.slice(nodeChecks.indexOf('- name: Run scripts/*.test.mjs'))
  assert.match(step.match(/^ {8}if: (.*)$/m)[1], /^needs\.changes\.outputs\.scripts == 'true'$/)
})

test('pipeline map edit runs node-checks', () => {
  const r = run(['docs/pipeline/how-it-works.md'])
  assert.equal(r.stage, 'none')
  assert.equal(r.workflows, true)
  assert.equal(run(['docs/x.md']).workflows, false)
})
