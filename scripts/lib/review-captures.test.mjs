import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureRef, rawImageUrl, captureCommentBody, hasCaptureEvidence } from './review-captures.mjs'

test('captureRef validates the key', () => {
  assert.equal(captureRef('pr42'), 'refs/review-captures/pr42')
  assert.equal(captureRef('issue7'), 'refs/review-captures/issue7')
  assert.throws(() => captureRef('main'))
  assert.throws(() => captureRef('pr4/../x'))
})

test('rawImageUrl is pinned to the commit id', () => {
  assert.equal(
    rawImageUrl({ repo: 'o/r', sha: 'abc', file: 'pr42-velo-preview.png' }),
    'https://raw.githubusercontent.com/o/r/abc/pr42-velo-preview.png',
  )
})

test('captureCommentBody with files', () => {
  const body = captureCommentBody({
    key: 'pr42', repo: 'o/r', sha: 'abc', files: ['a.png', 'b.png'], artifactUrl: 'https://x/art',
  })
  assert.ok(body.startsWith('<!-- review-capture:pr42 -->'))
  assert.equal((body.match(/!\[/g) || []).length, 2)
  assert.ok(body.includes('https://raw.githubusercontent.com/o/r/abc/a.png'))
  assert.ok(body.indexOf('<details>') < body.indexOf('https://x/art'))
  assert.ok(!body.includes('@'))
})

test('T7 — captureCommentBody shows the skipped-apps note outside <details>; no note leaves the body unchanged', () => {
  const base = { key: 'pr42', repo: 'o/r', sha: 'abc', files: ['a.png'], artifactUrl: 'https://x/art' }
  const note = 'skipped 7: pins, crate (only redeployed because a package it uses changed)'
  const body = captureCommentBody({ ...base, note })
  const at = body.indexOf(`_${note}_`)
  assert.ok(at > body.indexOf('📷 **Preview screenshot**'))
  assert.ok(at < body.indexOf('<details>'))
  assert.equal(captureCommentBody({ ...base, note: '' }), captureCommentBody(base))
  assert.equal(
    captureCommentBody(base),
    '<!-- review-capture:pr42 -->\n📷 **Preview screenshot**\n\n![a](https://raw.githubusercontent.com/o/r/abc/a.png)\n\n<details><summary>Details</summary>\n\nDownload: https://x/art\n\n</details>\n'
  )
})

test('captureCommentBody with no files has no image', () => {
  const body = captureCommentBody({ key: 'pr42', repo: 'o/r', sha: 'abc', files: [], reasons: 'login failed' })
  assert.ok(!body.includes('!['))
  assert.ok(body.includes('no usable screenshot: login failed'))
})

test('hasCaptureEvidence round trip for both writers', () => {
  for (const key of ['pr42', 'issue7']) {
    const body = captureCommentBody({ key, repo: 'o/r', sha: 'abc', files: ['a.png'] })
    assert.equal(hasCaptureEvidence([{ user: { type: 'Bot' }, body }]), true)
  }
})

test('hasCaptureEvidence rejects non-evidence', () => {
  const good = captureCommentBody({ key: 'pr42', repo: 'o/r', sha: 'abc', files: ['a.png'] })
  const none = captureCommentBody({ key: 'pr42', repo: 'o/r', sha: 'abc', files: [] })
  assert.equal(hasCaptureEvidence([{ user: { type: 'Bot' }, body: none }]), false)
  assert.equal(hasCaptureEvidence([]), false)
  assert.equal(hasCaptureEvidence([{ user: { type: 'User' }, body: good }]), false)
  assert.equal(
    hasCaptureEvidence([{ user: { type: 'Bot' }, body: '<!-- review-capture:pr42 -->\n![a](https://example.com/a.png)' }]),
    false,
  )
})
