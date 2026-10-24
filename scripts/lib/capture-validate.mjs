#!/usr/bin/env node
/**
 * Validation helpers for screenshot capture (#2055): decide whether a captured
 * PNG is worthless (a single flat colour — always a bug, no real UI screenshot
 * is one colour) or contaminated (a dev-server error page / Nuxt error
 * overlay), so app-shots.mjs / ui-proposal's render.mjs can fail loudly
 * instead of committing evidence that looks real but isn't (#2044's
 * 16.56% false-positive from diffing an error page).
 *
 * colorsAreFlat/looksLikeErrorPage are pure and dependency-free so they're
 * unit-testable without a browser. sampleFlatness is the browser-dependent
 * half — it reuses an already-launched Playwright `browser` to sample pixels
 * from a PNG buffer via canvas, so no image-decoding dependency is needed.
 */

/**
 * `samples` is an array of [r,g,b,a] tuples read from a grid across the
 * image. Returns true when every sample is within `tolerance` of the first
 * — i.e. the whole capture is a single flat colour.
 */
export function colorsAreFlat(samples, tolerance = 2) {
  if (!Array.isArray(samples) || samples.length === 0) return false
  const [r0, g0, b0] = samples[0]
  return samples.every(([r, g, b]) =>
    Math.abs(r - r0) <= tolerance && Math.abs(g - g0) <= tolerance && Math.abs(b - b0) <= tolerance
  )
}

// Text fragments that show up on pages we must never mistake for real UI:
// Nitro/Nuxt error responses, the dev-server error overlay, generic HTTP
// error bodies.
const ERROR_MARKERS = [
  'this page could not be found',
  'internal server error',
  'an error occurred',
  'nitro error',
  'nuxt error',
  'cannot get ',
  'error 500',
  'error 404',
  'application error',
  'unhandled error',
]

/**
 * Judge whether a captured page is a dev-server / framework error response
 * rather than real UI. `status` is the HTTP status of the navigation
 * response; `text`/`title` are the rendered page's visible text.
 */
export function looksLikeErrorPage({ status, text = '', title = '' } = {}) {
  if (typeof status === 'number' && status >= 400) return true
  const haystack = `${title}\n${text}`.toLowerCase()
  return ERROR_MARKERS.some(marker => haystack.includes(marker))
}

/**
 * Sample a grid of pixels from a PNG buffer using a scratch Playwright page
 * (draws the image to a canvas and reads pixel data) — no image-decoding
 * dependency needed. Returns an array of [r,g,b,a] samples for colorsAreFlat.
 */
export async function sampleFlatness(pngBuffer, browser, { cols = 8, rows = 8 } = {}) {
  const page = await browser.newPage()
  try {
    const base64 = pngBuffer.toString('base64')
    await page.setContent(`<img id="cap" src="data:image/png;base64,${base64}">`)
    return await page.evaluate(async ({ cols, rows }) => {
      const img = document.getElementById('cap')
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const out = []
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = Math.floor((i + 0.5) * canvas.width / cols)
          const y = Math.floor((j + 0.5) * canvas.height / rows)
          const d = ctx.getImageData(x, y, 1, 1).data
          out.push([d[0], d[1], d[2], d[3]])
        }
      }
      return out
    }, { cols, rows })
  } finally {
    await page.close()
  }
}
