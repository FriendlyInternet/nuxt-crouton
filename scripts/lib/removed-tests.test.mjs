import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listTestTitles } from './removed-tests.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-removed-tests.mjs')

test('listTestTitles: quote styles, modifiers, skips non-literals', () => {
  const src = `test('a', () => {})\nit("b", ()=>{})\ndescribe(\`c\`, ()=>{})\ntest.skip('d', ()=>{})\nit.only('e', ()=>{})\ntest(\`x \${y}\`, ()=>{})\ntest(name, ()=>{})\ntest.skip(cond, 'msg')`
  assert.deepEqual(listTestTitles(src).sort(), ['a', 'b', 'c', 'd', 'e'])
})

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'rt-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README'), 'x'); g('add', '.'); g('commit', '-qm', 'base')
  const put = (p, src) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), src) }
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m) }
  return { dir, g, put, commit, base: g('rev-parse', 'HEAD') }
}
const run = (r, { branch = 'work-1', body = '' } = {}) =>
  spawnSync('node', [CLI, '--base', r.base, '--head', r.g('rev-parse', 'HEAD'), '--branch', branch], {
    cwd: r.dir, encoding: 'utf8', env: { ...process.env, PR_BODY: body },
  })
const T = (...t) => t.map((x) => `test('${x}', () => {})`).join('\n') + '\n'

test('add then delete a case across commits → exit 1 (#3231 shape)', () => {
  const r = repo()
  try {
    r.put('scripts/a.test.mjs', T('one', 'two')); r.commit('add')
    r.put('scripts/a.test.mjs', T('one')); r.commit('drop two')
    const p = run(r)
    assert.equal(p.status, 1); assert.match(p.stdout, /two/)
  } finally { rmSync(r.dir, { recursive: true }) }
})

test('whole file added then deleted lists every case', () => {
  const r = repo()
  try {
    r.put('a.test.mjs', T('one', 'two')); r.commit('add')
    rmSync(join(r.dir, 'a.test.mjs')); r.commit('rm')
    const p = run(r)
    assert.equal(p.status, 1); assert.match(p.stdout, /one/); assert.match(p.stdout, /two/)
  } finally { rmSync(r.dir, { recursive: true }) }
})

test('explained removal passes; empty why still fails', () => {
  const r = repo()
  try {
    r.put('a.test.mjs', T('one', 'two')); r.commit('add')
    r.put('a.test.mjs', T('one')); r.commit('drop')
    assert.equal(run(r, { body: 'Closes #1\nTest removed: two — obsolete' }).status, 0)
    assert.equal(run(r, { body: 'Test removed: two — ' }).status, 1)
    assert.equal(run(r, { body: '' }).status, 1)
  } finally { rmSync(r.dir, { recursive: true }) }
})

test('rename = removal + addition → exit 1', () => {
  const r = repo()
  try {
    r.put('a.test.mjs', T('old')); r.commit('add'); r.base = r.g('rev-parse', 'HEAD')
    r.put('a.test.mjs', T('new')); r.commit('rename')
    assert.equal(run(r).status, 1)
  } finally { rmSync(r.dir, { recursive: true }) }
})

test('only additions → exit 0; non-pipeline head reports but exits 0', () => {
  const r = repo()
  try {
    r.put('pocs/x/a.test.mjs', T('one')); r.commit('add')
    assert.equal(run(r).status, 0)
    r.put('pocs/x/a.test.mjs', T('two')); r.commit('swap')
    assert.equal(run(r).status, 1) // POC paths are checked like any other
    const p = run(r, { branch: 'feat/x' })
    assert.equal(p.status, 0); assert.match(p.stdout, /one/)
  } finally { rmSync(r.dir, { recursive: true }) }
})
