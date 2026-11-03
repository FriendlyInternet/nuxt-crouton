import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFixBotDispatch, pickFailedRun } from './fix-bot-dispatch.mjs'

const yes = { go: true, reason: 'ok' }
const no = { go: false, reason: 'a commit landed after the approval' }
const d = (o) => decideFixBotDispatch({ head: 'epic/3105-x', base: 'main', state: 'open', go: yes, ...o })

test('epic → main, open, standing ok → run', () => assert.equal(d().run, true))
test('epic → main without a standing ok → skip with the reason', () => {
  const r = d({ go: no })
  assert.equal(r.run, false); assert.match(r.reason, /after the approval/)
})
test('epic head into a non-main base → skip', () => assert.equal(d({ base: 'epic/1-y' }).run, false))
test('closed PR → skip', () => assert.equal(d({ state: 'closed' }).run, false))
test('work-* runs unchanged, even without go', () => assert.equal(d({ head: 'work-12', go: undefined }).run, true))
test('non-pipeline head → skip', () => assert.equal(d({ head: 'feature/x' }).run, false))

test('pickFailedRun: none failed → null', () => {
  assert.equal(pickFailedRun([{ id: 1, name: 'CI', conclusion: 'success' }]), null)
  assert.equal(pickFailedRun([]), null)
})
test('pickFailedRun: newest CI/E2E failure wins, other workflows ignored', () => {
  const r = pickFailedRun([
    { id: 1, name: 'CI', conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, name: 'E2E', conclusion: 'failure', created_at: '2026-01-01T02:00:00Z' },
    { id: 3, name: 'Lint', conclusion: 'failure', created_at: '2026-01-01T03:00:00Z' },
  ])
  assert.equal(r.id, 2)
})
