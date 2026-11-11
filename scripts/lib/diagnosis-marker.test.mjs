import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosisMarker, parseDiagnosisMarker, hasDiagnosis } from './diagnosis-marker.mjs'

const check = 'Deploy Apps (Cloudflare Workers)'

test('round-trip: sha and check (with spaces) read back', () => {
  const m = diagnosisMarker({ sha: 'abc123', check })
  assert.ok(!/check=\S* /.test(m.replace(' -->', '')), 'check is encoded, no raw spaces')
  assert.deepEqual(parseDiagnosisMarker(`🩺 **Diagnosis**\n${m}\n#### Stopped at`), { sha: 'abc123', check })
})
test('body without a marker → null', () => {
  assert.equal(parseDiagnosisMarker('🩺 **Diagnosis** but no marker'), null)
  assert.equal(parseDiagnosisMarker(undefined), null)
})
test('hasDiagnosis: true only when sha AND check both match', () => {
  const comments = [{ body: 'hi' }, { body: diagnosisMarker({ sha: 'abc123', check }) }]
  assert.equal(hasDiagnosis(comments, { sha: 'abc123', check }), true)
  assert.equal(hasDiagnosis(comments, { sha: 'def456', check }), false)
  assert.equal(hasDiagnosis(comments, { sha: 'abc123', check: 'CI' }), false)
  assert.equal(hasDiagnosis([], { sha: 'abc123', check }), false)
})
