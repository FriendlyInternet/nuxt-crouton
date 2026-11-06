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
