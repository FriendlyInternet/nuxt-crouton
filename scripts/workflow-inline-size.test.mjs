import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inlineBlocks, check, scan, loadBaseline, blocksToMap, scanAtRev, LIMIT } from './workflow-inline-size.mjs'

const body = (n, pad = '          ') => Array.from({ length: n }, (_, i) => `${pad}echo ${i}`).join('\n')
const wf = (n, extra = '') => `name: x
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
${extra}      - name: Big
        run: |
${body(n)}
      - name: After
        run: echo hi
`

test('new over-long block fails', () => {
  const blocks = inlineBlocks(wf(50), '.github/workflows/a.yml')
  const { failures } = check(blocks, {})
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Big/)
  assert.match(failures[0], /50 lines/)
})

test('under the limit passes', () => {
  assert.deepEqual(check(inlineBlocks(wf(40), 'a.yml'), {}).failures, [])
})

test('baselined at size passes; grown fails', () => {
  const [b] = inlineBlocks(wf(50), 'a.yml')
  assert.deepEqual(check([b], { [b.key]: 50 }).failures, [])
  const [g] = inlineBlocks(wf(55), 'a.yml')
  const { failures } = check([g], { [b.key]: 50 })
  assert.match(failures[0], /grew from 50 to 55/)
})

test('shrunk or removed is stale, not fatal', () => {
  const [b] = inlineBlocks(wf(30), 'a.yml')
  const r = check([b], { [b.key]: 50, 'gone › j › s › run': 60 })
  assert.deepEqual(r.failures, [])
  assert.equal(r.stale.length, 2)
})

test('script under with: is measured; composite action keyed under runs', () => {
  const gs = `jobs:
  j:
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
${body(45, '            ')}
`
  const [b] = inlineBlocks(gs, 'a.yml')
  assert.equal(b.kind, 'script')
  assert.equal(b.lines, 45)
  const act = `runs:
  using: composite
  steps:
    - name: Go
      shell: bash
      run: |
${body(45, '        ')}
`
  const [c] = inlineBlocks(act, '.github/actions/x/action.yml')
  assert.match(c.key, / › runs › Go › run$/)
})

test('key ignores line position', () => {
  const [a] = inlineBlocks(wf(50), 'a.yml')
  const [b] = inlineBlocks(wf(50, '      - run: echo before\n'), 'a.yml').filter(x => x.lines === 50)
  assert.equal(a.key, b.key)
  assert.notEqual(a.line, b.line)
})

test('trailing blanks and single-line run are not counted', () => {
  const blocks = inlineBlocks(`jobs:
  j:
    steps:
      - name: S
        run: |
          echo a
          echo b


      - run: echo one
`, 'a.yml')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].lines, 2)
})

test('corpus: scanner reads the real tree and the baseline', () => {
  // Size verdicts live in the dedicated CI step only (base-aware on PRs, baseline on push to main),
  // so drift on main shows as a red main, never as a red unrelated PR.
  const blocks = scan('.')
  assert.ok(blocks.length > 150, `found ${blocks.length} blocks`)
  for (const b of blocks) {
    const parts = b.key.split(' › ')
    assert.equal(parts.length, 4, b.key)
    assert.ok(['run', 'script'].includes(parts[3]), b.key)
  }
  const bl = loadBaseline()
  assert.equal(bl.limit, LIMIT)
  for (const v of Object.values(bl.blocks)) assert.ok(Number.isInteger(v) && v > LIMIT)
})

const key = (n) => inlineBlocks(wf(n), 'a.yml')[0].key
const head = (n) => inlineBlocks(wf(n), 'a.yml')
const base = (n) => blocksToMap(head(n))

test('base mode: block grown on base but untouched by the PR passes', () => {
  assert.deepEqual(check(head(47), { [key(47)]: 44 }, LIMIT, base(47)).failures, [])
})
test('base mode: block the PR grows fails, naming it', () => {
  const { failures } = check(head(55), { [key(50)]: 50 }, LIMIT, base(50))
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Big/)
  assert.match(failures[0], /grew from 50 to 55/)
})
test('base mode: new block over the limit fails', () => {
  const { failures } = check(head(50), {}, LIMIT, {})
  assert.equal(failures.length, 1)
  assert.match(failures[0], /new inline block of 50 lines/)
})
test('base mode: growth covered by a raised baseline passes', () => {
  assert.deepEqual(check(head(55), { [key(50)]: 55 }, LIMIT, base(50)).failures, [])
})
test('base mode: growth that stays under the limit passes', () => {
  assert.deepEqual(check(head(30), {}, LIMIT, base(10)).failures, [])
})

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' })
const tmp = mkdtempSync(join(tmpdir(), 'wis-'))
const commit = (msg) => { git(tmp, 'add', '-A'); git(tmp, 'commit', '-qm', msg) }
const put = (n) => { mkdirSync(join(tmp, '.github/workflows'), { recursive: true }); writeFileSync(join(tmp, '.github/workflows/a.yml'), wf(n)) }
const bl = () => ({ '.github/workflows/a.yml › build › Big › run': 45 })
after(() => rmSync(tmp, { recursive: true, force: true }))

test('rule: main grown past the baseline does not fail a PR that leaves the block alone', () => {
  git(tmp, 'init', '-q'); git(tmp, 'config', 'user.email', 't@t'); git(tmp, 'config', 'user.name', 't')
  put(50); commit('main')
  writeFileSync(join(tmp, 'README.md'), 'x'); commit('pr')
  assert.equal(check(scan(tmp), bl(), LIMIT).failures.length, 1)
  assert.deepEqual(check(scan(tmp), bl(), LIMIT, blocksToMap(scanAtRev('HEAD~1', tmp))).failures, [])
})
test('rule: a PR that grows the block still fails', () => {
  put(51); commit('grow')
  const { failures } = check(scan(tmp), bl(), LIMIT, blocksToMap(scanAtRev('HEAD~1', tmp)))
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Big/)
  assert.match(failures[0], /grew from 50 to 51/)
})
test('scanAtRev: unknown rev throws', () => {
  assert.throws(() => scanAtRev('no-such-rev', tmp))
})
