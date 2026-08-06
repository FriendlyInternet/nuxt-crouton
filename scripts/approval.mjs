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

/** The word form. Kept because it is written into issue bodies and skills across the repo. */
const APPROVAL_WORD = /^[ \t]*(?:lgtm|approved?)\b|(?<![\w-])(?:lgtm|approved?)(?![\w-])/im

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
  const text = stripNonCommandRegions(String(body || ''))
  if (CHECK_ONLY_LINE.test(text)) return true
  return APPROVAL_WORD.test(text)
}

/** Which form was used — for the acknowledgement, so the reply mirrors the gesture. */
export function approvalKind(body) {
  const text = stripNonCommandRegions(String(body || ''))
  if (CHECK_ONLY_LINE.test(text)) return 'check'
  if (APPROVAL_WORD.test(text)) return 'word'
  return null
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
//   node scripts/approval.mjs "<comment body>"   → exit 0 if approval, 1 if not
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ok = isApproval(process.argv.slice(2).join(' '))
  console.log(ok ? `approval (${approvalKind(process.argv.slice(2).join(' '))})` : 'not an approval')
  process.exit(ok ? 0 : 1)
}
