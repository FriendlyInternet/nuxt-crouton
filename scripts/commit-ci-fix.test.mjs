import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ownerMergeGo } from './lib/owner-merge-go.mjs'

const script = resolve('scripts/commit-ci-fix.sh')
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'ci-fix-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' })
  g('init', '-q'); g('config', 'user.name', 'x'); g('config', 'user.email', 'x@x')
  writeFileSync(join(d, 'a'), '1'); g('add', '.'); g('commit', '-qm', 'base')
  return { d, g, run: msg => execFileSync('bash', [script, msg], { cwd: d, encoding: 'utf8' }) }
}

test('commits staged files with message + CI-Fix trailer as claude[bot]', () => {
  const { d, g, run } = repo()
  writeFileSync(join(d, 'a'), '2'); g('add', 'a')
  const m = join(d, '..', `m-${Date.now()}`); writeFileSync(m, 'fix(root): x\n\nbody\nCI-Fix: true\n')
  run(m)
  assert.equal(g('rev-list', '--count', 'HEAD').trim(), '2')
  const msg = g('log', '-1', '--format=%B')
  assert.equal(msg.split('\n').filter(l => l.trim() === 'CI-Fix: true').length, 1)
  assert.equal(g('log', '-1', '--format=%cn').trim(), 'claude[bot]')
  // The commit the script really made must keep the owner's earlier `ok` standing.
  const [cn, date, body] = g('log', '-1', '--format=%cn%x00%cI%x00%B').split('\0')
  const commit = { parents: [{}], committer: { login: cn }, commit: { message: body, committer: { name: cn, date } } }
  const ok = { user: { login: 'pmcp', type: 'User' }, body: 'ok', created_at: '2000-01-01T00:00:00Z' }
  assert.equal(ownerMergeGo({ owner: 'pmcp', comments: [ok], commits: [commit] }).go, true)
})

test('no message file -> nothing committed', () => {
  const { d, g, run } = repo()
  writeFileSync(join(d, 'a'), '2'); g('add', 'a')
  run(join(d, 'missing'))
  assert.equal(g('rev-list', '--count', 'HEAD').trim(), '1')
})

test('message but nothing staged -> nothing committed', () => {
  const { d, g, run } = repo()
  const m = join(d, '..', `n-${Date.now()}`); writeFileSync(m, 'fix: y')
  run(m)
  assert.equal(g('rev-list', '--count', 'HEAD').trim(), '1')
})

test('leftovers (unstaged edits, untracked files) are wiped, staged or not', () => {
  const { d, g, run } = repo()
  writeFileSync(join(d, 'a'), '2'); writeFileSync(join(d, 'junk'), 'x')
  run(join(d, 'missing'))
  assert.equal(g('status', '--porcelain').trim(), '')
  writeFileSync(join(d, 'b'), '3'); g('add', 'b'); writeFileSync(join(d, 'junk'), 'x')
  const m = join(d, '..', `o-${Date.now()}`); writeFileSync(m, 'fix: z')
  run(m)
  assert.equal(g('status', '--porcelain').trim(), '')
})

test('the gitignored package-edit approval file does not survive the clean', () => {
  const { d, g, run } = repo()
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.gitignore'), '.claude/.package-edit-approved\n'); g('add', '.gitignore'); g('commit', '-qm', 'ignore')
  writeFileSync(join(d, '.claude/.package-edit-approved'), 'pkg\n')
  writeFileSync(join(d, 'a'), '2'); g('add', 'a')
  const m = join(d, '..', `p-${Date.now()}`); writeFileSync(m, 'fix: p')
  run(m)
  assert.equal(existsSync(join(d, '.claude/.package-edit-approved')), false)
})

test('workflow runs the script from a copy of origin/<default>, and fails loudly when it is missing there', () => {
  const wf = readFileSync(resolve('.github/workflows/fix-ci-on-failure.yml'), 'utf8')
  const m = wf.match(/- name: Commit the staged fix[\s\S]*?run: \|\n([\s\S]*?)\n\s*\n/)
  assert.ok(m, 'commit step present')
  const snippet = m[1].split('\n').map(l => l.replace(/^ {10}/, '')).join('\n')
  assert.match(snippet, /git show "origin\/\$DEFAULT_BRANCH:scripts\/commit-ci-fix\.sh" > "\$RUNNER_TEMP\/commit-ci-fix\.sh"/)
  assert.match(snippet, /bash "\$RUNNER_TEMP\/commit-ci-fix\.sh"/)
  // origin/main exists but has no script -> the step must exit non-zero and commit nothing
  const root = mkdtempSync(join(tmpdir(), 'ci-fix-wf-'))
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  const origin = join(root, 'origin'); mkdirSync(origin)
  sh(origin, 'init', '-q', '-b', 'main'); sh(origin, 'config', 'user.name', 'x'); sh(origin, 'config', 'user.email', 'x@x')
  writeFileSync(join(origin, 'a'), '1'); sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 'base')
  const work = join(root, 'work'); execFileSync('git', ['clone', '-q', origin, work])
  sh(work, 'config', 'user.name', 'x'); sh(work, 'config', 'user.email', 'x@x')
  writeFileSync(join(work, 'a'), '2'); sh(work, 'add', 'a')
  writeFileSync(join(root, 'ci-fix-message'), 'fix: q')
  let failed = false
  try {
    execFileSync('bash', ['-c', snippet], { cwd: work, stdio: 'pipe', env: { ...process.env, DEFAULT_BRANCH: 'main', RUNNER_TEMP: root } })
  } catch { failed = true }
  assert.equal(failed, true)
  assert.equal(sh(work, 'rev-list', '--count', 'HEAD').trim(), '1')
})

test('guard step end-to-end: branch cut before the script gets it from origin/main and commits as claude[bot]', () => {
  const wf = readFileSync(resolve('.github/workflows/fix-ci-on-failure.yml'), 'utf8')
  const m = wf.match(/- name: Commit the staged fix[\s\S]*?run: \|\n([\s\S]*?)\n\s*\n/)
  assert.ok(m, 'commit step present')
  const snippet = m[1].split('\n').map(l => l.replace(/^ {10}/, '')).join('\n')
  const root = mkdtempSync(join(tmpdir(), 'ci-fix-e2e-'))
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  const origin = join(root, 'origin'); mkdirSync(origin)
  sh(origin, 'init', '-q', '-b', 'main'); sh(origin, 'config', 'user.name', 'x'); sh(origin, 'config', 'user.email', 'x@x')
  writeFileSync(join(origin, 'a'), '1'); sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 'base')
  sh(origin, 'branch', 'feature') // cut before the script exists
  mkdirSync(join(origin, 'scripts'))
  writeFileSync(join(origin, 'scripts/commit-ci-fix.sh'), readFileSync(script))
  sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 'add script')
  const work = join(root, 'work'); execFileSync('git', ['clone', '-q', '-b', 'feature', origin, work])
  sh(work, 'config', 'user.name', 'x'); sh(work, 'config', 'user.email', 'x@x')
  assert.equal(existsSync(join(work, 'scripts/commit-ci-fix.sh')), false)
  writeFileSync(join(work, 'a'), '2'); sh(work, 'add', 'a')
  writeFileSync(join(root, 'ci-fix-message'), 'fix(root): e2e\n')
  execFileSync('bash', ['-c', snippet], { cwd: work, stdio: 'pipe', env: { ...process.env, DEFAULT_BRANCH: 'main', RUNNER_TEMP: root } })
  assert.equal(sh(work, 'rev-list', '--count', 'origin/feature..HEAD').trim(), '1')
  assert.equal(sh(work, 'log', '-1', '--format=%B').split('\n').filter(l => l.trim() === 'CI-Fix: true').length, 1)
  assert.equal(sh(work, 'log', '-1', '--format=%cn').trim(), 'claude[bot]')
  const [cn, date, body] = sh(work, 'log', '-1', '--format=%cn%x00%cI%x00%B').split('\0')
  const commit = { parents: [{}], committer: { login: cn }, commit: { message: body, committer: { name: cn, date } } }
  const ok = { user: { login: 'pmcp', type: 'User' }, body: 'ok', created_at: '2000-01-01T00:00:00Z' }
  assert.equal(ownerMergeGo({ owner: 'pmcp', comments: [ok], commits: [commit] }).go, true)
})
