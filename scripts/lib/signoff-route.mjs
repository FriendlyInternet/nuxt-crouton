/**
 * Design sign-off routing (#3238). A ticket that says "Hold for design sign-off first" must get
 * exactly one mockup hold from the decomposer BEFORE any plan review or build.
 *
 *   node scripts/lib/signoff-route.mjs <issue-file> <comments-json-file> [--route]
 *     → {"route":"signoff"|"none","reason":"..."}   (comments: [{body}] in thread order)
 *   node scripts/lib/signoff-route.mjs <issue-file> <comments-json-file> --mockup
 *     → none | posted | waived | missing   (was the mockup the ticket asked for posted? #4524)
 *
 * All decisions are PURE and tested (signoff-route.test.mjs). Used by label-router.yml,
 * apply-decompose-plan.mjs and on-comment.yml.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Every phrase a ticket uses to ask for a mockup before the build (#4524 — "Mockup first" was missed).
export const SIGNOFF_PATTERN = /hold for (a |the )?design sign-?off|\bmock-?up first\b|hold for (a |the )?mock-?up|design sign-?off (first|before)|show (me )?a mock-?up (first|before)/i
export const SIGNOFF_MARKER = '<!-- design-signoff-hold -->'
export const HOLD_HEADING = '## 🎨 Design sign-off needed before building'
const HEADING_OWN_LINE = new RegExp(`^${HOLD_HEADING}\\s*$`, 'm')

/** The run of leading HTML-comment lines of a comment body (the way on-comment.yml's plan-review job reads markers). */
const leadingLines = (body = '') => {
  const out = []
  for (const line of String(body).split('\n')) {
    if (!line.trim().startsWith('<!--')) break
    out.push(line.trim())
  }
  return out
}

/** A real hold: marker as the first line, or the heading alone on its own line. Quotes don't count. */
export function isHoldComment(body = '') {
  const b = String(body)
  return b.split('\n')[0].trim() === SIGNOFF_MARKER || HEADING_OWN_LINE.test(b)
}

/** Drop quoted material (blockquote lines, "…" / “…” spans, `code`, [link text](url)) — a ticket that merely mentions the phrase isn't asking. */
const unquoted = (text = '') =>
  String(text)
    .split('\n').filter((l) => !l.trim().startsWith('>')).join('\n')
    .replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    .replace(/"[^"\n]*"/g, '').replace(/“[^”\n]*”/g, '')
    .replace(/\[[^\]\n]*\]\([^)\n]*\)/g, '')

export const signoffRequested = (text = '') => SIGNOFF_PATTERN.test(unquoted(text))
export const signoffAsked = (comments = []) => comments.some((c) => isHoldComment(c?.body))

/** @returns {{route:'signoff'|'none', reason:string}} */
export function signoffRoute({ text = '', comments = [] } = {}) {
  if (!signoffRequested(text)) return { route: 'none', reason: 'ticket does not ask for a design sign-off' }
  if (signoffAsked(comments)) return { route: 'none', reason: 'design sign-off already asked' }
  return { route: 'signoff', reason: 'ticket asks for a design sign-off first and none was posted' }
}

/** The plan review's own question when a requested mockup is missing (#4524). Plain text, no backticks:
 *  the owner's `ok` writes it word for word into `## Decisions`, which is how `mockupState` sees the waiver. */
export const MOCKUP_MISSING_QUESTION = 'this ticket asked for a mockup, but no mockup was posted — reply ok to build without one, or reply asking for the mockup'

/** PURE. Was the mockup the ticket asked for posted? 'none' (not asked) | 'posted' | 'waived' (owner ok'd building without) | 'missing'. */
export function mockupState({ text = '', comments = [] } = {}) {
  if (!signoffRequested(text)) return 'none'
  if (signoffAsked(comments)) return 'posted'
  if (String(text).includes(MOCKUP_MISSING_QUESTION)) return 'waived'
  return 'missing'
}

/** Which kind of question to the owner is this comment? 'hold' | 'plan' | 'verdict' | null (bot notes). */
export function ownerQuestionKind(body = '') {
  const lead = leadingLines(body)
  if (lead.includes('<!-- pipeline-plan:v1 -->')) return 'plan'
  if (lead.some((l) => /^<!-- plan-review-verdict:(go|no-go|needs-owner) -->$/.test(l))) return 'verdict'
  if (isHoldComment(body)) return 'hold'
  return null
}

/** on-comment: is the owner's reply an answer to a pi DESIGN hold (→ re-run the decomposer)? */
export function isDesignHold({ labels = [], comments = [], noChildren = true } = {}) {
  if (!noChildren || !comments.some((c) => isHoldComment(c?.body))) return false
  if (labels.includes('epic')) return true
  const asked = comments.map((c) => ownerQuestionKind(c?.body)).filter(Boolean)
  return asked[asked.length - 1] === 'hold'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [issueFile, commentsFile, flag] = process.argv.slice(2)
  if (!issueFile) { console.error('usage: signoff-route.mjs <issue-file> <comments-json-file>'); process.exit(2) }
  let comments = []
  try { comments = JSON.parse(readFileSync(commentsFile, 'utf8')) } catch { /* no comments file → none */ }
  const text = readFileSync(issueFile, 'utf8')
  if (flag === '--mockup') console.log(mockupState({ text, comments }))
  else {
    const r = signoffRoute({ text, comments })
    console.log(flag === '--route' ? r.route : JSON.stringify(r))
  }
}
