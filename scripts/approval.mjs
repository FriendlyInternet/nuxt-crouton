#!/usr/bin/env node
// approval.mjs — is this comment an APPROVAL? One definition, used everywhere (#2051).
//
// WHY THIS IS ITS OWN MODULE. `lgtm` was matched by a bare `/\b(approve|approved|lgtm)\b/i`
// in two places in resume-on-comment.yml. That is the #2004 bug in a new costume — the
// pattern is unanchored and blind to Markdown, so "I wouldn't lgtm this yet", a quoted
// `` `lgtm` ``, and a `>`-quote of someone else's approval all match. On the dispatch side
// that mis-fired a pipeline; here it would RELEASE CODE FOR MERGE, so the same bug is
// strictly more expensive. Two copies of a rule is one rule and one liability (#2027).
//
// WHY ✅ AND NOT A REACTION. GitHub raises NO webhook event for reactions, so nothing can
// listen to one — settled in #572 after a 👍 silently did nothing. A ✅ typed as a COMMENT
// is a real `issue_comment` event. This is the same reasoning that made the dispatch
// gesture a rocket line rather than the phrase "pick this up".

import { pathToFileURL } from 'node:url'
import { stripNonCommandRegions } from './comment-command.mjs'

/**
 * A line that is NOTHING BUT check marks means "approved".
 *
 * Whole-line, like the rocket: `✅ nice work, but change X first` must NOT approve, and a
 * stray ✅ in prose ("✅ shipped the other one") is common enough to matter. Accepts the
 * three check emoji a phone keyboard actually offers, each with an optional variation
 * selector (U+FE0F) — ✔️ and ☑️ are normally typed WITH it and ✅ normally without, and a
 * pattern that assumed either way would reject half the real inputs.
 *
 * Unlike 🚀 these are BMP code points, so `u` is not load-bearing here the way it was for
 * the rocket (#2010) — it is kept for consistency and because ️ handling is clearer
 * under it.
 */
const CHECK_ONLY_LINE = /^[ \t]*(?:[✅✔☑]️?[ \t]*)+$/mu

/**
 * The word form. Kept because it is written into issue bodies and skills across the repo.
 * Must OPEN a line (like the ✅ rule): mid-sentence "I wouldn't lgtm this yet" is not approval (#2509).
 */
const APPROVAL_WORD = /^[ \t]*(?:lgtm|approved?)(?![\w-])/im

/**
 * The owner's one yes-word (#2832): a reply that is ONLY `ok` — case-insensitive, trailing
 * punctuation or emoji fine. Anything after it (`ok, but change X`) is a change request,
 * so a casual "ok, change X first" can never release a merge. The whole reply is tested
 * (after quotes/code are stripped), not a line of it.
 */
const OK_ONLY_REPLY = /^[ \t\r\n]*ok[\p{P}\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]*$/iu

/**
 * Is this an agent-authored comment? Every agent comment opens with a `> 🤖 …` provenance
 * header (or a bare 🤖 line); an agent saying "ok" or quoting "lgtm" must never count as
 * the owner's decision, even when posted from the owner's account.
 */
export function isAgentComment(body) {
  const first = String(body || '').split('\n').find(l => l.trim()) || ''
  return /^\s*(?:>\s*)?🤖/u.test(first)
}

/**
 * Is `body` an approval?
 *
 * Code spans, fenced blocks and `>` quotes are stripped FIRST, so a comment that merely
 * *discusses* approving — or quotes someone else's — never approves.
 *
 * @param {string} body Raw Markdown of the comment.
 * @returns {boolean}
 */
export function isApproval(body) {
  if (isAgentComment(body)) return false
  const text = stripNonCommandRegions(String(body || ''))
  if (CHECK_ONLY_LINE.test(text)) return true
  if (OK_ONLY_REPLY.test(text)) return true
  return APPROVAL_WORD.test(text)
}

/** Which form was used — for the acknowledgement, so the reply mirrors the gesture. */
export function approvalKind(body) {
  const text = stripNonCommandRegions(String(body || ''))
  if (CHECK_ONLY_LINE.test(text)) return 'check'
  if (APPROVAL_WORD.test(text)) return 'word'
  return null
}

/**
 * Test-card replies (#2540). A card in `status:to-test` is answered with `ok` or
 * `not ok[: note]`. Both must OPEN a line, so "it's ok I guess" or "not ok" quoted
 * mid-sentence never counts. Kept apart from isApproval: a bare `ok` must not release
 * merges on ordinary cards — it only means something on a test card.
 */
const TEST_NOT_OK = /^[ \t]*not[ \t]+ok(?![\w-])[ \t]*[:\-—]?[ \t]*(.*)$/im
const TEST_OK = /^[ \t]*ok(?![\w-])/im

/**
 * Parse a reply to a test card.
 * @param {string} body Raw Markdown of the comment.
 * @returns {{ result: 'ok' | 'not-ok' | null, note: string }}
 */
export function parseTestReply(body) {
  const text = stripNonCommandRegions(String(body || ''))
  const bad = TEST_NOT_OK.exec(text)
  if (bad) return { result: 'not-ok', note: bad[1].trim() }
  if (TEST_OK.test(text)) return { result: 'ok', note: '' }
  return { result: null, note: '' }
}

/** Does this reply pass a test card? `not ok` never does. */
export function isTestOk(body) {
  return parseTestReply(body).result === 'ok'
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
//   node scripts/approval.mjs "<comment body>"   → exit 0 if approval, 1 if not
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ok = isApproval(process.argv.slice(2).join(' '))
  console.log(ok ? `approval (${approvalKind(process.argv.slice(2).join(' '))})` : 'not an approval')
  process.exit(ok ? 0 : 1)
}
