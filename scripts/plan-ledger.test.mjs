import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ledgerRow, ledgerPath } from './plan-ledger.mjs'
import { writeRecord } from './eval-ledger/record-run.mjs'

const wf = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')

test('ledgerRow counts plans and takes the last verdict', () => {
  const c = [
    { body: '<!-- pipeline-plan:v1 -->\nplan' }, { body: '<!-- plan-review-verdict:revise -->' },
    { body: '<!-- pipeline-plan:v1 -->\nplan2' }, { body: '<!-- plan-review-verdict:go -->' },
  ]
  assert.deepEqual(ledgerRow(3457, c), { issue: 3457, planRounds: 2, verdict: 'go', fixRounds: 0 })
  assert.equal(ledgerRow(1, []).verdict, 'none')
})

test('ledgerPath is unique per run', () => {
  assert.equal(ledgerPath({ issue: 3457 }, '42', '1'), 'plan-ledger/3457-42-1.json')
  assert.notEqual(ledgerPath({ issue: 3457 }, '43', '1'), ledgerPath({ issue: 3457 }, '42', '1'))
})

function fakeFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init })
    return { status: 200, json: async () => ({}) }
  }
}

test('writeRecord honours a custom path', async () => {
  const calls = []
  await writeRecord({ repo: 'o/r', token: 't', record: { run_id: '42', attempt: 1, started_at: '2026-11-06T00:00:00Z', workflow: 'w' }, path: 'plan-ledger/3457-42-1.json', message: 'm', fetchImpl: fakeFetch(calls) })
  const put = calls.find((c) => c.init.method === 'PUT')
  assert.ok(put.url.endsWith('/contents/plan-ledger/3457-42-1.json'))
  assert.equal(JSON.parse(put.init.body).branch, 'pipeline-data')
})

test('writeRecord default path unchanged', async () => {
  const calls = []
  await writeRecord({ repo: 'o/r', token: 't', record: { run_id: '42', attempt: 1, started_at: '2026-11-06T00:00:00Z', workflow: 'w' }, fetchImpl: fakeFetch(calls) })
  assert.ok(calls.find((c) => c.init.method === 'PUT').url.endsWith('/contents/records/2026-11-06/42-1.json'))
})

test('worker prompt no longer asks for the ledger edit', () => {
  assert.doesNotMatch(wf, /append this ONE line to writeups\/reports\/plan-review-ledger/)
})

test('record-outcome writes the ledger row', () => {
  assert.match(wf, /plan-ledger\.mjs --write/)
})
