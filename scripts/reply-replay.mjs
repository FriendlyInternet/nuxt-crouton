#!/usr/bin/env node
// Reply replay (#4102): today's reading of a recorded owner reply, for the replay tests in
// scripts/reply-replay.test.mjs. Pure — no network, Node core only.
//
// This copies the route job (`openRecord` → `routeComment` with that record, #4145), the resume
// job's revise step (`shouldRevise` with the router's `starts`, only when the case says its
// `work-<issue>` PR is open: `openPr`, #4192) and its re-plan step (`replanFromReply`: follows the
// router's `starts`, else `isPlanHold` + `answerDecision`), which is skipped once the revise step
// fires (on-comment.yml `if: steps.revise.outputs.revise != 'true'`). The design-hold step is NOT
// copied: none of the recorded cases reaches it. A revision reads as `choice:<X>` when the reply
// opens with a single option letter (after any leading `> 🤖` header), else `answer`.
import { routeComment } from './comment-route.mjs'
import { replanFromReply } from './plan-hold.mjs'
import { shouldRevise } from './revise-route.mjs'
import { openRecord } from './lib/reply-record.mjs'

// `A`, `**A**`, `A — …`, `A. …` — a single option letter, never a word that starts with one.
const CHOICE = /^\s*(?:\*\*([A-Z])\*\*|([A-Z])(?=\s*(?:$|[—–.:)-])))/

/** PURE. The option letter a reply opens with (after a leading `> …` header block), or null. */
export function replyChoice(body) {
  const lines = String(body || '').split('\n')
  let i = 0
  while (i < lines.length && (/^\s*>/.test(lines[i]) || !lines[i].trim())) i++
  const m = CHOICE.exec(lines[i] || '')
  return m ? m[1] || m[2] : null
}

/**
 * The router + re-plan outcome for one recorded case.
 * @param {{issue: number, labels: string[], comments: object[], openPr?: boolean, reply: {body: string, authorAssociation?: string, userType?: string, userLogin?: string}}} c
 * @returns {{kind: string, replan: boolean, decision: boolean, revise: boolean, choice: string|null}}
 */
export function todayOutcome(c) {
  const issue = { number: c.issue, isPr: false, labels: c.labels, body: '' }
  const record = openRecord({ comments: c.comments, labels: c.labels })
  const d = routeComment({ comment: c.reply, issue, record })
  // The revise step lives in the resume job, so it only sees a `resume`.
  const revise = d.kind === 'resume' && Boolean(c.openPr) && shouldRevise({ ...c.reply, labels: c.labels, starts: d.starts || '' }).revise
  if (revise) return { kind: d.kind, replan: false, decision: false, revise: true, choice: replyChoice(c.reply.body) }
  const r = replanFromReply({
    starts: d.starts || '',
    comments: c.comments,
    labels: c.labels,
    comment: { body: c.reply.body, authorAssociation: c.reply.authorAssociation, userType: c.reply.userType, userLogin: c.reply.userLogin },
  })
  return { kind: d.kind, replan: r.replan, decision: r.replan && r.line !== null, revise: false, choice: null }
}

/**
 * What the outcome means in the case format's words.
 * @param {{kind: string, replan: boolean, decision: boolean, revise?: boolean, choice?: string|null}} o
 * @returns {string}
 */
export function meaningToday(o) {
  if (o.kind === 'none') return 'ignore'
  if (o.revise) return o.choice ? `choice:${o.choice}` : 'answer'
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
