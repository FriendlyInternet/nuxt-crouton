#!/usr/bin/env node
// review-flag-check.mjs — is the review flag in a page this preview serves? (#2456)
//
// WHY. deploy-app.yml's "Verify the review overlay is live" grepped only `/` for
// `croutonReview`. An app with no start page (pocs/pins) serves nothing useful there, so a
// correct build failed the check — with no hint why. Probe `/`, then the app's own review
// landing and surfaces; pass on the first page carrying the flag; on failure say what each
// URL actually returned.
//
//   node scripts/review-flag-check.mjs <baseUrl> [deploy.config.json]

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Paths to try, in order, de-duplicated: `/`, reviewLogin.landing, reviewSurfaces[].path. */
export function candidatePaths(config) {
  const paths = ['/']
  const add = (p) => {
    if (typeof p === 'string' && p.startsWith('/') && !paths.includes(p)) paths.push(p)
  }
  add(config?.reviewLogin?.landing)
  if (Array.isArray(config?.reviewSurfaces)) for (const s of config.reviewSurfaces) add(s?.path)
  return paths
}

/** First 200 chars of a body with newlines collapsed, safe for a one-line annotation. */
export function snippet(body) {
  return String(body ?? '').slice(0, 200).replace(/[\r\n]+/g, ' ')
}

/**
 * Probe each candidate; resolve on the first page containing the flag.
 * @returns {Promise<{ ok: boolean, url?: string, attempts: object[] }>}
 */
export async function checkFlag(base, paths, fetchImpl = fetch) {
  const attempts = []
  for (const path of paths) {
    const url = base.replace(/\/$/, '') + path
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) })
      const body = await res.text()
      if (body.includes('croutonReview')) return { ok: true, url, attempts }
      attempts.push({ url, status: res.status, finalUrl: res.url || url, body: snippet(body) })
    }
    catch (e) {
      attempts.push({ url, status: 0, finalUrl: url, body: `fetch failed: ${e?.message || e}` })
    }
  }
  return { ok: false, attempts }
}

async function main() {
  const [base, configPath] = process.argv.slice(2)
  if (!base) {
    console.error('usage: review-flag-check.mjs <baseUrl> [deploy.config.json]')
    process.exit(2)
  }
  let config = {}
  try {
    if (configPath) config = JSON.parse(readFileSync(configPath, 'utf8'))
  }
  catch { /* no/invalid config: fall back to `/` only */ }

  const r = await checkFlag(base, candidatePaths(config))
  if (r.ok) {
    console.log(`✓ review flag present in the served HTML (${r.url})`)
    return
  }
  for (const a of r.attempts) {
    console.log(`::error::${a.url} → HTTP ${a.status}, final ${a.finalUrl}, body: ${a.body}`)
  }
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()
