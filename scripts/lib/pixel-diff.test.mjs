/**
 * Contract for the pixel-diff step (#2061).
 *
 * The three cases from the issue's "How to test":
 *  1. Same-branch self-diff → near-zero after masking the devtools badge (was 979px unmasked).
 *  2. The #2025 shape (a real, localized layout shift) → diff reports a nonzero percentage,
 *     not silently passed.
 *  3. An error-page capture must REFUSE (throw), not report a diff percentage — a
 *     contaminated measurement looks exactly like a finding (#2045's 16.56% false positive).
 *
 * These test the pure, dependency-free half (diffPixelBuffers/defaultMasks) — no sharp,
 * no browser needed.
 *
 *   node --test scripts/lib/pixel-diff.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffPixelBuffers, defaultMasks } from './pixel-diff.mjs'

const WIDTH = 100
const HEIGHT = 100
const CHANNELS = 4

function solidBuffer(width, height, [r, g, b, a] = [30, 30, 30, 255]) {
  const buf = Buffer.alloc(width * height * CHANNELS)
  for (let i = 0; i < width * height; i++) {
    buf[i * CHANNELS] = r
    buf[i * CHANNELS + 1] = g
    buf[i * CHANNELS + 2] = b
    buf[i * CHANNELS + 3] = a
  }
  return buf
}

test('diffPixelBuffers: identical buffers diff to 0%', () => {
  const buf = solidBuffer(WIDTH, HEIGHT)
  const result = diffPixelBuffers(buf, Buffer.from(buf), WIDTH, HEIGHT)
  assert.equal(result.diffPercent, 0)
  assert.equal(result.diffPixels, 0)
})

test('diffPixelBuffers: noise floor — a volatile corner masked out leaves the rest at 0%', () => {
  const a = solidBuffer(WIDTH, HEIGHT)
  const b = Buffer.from(a)
  // Flip a bottom-left strip (simulating the Nuxt devtools timing badge flicker
  // between two captures of the SAME build).
  const masks = defaultMasks(WIDTH, HEIGHT)
  const [mask] = masks
  for (let y = mask.y; y < mask.y + mask.height; y++) {
    for (let x = mask.x; x < mask.x + mask.width; x++) {
      const i = (y * WIDTH + x) * CHANNELS
      b[i] = 255
      b[i + 1] = 255
      b[i + 2] = 255
    }
  }

  const unmasked = diffPixelBuffers(a, b, WIDTH, HEIGHT, { masks: [] })
  assert.ok(unmasked.diffPixels > 0, 'sanity: the flipped strip is detected without masking')

  const masked = diffPixelBuffers(a, b, WIDTH, HEIGHT, { masks })
  assert.equal(masked.diffPixels, 0, 'masking the volatile strip removes it from the diff entirely')
  assert.equal(masked.diffPercent, 0)
  assert.ok(masked.maskedPixels > 0)
})

test('diffPixelBuffers: a real, localized layout shift is reported as a nonzero diff (#2025 shape)', () => {
  const a = solidBuffer(WIDTH, HEIGHT)
  const b = Buffer.from(a)
  // Shift a horizontal band (simulating #2025's 16px layout offset from duplicated classes) —
  // outside the default bottom-left mask, so it must NOT be silently absorbed.
  for (let y = 10; y < 30; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * CHANNELS
      b[i] = 200
      b[i + 1] = 50
      b[i + 2] = 50
    }
  }

  const masks = defaultMasks(WIDTH, HEIGHT)
  const result = diffPixelBuffers(a, b, WIDTH, HEIGHT, { masks })
  assert.ok(result.diffPercent > 0, 'a real layout shift must not be masked away')
  // 20 rows out of 100 shifted → ~20% of considered pixels differ (the default mask
  // excludes a 40px-tall bottom-left strip, so the shifted 20-row band is fully counted
  // against a slightly smaller denominator).
  assert.ok(result.diffPercent > 15 && result.diffPercent < 35, `expected ~20-33%, got ${result.diffPercent}`)
})

test('diffPixelBuffers: throws on mismatched buffer sizes rather than diffing garbage', () => {
  const a = solidBuffer(WIDTH, HEIGHT)
  const b = solidBuffer(WIDTH, HEIGHT + 1)
  assert.throws(() => diffPixelBuffers(a, b, WIDTH, HEIGHT))
})

test('defaultMasks: sized to the viewport, clamped when the viewport is smaller than the strip', () => {
  const masks = defaultMasks(50, 20)
  assert.equal(masks.length, 1)
  assert.ok(masks[0].width <= 50)
  assert.ok(masks[0].height <= 20)
  assert.ok(masks[0].y >= 0)
})
