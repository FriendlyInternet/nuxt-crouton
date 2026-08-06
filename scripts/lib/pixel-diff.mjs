/**
 * Pixel diff for before/after screenshot captures (#2061), building on the
 * blank/error-page validation in capture-validate.mjs (#2055) — a diff is only
 * trustworthy if the underlying captures are known-good, not blank or error
 * pages (see #2044's 16.56% false-positive from diffing an error page).
 *
 * `diffPixelBuffers` is pure (no I/O) so it's unit-testable without sharp or a
 * browser. `loadPngRaw`/`diffScreenshots` are the sharp-dependent half — sharp
 * is loaded lazily (dynamic import) so importing this module's pure helpers
 * never requires sharp to be installed/working.
 */
import { colorsAreFlat } from './capture-validate.mjs'

/**
 * Known-volatile regions that flicker between two captures of the SAME build
 * (e.g. the Nuxt devtools timing badge, which alone produced a 979px diff
 * floor in #2045's evidence) and must be excluded before computing a diff
 * percentage. Returns a bottom-left strip sized to the viewport.
 */
export function defaultMasks(width, height) {
  const maskHeight = Math.min(height, 40)
  return [{ x: 0, y: Math.max(0, height - maskHeight), width: Math.min(width, 220), height: maskHeight }]
}

function inMask(x, y, masks) {
  return masks.some(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
}

/**
 * Compare two equal-size RGBA (or RGB) pixel buffers. Pixels inside `masks`
 * are excluded from both the numerator and denominator, so a masked region
 * can't inflate OR hide the real diff percentage. Alpha is ignored — only
 * RGB channels are compared.
 */
export function diffPixelBuffers(bufA, bufB, width, height, { threshold = 10, masks = [] } = {}) {
  if (bufA.length !== bufB.length) {
    throw new Error(`pixel buffer length mismatch (${bufA.length} vs ${bufB.length}) — images must be the same dimensions`)
  }
  const total = width * height
  const channels = total > 0 ? bufA.length / total : 0
  let diffPixels = 0
  let maskedPixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inMask(x, y, masks)) { maskedPixels++; continue }
      const i = (y * width + x) * channels
      let differs = false
      for (let c = 0; c < Math.min(channels, 3); c++) {
        if (Math.abs(bufA[i + c] - bufB[i + c]) > threshold) { differs = true; break }
      }
      if (differs) diffPixels++
    }
  }
  const consideredPixels = total - maskedPixels
  const diffPercent = consideredPixels > 0 ? (diffPixels / consideredPixels) * 100 : 0
  return { diffPixels, consideredPixels, maskedPixels, totalPixels: total, diffPercent }
}

function sampleGrid(buf, width, height, channels, cols = 8, rows = 8) {
  const samples = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = Math.floor((i + 0.5) * width / cols)
      const y = Math.floor((j + 0.5) * height / rows)
      const idx = (y * width + x) * channels
      samples.push([buf[idx], buf[idx + 1], buf[idx + 2], channels > 3 ? buf[idx + 3] : 255])
    }
  }
  return samples
}

/** Decode a PNG to a raw RGBA buffer via sharp (lazy-loaded). */
export async function loadPngRaw(path) {
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * Diff two screenshot files. Refuses (throws) rather than returning a number
 * when either capture is a single flat colour — a contaminated measurement
 * looks exactly like a finding (#2045's 16.56% false positive).
 */
export async function diffScreenshots(pathA, pathB, { threshold = 10, masks, refuseFlat = true } = {}) {
  const a = await loadPngRaw(pathA)
  const b = await loadPngRaw(pathB)
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`dimension mismatch: ${pathA} is ${a.width}x${a.height}, ${pathB} is ${b.width}x${b.height} — refusing to diff`)
  }
  if (refuseFlat) {
    if (colorsAreFlat(sampleGrid(a.data, a.width, a.height, a.channels))) {
      throw new Error(`${pathA} is a single flat colour — refusing to diff (looks like a blank/error capture)`)
    }
    if (colorsAreFlat(sampleGrid(b.data, b.width, b.height, b.channels))) {
      throw new Error(`${pathB} is a single flat colour — refusing to diff (looks like a blank/error capture)`)
    }
  }
  const effectiveMasks = masks || defaultMasks(a.width, a.height)
  return diffPixelBuffers(a.data, b.data, a.width, a.height, { threshold, masks: effectiveMasks })
}
