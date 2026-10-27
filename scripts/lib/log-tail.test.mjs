import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logTail } from './log-tail.mjs'

const ts = '2026-10-26T10:00:00.1234567Z '

test('logTail: returns empty for empty input', () => {
    assert.deepEqual(logTail(''), { text: '', truncated: false })
    assert.deepEqual(logTail(undefined), { text: '', truncated: false })
  })

test('logTail: strips timestamps and group markers', () => {
    const out = logTail(`${ts}##[group]Run x\n${ts}hello\n${ts}##[endgroup]\n`)
    assert.equal(out.text, 'hello')
    assert.equal(out.truncated, false)
  })

test('logTail: anchors on the last ##[error] and drops what follows', () => {
    const log = [`${ts}a`, `${ts}error TS2322: bad`, `${ts}##[error]Process completed with exit code 1.`, `${ts}Post job cleanup.`].join('\n')
    const { text: out, truncated } = logTail(log)
    assert.equal(truncated, false)
    assert.equal(out.endsWith('##[error]Process completed with exit code 1.'), true)
    assert.match(out, /error TS2322: bad/)
    assert.doesNotMatch(out, /cleanup/)
  })

test('logTail: falls back to the last lines without an ##[error]', () => {
    const log = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
    const r = logTail(log, { maxLines: 3 })
    assert.equal(r.text, 'l7\nl8\nl9')
    assert.equal(r.truncated, true)
  })

test('logTail: respects maxLines and maxBytes', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n##[error]boom'
    assert.equal(logTail(log, { maxLines: 5 }).text.split('\n').length, 5)
    const { text: small, truncated } = logTail(log, { maxBytes: 50 })
    assert.equal(truncated, true)
    assert.ok(Buffer.byteLength(small) <= 50)
    assert.equal(small.endsWith('##[error]boom'), true)
  })
