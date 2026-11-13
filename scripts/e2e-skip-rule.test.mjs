// e2e skip rule (#3446) — runs the REAL `changes` step script from e2e.yml in a throwaway git repo,
// so flipping the workflow condition makes these tests fail (#3449).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync as rd } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../.github/workflows/e2e.yml'), 'utf8')
const m = wf.match(/- id: filter\n(?:.*\n)*?\s+run: \|\n((?:\s{10}.*\n|\n)+)/)
assert.ok(m, 'could not find the filter step in e2e.yml')
const script = m[1].split('\n').map(l => l.slice(10)).join('\n')

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

function run(baseRef, changed, { event = 'pull_request', envBase = baseRef, raw = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-skip-'))
  const origin = join(root, 'origin'); const work = join(root, 'work')
  mkdirSync(origin); git(origin, 'init', '-q', '-b', baseRef)
  writeFileSync(join(origin, 'README.md'), 'x'); git(origin, 'add', '.'); git(origin, 'commit', '-qm', 'base')
  git(root, 'clone', '-q', origin, work)
  git(work, 'checkout', '-qb', 'feature')
  for (const f of changed) { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), 'y') }
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'change')
  const out = join(root, 'out')
  writeFileSync(out, '')
  const res = spawnSync('bash', ['-c', script], { cwd: work, encoding: 'utf8', env: { ...process.env, EVENT: event, BASE_REF: envBase, GITHUB_OUTPUT: out } })
  if (raw) return res
  assert.equal(res.status, 0, res.stdout + res.stderr)
  return Object.fromEntries(rd(out, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('=')))
}

test('leaf PR into epic/* touching packages skips the matrix', () => {
  const o = run('epic/1-x', ['packages/crouton-core/a.ts'])
  assert.equal(o.relevant, 'false'); assert.equal(o.base_is_epic, 'true')
})
test('epic PR touching fixtures/ or e2e/ still runs', () => {
  assert.equal(run('epic/1-x', ['fixtures/minimal/a.ts']).relevant, 'true')
  assert.equal(run('epic/1-x', ['e2e/a.ts']).relevant, 'true')
})
test('PR into main touching packages runs (flip check: not skipped)', () => {
  const o = run('main', ['packages/crouton-core/a.ts'])
  assert.equal(o.relevant, 'true'); assert.equal(o.base_is_epic, undefined)
})
test('PR into main touching only docs skips', () => {
  assert.equal(run('main', ['docs/a.md']).relevant, 'false')
})
test('base branch fetch fails → exit 1 with ::error::', () => {
  const r = run('main', ['docs/a.md'], { envBase: 'no-such-branch', raw: true })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /::error::Could not fetch the PR base branch/)
})
test('push event → relevant=true', () => {
  assert.equal(run('main', ['docs/a.md'], { event: 'push' }).relevant, 'true')
})
test('extracted filter script is non-empty and mentions epic/*', () => {
  assert.ok(script.trim().length > 0)
  assert.ok(script.includes('epic/*'))
})
