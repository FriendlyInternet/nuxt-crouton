import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickFailedJobs, renderFailedJobLogs } from './failed-job-logs.mjs'

const FALLOW = [
  '2026-11-05T10:00:00.0000000Z ● High complexity functions (1)',
  '2026-11-05T10:00:00.0000000Z   scripts/lib/removed-tests.mjs',
  '2026-11-05T10:00:00.0000000Z     :24 removedTests',
  '2026-11-05T10:00:00.0000000Z            9 cyclomatic   17 cognitive   15 lines',
  '2026-11-05T10:00:01.0000000Z ##[error]Process completed with exit code 1.',
].join('\n')
const GATE = '2026-11-05T10:00:00.0000000Z "base_is_epic"\n2026-11-05T10:00:01.0000000Z ##[error]Process completed with exit code 1.'

const job = (id, name, conclusion = 'failure') => ({ id, name, conclusion })

test('(a) Fallow + CI Gate -> Fallow only', async () => {
  const picked = pickFailedJobs([job(1, 'Fallow Audit'), job(2, 'CI Gate')])
  assert.deepEqual(picked.map(j => j.name), ['Fallow Audit'])
  const md = await renderFailedJobLogs(picked, async id => (id === 1 ? FALLOW : GATE))
  assert.match(md, /### Fallow Audit/)
  assert.match(md, /removedTests/)
  assert.match(md, /17 cognitive/)
  assert.match(md, /##\[error\]/)
  assert.doesNotMatch(md, /base_is_epic/)
})

test('(b) only CI Gate -> plain line', async () => {
  const picked = pickFailedJobs([job(2, 'CI Gate')])
  assert.deepEqual(picked, [])
  assert.match(await renderFailedJobLogs(picked, async () => GATE), /Only the aggregate CI Gate failed/)
})

test('(c) E2E Gate excluded, Gatekeeper lint kept', () => {
  const picked = pickFailedJobs([job(1, 'E2E Gate'), job(2, 'Gatekeeper lint')])
  assert.deepEqual(picked.map(j => j.name), ['Gatekeeper lint'])
})

test('(d) only failure/timed_out count', () => {
  const picked = pickFailedJobs([job(1, 'a', 'cancelled'), job(2, 'b', 'skipped'), job(3, 'c', 'success'), job(4, 'd', 'timed_out')])
  assert.deepEqual(picked.map(j => j.name), ['d'])
})

test('(e) capped at 3', () => {
  const picked = pickFailedJobs([1, 2, 3, 4].map(i => job(i, `j${i}`)))
  assert.deepEqual(picked.map(j => j.id), [1, 2, 3])
})

test('(f) fetch throw or empty -> could-not-fetch, others rendered', async () => {
  const md = await renderFailedJobLogs([job(1, 'A'), job(2, 'B'), job(3, 'C')], async (id) => {
    if (id === 1) throw new Error('boom')
    if (id === 2) return ''
    return FALLOW
  })
  assert.match(md, /log for A could not be fetched/)
  assert.match(md, /log for B could not be fetched/)
  assert.match(md, /17 cognitive/)
})

test('(g) fences and mentions neutralised', async () => {
  const md = await renderFailedJobLogs([job(1, 'A')], async () => 'x ``` @pmcp\n##[error]bad')
  assert.match(md, /x ''' @pmcp/)
  assert.equal(md.split('```').length, 3)
})
