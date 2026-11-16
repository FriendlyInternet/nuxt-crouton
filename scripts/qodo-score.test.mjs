import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asked, askedAt, unanswered, qodoFindings, row, verdictOf, searchQuery, truncated } from './qodo-score.mjs'

const cs = [
  { body: '/review\n<!-- qodo-asked-sha:abc123 -->', user: { login: 'nuxt-harness[bot]' } },
  { body: '<!-- build-review-verdict:go -->', user: { login: 'nuxt-harness[bot]' } },
  { body: 'Bug: x', user: { login: 'qodo-code-review[bot]' }, html_url: 'u1' },
]

test('detects ask, verdict and findings', () => {
  assert.equal(asked(cs), true)
  assert.equal(verdictOf(cs), 'go')
  assert.equal(qodoFindings(cs).length, 1)
  assert.match(row(7, cs), /^\| #7 \| go \| 1 \| u1 /)
})

test('no verdict / no ask', () => {
  assert.equal(verdictOf([]), 'none')
  assert.equal(asked([]), false)
})

test('asks once per head SHA', () => {
  assert.equal(askedAt(cs, 'abc123'), true)
  assert.equal(askedAt(cs, 'def456'), false)
  assert.equal(askedAt([], 'abc123'), false)
})

test('flags asked PRs Qodo never answered', () => {
  assert.deepEqual(unanswered([{ pr: 1, findings: 0 }, { pr: 2, findings: 3 }]), [1])
})

test('searchQuery adds the created window', () => {
  assert.equal(searchQuery('2026-11-05'), 'head:work- created:>=2026-11-05')
})

test('truncated flags a result that filled the limit', () => {
  assert.equal(truncated(1000, '1000'), true)
  assert.equal(truncated(999, 1000), false)
  assert.equal(truncated(100, '100'), true)
})
