import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { piMinutes, budget, ranOutOfTime, draftVerdict, timeoutNote, stripTimeoutNote, TIMEOUT_MARK, main } from './pi-time-budget.mjs'

const CLI = fileURLToPath(new URL('./pi-time-budget.mjs', import.meta.url))
const NOW = 1_800_000_000

// ── T4: the minutes helper ────────────────────────────────────────────────────
test('#4183 T4: minutes = 45 − used − 5, clamped to [1, 40]', () => {
  assert.equal(piMinutes({ jobStart: NOW - 3 * 60, now: NOW }), 37)
  assert.equal(piMinutes({ jobStart: NOW - 10 * 60, now: NOW }), 30)
  assert.equal(piMinutes({ jobStart: NOW - 42 * 60, now: NOW }), 1)
  assert.equal(piMinutes({ jobStart: NOW, now: NOW }), 40)
  assert.equal(piMinutes({ jobStart: undefined, now: NOW }), 40)
  assert.equal(piMinutes({ jobStart: 'nope', now: NOW }), 40)
})

test('#4183 T4: deadline = now + minutes × 60; the CLI prints both for $GITHUB_OUTPUT', () => {
  assert.deepEqual(budget({ jobStart: NOW - 3 * 60, now: NOW }), { pi_minutes: 37, deadline: NOW + 37 * 60 })
  const out = main(['minutes', '--start', String(NOW - 10 * 60)], { now: () => NOW * 1000 })
  assert.equal(out, `pi_minutes=30\ndeadline=${NOW + 30 * 60}\n`)
  // Real entry point: the CLI as the workflow's `budget` step runs it.
  const real = execFileSync('node', [CLI, 'minutes', '--start', String(Math.floor(Date.now() / 1000) - 150)], { encoding: 'utf8' })
  assert.match(real, /^pi_minutes=37\ndeadline=\d+\n$/)
})

// ── T3: the finish decision ───────────────────────────────────────────────────
const draft = (args, now = NOW) => {
  const out = main(['draft', ...args], { now: () => now * 1000 })
  const flag = /^DRAFT=(.*)$/m.exec(out)[1]
  const note = Buffer.from(/^NOTE_B64=(.*)$/m.exec(out)[1], 'base64').toString()
  return { flag, note }
}
const base = ['--minutes', '37', '--accept', 'pass', '--tests-missing', '0', '--signoff', '0']

test('#4183 T3: pi step failed at its deadline → draft + the ⏱️ note naming the minutes', () => {
  const r = draft(['--outcome', 'failure', '--deadline', String(NOW), ...base])
  assert.equal(r.flag, '--draft')
  assert.match(r.note, /<!-- pi-timeout -->⏱️ The worker ran out of time after 37 minutes\./)
  assert.match(r.note, /reply `\*\*Worker:\*\* continue` to finish it\. It stays a draft until you reply `ok`\./)
})

test('#4183 T3: pi step failed 20 minutes before its deadline (a crash) → no ⏱️', () => {
  const r = draft(['--outcome', 'failure', '--deadline', String(NOW + 20 * 60), ...base])
  assert.equal(r.flag, '')
  assert.equal(r.note, '')
})

test('#4183 T3: failed with no deadline (plan mode) → no ⏱️, ranOutOfTime false', () => {
  assert.equal(ranOutOfTime({ outcome: 'failure', deadline: '', now: NOW }), false)
  assert.equal(ranOutOfTime({ outcome: 'failure', deadline: undefined, now: NOW }), false)
  assert.equal(ranOutOfTime({ outcome: 'failure', deadline: Number(''), now: NOW }), false)
  assert.equal(ranOutOfTime({ outcome: 'failure', deadline: Number(undefined), now: NOW }), false)
  const r = draft(['--outcome', 'failure', '--deadline', '', ...base])
  assert.equal(r.note, '')
  assert.equal(r.flag, '')
})

test('#4183 T3: step success (pi exited non-zero inside set +e) → today\'s rule, no ⏱️', () => {
  assert.equal(ranOutOfTime({ outcome: 'success', deadline: NOW - 600, now: NOW }), false)
  assert.deepEqual(draft(['--outcome', 'success', '--deadline', String(NOW - 600), ...base]), { flag: '', note: '' })
  const red = draft(['--outcome', 'success', '--deadline', String(NOW - 600), '--minutes', '37', '--accept', 'fail', '--tests-missing', '0', '--signoff', '0'])
  assert.deepEqual(red, { flag: '--draft', note: '' })
})

test('#4183 T3: today\'s draft rule is kept (accept fail / tests missing / sign-off hold)', () => {
  assert.equal(draftVerdict({ accept: 'pass', testsMissing: '0', signoffHold: '0' }).draft, '')
  assert.equal(draftVerdict({ accept: 'fail', testsMissing: '0', signoffHold: '0' }).draft, '--draft')
  assert.equal(draftVerdict({ accept: 'pass', testsMissing: '1', signoffHold: '0' }).draft, '--draft')
  assert.equal(draftVerdict({ accept: 'pass', testsMissing: '0', signoffHold: '1' }).draft, '--draft')
  assert.equal(draftVerdict({ accept: 'pass', timedOut: true, minutes: 9 }).note, timeoutNote(9))
})

test('#4183 T3: stripTimeoutNote removes only the marked line', () => {
  const body = `Closes #7\n\nHow to test: see the issue\n${TIMEOUT_MARK}⏱️ ran out\n\n🤖 footer`
  assert.equal(stripTimeoutNote(body), 'Closes #7\n\nHow to test: see the issue\n\n🤖 footer')
  assert.equal(stripTimeoutNote('a\nb'), 'a\nb')
})

test('#4183 T3: clear strips ⏱️ from the open PR, keeps it when the round timed out again', () => {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 12, body: `Closes #7\n${TIMEOUT_MARK}⏱️ x` }])
    return ''
  }
  const kept = main(['clear', '--branch', 'work-7', '--outcome', 'failure', '--deadline', String(NOW)], { gh, now: () => NOW * 1000 })
  assert.match(kept, /kept/)
  assert.equal(calls.length, 0)
  const out = main(['clear', '--branch', 'work-7', '--outcome', 'success', '--deadline', String(NOW + 600)], { gh, now: () => NOW * 1000 })
  assert.match(out, /stripped/)
  assert.deepEqual(calls[1].slice(0, 3), ['pr', 'edit', '12'])
  const boom = main(['clear', '--branch', 'work-7'], { gh: () => { throw new Error('api down') } })
  assert.match(boom, /skipped/)
})
