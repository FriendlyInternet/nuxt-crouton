#!/usr/bin/env node
// resolve-review-epic.mjs — #3051: which GitHub thread do overlay pins on a staging deploy post to?
//
// A PR preview / dispatch names its PR (`review-pr`). A plain staging deploy from main has none,
// so the target is the app's open epic labelled `status:to-test`. None found → '' (overlay off).
// Posting works unchanged: the feedback GitHub sink uses /issues/{n}/comments, which serves
// issues and PRs alike.
//
//   node scripts/resolve-review-epic.mjs <app> [review-pr]   prints the number (or nothing) on stdout.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Labels that tie an epic to an app: `app:<app>` (apps) or `poc:<app>` (pocs). */
export function appLabels(app) {
  return [`app:${app}`, `poc:${app}`]
}

/**
 * Pure decision. `epics` = [{ number, labels: string[] }] (open epics already in status:to-test).
 * Explicit PR wins; otherwise the lowest-numbered epic tied to the app; otherwise ''.
 */
export function chooseReviewTarget({ app, reviewPr = '', epics = [] } = {}) {
  const pr = String(reviewPr ?? '').trim()
  if (pr) return { number: pr, source: 'review-pr' }
  const mine = appLabels(app)
  const hit = epics
    .filter((e) => (e.labels ?? []).some((l) => mine.includes(l)))
    .sort((a, b) => a.number - b.number)[0]
  return hit ? { number: String(hit.number), source: 'to-test-epic' } : { number: '', source: 'none' }
}

function fetchEpics() {
  const out = execFileSync('gh', [
    'issue', 'list', '--state', 'open', '--label', 'epic', '--label', 'status:to-test',
    '--limit', '100', '--json', 'number,labels'
  ], { encoding: 'utf8' })
  return JSON.parse(out).map((i) => ({ number: i.number, labels: i.labels.map((l) => l.name) }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [app, reviewPr = ''] = process.argv.slice(2)
  let epics = []
  if (!reviewPr) {
    try { epics = fetchEpics() } catch (e) { console.error(`resolve-review-epic: epic lookup failed (${e.message}) — overlay stays off`) }
  }
  const r = chooseReviewTarget({ app, reviewPr, epics })
  console.error(`resolve-review-epic: ${r.source}${r.number ? ` → #${r.number}` : ''}`)
  if (r.number) console.log(r.number)
}
