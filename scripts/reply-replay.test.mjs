// Reply replay (#4102): real past owner replies (plus two synthetic ones) replayed through
// today's router + re-plan step. Each case pins today's reading (a change to it fails a test)
// and checks it against what the reply rules want — a mismatch is a known gap (todo), not a fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { todayOutcome, meaningToday, trimBody, labelsAt } from './reply-replay.mjs'

const dir = new URL('./fixtures/reply-replay/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()

test('the reply-replay folder holds at least 5 cases', () => {
  assert.ok(files.length >= 5, `found ${files.length}`)
})

for (const file of files) {
  const c = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
  const got = () => meaningToday(todayOutcome(c))
  test(`${file}: today reads it as ${c.today}`, () => {
    assert.equal(got(), c.today)
  })
  test(`${file}: want ${c.want}`, c.today !== c.want ? { todo: 'known gap' } : {}, () => {
    assert.equal(got(), c.want)
  })
}

test('trimBody keeps the markers of a long body and cuts the rest to 1500 chars', () => {
  const markers = '<!-- a:v1 --><!-- verdict:needs-owner -->'
  const body = `<!-- a:v1 -->\n${'x'.repeat(1000)}\n<!-- verdict:needs-owner -->\n${'y'.repeat(1000)}`
  const out = trimBody(body)
  assert.ok(out.startsWith(`${markers}\n`))
  assert.ok(out.length <= markers.length + 1501)
  assert.ok(!out.slice(markers.length).includes('<!--'))
})

test('trimBody leaves a short body unchanged', () => {
  assert.equal(trimBody('<!-- m -->\nok'), '<!-- m -->\nok')
  assert.equal(trimBody('x'.repeat(1600)), 'x'.repeat(1600))
})

test('labelsAt replays labeled/unlabeled in order and ignores events after the time', () => {
  const ev = (event, name, created_at) => ({ event, label: { name }, created_at })
  const events = [
    ev('labeled', 'work-this', '2026-11-01T10:00:00Z'),
    ev('labeled', 'status:blocked', '2026-11-01T11:00:00Z'),
    ev('unlabeled', 'status:blocked', '2026-11-01T12:00:00Z'),
    { event: 'commented', created_at: '2026-11-01T12:30:00Z' },
    ev('labeled', 'status:blocked', '2026-11-01T13:00:00Z'),
    ev('labeled', 'plan:approved', '2026-11-01T15:00:00Z'),
  ]
  assert.deepEqual(labelsAt(events, '2026-11-01T11:30:00Z'), ['work-this', 'status:blocked'])
  assert.deepEqual(labelsAt(events, '2026-11-01T12:00:00Z'), ['work-this'])
  assert.deepEqual(labelsAt(events, '2026-11-01T14:00:00Z'), ['work-this', 'status:blocked'])
})
