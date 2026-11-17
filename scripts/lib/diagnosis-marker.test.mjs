import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosisMarker, parseDiagnosisMarker, hasDiagnosis } from './diagnosis-marker.mjs'

const check = 'Deploy Apps (Cloudflare Workers)'

test('round-trip: sha and check (with spaces) read back', () => {
  const m = diagnosisMarker({ sha: 'abc123', check })
  assert.ok(!/check=\S* /.test(m.replace(' -->', '')), 'check is encoded, no raw spaces')
  assert.deepEqual(parseDiagnosisMarker(`🩺 **Diagnosis**\n${m}\n#### Stopped at`), { sha: 'abc123', check, round: 1 })
})
test('#3668 round=2 round-trips; an old marker without a round reads as round 1', () => {
  const m = diagnosisMarker({ sha: 'abc123', check, round: 2 })
  assert.match(m, / round=2 -->$/)
  assert.deepEqual(parseDiagnosisMarker(m), { sha: 'abc123', check, round: 2 })
  const old = `<!-- diagnosis:v1 sha=abc123 check=${encodeURIComponent(check)} -->`
  assert.deepEqual(parseDiagnosisMarker(old), { sha: 'abc123', check, round: 1 })
})
test('#3668 hasDiagnosis with round 2 ignores a round-1 comment', () => {
  const r1 = [{ body: diagnosisMarker({ sha: 'abc123', check }) }]
  assert.equal(hasDiagnosis(r1, { sha: 'abc123', check, round: 2 }), false)
  assert.equal(hasDiagnosis(r1, { sha: 'abc123', check, round: 1 }), true)
  assert.equal(hasDiagnosis([{ body: diagnosisMarker({ sha: 'abc123', check, round: 2 }) }], { sha: 'abc123', check, round: 2 }), true)
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
