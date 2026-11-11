#!/usr/bin/env node
// plan-held.mjs — the owner's override of a twice-rejected plan (#3272).
//
// The router (comment-route.mjs) sends an owner `ok: <reason>` on a plan held after two reviewer
// rejections to the `approve-plan` job in on-comment.yml, which calls approvePlan(): it posts
// `**Decision (owner override, <date>):** <reason>` AS THE HARNESS BOT, logs a dated line on the
// parent epic, and labels the issue `plan:approved` (label-router.yml then builds the newest plan).
// The build reads the reason back from that bot comment only: the same words from a person,
// another bot, or from before the newest plan are ignored.
//
// CLI (the build step in work-issue-pidev.yml):
//   node scripts/plan-held.mjs --approved-prompt --plan-id <id> --plan-file <path> --issue <n>
//     → the whole approved-plan section of the build prompt on stdout, written once at the end.
//       It reads the issue's comments itself; a failed or partial read means NO override and a
//       ::warning:: on stderr (exit 0). An unreadable plan file exits 1 and writes nothing.
//   gh api --paginate .../comments --jq '.[] | @json' | node scripts/plan-held.mjs --decision
//     → the override reason (or nothing); for tests and manual use.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { isRejectedTwice } from './plan-hold.mjs'
import { parseOverride, decisionLine, appendDecision } from './lib/decision-line.mjs'
import { handoffGuard as defaultHandoffGuard } from './handoff-exec.mjs'

export const BOT = 'nuxt-harness[bot]'
const PLAN = '<!-- pipeline-plan:v1 -->'
const DECISION = /^\*\*Decision \(owner override[^)]*\):\*\*[ \t]*/

/** The reply to a bare approval on a twice-rejected plan: ask for the reason, keep the hold. */
export const NEEDS_REASON = '<!-- pipeline-note -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _owner override (#3272)_\n\n'
  + 'The plan was rejected twice, so I need a reason to build it anyway. Reply `ok: <why the reviewers\' point does not matter>` and I will build from the newest plan. The hold stays until then.'

/**
 * @param {Array<{body?: string, user?: {login?: string}}>} comments oldest first
 * @returns {string} the override reason, or ''
 */
export function currentOverrideDecision(comments = []) {
  let reason = ''
  for (const c of comments) {
    const body = String(c?.body || '')
    if (body.includes(PLAN)) reason = '' // a newer plan voids an older override
    else if (c?.user?.login === BOT && DECISION.test(body)) reason = body.replace(DECISION, '').split('\n')[0].trim()
  }
  return reason
}

/** The bot comment body for an override. */
export function overrideComment({ reason, date, url }) {
  return `**Decision (owner override, ${String(date).slice(0, 10)}):** ${reason}\n\n_From the owner's [reply](${url}); the plan reviewers rejected twice and the owner approved anyway._`
}

/** One JSON comment object per line (`--jq '.[] | @json'`); throws on a line that is not JSON. */
export function parseCommentLines(raw = '') {
  return String(raw).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

/** The reviewer-approved header of the build prompt (was inline in work-issue-pidev.yml, #2757). */
export function approvedHeader(planId) {
  return `\n\nAN INDEPENDENT REVIEWER APPROVED THIS PLAN (comment ${planId}, #2757). IMPLEMENT EXACTLY THIS PLAN — its Fix, Files and Test sections are your scope. If reality differs from the plan (a file is gone, the cause is not what it says, the fix does not work), STOP: post a top-level issue comment saying what differs and why, add status:blocked, and do NOT improvise a different change.\n\n--- APPROVED PLAN ---\n`
}

const defaultGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

/**
 * The whole approved-plan section: header + plan text + (only if there is one) the owner override.
 * Capture-first: the comments are read completely before anything is decided; a failed or
 * truncated read yields no override and a warning, never a throw.
 * @param {{planId: string|number, planText: string, issue: string|number, repo?: string, gh?: (args: string[]) => string, warn?: (msg: string) => void}} input
 */
export function approvedPromptSection({ planId, planText, issue, repo = process.env.GITHUB_REPOSITORY, gh = defaultGh, warn = (m) => process.stderr.write(`${m}\n`) }) {
  let reason = ''
  try {
    const raw = gh(['api', '--paginate', `repos/${repo}/issues/${issue}/comments?per_page=100`, '--jq', '.[] | @json'])
    reason = currentOverrideDecision(parseCommentLines(raw))
  } catch {
    warn(`::warning::could not read the owner override for #${issue}; building without one`)
    reason = ''
  }
  let out = approvedHeader(planId) + String(planText)
  if (reason) out += `\n\n--- OWNER OVERRIDE (the owner approved this plan over the reviewers' objection; their reason binds you) ---\n${reason}\n`
  return out
}

const labelNames = (labels = []) => labels.map((l) => (typeof l === 'string' ? l : l?.name))

/**
 * The route step's `planHeld` fact: is this issue held after two reviewer rejections?
 * No API call unless the issue is a plain issue carrying `status:blocked`.
 */
export async function planHeldFor({ github, repo, issue }) {
  const labels = labelNames(issue?.labels)
  if (!issue || issue.pull_request || !labels.includes('status:blocked')) return false
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issue.number, per_page: 100 })
  return isRejectedTwice({ comments: comments.map((c) => ({ body: c.body, userType: c.user && c.user.type })), labels })
}

/** The parent epic of a ticket: `epic=N` in the hidden marker, else the GitHub sub-issue parent (0 = none). */
async function parentEpic({ github, context, core, issue }) {
  const marker = /<!--\s*pipeline:[^>]*\bepic=(\d+)/.exec(issue.body || '')?.[1]
  if (marker) return Number(marker)
  try {
    const { data } = await github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/parent', { ...context.repo, issue_number: issue.number })
    return Number(data?.number) || 0
  } catch (e) {
    if (e?.status !== 404) core.warning(`could not read the parent of #${issue.number}: ${e?.message || e}`)
    return 0
  }
}

/**
 * The `approve-plan` job (on-comment.yml), run with the Harness App token so label-router.yml's
 * actor check passes. Order matters: (1) the bot's record first, so the build can never start
 * before its reason exists; (2) a dated line on the parent epic; (3) lift the hold and approve,
 * remove-then-add so an existing `plan:approved` still fires the label event. The label add is the
 * build hand-off, so a limit / 5xx on it is saved and replayed by the hourly sweep (#3306).
 */
export async function approvePlan({ github, context, core, handoffGuard = defaultHandoffGuard }) {
  const c = context.payload.comment
  const issue = context.payload.issue
  const issue_number = issue.number
  const reason = parseOverride({ body: c.body, authorAssociation: c.author_association, userType: c.user?.type })
  if (!reason) return core.setFailed('routed to approve-plan but no ok: <reason> found')
  await github.rest.issues.createComment({ ...context.repo, issue_number, body: overrideComment({ reason, date: c.created_at, url: c.html_url }) })
  const epic = await parentEpic({ github, context, core, issue })
  if (epic && epic !== issue_number) {
    const { data: e } = await github.rest.issues.get({ ...context.repo, issue_number: epic })
    const line = decisionLine({ text: `owner override of a twice-rejected plan on #${issue_number}: ${reason}`, date: c.created_at, url: c.html_url })
    const next = appendDecision(e.body, line, c.html_url)
    if (next !== e.body) await github.rest.issues.update({ ...context.repo, issue_number: epic, body: next })
  }
  for (const name of ['status:blocked', 'plan:approved']) {
    try { await github.rest.issues.removeLabel({ ...context.repo, issue_number, name }) } catch {}
  }
  await handoffGuard({ kind: 'label', issue: issue_number, label: 'plan:approved' },
    () => github.rest.issues.addLabels({ ...context.repo, issue_number, labels: ['plan:approved'] }))
  core.info(`#${issue_number}: plan approved by owner override`)
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  const argv = process.argv.slice(2)
  if (argv.includes('--approved-prompt')) {
    let planText
    try {
      planText = readFileSync(argValue(argv, '--plan-file'), 'utf8')
    } catch (e) {
      process.stderr.write(`plan-held: cannot read the plan file: ${e.message}\n`)
      process.exit(1)
    }
    process.stdout.write(approvedPromptSection({ planId: argValue(argv, '--plan-id'), planText, issue: argValue(argv, '--issue') }))
  } else if (argv.includes('--decision')) {
    const out = currentOverrideDecision(parseCommentLines(readFileSync(0, 'utf8')))
    if (out) console.log(out)
  }
}
