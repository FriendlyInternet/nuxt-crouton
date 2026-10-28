// layer: harness
/**
 * #2819 contract — when the owner's lgtm merges an epic PR into main.
 *
 *   node --test scripts/epic-merge-decision.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideEpicMerge } from './epic-merge-decision.mjs'

const run = (name, status = 'completed', conclusion = 'success', started_at = '2026-01-01T00:00:00Z') =>
  ({ name, status, conclusion, started_at })
const green = [run('CI Gate'), run('E2E Gate')]
const pr = (o = {}) => ({ state: 'open', draft: false, head: { ref: 'epic/1-x' }, base: { ref: 'main' }, ...o })
const owner = (body = 'lgtm') => ({ body, author_association: 'OWNER', user: { type: 'User' } })
const decide = (o = {}) => decideEpicMerge({ comment: owner(), pr: pr(), checkRuns: green, ...o })

test('green gates + owner lgtm merges', () => assert.equal(decide().action, 'merge'))
test('✅ also merges', () => assert.equal(decide({ comment: owner('✅') }).action, 'merge'))
test('red CI Gate does not merge and names the check', () => {
  const d = decide({ checkRuns: [run('CI Gate', 'completed', 'failure'), run('E2E Gate')] })
  assert.equal(d.action, 'red'); assert.deepEqual(d.failing, ['CI Gate'])
})
test('red wins over pending', () => {
  const d = decide({ checkRuns: [run('CI Gate', 'completed', 'failure')] })
  assert.equal(d.action, 'red')
})
test('missing gate waits, never merges', () => {
  const d = decide({ checkRuns: [run('CI Gate')] })
  assert.equal(d.action, 'wait'); assert.deepEqual(d.pending, ['E2E Gate'])
})
test('in-progress gate waits', () =>
  assert.equal(decide({ checkRuns: [run('CI Gate'), run('E2E Gate', 'in_progress', null)] }).action, 'wait'))
test('a later green re-run supersedes an earlier red', () =>
  assert.equal(decide({ checkRuns: [run('CI Gate', 'completed', 'failure', '2026-01-01T00:00:00Z'),
    run('CI Gate', 'completed', 'success', '2026-01-01T01:00:00Z'), run('E2E Gate')] }).action, 'merge'))
test('cancelled counts as red', () =>
  assert.equal(decide({ checkRuns: [run('CI Gate', 'completed', 'cancelled'), run('E2E Gate')] }).action, 'red'))
test('non-owner is ignored', () =>
  assert.equal(decide({ comment: { ...owner(), author_association: 'CONTRIBUTOR' } }).action, 'ignore'))
test('bot is ignored', () =>
  assert.equal(decide({ comment: { ...owner(), user: { type: 'Bot' } } }).action, 'ignore'))
test('discussing lgtm is not approval', () =>
  assert.equal(decide({ comment: owner('I would not lgtm this yet') }).action, 'ignore'))
test('non-epic head, non-main base, draft, closed are ignored', () => {
  assert.equal(decide({ pr: pr({ head: { ref: 'work-1' } }) }).action, 'ignore')
  assert.equal(decide({ pr: pr({ base: { ref: 'epic/1-x' } }) }).action, 'ignore')
  assert.equal(decide({ pr: pr({ draft: true }) }).action, 'ignore')
  assert.equal(decide({ pr: pr({ state: 'closed' }) }).action, 'ignore')
})
