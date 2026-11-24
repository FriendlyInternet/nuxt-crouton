#!/usr/bin/env node
// review-endpoint-check.mjs — does this preview serve the feedback endpoint? (#4062)
//
// WHY. deploy-app.yml's "Verify the review overlay is live" POSTed `/api/_feedback` ONCE,
// 0.2–0.7 s after `wrangler secret bulk` published a new Worker version. That version may not
// serve yet, so a correct build got a 404 and failed the step (every re-run passed). Retry a
// 404 or no answer a few times before calling the overlay missing. An installed handler never
// answers 404 to POST (it is method-scoped: 401/405/…), so this cannot mask a missing module.
//
//   node scripts/review-endpoint-check.mjs <baseUrl>

import { pathToFileURL } from 'node:url'

const defaultSleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * POST <base>/api/_feedback until it answers something other than 404 / no answer.
 * @returns {Promise<{ ok: boolean, code: number, tries: number, statuses: number[] }>}
 */
export async function checkEndpoint(base, {
  fetchImpl = fetch,
  sleep = defaultSleep,
  waits = [5000, 10000, 15000, 20000],
  timeoutMs = 30000,
  log = () => {},
} = {}) {
  const url = String(base).replace(/\/$/, '') + '/api/_feedback'
  const statuses = []
  for (let i = 0; i <= waits.length; i++) {
    let code = 0
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(timeoutMs),
      })
      code = res.status
    }
    catch {
      code = 0
    }
    statuses.push(code)
    if (code !== 404 && code !== 0) return { ok: true, code, tries: statuses.length, statuses }
    if (i < waits.length) {
      log(`try ${i + 1} → ${code}, waiting ${waits[i] / 1000}s`)
      await sleep(waits[i])
    }
  }
  return { ok: false, code: statuses.at(-1), tries: statuses.length, statuses }
}

/** Output lines for a result — the same messages the workflow printed before #4062. */
export function formatResult(base, r) {
  if (r.ok) {
    return [`✓ feedback endpoint live (POST /api/_feedback → ${r.code})${r.tries > 1 ? ` after ${r.tries} tries` : ''}`]
  }
  return [
    `::error::No feedback endpoint at ${base} (POST /api/_feedback → ${r.code}).`,
    `::error::The app does not install the overlay — add '@fyit/crouton-devtools'`,
    `::error::to its nuxt.config modules + dependencies (#2073).`,
    `::error::tries: ${r.statuses.join(', ')}`,
  ]
}

async function main() {
  const [base] = process.argv.slice(2)
  if (!base) {
    console.error('usage: node scripts/review-endpoint-check.mjs <baseUrl>')
    process.exit(2)
  }
  const r = await checkEndpoint(base, { log: line => console.log(line) })
  for (const line of formatResult(base, r)) console.log(line)
  process.exit(r.ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
