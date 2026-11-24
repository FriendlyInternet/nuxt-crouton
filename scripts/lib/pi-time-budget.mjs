#!/usr/bin/env node
// pi-time-budget.mjs — give the pi step its own time limit so a timed-out build is saved (#4183).
//
// WHY: the job `timeout-minutes: 45` CANCELS the job, and the finish step that saves partial work
// is gated on `!cancelled()` — so a build that ran out of time lost everything (#4096: 42 minutes
// of edits, no branch). A step that hits its OWN `timeout-minutes` fails instead, the job keeps
// running, and finish pushes the work as a draft PR carrying the ⏱️ note below.
//
// WHAT (pure functions + a small CLI, Node core only; lives in scripts/lib so the baseline step's
// copy to $RUNNER_TEMP/scripts/lib brings it along):
//   minutes --start <epoch>                → pi_minutes=N / deadline=E   (for $GITHUB_OUTPUT)
//   draft   --outcome --deadline --minutes --accept --tests-missing --signoff
//                                          → DRAFT=<--draft|> / NOTE_B64=<base64 ⏱️ note|>
//   clear   --branch <br> --outcome --deadline → strip the ⏱️ line from the open PR's body
//                                          (does nothing when this round timed out again)
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const JOB_LIMIT = 45
export const RESERVE = 5
export const MAX_PI = 40
export const TIMEOUT_MARK = '<!-- pi-timeout -->'

/** Minutes the pi step may run: job limit − minutes already used − reserve, clamped to [1, 40]. */
export function piMinutes({ jobStart, now, jobLimit = JOB_LIMIT, reserve = RESERVE } = {}) {
  const start = Number(jobStart)
  if (jobStart === undefined || jobStart === null || jobStart === '' || !Number.isFinite(start)) return MAX_PI
  const used = Math.max(0, Math.ceil((Number(now) - start) / 60))
  return Math.min(MAX_PI, Math.max(1, jobLimit - used - reserve))
}

/** { pi_minutes, deadline } — deadline in epoch seconds. */
export function budget({ jobStart, now = Math.floor(Date.now() / 1000) } = {}) {
  const pi_minutes = piMinutes({ jobStart, now })
  return { pi_minutes, deadline: Math.floor(Number(now)) + pi_minutes * 60 }
}

/**
 * True only when the pi step FAILED at (or within a minute of) its deadline — a kill by its own
 * limit. A missing deadline (plan mode: no budget step) is never "ran out of time"; a normal pi
 * failure leaves the step `success` (set +e), so it never matches either.
 */
export function ranOutOfTime({ outcome, deadline, now = Date.now() / 1000 } = {}) {
  if (outcome !== 'failure') return false
  if (deadline === undefined || deadline === null || deadline === '') return false
  const d = Number(deadline)
  if (!Number.isFinite(d) || d <= 0) return false
  return Number(now) >= d - 60
}

export function timeoutNote(minutes) {
  return `${TIMEOUT_MARK}⏱️ The worker ran out of time after ${minutes} minutes. This is unfinished work — reply \`**Worker:** continue\` to finish it. It stays a draft until you reply \`ok\`.`
}

/** Today's draft rule (red acceptance, missing test, sign-off hold) plus a timeout. */
export function draftVerdict({ accept, testsMissing, signoffHold, timedOut, minutes } = {}) {
  const draft = accept === 'fail' || testsMissing === '1' || signoffHold === '1' || Boolean(timedOut)
  return { draft: draft ? '--draft' : '', note: timedOut ? timeoutNote(minutes) : '' }
}

/** The body with every line carrying TIMEOUT_MARK removed. */
export function stripTimeoutNote(body) {
  return String(body ?? '').split('\n').filter((l) => !l.includes(TIMEOUT_MARK)).join('\n')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] ?? ''; i++ }
  }
  return out
}

function cmdMinutes(a, { now }) {
  const b = budget({ jobStart: a.start, now: Math.floor(now() / 1000) })
  return `pi_minutes=${b.pi_minutes}\ndeadline=${b.deadline}\n`
}

function cmdDraft(a, { now }) {
  const timedOut = ranOutOfTime({ outcome: a.outcome, deadline: a.deadline, now: now() / 1000 })
  const v = draftVerdict({ accept: a.accept, testsMissing: a['tests-missing'], signoffHold: a.signoff, timedOut, minutes: a.minutes })
  const note = v.note ? `\n\n${v.note}` : ''
  return `DRAFT=${v.draft}\nNOTE_B64=${Buffer.from(note).toString('base64')}\n`
}

function stripOpenPr(branch, gh) {
  const prs = JSON.parse(String(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,body']) || '[]'))
  const pr = prs[0]
  if (!pr || !String(pr.body || '').includes(TIMEOUT_MARK)) return 'clear: nothing to strip\n'
  const f = join(mkdtempSync(join(tmpdir(), 'pi-timeout-')), 'body.md')
  writeFileSync(f, stripTimeoutNote(pr.body))
  gh(['pr', 'edit', String(pr.number), '--body-file', f])
  return `clear: stripped ⏱️ from #${pr.number}\n`
}

function cmdClear(a, { gh, now }) {
  if (!a.branch) return 'clear: no branch\n'
  if (ranOutOfTime({ outcome: a.outcome, deadline: a.deadline, now: now() / 1000 })) return 'clear: timed out again — kept\n'
  try { return stripOpenPr(a.branch, gh) } catch (e) { return `clear: skipped (${e?.message ?? e})\n` }
}

const COMMANDS = { minutes: cmdMinutes, draft: cmdDraft, clear: cmdClear }

export function main(argv, { gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }), now = Date.now } = {}) {
  const [cmd, ...rest] = argv
  const run = COMMANDS[cmd]
  if (!run) throw new Error(`usage: pi-time-budget.mjs minutes|draft|clear … (got ${cmd})`)
  return run(parseArgs(rest), { gh, now })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(main(process.argv.slice(2))) } catch (e) { console.error(e.message); process.exit(1) }
}
