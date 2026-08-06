/**
 * Contract for scripts/tag-production-deploy.mjs (#2032). Proves the decision:
 *   • the tag name is deterministic per app (`deployed/<app>/production`),
 *   • a bad app name or a non-sha-looking value is refused rather than tagged,
 *   • moving the tag issues a force tag + a force push of ONLY that one ref.
 *
 *   node --test scripts/tag-production-deploy.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tagNameFor, shaIsValid, moveDeployTag, TagDeployError } from './tag-production-deploy.mjs'

test('tagNameFor is deterministic per app', () => {
  assert.equal(tagNameFor('velo'), 'deployed/velo/production')
  assert.equal(tagNameFor('fanfare'), 'deployed/fanfare/production')
})

test('tagNameFor rejects an app name that is not a safe git-ref segment', () => {
  assert.throws(() => tagNameFor(''), TagDeployError)
  assert.throws(() => tagNameFor('../../etc'), TagDeployError)
  assert.throws(() => tagNameFor('app with spaces'), TagDeployError)
  assert.throws(() => tagNameFor(undefined), TagDeployError)
})

test('shaIsValid accepts short and full hex shas, rejects garbage', () => {
  assert.equal(shaIsValid('deadbee'), true) // 7 chars, the git-abbrev floor
  assert.equal(shaIsValid('a'.repeat(40)), true)
  assert.equal(shaIsValid('not-a-sha'), false)
  assert.equal(shaIsValid(''), false)
  assert.equal(shaIsValid('a'.repeat(41)), false)
})

test('moveDeployTag force-tags the exact sha and force-pushes only that ref', () => {
  const calls = { tag: [], push: [] }
  const git = {
    tag: (name, sha, message) => calls.tag.push({ name, sha, message }),
    push: name => calls.push.push(name)
  }
  const tag = moveDeployTag({ app: 'velo', sha: 'cafebabe1234', git })
  assert.equal(tag, 'deployed/velo/production')
  assert.deepEqual(calls.tag, [{
    name: 'deployed/velo/production',
    sha: 'cafebabe1234',
    message: 'Deployed velo to production at cafebabe1234'
  }])
  assert.deepEqual(calls.push, ['deployed/velo/production'])
})

test('moveDeployTag refuses an invalid sha before touching git', () => {
  const git = { tag: () => assert.fail('must not tag'), push: () => assert.fail('must not push') }
  assert.throws(() => moveDeployTag({ app: 'velo', sha: 'not-a-sha', git }), TagDeployError)
})

test('moveDeployTag refuses an invalid app name before touching git', () => {
  const git = { tag: () => assert.fail('must not tag'), push: () => assert.fail('must not push') }
  assert.throws(() => moveDeployTag({ app: '../etc', sha: 'cafebabe', git }), TagDeployError)
})

test('a second deploy moves the SAME tag forward, not a duplicate', () => {
  const calls = { tag: [] }
  const git = { tag: (name, sha) => calls.tag.push({ name, sha }), push: () => {} }
  moveDeployTag({ app: 'velo', sha: 'aaaaaaa', git })
  moveDeployTag({ app: 'velo', sha: 'bbbbbbb', git })
  assert.deepEqual(calls.tag.map(c => c.name), ['deployed/velo/production', 'deployed/velo/production'])
  assert.deepEqual(calls.tag.map(c => c.sha), ['aaaaaaa', 'bbbbbbb'])
})
