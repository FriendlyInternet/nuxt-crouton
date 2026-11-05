/**
 * #3359 — markers count only in the leading hidden-marker block.
 *   node --test scripts/lib/marker.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { hasMarker, markerValue, leadingMarkers, leadingRegexSource } from './marker.mjs'

const PLAN = '<!-- pipeline-plan:v1 -->'
const NOGO = '<!-- plan-review-verdict:no-go -->'
const fixture = readFileSync(new URL('../fixtures/marker/3342-plan-review.md', import.meta.url), 'utf8')

const cases = [
  ['plan marker on line 1', `${PLAN}\nbody`, PLAN, true],
  ['verdict on line 2', `<!-- plan-review:v1 -->\n${NOGO}\ntext`, NOGO, true],
  ['build shape, verdict on line 4', '<!-- build-review-sha:abc -->\n<!-- build-review:v1 -->\n<!-- build-review-final -->\n<!-- build-review-verdict:no-go -->\nx', '<!-- build-review-verdict:no-go -->', true],
  ['quoted mid-body', `hello\n${PLAN}`, PLAN, false],
  ['inline code span', `text \`${PLAN}\``, PLAN, false],
  ['fenced block', `intro\n\`\`\`\n${PLAN}\n\`\`\``, PLAN, false],
  ['text before marker on line 1', `text ${PLAN}`, PLAN, false],
  ['text after marker on line 1', `${PLAN} trailing`, PLAN, false],
  ['marker after visible text following markers', `<!-- a -->\nvisible\n${PLAN}`, PLAN, false],
]

for (const [name, body, marker, want] of cases) {
  test(`hasMarker: ${name}`, () => assert.equal(hasMarker(body, marker), want))
}

test('CRLF and BOM still count', () => {
  assert.equal(hasMarker(`\uFEFF${PLAN}\r\nbody`, PLAN), true)
  assert.equal(hasMarker(`<!-- x -->\r\n${NOGO}\r\n`, NOGO), true)
})

test('real #3342 review: quoted plan marker is not a plan, its own verdict still reads', () => {
  assert.equal(hasMarker(fixture, PLAN), false)
  assert.equal(markerValue(fixture, /plan-review-verdict:([a-z-]+)/), 'no-go')
  assert.deepEqual(leadingMarkers(fixture).slice(0, 2), ['<!-- plan-review:v1 -->', NOGO])
})

test('markerValue ignores a quoted verdict below visible text', () => {
  assert.equal(markerValue(`hi\n${NOGO}`, /plan-review-verdict:([a-z-]+)/), undefined)
})

const hasJq = spawnSync('jq', ['--version']).status === 0
test('jq regex agrees with hasMarker', { skip: hasJq ? false : 'jq not installed' }, () => {
  const re = leadingRegexSource(PLAN)
  for (const [, body, marker, want] of cases.filter((c) => c[2] === PLAN)) {
    const out = execFileSync('jq', ['-n', '--arg', 'b', body, '--arg', 're', re, '$b | test($re)'], { encoding: 'utf8' }).trim()
    assert.equal(out, String(want), body)
    assert.equal(hasMarker(body, marker), want)
  }
  const out = execFileSync('jq', ['-n', '--arg', 'b', fixture, '--arg', 're', re, '$b | test($re)'], { encoding: 'utf8' }).trim()
  assert.equal(out, 'false')
})
