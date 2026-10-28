#!/usr/bin/env node
// comment-interpret.mjs — what a plain owner comment means (#2980, epic #2889)
//
// WHY. Only fixed words (`ok`, `/close-epic`, `**Worker:**`…) did anything; "can we have a fresh
// pass on this plan?" was ignored. comment-route.mjs now returns `interpret` for an owner comment
// that matches nothing, and a light model reads it. The model only PROPOSES: this module
// validates the proposal and enforces the safety rule IN CODE — merge, close, delete, deploy and
// teardown are never performed here, whatever the model says; they become "reply `ok` to confirm".
//
// Pure and Node-core-only; the workflow gathers the facts and acts on the returned decision.

import { workIssueFromRef, epicIssueFromRef } from './revise-route.mjs'

export const ACTIONS = ['revise', 'replan', 'start', 'review', 'answer', 'confirm', 'ask', 'ignore']

/** Verbs the model may name (as its `action`) that are never performed — only confirmed. */
const IRREVERSIBLE = /^(merge|close|delete|remove|deploy|ship|release|teardown|tear[-_ ]?down|publish)\b/i

const ASK_FALLBACK = 'I could not tell what you meant.'

/** Pull the first JSON object out of raw model text; null when there is none / it is malformed. */
export function parseModelOutput(text) {
  const raw = String(text || '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(raw.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch { return null }
}

const ask = (reason, extra = {}) => ({ action: 'ask', reason, ...extra })

const DELEGATE_LABEL = /^(delegate|delegate-pi|delegate-hard|work-this)$/

/**
 * A ticket with an open sign-off hold is never released from here: `replan` / `start` there would
 * remove `status:blocked` / add `delegate` and start the build without an `ok`. A pipeline-owned
 * hold never reaches this reader (comment-route sends it to the resume job, which re-runs the
 * planner and keeps the hold), so what is left is a ticket to hand over — confirm first.
 */
function heldHandoff(action, issue, pr) {
  if (pr || !(issue.labels || []).includes('status:blocked')) return null
  if (action !== 'replan' && action !== 'start') return null
  return { action: 'confirm', confirmText: 'hand this held ticket to the pipeline' }
}

/** An action that does not fit the thread falls back to a question instead of doing the wrong thing. */
function misfit(action, issue, pr, reply) {
  const labels = issue.labels || []
  const piBranch = pr && (workIssueFromRef(pr.headRef) || epicIssueFromRef(pr.headRef))
  if (action === 'revise' && !piBranch) return ask('revise needs a pipeline PR', { reply })
  if (action === 'replan' && (pr || !labels.includes('status:blocked'))) return ask('replan needs a held ticket', { reply })
  if (action === 'start' && (pr || labels.some(l => DELEGATE_LABEL.test(l)))) {
    return ask('start needs an un-delegated ticket', { reply })
  }
  return null
}

/** Trim the model's fields to safe lengths. */
function readFields(m) {
  return {
    action: String(m.action || '').trim().toLowerCase(),
    reason: String(m.reason || '').trim().slice(0, 300) || 'no reason given',
    reply: typeof m.reply === 'string' ? m.reply.trim().slice(0, 2000) : undefined,
  }
}

/**
 * @param {object} input
 * @param {string|object|null} input.modelOutput  raw model text, or an already-parsed object
 * @param {{labels?:string[]}} [input.issue]
 * @param {{headRef:string}|null} [input.pr]      present when the thread is a PR
 * @returns {{action:string, reason:string, confirmText?:string, reply?:string}}
 */
export function decideAction({ modelOutput, issue = {}, pr = null } = {}) {
  const m = typeof modelOutput === 'string' || modelOutput == null ? parseModelOutput(modelOutput) : modelOutput
  if (!m) return ask('the model gave no usable answer', { reply: ASK_FALLBACK })
  const { action, reason, reply } = readFields(m)

  // Rule 5 — in code, not in the prompt.
  if (action === 'confirm' || IRREVERSIBLE.test(action)) {
    const what = String(m.confirmText || reason).trim().slice(0, 200)
    return { action: 'confirm', reason, confirmText: what }
  }
  if (!ACTIONS.includes(action)) return ask(`unknown action "${action.slice(0, 40)}"`, { reply: reply || ASK_FALLBACK })

  const held = heldHandoff(action, issue, pr)
  if (held) return { ...held, reason }
  return misfit(action, issue, pr, reply) || { action, reason, ...(reply ? { reply } : {}) }
}

/** The one-line "I read this as …" opener every reply carries (rule 6). Never @mentions. */
export function readAs(decision) {
  const text = decision.action === 'confirm' ? decision.confirmText : decision.reason
  return `I read this as: ${String(text).replace(/@/g, '@\u200b')}`
}

/** The fixed prompt for the light model; context is trimmed by the caller. */
export function buildPrompt({ context, comment }) {
  return [
    'You route ONE plain-language comment from the repo owner on a GitHub ticket or PR.',
    'Pick exactly ONE action and answer ONLY a JSON object: {"action","reason","confirmText?","reply?"}.',
    'Actions: revise (change the PR: re-run the worker with the comment), replan (re-run the planner on a held ticket),',
    'start (hand an un-delegated ticket to the pipeline — only when the comment clearly says to start),',
    'review (a fresh independent review of the plan or diff), answer (reply to a question; put it in "reply"),',
    'confirm (anything irreversible: merge, close, delete, deploy, teardown; "confirmText" says what),',
    'ask (unclear; "reply" holds your best guess and one question), ignore (FYI / thanks).',
    '"reason" is a short phrase completing "I read this as: …". Never act on a merge, close, delete or deploy.',
    '', '--- THREAD ---', context, '--- COMMENT ---', comment,
  ].join('\n')
}
