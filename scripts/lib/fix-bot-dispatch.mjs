// fix-bot-dispatch.mjs — may the CI fix-bot run on this PR when started by hand? (#3105)
//
// The fix-bot's `workflow_run` trigger only sees `work-*` heads. The manual `workflow_dispatch` path
// (started by the owner's `ok` on a red epic → main PR) also accepts an `epic/*` head into `main`,
// but ONLY while the PR is open and the owner's `ok` still stands (`go` = ownerMergeGo() result).
// Pure; the workflow gathers the facts.

import { effectiveAttempts } from './diagnosis-review.mjs'

/** @returns {{ run: boolean, reason: string }} */
export function decideFixBotDispatch({ head, base, state, go }) {
  const h = String(head || '')
  if (state !== 'open') return { run: false, reason: `PR is not open (${state})` }
  if (h.startsWith('work-')) return { run: true, reason: 'work-* branch' }
  if (!h.startsWith('epic/')) return { run: false, reason: `head ${h} is not a pipeline branch` }
  if (base !== 'main') return { run: false, reason: `epic head must target main (base is ${base})` }
  if (!go?.go) return { run: false, reason: go?.reason || 'no standing owner ok' }
  return { run: true, reason: 'epic → main with a standing owner ok' }
}

/**
 * The newest failed CI/E2E workflow run for a head sha. A check-run id is NOT a workflow-run id,
 * so this takes workflow runs (actions.listWorkflowRunsForRepo), never check runs.
 * @param {{ id:number, name:string, conclusion:string|null, created_at?:string, html_url?:string }[]} runs
 */
export function pickFailedRun(runs = []) {
  const failed = runs
    .filter(r => ['CI', 'E2E'].includes(r.name) && r.conclusion === 'failure')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return failed[0] || null
}

// ── #3373: ONE "will the fix-bot try?" decision, shared by fix-ci-on-failure.yml (the gate) and
// scripts/lib/pr-status-io.mjs (the red ping, posted by status.yml), so the red ping's wording reflects whether the bot will handle a failure (never a mention, #3622).
// Keep FIX_BOT_WORKFLOWS in lockstep with the `workflow_run.workflows` list in fix-ci-on-failure.yml
// (a test enforces it).
export const FIX_BOT_WORKFLOWS = ['CI', 'E2E', 'Deploy Apps (Cloudflare Workers)']
export const FIX_BOT_MAX_ATTEMPTS = 3

// #3277: with a `headCommit` the count only stands while the head is the fix-bot's own commit; any
// other head (a worker commit, a base merge) is new code and starts again at 0. Without one (an
// older caller) the label alone counts, as before. `attemptLabel` stays so the bump can replace it.
// #3668 review: `carry` (carriedTry in diagnosis-review.mjs) keeps the count on a worker head that
// still fails on the same line after a refused fix hand-back, so that loop ends at the cap.
const attemptsFrom = (labels = [], headCommit, carry = false) => {
  const attemptLabel = labels.find(n => /^ci-fix-attempts:\d+$/.test(n))
  const attempts = headCommit === undefined
    ? (attemptLabel ? Number(attemptLabel.split(':')[1]) : 0)
    : effectiveAttempts({ labels, headCommit, carry })
  return { attemptLabel, attempts }
}

/**
 * #3667: after one fix try, a watched check that is red again gets a 🩺 diagnosis, not another fix.
 * `diagnose` when the PR carries `ci-fix-attempts:N` (N ≥ 1) and a FIX_BOT_WORKFLOWS run failed; else `fix`.
 * #3277: with `headCommit`, N only counts while the head is a fix-bot commit.
 * @returns {'fix'|'diagnose'}
 */
export function fixOrDiagnose({ labels = [], failures = [], headCommit, carry = false } = {}) {
  if (attemptsFrom(labels, headCommit, carry).attempts < 1) return 'fix'
  const red = failures.some(f => f && FIX_BOT_WORKFLOWS.includes(f.workflow) && f.conclusion === 'failure')
  return red ? 'diagnose' : 'fix'
}

/**
 * @param {{ head:string, base:string, state:string, go?:any, manual?:boolean, labels?:string[],
 *   failures?:{ workflow:string|null, conclusion:string|null }[] }} p
 * @returns {{ who:'bot'|'gave-up'|'owner'|'none', code:string, reason:string, attempts:number, attemptLabel:string|undefined, mode:'fix'|'diagnose' }}
 */
export function fixBotWillTry({ head, base, state, go, manual = false, labels = [], failures = [], headCommit, carry = false }) {
  const out = (who, code, reason, attempts = 0, attemptLabel, mode = 'fix') => ({ who, code, reason, attempts, attemptLabel, mode })
  const h = String(head || '')
  if (!manual && !h.startsWith('work-')) {
    return out('owner', 'not-eligible', 'the auto-fix only runs on its own on work-* branches')
  }
  const verdict = decideFixBotDispatch({ head, base, state, go })
  if (!verdict.run) return out('owner', 'not-eligible', verdict.reason)
  if (!failures.length) return out('none', 'no-failed-run', 'no failed CI run found')
  if (labels.includes('status:blocked')) {
    return out('owner', 'blocked', 'the auto-fix stands down while the PR is blocked')
  }
  const unwatched = failures.find(f => !f.workflow || !FIX_BOT_WORKFLOWS.includes(f.workflow))
  if (unwatched) {
    return out('owner', 'not-watched', `the auto-fix doesn't watch \`${unwatched.workflow || 'a commit status / non-Actions check'}\``)
  }
  const odd = failures.find(f => f.conclusion !== 'failure')
  if (odd) {
    return out('owner', 'not-failure', `the auto-fix only starts on a plain failure; \`${odd.workflow}\` ended \`${odd.conclusion}\``)
  }
  const { attemptLabel, attempts } = attemptsFrom(labels, headCommit, carry)
  if (attempts >= FIX_BOT_MAX_ATTEMPTS) return out('gave-up', 'gave-up', `auto-fix gave up after ${attempts} tries`, attempts, attemptLabel)
  return out('bot', 'bot', 'the auto-fix will try', attempts, attemptLabel, fixOrDiagnose({ labels, failures, headCommit, carry }))
}

/** The conclusion the bot's workflow_run event will carry. A still-running run (null) is predicted from its red check. */
export function expectedRunConclusion({ runConclusion, checkConclusion }) {
  return runConclusion ?? checkConclusion
}

/** Heading + "What's needed" for the red ping. Never @mentions anyone (#3622). */
export function redPingHeading({ who, reason, attempts = 0, count = 0, list = '', head = '', base = '', mode = 'fix' }) {
  const n = `${count} failing check${count === 1 ? '' : 's'}`
  if (who === 'bot' && mode === 'diagnose') {
    return {
      heading: `🔴 **CI failed on this pipeline PR** (${n}): ${list}.`,
      needed: "**What's needed:** nothing yet — the same check is red again after a fix try, so the fix-bot writes a 🩺 diagnosis instead of another fix; a second agent checks it; the fix starts only from an approved diagnosis.",
    }
  }
  if (who === 'bot') {
    return {
      heading: `🔴 **CI failed on this pipeline PR** (${n}): ${list}.`,
      needed: `**What's needed:** nothing yet — the auto-fix bot is on it (attempt ${attempts + 1} of ${FIX_BOT_MAX_ATTEMPTS}). You'll be tagged only if it gives up.`,
    }
  }
  if (who === 'gave-up') {
    return {
      heading: `🔴 **CI failed on this pipeline PR** (${n}): ${list}.`,
      needed: `**What's needed:** see the auto-fix "gave up" note — that one is yours.`,
    }
  }
  if (base === 'main' && head.startsWith('epic/')) {
    return {
      heading: `🔴 **CI failed on this epic PR** (${n}): ${list}.`,
      needed: `**What's needed:** this epic PR won't merge while CI is red. Push a fix to \`${head}\`, ` +
        `or reply \`ok\` and the CI fix runs and it merges when green.`,
    }
  }
  return {
    heading: `🔴 **CI failed on this pipeline PR — the auto-fix won't take it** (${n}): ${list}.`,
    needed: `The auto-fix bot won't try: ${reason}.\n\n**What's needed:** read the failure, then either push a fix to \`${head}\` ` +
      `or reply here saying why it isn't yours. A red sub-PR won't auto-merge into its ` +
      `epic, so it sits until one of those happens — **it does not mean the work is ` +
      `finished and waiting on your approval**.`,
  }
}
