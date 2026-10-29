#!/usr/bin/env node
// plan-held.mjs — is this issue HELD on a plan the reviewer rejected twice? (#3024, epic #3022)
//
// WHY. After two rejections plan-review.yml posts "Plan rejected twice … Held for you" and sets
// status:blocked. The owner's `ok` there used to route to `resume`, which re-ran the planner —
// the owner had no way to say "build it anyway". comment-route.mjs asks this to turn that `ok`
// into an approval of the newest plan instead.
//
// Pure, Node-core only. Input: the issue's comments, oldest first.

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
