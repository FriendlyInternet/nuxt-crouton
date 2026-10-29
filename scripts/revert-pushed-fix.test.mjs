// layer: harness
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, 'revert-pushed-fix.sh')
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()

test('a refused fix that was already pushed ends with branch content equal to PRE', () => {
  const root = mkdtempSync(join(tmpdir(), 'revert-fix-'))
  const remote = join(root, 'remote.git'), work = join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'clone', '-q', remote, work)
  writeFileSync(join(work, 'a.txt'), 'worker line\n')
  git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'worker'); git(work, 'push', '-q', 'origin', 'HEAD:main')
  const pre = git(work, 'rev-parse', 'HEAD')
  // the agent "fixes" by deleting a line and adding a file, and pushes anyway
  writeFileSync(join(work, 'a.txt'), '')
  writeFileSync(join(work, 'extra.txt'), 'x\n')
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'bad fix'); git(work, 'push', '-q', 'origin', 'HEAD:main')

  execFileSync('bash', [script, pre, 'main', git(work, 'rev-parse', 'HEAD')], { cwd: work })

  assert.equal(git(work, 'rev-parse', 'origin/main^{tree}'), git(work, 'rev-parse', `${pre}^{tree}`))
  assert.equal(git(root, '--git-dir', remote, 'rev-parse', 'main^{tree}'), git(work, 'rev-parse', `${pre}^{tree}`))
  assert.equal(git(root, '--git-dir', remote, 'log', '--format=%s', '-1', 'main').startsWith('Revert'), true)
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'revert-fix-'))
  const remote = join(root, 'remote.git'), work = join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'clone', '-q', remote, work)
  writeFileSync(join(work, 'a.txt'), 'one\ntwo\nthree\n')
  git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'worker'); git(work, 'push', '-q', 'origin', 'HEAD:main')
  const pre = git(work, 'rev-parse', 'HEAD')
  writeFileSync(join(work, 'fix.txt'), 'fix\n')
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'fixbot'); git(work, 'push', '-q', 'origin', 'HEAD:main')
  const fix = git(work, 'rev-parse', 'HEAD')
  return { work, pre, fix }
}

test('a worker commit pushed after the fix survives the undo (#2978)', () => {
  const { work, pre, fix } = setup()
  writeFileSync(join(work, 'worker2.txt'), 'revision\n')
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'worker revision'); git(work, 'push', '-q', 'origin', 'HEAD:main')

  execFileSync('bash', [script, pre, 'main', fix], { cwd: work })

  assert.equal(existsSync(join(work, 'worker2.txt')), true)
  assert.equal(existsSync(join(work, 'fix.txt')), false)
})

test('a conflicting undo pushes nothing and exits non-zero (#2978)', () => {
  const { work, pre, fix } = setup()
  writeFileSync(join(work, 'fix.txt'), 'worker edited the fix file\n')
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'worker touches fix'); git(work, 'push', '-q', 'origin', 'HEAD:main')
  const before = git(work, 'rev-parse', 'origin/main')

  assert.throws(() => execFileSync('bash', [script, pre, 'main', fix], { cwd: work, stdio: 'pipe' }))

  git(work, 'fetch', '-q', 'origin')
  assert.equal(git(work, 'rev-parse', 'origin/main'), before)
  assert.equal(readFileSync(join(work, 'fix.txt'), 'utf8'), 'worker edited the fix file\n')
})
