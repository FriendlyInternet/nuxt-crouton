import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../.github/workflows/', import.meta.url)
const files = readdirSync(dir).filter(f => f.endsWith('.yml'))

test('no workflow carries a helper-import fallback shim (#3451)', () => {
  for (const f of files) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /not loadable|fall back to the inline|label rule only|Bootstrap-safe/, f)
  }
})

test('automerge keeps no inline copy of the required-check rule', () => {
  const wf = readFileSync(new URL('automerge-epic-subpr.yml', dir), 'utf8')
  assert.doesNotMatch(wf, /liveCheckRuns = runs => runs/)
  assert.doesNotMatch(wf, /requiredCheckStateFn = null/)
})

test('workflow-runs read for the live filter is gated on needsLiveFilter (#3453)', () => {
  for (const f of ['automerge-epic-subpr.yml', 'status.yml']) {
    const wf = readFileSync(new URL(f, dir), 'utf8')
    const gate = wf.indexOf('needsLiveFilter(')
    assert.ok(gate > -1, `${f} uses needsLiveFilter`)
    const call = wf.indexOf('listWorkflowRunsForRepo', gate)
    const live = wf.indexOf('liveCheckRuns(', gate)
    assert.ok(call > -1 && call < live + 400, `${f}: read follows the gate`)
  }
})
