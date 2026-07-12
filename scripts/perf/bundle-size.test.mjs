/**
 * Tests for the bundle-size budget engine (#1581).
 *   node --test scripts/perf/bundle-size.test.mjs
 *
 * measure() must be deterministic (that's the whole point vs. Lighthouse), and the
 * budget bands + regression math must be predictable. Verified against a synthetic
 * assets dir written to a temp folder — no real build needed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { measure, previousGzip } from './bundle-size.mjs'
import { scoreBundle, CLIENT_SIZE_BANDS, SERVER_SIZE_BANDS, REGRESSION_BANDS, worst } from './scorecard.mjs'

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'))
  const nested = join(dir, 'nested')
  mkdirSync(nested)
  for (const [name, content] of Object.entries(files)) {
    const target = name.startsWith('nested/') ? join(dir, name) : join(dir, name)
    writeFileSync(target, content)
  }
  return dir
}

test('measure sums raw + gzip by type, recursively, ignoring non-asset files', () => {
  const js = 'console.log("x");'.repeat(50)
  const css = 'body{color:red}'.repeat(50)
  const dir = fixture({ 'a.js': js, 'b.mjs': js, 'c.css': css, 'nested/d.js': js, 'readme.txt': 'ignore me' })
  try {
    const m = measure(dir)
    assert.equal(m.fileCount, 4) // a.js, b.mjs, nested/d.js, c.css — .txt ignored
    assert.equal(m.totalJs, Buffer.byteLength(js) * 3)
    assert.equal(m.totalCss, Buffer.byteLength(css))
    assert.equal(m.gzipJs, gzipSync(Buffer.from(js)).length * 3)
    assert.equal(m.totalGzip, m.gzipJs + m.gzipCss)
    // chunks sorted by gzip desc.
    assert.ok(m.chunks[0].gzip >= m.chunks[m.chunks.length - 1].gzip)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('measure is deterministic — identical input, identical output', () => {
  const dir = fixture({ 'a.js': 'const x = 1;'.repeat(200) })
  try {
    assert.deepEqual(measure(dir), measure(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('measure on a missing dir returns an empty, non-throwing record', () => {
  const m = measure('/no/such/dir/here')
  assert.equal(m.fileCount, 0)
  assert.equal(m.totalGzip, 0)
})

// ── scorecard: size bands ────────────────────────────────────────────────────
test('client size band grades absolute gzip weight (default bands)', () => {
  assert.equal(scoreBundle(100 * 1024, null).size.band, 'green')
  assert.equal(scoreBundle(CLIENT_SIZE_BANDS.amber + 1, null).size.band, 'amber')
  assert.equal(scoreBundle(CLIENT_SIZE_BANDS.red + 1, null).size.band, 'red')
})

test('server bands are more generous than client (Worker weight tolerance)', () => {
  // A weight in the client-amber / server-green gap: 300 KB is amber for the browser
  // budget but still green for the (larger) Worker budget.
  const w = 300 * 1024
  assert.ok(w > CLIENT_SIZE_BANDS.amber && w < SERVER_SIZE_BANDS.amber)
  assert.equal(scoreBundle(w, null, CLIENT_SIZE_BANDS).size.band, 'amber')
  assert.equal(scoreBundle(w, null, SERVER_SIZE_BANDS).size.band, 'green')
  assert.equal(scoreBundle(SERVER_SIZE_BANDS.red + 1, null, SERVER_SIZE_BANDS).size.band, 'red')
})

test('worst() picks the most severe band', () => {
  assert.equal(worst(['green', 'amber', 'green']), 'amber')
  assert.equal(worst(['green', undefined, 'red']), 'red') // tolerates an unmeasured (null) target
  assert.equal(worst(['green', 'green']), 'green')
})

// ── scorecard: regression bands ──────────────────────────────────────────────
test('regression is green with no prior point (a first build cannot regress)', () => {
  const s = scoreBundle(999 * 1024, null)
  assert.equal(s.regression.band, 'green')
  assert.equal(s.regression.pct, 0)
})

test('regression grades % growth vs the previous point; a shrink is never red', () => {
  const prev = 100 * 1024
  assert.equal(scoreBundle(prev, prev).regression.band, 'green') // 0%
  assert.equal(scoreBundle(Math.round(prev * 1.10), prev).regression.band, 'amber') // +10% (> 5)
  assert.equal(scoreBundle(Math.round(prev * 1.20), prev).regression.band, 'red')   // +20% (> 15)
  assert.equal(scoreBundle(Math.round(prev * 0.5), prev).regression.band, 'green')  // -50% shrink
  assert.ok(scoreBundle(Math.round(prev * 0.5), prev).regression.pct < 0)
})

test('overall is the worse of size and regression', () => {
  // small bundle but a big jump → overall follows the regression (red).
  assert.equal(scoreBundle(Math.round(50 * 1024 * (1 + (REGRESSION_BANDS.red + 5) / 100)), 50 * 1024).overall, 'red')
})

// ── previousGzip: history lookup (client + server) ───────────────────────────
test('previousGzip returns the last client + server totals for the app', () => {
  const history = [
    JSON.stringify({ app: 'velo', client: { totalGzip: 111 }, server: { totalGzip: 900 } }),
    JSON.stringify({ app: 'fanfare', client: { totalGzip: 222 }, server: null }),
    JSON.stringify({ app: 'velo', client: { totalGzip: 333 }, server: { totalGzip: 950 } }),
  ].join('\n')
  assert.deepEqual(previousGzip(history, 'velo'), { client: 333, server: 950 })
  assert.deepEqual(previousGzip(history, 'fanfare'), { client: 222, server: null })
  assert.deepEqual(previousGzip(history, 'unknown'), { client: null, server: null })
  assert.deepEqual(previousGzip('', 'velo'), { client: null, server: null })
})

test('previousGzip tolerates the pre-split record shape (top-level totalGzip = client)', () => {
  const history = JSON.stringify({ app: 'velo', totalGzip: 444 })
  assert.deepEqual(previousGzip(history, 'velo'), { client: 444, server: null })
})
