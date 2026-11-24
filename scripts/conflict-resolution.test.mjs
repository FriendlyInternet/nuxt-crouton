import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatorsFor, withMarkers, verdict, buildPrompt, resolutionPaths, SCRIPTS_TEST_CMD, INSTALL_CMD } from './conflict-resolution.mjs'

// A real conflict run sets PKG_DIST_REF for the tool, and it runs this suite as its check (#4374).
// Every `verify` these tests start in a scratch repo would inherit it, try a package build there
// and fail. Clear it once; the tests that are about it pass it explicitly.
delete process.env.PKG_DIST_REF

// A real conflicted merge: `base` and `side` both edit `file` from a common ancestor.
function conflict(file, ancestor, base, side) {
  const dir = mkdtempSync(join(tmpdir(), 'conflict-'))
  const git = (...a) => { try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8' }) } catch (e) { return e.stdout || '' } }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  const put = (t) => { writeFileSync(join(dir, file), t); git('add', '-A'); git('commit', '-qm', 'c') }
  put(ancestor)
  git('checkout', '-qb', 'work')
  put(side)
  git('checkout', '-q', 'main')
  put(base)
  git('checkout', '-q', 'work')
  git('merge', '--no-edit', 'main')
  return { unmerged: git('diff', '--name-only', '--diff-filter=U').trim(), text: readFileSync(join(dir, file), 'utf8') }
}

test('PR #2781 shape: two tests added at the same spot conflict, and the conflict is detected', () => {
  const head = "import { test } from 'node:test'\n"
  const r = conflict('apply.test.mjs', head, head + "test('base added', () => {})\n", head + "test('pr added', () => {})\n")
  assert.equal(r.unmerged, 'apply.test.mjs')
  assert.deepEqual(withMarkers({ 'apply.test.mjs': r.text }), ['apply.test.mjs'])
  // the resolution keeps both
  const resolved = head + "test('base added', () => {})\ntest('pr added', () => {})\n"
  assert.deepEqual(withMarkers({ 'apply.test.mjs': resolved }), [])
  assert.equal(verdict({ choiceText: '', markerFiles: [] }).status, 'resolved')
})

test('PR #2796 shape: routing.json + its generated registry map to gen-routing (run + --check)', () => {
  const gens = generatorsFor(['.claude/routing.json', 'writeups/architecture/routing-registry.md'])
  assert.deepEqual(gens.map((g) => g.name), ['gen-routing'])
  assert.match(gens[0].check, /gen-routing\.mjs --check/)
})

test('generators are matched by input or output, and unrelated files match none', () => {
  assert.deepEqual(generatorsFor(['pnpm-lock.yaml']).map((g) => g.name), ['lockfile'])
  assert.deepEqual(generatorsFor(['packages/crouton-auth/package.json']).map((g) => g.name), ['gen-package-catalog'])
  assert.deepEqual(generatorsFor(['scripts/foo.mjs']), [])
})

test('both sides editing the same function body ends in a choice, never a silent resolution', () => {
  const anc = 'function f() {\n  return 1\n}\n'
  const r = conflict('f.mjs', anc, 'function f() {\n  return 2\n}\n', 'function f() {\n  return 3\n}\n')
  assert.equal(r.unmerged, 'f.mjs')
  // pi found incompatible intents and wrote a choice: the verdict is `choice` even though markers remain
  const v = verdict({ choiceText: 'A: return 2\nB: return 3\nRecommend A', markerFiles: withMarkers({ 'f.mjs': r.text }) })
  assert.equal(v.status, 'choice')
})

test('a leftover marker without a choice fails loudly', () => {
  const v = verdict({ choiceText: '  \n', markerFiles: ['x.mjs'] })
  assert.equal(v.status, 'failed')
  assert.match(v.reason, /x\.mjs/)
})

test('the prompt names the files, the generators, the choice file and the keep-both rule', () => {
  const p = buildPrompt({ base: 'main', files: ['a.mjs'], choiceFile: '/tmp/choice.md' })
  for (const s of ['- a.mjs', 'gen-routing.mjs', 'pnpm install --lockfile-only', '/tmp/choice.md', 'BOTH sides']) assert.ok(p.includes(s), s)
})

test('the resolver prompt tells pi to run the merged-branch install before the tests (#4155)', () => {
  const p = buildPrompt({ base: 'main', files: ['packages/a/x.ts'], choiceFile: '/tmp/choice.md' })
  assert.ok(p.includes(INSTALL_CMD), p)
  assert.ok(p.indexOf(INSTALL_CMD) < p.indexOf('the touched tests'), 'install comes before the tests')
})

test('scripts test command matches the one CI runs', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.ok(ci.includes(`run: ${SCRIPTS_TEST_CMD}`))
})

// ── verify, end to end (#3322): the real CLI in a temp repo mid-merge ──
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./conflict-resolution.mjs', import.meta.url))

function midMerge({ attrs = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('a.md', 'one\n'); put('keep.md', 'ok\n'); git('add', '-A'); git('commit', '-qm', 'base0')
  git('checkout', '-qb', 'work'); put('a.md', 'one\nside\n'); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put('a.md', 'one\nbase\n'); put('keep.md', 'ok   \n\n\n'); put('other.md', 'x  \n')
  if (attrs) put('.gitattributes', 'a.md merge=union\n')
  git('add', '-A'); git('commit', '-qm', 'base1')
  git('checkout', '-q', 'work')
  if (attrs) writeFileSync(join(dir, '.git/info/attributes'), 'a.md merge=union\n')
  const m = git('merge', '--no-edit', 'main')
  const verify = (choice = join(dir, 'none.md')) => spawnSync('node', [CLI, 'verify', choice], { cwd: dir, encoding: 'utf8' })
  return { dir, git, put, verify, m }
}

test('verify: resolved file passes despite whitespace in untouched base files', () => {
  const r = midMerge()
  r.put('a.md', 'one\nbase\nside\n')
  const v = r.verify()
  assert.equal(v.status, 0, v.stderr)
  assert.equal(r.git('commit', '-qm', 'merge').status, 0)
  assert.equal(r.git('rev-list', '--parents', '-n1', 'HEAD').stdout.trim().split(' ').length, 3)
})

test('verify: markers left -> exit 1 naming the file', () => {
  const r = midMerge()
  const v = r.verify()
  assert.equal(v.status, 1)
  assert.match(v.stderr, /a\.md/)
})

test('verify: a choice file -> exit 3', () => {
  const r = midMerge()
  const c = join(r.dir, 'choice.md'); writeFileSync(c, 'A vs B')
  assert.equal(r.verify(c).status, 3)
})

test('verify: whitespace the resolver adds in a conflicted file fails, naming it', () => {
  const r = midMerge()
  r.put('a.md', 'one\nbase   \nside\n')
  const v = r.verify()
  assert.equal(v.status, 1)
  assert.match(v.stderr, /a\.md/)
})

test('resolutionPaths: only conflicted files and their generator outputs, sorted, no duplicates (#3775)', () => {
  assert.deepEqual(resolutionPaths({ modified: ['a.md', 'keep.md', 'a.md'], conflicted: ['a.md'] }), ['a.md'])
  assert.deepEqual(
    resolutionPaths({ modified: ['.claude/routing.json', 'writeups/architecture/routing-registry.md', 'x.md'], conflicted: ['.claude/routing.json'] }),
    ['.claude/routing.json', 'writeups/architecture/routing-registry.md'],
  )
})

test('verify: an edit outside the conflict stays out of the merge (#3775)', () => {
  const r = midMerge()
  r.put('a.md', 'one\nbase\nside\n')
  r.put('keep.md', 'worker extra\n')
  const v = r.verify()
  assert.equal(v.status, 0, v.stderr)
  assert.equal(r.git('commit', '-qm', 'merge').status, 0)
  const inMerge = r.git('show', '--name-only', '--format=', 'HEAD').stdout
  assert.match(inMerge, /^a\.md$/m)
  assert.doesNotMatch(inMerge, /keep\.md/)
  assert.equal(r.git('show', 'HEAD:keep.md').stdout, 'ok   \n\n\n', "the merge holds the base's keep.md")
  assert.equal(r.git('diff', '--name-only').stdout.trim(), 'keep.md', 'left in the worktree for the next commit')
})

test('verify: a generator output of a conflicted input is staged with the merge (#2848 still works)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-gen-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  const R = '.claude/routing.json'; const REG = 'writeups/architecture/routing-registry.md'
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put(R, '{"a":1}\n'); put(REG, 'reg\n'); put('x.md', 'x\n'); git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work'); put(R, '{"a":2}\n'); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put(R, '{"a":3}\n'); git('commit', '-qam', 'base1')
  git('checkout', '-q', 'work'); git('merge', '--no-edit', 'main')
  put(R, '{"a":3,"b":2}\n'); put(REG, 'reg regenerated\n'); put('x.md', 'unrelated\n')
  // stub the gen-routing --check: this fixture has no scripts/, so the real one is not runnable here
  mkdirSync(join(dir, 'scripts')); writeFileSync(join(dir, 'scripts/gen-routing.mjs'), 'process.exit(0)\n')
  const v = spawnSync('node', [CLI, 'verify', join(dir, 'none.md')], { cwd: dir, encoding: 'utf8', env: { ...process.env } })
  assert.equal(v.status, 0, v.stderr)
  const staged = git('diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean).sort()
  assert.deepEqual(staged, [R, REG])
  assert.equal(git('diff', '--name-only').stdout.trim(), 'x.md')
})

test('stale branch with base .gitattributes seeded in info/attributes: merge=union leaves no conflict', () => {
  const r = midMerge({ attrs: true })
  assert.equal(r.git('diff', '--name-only', '--diff-filter=U').stdout.trim(), '')
})

// ── #4320: migrations, end to end, from a lone copy of the script (as work-issue-pidev.yml runs it) ──
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const MIG = 'apps/x/server/db/migrations/sqlite'

// The workflow's lone copy: the script plus lib/log-tail.mjs beside it (#4320, #4374).
function loneCopy() {
  const lone = mkdtempSync(join(tmpdir(), 'lone-'))
  copyFileSync(CLI, join(lone, 'conflict-resolution.mjs'))
  mkdirSync(join(lone, 'lib'))
  copyFileSync(fileURLToPath(new URL('./lib/log-tail.mjs', import.meta.url)), join(lone, 'lib/log-tail.mjs'))
  return lone
}
const jrnl = (tags) => JSON.stringify({ version: '7', dialect: 'sqlite', entries: tags.map((tag, idx) => ({ idx, version: '6', when: idx, tag, breakpoints: true })) }, null, 2) + '\n'

// Both sides add migration 0001 to apps/x: the snapshot (add/add) and the journal conflict.
function migMerge() {
  const lone = loneCopy()
  const dir = mkdtempSync(join(tmpdir(), 'verify-mig-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  // its db:generate would leave a marker: it must never run in these cases
  put('apps/x/package.json', JSON.stringify({ name: 'x', scripts: { 'db:generate': 'node -e "require(\'fs\').writeFileSync(\'GENERATED\', \'1\')"' } }) + '\n')
  put('apps/x/notes.md', 'one\n')
  put(`${MIG}/0000_a.sql`, 'a\n'); put(`${MIG}/meta/0000_snapshot.json`, '{"v":0}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a']))
  git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work')
  put(`${MIG}/0001_side.sql`, 'side\n'); put(`${MIG}/meta/0001_snapshot.json`, '{"v":"side"}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_side']))
  git('add', '-A'); git('commit', '-qm', 'side')
  git('checkout', '-q', 'main')
  put(`${MIG}/0001_base.sql`, 'base\n'); put(`${MIG}/meta/0001_snapshot.json`, '{"v":"base"}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_base']))
  git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-q', 'work')
  assert.notEqual(git('merge', '--no-edit', 'main').status, 0, 'expected a conflict')
  const verify = () => spawnSync('node', [join(lone, 'conflict-resolution.mjs'), 'verify', join(dir, 'none.md')], { cwd: dir, encoding: 'utf8' })
  return { dir, git, put, verify }
}

test('T2 verify (lone copy) refuses a hand-merged migration snapshot, naming it', () => {
  const r = migMerge()
  r.put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_base']))
  r.put(`${MIG}/meta/0001_snapshot.json`, '{"v":"base","w":"side"}\n')
  const v = r.verify()
  assert.equal(v.status, 1, v.stderr)
  assert.match(v.stderr, /hand-edited migration file: apps\/x\/server\/db\/migrations\/sqlite\/meta\/0001_snapshot\.json/)
  assert.ok(!existsSync(join(r.dir, 'GENERATED')))
})

test('T2 verify (lone copy) refuses a hand-edited journal', () => {
  const r = migMerge()
  r.git('checkout', '--theirs', '--', `${MIG}/meta/0001_snapshot.json`)
  r.put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_base', '0002_side']))
  const v = r.verify()
  assert.equal(v.status, 1, v.stderr)
  assert.match(v.stderr, /hand-edited migration journal: apps\/x\/server\/db\/migrations\/sqlite\/meta\/_journal\.json/)
})

test('T2 verify (lone copy) refuses a leftover untracked .sql beside the base journal', () => {
  const r = migMerge()
  r.git('checkout', '--theirs', '--', `${MIG}/meta/0001_snapshot.json`, `${MIG}/meta/_journal.json`)
  rmSync(join(r.dir, `${MIG}/0001_side.sql`))
  r.put(`${MIG}/0001_old.sql`, 'old\n')
  const v = r.verify()
  assert.equal(v.status, 1, v.stderr)
  assert.match(v.stderr, /migration file not in the journal: apps\/x\/server\/db\/migrations\/sqlite\/0001_old\.sql/)
})

test('T2 a conflict in notes.md next to an app runs no db:generate', () => {
  const r = migMerge()
  r.git('merge', '--abort')
  r.git('checkout', '-q', 'main'); r.put('apps/x/notes.md', 'one\nbase\n'); r.git('commit', '-qam', 'n-base')
  r.git('checkout', '-q', 'work'); r.git('reset', '-q', '--hard', 'HEAD~1'); r.put('apps/x/notes.md', 'one\nside\n'); r.git('commit', '-qam', 'n-side')
  assert.notEqual(r.git('merge', '--no-edit', 'main').status, 0)
  assert.equal(r.git('diff', '--name-only', '--diff-filter=U').stdout.trim(), 'apps/x/notes.md')
  r.put('apps/x/notes.md', 'one\nbase\nside\n')
  const v = r.verify()
  assert.equal(v.status, 0, v.stderr)
  assert.ok(!existsSync(join(r.dir, 'GENERATED')), 'db:generate ran for a non-migration conflict')
  assert.ok(!existsSync(join(r.dir, 'apps/x/GENERATED')), 'db:generate ran for a non-migration conflict')
})

test('T2 resolutionPaths keeps untracked generator output in the conflicted migration folder', () => {
  const conflicted = [`${MIG}/meta/0001_snapshot.json`]
  assert.deepEqual(
    resolutionPaths({ modified: [`${MIG}/0001_side.sql`, 'x.md'], conflicted, untracked: [`${MIG}/0002_new.sql`, `${MIG}/meta/0002_snapshot.json`, 'stray.md'] }),
    [`${MIG}/0001_side.sql`, `${MIG}/0002_new.sql`, `${MIG}/meta/0002_snapshot.json`],
  )
})

// ── #4374: rebuild the packages after the merge, and name the failed tests ──
import { runChecks, needsPackageBuild, failedTestsNote, changedSinceBuild, BUILD_CMD } from './conflict-resolution.mjs'
import { chmodSync } from 'node:fs'

/** A fake runner: records each command; `fail` maps a command to the output it fails with. */
function fakeRun(fail = {}) {
  const calls = []; const logs = []
  const run = (cmd) => { calls.push(cmd); return cmd in fail ? { ok: false, output: fail[cmd] } : { ok: true, output: '' } }
  return { calls, logs, run, log: (l) => logs.push(l) }
}

// covers: T1
test('T1 a merge that changed the auth schema: install → build → scripts tests, in that order', () => {
  const f = fakeRun()
  const r = runChecks({ changed: ['packages/crouton-auth/server/database/schema/auth.ts'], conflicted: ['.github/workflows/deploy-app.yml'], run: f.run, log: f.log })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(f.calls, [INSTALL_CMD, BUILD_CMD, SCRIPTS_TEST_CMD])
  assert.ok(f.logs.some((l) => l === 'package build: packages/crouton-auth/server/database/schema/auth.ts'), f.logs.join('\n'))
})

// covers: T2
test('T2 a merge with nothing under packages/: no install, no build, tests run, skip logged', () => {
  const f = fakeRun()
  const r = runChecks({ changed: ['.github/workflows/deploy-app.yml', 'apps/kassa/app/pages/index.vue'], conflicted: ['.github/workflows/deploy-app.yml'], run: f.run, log: f.log })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(f.calls, [SCRIPTS_TEST_CMD])
  const log = f.logs.join('\n')
  assert.match(log, /package build skipped/)
  assert.match(log, /nothing under packages\//)
})

// covers: T3
test('T3 a lockfile-only change needs the build', () => {
  assert.equal(needsPackageBuild(['pnpm-lock.yaml']).build, true)
  const f = fakeRun()
  runChecks({ changed: ['pnpm-lock.yaml'], conflicted: ['pnpm-lock.yaml'], run: f.run, log: f.log })
  assert.ok(f.calls.includes(BUILD_CMD), f.calls.join('\n'))
})

// covers: T4
test('T4 a failed build stops with the build error, and the tests never run', () => {
  const f = fakeRun({ [BUILD_CMD]: 'building…\nERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @fyit/crouton-auth build: exit 1\n' })
  const r = runChecks({ changed: ['packages/a/x.ts'], conflicted: [], run: f.run, log: f.log })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /^package build failed after the merge/)
  assert.ok(r.errors.some((e) => e.includes('ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL')), r.errors.join('\n'))
  assert.ok(!f.calls.includes(SCRIPTS_TEST_CMD))
})

// covers: T5
test('T5 failing scripts tests are named; passing and TODO tests are not', () => {
  const tap = ['TAP version 13', 'ok 1 - gamma', 'not ok 3 - alpha works', '  ---', 'not ok 5 - delta # TODO later', 'not ok 7 - beta works', '# fail 2'].join('\n')
  const f = fakeRun({ [SCRIPTS_TEST_CMD]: tap })
  const r = runChecks({ changed: [], conflicted: [], run: f.run, log: f.log })
  assert.equal(r.ok, false)
  assert.deepEqual(r.errors, ['scripts tests fail after resolution: 2 failed', '  ✖ alpha works', '  ✖ beta works'])
})

// covers: T6
test('T6 six failures → five names and "and 1 more"; no failing line still says more than the bare line', () => {
  const tap = [1, 2, 3, 4, 5, 6].map((n) => `not ok ${n} - case ${n}`).join('\n')
  const note = failedTestsNote(tap)
  assert.equal(note.length, 7)
  assert.equal(note[0], 'scripts tests fail after resolution: 6 failed')
  assert.equal(note[5], '  ✖ case 5')
  assert.equal(note[6], '  and 1 more')
  const bare = failedTestsNote('nothing useful here\n')
  assert.ok(bare.join('\n').length > 'scripts tests fail after resolution'.length, bare)
  assert.notDeepEqual(bare, ['scripts tests fail after resolution'])
})

/** A fake `pnpm` on PATH that only records its arguments. */
function fakePnpm() {
  const bin = mkdtempSync(join(tmpdir(), 'shim-'))
  const log = join(bin, 'pnpm.log')
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\necho "$@" >> "$SHIM_LOG"\n')
  chmodSync(join(bin, 'pnpm'), 0o755)
  writeFileSync(log, '')
  return { bin, log }
}

/** The env for a nested verify: no inherited test-runner context, so its `node --test` prints TAP. */
function cliEnv(extra) {
  const env = { ...process.env, ...extra }
  delete env.NODE_TEST_CONTEXT
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
  return env
}

const passing = (name) => `import { test } from 'node:test'\ntest(${JSON.stringify(name)}, () => {})\n`

// covers: T7
test('T7 verify (lone copy): a failing scripts test is named in an ::error:: line', () => {
  const lone = loneCopy(); const shim = fakePnpm()
  const dir = mkdtempSync(join(tmpdir(), 'verify-names-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('scripts/lib/b.test.mjs', passing('b ok')); put('scripts/a.test.mjs', passing('a0'))
  git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work'); put('scripts/a.test.mjs', passing('a side')); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put('scripts/a.test.mjs', passing('a base')); git('commit', '-qam', 'base')
  git('checkout', '-q', 'work')
  assert.notEqual(git('merge', '--no-edit', 'main').status, 0, 'expected a conflict')
  put('scripts/a.test.mjs', "import { test } from 'node:test'\ntest('stale build canary', () => { throw new Error('stale') })\n")
  const v = spawnSync('node', [join(lone, 'conflict-resolution.mjs'), 'verify', join(dir, 'none.md')], {
    cwd: dir, encoding: 'utf8', env: cliEnv({ PATH: `${shim.bin}:${process.env.PATH}`, SHIM_LOG: shim.log, PKG_DIST_REF: undefined }),
  })
  assert.doesNotMatch(v.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.equal(v.status, 1, v.stderr)
  assert.ok(v.stderr.split('\n').some((l) => l.startsWith('::error::') && l.includes('stale build canary')), v.stderr)
})

/** Commit A (the build tree), then P on top changing packages/p/a.ts — the PR #4333 shape. */
function buildTreeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dist-ref-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('packages/p/a.ts', 'export const a = 1\n'); put('apps/x/page.vue', '<template />\n')
  put('scripts/lib/b.test.mjs', passing('b ok')); put('scripts/a.test.mjs', passing('a0'))
  git('add', '-A'); git('commit', '-qm', 'A')
  const A = git('rev-parse', 'HEAD').stdout.trim()
  put('packages/p/a.ts', 'export const a = 2\n'); git('commit', '-qam', 'P')
  return { dir, git, put, A }
}

// covers: T10
test('T10 changedSinceBuild compares with the build tree, so a package change already on HEAD still builds', () => {
  const r = buildTreeRepo()
  r.put('apps/x/page.vue', '<template><div /></template>\n')
  const since = changedSinceBuild({ distRef: r.A, cwd: r.dir })
  assert.ok(since.files.includes('packages/p/a.ts'), since.files.join(','))
  assert.equal(since.against, r.A)
  assert.equal(needsPackageBuild(since.files).build, true)
  const head = changedSinceBuild({ cwd: r.dir })
  assert.deepEqual(head.files, ['apps/x/page.vue'])
  assert.equal(head.against, 'HEAD')
  assert.ok(head.note)
  assert.equal(needsPackageBuild(head.files).build, false)
})

// covers: T11
test('T11 an unreadable build ref builds to be safe, never a quiet fallback to HEAD', () => {
  const r = buildTreeRepo()
  const ref = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  const since = changedSinceBuild({ distRef: ref, cwd: r.dir })
  assert.equal(needsPackageBuild(since.files).build, true)
  assert.ok(since.note.includes(ref), since.note)
  assert.match(since.note, /building to be safe/)
})

// covers: T12
test('T12 verify (lone copy) reads PKG_DIST_REF: builds against the build tree, skips without it', () => {
  const lone = loneCopy()
  const r = buildTreeRepo()
  r.git('checkout', '-qb', 'work'); r.put('scripts/a.test.mjs', passing('a side')); r.git('commit', '-qam', 'side')
  r.git('checkout', '-qb', 'epic', 'main'); r.put('scripts/a.test.mjs', passing('a base')); r.git('commit', '-qam', 'base')
  r.git('checkout', '-q', 'work')
  assert.notEqual(r.git('merge', '--no-edit', 'epic').status, 0, 'expected a conflict')
  r.put('scripts/a.test.mjs', passing('a both'))
  const verify = (ref) => {
    const shim = fakePnpm()
    const v = spawnSync('node', [join(lone, 'conflict-resolution.mjs'), 'verify', join(r.dir, 'none.md')], {
      cwd: r.dir, encoding: 'utf8', env: cliEnv({ PATH: `${shim.bin}:${process.env.PATH}`, SHIM_LOG: shim.log, PKG_DIST_REF: ref }),
    })
    return { v, calls: readFileSync(shim.log, 'utf8').split('\n').filter(Boolean) }
  }
  const withRef = verify(r.A)
  assert.equal(withRef.v.status, 0, withRef.v.stderr)
  assert.equal(withRef.calls.length, 2, withRef.calls.join('\n'))
  assert.match(withRef.calls[0], /^install /)
  assert.equal(withRef.calls[1], 'run --if-present build:packages')
  assert.match(withRef.v.stderr, /package build: packages\/p\/a\.ts/)
  const without = verify(undefined)
  assert.equal(without.v.status, 0, without.v.stderr)
  assert.ok(!without.calls.some((c) => c.includes('build:packages')), without.calls.join('\n'))
  assert.match(without.v.stderr, /package build skipped/)
})

// ── #4487: the migration regenerate check runs AFTER the package build ──

/** fakeRun plus a regenerate that records `regenerate(<app>)` into the same call list. */
function fakeRunWithRegen(fail = {}, regenFail = {}) {
  const f = fakeRun(fail)
  f.regenerate = (app) => { f.calls.push(`regenerate(${app})`); return regenFail[app] ?? null }
  return f
}

// covers: T1
test('#4487 T1 migrations conflicted + a package changed: install → build → regenerate → scripts tests, build once', () => {
  const f = fakeRunWithRegen()
  const r = runChecks({
    changed: ['packages/crouton-auth/server/database/schema/auth.ts'], conflicted: ['apps/velo/server/db/migrations/sqlite/meta/_journal.json'],
    run: f.run, log: f.log, migApps: ['apps/velo'], regenerate: f.regenerate,
  })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(f.calls, [INSTALL_CMD, BUILD_CMD, 'regenerate(apps/velo)', SCRIPTS_TEST_CMD])
  assert.equal(f.calls.filter((c) => c === BUILD_CMD).length, 1)
})

// covers: T2
test('#4487 T2 migration apps but nothing under packages/: no install, no build, regenerate still runs before the tests', () => {
  const f = fakeRunWithRegen()
  const r = runChecks({
    changed: ['apps/velo/server/db/migrations/sqlite/meta/_journal.json'], conflicted: ['apps/velo/server/db/migrations/sqlite/meta/_journal.json'],
    run: f.run, log: f.log, migApps: ['apps/velo'], regenerate: f.regenerate,
  })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(f.calls, ['regenerate(apps/velo)', SCRIPTS_TEST_CMD])
  assert.match(f.logs.join('\n'), /package build skipped/)
})

// covers: T3
test('#4487 T3 a regenerate error stops the run with that error, and the scripts tests never run', () => {
  const err = 'the migration in apps/velo/server/db/migrations/sqlite does not match the schema — run pnpm --filter ./apps/velo db:generate and keep what it writes'
  const f = fakeRunWithRegen({}, { 'apps/velo': err })
  const r = runChecks({ changed: ['packages/p/a.ts'], conflicted: [], run: f.run, log: f.log, migApps: ['apps/velo', 'apps/kassa'], regenerate: f.regenerate })
  assert.deepEqual(r, { ok: false, errors: [err] })
  assert.ok(!f.calls.includes(SCRIPTS_TEST_CMD), f.calls.join('\n'))
  assert.ok(!f.calls.includes('regenerate(apps/kassa)'), 'stops on the first error')
})

/** A fake `pnpm` that logs each call and answers `db:generate` the way drizzle-kit does when nothing changed. */
function fakePnpmGenerate() {
  const s = fakePnpm()
  writeFileSync(join(s.bin, 'pnpm'), '#!/bin/sh\necho "$@" >> "$SHIM_LOG"\ncase "$*" in *db:generate*) echo "No schema changes, nothing to migrate";; esac\n')
  return s
}

/** The migMerge conflict, plus a packages/ change on the branch since the build tree A (= PKG_DIST_REF). */
function migMergeWithPackage() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-mig-pkg-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put('apps/x/package.json', JSON.stringify({ name: 'x' }) + '\n')
  put('packages/p/a.ts', 'export const a = 1\n')
  put('scripts/lib/b.test.mjs', passing('b ok')); put('scripts/a.test.mjs', passing('a0'))
  put(`${MIG}/0000_a.sql`, 'a\n'); put(`${MIG}/meta/0000_snapshot.json`, '{"v":0}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a']))
  git('add', '-A'); git('commit', '-qm', 'A')
  const A = git('rev-parse', 'HEAD').stdout.trim()
  git('checkout', '-qb', 'work')
  put('packages/p/a.ts', 'export const a = 2\n')
  put(`${MIG}/0001_side.sql`, 'side\n'); put(`${MIG}/meta/0001_snapshot.json`, '{"v":"side"}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_side']))
  git('add', '-A'); git('commit', '-qm', 'side')
  git('checkout', '-q', 'main')
  put(`${MIG}/0001_base.sql`, 'base\n'); put(`${MIG}/meta/0001_snapshot.json`, '{"v":"base"}\n'); put(`${MIG}/meta/_journal.json`, jrnl(['0000_a', '0001_base']))
  git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-q', 'work')
  assert.notEqual(git('merge', '--no-edit', 'main').status, 0, 'expected a conflict')
  return { dir, git, put, A }
}

// covers: T4
test('#4487 T4 verify (lone copy): build:packages runs BEFORE the app\'s db:generate, and once', () => {
  const lone = loneCopy(); const shim = fakePnpmGenerate()
  const r = migMergeWithPackage()
  // the rule-5 resolution: base snapshot + journal, the branch's own migration deleted
  r.git('checkout', '--theirs', '--', `${MIG}/meta/0001_snapshot.json`, `${MIG}/meta/_journal.json`)
  rmSync(join(r.dir, `${MIG}/0001_side.sql`))
  const v = spawnSync('node', [join(lone, 'conflict-resolution.mjs'), 'verify', join(r.dir, 'none.md')], {
    cwd: r.dir, encoding: 'utf8', env: cliEnv({ PATH: `${shim.bin}:${process.env.PATH}`, SHIM_LOG: shim.log, PKG_DIST_REF: r.A }),
  })
  assert.equal(v.status, 0, v.stderr)
  const calls = readFileSync(shim.log, 'utf8').split('\n').filter(Boolean)
  const build = calls.indexOf('run --if-present build:packages')
  const gen = calls.indexOf('--filter ./apps/x db:generate')
  assert.ok(build >= 0, calls.join('\n'))
  assert.ok(gen >= 0, calls.join('\n'))
  assert.ok(build < gen, `build must come before db:generate:\n${calls.join('\n')}`)
  assert.equal(calls.filter((c) => c === 'run --if-present build:packages').length, 1)
})

// Issue #4487 case 5 — a guard (passes on main too): a COMMITTED branch .sql the base journal does not list.
test('#4487 verify (lone copy) refuses a leftover tracked branch .sql the base journal does not list, naming it', () => {
  const r = migMerge()
  r.git('checkout', '--theirs', '--', `${MIG}/meta/0001_snapshot.json`, `${MIG}/meta/_journal.json`)
  assert.ok(r.git('ls-files', '--', `${MIG}/0001_side.sql`).stdout.trim(), 'the branch .sql is tracked')
  const v = r.verify()
  assert.equal(v.status, 1, v.stderr)
  assert.match(v.stderr, /migration file not in the journal: apps\/x\/server\/db\/migrations\/sqlite\/0001_side\.sql/)
  assert.ok(!existsSync(join(r.dir, 'apps/x/GENERATED')), 'refused before any db:generate')
})

// #4398: a conflict run runs this suite with PKG_DIST_REF set for the real tool.
test('this suite never hands an inherited PKG_DIST_REF to the tool it starts', () => {
  assert.equal(process.env.PKG_DIST_REF, undefined)
})
