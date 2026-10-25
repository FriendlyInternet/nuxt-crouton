/**
 * #2456 contract — the review-flag check tries the app's own pages, not just `/`.
 *
 *   node --test scripts/review-flag-check.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidatePaths, snippet, checkFlag } from './review-flag-check.mjs'

test('candidatePaths: / first, then landing, then surfaces, de-duplicated', () => {
  assert.deepEqual(candidatePaths({}), ['/'])
  assert.deepEqual(candidatePaths(undefined), ['/'])
  assert.deepEqual(
    candidatePaths({ reviewLogin: { landing: '/a' }, reviewSurfaces: [{ path: '/a' }, { path: '/b' }, {}, { path: 'x' }] }),
    ['/', '/a', '/b'],
  )
})

test('snippet strips newlines and caps at 200', () => {
  assert.equal(snippet('a\nb\r\nc'), 'a b c')
  assert.equal(snippet('x'.repeat(500)).length, 200)
  assert.equal(snippet(undefined), '')
})

const page = (status, body, url) => ({ status, url, text: async () => body })

test('passes on a later page when / lacks the flag', async () => {
  const f = async url => url.endsWith('/') ? page(404, 'nope', url) : page(200, '{"croutonReview":true}', url)
  const r = await checkFlag('https://x.dev', ['/', '/app'], f)
  assert.equal(r.ok, true)
  assert.equal(r.url, 'https://x.dev/app')
})

test('fails with one attempt per URL, including thrown fetches', async () => {
  const f = async (url) => {
    if (url.endsWith('/b')) throw new Error('boom')
    return page(302, 'login\npage', 'https://x.dev/login')
  }
  const r = await checkFlag('https://x.dev/', ['/', '/b'], f)
  assert.equal(r.ok, false)
  assert.equal(r.attempts.length, 2)
  assert.deepEqual(r.attempts[0], { url: 'https://x.dev/', status: 302, finalUrl: 'https://x.dev/login', body: 'login page' })
  assert.match(r.attempts[1].body, /boom/)
})
