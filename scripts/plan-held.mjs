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
import { HELD_MARKER } from './lib/plan-verdict.mjs'

const PLAN = '<!-- pipeline-plan:v1 -->'
const REVIEW = '<!-- plan-review:v1 -->'
const DECISION_AUTHOR = 'nuxt-harness[bot]'
const DECISION_PREFIX = '**Decision (owner override'

const fromBot = (c) => c.userType === 'Bot'

/**
 * True when the newest plan/review event is a bot's review carrying the plan-review-held marker: a plan posted
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
    else if (body.includes(REVIEW)) held = body.includes(HELD_MARKER)
  }
  return held
}

/**
 * The reason in an owner override `ok: <reason>` (or `lgtm:`/`approve:`) — '' when there is none.
 * The keyword opens the reply (a mid-sentence "ok:" never counts) and quotes/code are stripped first.
 * @param {string} body
 */
export function overrideReason(body) {
  const text = stripNonCommandRegions(String(body || ''))
  const m = /^[ \t]*(?:ok|lgtm|approve)[ \t]*:[ \t]*(\S[\s\S]*)$/im.exec(text)
  return m ? m[1].trim().replace(/\s+/g, ' ') : ''
}

/**
 * The body of the owner-override decision the build should honour: the newest comment authored by
 * the harness bot that opens with the decision prefix AND comes after the newest plan comment.
 * Anyone else's lookalike, or a decision recorded for an older plan, is ignored. '' when none.
 * @param {{body?:string, user?:{login?:string}}[]} comments oldest first (GitHub API shape)
 */
export function currentOverrideDecision(comments = []) {
  let found = ''
  for (const c of comments) {
    const body = String(c.body || '')
    if (body.includes(PLAN)) found = ''
    else if (c.user?.login === DECISION_AUTHOR && body.startsWith(DECISION_PREFIX)) found = body
  }
  return found
}

// CLI: `node scripts/plan-held.mjs --decision < comments.json` → prints the current override decision.
// CLI: `node scripts/plan-held.mjs < comment-body` → prints the override reason (empty if none).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  const input = readFileSync(0, 'utf8')
  process.stdout.write(process.argv.includes('--decision') ? currentOverrideDecision(JSON.parse(input || '[]')) : overrideReason(input))
}
