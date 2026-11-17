/**
 * #3762 case 5 — the pi worker's finish-check loop: red hands back at most twice, anything that
 * is not red/green never hands back, and the outcome feeds the run-record line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFinishCheck } from './finish-check-loop.mjs'

const red = { status: 'red', findings: [{ file: 'scripts/zz-probe.mjs', line: 1, message: 'adds a Fallow ignore comment' }] }

test('red at round 0 hands back with the findings and the do-not-suppress rule', () => {
  const d = decideFinishCheck(red, 0)
  assert.equal(d.action, 'followUp')
  assert.deepEqual(d.outcome, { ran: true, rounds: 1, last: 'red' })
  assert.ok(d.message.includes('scripts/zz-probe.mjs:1'))
  assert.ok(d.message.includes('fallow' + '-ignore'))
  assert.ok(d.message.includes('baseline'))
  assert.ok(d.message.includes('round 1 of 2'))
  assert.ok(d.message.includes('PI_TASK_COMPLETE_NOTHING_LEFT'))
})

test('red at round 1 hands back again; red at the cap ends', () => {
  const d1 = decideFinishCheck(red, 1)
  assert.equal(d1.action, 'followUp')
  assert.deepEqual(d1.outcome, { ran: true, rounds: 2, last: 'red' })
  const d2 = decideFinishCheck(red, 2)
  assert.equal(d2.action, 'end')
  assert.deepEqual(d2.outcome, { ran: true, rounds: 2, last: 'red' })
  assert.equal(d2.message, undefined)
})

test('green ends', () => {
  assert.deepEqual(decideFinishCheck({ status: 'green' }, 0), { action: 'end', outcome: { ran: true, rounds: 0, last: 'green' } })
  assert.deepEqual(decideFinishCheck({ status: 'green' }, 1), { action: 'end', outcome: { ran: true, rounds: 1, last: 'green' } })
})

test('not-run, script error, timeout and unknown status never hand back', () => {
  for (const r of [{ status: 'not-run' }, null, undefined, { status: 'weird' }]) {
    const d = decideFinishCheck(r, 0)
    assert.equal(d.action, 'end')
    assert.deepEqual(d.outcome, { ran: false, rounds: 0, last: 'not-run' })
  }
  assert.deepEqual(decideFinishCheck({ status: 'not-run' }, 1).outcome, { ran: true, rounds: 1, last: 'not-run' })
})

test('loop: red three times gives exactly 2 follow-ups, then end', () => {
  let rounds = 0
  const actions = []
  for (let i = 0; i < 3; i++) {
    const d = decideFinishCheck(red, rounds)
    actions.push(d.action)
    if (d.action === 'followUp') rounds = d.outcome.rounds
  }
  assert.deepEqual(actions, ['followUp', 'followUp', 'end'])
  assert.equal(rounds, 2)
})

test('a custom cap is respected', () => {
  assert.equal(decideFinishCheck(red, 0, 1).action, 'followUp')
  assert.equal(decideFinishCheck(red, 1, 1).action, 'end')
  assert.ok(decideFinishCheck(red, 0, 1).message.includes('round 1 of 1'))
})

test('more than 20 findings are summarised', () => {
  const many = { status: 'red', findings: Array.from({ length: 25 }, (_, i) => ({ file: `f${i}.mjs`, line: i, message: 'm' })) }
  const m = decideFinishCheck(many, 0).message
  assert.ok(m.includes('f19.mjs:19'))
  assert.ok(!m.includes('f20.mjs:20'))
  assert.ok(m.includes('…and 5 more'))
})
