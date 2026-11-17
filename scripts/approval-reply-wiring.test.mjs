/** #4038 T3 — the merge-on-approval and skipped-approval steps call the tested modules. node --test scripts/approval-reply-wiring.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
const io = readFileSync(new URL('./lib/pr-merge-gate-io.mjs', import.meta.url), 'utf8')
// The `script: |` body of the step with `id: <id>` (up to the next step).
const stepScript = (id) => {
  const at = wf.indexOf(`id: ${id}\n`)
  assert.ok(at > 0, `step ${id} not found`)
  const end = wf.indexOf('\n      - ', at)
  return wf.slice(at, end)
}
const job = (name, next) => wf.slice(wf.indexOf(`\n  ${name}:`), wf.indexOf(`\n  ${next}:`))

test('mergegate imports runGateMerge and keeps no merge rule of its own', () => {
  const s = stepScript('mergegate')
  assert.match(s, /scripts\/lib\/pr-merge-gate-io\.mjs/)
  assert.match(s, /runGateMerge\(\{ github, context, core \}\)/)
  assert.match(s, /setOutput\('skipped'/)
  assert.doesNotMatch(s, /\^epic\\\//)
  assert.doesNotMatch(s, /pulls\.merge/)
})

test('runGateMerge decides with gateMergeDecision over the read checks', () => {
  assert.match(io, /gateMergeDecision\(/)
  assert.match(io, /readGateChecks\(/)
  assert.match(io, /merge_method: 'merge'/)
})

test('explain-skipped-approval calls runSkippedApproval with no epic/* early return', () => {
  const j = job('explain-skipped-approval', 'revise')
  assert.ok(j.length > 200)
  assert.match(j, /scripts\/lib\/skipped-approval\.mjs/)
  assert.match(j, /runSkippedApproval\(\{ github, context, core \}\)/)
  assert.doesNotMatch(j, /\^epic\\\//)
  assert.doesNotMatch(j, /No pending epic\/\* gate PR/)
})
