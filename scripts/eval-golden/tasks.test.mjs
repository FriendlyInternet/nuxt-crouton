// tasks.test.mjs — WS6b.3 (#885). Dependency-free: `node scripts/eval-golden/tasks.test.mjs`.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOLDEN_TASKS, getTask } from './tasks.mjs'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`) }
const tmp = mkdtempSync(join(tmpdir(), 'golden-eval-'))

test('exactly 3 golden tasks, one per category', () => {
  assert.equal(GOLDEN_TASKS.length, 3)
  const categories = new Set(GOLDEN_TASKS.map((t) => t.category))
  assert.deepEqual([...categories].sort(), ['reports-only', 'scaffold', 'small-crud'])
})

test('getTask returns null for an unknown id', () => {
  assert.equal(getTask('nope'), null)
})

// ── reports-only ──
test('reports-only: fails when the report file is missing', () => {
  const t = getTask('reports-only')
  const r = t.check({ root: tmp, reportPath: join(tmp, 'missing.md') })
  assert.equal(r.ok, false)
  assert.match(r.reason, /not found/)
})

test('reports-only: fails when required sections are missing', () => {
  const t = getTask('reports-only')
  const p = join(tmp, 'bad-report.md')
  writeFileSync(p, '# Report\nsome text, no sections')
  const r = t.check({ root: tmp, reportPath: p })
  assert.equal(r.ok, false)
  assert.match(r.reason, /missing required section/)
})

test('reports-only: passes with a well-formed report', () => {
  const t = getTask('reports-only')
  const p = join(tmp, 'good-report.md')
  writeFileSync(p, '# Golden a11y report\n## Summary\nAll clear.\n## Findings\nNone.\n')
  const r = t.check({ root: tmp, reportPath: p })
  assert.equal(r.ok, true)
})

// ── small-crud ──
test('small-crud: fails when no playwright report exists', () => {
  const t = getTask('small-crud')
  const r = t.check({ root: tmp, playwrightReport: join(tmp, 'no-report.json') })
  assert.equal(r.ok, false)
  assert.match(r.reason, /no playwright report/)
})

test('small-crud: fails when specs failed', () => {
  const t = getTask('small-crud')
  const p = join(tmp, 'report-fail.json')
  writeFileSync(p, JSON.stringify({ stats: { expected: 3, unexpected: 1 } }))
  const r = t.check({ root: tmp, playwrightReport: p })
  assert.equal(r.ok, false)
  assert.match(r.reason, /failed/)
})

test('small-crud: passes when all specs passed', () => {
  const t = getTask('small-crud')
  const p = join(tmp, 'report-pass.json')
  writeFileSync(p, JSON.stringify({ stats: { expected: 5, unexpected: 0 } }))
  const r = t.check({ root: tmp, playwrightReport: p })
  assert.equal(r.ok, true)
})

// ── scaffold ──
test('scaffold: fails when the scaffold dir is missing', () => {
  const t = getTask('scaffold')
  const r = t.check({ scaffoldDir: join(tmp, 'does-not-exist') })
  assert.equal(r.ok, false)
  assert.match(r.reason, /not found/)
})

test('scaffold: fails when required files are missing', () => {
  const t = getTask('scaffold')
  const dir = join(tmp, 'scaffold-partial')
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), '{}')
  const r = t.check({ scaffoldDir: dir })
  assert.equal(r.ok, false)
  assert.match(r.reason, /missing required file/)
})

test('scaffold: passes with the expected app shape', () => {
  const t = getTask('scaffold')
  const dir = join(tmp, 'scaffold-full')
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), '{}')
  writeFileSync(join(dir, 'crouton.config.js'), 'export default {}')
  writeFileSync(join(dir, 'nuxt.config.ts'), 'export default {}')
  const r = t.check({ scaffoldDir: dir })
  assert.equal(r.ok, true)
})

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed}/${passed} passed`)
