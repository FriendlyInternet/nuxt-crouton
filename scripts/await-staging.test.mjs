// The ordering rule behind a production dispatch (#1699): production for <app> at commit X starts
// only after every earlier staging deploy finished, and only if staging actually ran X for <app>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from './await-staging.mjs'

const SHA = 'aaa6d9bd'
const OLD = 'a9865a39'
const DISPATCH = '2026-08-01T10:39:29Z'
const BEFORE = '2026-08-01T10:37:00Z'
const AFTER = '2026-08-01T10:50:00Z'

const run = (id, head_sha, status, conclusion, created_at = BEFORE) => ({ id, head_sha, status, conclusion, created_at })
const job = (app, conclusion) => ({ name: `deploy (${app}, staging, https://${app}.pmcp.dev, x) / Deploy ${app} (staging)`, conclusion })
const base = { app: 'velo', sha: SHA, dispatchCreatedAt: DISPATCH }

test('velo replay: same-commit push queued + older push running -> wait', () => {
  const pushRuns = [run(2, SHA, 'queued', null), run(1, OLD, 'in_progress', null)]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {} }).action, 'wait')
})

test('older push done but same-commit push still running -> wait', () => {
  const pushRuns = [run(2, SHA, 'in_progress', null), run(1, OLD, 'completed', 'failure')]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {} }).action, 'wait')
})

test('same-commit push completed, velo staging job succeeded -> go', () => {
  const pushRuns = [run(2, SHA, 'completed', 'success')]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: { [SHA]: [job('velo', 'success')] } }).action, 'go')
})

test('velo staging job failed -> refuse', () => {
  const pushRuns = [run(2, SHA, 'completed', 'failure')]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: { [SHA]: [job('velo', 'failure')] } }).action, 'refuse')
})

test('push run evicted (cancelled, no jobs) -> refuse mentioning re-run', () => {
  const pushRuns = [run(2, SHA, 'completed', 'cancelled')]
  const d = decide({ ...base, pushRuns, jobsBySha: { [SHA]: [] } })
  assert.equal(d.action, 'refuse')
  assert.match(d.reason, /re-run/)
})

test("another app's failure does not block velo", () => {
  const pushRuns = [run(2, SHA, 'completed', 'failure')]
  const jobsBySha = { [SHA]: [job('fanfare', 'failure'), job('velo', 'success')] }
  assert.equal(decide({ ...base, pushRuns, jobsBySha }).action, 'go')
})

test('no push run for this sha, older all completed -> go', () => {
  const pushRuns = [run(1, OLD, 'completed', 'success')]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {} }).action, 'go')
})

test('push created after the dispatch is ignored -> go', () => {
  const pushRuns = [run(3, 'ccc', 'in_progress', null, AFTER)]
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {} }).action, 'go')
})

test('merge did not touch this app (no job for it) -> go', () => {
  const pushRuns = [run(2, SHA, 'completed', 'success')]
  assert.equal(decide({ ...base, app: 'kassa', pushRuns, jobsBySha: { [SHA]: [job('velo', 'success')] } }).action, 'go')
})

test('just-merged commit with no push run yet -> wait', () => {
  const pushRuns = [run(1, OLD, 'completed', 'success')]
  const commitDate = new Date(Date.now() - 30_000).toISOString()
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {}, commitDate }).action, 'wait')
})

test('old commit with no push run -> go', () => {
  const pushRuns = [run(1, OLD, 'completed', 'success')]
  const commitDate = new Date(Date.now() - 3_600_000).toISOString()
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {}, commitDate }).action, 'go')
})

test('same-commit run created after the dispatch and still running -> wait', () => {
  const pushRuns = [run(4, SHA, 'in_progress', null, AFTER)]
  const commitDate = new Date(Date.now() - 6 * 60_000).toISOString()
  assert.equal(decide({ ...base, pushRuns, jobsBySha: {}, commitDate }).action, 'wait')
})
