/**
 * #2757 — which issues start in plan mode.   node --test scripts/lib/plan-route.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeIssue } from './plan-route.mjs'

const r = (labels, text = '') => routeIssue({ labels, text }).mode

test('a bug (type:fix) plans first', () => assert.equal(r(['type:fix', 'work-this']), 'plan'))
test('a body naming packages/ plans first', () => assert.equal(r(['type:feat'], 'edit packages/crouton-core/app/x.vue'), 'plan'))
test('auth / sync / scoped-access / team-filter code plans first, whatever the labels', () => {
  assert.equal(r(['type:chore'], 'touch packages/crouton-auth/server/x.ts'), 'plan')
  assert.equal(r(['type:chore'], 'fix apps/velo/server/api/sync-push.ts'), 'plan')
  assert.equal(r(['type:chore'], 'change the scoped-access check'), 'plan')
  assert.equal(r(['type:chore'], 'the pairing flow'), 'plan')
  assert.equal(r(['type:chore'], 'the query filters by teamId'), 'plan')
})
test('a docs chore builds directly', () => assert.equal(r(['type:chore'], 'fix a typo in docs/intro.md'), 'build'))
test('an app-only tweak builds directly', () => assert.equal(r(['type:feat'], 'change a colour in apps/velo/app/app.vue'), 'build'))
test('plan-first forces, no-plan skips and wins', () => {
  assert.equal(r(['plan-first'], 'typo'), 'plan')
  assert.equal(r(['type:fix', 'no-plan']), 'build')
  assert.equal(r(['plan-first', 'no-plan']), 'build')
})
test('every verdict carries a reason', () => assert.ok(routeIssue({ labels: ['type:fix'] }).reason.length > 0))
