#!/usr/bin/env node
// plan-held.mjs — the owner's override of a twice-rejected plan, as the BUILD may trust it (#3272).
//
// The router (comment-route.mjs) sends an owner `ok: <reason>` on a held plan to the `approve-plan`
// job, which posts `**Decision (owner override, <date>):** <reason>` AS THE HARNESS BOT and then
// labels the issue `plan:approved`. The build reads the reason back from that comment only: the
// same words from a person, another bot, or from before the newest plan are ignored.
//
// CLI: `gh api --paginate .../comments --jq '.[] | @json' | node scripts/plan-held.mjs --decision`
// → prints the reason (or nothing). Input is one comment object per line (JSON Lines), so pages are
// never glued by text editing; a line that is not JSON throws, so a bad read exits non-zero.

import { pathToFileURL } from 'node:url'

export const BOT = 'nuxt-harness[bot]'
const PLAN = '<!-- pipeline-plan:v1 -->'
const DECISION = /^\*\*Decision \(owner override[^)]*\):\*\*[ \t]*/

/**
 * @param {Array<{body?: string, user?: {login?: string}}>} comments oldest first
 * @returns {string} the override reason, or ''
 */
export function currentOverrideDecision(comments = []) {
  let reason = ''
  for (const c of comments) {
    const body = String(c?.body || '')
    if (body.includes(PLAN)) reason = '' // a newer plan voids an older override
    else if (c?.user?.login === BOT && DECISION.test(body)) reason = body.replace(DECISION, '').split('\n')[0].trim()
  }
  return reason
}

/** The bot comment body for an override. */
export function overrideComment({ reason, date, url }) {
  return `**Decision (owner override, ${String(date).slice(0, 10)}):** ${reason}\n\n_From the owner's [reply](${url}); the plan reviewers rejected twice and the owner approved anyway._`
}

/** One JSON comment object per line (`--jq '.[] | @json'`); throws on a line that is not JSON. */
export function parseCommentLines(raw = '') {
  return String(raw).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href && process.argv.includes('--decision')) {
  const { readFileSync } = await import('node:fs')
  const comments = parseCommentLines(readFileSync(0, 'utf8'))
  const out = currentOverrideDecision(comments)
  if (out) console.log(out)
}
