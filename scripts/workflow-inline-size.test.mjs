import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineBlocks, check, scan, loadBaseline } from './workflow-inline-size.mjs'

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

test('corpus: committed baseline covers the real tree', () => {
  const blocks = scan('.')
  assert.ok(blocks.length > 150, `found ${blocks.length} blocks`)
  assert.deepEqual(check(blocks, loadBaseline().blocks).failures, [])
})
