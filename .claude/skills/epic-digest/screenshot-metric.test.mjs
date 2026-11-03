import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tallyScreenshotChecks, screenshotLine } from './screenshot-metric.mjs'

const run = (conclusion, at = '2026-10-01T00:00:00Z', name = 'Preview screenshot') => ({ name, conclusion, completed_at: at })

test('counts success as useful, failure as a miss, ignores neutral and other checks', () => {
  const s = tallyScreenshotChecks([
    [run('success')],
    [run('failure')],
    [run('neutral')],
    [run('success', undefined, 'CI')],
    []
  ])
  assert.deepEqual(s, { useful: 1, total: 2 })
})

test('the newest run per PR wins (a re-run that succeeded is useful)', () => {
  const s = tallyScreenshotChecks([[run('failure', '2026-10-01T00:00:00Z'), run('success', '2026-10-02T00:00:00Z')]])
  assert.deepEqual(s, { useful: 1, total: 1 })
})

test('line is empty with nothing measured', () => {
  assert.equal(screenshotLine({ useful: 0, total: 0 }), '')
  assert.equal(screenshotLine(undefined), '')
  assert.equal(screenshotLine({ useful: 3, total: 4 }), 'Useful screenshots: 3 of 4 this week')
})
