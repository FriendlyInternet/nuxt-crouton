import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { scalarsOf, formatLength, check } from './workflow-expr-limit.mjs'

test('formatLength: 0 without an expression', () => {
  assert.equal(formatLength("a{b}'c"), 0)
})

test("formatLength: matches the hand-computed format('a{{b}}''c {0}', x)", () => {
  assert.equal(formatLength("a{b}'c ${{ x }}"), "format('a{{b}}''c {0}', x)".length)
})

const bigScript = (withExpr) => {
  // 20,875 raw chars incl. 3 expressions, with many literal braces/quotes (the #3382 shape)
  const exprs = '${{ vars.A || \'x\' }} ${{ vars.B }} ${{ vars.C }}'
  const filler = "if (a) { b('c') }\n"
  let body = withExpr ? exprs + '\n' : ''
  while (body.length < 20875) body += filler
  return body.slice(0, 20875)
}
const wrap = (body, env = '') => `jobs:\n  j:\n    steps:\n      - uses: x\n${env}        with:\n          script: |\n${body.split('\n').map((l) => '            ' + l).join('\n')}\n`

test('regression: raw < 21000 but format() > 21000 is an error', () => {
  const body = bigScript(true)
  assert.ok(body.length < 21000)
  const r = check(wrap(body))
  assert.equal(r.errors.length, 1)
  assert.ok(r.max.len > 21000)
})

test('same script without expressions: no error, but a warning', () => {
  const r = check(wrap(bigScript(false), '        env:\n          A: ${{ vars.A }}\n'))
  assert.equal(r.errors.length, 0)
  assert.equal(r.warnings.length, 1)
})

test('scalarsOf: block styles, single-line expr, blank lines, dedent', () => {
  const t = [
    'steps:',
    '  - run: |',
    '      a',
    '',
    '      b',
    '    name: n',
    '  - with:',
    '      script: |-',
    '        s1',
    '      prompt: >',
    '        p1',
    '    if: ${{ github.event_name == \'x\' }}',
  ].join('\n')
  const s = scalarsOf(t)
  assert.deepEqual(s.map((x) => [x.key, x.value]), [
    ['run', 'a\n\nb'],
    ['script', 's1'],
    ['prompt', 'p1'],
    ['if', "${{ github.event_name == 'x' }}"],
  ])
})

test('corpus: every real workflow passes and something was measured', () => {
  const dir = new URL('../.github/workflows/', import.meta.url)
  let max = 0
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const r = check(fs.readFileSync(new URL(f, dir), 'utf8'), { file: f })
    assert.deepEqual(r.errors, [], f)
    max = Math.max(max, r.max.len)
  }
  assert.ok(max > 0)
})
