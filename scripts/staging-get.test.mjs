// Contract for the pure parts of staging-get.mjs (#2760). Run: node --test scripts/staging-get.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { reviewAccount, readStagingUrl, fillTeam, formatBody, stagingGuard, buildInit } from './staging-get.mjs'

test('reviewAccount matches the deploy-time derivation (key main)', () => {
  const { email, password } = reviewAccount('velo', 's3')
  assert.equal(email, 'review+velo-main@example.com')
  assert.equal(password, createHash('sha256').update('s3:velo:main').digest('hex').slice(0, 24))
  assert.equal(password.length, 24)
})

test('readStagingUrl checks apps/ then pocs/, strips trailing slash, empty when absent', () => {
  const read = p => {
    if (p === 'pocs/notes/deploy.config.json') return JSON.stringify({ stagingUrl: 'https://notes.pmcp.dev/' })
    throw new Error('ENOENT')
  }
  assert.equal(readStagingUrl('notes', read), 'https://notes.pmcp.dev')
  assert.equal(readStagingUrl('gone', read), '')
})

test('fillTeam replaces every <team> placeholder, leaves path alone without a team', () => {
  assert.equal(fillTeam('/api/teams/<team>/x?t=<team>', 'abc'), '/api/teams/abc/x?t=abc')
  assert.equal(fillTeam('/api/teams/<team>/x', undefined), '/api/teams/<team>/x')
  assert.equal(fillTeam('/api/health', 'abc'), '/api/health')
})

test('formatBody counts rows for arrays and wrapped arrays, passes non-JSON through', () => {
  assert.equal(formatBody('[1,2]').count, ' · 2 row(s)')
  assert.equal(formatBody('{"items":[1,2,3]}').count, ' · 3 row(s)')
  assert.equal(formatBody('{"ok":true}').count, '')
  assert.deepEqual(formatBody('<html>'), { body: '<html>', count: '' })
})

test('stagingGuard allows *.pmcp.dev, refuses production and lookalikes', () => {
  assert.equal(stagingGuard('https://velo.pmcp.dev'), '')
  assert.match(stagingGuard('https://velo.friendlyinter.net'), /Refusing/)
  assert.match(stagingGuard('https://pmcp.dev.evil.com'), /Refusing/)
  assert.match(stagingGuard(''), /Refusing/)
})

test('buildInit sends the body for non-GET only', () => {
  assert.equal(buildInit('PATCH', {}, '{"a":1}').body, '{"a":1}')
  assert.equal('body' in buildInit('GET', {}, '{"a":1}'), false)
  assert.equal('body' in buildInit('POST', {}, undefined), false)
})
