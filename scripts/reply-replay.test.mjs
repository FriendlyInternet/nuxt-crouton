// Reply replay (#4102): real past owner replies (plus two synthetic ones) replayed through
// today's router + re-plan step. Each case pins today's reading (a change to it fails a test)
// and checks it against what the reply rules want — a mismatch is a known gap (todo), not a fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { todayOutcome, meaningToday, trimBody, labelsAt } from './reply-replay.mjs'
import { openRecord, recordMarker, readRecord, VERDICT } from './lib/reply-record.mjs'
import { markerValue } from './lib/marker.mjs'
import { QUESTION_RECORD, REJECTED_RECORD } from './lib/plan-verdict.mjs'
import { cleanQuestion } from './plan-hold.mjs'

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

// covers: T6
test('#4192 no known gaps are left, and every case names its reply login', () => {
  const cases = files.map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))])
  for (const [f, c] of cases) assert.equal(typeof c.reply.userLogin, 'string', f)
  assert.deepEqual(cases.filter(([, c]) => c.today !== c.want).map(([f]) => f), [])
  assert.equal(meaningToday(todayOutcome(cases.find(([f]) => f === '3982-6957996134.json')[1])), 'choice:A')
  const nonOwner = cases.find(([f]) => f === '4036-non-owner-ok.json')[1]
  assert.equal(meaningToday(todayOutcome(nonOwner)), 'ignore')
})

// ── #4145: record twins — the record the hold writes must not change what a reply does ────────────────
const RECORD_LINE = /^<!-- reply-record:v1 .* -->\n/m
const isBotC = (x) => x?.userType === 'Bot'
/** The case with the record its newest bot verdict's hold writes (or without any record); null when that hold writes none. */
function twin(c, withRecord) {
  const at = c.comments.findLastIndex((x) => isBotC(x) && markerValue(x.body || '', VERDICT))
  if (at < 0) return null
  const v = c.comments[at]
  const kind = markerValue(v.body, VERDICT)
  const noGos = c.comments.filter((x) => isBotC(x) && markerValue(x.body || '', VERDICT) === 'no-go').length
  if (kind !== 'needs-owner' && !(kind === 'no-go' && noGos >= 2)) return null
  const bare = v.body.replace(RECORD_LINE, '')
  const b = bare.indexOf('— '), e = bare.indexOf('\n**Needs:**')
  const record = kind === 'needs-owner' ? QUESTION_RECORD(cleanQuestion(bare.slice(b + 2, e))) : REJECTED_RECORD
  const [first, ...rest] = bare.split('\n')
  const body = withRecord ? [first, recordMarker(record), ...rest].join('\n') : bare
  return { ...c, comments: c.comments.map((x, i) => (i === at ? { ...x, body } : x)) }
}

let twins = 0
for (const file of files) {
  const c = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
  const withR = twin(c, true)
  if (!withR) continue
  twins++
  // covers: T5
  test(`${file}: with its reply record it reads the same as without`, () => {
    if (c.labels.includes('status:blocked') && !c.labels.includes('plan:approved')) {
      assert.ok(openRecord({ comments: withR.comments, labels: withR.labels }), 'the twin really carries an open record')
    }
    assert.equal(openRecord({ comments: twin(c, false).comments, labels: c.labels }), null, 'the record-less twin has none')
    assert.deepEqual(todayOutcome(withR), todayOutcome(twin(c, false)))
  })
}

test('#4145 record twins exist for every needs-owner case, and the synthetic record cases carry a real record', () => {
  assert.ok(twins >= 6, `found ${twins}`)
  for (const f of ['4036-record-ok.json', '4036-record-build-it.json']) {
    const c = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const r = openRecord({ comments: c.comments, labels: c.labels })
    assert.equal(r?.kind, 'plan-question', f)
    assert.deepEqual(readRecord(c.comments.at(-1).body), r)
  }
})

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
