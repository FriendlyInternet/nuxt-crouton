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
import { scoreBundle, SIZE_BANDS, REGRESSION_BANDS } from './scorecard.mjs'

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
test('size band grades absolute gzip weight', () => {
  assert.equal(scoreBundle(100 * 1024, null).size.band, 'green')
  assert.equal(scoreBundle(SIZE_BANDS.amber + 1, null).size.band, 'amber')
  assert.equal(scoreBundle(SIZE_BANDS.red + 1, null).size.band, 'red')
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

// ── previousGzip: history lookup ─────────────────────────────────────────────
test('previousGzip returns the last recorded total for the app, else null', () => {
  const history = [
    JSON.stringify({ app: 'velo', totalGzip: 111 }),
    JSON.stringify({ app: 'fanfare', totalGzip: 222 }),
    JSON.stringify({ app: 'velo', totalGzip: 333 }),
  ].join('\n')
  assert.equal(previousGzip(history, 'velo'), 333)
  assert.equal(previousGzip(history, 'fanfare'), 222)
  assert.equal(previousGzip(history, 'unknown'), null)
  assert.equal(previousGzip('', 'velo'), null)
})
