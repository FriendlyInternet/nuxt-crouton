// Contract for scripts/typecheck-packages.mjs (#3128). The rule under test (epic #3126): every
// packages/* package with a typecheck script is either checked by the CI job or named as skipped
// with a ticket — never silently left out. Run: node --test scripts/typecheck-packages.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackages, configErrors, selectRun, plan, main } from './typecheck-packages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const realConfig = () => JSON.parse(readFileSync(join(ROOT, 'scripts/typecheck-packages.json'), 'utf8'))

// A throwaway repo root: packages/<dir>/package.json + scripts/typecheck-packages.json.
function fakeRepo(pkgs, config) {
  const root = mkdtempSync(join(tmpdir(), 'tc-pkgs-'))
  for (const [dir, pkg] of Object.entries(pkgs)) {
    mkdirSync(join(root, 'packages', dir), { recursive: true })
    writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify(pkg))
  }
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'typecheck-packages.json'), JSON.stringify(config))
  return root
}
const tc = { typecheck: 'tsc --noEmit' }
const FAKE = {
  'crouton-a': { name: '@fyit/crouton-a', scripts: tc },
  'crouton-b': { name: '@fyit/crouton-b', scripts: tc, dependencies: { '@fyit/crouton-a': 'workspace:*' } },
  'crouton-c': { name: '@fyit/crouton-c', scripts: tc },
}
const run = (root, argv) => { const out = []; const ran = []; const code = main({ root, argv, log: l => out.push(l), exec: n => { ran.push(n); return 0 } }); return { code, out: out.join('\n'), ran } }

test('(a) every real packages/* package with a typecheck script is in exactly one list', () => {
  const pkgs = listPackages(ROOT)
  assert.ok(pkgs.length >= 29, `expected all packages, found ${pkgs.length}`)
  assert.deepEqual(configErrors(pkgs, realConfig()), [])
})

test('(b) every excluded entry cites a ticket', () => {
  for (const [name, ticket] of Object.entries(realConfig().excluded)) assert.match(ticket, /^#\d+$/, name)
  const errs = configErrors(listPackages(ROOT), { ...realConfig(), excluded: { ...realConfig().excluded, '@fyit/crouton-email': 'later' } })
  assert.ok(errs.some(e => e.includes('without a ticket')))
})

test('(c) a package on neither list fails the run; classifying it makes it pass', () => {
  const unlisted = fakeRepo(FAKE, { gate: ['@fyit/crouton-a', '@fyit/crouton-b'], excluded: {} })
  const r1 = run(unlisted, [])
  assert.equal(r1.code, 1)
  assert.match(r1.out, /@fyit\/crouton-c has a typecheck script but is in neither/)
  assert.deepEqual(r1.ran, [], 'nothing runs while the list is wrong')

  const listed = fakeRepo(FAKE, { gate: ['@fyit/crouton-a', '@fyit/crouton-b'], excluded: { '@fyit/crouton-c': '#1' } })
  const r2 = run(listed, [])
  assert.equal(r2.code, 0)
  assert.deepEqual(r2.ran, ['@fyit/crouton-a', '@fyit/crouton-b'])
})

test('(c2) a stale or doubled entry fails too', () => {
  const pkgs = listPackages(fakeRepo(FAKE, {}))
  assert.ok(configErrors(pkgs, { gate: ['@fyit/gone', '@fyit/crouton-a', '@fyit/crouton-b'], excluded: { '@fyit/crouton-c': '#1' } }).some(e => e.includes('@fyit/gone')))
  assert.ok(configErrors(pkgs, { gate: ['@fyit/crouton-a', '@fyit/crouton-b', '@fyit/crouton-c'], excluded: { '@fyit/crouton-c': '#1' } }).some(e => e.includes('both')))
})

test('(d) --only of a skipped package prints skip with its ticket, never silence', () => {
  const root = fakeRepo(FAKE, { gate: ['@fyit/crouton-a', '@fyit/crouton-b'], excluded: { '@fyit/crouton-c': '#42' } })
  const r = run(root, ['--only', 'crouton-c'])
  assert.equal(r.code, 0)
  assert.deepEqual(r.ran, [])
  assert.match(r.out, /skip\s+@fyit\/crouton-c \(excluded, #42\)/)
  assert.match(r.out, /unchanged\s+@fyit\/crouton-a/)
})

test('(e) --only with the CI dir name puts the real CLI in the run set', () => {
  const pkgs = listPackages(ROOT)
  assert.ok(selectRun(pkgs, realConfig().gate, ['crouton-cli']).includes('@fyit/crouton-cli'))
  assert.ok(selectRun(pkgs, realConfig().gate, ['@fyit/crouton-cli']).includes('@fyit/crouton-cli'))
  assert.deepEqual(selectRun(pkgs, realConfig().gate, ['no-such-dir']), [], 'an unknown name runs nothing')
})

test('(f) a changed dependency re-checks its gate dependents (feedback → devtools)', () => {
  const pkgs = listPackages(ROOT)
  const ran = selectRun(pkgs, realConfig().gate, ['crouton-feedback'])
  assert.ok(ran.includes('@fyit/crouton-feedback'))
  assert.ok(ran.includes('@fyit/crouton-devtools'), 'devtools imports feedback types')
  // transitive, on the fake repo: a changes → b (depends on a) runs, c doesn't
  assert.deepEqual(selectRun(listPackages(fakeRepo(FAKE, {})), ['@fyit/crouton-a', '@fyit/crouton-b', '@fyit/crouton-c'], ['crouton-a']), ['@fyit/crouton-a', '@fyit/crouton-b'])
})

test('a failing package typecheck fails the run and names it', () => {
  const root = fakeRepo(FAKE, { gate: ['@fyit/crouton-a', '@fyit/crouton-b'], excluded: { '@fyit/crouton-c': '#1' } })
  const out = []
  const code = main({ root, argv: [], log: l => out.push(l), exec: n => (n === '@fyit/crouton-b' ? 2 : 0) })
  assert.equal(code, 1)
  assert.match(out.join('\n'), /type errors in @fyit\/crouton-b/)
})

test('the real repo: dry run lists every package and exits 0', () => {
  const out = []
  const code = main({ root: ROOT, argv: ['--dry-run'], log: l => out.push(l) })
  assert.equal(code, 0)
  const { lines } = plan(listPackages(ROOT), realConfig())
  assert.equal(lines.length, listPackages(ROOT).length)
  for (const p of listPackages(ROOT)) assert.ok(out.some(l => l.includes(` ${p.name}`)), p.name)
})

test('the CI job calls the script, is required by CI Gate, and scopes with the changed packages', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  const job = yml.split(/\n  typecheck-packages:\n/)[1]?.split(/\n  [a-z][\w-]*:\n/)[0]
  assert.ok(job, 'typecheck-packages job exists')
  assert.match(job, /needs: \[changes, prepare\]/)
  assert.match(job, /needs\.changes\.outputs\.packages != '\[\]' \|\| needs\.changes\.outputs\.stage == 'infra'/)
  assert.match(job, /name: package-dist/)
  assert.match(job, /node scripts\/typecheck-packages\.mjs/)
  assert.match(job, /--only/)
  const gate = yml.split(/\n  gate:\n/)[1]
  assert.match(gate.split('runs-on')[0], /\btypecheck-packages\b/)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['typecheck:packages'], 'node scripts/typecheck-packages.mjs')
})
