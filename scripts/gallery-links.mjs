// gallery-links.mjs — which changed files on a PR are shared UI pieces, and their gallery
// review links (#2462). A UI change in packages/* has no app of its own to preview, so the
// gallery POC (pocs/gallery) is deployed for the PR and each changed piece gets a direct link
// (`/__review?file=<path>` — the gallery maps a file to its component page).
//
// Used by deploy-pocs.yml (deploy the gallery?) and deploy-app.yml (the PR comment's links).
// Contract: scripts/gallery-links.test.mjs (`node --test`).

const PIECE_RE = /^packages\/crouton-[^/]+\/app\/components\/.+\.vue$/
const MAX_LINKS = 10

/**
 * Changed piece files, sorted and de-duplicated. Accepts plain paths or GitHub `listFiles`
 * entries ({ filename, status }); a removed file has no page to link to.
 */
export function changedPieces(files = []) {
  const out = new Set()
  for (const f of files) {
    const path = typeof f === 'string' ? f : f?.filename
    if (!path || (typeof f === 'object' && f.status === 'removed')) continue
    if (PIECE_RE.test(path) && !path.includes('/stubs/')) out.add(path)
  }
  return [...out].sort()
}

/** Does this change set touch any shared UI piece (so the gallery should deploy)? */
export function touchesPieces(files = []) {
  return changedPieces(files).length > 0
}

/** One review link per changed piece, at most MAX_LINKS. */
export function galleryLinks(baseUrl, files = []) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return changedPieces(files)
    .slice(0, MAX_LINKS)
    .map(file => ({ file, url: `${base}/__review?file=${encodeURIComponent(file)}` }))
}

// CLI: `git diff --name-only … | node scripts/gallery-links.mjs --touches` → prints true/false.
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--touches')) {
  const { readFileSync } = await import('node:fs')
  const files = readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  console.log(touchesPieces(files) ? 'true' : 'false')
}
