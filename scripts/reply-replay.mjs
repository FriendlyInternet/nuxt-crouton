#!/usr/bin/env node
// Reply replay (#4102): today's reading of a recorded owner reply, for the replay tests in
// scripts/reply-replay.test.mjs. Pure — no network, Node core only.
//
// This copies the route job (`openRecord` → `routeComment` with that record, #4145) and the resume
// job's re-plan step (`replanFromReply`: follows the router's `starts`, else `isPlanHold` +
// `answerDecision`) only. The resume job's revise step (an open `work-<issue>` PR plus a
// collaborator's change request) and its design-hold step run first and are NOT copied: none of
// the recorded cases reaches them. A later case that does reach them needs those facts added to
// the case format first. `meaningToday` never returns `choice:<X>` today (no path reads a
// choice); the step that routes a worker's answer extends it.
import { routeComment } from './comment-route.mjs'
import { replanFromReply } from './plan-hold.mjs'
import { openRecord } from './lib/reply-record.mjs'

/**
 * The router + re-plan outcome for one recorded case.
 * @param {{issue: number, labels: string[], comments: object[], reply: {body: string, authorAssociation?: string, userType?: string, userLogin?: string}}} c
 * @returns {{kind: string, replan: boolean, decision: boolean}}
 */
export function todayOutcome(c) {
  const issue = { number: c.issue, isPr: false, labels: c.labels, body: '' }
  const record = openRecord({ comments: c.comments, labels: c.labels })
  const d = routeComment({ comment: c.reply, issue, record })
  const r = replanFromReply({
    starts: d.starts || '',
    comments: c.comments,
    labels: c.labels,
    comment: { body: c.reply.body, authorAssociation: c.reply.authorAssociation, userType: c.reply.userType, userLogin: c.reply.userLogin },
  })
  return { kind: d.kind, replan: r.replan, decision: r.replan && r.line !== null }
}

/**
 * What the outcome means in the case format's words.
 * @param {{kind: string, replan: boolean, decision: boolean}} o
 * @returns {string}
 */
export function meaningToday(o) {
  if (o.kind === 'none') return 'ignore'
  if (o.replan && o.decision) return 'yes'
  if (o.replan) return 'comment'
  if (o.kind === 'resume') return 'dropped'
  return o.kind
}

const MARKER = /<!--[\s\S]*?-->/g

/**
 * Keep a case file small: a body over 1600 chars becomes its `<!-- … -->` markers, a newline,
 * then the first 1500 chars of the rest.
 * @param {string} body
 */
export function trimBody(body) {
  const s = String(body ?? '')
  if (s.length <= 1600) return s
  const markers = s.match(MARKER) || []
  return `${markers.join('')}\n${s.replace(MARKER, '').slice(0, 1500)}`
}

/**
 * The issue's labels at `isoTime`, rebuilt from its `labeled` / `unlabeled` events in order.
 * @param {object[]} events REST issue events
 * @param {string} isoTime
 * @returns {string[]}
 */
export function labelsAt(events, isoTime) {
  const at = Date.parse(isoTime)
  const labels = []
  for (const e of events || []) {
    if (!e || Date.parse(e.created_at) > at) continue
    const name = e.label?.name
    if (!name) continue
    if (e.event === 'labeled' && !labels.includes(name)) labels.push(name)
    else if (e.event === 'unlabeled') {
      const i = labels.indexOf(name)
      if (i >= 0) labels.splice(i, 1)
    }
  }
  return labels
}
