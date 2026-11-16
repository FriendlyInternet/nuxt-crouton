import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, 'fixture-drift.mjs')

function setup() {
  const repo = mkdtempSync(join(tmpdir(), 'drift-'))
  const git = (...a) => execFileSync('git', a, { cwd: repo })
  git('init', '-q')
  mkdirSync(join(repo, 'fx'))
  writeFileSync(join(repo, 'fx/a.ts'), 'one\n')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  return repo
}
const run = repo => spawnSync('node', [script, 'fx'], { cwd: repo, encoding: 'utf8' })

test('clean tree exits 0', () => {
  assert.equal(run(setup()).status, 0)
})

test('edited committed file exits 1 and is named', () => {
  const repo = setup()
  writeFileSync(join(repo, 'fx/a.ts'), 'two\n')
  const r = run(repo)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /fx\/a\.ts/)
})

test('new untracked file exits 1 and is named', () => {
  const repo = setup()
  writeFileSync(join(repo, 'fx/new.ts'), 'x\n')
  const r = run(repo)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /fx\/new\.ts/)
})
