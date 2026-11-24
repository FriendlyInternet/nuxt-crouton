import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findMarkers, isBinary } from './check-conflict-markers.mjs'

const SCRIPT = fileURLToPath(new URL('./check-conflict-markers.mjs', import.meta.url))

// covers: T1
test('case 1: a lone >>>>>>> origin/x line is one hit with the right line number', () => {
  assert.deepEqual(findMarkers({ 'a.md': 'one\ntwo\n>>>>>>> origin/x\nfour' }), [
    { file: 'a.md', line: 3, text: '>>>>>>> origin/x' },
  ])
})

// covers: T1
test('case 2: <<<<<<< HEAD, ======= and >>>>>>> b are three hits', () => {
  const hits = findMarkers({ 'b.ts': '<<<<<<< HEAD\nours\n=======\ntheirs\r\n>>>>>>> b\n' })
  assert.deepEqual(hits.map((h) => [h.line, h.text]), [[1, '<<<<<<< HEAD'], [3, '======='], [5, '>>>>>>> b']])
})

// covers: T1
test('case 3: near-misses are not markers', () => {
  assert.deepEqual(findMarkers({ 'c.md': '========\n== title ==\nfoo <<<<<<< bar\n  =======\n' }), [])
})

// covers: T1
test('case 4: empty input has no hits', () => {
  assert.deepEqual(findMarkers({}), [])
  assert.deepEqual(findMarkers({ 'e.md': '' }), [])
})

// covers: T1
test('isBinary spots a NUL byte in the first 8000 bytes only', () => {
  assert.equal(isBinary(Buffer.from('a\0b')), true)
  assert.equal(isBinary(Buffer.from('plain text')), false)
  assert.equal(isBinary(Buffer.concat([Buffer.alloc(8000, 97), Buffer.from([0])])), false)
})

// covers: T2
test('case 5: the CLI fails on a tracked marker, passes when clean, and skips binaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-'))
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir })
    git('init', '-q')
    writeFileSync(join(dir, 'a.md'), 'hello\n>>>>>>> test\n')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from('x\0y\n>>>>>>> bin\n'))
    git('add', '.')
    const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })

    let r = run()
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^a\.md:2: >>>>>>> test$/m)
    assert.doesNotMatch(r.stdout, /bin\.dat/)

    writeFileSync(join(dir, 'a.md'), 'hello\n')
    git('add', '.')
    r = run()
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /checked 1 files, 0 with conflict markers/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// covers: T2
test('the CLI refuses to pass having read nothing (empty repo)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /checked 0 files/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- ci.yml wiring ---------------------------------------------------------------------------
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = (name) => { const s = ci.indexOf(`\n  ${name}:\n`); if (s < 0) return ''; const rest = ci.slice(s + 1); const e = rest.slice(1).search(/\n  [a-z][\w-]*:\n/); return e < 0 ? rest : rest.slice(0, e + 1) }

// covers: T3
test('case 6: ci.yml has an always-on Conflict markers job wired into the CI Gate', () => {
  const j = job('conflict-markers')
  assert.ok(j, 'conflict-markers job present')
  assert.match(j, /name: Conflict markers/)
  assert.match(j, /run: node scripts\/check-conflict-markers\.mjs/)
  assert.doesNotMatch(j, /^\s+if:/m, 'no if: — a marker can land in any file')
  const needs = job('gate').match(/needs:\s*\[([^\]]*)\]/)[1].split(',').map((s) => s.trim())
  assert.ok(needs.includes('conflict-markers'))
})
