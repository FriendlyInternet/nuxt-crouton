// The pi decompose artifact-gate (#461), moved verbatim out of decompose-on-issue-pidev.yml's inline
// `script:` (#3452 / #3618) so it is testable. Loaded from the $RUNNER_TEMP snapshot of scripts/lib
// (the apply step may check the workspace out to an older epic branch first).
// Deliberately NOT merged with artifact-gate.mjs (the worker twin): that one checks more things.
import nodeFs from 'node:fs'
import { parseRunStart } from './run-start.mjs'

export async function decomposeArtifactGate({ github, context, core, env = process.env, fs = nodeFs }) {
  const issue_number = Number(env.ISSUE_NUMBER)
  const rs = parseRunStart(env.RUN_START)
  if (!rs.ok) { core.setFailed('Artifact-gate cannot run: run-start time (t0) is empty or invalid — refusing to compare against it (#3324)'); return }
  const since = rs.since
  const sinceMs = rs.sinceMs

  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo, issue_number, since,
  })
  const newComment = comments.length > 0

  const timeline = await github.paginate(github.rest.issues.listEventsForTimeline, {
    ...context.repo, issue_number,
  })
  const prRefs = timeline.filter(e =>
    e.event === 'cross-referenced' &&
    e.source && e.source.issue && e.source.issue.pull_request
  )
  const linkedPR = prRefs.some(e => new Date(e.created_at).getTime() >= sinceMs)
  // NOTE (#1019): we deliberately do NOT treat a pre-existing cross-referenced PR as
  // a pass. On #839 an UNRELATED epic PR (#846) merely cross-referenced the issue and
  // false-greened a no-op run. A fresh-work run must yield a FRESH deliverable (a PR
  // opened this run / sub-issues created this run / a sign-off held this run) or a
  // genuinely closed issue — not a stale link. `alreadyLinkedPR` is intentionally unused.

  const issue = await github.rest.issues.get({ ...context.repo, issue_number })
  const blocked = hasLabel(issue.data.labels, 'status:blocked')
  const alreadyClosed = issue.data.state === 'closed'

  const createdSubIssues = await subIssuesCreatedSince({ github, context, core, issue_number, sinceMs })

  // ── LEAF DISPATCH (#1740) ──────────────────────────────────────────────────
  // A leaf plan ({"leaf": true}) is NOT a no-op. The deterministic apply step
  // (scripts/apply-decompose-plan.mjs → buildActionList) labels the target `work-this`
  // (WORKER_TRIGGER), which triggers the single-use worker (work-issue-pidev.yml) whose
  // PR lands in a SEPARATE run with its own artifact-gate. So "dispatched the worker" is a
  // complete, honest deliverable for THIS decompose run. Without this branch a correctly-
  // classified leaf false-fails as "produced nothing / underspecified" (the #1713 case —
  // an exemplary issue mis-blamed as underspecified). Same class as the #1074 child-
  // deliverable blind spot. Signal: a `work-this` labeled event on the target since t0.
  const leafDispatched = workThisLabeledSince(timeline, sinceMs)

  const signoffHeld = blocked && newComment

  // ── ASK vs APPROVE (#1745) ────────────────────────────────────────────────
  // A held run means one of two very different things to the owner: "review and
  // approve this" (a sign-off) or "answer this question" (an ask-human fork — the
  // decide-vs-ask carve-out in .claude/agents/pi-operating-contract.md). Reporting
  // both as "held for sign-off" tells the owner to APPROVE when what is actually
  // needed is an ANSWER — the gate asserting a state it never distinguished (#1751).
  // The ask-human template's mandatory first line is the discriminator.
  // WHAT does the hold need? (#2067) The `🔀 Blocked` heading is a FAMILY marker —
  // it cannot tell "pick A or B" from "apply this patch, I'm not allowed to". Reading
  // only the heading is how #2054 announced "asked you a question" above 4,372
  // characters that contained no question: a workflow-only fix the App token cannot
  // push (#1076), which needs the owner to ACT, not to answer.
  // The `**Needs:** answer | action | approval` line is the explicit discriminator.
  // Absent ⇒ 'answer', which is exactly today's behaviour, so older holds are unaffected.
  // Keep the COMMENT OBJECT, not just its body (#2096): the notification below
  // links the ask directly, so the owner is one tap from it instead of scroll-
  // hunting a long thread on a phone for "the 🔀 comment above".
  const { holdComment, holdKind } = parseHold(comments)
  const askedQuestion = signoffHeld && holdKind === 'answer'
  const needsAction = signoffHeld && holdKind === 'action'

  if (linkedPR || signoffHeld || alreadyClosed || createdSubIssues || leafDispatched) {
    core.info(`Artifact-gate OK for #${issue_number}: linkedPR=${linkedPR} signoffHeld=${signoffHeld} askedQuestion=${askedQuestion} alreadyClosed=${alreadyClosed} createdSubIssues=${createdSubIssues} leafDispatched=${leafDispatched}`)
    // Result-comment-back (#1017) — only on a label-triggered run (a human is watching the
    // issue). This comment posts as the Harness App (nuxt-harness[bot]) — an unmistakable
    // bot account — so it uses the agent-pipeline provenance header, NOT the @pmcp disclaimer.
    if (env.TRIGGER === 'issues') {
      const what = describeDeliverable({ prRefs, sinceMs, holdComment, needsAction, askedQuestion, createdSubIssues, leafDispatched, signoffHeld })
      await github.rest.issues.createComment({
        ...context.repo, issue_number,
        body: '<!-- pipeline-note -->\n' + `> 🤖 **pi.dev harness** · agent pipeline (CI · ${env.AGENT_RUNNER_LABEL}) · _via the \`${context.payload.label?.name || 'delegate'}\` label_\n\n${what}`,
      })
    }
    return
  }

  // ── CHILD deliverables (#1074) ─────────────────────────────────────────────
  // When the labeled issue is ALREADY decomposed, the correct behaviour is
  // "resume the tree, work the remaining open leaf" — the fresh deliverable
  // lands on a CHILD issue, invisible to the checks above (the #1050 false-fail:
  // pi merged a real PR on child #1053 and this gate still went red). Scan the
  // sub-issue tree for the same fresh-since-t0 signals. Only runs when the
  // primary checks found nothing. Kept in sync with decompose-on-issue-pidev.yml.
  const childDeliverable = await findChildDeliverable({ github, context, core, issue_number, since, sinceMs })
  if (childDeliverable) {
    core.info(`Artifact-gate OK for #${issue_number} via child deliverable: ${childDeliverable}`)
    if (env.TRIGGER === 'issues') {
      await github.rest.issues.createComment({
        ...context.repo, issue_number,
        body: '<!-- pipeline-note -->\n' + `> 🤖 **pi.dev harness** · agent pipeline (CI · ${env.AGENT_RUNNER_LABEL}) · _via the \`${context.payload.label?.name || 'delegate'}\` label_\n\nresumed the existing tree → ${childDeliverable}`,
      })
    }
    return
  }

  // ── Classify WHY there was no deliverable (#1004 piece 3) ──────────────────
  // pi emits no structured execution_file like claude-code-action — it emits the
  // plain-text run log we tee'd to PI_EXEC_LOG. Grep it for the known causes so the
  // failure comment names the actual problem + fix (mirrors decompose-on-issue-pidev.yml's
  // billing/error/underspecified buckets). The most likely first-run cause is an
  // out-of-credit PI_PROVIDER_KEY, so detect that explicitly.
  const failed = env.CLAUDE_CONCLUSION === 'failure'
  const { why, action, detail } = classifyNoDeliverable({ env, fs, core, failed })
  // Readable-on-mobile (epic #1336, .github/CI-MESSAGE-STYLE.md): lead with the problem
  // + the one fix; the gate name / #461 / run link live in the footer; depth collapses.
  const body = failureBody({ why, action, detail, context, env })

  await github.rest.issues.createComment({ ...context.repo, issue_number, body: '<!-- pipeline-note -->\n' + body })
  core.setFailed(`Artifact-gate: pi.dev run on #${issue_number} produced no deliverable.`)
}

// Fresh deliverable on a CHILD issue (#1074); '' when none.
async function findChildDeliverable({ github, context, core, issue_number, since, sinceMs }) {
  let childDeliverable = ''
  try {
    const subs = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      ...context.repo, issue_number, per_page: 100,
    })
    for (const s of subs) {
      if (s.state === 'closed' && s.closed_at && new Date(s.closed_at).getTime() >= sinceMs) {
        childDeliverable = `child #${s.number} closed this run`; break
      }
      const tl = await github.paginate(github.rest.issues.listEventsForTimeline, {
        ...context.repo, issue_number: s.number,
      })
      if (tl.some(e => e.event === 'cross-referenced' && e.source && e.source.issue &&
          e.source.issue.pull_request && new Date(e.created_at).getTime() >= sinceMs)) {
        childDeliverable = `PR linked to child #${s.number} this run`; break
      }
      const childBlocked = hasLabel(s.labels, 'status:blocked')
      if (childBlocked) {
        const cc = await github.paginate(github.rest.issues.listComments, {
          ...context.repo, issue_number: s.number, since,
        })
        if (cc.length > 0) { childDeliverable = `child #${s.number} held for sign-off this run`; break }
      }
    }
  } catch (e) { core.warning(`child-deliverable check skipped: ${e.message}`) }
  return childDeliverable
}

// Name WHY there was no deliverable by grepping the pi run log (#1004).
function classifyLog(log, failed) {
  const tail = log.length > 600 ? log.slice(-600) : log
  const t = tail.trim()
  const glmReset = (log.match(/reset at ([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:]+)/i) || [])[1]
  // GLM quota (z.ai 429) is checked FIRST: distinct from Anthropic billing (#1451/#1492).
  if (/\b1308\b|usage limit reached/i.test(log)) {
    return { why: 'the GLM Coding Plan quota was reached mid-run'
      + (glmReset ? ` (the plan window resets at ${glmReset})` : ' (z.ai 5-hour / weekly window)'),
    action: 'wait for that window to reset then re-dispatch on GLM (free), '
      + 'or escalate this one leaf to the metered `provider=anthropic` lane to unblock now — '
      + 'this is NOT a code/SDK bug, nothing is broken', detail: '' }
  }
  if (/credit balance is too low|insufficient.*(credit|balance|quota)|billing/i.test(log)) {
    // not "enable auto-reload" — owner declined it (#1327)
    return { why: 'the Anthropic key (`PI_PROVIDER_KEY`) is out of credit', action: 'top up the account, then re-dispatch', detail: '' }
  }
  if (failed) return { why: 'the pi agent step errored before it built anything', action: 'open the run log, fix the SDK/tooling error, then re-dispatch', detail: t }
  if (/PI_TASK_COMPLETE_NOTHING_LEFT/.test(log)) {
    // #2104 — deliberate 'nothing left' conclusion; usual cause is a stale thread (#2037).
    return { why: 'pi deliberately concluded there was NOTHING left to do and ended without saying so on the issue (`PI_TASK_COMPLETE_NOTHING_LEFT` in the log)',
      action: 'the thread probably reads as stale — re-read the newest 🔀 hold and any "blocked on #X" claim; if the blocker is resolved or the hold answered, reply stating the current state, then re-dispatch (#2104)', detail: t }
  }
  // LAST RESORT (#1876): say we could not explain it, and attach the tail (#2065).
  return { why: 'pi ran to completion but no PR, sub-issues, or sign-off hold appeared — and none of the known causes matched',
    action: 'read the log tail below first — it is what pi actually said. Only if it shows pi genuinely had nothing to act on is the issue underspecified', detail: t }
}

function classifyNoDeliverable({ env, fs, core, failed }) {
  let res = { why: '', action: '', detail: '' }
  let hadLog = false
  try {
    hadLog = Boolean(env.PI_EXEC_LOG) && fs.existsSync(env.PI_EXEC_LOG)
    if (hadLog) res = classifyLog(fs.readFileSync(env.PI_EXEC_LOG, 'utf8'), failed)
  } catch (e) { core.warning(`artifact-gate: could not read pi run log: ${e.message}`) }
  // No log at all (#2065): the harness stopped before pi wrote output.
  if (!res.why && !hadLog) {
    res.why = 'pi produced NO run log at all — the harness stopped before pi wrote any output'
    res.action = 'do not edit the issue. Open the run log and read the steps BEFORE the agent step; '
      + 'an absent `PI_EXEC_LOG` means the failure is upstream of pi, in the workflow'
  }
  // Log unreadable but the step itself failed.
  if (!res.why && failed) {
    res.why = 'the pi agent step failed before producing anything (likely out of credit, or an API/tooling error)'
    res.action = 'open the run log — if it says "credit balance is too low", top up `PI_PROVIDER_KEY`; otherwise fix the logged error, then re-dispatch'
  }
  return res
}

// The one-line "what did this run produce" text for the result comment (#1017/#1745/#2096).
function describeDeliverable({ prRefs, sinceMs, holdComment, needsAction, askedQuestion, createdSubIssues, leafDispatched, signoffHeld }) {
  const freshPR = prRefs
    .filter(e => new Date(e.created_at).getTime() >= sinceMs)
    .map(e => e.source.issue.number)[0]
  if (freshPR) return `done → PR #${freshPR}`
  // holdComment is non-null on both hold branches (holdKind requires a non-empty holdBody).
  if (needsAction) return `**needs you to APPLY something** — not an answer, not an approval. **[→ the ask](${holdComment.html_url})** says what to do and why the agent could not; the patch is collapsed under it. Comment here when applied and the work resumes in a fresh run.`
  if (askedQuestion) return `**asked you a question** — it needs an *answer*, not an approval. **[→ the ask](${holdComment.html_url})** leads with the recommendation; reply with your pick and the work resumes in a fresh run.`
  if (createdSubIssues) return 'decomposed → sub-issues created (see the tree)'
  if (leafDispatched) return 'classified as a leaf → handed to the `work-this` worker (its PR lands in a separate run)'
  if (signoffHeld) return 'held for sign-off (`status:blocked` + a review)'
  return 'produced a deliverable — see the run'
}

// Which 🔀 hold (if any) and what it needs (#2067): the `**Needs:** answer|action|approval`
// line; absent ⇒ 'answer'. Keep the comment object so the notification can link it (#2096).
function parseHold(comments) {
  const holdComment = comments.find(c => /^##\s*🔀\s*Blocked\b/m.test(c.body || '')) || null
  const holdBody = holdComment ? (holdComment.body || '') : ''
  const needs = (holdBody.match(/^\s*\*\*Needs:\*\*\s*(answer|action|approval)\b/mi) || [])[1]
  return { holdComment, holdKind: holdBody ? (needs ? needs.toLowerCase() : 'answer') : null }
}

function hasLabel(labels, name) {
  return (labels || []).some(l => (typeof l === 'string' ? l : l.name) === name)
}

function workThisLabeledSince(timeline, sinceMs) {
  return timeline.some(e =>
    e.event === 'labeled' && e.label && e.label.name === 'work-this' &&
    new Date(e.created_at).getTime() >= sinceMs
  )
}

async function subIssuesCreatedSince({ github, context, core, issue_number, sinceMs }) {
  try {
    const subs = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      ...context.repo, issue_number, per_page: 100,
    })
    return subs.some(s => new Date(s.created_at).getTime() >= sinceMs)
  } catch (e) { core.warning(`sub-issue check skipped: ${e.message}`); return false }
}

// Readable-on-mobile (CI-MESSAGE-STYLE.md): problem + the one fix lead; depth collapses.
function failureBody({ why, action, detail, context, env }) {
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  const foot = `\n\n<sub>🤖 pi.dev harness (CI · ${env.AGENT_RUNNER_LABEL}) · artifact-gate #461 fails a no-op run so it isn't mistaken for done · <a href="${runUrl}">run log</a></sub>`
  const det = detail ? `\n\n<details><summary>log tail</summary>\n\n\`\`\`\n${detail}\n\`\`\`\n</details>` : ''
  return why
    ? `🔴 **@pmcp — this run produced nothing: ${why}.**\n\n**Fix:** ${action}.${det}${foot}`
    : `🔴 **@pmcp — this run produced nothing** — no PR, no sub-issues, no sign-off hold, and none of the known causes matched.\n\n**Fix:** open the run log before changing anything. Only if the log shows the agent genuinely had nothing to act on is the issue underspecified.${foot}`
}
