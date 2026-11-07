import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listTestTitles, unexplained } from './removed-tests.mjs'

const CLI = fileURLToPath(new URL('../check-removed-tests.mjs', import.meta.url))
const CI = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url))

const suite = (...titles) => titles.map((t) => `test('${t}', () => {})`).join('\n') + '\n'

/** Build a temp repo: `steps` is a list of {path: source|null} commits; first is the base. */
function repo(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'rt-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  const shas = []
  steps.forEach((files, i) => {
    for (const [p, src] of Object.entries(files)) {
      if (src === null) rmSync(join(dir, p), { force: true })
      else { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), src) }
    }
    g('add', '-A'); g('commit', '-q', '--allow-empty', '-m', `c${i}`)
    shas.push(g('rev-parse', 'HEAD').trim())
  })
  return { dir, shas }
}
function run(steps, { branch = 'work-1', body = '' } = {}) {
  const { dir, shas } = repo(steps)
  const r = spawnSync('node', [CLI, '--base', shas[0], '--head', shas.at(-1), '--branch', branch],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PR_BODY: body } })
  rmSync(dir, { recursive: true, force: true })
  return r
}

const base = { 'a.mjs': 'x\n' }

test('add-then-delete inside one PR is caught (the #3231 shape)', () => {
  const r = run([base, { 'x.test.mjs': suite('rule holds') }, { 'x.test.mjs': null }])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /x\.test\.mjs — rule holds/)
})

test('deleting an existing test file lists every case in it', () => {
  const r = run([{ ...base, 'y.test.mjs': suite('one', 'two') }, { 'y.test.mjs': null }])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /— one/)
  assert.match(r.stdout, /— two/)
})

test('a deleted case with no Test removed line fails; with the line it passes', () => {
  const steps = [{ ...base, 'y.test.mjs': suite('one', 'two') }, { 'y.test.mjs': suite('one') }]
  assert.equal(run(steps).status, 1)
  assert.equal(run(steps, { body: 'Closes #1\nTest removed: two — superseded by one' }).status, 0)
})

test('a Test removed line with an empty reason still fails', () => {
  const steps = [{ ...base, 'y.test.mjs': suite('one', 'two') }, { 'y.test.mjs': suite('one') }]
  assert.equal(run(steps, { body: 'Test removed: two —' }).status, 1)
  assert.equal(run(steps, { body: 'Test removed: two' }).status, 1)
})

test('a renamed test is a removal (plus an addition)', () => {
  const r = run([{ ...base, 'y.test.mjs': suite('old name') }, { 'y.test.mjs': suite('new name') }])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /— old name/)
})

test('a test added to main after the branch point is not a removal (merge-base)', () => {
  const { dir, shas } = repo([{ ...base, 'y.test.mjs': suite('one') }])
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('checkout', '-q', '-b', 'work-9')
  writeFileSync(join(dir, 'a.mjs'), 'changed\n'); g('commit', '-qam', 'branch work')
  const head = g('rev-parse', 'HEAD').trim()
  g('checkout', '-q', 'main')
  writeFileSync(join(dir, 'z.test.mjs'), suite('added on main')); g('add', '-A'); g('commit', '-qm', 'main adds test')
  const tip = g('rev-parse', 'HEAD').trim()
  const r = spawnSync('node', [CLI, '--base', tip, '--head', head, '--branch', 'work-9'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PR_BODY: '' } })
  rmSync(dir, { recursive: true, force: true })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /no test case removed/)
})

test('a PR that only adds tests passes', () => {
  const r = run([{ ...base, 'y.test.mjs': suite('one') }, { 'y.test.mjs': suite('one', 'two') }])
  assert.equal(r.status, 0)
})

test('a non-pipeline head reports but exits 0', () => {
  const r = run([{ ...base, 'y.test.mjs': suite('one') }, { 'y.test.mjs': null }], { branch: 'feat/x' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /— one/)
})

test('a POC-only path is checked like any other', () => {
  const r = run([{ ...base, 'pocs/x/a.test.mjs': suite('poc case') }, { 'pocs/x/a.test.mjs': null }])
  assert.equal(r.status, 1)
})

test('listTestTitles: quote styles, modifiers, and what is skipped', () => {
  const src = [
    "test('single', () => {})", 'it("double", () => {})', 'describe(`tick`, () => {})',
    "test.skip('skipped', () => {})", "it.only('only', () => {})",
    'test(`has ${x}`, () => {})', 'test(name, () => {})', "test.describe.configure({ mode: 'serial' })",
    "mytest('not a test', () => {})",
  ].join('\n')
  assert.deepEqual(listTestTitles(src).sort(), ['double', 'only', 'single', 'skipped', 'tick'])
})

test('unexplained matches the exact title only', () => {
  const rem = [{ file: 'f', title: 'a' }, { file: 'f', title: 'b' }]
  assert.deepEqual(unexplained(rem, 'Test removed: a — gone'), [{ file: 'f', title: 'b' }])
})

test('ci.yml runs the check for every PR (no stage condition) and the gate needs it', () => {
  const yml = readFileSync(CI, 'utf8')
  const job = /\n {2}removed-tests:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(yml)?.[1]
  assert.ok(job, 'removed-tests job exists')
  assert.match(job, /if: github\.event_name == 'pull_request'/)
  assert.doesNotMatch(job, /needs\.changes/)
  assert.match(job, /fetch-depth: 0/)
  assert.match(job, /check-removed-tests\.mjs/)
  assert.match(yml, /gate:[\s\S]*?needs: \[[^\]]*\bremoved-tests\b/)
})
