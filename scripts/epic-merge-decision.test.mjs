/**
 * #2819 contract — when the owner's lgtm merges an epic PR into main.
 *
 *   node --test scripts/epic-merge-decision.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideEpicMerge } from './epic-merge-decision.mjs'
import { ownerMergeGo } from './lib/owner-merge-go.mjs'

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

// #3105 — the decision driven by ownerMergeGo (the owner's standing `ok`), not by one comment.
const ME = 'pmcp'
const cm = (body, created_at) => ({ user: { login: ME, type: 'User' }, body, created_at })
const commit = (date, o = {}) => ({ parents: [{}], files: ['a.ts'], commit: { committer: { date, name: 'someone' } }, ...o })
const goOf = (comments, commits = []) => ownerMergeGo({ comments, commits, owner: ME })
const withGo = (go, checkRuns = green) => decideEpicMerge({ pr: pr(), checkRuns, go })
const OK = cm('ok', '2026-01-02T00:00:00Z')

test('go: green + standing ok merges', () => assert.equal(withGo(goOf([OK])).action, 'merge'))
test('go: ok then a worker-revision commit does not merge', () =>
  assert.notEqual(withGo(goOf([OK], [commit('2026-01-03T00:00:00Z')])).action, 'merge'))
test('go: ok then a CI-Fix commit by claude[bot] still merges', () => {
  const fix = commit('2026-01-03T00:00:00Z', { commit: { message: 'fix\n\nCI-Fix: true', committer: { date: '2026-01-03T00:00:00Z', name: 'claude[bot]' } } })
  assert.equal(withGo(goOf([OK], [fix])).action, 'merge')
})
test('go: red gate with ok reports red', () =>
  assert.equal(withGo(goOf([OK]), [run('CI Gate', 'completed', 'failure'), run('E2E Gate')]).action, 'red'))
test('go: pending or missing gate waits', () =>
  assert.equal(withGo(goOf([OK]), [run('CI Gate')]).action, 'wait'))
test('go: a later not ok does not merge', () =>
  assert.notEqual(withGo(goOf([OK, cm('not ok: rename it', '2026-01-03T00:00:00Z')])).action, 'merge'))
test('go: no approval ignores with the reason', () => {
  const d = withGo(goOf([]))
  assert.equal(d.action, 'ignore'); assert.match(d.reason, /no owner approval/)
})
test('go: still ignores a draft / non-epic head', () => {
  assert.equal(decideEpicMerge({ pr: pr({ draft: true }), checkRuns: green, go: { go: true, reason: '' } }).action, 'ignore')
  assert.equal(decideEpicMerge({ pr: pr({ head: { ref: 'work-1' } }), checkRuns: green, go: { go: true, reason: '' } }).action, 'ignore')
})

// #3306: a red NON-gate check never blocks — documents why the workflow must not skip fetching
// comments/commits just because isRed() is true on an epic → main PR.
test('red non-gate check with green gates and owner lgtm still merges', () =>
  assert.equal(decide({ checkRuns: [...green, run('some-lint', 'completed', 'failure')] }).action, 'merge'))

test('gates left in_progress but carrying a conclusion still merge (#3429)', () => {
  const stuck = n => ({ ...run(n, 'in_progress', 'success'), completed_at: '2026-01-01T00:01:00Z' })
  assert.equal(decide({ checkRuns: [stuck('CI Gate'), stuck('E2E Gate')] }).action, 'merge')
})
