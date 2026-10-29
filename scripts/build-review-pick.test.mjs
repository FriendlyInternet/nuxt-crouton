// layer: stack
/**
 * #2985 contract — which PRs the build reviewer picks up.
 *
 *   node --test scripts/build-review-pick.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPipelinePr } from './build-review-pick.mjs'

const pr = (over = {}) => ({
  headRefName: 'work-2892',
  baseRefName: 'epic/2889-thing',
  state: 'OPEN',
  isDraft: false,
  author: { login: 'app/nuxt-harness' },
  ...over,
})

test('app/nuxt-harness (what gh reports for #2977) is picked', () => {
  assert.equal(isPipelinePr(pr()), true)
})

test('every spelling of the pipeline authors is picked', () => {
  for (const login of ['nuxt-harness[bot]', 'nuxt-harness', 'claude', 'app/claude', 'claude[bot]']) {
    assert.equal(isPipelinePr(pr({ author: { login } })), true, login)
  }
})

test('humans and other apps are skipped', () => {
  for (const login of ['pmcp', 'app/dependabot', 'not-nuxt-harness', 'app/nuxt-harness-evil']) {
    assert.equal(isPipelinePr(pr({ author: { login } })), false, login)
  }
})

test('head not work-N is skipped', () => {
  assert.equal(isPipelinePr(pr({ headRefName: 'feature/x' })), false)
  assert.equal(isPipelinePr(pr({ headRefName: 'work-12-extra' })), false)
})

test('base not epic/* is skipped', () => {
  assert.equal(isPipelinePr(pr({ baseRefName: 'main' })), false)
})

test('draft, closed and merged PRs are skipped', () => {
  assert.equal(isPipelinePr(pr({ isDraft: true })), false)
  assert.equal(isPipelinePr(pr({ state: 'CLOSED' })), false)
  assert.equal(isPipelinePr(pr({ state: 'MERGED' })), false)
})

test('missing author is skipped, not a crash', () => {
  assert.equal(isPipelinePr(pr({ author: null })), false)
})
