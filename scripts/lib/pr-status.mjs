// Pure rendering + decision helpers for the status.yml `pr-comment` job (#3617). No GitHub calls —
// scripts/lib/pr-status-io.mjs does the I/O and calls these. Moved verbatim out of the inline
// workflow script; scripts/lib/pr-status-io.test.mjs pins the rendered bodies.
import { logTail, failingLines, stoppedAtBlock } from './log-tail.mjs'
import { expectedRunConclusion } from './fix-bot-dispatch.mjs'

export const PR_STICKY = '<!-- crouton-pipeline-status -->'
export const EPIC_ROLLUP = '<!-- crouton-epic-rollup -->'

/** "2026-01-02 03:04Z" — the stamp on every sticky/card. */
export const stamp = (date = new Date()) => date.toISOString().replace('T', ' ').slice(0, 16) + 'Z'

/** Tally check-runs + commit statuses into one verdict (failure > pending > cancelled > passing). */
export function tallyCi({ checkRuns = [], statuses = [] } = {}) {
  let success = 0, pending = 0, failure = 0, cancelled = 0
  const failing = [] // #1909 — the ping must say WHICH checks, not just how many
  for (const r of checkRuns) {
    if (r.status !== 'completed') { pending++; continue }
    if (['success', 'neutral', 'skipped'].includes(r.conclusion)) success++
    // Cancelled ≠ failed (#1150/#2474): a preview deploy bumped off its queue slot
    // — or a run superseded by a newer push — proved nothing about the code, so it
    // must not drive the 🔴 ping. It is still not green: counted apart, shown apart.
    else if (r.conclusion === 'cancelled') cancelled++
    else { failure++; failing.push({ name: r.name, id: r.id, suite: r.check_suite?.id, conclusion: r.conclusion }) } // failure, timed_out, action_required, stale
  }
  for (const s of statuses) {
    if (s.state === 'pending') pending++
    else if (s.state === 'success') success++
    else { failure++; failing.push({ name: s.context }) } // error, failure — a commit status carries no annotations
  }
  return ciVerdict({ success, pending, failure, cancelled, failing })
}

/** The icon + word for a set of counts (failure > pending > cancelled > passing). */
function ciVerdict({ success, pending, failure, cancelled, failing }) {
  const total = success + pending + failure + cancelled
  let icon = '⏳', word = 'pending'
  if (total === 0) { icon = '⏳'; word = 'queued' }
  else if (failure > 0) { icon = '❌'; word = 'failing' }
  else if (pending > 0) { icon = '⏳'; word = 'running' }
  else if (cancelled > 0) { icon = '⏹️'; word = 'incomplete' } // bumped, not broken — no ping
  else { icon = '✅'; word = 'passing' }
  return { icon, word, success, pending, failure, cancelled, total, failing }
}

const labelNames = pr => (pr.labels || []).map(l => (typeof l === 'string' ? l : l.name))
export { labelNames }

/** The one sticky status note on a pipeline PR. */
export function renderSticky({ st, pr, now }) {
  const fix = labelNames(pr).map(l => /^ci-fix-attempts:(\d+)$/.exec(l)).find(Boolean) // forward-compat with #338
  const parts = [`${st.success}/${st.total} checks passed`]
  if (st.pending) parts.push(`${st.pending} running`)
  if (st.failure) parts.push(`${st.failure} failing`)
  if (st.cancelled) parts.push(`${st.cancelled} cancelled (bumped, not failed — re-run or push to refresh)`)
  return `${PR_STICKY}\n` +
    `### ${st.icon} CI ${st.word}\n` +
    `${parts.join(' · ')}.` +
    (fix ? ` · 🔧 auto-fix ×${fix[1]}` : '') + `\n\n` +
    `<sub>🤖 agent pipeline (#337) · \`${pr.head.ref}\` → \`${pr.base.ref}\` · ` +
    `<a href="${pr.html_url}/checks">checks</a> · updated ${now}</sub>`
}

/**
 * The failing checks as a list: names (max 5) + "+N more", or "see the checks tab" (#1909).
 * `causes` is already aggregate-filtered by causesOf().
 */
export function failureList(causes) {
  const names = causes.slice(0, 5)
  const more = causes.length - names.length
  const list = names.length
    ? names.map(f => `\`${f.name}\``).join(', ') + (more > 0 ? ` +${more} more` : '')
    : 'see the checks tab'
  return { names, list }
}

/**
 * The distilled failure (#2015). Takes [{name, annotations}] and keeps FAILURE-level ones (#2029):
 * `listAnnotations` returns notice/warning/failure together, noise first. Falls back to any level
 * only when a check produced no failure annotation, and says so. Two per check, 400 chars each.
 */
export function failureExcerpts(entries) {
  const excerpts = []
  for (const { name, annotations } of entries) {
    const hard = annotations.filter(a => a.annotation_level === 'failure')
    const use = hard.length ? hard : annotations
    const label = hard.length ? name : `${name} (no error annotation — showing context)`
    for (const a of use.slice(0, 2)) {
      const msg = String(a.message || '').trim().slice(0, 400)
      if (msg) excerpts.push(`${label}: ${msg}`)
    }
  }
  return excerpts.length
    ? `\n\n<details><summary>what failed</summary>\n\n\`\`\`\n${excerpts.join('\n\n')}\n\`\`\`\n</details>`
    : ''
}

/** A cause line made safe for a one-line `<summary>`: capped, no backticks, HTML-escaped (#3666). */
function summaryCause(text) {
  return text.slice(0, 120).replace(/`/g, "'").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * One fenced "log tail" block for a failing job (#2677), or null when the log is empty. When the
 * log names its real failing lines, they come first as `Stopped at:` and the first one is in the
 * summary (#3666) — the tail alone anchors on the exit-code line, far below a test failure.
 */
export function logTailBlock({ name, raw, budget }) {
  const cap = Math.min(4096, budget)
  let causes = failingLines(raw)
  if (stoppedAtBlock(causes).length >= cap) causes = [] // no room: keep today's plain tail
  const stop = stoppedAtBlock(causes)
  const { text, truncated } = logTail(raw, { maxLines: 80, maxBytes: cap - stop.length })
  if (!text) return null
  const tail = text.replace(/```/g, "'''") // fenced, so no @mention in a log can ping
  const cut = truncated ? ' (truncated)' : ''
  const at = causes.length ? ` — stopped at: ${summaryCause(causes[0].text)}` : ''
  return { used: tail.length + stop.length, block: `\n\n<details><summary>log tail — ${name}${cut}${at}</summary>\n\n${stop}\`\`\`\n${tail}\n\`\`\`\n</details>` }
}

/** The fix-bot's view of each failing check: which workflow run it came from and how it ended. */
export function fixBotFailures(causes, wfRuns) {
  const bySuite = new Map(wfRuns.map(r => [r.check_suite_id, r]))
  return causes.map(f => {
    const run = f.suite ? bySuite.get(f.suite) : null
    if (!run) return { workflow: null, conclusion: null }
    return { workflow: run.name, conclusion: expectedRunConclusion({ runConclusion: run.conclusion, checkConclusion: f.conclusion }) }
  })
}

/** The red-ping comment body: marker, heading from redPingHeading(), excerpts, tails, links. */
export function renderRedPing({ marker, hd, why, tails, pr }) {
  return `${marker}\n` +
    `${hd.heading}${why}${tails}\n\n` +
    `${hd.needed}\n\n` +
    `[Checks](${pr.html_url}/checks) · \`${pr.head.ref}\` → \`${pr.base.ref}\`.\n\n` +
    `<sub>🤖 agent pipeline (CI) · failure notify (#1815/#1909/#3373)</sub>`
}

export function signoffPingBody({ epicNumber, owner, title }) {
  return `<!-- signoff-ping:${epicNumber} -->\n` +
    `🎨 **@${owner} — this needs your sign-off** (${title}).\n\n` +
    `A draft PR is waiting on your reply (\`ok\`, or \`not ok: what's wrong\`) before it can build or ` +
    `merge — open this issue's latest comment (or its PR) to see what changed.\n\n` +
    `<sub>🤖 agent pipeline (CI) · sign-off notify (#1815/#2135)</sub>`
}

export function withheldBody({ epicNumber, prNumber, title }) {
  return `<!-- signoff-withheld-nocapture:${epicNumber} -->\n` +
    `🚫 **Sign-off withheld — nothing to show yet** (${title}).\n\n` +
    `PR #${prNumber} changes a visual surface, but no screenshot was captured this run ` +
    `(no screenshot comment on the PR yet). The flow will not ask you to approve a ` +
    `surface it hasn't shown you — a capture (or a working preview of the changed ` +
    `surface) has to land first. Nothing for you to do here; the gap is the flow's to ` +
    `close (#2057).\n\n` +
    `<sub>🤖 agent pipeline (CI) · visual sign-off gate (#2171)</sub>`
}

/** Stage bar: 0 children ⇒ sign-off · some open ⇒ build · all closed ⇒ assemble. */
export function stageBar(total, done) {
  const stages = ['sign-off', 'build', 'assemble', 'review']
  const curIdx = total === 0 ? 0 : (done < total ? 1 : 2)
  return stages.map((s, i) => i === curIdx ? `**${s}** ◀` : i < curIdx ? `${s} ✓` : s).join(' → ')
}

/** The epic card: `needsSignoffCheck` is true for an epic with 0 children that is blocked. */
export function epicCard({ title, epicBlocked, subs, childLines, now }) {
  const total = subs.length
  const done = subs.filter(s => s.state === 'closed').length
  const bar = stageBar(total, done)
  let head, activity
  if (total === 0) {
    head = epicBlocked ? `## 🎨 Awaiting your sign-off — ${title}` : `## ⏳ Decomposing — ${title}`
    activity = epicBlocked ? '_now: waiting for your `ok` / answer on the design_' : '_now: the decomposer is planning this epic_'
  } else if (done < total) {
    head = `## 🔨 Building — ${title}  (${done}/${total})`
    activity = `_now: ${total - done} of ${total} in flight — reply here or on a PR to steer_`
  } else {
    head = `## ✅ Assembled — ${title}  (${total}/${total})`
    activity = '_now: all children merged — the epic→main PR opens for your review next_'
  }
  const body =
    `${EPIC_ROLLUP}\n` +
    `${head}\n\n` +
    `\`${bar}\`\n\n` +
    (childLines.length ? childLines.join('\n') + '\n\n' : '') +
    `${activity}\n\n` +
    `<sub>🤖 agent pipeline · live status (#1838) · updated ${now}</sub>`
  return { body, needsSignoffCheck: total === 0 && epicBlocked }
}

/** Head SHA of whichever check-ish event fired — workflow_run first (#1884). */
export function prSourceSha(payload = {}) {
  return payload.workflow_run?.head_sha || payload.check_suite?.head_sha || payload.sha
}

/** Which epic does a closed/reopened issue belong to: itself (has sub-issues) or its `epic=N` parent. */
export function epicFromIssue({ hasSubs, body, number }) {
  if (hasSubs) return number
  const m = /epic=(\d+)/.exec(body || '')
  return m ? Number(m[1]) : null
}
