import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asked, qodoFindings, row, verdictOf } from './qodo-score.mjs'

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
