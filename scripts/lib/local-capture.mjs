// local-capture.mjs — pure helpers for pi-local-capture.mjs (#2513): which app + routes to
// screenshot for a ticket. No I/O, so every shape is unit-tested.

const TEAM = 'test1' // the seeded team `pnpm preview` attaches the review login to

/** Replace the `{team}` placeholder a ticket uses for the team slug. */
export function fillPlaceholders(path) {
  return String(path).replace(/\{team\}/g, TEAM)
}

/**
 * `Surface: <app> <path>[, <path>]` lines from an issue body (the documented ticket line).
 * Returns [{ app, path }] — one entry per path, in order, de-duplicated.
 */
export function parseSurfaceLines(body) {
  const out = []
  for (const m of String(body || '').matchAll(/^[ \t>*-]*\**Surface:\**[ \t]+([A-Za-z0-9_-]+)[ \t]+(.+)$/gim)) {
    const app = m[1]
    for (const raw of m[2].split(',')) {
      const path = fillPlaceholders(raw.trim().replace(/^`|`$/g, ''))
      if (!path.startsWith('/')) continue
      if (!out.some(s => s.app === app && s.path === path)) out.push({ app, path })
    }
  }
  return out
}

/**
 * Fallback when a ticket names no surface: derive from the changed files. Only an unambiguous
 * case counts — exactly one app touched and at least one static page file in it. Anything else
 * returns [] (the caller says "no surface named"); the home page is NEVER a guess (#2455).
 */
export function deriveSurfaces(changedFiles) {
  const apps = new Set()
  const paths = []
  for (const f of changedFiles) {
    const m = f.match(/^(?:apps|pocs)\/([^/]+)\//)
    if (m) apps.add(m[1])
    const p = f.match(/^(?:apps|pocs)\/[^/]+\/app\/pages\/(.+)\.vue$/)
    if (!p) continue
    const segs = p[1].split('/')
    if (segs.some(s => /[[\]]/.test(s))) continue // dynamic route — can't guess a param
    if (segs[segs.length - 1] === 'index') segs.pop()
    paths.push(`/${segs.join('/')}`)
  }
  if (apps.size !== 1 || !paths.length) return []
  const [app] = apps
  return [...new Set(paths)].map(path => ({ app, path }))
}

/** Surfaces to shoot: the ticket's own line wins, then the changed-files derivation. */
export function resolveTargets({ issueBody, changedFiles }) {
  const named = parseSurfaceLines(issueBody)
  if (named.length) return { surfaces: named, source: 'named on the ticket' }
  const derived = deriveSurfaces(changedFiles)
  if (derived.length) return { surfaces: derived, source: 'derived from the changed page files' }
  return { surfaces: [], source: 'no surface named' }
}

/** Render surfaces as `<!-- review-surface -->` markers, the format capture-review-surfaces reads. */
export function toMarkers(surfaces) {
  return surfaces.map((s, i) => `<!-- review-surface: ${s.app} ${s.path} name:s${i + 1} -->`).join('\n')
}
