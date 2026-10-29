#!/usr/bin/env node
// plan-held.mjs — is this issue HELD on a plan the reviewer rejected twice? (#3024, epic #3022)
//
// WHY. After two rejections plan-review.yml posts "Plan rejected twice … Held for you" and sets
// status:blocked. The owner's `ok` there used to route to `resume`, which re-ran the planner —
// the owner had no way to say "build it anyway". comment-route.mjs asks this to turn that `ok`
// into an approval of the newest plan instead — but only as `ok: <reason>`: overriding a
// twice-rejected plan needs a written reason, recorded as a decision. A bare `ok` just asks for it.
//
// Pure, Node-core only. Input: the issue's comments, oldest first.

import { pathToFileURL } from 'node:url'
import { stripNonCommandRegions } from './comment-command.mjs'

const PLAN = '<!-- pipeline-plan:v1 -->'
const NO_GO = '<!-- plan-review-verdict:no-go -->'
const HOLD = 'Plan rejected twice'

const fromBot = (c) => c.userType === 'Bot'

/**
 * True when the newest plan/hold event is a bot's "Plan rejected twice" verdict: a plan posted
 * after the hold (a re-plan) cancels it, and only bot comments count, so a person pasting the
 * markers cannot fake a hold.
 * @param {{body?:string, userType?:string}[]} comments oldest first
 */
export function isPlanHeld(comments = []) {
  let held = false
  for (const c of comments) {
    if (!fromBot(c)) continue
    const body = String(c.body || '')
    if (body.includes(PLAN)) held = false
    else if (body.includes(NO_GO) && body.includes(HOLD)) held = true
  }
  return held
}

/**
 * The reason in an owner override `ok: <reason>` (or `lgtm: <reason>`) — '' when there is none.
 * The reason must be at least three words, so `ok: fine` is still a bare approval. The keyword
 * opens the reply (a mid-sentence "ok:" never counts) and quotes/code are stripped first.
 * @param {string} body
 */
export function overrideReason(body) {
  const text = stripNonCommandRegions(String(body || ''))
  const m = /^[ \t]*(?:ok|lgtm)[ \t]*:[ \t]*(\S[\s\S]*)$/im.exec(text)
  if (!m) return ''
  const reason = m[1].trim().replace(/\s+/g, ' ')
  return reason.split(' ').length >= 3 ? reason : ''
}

// CLI: `node scripts/plan-held.mjs < comment-body` → prints the override reason (empty if none).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  process.stdout.write(overrideReason(readFileSync(0, 'utf8')))
}
