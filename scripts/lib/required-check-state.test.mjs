import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDone, requiredCheckState, liveCheckRuns } from './required-check-state.mjs'

const R = (o) => ({ name: 'CI Gate', started_at: '2026-11-05T16:00:00Z', ...o })

test('completed/success', () =>
  assert.equal(requiredCheckState([R({ status: 'completed', conclusion: 'success' })], 'CI Gate'), 'success'))
test('stuck in_progress with conclusion + completed_at counts as done', () =>
  assert.equal(requiredCheckState([R({ status: 'in_progress', conclusion: 'success', completed_at: '2026-11-05T16:41:46Z' })], 'CI Gate'), 'success'))
test('genuinely in progress is pending', () =>
  assert.equal(requiredCheckState([R({ status: 'in_progress', conclusion: null, completed_at: null })], 'CI Gate'), 'pending'))
test('newest attempt wins regardless of order', () => {
  const old = R({ status: 'completed', conclusion: 'failure', started_at: '2026-11-05T15:00:00Z' })
  const neu = R({ status: 'completed', conclusion: 'success', started_at: '2026-11-05T16:00:00Z' })
  assert.equal(requiredCheckState([old, neu], 'CI Gate'), 'success')
  assert.equal(requiredCheckState([neu, old], 'CI Gate'), 'success')
})
test('missing when no run has that name', () =>
  assert.equal(requiredCheckState([R({ name: 'Other', status: 'completed', conclusion: 'success' })], 'CI Gate'), 'missing'))
test('isDone catches a stuck failed run', () =>
  assert.equal(isDone({ status: 'in_progress', conclusion: 'failure', completed_at: '2026-11-05T16:41:46Z' }), true))
test('completed/failure stays pending', () =>
  assert.equal(requiredCheckState([R({ status: 'completed', conclusion: 'failure' })], 'CI Gate'), 'pending'))

// ---- liveCheckRuns (#2950) ----
const RED = ['failure', 'cancelled', 'timed_out', 'action_required', 'stale']
const red = out => out.some(r => isDone(r) && RED.includes(r.conclusion))
const C = (name, conclusion, suite, started = '2026-10-28T10:00:00Z') =>
  ({ name, status: 'completed', conclusion, started_at: started, check_suite: { id: suite } })
const W = (id, workflow_id, suite, started, event = 'pull_request') =>
  ({ id, workflow_id, event, check_suite_id: suite, run_started_at: started })
const wfA = W(1, 1, 1, '2026-10-28T10:33:00Z')
const wfB = W(2, 1, 2, '2026-10-28T10:50:00Z')
const fixture = () => [
  C('CI Gate', 'failure', 1), C('Test Suite', 'cancelled', 1), C('E2E (${{ matrix.fixture }})', 'cancelled', 1),
  C('CI Gate', 'success', 2), C('Test Suite', 'success', 2),
]

test('live: superseded cancelled/failed run does not count', () => {
  const out = liveCheckRuns(fixture(), [wfA, wfB])
  assert.deepEqual(out.map(r => r.check_suite.id), [2, 2])
  assert.equal(red(out), false)
})
test('live: orphan placeholder name from superseded run is dropped', () =>
  assert.ok(!liveCheckRuns(fixture(), [wfA, wfB]).some(r => r.name.includes('matrix'))))
test('live: real failure in newest run still counts', () => {
  const runs = [C('CI Gate', 'failure', 2)]
  assert.equal(red(liveCheckRuns(runs, [wfA, wfB])), true)
})
test('live: cancelled run never replaced still counts', () =>
  assert.equal(red(liveCheckRuns([C('Test Suite', 'cancelled', 1)], [wfA])), true))
test('live: a re-run makes the older run newest again', () => {
  const out = liveCheckRuns(fixture(), [W(1, 1, 1, '2026-10-28T13:08:00Z'), wfB])
  assert.ok(out.every(r => r.check_suite.id === 1))
})
test('live: non-Actions check-runs are kept', () => {
  const ext = C('external', 'success', 999)
  assert.ok(liveCheckRuns([ext], [wfA, wfB]).includes(ext))
})
test('live: no workflow runs → identity', () => {
  const runs = [C('CI Gate', 'failure', 1), C('CI Gate', 'success', 2)]
  for (const w of [[], undefined]) {
    const out = liveCheckRuns(runs, w)
    assert.deepEqual(out, runs)
    assert.equal(red(out), true)
  }
})
test('live: requiredCheckState on the #2922 fixture is success', () =>
  assert.equal(requiredCheckState(liveCheckRuns(fixture(), [wfA, wfB]), 'CI Gate'), 'success'))
test('live: same job name in two workflows does not hide a failure', () => {
  const runs = [C('detect', 'failure', 10), C('detect', 'success', 20)]
  const out = liveCheckRuns(runs, [W(10, 10, 10, '2026-10-28T10:34:00Z'), W(20, 20, 20, '2026-10-28T10:40:00Z')])
  assert.equal(out.length, 2)
  assert.equal(red(out), true)
})
test('live: a push run does not replace a pull_request run', () => {
  const runs = [C('CI Gate', 'failure', 1), C('CI Gate', 'success', 2)]
  const out = liveCheckRuns(runs, [W(1, 1, 1, '2026-10-28T10:00:00Z'), W(2, 1, 2, '2026-10-28T11:00:00Z', 'push')])
  assert.equal(out.length, 2)
  assert.equal(red(out), true)
})
