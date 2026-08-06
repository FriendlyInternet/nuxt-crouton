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

/** The default mask must stay a MINORITY of the image — see defaultMasks. */
const MAX_DEFAULT_MASK_FRACTION = 0.5

/**
 * Known-volatile regions that flicker between two captures of the SAME build
 * (e.g. the Nuxt devtools timing badge, which alone produced a 979px diff
 * floor in #2045's evidence) and must be excluded before computing a diff
 * percentage. Returns a bottom-left strip sized to the viewport.
 *
 * The fraction guard is load-bearing. `Math.min(height, 40)` means that on any
 * image ≤40px tall the strip covers the FULL height, and on a narrow one the
 * full width too — so the mask swallowed the entire image and the diff came
 * back `0%` with `consideredPixels: 0`. A confident "no change" computed from
 * zero pixels is precisely the contaminated-measurement failure this module
 * exists to prevent (#2045's 16.56% false positive, in the opposite direction).
 * The rule is that the mask must stay a MINORITY of the frame: on a real
 * 1280x800 viewport the badge is 0.86% of the pixels, so anything at or past
 * half the image is not a badge — mask nothing and diff the whole image
 * honestly rather than measure a sliver. `diffPixelBuffers` throws if a
 * caller-supplied mask leaves nothing at all, which is the hard backstop.
 */
export function defaultMasks(width, height) {
  const maskHeight = Math.min(height, 40)
  const maskWidth = Math.min(width, 220)
  const total = width * height
  if (total <= 0 || (maskWidth * maskHeight) / total > MAX_DEFAULT_MASK_FRACTION) return []
  return [{ x: 0, y: Math.max(0, height - maskHeight), width: maskWidth, height: maskHeight }]
}

function inMask(x, y, masks) {
  return masks.some(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
}

/** Do the RGB channels at byte offset `i` differ by more than `threshold`? Alpha is ignored. */
function pixelDiffers(bufA, bufB, i, channels, threshold) {
  const rgb = Math.min(channels, 3)
  for (let c = 0; c < rgb; c++) {
    if (Math.abs(bufA[i + c] - bufB[i + c]) > threshold) return true
  }
  return false
}

/** Walk the image once, counting differing and masked pixels. */
function countPixels(bufA, bufB, width, height, channels, threshold, masks) {
  let diffPixels = 0
  let maskedPixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inMask(x, y, masks)) { maskedPixels++; continue }
      if (pixelDiffers(bufA, bufB, (y * width + x) * channels, channels, threshold)) diffPixels++
    }
  }
  return { diffPixels, maskedPixels }
}

/**
 * Compare two equal-size RGBA (or RGB) pixel buffers. Pixels inside `masks`
 * are excluded from both the numerator and denominator, so a masked region
 * can't inflate OR hide the real diff percentage. Alpha is ignored — only
 * RGB channels are compared.
 *
 * The scan is split into `countPixels` / `pixelDiffers` rather than one triple
 * nested loop: fallow flagged the combined form at cognitive 19, and the two
 * halves answer different questions — "which pixels count" and "does this
 * pixel differ". Behaviour is identical; the per-pixel early-exit is now a
 * `return` instead of a `break` + flag.
 */
export function diffPixelBuffers(bufA, bufB, width, height, { threshold = 10, masks = [] } = {}) {
  if (bufA.length !== bufB.length) {
    throw new Error(`pixel buffer length mismatch (${bufA.length} vs ${bufB.length}) — images must be the same dimensions`)
  }
  const total = width * height
  const channels = total > 0 ? bufA.length / total : 0
  const { diffPixels, maskedPixels } = countPixels(bufA, bufB, width, height, channels, threshold, masks)
  const consideredPixels = total - maskedPixels
  // Refuse rather than return `0`. With every pixel masked there is nothing to compare, and a
  // `diffPercent: 0` computed from zero pixels reads as a confident "no visual change" — the
  // same lie as diffing an error page, just quieter. Throwing matches how this module already
  // treats a flat capture: a contaminated measurement must never look like a result.
  if (consideredPixels <= 0) {
    throw new Error(`every pixel is masked (${maskedPixels}/${total}) — nothing left to compare, refusing to report a diff`)
  }
  const diffPercent = (diffPixels / consideredPixels) * 100
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
