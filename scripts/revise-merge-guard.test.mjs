// Unit tests for the worker-left merge guard (#3704).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectWorkerMerge, refusalBody, alreadyPosted, markerFor } from './revise-merge-guard.mjs'

const CLI = new URL('./revise-merge-guard.mjs', import.meta.url).pathname

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'rmg-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n'); git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work'); writeFileSync(join(dir, 'w.txt'), 'w\n'); git('add', '-A'); git('commit', '-qm', 'w')
  git('checkout', '-q', 'main'); writeFileSync(join(dir, 'm1.txt'), '1\n'); writeFileSync(join(dir, 'm2.txt'), '2\n'); git('add', '-A'); git('commit', '-qm', 'm')
  git('checkout', '-q', 'work')
  return { dir, git }
}

test('merge in progress -> refuse, kind merge, ref main, file count', () => {
  const { dir, git } = repo()
  git('merge', '--no-commit', '--no-ff', 'main')
  const d = detectWorkerMerge({ cwd: dir })
  assert.deepEqual(d, { refuse: true, kind: 'merge', ref: 'main', files: 2 })
})

test('squash in progress -> refuse, kind squash', () => {
  const { dir, git } = repo()
  git('merge', '--squash', 'main')
  const d = detectWorkerMerge({ cwd: dir })
  assert.equal(d.refuse, true)
  assert.equal(d.kind, 'squash')
})

test('clean tree, or a committed merge -> no refusal', () => {
  const { dir, git } = repo()
  assert.deepEqual(detectWorkerMerge({ cwd: dir }), { refuse: false })
  writeFileSync(join(dir, 'w.txt'), 'edit\n')
  assert.deepEqual(detectWorkerMerge({ cwd: dir }), { refuse: false })
  git('checkout', '-q', '--', 'w.txt')
  git('merge', '--no-edit', 'main')
  assert.deepEqual(detectWorkerMerge({ cwd: dir }), { refuse: false })
})

test('refusalBody: file count, base, marker, update-the-base sentence', () => {
  const marker = markerFor('abc1234def')
  const b = refusalBody({ ref: 'main', files: 267, base: 'epic/1-x', headShort: 'abc1234', marker })
  assert.ok(b.startsWith(marker))
  assert.match(b, /267 files/)
  assert.match(b, /update `epic\/1-x` itself/)
  assert.match(b, /unchanged at `abc1234`/)
  assert.match(b, /pi\.dev harness/)
})

test('refusalBody: no update-the-base sentence when ref is the base, or a squash', () => {
  for (const args of [{ ref: 'main', base: 'main' }, { ref: 'a squash merge', base: 'epic', kind: 'squash' }]) {
    const b = refusalBody({ files: 3, headShort: 'abc', marker: 'm', ...args })
    assert.doesNotMatch(b, /itself/)
    assert.match(b, /comment again and I will redo it without the merge/)
  }
})

test('alreadyPosted: same marker true, another head false', () => {
  const body = refusalBody({ ref: 'main', files: 1, base: 'epic', headShort: 'a', marker: markerFor('aaa') })
  assert.equal(alreadyPosted([body], markerFor('aaa')), true)
  assert.equal(alreadyPosted([body], markerFor('bbb')), false)
  assert.equal(alreadyPosted([], markerFor('aaa')), false)
})

test('CLI: exit 0 on a clean tree, exit 3 on a merge in progress', () => {
  const { dir, git } = repo()
  const clean = spawnSync(process.execPath, [CLI, 'epic', 'abc', ''], { cwd: dir, encoding: 'utf8' })
  assert.equal(clean.status, 0)
  assert.equal(clean.stdout, '')
  git('merge', '--no-commit', '--no-ff', 'main')
  const r = spawnSync(process.execPath, [CLI, 'epic', 'abc', ''], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 3)
  assert.match(r.stdout, /worker left a merge of main in progress \(2 files\) — pushing nothing \(#3704\)/)
})
