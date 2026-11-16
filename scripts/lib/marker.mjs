// A pipeline marker counts only when it sits in the comment's leading hidden-marker block (#3359).
//
// A comment that merely QUOTES a marker (a review citing the plan) used to match a substring
// lookup and be taken for the real thing. The posters all put their markers at the very top,
// before any visible text, so we read only that block. The same rule exists in jq in the
// workflows: `test("\\A(?:[ \\t]*<!--[^\\n]*-->[ \\t]*\\r?\\n)*[ \\t]*<MARKER>[ \\t]*(\\r?\\n|\\z)")`.

const MARKER_LINE = /^<!--.*-->$/

/** Lines from the top of `body` that are hidden `<!-- … -->` markers, stopping at the first other line. */
export function leadingMarkers(body) {
  const lines = String(body ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const out = []
  for (const l of lines) {
    const t = l.trim()
    if (!MARKER_LINE.test(t)) break
    out.push(t)
  }
  return out
}

/** True when `marker` is exactly one of the leading marker lines. */
export const hasMarker = (body, marker) => leadingMarkers(body).includes(marker)

/** First capture of `re` among the leading marker lines, or undefined. */
export function markerValue(body, re) {
  for (const l of leadingMarkers(body)) {
    const m = re.exec(l)
    if (m) return m[1]
  }
  return undefined
}

/** The regex source (single-escaped; inside a jq string literal double every backslash). */
export const leadingRegexSource = (marker) =>
  `\\A(?:[ \\t]*<!--[^\\n]*-->[ \\t]*\\r?\\n)*[ \\t]*${marker}[ \\t]*(\\r?\\n|\\z)`
