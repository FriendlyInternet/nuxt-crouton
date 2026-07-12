// scorecard.mjs — the bundle-size BUDGET bands (#1581). The one place to tune.
// Scores a gzipped-transfer number green/amber/red on two independent signals:
//   - size:       absolute weight, graded against per-target bands (client vs server differ)
//   - regression: % growth vs the previous recorded point
// overall = the worse of the two. A first point (no prior) can't regress → green, pct 0.
//
// Two targets, two band sets, because they answer different questions:
//   - CLIENT bundle (public/_nuxt) → what the browser downloads → user load speed.
//   - SERVER/Worker bundle (wrangler-bundled) → Cloudflare cold-start + CPU → run cost.

/** CLIENT (browser) gzip-transfer bands, in bytes. Tune here. */
export const CLIENT_SIZE_BANDS = {
  amber: 250 * 1024, // > 250 KB gzip → amber
  red: 500 * 1024,   // > 500 KB gzip → red
}

/** SERVER/Worker gzip bands, in bytes. Cloudflare's compressed-Worker ceiling is ~1 MB,
 * and cold-start grows with size — so amber well before the wall. Tune here. */
export const SERVER_SIZE_BANDS = {
  amber: 500 * 1024,  // > 500 KB gzip → amber
  red: 1024 * 1024,   // > 1 MB gzip → red (near the CF Worker limit)
}

/** Regression bands, in percent growth vs the previous point. Tune here. */
export const REGRESSION_BANDS = {
  amber: 5,  // > +5%  → amber
  red: 15,   // > +15% → red
}

function band(value, { amber, red }) {
  if (value > red) return 'red'
  if (value > amber) return 'amber'
  return 'green'
}

const RANK = { green: 0, amber: 1, red: 2 }
export const worst = (bands) => bands.filter(Boolean).reduce((w, b) => (RANK[b] > RANK[w] ? b : w), 'green')

/**
 * Grade a bundle. `totalGzip` is this build's gzipped weight; `prevGzip` is the
 * previous recorded total (or null for a first point). `sizeBands` picks the target
 * (client vs server). Returns { overall, size, regression }.
 * @param {number} totalGzip
 * @param {number|null} prevGzip
 * @param {{amber:number,red:number}} [sizeBands]
 */
export function scoreBundle(totalGzip, prevGzip, sizeBands = CLIENT_SIZE_BANDS) {
  const sizeBand = band(totalGzip, sizeBands)
  const pct = prevGzip && prevGzip > 0 ? Math.round(((totalGzip - prevGzip) / prevGzip) * 1000) / 10 : 0
  // Only GROWTH is graded (a shrink is never a regression).
  const regBand = prevGzip ? band(pct, REGRESSION_BANDS) : 'green'
  return {
    overall: worst([sizeBand, regBand]),
    size: { band: sizeBand, gzip: totalGzip },
    regression: { band: regBand, pct, prevGzip: prevGzip ?? null },
  }
}
