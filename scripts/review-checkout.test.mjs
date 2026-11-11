/**
 * #3696 — the build reviewer gets the PR head as data but the default branch's `.pi/`.
 * Every case builds a REAL git setup (bare origin + clone, head pushed to refs/pull/7/head) and
 * calls the real checkoutForReview with real git.
 *
 *   node --test scripts/review-checkout.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { checkoutForReview } from './review-checkout.mjs'

const MAIN_SETTINGS = '{"defaultProvider":"claude-bridge","packages":["npm:pi-claude-bridge@0.9.3"]}\n'
const OLD_SETTINGS = '{"defaultProvider":"claude-cli","packages":["npm:pi-claude-cli"]}\n'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const commit = (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git(cwd, 'rev-parse', 'HEAD').trim() }

/** origin with `main` (+ trusted .pi), and a head commit (built by `editHead`) pushed to refs/pull/7/head. */
function setup(t, editHead, { mainPi = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'review-checkout-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const origin = join(root, 'origin.git')
  const author = join(root, 'author')
  const work = join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, author)
  git(author, 'checkout', '-q', '-b', 'main')
  put(author, 'README.md', 'hello\n')
  put(author, 'src/a.js', 'export const a = 1\n')
  put(author, '.pi/settings.json', OLD_SETTINGS)
  const fork = commit(author, 'fork point')
  // main moves on: the reviewer's settings land after the branch was cut.
  if (mainPi) {
    put(author, '.pi/settings.json', MAIN_SETTINGS)
    put(author, '.pi/extensions/complete-work.ts', 'export default () => {}\n')
  } else {
    rmSync(join(author, '.pi'), { recursive: true, force: true })
  }
  put(author, 'other.txt', 'main only\n')
  commit(author, 'main moves on')
  git(author, 'push', '-q', 'origin', 'main')
  // The PR head.
  git(author, 'checkout', '-q', '-b', 'head', mainPi && editHead.fromMain ? 'main' : fork)
  editHead(author)
  const sha = commit(author, 'head change')
  git(author, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head')
  git(root, 'clone', '-q', origin, work)
  // setup-pi installs main's packages into the untracked, ignored .pi/npm/ before the checkout.
  put(work, '.pi/npm/.gitignore', '*\n')
  put(work, '.pi/npm/installed.txt', 'pi-claude-bridge\n')
  const diffFile = join(root, 'diff.patch')
  const logs = []
  const run = () => checkoutForReview({ cwd: work, base: 'main', pr: '7', sha, trusted: 'origin/main', diffFile, log: (l) => logs.push(l) })
  return { work, sha, diffFile, logs, run }
}

test('an old head (cut before claude-bridge) gets main\'s .pi but keeps its own files', (t) => {
  const s = setup(t, (dir) => {
    put(dir, '.pi/extensions/old.ts', 'export default () => { throw new Error("head code") }\n')
    put(dir, 'README.md', 'hello from the PR\n')
  })
  s.run()
  assert.equal(readFileSync(join(s.work, '.pi/settings.json'), 'utf8'), MAIN_SETTINGS)
  assert.equal(existsSync(join(s.work, '.pi/extensions/old.ts')), false, 'the head\'s extension must not be loadable')
  assert.equal(existsSync(join(s.work, '.pi/extensions/complete-work.ts')), true)
  assert.equal(readFileSync(join(s.work, 'README.md'), 'utf8'), 'hello from the PR\n')
  assert.equal(existsSync(join(s.work, '.pi/npm/installed.txt')), true, 'setup-pi\'s untracked install survives')
  const diff = readFileSync(s.diffFile, 'utf8')
  assert.match(diff, /\+hello from the PR/)
  assert.match(s.logs[0], /^reviewer settings: \.pi\/ from origin\/main \(defaultProvider claude-bridge, 1 packages\)/)
  assert.match(s.logs[1], /^diff\.patch: \d+ bytes$/)
})

test('a current head (same .pi as main) checks out exactly as before', (t) => {
  const fromMain = (dir) => put(dir, 'src/a.js', 'export const a = 2\n')
  fromMain.fromMain = true
  const s = setup(t, fromMain)
  s.run()
  assert.equal(git(s.work, 'status', '--porcelain'), '')
  assert.equal(git(s.work, 'rev-parse', 'HEAD').trim(), s.sha)
  const expected = git(s.work, 'diff', '-C', '--find-copies-harder', '--no-color', `origin/main...${s.sha}`)
  assert.equal(readFileSync(s.diffFile, 'utf8'), expected)
})

test('a head that edits .pi keeps that edit as data (diff + git show HEAD), not in the worktree', (t) => {
  const edit = (dir) => put(dir, '.pi/settings.json', '{"defaultProvider":"evil","packages":["npm:evil"]}\n')
  edit.fromMain = true
  const s = setup(t, edit)
  s.run()
  assert.equal(readFileSync(join(s.work, '.pi/settings.json'), 'utf8'), MAIN_SETTINGS)
  const diff = readFileSync(s.diffFile, 'utf8')
  assert.match(diff, /diff --git a\/\.pi\/settings\.json b\/\.pi\/settings\.json/)
  assert.match(diff, /\+\{"defaultProvider":"evil"/)
  assert.match(git(s.work, 'show', 'HEAD:.pi/settings.json'), /"evil"/)
})

test('build-review.yml checks out the head only through review-checkout.mjs, pinned to the default branch', () => {
  const wf = readFileSync(new URL('../.github/workflows/build-review.yml', import.meta.url), 'utf8')
  assert.match(wf, /node scripts\/review-checkout\.mjs --base "\$BASE" --pr "\$PR" --sha "\$SHA" --trusted "origin\/\$\{\{ github\.event\.repository\.default_branch \}\}" --diff "\$D\/diff\.patch"/)
  assert.doesNotMatch(wf, /git checkout --detach/, 'a raw checkout would bring the head\'s .pi/ back')
  assert.ok(wf.indexOf('review-checkout.mjs --base') < wf.indexOf('pi --print --approve'), 'the pin happens before pi starts')
  assert.match(wf, /fail "produced no verdict\$\(node "\$RUNNER_TEMP\/trusted\/build-verdict\.mjs" stop-line "\$D\/pi\.log"\)"/)
})

test('a trusted ref without .pi/settings.json refuses to pin', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'x\n'), { mainPi: false })
  assert.throws(s.run, /trusted ref origin\/main has no \.pi\/settings\.json — reviewer settings cannot be pinned/)
})
