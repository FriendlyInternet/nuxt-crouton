import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AREAS, validateSuggestion, isExpired, resolveTarget, defaultSource, suggestionPath } from './suggestions.mjs'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
const good = (over = {}) => ({
  ts: '2026-11-19T10:00:00.000Z',
  source: 'worker run 1',
  area: 'pipeline',
  text: 'One idea',
  evidence: 'https://github.com/FriendlyInternet/nuxt-crouton/issues/4223',
  ...over,
})

test('1: a line without evidence, or with an http:// evidence URL, is refused', () => {
  const { evidence, ...noEvidence } = good()
  const r1 = validateSuggestion(noEvidence)
  assert.equal(r1.ok, false)
  assert.ok(r1.errors.includes('evidence (one https:// URL) is required'), r1.errors.join('; '))
  const r2 = validateSuggestion(good({ evidence: 'http://example.com/x' }))
  assert.equal(r2.ok, false)
  assert.ok(r2.errors.some((e) => e.includes('https://')), r2.errors.join('; '))
})

test('2: a line with an unknown area is refused', () => {
  const r = validateSuggestion(good({ area: 'nope' }))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.startsWith('unknown area "nope"')), r.errors.join('; '))
  assert.ok(AREAS.includes('pipeline'))
})

test('3: two sentences are refused; one sentence passes with or without a final dot; a filename dot is fine', () => {
  const two = validateSuggestion(good({ text: 'First idea. Second idea.' }))
  assert.equal(two.ok, false)
  assert.ok(two.errors.includes('text must be one sentence'))
  assert.equal(validateSuggestion(good({ text: 'One idea' })).ok, true)
  assert.equal(validateSuggestion(good({ text: 'One idea.' })).ok, true)
  const first = validateSuggestion(good({ text: '`on-pr-close.yml` never runs for a PR closed in conflict' }))
  assert.equal(first.ok, true, first.errors.join('; '))
})

test('validateSuggestion collects every error and trims text', () => {
  const r = validateSuggestion({ ts: 'x', area: 'nope', text: '  ' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.length >= 4)
  assert.equal(validateSuggestion(good({ text: '  One idea  ' })).line.text, 'One idea')
})

test('4: a line 31 days old, seen once, is expired', () => {
  const line = good({ ts: daysAgo(31) })
  assert.equal(isExpired(line, [line], NOW), true)
  assert.equal(isExpired(line, [], NOW), true)
})

test('5: a line 31 days old whose idea was seen again 7 days ago is not expired', () => {
  const line = good({ ts: daysAgo(31) })
  assert.equal(isExpired(line, [line, good({ ts: daysAgo(7) })], NOW), false)
})

test('6: a line 10 days old, seen once, is not expired', () => {
  const line = good({ ts: daysAgo(10) })
  assert.equal(isExpired(line, [line], NOW), false)
})

test('7: resolveTarget picks token + repo, or sets an error', () => {
  const none = resolveTarget({}, { ghToken: '' })
  assert.ok(none.error)
  assert.deepEqual(resolveTarget({ GH_TOKEN: 't1', GITHUB_REPOSITORY: 'o/r' }), { token: 't1', repo: 'o/r', error: null })
  assert.deepEqual(resolveTarget({}, { ghToken: 't2', ghRepo: 'o/r2' }), { token: 't2', repo: 'o/r2', error: null })
  assert.match(resolveTarget({ GH_TOKEN: 't' }).error, /no repo/)
})

test('defaultSource and suggestionPath', () => {
  assert.equal(defaultSource({ GITHUB_RUN_ID: '9', CROUTON_CHAT_NAME: 'n' }), 'worker run 9')
  assert.equal(defaultSource({ CROUTON_CHAT_NAME: 'nick' }), 'nick')
  assert.equal(defaultSource({ CROUTON_CHAT_ID: '42' }), 'chat 42')
  assert.equal(defaultSource({}), 'unknown')
  assert.equal(suggestionPath(good(), 'abc123'), 'suggestions/2026-11-19/2026-11-19T10-00-00-000Z-abc123.json')
})
