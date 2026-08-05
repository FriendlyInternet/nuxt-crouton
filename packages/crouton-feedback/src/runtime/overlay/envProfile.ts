/**
 * Environment profile (#1181) — the context a check was taken in.
 *
 * A dependency-free snapshot of device / browser / OS / viewport that rides
 * along with a Spec-walk sign-off and an Annotate feedback, so a `lgtm <id>` or
 * a pinned `⚠️` is self-describing ("checked on iPhone Safari 430×932, touch").
 * Pure + testable: `readEnvProfile` takes optional `window`/`navigator` (defaults
 * to globals, returns `null` on the server); `formatEnv` renders the one-liner.
 * UA heuristic, not a parser lib — good enough to distinguish phone/tablet/desktop
 * and the major browsers.
 */

export interface EnvProfile {
  device: string
  os: string
  browser: string
  viewportW: number
  viewportH: number
  dpr: number
  touch: boolean
  orientation: 'portrait' | 'landscape'
  ua: string
}

function detect(ua: string): { device: string, os: string, browser: string } {
  const u = ua || ''
  let os = 'Unknown'
  if (/iPhone|iPad|iPod/.test(u)) os = 'iOS'
  else if (/Android/.test(u)) os = 'Android'
  else if (/Mac OS X|Macintosh/.test(u)) os = 'macOS'
  else if (/Windows/.test(u)) os = 'Windows'
  else if (/Linux/.test(u)) os = 'Linux'

  let device = 'Desktop'
  if (/iPhone/.test(u)) device = 'iPhone'
  else if (/iPad/.test(u)) device = 'iPad'
  else if (/Android/.test(u)) device = /Mobile/.test(u) ? 'Android phone' : 'Android tablet'
  else if (os === 'iOS') device = 'iOS device'

  // Order matters — Edge/Opera/CriOS masquerade as Chrome/Safari in the UA.
  let browser = 'Unknown'
  if (/Edg\//.test(u)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(u)) browser = 'Opera'
  else if (/Firefox\//.test(u)) browser = 'Firefox'
  else if (/CriOS\//.test(u)) browser = 'Chrome'
  else if (/Chrome\//.test(u) && !/Chromium/.test(u)) browser = 'Chrome'
  else if (/Safari\//.test(u)) browser = 'Safari'
  return { device, os, browser }
}

export function readEnvProfile(win?: Window, nav?: Navigator): EnvProfile | null {
  const w = win ?? (typeof window !== 'undefined' ? window : undefined)
  const n = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  if (!w || !n) return null
  const ua = n.userAgent || ''
  const { device, os, browser } = detect(ua)
  const viewportW = Math.round(w.innerWidth || 0)
  const viewportH = Math.round(w.innerHeight || 0)
  const dpr = Math.round((w.devicePixelRatio || 1) * 100) / 100
  const touch = (n.maxTouchPoints || 0) > 0 || 'ontouchstart' in w
  const orientation = viewportW >= viewportH ? 'landscape' : 'portrait'
  return { device, os, browser, viewportW, viewportH, dpr, touch, orientation, ua }
}

function icon(p: EnvProfile): string {
  if (/phone/i.test(p.device)) return '📱'
  if (/iPad|tablet/i.test(p.device)) return '📱'
  return '💻'
}

/** One-line stamp for a sign-off / feedback report. Empty string when unavailable. */
export function formatEnv(p: EnvProfile | null): string {
  if (!p) return ''
  return `${icon(p)} ${p.device} · ${p.browser} · ${p.os} · ${p.viewportW}×${p.viewportH} (dpr ${p.dpr}) · ${p.touch ? 'touch' : 'pointer'} · ${p.orientation}`
}
