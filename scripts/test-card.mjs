#!/usr/bin/env node
// test-card.mjs — the pure "is this epic ready to be tested by the owner?" decision + the card
// text (#2541, epic #2519). The GitHub I/O lives in post-test-card.mjs; this file is the
// deterministic core, unit-tested in isolation (same split as epic-ready.mjs).
//
// The reply side (`ok` / `not ok: …`) is parsed by scripts/approval.mjs (#2540).

/** Hidden marker that makes the card idempotent — one card per epic, ever. */
export const CARD_MARKER = '<!-- test-card -->'

/**
 * Decide whether to post the test card. PURE. A false SKIP is safe (the next deploy retries);
 * a false POST pings the owner to test something that is not live, so the rule is conservative.
 *   subIssues:  [{ state }]   the epic's direct sub-issues
 *   labels:     string[]      the epic's labels
 *   comments:   [{ body }]    the epic's comments (looked at for the marker)
 *   deployed:   boolean       the epic's merged result is contained in a successful staging deploy
 */
export function decideTestCard({ subIssues = [], labels = [], comments = [], deployed = false } = {}) {
  if (comments.some(c => (c.body || '').includes(CARD_MARKER))) return { post: false, reason: 'card already posted' }
  if (labels.includes('status:to-test')) return { post: false, reason: 'already status:to-test' }
  if (labels.includes('status:verified') || labels.includes('status:failed')) {
    return { post: false, reason: 'already answered' }
  }
  if (subIssues.length === 0) return { post: false, reason: 'epic has no sub-issues' }
  const open = subIssues.filter(s => s.state !== 'closed').length
  if (open > 0) return { post: false, reason: `${open} child issue(s) still open` }
  if (!deployed) return { post: false, reason: 'merged result not on staging yet' }
  return { post: true, reason: `all ${subIssues.length} children closed + deployed to staging` }
}

/** Up to `max` phone-friendly check lines from the epic body's "Done when" section. */
export function extractChecks(body = '', max = 3) {
  const m = /^#{1,4}\s*Done when\s*$([\s\S]*?)(?=^#{1,4}\s|\n---|$(?![\s\S]))/im.exec(body)
  const lines = (m ? m[1] : '')
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .filter(l => l && !l.startsWith('<!--'))
  return lines.slice(0, max)
}

/** Build the card comment. No password is ever included — only the account to log in as. */
export function buildCard({ epicNumber, title = '', app = '', stagingUrl = '', reviewAccount = '', checks = [] } = {}) {
  const list = checks.length ? checks : [`Open the app and try what "${title}" changed`]
  return [
    CARD_MARKER,
    `## 🧪 Test card — ${title || `epic #${epicNumber}`}`,
    '',
    `**App:** ${app || '(see epic)'}`,
    `**Try it:** ${stagingUrl || '(staging URL not configured)'}`,
    `**Log in as:** ${reviewAccount || 'the review account'} (no password here — use the review sign-in link)`,
    '',
    ...list.map(c => `- Check: ${c}`),
    '',
    'Reply `ok`, or `not ok: <what is wrong>`.'
  ].join('\n')
}

/** First prose paragraph of an epic body (skips "Part of", headings, markers) — "what changed". */
export function extractSummary(body = '', max = 400) {
  const paras = body.split(/\n\s*\n/).map(p => p.trim()).filter(p => p && !/^(#|<!--|Part of|---|>|[-*]\s|\d+\.\s)/.test(p))
  return (paras[0] || '').replace(/\s*\n\s*/g, ' ').slice(0, max)
}

/**
 * The one mail per epic that is ready to test (#2518): app name first, what changed, numbered
 * steps, the one-click sign-in link (email-only, #2358). Plain text, no emojis. PURE.
 */
export function buildTestMail({ epicNumber, title = '', app = '', staging = true, summary = '', checks = [], loginUrl = '', epicUrl = '' } = {}) {
  const steps = ['Open the link below and sign in.', ...(checks.length ? checks : [`Try what "${title}" changed.`])]
  const subject = `[${app || 'App'}] Test: ${title || `epic #${epicNumber}`}`
  const text = [
    `App: ${app || '(see epic)'}${staging ? ' (staging)' : ''}`,
    '',
    'What changed:',
    summary || title,
    '',
    'What to test:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `Open and sign in: ${loginUrl || '(no sign-in link available)'}`,
    '',
    'Reply on the epic: ok, or not ok: <what is wrong>',
    epicUrl
  ].join('\n')
  return { subject, text }
}
