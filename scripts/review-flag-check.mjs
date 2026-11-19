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

/**
 * Paths to try, in order, de-duplicated: `/`, reviewLogin.landing, reviewSurfaces[].path, then
 * `/auth/login`. The login page is the last resort because every crouton app serves it
 * (crouton-auth) as a normal server-rendered page, so it carries the public runtime config even
 * when the app has no start page and declares no review pages (pins).
 */
export function candidatePaths(config) {
  const paths = ['/']
  const add = (p) => {
    if (typeof p === 'string' && p.startsWith('/') && !paths.includes(p)) paths.push(p)
  }
  add(config?.reviewLogin?.landing)
  if (Array.isArray(config?.reviewSurfaces)) for (const s of config.reviewSurfaces) add(s?.path)
  add('/auth/login')
  return paths
}

/** First 200 chars of a body with newlines collapsed, safe for a one-line annotation. */
export function snippet(body) {
  return String(body ?? '').slice(0, 200).replace(/[\r\n]+/g, ' ')
}

const defaultSleep = ms => new Promise(r => setTimeout(r, ms))

/** One pass over the candidates; resolves on the first page containing the flag. */
async function probeOnce(base, paths, fetchImpl) {
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

/**
 * Probe each candidate; resolve on the first page containing the flag. If EVERY candidate
 * answered 404 / nothing, the fresh Worker version may not serve yet (same race as #4062's
 * endpoint check): wait and probe again. Any other status (a real page without the flag)
 * is final, so a genuinely missing flag still fails fast.
 * @returns {Promise<{ ok: boolean, url?: string, attempts: object[] }>}
 */
export async function checkFlag(base, paths, fetchImpl = fetch, { sleep = defaultSleep, waits = [5000, 10000, 15000, 20000] } = {}) {
  let r = await probeOnce(base, paths, fetchImpl)
  for (const wait of waits) {
    if (r.ok || !r.attempts.every(a => a.status === 404 || a.status === 0)) break
    await sleep(wait)
    r = await probeOnce(base, paths, fetchImpl)
  }
  return r
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
