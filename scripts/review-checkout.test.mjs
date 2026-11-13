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
import { fileURLToPath } from 'node:url'
import { checkoutForReview, trustedImportClosure, relativeSpecifiers } from './review-checkout.mjs'

const MAIN_SETTINGS = '{"defaultProvider":"claude-bridge","packages":["npm:pi-claude-bridge@0.9.3"]}\n'
const OLD_SETTINGS = '{"defaultProvider":"claude-cli","packages":["npm:pi-claude-cli"]}\n'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const commit = (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git(cwd, 'rev-parse', 'HEAD').trim() }

/** origin with `main` (+ trusted .pi), and a head commit (built by `editHead`) pushed to refs/pull/7/head. */
function setup(t, editHead, { mainPi = true, mainExtDeps = false, headRef = 'refs/pull/7/head', git: gitImpl, sha: shaOverride } = {}) {
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
    if (mainExtDeps) {
      // #3874 — trusted extensions import scripts/ files the old head lacks (or has stale).
      put(author, '.pi/extensions/finish-check.ts', 'import { x } from "../../scripts/lib/loop.mjs";\nexport default () => x\n')
      put(author, 'scripts/lib/loop.mjs', "export * from './dep.mjs'\n")
      put(author, 'scripts/lib/dep.mjs', 'export const x = 1\n')
      put(author, '.pi/extensions/packages-notice.ts', "import { a, b } from '../../src/a.js'\nexport default () => a + b\n")
      put(author, 'src/a.js', 'export const a = 1\nexport const b = 2\n')
    }
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
  git(author, 'push', '-q', 'origin', `HEAD:${headRef}`)
  git(root, 'clone', '-q', origin, work)
  // setup-pi installs main's packages into the untracked, ignored .pi/npm/ before the checkout.
  put(work, '.pi/npm/.gitignore', '*\n')
  put(work, '.pi/npm/installed.txt', 'pi-claude-bridge\n')
  const diffFile = join(root, 'diff.patch')
  const logs = []
  const target = shaOverride ?? sha
  const run = () => checkoutForReview({ cwd: work, base: 'main', pr: '7', sha: target, trusted: 'origin/main', diffFile, log: (l) => logs.push(l), ...(gitImpl ? { git: gitImpl } : {}) })
  return { work, sha: target, diffFile, logs, run }
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
  assert.match(s.logs[1], /^reviewer extension deps: 0 files from origin\/main \(none\)$/)
  assert.match(s.logs[2], /^diff\.patch: \d+ bytes$/)
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

// #3796 — GitHub does not always create refs/pull/<n>/head; the head is fetched by its sha first.
test('a head with no refs/pull/<n>/head (only its branch) is fetched by sha', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'hello from the branch\n'), { headRef: 'refs/heads/work-7' })
  s.run()
  assert.equal(git(s.work, 'rev-parse', 'HEAD').trim(), s.sha)
  assert.match(readFileSync(s.diffFile, 'utf8'), /\+hello from the branch/)
  assert.equal(readFileSync(join(s.work, '.pi/settings.json'), 'utf8'), MAIN_SETTINGS)
})

test('a failing sha fetch falls back to pull/<pr>/head', (t) => {
  const fetches = []
  let headSha
  const wrapped = (args, opts) => {
    if (args[0] === 'fetch') {
      fetches.push(args)
      if (args.includes(headSha)) throw new Error('simulated: sha fetch refused')
    }
    return execFileSync('git', args, { maxBuffer: 1024 * 1024 * 512, ...opts })
  }
  const s = setup(t, (dir) => put(dir, 'README.md', 'via pull ref\n'), { git: wrapped })
  headSha = s.sha
  s.run()
  assert.equal(fetches.length, 2)
  assert.ok(fetches[0].includes(s.sha), 'first fetch is by sha')
  assert.ok(fetches[1].includes('pull/7/head'), 'second fetch is the pull ref')
  assert.ok(!fetches[1].includes(s.sha))
  assert.equal(git(s.work, 'rev-parse', 'HEAD').trim(), s.sha)
  assert.ok(s.logs.some((l) => /falling back to pull\/7\/head/.test(l)))
})

test('a sha neither fetch can find fails loudly', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'x\n'), { headRef: 'refs/heads/work-7', sha: 'deadbeef'.repeat(5) })
  assert.throws(s.run)
})

// #3874 — the trusted extensions' relative import closure comes from <trusted> too.
function worktreeClosure(work) {
  const out = new Set()
  const queue = git(work, 'ls-tree', '-r', '--name-only', 'origin/main', '--', '.pi/extensions').split('\n').filter(Boolean)
  while (queue.length) {
    const f = queue.shift()
    assert.ok(existsSync(join(work, f)), `${f} must exist in the worktree`)
    for (const spec of relativeSpecifiers(readFileSync(join(work, f), 'utf8'))) {
      const target = join(dirname(f), spec)
      if (out.has(target)) continue
      out.add(target)
      queue.push(target)
    }
  }
  return [...out]
}

test('every trusted extension\'s relative imports resolve on an old head', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'old head\n'), { mainExtDeps: true })
  s.run()
  const deps = worktreeClosure(s.work)
  assert.deepEqual(deps.sort(), ['scripts/lib/dep.mjs', 'scripts/lib/loop.mjs', 'src/a.js'])
  for (const f of deps) assert.equal(readFileSync(join(s.work, f), 'utf8'), git(s.work, 'show', `origin/main:${f}`), `${f} is main's`)
})

test('a stale dep the head has is replaced by trusted\'s, but the head\'s version stays as data', (t) => {
  const s = setup(t, (dir) => put(dir, 'src/a.js', 'export const a = 42\n'), { mainExtDeps: true })
  s.run()
  assert.equal(readFileSync(join(s.work, 'src/a.js'), 'utf8'), 'export const a = 1\nexport const b = 2\n')
  assert.equal(git(s.work, 'show', 'HEAD:src/a.js'), 'export const a = 42\n')
  assert.match(readFileSync(s.diffFile, 'utf8'), /\+export const a = 42/)
})

test('files outside the closure stay the head\'s', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'head readme\n'), { mainExtDeps: true })
  s.run()
  assert.equal(readFileSync(join(s.work, 'README.md'), 'utf8'), 'head readme\n')
  assert.equal(existsSync(join(s.work, 'other.txt')), false, 'main-only file outside the closure is not brought in')
})

test('the log names the restored extension deps', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'x\n'), { mainExtDeps: true })
  const r = s.run()
  assert.deepEqual(r.extDeps, ['scripts/lib/dep.mjs', 'scripts/lib/loop.mjs', 'src/a.js'])
  assert.ok(s.logs.some((l) => /^reviewer extension deps: 3 files from origin\/main \(scripts\/lib\/dep\.mjs, scripts\/lib\/loop\.mjs, src\/a\.js\)$/.test(l)))
})

test('the real repo\'s closure covers what the extensions import', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const run = (args) => execFileSync('git', args, { cwd, maxBuffer: 1024 * 1024 * 512 })
  // The staged tree, not HEAD: the conflict resolver runs this suite on an uncommitted merge (#3893).
  const closure = trustedImportClosure({ run, trusted: run(['write-tree']).toString('utf8').trim() })
  for (const f of ['scripts/lib/finish-check-loop.mjs', 'scripts/packages-guard.mjs', 'scripts/pi-edited-files.mjs']) {
    assert.ok(closure.includes(f), `closure includes ${f} (got ${closure.join(', ')})`)
  }
  assert.ok(closure.every((f) => !f.startsWith('.pi/')))
})

test('the closure judges the staged tree, not the last commit (an uncommitted merge)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'review-checkout-staged-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, 'init', '-q', '-b', 'main')
  put(root, 'README.md', 'x\n')
  commit(root, 'no extensions')
  put(root, '.pi/extensions/x.ts', "import { y } from '../../scripts/lib/y.mjs'\nexport default () => y\n")
  put(root, 'scripts/lib/y.mjs', 'export const y = 1\n')
  git(root, 'add', '-A')
  const run = (args) => execFileSync('git', args, { cwd: root })
  assert.deepEqual(trustedImportClosure({ run, trusted: 'HEAD' }), [])
  assert.deepEqual(trustedImportClosure({ run, trusted: run(['write-tree']).toString('utf8').trim() }), ['scripts/lib/y.mjs'])
})

test('a trusted extension importing a missing file fails loudly', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'x\n'))
  put(s.work, '.pi/extensions/broken.ts', "import { y } from '../../scripts/gone.mjs'\n")
  commit(s.work, 'broken trusted tree')
  const run = (args) => execFileSync('git', args, { cwd: s.work })
  assert.throws(() => trustedImportClosure({ run, trusted: 'HEAD' }), /\.\.\/\.\.\/scripts\/gone\.mjs/)
})

test('a trusted ref without .pi/settings.json refuses to pin', (t) => {
  const s = setup(t, (dir) => put(dir, 'README.md', 'x\n'), { mainPi: false })
  assert.throws(s.run, /trusted ref origin\/main has no \.pi\/settings\.json — reviewer settings cannot be pinned/)
})
