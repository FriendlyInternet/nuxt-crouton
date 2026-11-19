// node --test scripts/frontend-gate.test.mjs — the frontend-review gate decides from the diff (#4071).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseDiff } from './ui-touched.mjs'
import { lintNeeded, lintHits, countedFindings, decide, RULE } from './frontend-gate.mjs'

const script = fileURLToPath(new URL('./frontend-gate.mjs', import.meta.url))
const ROOT = '/repo'
const dir = mkdtempSync(join(tmpdir(), 'frontend-gate-'))

// DecisionRow.vue: line 11 is context, line 12 `<button` is added, line 13 its attribute.
const ROW = 'pocs/status/app/components/dashboard/DecisionRow.vue'
const DIFF = [
  `diff --git a/${ROW} b/${ROW}`,
  'index 111..222 100644',
  `--- a/${ROW}`,
  `+++ b/${ROW}`,
  '@@ -10,3 +10,5 @@',
  ' <template>',
  '   <div>',
  '+    <button',
  '+      class="x"',
  '   </div>',
  'diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts',
  '--- a/packages/x/src/a.ts',
  '+++ b/packages/x/src/a.ts',
  '@@ -1,0 +1,1 @@',
  '+const a = 1',
  ''
].join('\n')
const files = parseDiff(DIFF)
const msg = (line, extra = {}) => ({ ruleId: RULE, line, message: 'Use UButton', ...extra })
const eslintFor = (messages, file = ROW) => [{ filePath: `${ROOT}/${file}`, messages }]

function run(args) {
  return spawnSync('node', [script, ...args], { encoding: 'utf8', cwd: dir })
}
function write(name, content) {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
const EMPTY = { highest: 'none', critical: 0, warning: 0, note: 0, findings: [] }

// T1 — R1
test('T1 lintHits counts an added line, ignores an unchanged line and .ts, and is deterministic', () => {
  const json = [...eslintFor([msg(12), msg(11)]), { filePath: `${ROOT}/packages/x/src/a.ts`, messages: [msg(1)] }]
  const a = lintHits(json, files, ROOT)
  assert.deepEqual(a, { hits: [{ file: ROW, line: 12, message: 'Use UButton' }] })
  assert.deepEqual(lintHits(json, files, ROOT), a)
  assert.deepEqual(lintNeeded(files), [ROW])
})

test('T1 lintHits ignores other rules on an added line', () => {
  assert.deepEqual(lintHits(eslintFor([{ ruleId: 'vue/other', line: 12, message: 'x' }]), files, ROOT), { hits: [] })
})

// T2 — R3
test('T2 a fatal message is an error and decide is red', () => {
  const res = lintHits(eslintFor([{ fatal: true, line: 3, message: 'Parsing error' }]), files, ROOT)
  assert.ok(res.error)
  assert.equal(decide({ error: res.error }), 'red')
})

test('T2 CLI exit 2 on fatal ESLint output', () => {
  const d = write('t2.diff', DIFF)
  const e = write('t2-eslint.json', eslintFor([{ fatal: true, line: 3, message: 'Parsing error' }]))
  const v = write('t2-v.json', EMPTY)
  assert.equal(run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT]).status, 2)
})

test('T2 CLI exit 2 for a missing --diff or --verdict file', () => {
  const d = write('t2b.diff', DIFF)
  const e = write('t2b-eslint.json', eslintFor([]))
  const v = write('t2b-v.json', EMPTY)
  assert.equal(run(['--diff', join(dir, 'nope.diff'), '--eslint', e, '--verdict', v, '--root', ROOT]).status, 2)
  assert.equal(run(['--eslint', e, '--verdict', v, '--root', ROOT]).status, 2)
  assert.equal(run(['--diff', d, '--eslint', e, '--verdict', join(dir, 'nope.json'), '--root', ROOT]).status, 2)
})

test('T2 CLI exit 2 when a .vue file gains lines and --eslint is missing', () => {
  const d = write('t2c.diff', DIFF)
  const v = write('t2c-v.json', EMPTY)
  assert.equal(run(['--diff', d, '--verdict', v, '--root', ROOT]).status, 2)
  assert.equal(run(['--diff', d, '--eslint', join(dir, 'missing.json'), '--verdict', v, '--root', ROOT]).status, 2)
})

test('T2 CLI exit 2 when the ESLint JSON has no result for a needed file', () => {
  const d = write('t2d.diff', DIFF)
  const e = write('t2d-eslint.json', eslintFor([], 'pocs/other/A.vue'))
  const v = write('t2d-v.json', EMPTY)
  const res = run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT])
  assert.equal(res.status, 2)
  assert.match(res.stdout, /no result for: .*DecisionRow\.vue/)
})

// T3 — R2
const crit = o => ({ severity: 'critical', rule: 'hand-rolled', file: ROW, ...o })

test('T3 a quote equal to the added line at the reported line is counted', () => {
  const { counted, downgraded } = countedFindings({ findings: [crit({ line: 12, quote: '<button' })] }, files)
  assert.equal(counted.length, 1)
  assert.equal(counted[0].matchedLine, 12)
  assert.equal(downgraded.length, 0)
})

test('T3 the trial case line 504 quote "<button" is counted at line 12', () => {
  const { counted } = countedFindings({ findings: [crit({ line: 504, quote: '<button' })] }, files)
  assert.equal(counted.length, 1)
  assert.equal(counted[0].matchedLine, 12)
})

test('T3 a multi-line quote matches on its first line', () => {
  const { counted } = countedFindings({ findings: [crit({ line: 12, quote: '  <button\n      class="x"\n>' })] }, files)
  assert.equal(counted[0].matchedLine, 12)
})

test('T3 an unchanged line, an invented quote or a file not in the diff is downgraded and green', () => {
  const findings = [
    crit({ line: 11, quote: '<div>' }),
    crit({ line: 12, quote: '<button @click="nope">' }),
    crit({ file: 'pocs/elsewhere/B.vue', line: 3, quote: '<button' }),
    crit({ line: 12 })
  ]
  const { counted, downgraded } = countedFindings({ findings }, files)
  assert.equal(counted.length, 0)
  assert.equal(downgraded.length, 4)
  assert.equal(decide({ lint: [], counted }), 'green')
})

test('T3 warnings and a missing findings array count nothing', () => {
  assert.deepEqual(countedFindings({ highest: 'critical', critical: 2 }, files), { counted: [], downgraded: [] })
  assert.deepEqual(countedFindings({ findings: [{ severity: 'warning', file: ROW, line: 12, quote: '<button' }] }, files).counted, [])
})

// T4 — CLI
test('T4 CLI green → exit 0', () => {
  const d = write('t4a.diff', DIFF)
  const e = write('t4a-eslint.json', eslintFor([msg(11)]))
  const v = write('t4a-v.json', EMPTY)
  const res = run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT])
  assert.equal(res.status, 0, res.stdout)
})

test('T4 CLI a lint hit → exit 1 naming file:line', () => {
  const d = write('t4b.diff', DIFF)
  const e = write('t4b-eslint.json', eslintFor([msg(12)]))
  const v = write('t4b-v.json', EMPTY)
  const res = run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT])
  assert.equal(res.status, 1)
  assert.match(res.stdout, new RegExp(`${ROW.replace(/\./g, '\\.')}:12 lint`))
})

test('T4 CLI a counted reviewer 🔴 → exit 1', () => {
  const d = write('t4c.diff', DIFF)
  const e = write('t4c-eslint.json', eslintFor([]))
  const v = write('t4c-v.json', { ...EMPTY, highest: 'critical', critical: 1, findings: [crit({ line: 504, quote: '<button' })] })
  assert.equal(run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT]).status, 1)
})

test('T4 CLI a delete-only .vue diff or a fixtures-only diff needs no --eslint → exit 0', () => {
  const del = [
    'diff --git a/pocs/a/Gone.vue b/pocs/a/Gone.vue',
    'deleted file mode 100644',
    '--- a/pocs/a/Gone.vue',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-<button>x</button>',
    ''
  ].join('\n')
  const fix = [
    'diff --git a/packages/x/test/fixtures/A.vue b/packages/x/test/fixtures/A.vue',
    '--- a/packages/x/test/fixtures/A.vue',
    '+++ b/packages/x/test/fixtures/A.vue',
    '@@ -1,0 +1,1 @@',
    '+<button>x</button>',
    ''
  ].join('\n')
  const v = write('t4d-v.json', EMPTY)
  assert.equal(run(['--diff', write('t4d-del.diff', del), '--verdict', v]).status, 0)
  assert.equal(run(['--diff', write('t4d-fix.diff', fix), '--verdict', v]).status, 0)
})

test('T4 --out counts a downgraded finding under warning, not critical', () => {
  const d = write('t4e.diff', DIFF)
  const e = write('t4e-eslint.json', eslintFor([]))
  const v = write('t4e-v.json', { highest: 'critical', critical: 1, warning: 1, note: 0, findings: [crit({ line: 11, quote: '<div>' })] })
  const out = join(dir, 't4e-out.json')
  const res = run(['--diff', d, '--eslint', e, '--verdict', v, '--root', ROOT, '--out', out])
  assert.equal(res.status, 0, res.stdout)
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { highest: 'warning', critical: 0, warning: 2, note: 0 })
})

// T5 — workflow pin
test('T5 review.yml frontend-review job: CLI gate, review tier, no highest read, gate → capture → upload', () => {
  const yml = readFileSync(new URL('../.github/workflows/review.yml', import.meta.url), 'utf8')
  const start = yml.indexOf('\n  frontend-review:\n')
  assert.ok(start > 0)
  const rest = yml.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
  const job = next === -1 ? rest : rest.slice(0, next + 1)
  assert.match(job, /node scripts\/frontend-gate\.mjs/)
  assert.match(job, /resolve-pipeline-model\.mjs review\b/)
  assert.doesNotMatch(job, /resolve-pipeline-model\.mjs light/)
  const steps = job.split('\n      - ')
  const gate = steps.find(s => /name: Gate on critical/.test(s))
  assert.ok(gate)
  assert.doesNotMatch(gate, /\.highest/)
  assert.doesNotMatch(gate, /require\('\.\/frontend-review-verdict\.json'\)/)
  const iGate = steps.indexOf(gate)
  const iCapture = steps.findIndex(s => /name: Capture finding candidate/.test(s))
  const iUpload = steps.findIndex(s => /name: Upload finding candidate/.test(s))
  assert.ok(iGate < iCapture && iCapture < iUpload, `order gate ${iGate} → capture ${iCapture} → upload ${iUpload}`)
  assert.match(steps[iCapture], /--verdict gate-verdict\.json/)
  assert.match(steps[iCapture], /if: always\(\)/)
  assert.match(steps[iUpload], /if: always\(\)/)
  const iLint = steps.findIndex(s => /eslint\.frontend-gate\.config\.mjs/.test(s))
  assert.ok(iLint > 0 && iLint < iGate)
})
