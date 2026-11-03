import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureBaseMerged } from './revise-base.mjs'

// main and work diverge from a common commit; HEAD is left on `work`, behind main.
function repo(mainEdit = 'main.txt') {
  const dir = mkdtempSync(join(tmpdir(), 'revbase-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  const put = (f, t) => { writeFileSync(join(dir, f), t); git('add', '-A'); git('commit', '-qm', f) }
  put('a.txt', 'a')
  git('checkout', '-qb', 'work')
  put('work.txt', 'w')
  git('checkout', '-q', 'main')
  put(mainEdit, 'm')
  git('checkout', '-q', 'work')
  return { dir, git }
}

test('behind its base: the base is merged, giving a 2-parent merge commit (PR head + base tip)', () => {
  const { dir, git } = repo()
  const head = git('rev-parse', 'HEAD'), tip = git('rev-parse', 'main')
  const r = ensureBaseMerged({ cwd: dir, baseRef: 'main' })
  assert.equal(r.action, 'merged')
  assert.deepEqual(git('rev-list', '--parents', '-n1', 'HEAD').split(' ').slice(1), [head, tip])
})

test('already up to date: HEAD is untouched', () => {
  const { dir, git } = repo()
  git('merge', '--no-edit', 'main')
  const before = git('rev-parse', 'HEAD')
  const r = ensureBaseMerged({ cwd: dir, baseRef: 'main' })
  assert.equal(r.action, 'current')
  assert.equal(git('rev-parse', 'HEAD'), before)
})

test('unmergeable base: fails loudly, leaves the tree clean and HEAD unchanged', () => {
  const { dir, git } = repo('work.txt')
  const before = git('rev-parse', 'HEAD')
  const r = ensureBaseMerged({ cwd: dir, baseRef: 'main' })
  assert.equal(r.ok, false)
  assert.equal(git('rev-parse', 'HEAD'), before)
  assert.equal(git('status', '--porcelain'), '')
})

test('conflict path is skipped', () => {
  const { dir } = repo()
  assert.equal(ensureBaseMerged({ cwd: dir, baseRef: 'main', conflict: true }).action, 'skipped')
})

// Leaf cut from `epic`; main moves on afterwards. The base choice decides what the PR diff contains.
test('merging the epic keeps the leaf diff to its own file; merging main drags in main\'s', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'revbase-epic-'))
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    const put = (f) => { writeFileSync(join(dir, f), f); git('add', '-A'); git('commit', '-qm', f) }
    put('a.txt'); git('checkout', '-qb', 'epic'); put('epic.txt')
    git('checkout', '-qb', 'work'); put('leaf.txt')
    git('checkout', '-q', 'main'); put('later.txt'); git('checkout', '-q', 'work')
    return { dir, git }
  }
  const a = setup()
  ensureBaseMerged({ cwd: a.dir, baseRef: 'epic' })
  assert.equal(a.git('diff', '--name-only', 'epic...work'), 'leaf.txt')
  const b = setup()
  ensureBaseMerged({ cwd: b.dir, baseRef: 'main' })
  assert.match(b.git('diff', '--name-only', 'epic...work'), /later\.txt/)
})
