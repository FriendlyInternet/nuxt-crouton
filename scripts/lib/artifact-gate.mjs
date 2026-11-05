// The pi worker's artifact-gate (#461), moved out of work-issue-pidev.yml's inline `script:` (#3382):
// GitHub rejects a whole workflow file once an expression-bearing string passes 21,000 chars, and
// the inline gate was 20.8k. Loaded from the $RUNNER_TEMP snapshot of scripts/lib, never the workspace.
import nodeFs from 'node:fs'
import { execFileSync as nodeExecFileSync } from 'node:child_process'
import { parseRunStart } from './run-start.mjs'
import { decideDeliverable, pushedThisRun } from './run-deliverable.mjs'

export async function artifactGate({ github, context, core, env = process.env, fs = nodeFs, execFileSync = nodeExecFileSync }) {
  const issue_number = Number(env.ISSUE_NUMBER)
  if (env.CONFLICT_ASKED === '1') { core.info('Merge conflict put to the owner on the PR — artifact OK (#2848)'); return }
  if (env.CONFLICT_FAILED === '1') { core.setFailed('Merge conflict resolution failed — explained on the PR (#3322).'); return }
  if (env.PLAN_OK === '1') { core.info('Plan comment verified — artifact OK (#2755).'); return }
  if (env.REVISE_CONFLICT === '1') { core.setFailed('Revision not pushed: the PR changed during the run — explained on the PR (#2446).'); return }
  if (env.REVISED === '1') { core.info('Revision delivered on the PR (commit or reply) — artifact OK (#2446).'); return }
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
  const blocked = issue.data.labels.some(l => (typeof l === 'string' ? l : l.name) === 'status:blocked')
  const alreadyClosed = issue.data.state === 'closed'

  let createdSubIssues = false
  try {
    const subs = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      ...context.repo, issue_number, per_page: 100,
    })
    createdSubIssues = subs.some(s => new Date(s.created_at).getTime() >= sinceMs)
  } catch (e) { core.warning(`sub-issue check skipped: ${e.message}`) }

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
  const holdComment = comments.find(c => /^##\s*🔀\s*Blocked\b/m.test(c.body || '')) || null
  const holdBody = holdComment ? (holdComment.body || '') : ''
  const needs = (holdBody.match(/^\s*\*\*Needs:\*\*\s*(answer|action|approval)\b/mi) || [])[1]
  const holdKind = holdBody ? (needs ? needs.toLowerCase() : 'answer') : null
  const askedQuestion = signoffHeld && holdKind === 'answer'
  const needsAction = signoffHeld && holdKind === 'action'

  // #3219: a commit pushed to work-<N> THIS run is a deliverable even when the PR already
  // existed (its cross-reference predates t0, so linkedPR is false). A failed finish step
  // is still a failure, handled in the classifier below.
  let workBranch = null
  try {
    const ref = await github.rest.git.getRef({ ...context.repo, ref: `heads/work-${issue_number}` })
    const commit = await github.rest.git.getCommit({ ...context.repo, commit_sha: ref.data.object.sha })
    const committedAt = new Date(commit.data.committer?.date || 0).getTime()
    // Only a commit from THIS run counts (as on main); an older branch is not a deliverable
    // and must not feed the harness-failure verdict below.
    if (committedAt >= sinceMs) workBranch = { sha: ref.data.object.sha.slice(0, 7), committedAt }
  } catch (e) { /* no such branch — the ordinary "nothing was built" case */ }

  const workBranchPushed = pushedThisRun({ committedAt: workBranch ? workBranch.committedAt : null, sinceMs, finishOutcome: env.FINISH_OUTCOME })

  const deliverable = decideDeliverable({ linkedPR, workBranchPushed, signoffHeld, alreadyClosed, createdSubIssues })
  if (deliverable.ok) {
    core.info(`Artifact-gate OK for #${issue_number}: linkedPR=${linkedPR} signoffHeld=${signoffHeld} askedQuestion=${askedQuestion} alreadyClosed=${alreadyClosed} createdSubIssues=${createdSubIssues} workBranchPushed=${workBranchPushed} via=${deliverable.via}`)
    // Result-comment-back (#1017) — only on a label-triggered run (a human is watching the
    // issue). This comment posts as the Harness App (nuxt-harness[bot]) — an unmistakable
    // bot account — so it uses the agent-pipeline provenance header, NOT the @pmcp disclaimer.
    if (env.TRIGGER === 'issues') {
      const freshPR = prRefs
        .filter(e => new Date(e.created_at).getTime() >= sinceMs)
        .map(e => e.source.issue.number)[0]
      // Link the ask itself (#2096) — holdComment is guaranteed non-null on both
      // hold branches (holdKind requires a non-empty holdBody).
      const what = freshPR
        ? `done → PR #${freshPR}`
        : workBranchPushed ? `pushed a commit to \`work-${issue_number}\` (existing PR updated)`
        : needsAction ? `**needs you to APPLY something** — not an answer, not an approval. **[→ the ask](${holdComment.html_url})** says what to do and why the agent could not; the patch is collapsed under it. Comment here when applied and the work resumes in a fresh run.`
        : askedQuestion ? `**asked you a question** — it needs an *answer*, not an approval. **[→ the ask](${holdComment.html_url})** leads with the recommendation; reply with your pick and the work resumes in a fresh run.`
        : (createdSubIssues ? 'decomposed → sub-issues created (see the tree)'
          : signoffHeld ? 'held for sign-off (`status:blocked` + a review)'
          : 'produced a deliverable — see the run')
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
  // primary checks found nothing. Kept in sync with decompose-on-issue.yml.
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
      const childBlocked = (s.labels || []).some(l => (typeof l === 'string' ? l : l.name) === 'status:blocked')
      if (childBlocked) {
        const cc = await github.paginate(github.rest.issues.listComments, {
          ...context.repo, issue_number: s.number, since,
        })
        if (cc.length > 0) { childDeliverable = `child #${s.number} held for sign-off this run`; break }
      }
    }
  } catch (e) { core.warning(`child-deliverable check skipped: ${e.message}`) }
  if (decideDeliverable({ childDeliverable }).ok) {
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
  // failure comment names the actual problem + fix (mirrors decompose-on-issue.yml's
  // billing/error/underspecified buckets). The most likely first-run cause is an
  // out-of-credit PI_PROVIDER_KEY, so detect that explicitly.
  let why = '', action = '', detail = ''
  const failed = env.CLAUDE_CONCLUSION === 'failure'

  // ── HARNESS-FAILED-AFTER-COMMITTING (#1876) — checked FIRST ────────────────
  // The gate's evidence used to be {pi's exit code, pi's stdout, the GitHub API}. The
  // FINISH step was invisible to it, so when the finish step crashed after pushing a
  // branch, every real cause missed and the run fell through to the `else` below and
  // told the owner their ISSUE was underspecified — while a branch with their work sat
  // on the remote (#1874/#1875). A pushed `work-<issue>` branch is proof the agent
  // produced something; the only thing missing is the PR the harness died before opening.
  if (workBranch && env.FINISH_OUTCOME === 'failure') {
    why = `the HARNESS failed after committing — \`work-${issue_number}\` (\`${workBranch.sha}\`) was pushed this run, but the finish step died before opening the PR`
    action = 'open the run log at the `finish` step — this is a workflow bug, NOT an underspecified issue. '
      + 'Do not edit the issue; fix the workflow, delete the branch, and re-apply the label'
  }

  try {
    const logFile = env.PI_EXEC_LOG
    // `!why` — never let the log-grep chain overwrite the harness-failure verdict above,
    // whose evidence (a pushed branch + a failed finish step) is stronger than a regex (#1876).
    if (!why && logFile && fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8')
      const tail = log.length > 600 ? log.slice(-600) : log
      // GLM Coding Plan quota (z.ai) — checked FIRST: its 429 is distinct from an
      // Anthropic billing failure and must not fall through to the generic SDK-error
      // bucket (the #1451/#1492 misdiagnosis). z.ai emits `429 {"code":"1308",
      // "message":"Usage limit reached for 5 hour. Your limit will reset at <ts>"}`.
      const glmReset = (log.match(/reset at ([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:]+)/i) || [])[1]
      if (/\b1308\b|usage limit reached/i.test(log)) {
        why = 'the GLM Coding Plan quota was reached mid-run'
          + (glmReset ? ` (the plan window resets at ${glmReset})` : ' (z.ai 5-hour / weekly window)')
        action = 'wait for that window to reset then re-dispatch on GLM (free), '
          + 'or escalate this one leaf to the metered `provider=anthropic` lane to unblock now — '
          + 'this is NOT a code/SDK bug, nothing is broken'
      } else if (/credit balance is too low|insufficient.*(credit|balance|quota)|billing/i.test(log)) {
        why = 'the Anthropic key (`PI_PROVIDER_KEY`) is out of credit'
        action = 'top up the account, then re-dispatch' // NB: not "enable auto-reload" — owner declined it (#1327); the pi-key-canary workflow tracks key health
      } else if (env.PI_LEFT_DIRTY === '1') {
        // #1764: pi edited files but the DETERMINISTIC finish step still could not
        // persist them — a git/tooling failure, not the narrate-then-stop fault (which
        // the finish step handles). Name it accurately, not "underspecified".
        why = 'the deterministic finish step could not persist pi\'s edits (a git/tooling failure, not the narrate-then-stop fault) — the working tree is still dirty (#1764)'
        action = 'open the run log — the finish step logged the git error; this is NOT an underspecified issue (see #1764)'
      } else if (failed) {
        why = 'the pi agent step errored before it built anything'
        action = 'open the run log, fix the SDK/tooling error, then re-dispatch'
        if (tail.trim()) detail = tail.trim()
      } else if (env.FINISH_OUTCOME === 'failure') {
        // The finish step failed but pushed nothing — still a harness fault, not the ticket.
        why = 'the finish step failed before it could commit anything'
        action = 'open the run log at the `finish` step — a workflow bug, not an underspecified issue'
        if (tail.trim()) detail = tail.trim()
      } else if (/PI_TASK_COMPLETE_NOTHING_LEFT/.test(log)) {
        // #2104 — pi DELIBERATELY concluded nothing was left to do (the completion-
        // enforcer's escape marker, .pi/extensions/complete-work.ts) and ended without
        // saying so on the issue. The usual cause is a STALE THREAD: an old 🔀 hold, or
        // a "blocked on #X" note whose blocker has since closed — on #2037, #2070 was
        // fixed 4h earlier and nothing updated the thread pi read. The contract now
        // requires pi to verify cited blockers live and to post its nothing-left
        // conclusion as a hold; this bucket names an occurrence that slipped through.
        why = 'pi deliberately concluded there was NOTHING left to do and ended without saying so on the issue (`PI_TASK_COMPLETE_NOTHING_LEFT` in the log)'
        action = 'the thread probably reads as stale — re-read the newest 🔀 hold and any "blocked on #X" claim; if the blocker is resolved or the hold answered, reply stating the current state (e.g. "#X is closed — proceed with option A"), then re-dispatch (#2104)'
        if (tail.trim()) detail = tail.trim()
      } else {
        // LAST RESORT — no known cause matched. Say exactly that (#1876). The old text
        // asserted "the issue is likely underspecified", which is a GUESS printed in the
        // same confident voice as the real detections above; it sent the owner to rewrite
        // two well-specified tickets while the actual bug was in this workflow.
        why = 'pi ran to completion but no PR, sub-issues, or sign-off hold appeared — and none of the known causes matched'
        action = 'read the log tail below first — it is what pi actually said. Only if it shows pi genuinely had nothing to act on is the issue underspecified'
        // ATTACH THE TAIL HERE ABOVE ALL (#2065). This branch means "I cannot explain
        // this run", and it was the ONLY branch that withheld the log — while sitting
        // inside `if (exists(logFile))`, so the log was read and then dropped. Three
        // alarms (#2055/#2056/#2058) were undiagnosable from outside the runner for
        // exactly this reason, each telling the owner to "open the run log" while the
        // relevant slice of it sat in `tail`.
        if (tail.trim()) detail = tail.trim()
      }
    }
  } catch (e) { core.warning(`artifact-gate: could not read pi run log: ${e.message}`) }

  // #2012 — the finish step FAILED, and that verdict must not depend on pi's log
  // existing. This same check also lives inside the `if (logFile && exists(logFile))`
  // chain above, which is exactly where it cannot help: when the harness dies early pi
  // never runs, so PI_EXEC_LOG is empty, the whole chain is skipped, and the branch that
  // would name this is unreachable. That is how run 31057590885 reported "none of the
  // known causes matched" while its own env said FINISH_OUTCOME=failure. #1876's detector
  // misses it too — that one requires a commit made THIS run, and a harness that dies
  // before committing has none by definition.
  if (!why && env.FINISH_OUTCOME === 'failure') {
    why = 'the finish step FAILED — the harness could not process this run'
    action = 'open the run log at the `finish` step and read its error (a non-zero plan exit prints the stderr tail there). '
      + 'This is a WORKFLOW bug, not an underspecified issue — do not edit the ticket'
  }

  // #1764 fallback — an uncommitted tree is a definite cause even if the log is unreadable.
  if (!why && env.PI_LEFT_DIRTY === '1') {
    why = 'the deterministic finish step could not persist pi\'s edits — the working tree is still dirty (#1764)'
    action = 'open the run log for the finish step git error; not an underspecified issue (see #1764)'
  }

  // No log at all (#2065). "Open the run log" is misleading advice when the run
  // never wrote one — and an empty PI_EXEC_LOG is itself evidence: the harness
  // stopped before pi produced any output. Distinguish the two situations.
  let hadLog = false
  try { hadLog = Boolean(env.PI_EXEC_LOG) && fs.existsSync(env.PI_EXEC_LOG) } catch (e) { hadLog = false }
  if (!why && !hadLog) {
    why = 'pi produced NO run log at all — the harness stopped before pi wrote any output'
    action = 'do not edit the issue. Open the run log and read the steps BEFORE the agent step; '
      + 'an absent `PI_EXEC_LOG` means the failure is upstream of pi, in the workflow'
  }

  // Fallback when the log is unreadable but the step itself failed.
  if (!why && failed) {
    why = 'the pi agent step failed before producing anything (likely out of credit, or an API/tooling error)'
    action = 'open the run log — if it says "credit balance is too low", top up `PI_PROVIDER_KEY`; otherwise fix the logged error, then re-dispatch'
  }

  // Readable-on-mobile (epic #1336, .github/CI-MESSAGE-STYLE.md): lead with the problem
  // + the one fix; the gate name / #461 / run link live in the footer; depth collapses.
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  const foot = `\n\n<sub>🤖 pi.dev harness (CI · ${env.AGENT_RUNNER_LABEL}) · artifact-gate #461 fails a no-op run so it isn't mistaken for done · <a href="${runUrl}">run log</a></sub>`
  // #2464: quote pi's own last words — often the whole explanation ("nothing left to do").
  let piSaid = ''
  try {
    piSaid = execFileSync('node',
      [`${env.RUNNER_TEMP}/run-record.mjs`, 'last-message', `${env.RUNNER_TEMP}/pi-session`, '500'],
      { encoding: 'utf8' }).trim()
  } catch (e) { piSaid = '' }
  if (piSaid) core.error(piSaid, { title: "pi's last message" })
  const said = piSaid ? `\n\n**pi's last message:**\n> ${piSaid.replace(/\n/g, '\n> ')}` : ''
  const det = detail ? `\n\n<details><summary>log tail</summary>\n\n\`\`\`\n${detail}\n\`\`\`\n</details>` : ''
  const body = why
    ? `🔴 **@pmcp — this run produced nothing: ${why}.**\n\n**Fix:** ${action}.${said}${det}${foot}`
    : `🔴 **@pmcp — this run produced nothing** — no PR, no sub-issues, no sign-off hold, and none of the known causes matched.\n\n**Fix:** open the run log before changing anything. Only if the log shows the agent genuinely had nothing to act on is the issue underspecified.${said}${foot}`

  await github.rest.issues.createComment({ ...context.repo, issue_number, body: '<!-- pipeline-note -->\n' + body })
  core.setFailed(`Artifact-gate: pi.dev run on #${issue_number} produced no deliverable.`)
}
