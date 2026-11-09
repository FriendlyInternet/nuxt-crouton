import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fallowBaseArgs, auditCommand, assertRefExists } from './fallow-audit.mjs'

const EPIC = 'epic/3047-status-app-one-page-each-app-card-holds'

test('push → fallow default', () => {
  assert.deepEqual(fallowBaseArgs({ event: 'push', baseRef: '' }), [])
})
test('PR into main', () => {
  assert.deepEqual(fallowBaseArgs({ event: 'pull_request', baseRef: 'main' }), ['--base', 'origin/main'])
})
test('PR into epic uses the epic, never main', () => {
  assert.deepEqual(fallowBaseArgs({ event: 'pull_request', baseRef: EPIC }), ['--base', `origin/${EPIC}`])
})
test('PR with empty/blank base → default', () => {
  assert.deepEqual(fallowBaseArgs({ event: 'pull_request', baseRef: '' }), [])
  assert.deepEqual(fallowBaseArgs({ event: 'pull_request', baseRef: '  ' }), [])
})
test('auditCommand keeps passthrough order', () => {
  assert.deepEqual(
    auditCommand({ event: 'pull_request', baseRef: 'epic/x', passthrough: ['--coverage', 'c.json', '--coverage-root', '/w'] }),
    ['fallow', 'audit', '--base', 'origin/epic/x', '--coverage', 'c.json', '--coverage-root', '/w'],
  )
})

const dir = mkdtempSync(join(tmpdir(), 'fallow-audit-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
const add = (f) => { writeFileSync(join(dir, f), f); git('add', f); git('commit', '-qm', f) }
git('init', '-q', '-b', 'main')
git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
add('base.ts')
git('checkout', '-q', '-b', 'epic/x'); add('sibling.ts')
git('checkout', '-q', '-b', 'pr'); add('own.ts')
git('update-ref', 'refs/remotes/origin/main', 'main')
git('update-ref', 'refs/remotes/origin/epic/x', 'epic/x')

test('PR into epic sees only its own files; main base also sees sibling', () => {
  const ref = fallowBaseArgs({ event: 'pull_request', baseRef: 'epic/x' })[1]
  assert.deepEqual(git('diff', '--name-only', `${ref}...pr`).split('\n'), ['own.ts'])
  assert.deepEqual(git('diff', '--name-only', 'origin/main...pr').split('\n'), ['own.ts', 'sibling.ts'])
})

test('assertRefExists', () => {
  assert.throws(() => assertRefExists('origin/epic/missing', dir), /fetch-depth/)
  assert.doesNotThrow(() => assertRefExists('origin/epic/x', dir))
})
