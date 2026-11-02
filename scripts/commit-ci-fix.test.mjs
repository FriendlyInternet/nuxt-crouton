import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
