#!/usr/bin/env node
// test-card.mjs — the pure "is this epic ready to be tested by the owner?" decision + the card
// text (#2541, epic #2519). The GitHub I/O lives in post-test-card.mjs; this file is the
// deterministic core, unit-tested in isolation (same split as epic-ready.mjs).
//
// The reply side (`ok` / `not ok: …`) is parsed by scripts/approval.mjs (#2540).

import { fileMatchesAny } from './deploy-detect.mjs'
import { closesNumbers } from './epic-ready.mjs'

/** Hidden marker that makes the card idempotent — one card per epic, plus one re-test card per landed `not ok` fix (#4039). */
export const CARD_MARKER = '<!-- test-card -->'

/**
 * Decide whether to post the test card. PURE. A false SKIP is safe (the next deploy retries);
 * a false POST pings the owner to test something that is not live, so the rule is conservative.
 *   subIssues:  [{ state }]   the epic's direct sub-issues
 *   labels:     string[]      the epic's labels
 *   comments:   [{ body }]    the epic's comments (looked at for the marker)
 *   deployed:   boolean       the epic's merged result is contained in a successful staging deploy
 *   fixDeployed: boolean      (status:failed only) the latest `not ok` fix's merge commit is in the
 *                             deployed staging sha (#4039)
 *   fixClosedAt: string|null  (status:failed only) ISO close time of that fix issue; a card newer
 *                             than it means the re-test card was already posted
 */
export function decideTestCard({ subIssues = [], labels = [], comments = [], deployed = false, fixDeployed = false, fixClosedAt = null } = {}) {
  if (labels.includes('status:to-test')) return { post: false, reason: 'already status:to-test' }
  if (labels.includes('status:failed')) {
    const openKids = subIssues.filter(s => s.state !== 'closed').length
    if (openKids > 0) return { post: false, reason: `not ok fix still open — ${openKids} child issue(s) open` }
    if (fixClosedAt && comments.some(c => (c.body || '').includes(CARD_MARKER) && Date.parse(c.created_at) > Date.parse(fixClosedAt))) {
      return { post: false, reason: 'fresh card already posted for this fix' }
    }
    if (!fixDeployed) return { post: false, reason: 'not ok fix not on staging yet' }
    return { post: true, reason: 'fix landed after a not ok — fresh card', retest: true }
  }
  if (comments.some(c => (c.body || '').includes(CARD_MARKER))) return { post: false, reason: 'card already posted' }
  if (labels.includes('status:verified')) return { post: false, reason: 'already answered' }
  if (subIssues.length === 0) return { post: false, reason: 'epic has no sub-issues' }
  const open = subIssues.filter(s => s.state !== 'closed').length
  if (open > 0) return { post: false, reason: `${open} child issue(s) still open` }
  if (!deployed) return { post: false, reason: 'merged result not on staging yet' }
  return { post: true, reason: `all ${subIssues.length} children closed + deployed to staging` }
}

/**
 * Which app(s) did an epic's merged PR deploy? PURE (#2748). Used when the epic has no `app:`
 * label: the apps whose watch paths (deploy-detect's computeMatrix, the same rule deploy-apps.yml
 * uses) cover the PR's changed files. The lockfile alone is ignored — it matches every app.
 *   apps: [{ app, watchPaths }]   text: the epic's How-to-test text
 * One match → that app. Several → the one named in `text`, else all of them (caller lists them).
 */
export function deriveApps({ changedFiles = [], apps = [], text = '' } = {}) {
  const files = changedFiles.filter(f => f && f !== 'pnpm-lock.yaml')
  const hit = apps.filter(a => files.some(f => fileMatchesAny(f, a.watchPaths || []))).map(a => a.app)
  if (hit.length <= 1) return hit
  const named = hit.filter(n => new RegExp(`\\b${n}\\b`, 'i').test(text))
  return named.length === 1 ? named : hit
}

const NO_APP_LINE = 'Nothing to open: this changes how GitHub and the pipeline behave. Check it on the epic itself.'
const METADATA_LINE = /^(?:Blocked-by:|Unblocks:|Dedup-checked:|Packages-approved:|Workflow-change:|Parent:|Refs\s+#|Closes\s+#|<!--)/i

export function sectionChecks(body, heading) {
  const re = new RegExp(`^#{2,4}\\s*${heading}\\s*$([\\s\\S]*?)(?=^#{1,4}\\s|\\n---|$(?![\\s\\S]))`, 'im')
  const m = re.exec(body)
  return (m ? m[1] : '')
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .filter(l => l && !METADATA_LINE.test(l))
    .map(l => l.replace(/\*\*/g, '').trim())
    .filter(Boolean)
}

/** True when the body has at least one step under a `How to test` heading (not the `Done when` fallback). */
export function hasTestSteps(body = '') {
  return sectionChecks(body, '(?:🧪\\s*)?How to test').length > 0
}

/** One line for a PR body pointing at the issue's 🧪 steps; says so when there are none (#3036). */
export function howToTestPointer(issue, body = '') {
  return hasTestSteps(body) ? `How to test: see #${issue} → 🧪` : `How to test: #${issue} has no 🧪 steps`
}

/**
 * Up to `max` phone-friendly check lines: the "How to test" section (written for a person) first,
 * "Done when" (written for the worker) as the fallback. Metadata lines are dropped.
 */
export function extractChecks(body = '', max = 5) {
  const howTo = sectionChecks(body, '(?:🧪\\s*)?How to test')
  return (howTo.length ? howTo : sectionChecks(body, 'Done when')).slice(0, max)
}

/** Markers for the "app is broken / back up" notices on an open test card (#2870). */
export const BROKEN_MARKER = '<!-- test-card: app-broken -->'
export const BACKUP_MARKER = '<!-- test-card: app-back -->'
const NOTICE_PROVENANCE = '> 🤖 **Claude Code** · agent pipeline (CI) · _staging check (#2870)_'
export const BROKEN_NOTICE = `${NOTICE_PROVENANCE}\n\n${BROKEN_MARKER}\n⚠️ The app is broken on staging right now, so hold off testing. I'll say when it's back.`
export const BACKUP_NOTICE = `${NOTICE_PROVENANCE}\n\n${BACKUP_MARKER}\n✅ Back up, you can test.`

/**
 * Which apps did a deploy run's jobs name with the given conclusion? PURE. Matrix job names
 * carry the app id, so match it as a whole word.
 *   jobs: [{ name, conclusion }]   appIds: string[]
 */
export function appsFromJobs(jobs = [], appIds = [], conclusion = 'failure') {
  return appIds.filter(id => jobs.some(j => j.conclusion === conclusion && new RegExp(`(?<![\\w-])${id}(?![\\w-])`, 'i').test(j.name || '')))
}

/**
 * Should a broken/back-up notice be posted on a to-test card? PURE. The latest notice marker in
 * the comments is the state, so a re-run never double-posts: "broken" only when the card is not
 * already marked broken; "back" only when it is.
 */
export function decideAppNotice({ kind, comments = [] } = {}) {
  const last = comments.map(c => c.body || '').reduce((acc, b) => (b.includes(BROKEN_MARKER) ? 'broken' : b.includes(BACKUP_MARKER) ? 'back' : acc), '')
  if (kind === 'broken') return last === 'broken' ? { post: false, reason: 'already marked broken' } : { post: true, body: BROKEN_NOTICE }
  if (kind === 'back') return last === 'broken' ? { post: true, body: BACKUP_NOTICE } : { post: false, reason: 'was not marked broken' }
  return { post: false, reason: 'unknown kind' }
}

export const NOT_CHECKED_LINE = 'Saving was not checked automatically for this app.'

// ── What the pipeline already checked (#3882) ─────────────────────────────────────
export const EVIDENCE_HEADING = '**Already checked by the pipeline**'
export const EVIDENCE_MAX = 8
/** Whose ✅ comments count as a closing note. `github-actions[bot]` posts "✅ Resumed from your reply" — left out. */
export const NOTE_AUTHORS = ['pmcp', 'nuxt-harness[bot]', 'nuxt-harness']
const NOTE_RE = /^\s*(?:#{1,6}\s+)?✅\s*/
const BOILERPLATE_RE = /^Built to the plan\b/i
const PLAN_REVIEW_MARKER = '<!-- plan-review:v1 -->'

/** Wrap every `@handle` not already inside a code span in backticks, so a note can never ping anyone. */
export function defangMentions(s = '') {
  return String(s).replace(/(`[^`]*`)|(?<!\w)@([A-Za-z0-9-]+(?:\[bot\])?)/g, (m, code, handle) => code || `\`@${handle}\``)
}

/** Escape the Markdown link-label characters (`\`, `[`, `]`) so a title can't break `[title](url)`. */
export function escapeLinkLabel(s = '') {
  return String(s).replace(/[\\[\]]/g, '\\$&')
}

/** The first real line of a comment (skips blanks, `<!--` markers, `>` quotes) if it is a ✅ note, else ''. */
export function noteLine(body = '') {
  const line = String(body || '').split('\n').find(l => l.trim() && !/^\s*<!--/.test(l) && !/^\s*>/.test(l)) || ''
  return NOTE_RE.test(line) ? line : ''
}

/**
 * Strip heading/✅/bold, cut to 140 chars, then defang mentions. Anything with `password=` is
 * dropped. The cut comes BEFORE the defang (and never leaves an unclosed code span), so a
 * handle near the cut can't lose its closing backtick and ping — and a second pass is safe.
 */
export function cleanNote(line = '') {
  const s = String(line || '').replace(/^\s*#{1,6}\s+/, '').replace(/^\s*✅\s*/, '').replace(/\*\*/g, '').trim()
  if (/password=/i.test(s)) return ''
  let cut = s.slice(0, 140)
  if ((cut.match(/`/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('`'))
  return defangMentions(cut.trimEnd())
}

/**
 * A child's closing note. PURE. comments: [{ login, body, created_at }]. The newest ✅ note by
 * the owner/harness (plan-review comments skipped); a "Built to the plan" note only when nothing
 * better exists.
 */
export function closingNote(comments = []) {
  const notes = comments
    .filter(c => NOTE_AUTHORS.includes(c.login) && !String(c.body || '').includes(PLAN_REVIEW_MARKER))
    .slice()
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
    .map(c => cleanNote(noteLine(c.body)))
    .filter(Boolean)
  return notes.find(n => !BOILERPLATE_RE.test(n)) || notes[0] || ''
}

/**
 * One entry per completed child: its merged sub-PR (or the child itself) + its closing note. PURE.
 *   subIssues: [{ number, title, html_url, state, state_reason }]
 *   mergedPrs: [{ body, html_url, merged_at }]   commentsByIssue: { [n]: [{ login, body, created_at }] }
 */
export function buildEvidence({ subIssues = [], mergedPrs = [], commentsByIssue = {} } = {}) {
  const prFor = new Map()
  for (const pr of mergedPrs) {
    for (const n of closesNumbers(pr.body)) {
      const prev = prFor.get(n)
      if (!prev || Date.parse(pr.merged_at || 0) > Date.parse(prev.merged_at || 0)) prFor.set(n, pr)
    }
  }
  return subIssues
    .filter(s => s.state === 'closed' && s.state_reason === 'completed')
    .map(child => ({
      title: child.title,
      url: prFor.get(child.number)?.html_url || child.html_url,
      note: closingNote(commentsByIssue[child.number] || [])
    }))
}

/** Render evidence lines (max 8, then "and N more"); notes re-guarded so a caller can't ping or leak. */
export function evidenceLines(evidence = [], fmt) {
  const lines = evidence.slice(0, EVIDENCE_MAX).map(e => {
    const note = e.note ? cleanNote(e.note) : ''
    return fmt({ title: defangMentions(e.title || ''), url: e.url, note })
  })
  if (evidence.length > EVIDENCE_MAX) lines.push(`- and ${evidence.length - EVIDENCE_MAX} more`)
  return lines
}

/** Build the card comment. No password is ever included — only the account to log in as. */
export function buildCard({ epicNumber, title = '', app = '', stagingUrl = '', reviewAccount = '', checks = [], crudChecked, fixIssue, evidence = [] } = {}) {
  const list = checks.length ? checks : [app ? `Open the app and try what "${title}" changed` : `Read the epic and check "${title}" did what it says`]
  const where = !app
    ? [NO_APP_LINE]
    : stagingUrl
      ? [
          `**App:** ${app}`,
          `**Try it:** ${stagingUrl}`,
          `**Log in as:** ${reviewAccount || 'the review account'} (no password here — use the review sign-in link)`
        ]
      : [`**App:** ${app} — no staging link yet`]
  return [
    CARD_MARKER,
    `## 🧪 Test card — ${title || `epic #${epicNumber}`}`,
    ...(fixIssue ? ['', `Re-test after the fix in #${fixIssue}.`] : []),
    '',
    ...where,
    '',
    ...(evidence.length
      ? [EVIDENCE_HEADING, '', ...evidenceLines(evidence, e => `- [${escapeLinkLabel(e.title)}](${e.url})${e.note ? ` — ${e.note}` : ''}`), '']
      : []),
    ...list.map(c => `- Check: ${c}`),
    ...(app && crudChecked === false ? ['', NOT_CHECKED_LINE] : []),
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
export function buildTestMail({ epicNumber, title = '', app = '', staging = true, summary = '', checks = [], loginUrl = '', epicUrl = '', evidence = [] } = {}) {
  const fallback = app ? `Try what "${title}" changed.` : `Check "${title}" on the epic.`
  const steps = [...(app ? ['Open the link below and sign in.'] : []), ...(checks.length ? checks : [fallback])]
  const subject = `${app ? `[${app}] ` : ''}Test: ${title || `epic #${epicNumber}`}`
  const text = [
    app ? `App: ${app}${staging ? ' (staging)' : ' — no staging link yet'}` : NO_APP_LINE,
    '',
    'What changed:',
    summary || title,
    '',
    ...(evidence.length
      ? ['Already checked by the pipeline:', ...evidenceLines(evidence, e => `- ${e.title}: ${e.url}${e.note ? ` — ${e.note}` : ''}`), '']
      : []),
    'What to test:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    ...(app ? [`Open and sign in: ${loginUrl || '(no sign-in link available)'}`, ''] : []),
    'Reply on the epic: ok, or not ok: <what is wrong>',
    epicUrl
  ].join('\n')
  return { subject, text }
}
