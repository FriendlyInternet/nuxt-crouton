// Contract for the pure parts of staging-get.mjs (#2760). Run: node --test scripts/staging-get.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { reviewAccount, readStagingUrl, fillTeam } from './staging-get.mjs'

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
