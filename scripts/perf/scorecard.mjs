// scorecard.mjs — the bundle-size BUDGET bands (#1581). The one place to tune.
// Two independent signals, each graded green/amber/red by fixed formulas (no LLM):
//   - size:       absolute transfer weight (total gzipped JS+CSS)
//   - regression: % growth vs the previous recorded point for this app
// overall = the worse of the two. A brand-new app (no prior point) can't regress,
// so regression is graded `green` with pct 0.

/** Absolute gzip-transfer bands, in bytes. Tune here. */
export const SIZE_BANDS = {
  amber: 250 * 1024, // > 250 KB gzip → amber
  red: 500 * 1024,   // > 500 KB gzip → red
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

/**
 * Grade a bundle. `totalGzip` is this build's gzipped JS+CSS; `prevGzip` is the
 * previous recorded total (or null for a first point). Returns { overall, size, regression }.
 * @param {number} totalGzip
 * @param {number|null} prevGzip
 */
export function scoreBundle(totalGzip, prevGzip) {
  const sizeBand = band(totalGzip, SIZE_BANDS)
  const pct = prevGzip && prevGzip > 0 ? Math.round(((totalGzip - prevGzip) / prevGzip) * 1000) / 10 : 0
  // Only GROWTH is graded (a shrink is never a regression).
  const regBand = prevGzip ? band(pct, REGRESSION_BANDS) : 'green'
  const overall = RANK[sizeBand] >= RANK[regBand] ? sizeBand : regBand
  return {
    overall,
    size: { band: sizeBand, gzip: totalGzip },
    regression: { band: regBand, pct, prevGzip: prevGzip ?? null },
  }
}
