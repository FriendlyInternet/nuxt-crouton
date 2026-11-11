// The PR status comment logic behind .github/workflows/status.yml's `pr-comment` job (#3617):
// the sticky CI note, the red / sign-off pings and the epic card. Moved out of a 467-line inline
// script so it can be tested; the workflow step only calls runStatus(). GitHub I/O over an injected
// `github`/`core` (same shape as v1-merge-io.mjs); the pure rendering lives in pr-status.mjs.
import { liveCheckRuns, needsLiveFilter } from './required-check-state.mjs'
import { causesOf, redNoteAction, statusScope, rollupChildNote } from './red-note.mjs'
import { fixBotWillTry, redPingHeading } from './fix-bot-dispatch.mjs'
import { uiTouchedFromFiles } from '../ui-touched.mjs'
import { hasCaptureEvidence } from './review-captures.mjs'
import {
  PR_STICKY, EPIC_ROLLUP, labelNames, stamp, tallyCi, renderSticky, failureList, failureExcerpts, logTailBlock,
  fixBotFailures, renderRedPing, signoffPingBody, withheldBody, epicCard, prSourceSha, epicFromIssue,
} from './pr-status.mjs'

export async function runStatus({ github, context, core, owner: OWNER = 'pmcp' }) {
  const { owner, repo } = context.repo
  const now = stamp()

  // Upsert a marker-tagged comment: edit the existing one in place, else create.
  async function upsert(issue_number, marker, body) {
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number, per_page: 100 })
    const existing = comments.find(c => (c.body || '').includes(marker))
    if (existing) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number, body })
    }
  }

  // Aggregate every check-run + commit-status for a SHA into one verdict.
  async function ciState(ref) {
    let runs = await github.paginate(github.rest.checks.listForRef,
      { owner, repo, ref, per_page: 100 })
    // #2950: ignore check-runs of a CI run a newer run on this commit replaced.
    let wfRuns = null
    // #3453: only read workflow runs when a finished red/cancelled check-run exists.
    const readWf = needsLiveFilter(runs)
    if (readWf) {
      try {
        wfRuns = await github.paginate(github.rest.actions.listWorkflowRunsForRepo,
          { owner, repo, head_sha: ref, per_page: 100 })
        runs = liveCheckRuns(runs, wfRuns)
      } catch (e) { core.warning(`live check-runs for ${ref}: ${e.message}`) }
    }
    core.info(`workflow-runs read: ${readWf ? 'yes (red/cancelled check present, #2950)' : 'no (no red check)'}`)
    let statuses = []
    try {
      statuses = (await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref })).data.statuses || []
    } catch (e) { core.warning(`combined status for ${ref}: ${e.message}`) }
    return { ...tallyCi({ checkRuns: runs, statuses }), wfRuns }
  }

  // One sticky status note on the pipeline PR.
  async function updatePr(pr) {
    const st = await ciState(pr.head.sha)
    const body = renderSticky({ st, pr, now })
    await upsert(pr.number, PR_STICKY, body)
    if (st.word === 'failing') await pingOnRed(pr, st)
    const epicMatch = /^epic\/(\d+)-/.exec(pr.base.ref)
    if (epicMatch) await updateEpic(Number(epicMatch[1]))
  }

  // One-shot red note on a fresh failure — the ONLY loud signal (#1815). A red pipeline
  // PR won't auto-merge into its epic (automerge-epic-subpr.yml leaves it open), so it
  // needs the owner. Keyed by head SHA so a re-fired check_suite for the SAME commit
  // never re-pings; a new failing commit (new SHA) does. Mentions don't fire on comment
  // EDITS, so this is a distinct create guarded by the SHA marker (never the sticky).
  async function pingOnRed(pr, st) {
    const marker = `<!-- ci-fail-ping:${pr.head.sha} -->`
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number: pr.number, per_page: 100 })
    // Already pinged this SHA? The @MENTION stays one-shot (a mention doesn't re-fire on
    // an edit, so re-creating would be pure spam) — but the BODY is refreshed below if
    // more checks have gone red since (#2029). Checks finish minutes apart: on PR #2025
    // the ping fired naming one failure and `Type Check Apps` went red 42s later, so the
    // owner was left reading a permanently understated count while the sticky comment
    // said three. A stale loud signal is worse than a quiet accurate one.
    const existing = comments.find(c => (c.body || '').includes(marker))
    // Name the failing checks (#1909) AND quote what actually went wrong (#2015).
    // Names alone still meant leaving the notification, opening the checks tab, picking
    // a job and scrolling a log — on a phone that is the entire task.
    //
    // `CI Gate` / `E2E Gate` are AGGREGATES (`if: always()` over 14 needs). It is never an
    // independent cause; naming it beside the real failure doubles the apparent problem
    // and sends the reader to a log that only says "not every job succeeded". Drop it
    // whenever something else is red — but keep it when it is the ONLY red check, since
    // that means something genuinely different (a needed job cancelled or stuck).
    const all = st.failing || []
    const act = redNoteAction({ scope: statusScope({ head: pr.head.ref, base: pr.base.ref }), failing: all, existingForSha: !!existing })
    if (act === 'skip') return
    const rest = causesOf(all)
    const causes = rest.length ? rest : all // #2950: never "0 failing checks"
    const { names, list } = failureList(causes)

    // The distilled failure: a step's `::error::` output becomes a check-run annotation,
    // which is already the short form of the log. Two per check, truncated — enough to
    // diagnose, collapsed so the notification itself stays scannable.
    //
    // FILTER BY LEVEL (#2029). `listAnnotations` returns `notice`/`warning`/`failure`
    // together, in creation order — and CI emits its noise first (the Node-20
    // deprecation notice, "no files found for playwright-report/"). Taking the first two
    // of ANY level therefore quoted two things that did not fail, under a heading that
    // said "what failed". Fetch a page, keep the failures. Fall back to any level only
    // when a check produced no failure annotation at all, and say so, so a reader is
    // never told a warning is the cause.
    const entries = []
    for (const f of names) {
      if (!f.id) continue // a commit status has no annotations
      try {
        const anns = (await github.rest.checks.listAnnotations(
          { owner, repo, check_run_id: f.id, per_page: 50 })).data
        entries.push({ name: f.name, annotations: anns })
      } catch (e) { core.warning(`annotations for ${f.name}: ${e.message}`) }
    }
    const why = failureExcerpts(entries)
    return quoteJobLogs({ pr, st, marker, existing, causes, names, list, why })
  }

  // Step 2 of pingOnRed: quote the end of each failing job's log.
  async function quoteJobLogs({ pr, st, marker, existing, causes, names, list, why }) {
    // The actual end of each failing job's log (#2677): annotations are often noise or
    // absent (a deploy failure has none). For Actions checks the check-run id IS the job
    // id. Fenced, so no @mention in a log can ping. Any failure to fetch is skipped.
    let tails = ''
    let budget = 20000
    try {
      for (const f of names.slice(0, 3)) {
        if (!f.id || budget <= 0) continue
        try {
          const res = await github.rest.actions.downloadJobLogsForWorkflowRun(
            { owner, repo, job_id: f.id })
          const raw = typeof res.data === 'string' ? res.data : String(res.data || '')
          const tail = logTailBlock({ name: f.name, raw, budget })
          if (!tail) continue
          budget -= tail.used
          tails += tail.block
        } catch (e) { core.warning(`log tail for ${f.name}: ${e.message}`) }
      }
    } catch (e) { core.warning(`log-tail helper unavailable: ${e.message}`) }
    return sendRedPing({ pr, st, marker, existing, causes, list, why, tails })
  }

  // Step 3 of pingOnRed: pick the wording from the fix-bot decision, then create or refresh the note.
  async function sendRedPing({ pr, st, marker, existing, causes, list, why, tails }) {
    // #3622: never mentions the owner; the decision only picks the wording. The
    // decision is the same pure function the fix-ci gate runs (scripts/lib/fix-bot-dispatch.mjs).
    let dec
    try {
      const runs = st.wfRuns ?? await github.paginate(github.rest.actions.listWorkflowRunsForRepo,
        { owner, repo, head_sha: pr.head.sha, per_page: 100 })
      const failures = fixBotFailures(causes, runs)
      dec = fixBotWillTry({ head: pr.head.ref, base: pr.base.ref, state: pr.state, labels: labelNames(pr), failures })
    } catch (e) {
      core.warning(`fix-bot decision unavailable: ${e.message}`)
      dec = { who: 'owner', code: 'unknown', reason: "couldn't tell whether the auto-fix will try", attempts: 0 }
    }
    const hd = redPingHeading({ who: dec.who === 'none' ? 'owner' : dec.who, reason: dec.reason,
      attempts: dec.attempts, mode: dec.mode, count: causes.length, list, head: pr.head.ref, base: pr.base.ref })
    const body = renderRedPing({ marker, hd, why, tails, pr })
    if (existing) {
      if ((existing.body || '').trim() === body.trim()) return // nothing new to say
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
      core.info(`Refreshed the red ping on #${pr.number} (${causes.length} failing now).`)
      return
    }
    await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body })
    core.info(`Red ping on #${pr.number} (${pr.head.sha.slice(0, 7)}): no mention (decision: ${dec.code}).`)
  }

  // #2135: one-shot @mention the moment an epic shows "Awaiting your sign-off" — the
  // rollup card above is silent otherwise, so a fresh sign-off hold produced ZERO signal
  // an owner would notice (three real PRs — #2132/#2133/#2134 — sat unpinged until asked
  // about directly). Keyed by epic number only, deduped like pingOnRed's SHA marker: a
  // repeat status refresh on the SAME still-held epic must never re-ping. Known
  // limitation, accepted deliberately: if this epic is unblocked and later blocked again
  // by a second, unrelated hold, it will NOT re-ping — pingOnRed's per-SHA key can afford
  // per-instance precision because a SHA changes; a sign-off hold has no equally cheap
  // "which instance" signal, and a false skip here is safe (the rollup card still shows
  // it), while spamming on every sweep re-evaluation would not be.
  async function pingOnSignoffHold(epicNumber, title) {
    const marker = `<!-- signoff-ping:${epicNumber} -->`
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number: epicNumber, per_page: 100 })
    if (comments.some(c => (c.body || '').includes(marker))) return // already pinged this hold
    const body = signoffPingBody({ epicNumber, owner: OWNER, title })
    await github.rest.issues.createComment({ owner, repo, issue_number: epicNumber, body })
    core.info(`Pinged @${OWNER} on fresh sign-off hold for epic #${epicNumber}.`)
  }

  // #2171: never ASK for a visual sign-off the flow can't SHOW. Read the PR's OWN
  // committed files (not a body claim — the #1849 rule). `isVisual` uses the SAME rule as
  // work-issue-pidev.yml (scripts/ui-touched.mjs, #3228): script-only .vue is not visual.
  // Old-side text is read at the MERGE BASE (patch line numbers refer to it, not
  // pr.base.sha). Any error → visual (fail toward holding). `hasEvidence` = a capture
  // = a review-capture screenshot comment on the PR (#3351).
  async function visualEvidenceState(prNumber) {
    const files = await github.paginate(github.rest.pulls.listFiles,
      { owner, repo, pull_number: prNumber, per_page: 100 })
    let isVisual = true
    try {
      const pr = (await github.rest.pulls.get({ owner, repo, pull_number: prNumber })).data
      const cmp = await github.rest.repos.compareCommits(
        { owner, repo, base: pr.base.sha, head: pr.head.sha, per_page: 1 })
      const mergeBase = cmp.data.merge_base_commit.sha
      const readText = async (ref, path) => {
        const r = await github.rest.repos.getContent({ owner, repo, path,
          ref: ref === 'head' ? pr.head.sha : mergeBase,
          mediaType: { format: 'raw' } })
        return typeof r.data === 'string' ? r.data : null
      }
      isVisual = (await uiTouchedFromFiles(files, readText)) === 1
    } catch (e) {
      core.warning(`visual check failed, treating as visual: ${e.message}`)
    }
    // One rule (#3351): a bot comment tagged review-capture that embeds a raw image.
    let hasEvidence = false
    try {
      hasEvidence = hasCaptureEvidence(await github.paginate(github.rest.issues.listComments,
        { owner, repo, issue_number: prNumber, per_page: 100 }))
    } catch (e) {
      core.warning(`capture-evidence check failed, treating as none: ${e.message}`)
    }
    return { isVisual, hasEvidence }
  }

  // A visual PR with NO capture must not become a sign-off ASK — that sends the owner to
  // approve a surface the flow never showed them (#2057). Say so ONCE, and do NOT
  // @mention: there is no action for the owner here — closing the gap (a capture, or a
  // real preview of the changed surface) is the flow's job. When a capture later lands,
  // pingOnSignoffHold fires normally (its marker is independent of this one), so this
  // self-heals rather than wedging the PR.
  async function withholdSignoffNoCapture(epicNumber, prNumber, title) {
    const marker = `<!-- signoff-withheld-nocapture:${epicNumber} -->`
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number: epicNumber, per_page: 100 })
    if (comments.some(c => (c.body || '').includes(marker))) return
    const body = withheldBody({ epicNumber, prNumber, title })
    await github.rest.issues.createComment({ owner, repo, issue_number: epicNumber, body })
    core.info(`Withheld sign-off for epic #${epicNumber}: visual PR #${prNumber} has no capture.`)
  }

  // A live flow-status CARD on the epic (#1838) — stage + child tree + current activity,
  // computed deterministically from sub-issue state + each child's work-<n> PR. Replaces
  // the old thin count line. Renders even with 0 children (the sign-off / decompose stages).
  async function updateEpic(epicNumber) {
    let subs = []
    try {
      subs = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
        { owner, repo, issue_number: epicNumber, per_page: 100 })
    } catch (e) { core.warning(`sub-issues for #${epicNumber}: ${e.message}`) }

    let epic
    try { epic = (await github.rest.issues.get({ owner, repo, issue_number: epicNumber })).data }
    catch (e) { core.warning(`epic #${epicNumber}: ${e.message}`); return }
    const names = x => (x.labels || []).map(l => (typeof l === 'string' ? l : l.name))
    const epicBlocked = names(epic).includes('status:blocked')
    const title = (epic.title || '').replace(/^(Epic|Initiative):\s*/i, '').trim()

    // Newest work-<n> PR for a child (bounded — a handful of children per epic).
    async function childPr(n) {
      try {
        const prs = await github.paginate(github.rest.pulls.list,
          { owner, repo, state: 'all', head: `${owner}:work-${n}`, per_page: 10 })
        return prs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
      } catch { return null }
    }

    // Child tree lines.
    const lines = []
    for (const s of subs) {
      await pushChildLine(s)
    }
    async function pushChildLine(s) {
      let icon = '⏳', note = 'queued'
      if (s.state === 'closed') { icon = '✅'; note = '' }
      // Two different holds, two different asks (#2083): `blocked` wants a reply,
      // `needs-merge` wants the merge button. A rollup that shows both as "held"
      // tells the owner to go find out which — the thing the split exists to avoid.
      else if (names(s).includes('status:blocked')) { icon = '⏸️'; note = 'held — needs your reply' }
      else if (names(s).includes('status:needs-merge')) { icon = '🔀'; note = 'green — needs your merge' }
      else {
        const pr = await childPr(s.number)
        if (pr && pr.state === 'open') {
          const cst = await ciState(pr.head.sha)
          ;({ icon, note } = rollupChildNote({ pr, failing: cst.failure ? cst.failing : [] }))
        } else {
          const r = rollupChildNote({ pr })
          if (r) ({ icon, note } = r)
        }
      }
      lines.push(`- ${icon} #${s.number} ${s.title}${note ? ` — ${note}` : ''}`)
    }

    // Stage bar / headline / activity text come from epicCard() (pr-status.mjs): 0 children +
    // blocked ⇒ sign-off · 0 + open ⇒ decomposing · some open ⇒ build · all closed ⇒ assembled.
    const card = epicCard({ title, epicBlocked, subs, childLines: lines, now })
    if (card.needsSignoffCheck) {
      await askForSignoff()
    }
    async function askForSignoff() {
      // #2156: only ASK for sign-off once the held PR is actually reviewable — its CI
      // is green. Pinging the instant the draft opens asks for a decision that can't be
      // made yet: on #2156 the sign-off ping fired 4 minutes BEFORE CI went red on a
      // real type error, so the owner got "needs your sign-off" and "CI failed" back to
      // back. A red or still-running draft is the red-ping's / fix-bot's job, not a
      // sign-off ask. This re-fires on the next CI-completion event (workflow_run,
      // above), so a later green still pings — and the signoff-ping marker keeps it
      // one-shot. A design-only hold (#1821) has no work-<n> PR yet and already
      // @mentions the owner at creation (apply-decompose-plan.mjs), so skipping it here
      // avoids a double-ping rather than dropping a signal.
      if (epicBlocked) {
        const heldPr = await childPr(epicNumber)
        if (!heldPr) {
          core.info(`epic #${epicNumber}: sign-off hold with no work-<n> PR (design hold?) — owner already @mentioned at creation; not double-pinging.`)
        } else {
          const heldSt = await ciState(heldPr.head.sha)
          if (heldSt.word !== 'passing') {
            core.info(`epic #${epicNumber}: held PR #${heldPr.number} CI is ${heldSt.word} — deferring sign-off ping until green.`)
          } else {
            // Green — but never ASK for a visual sign-off the flow can't SHOW (#2171/#2057).
            const vis = await visualEvidenceState(heldPr.number)
            if (vis.isVisual && !vis.hasEvidence) await withholdSignoffNoCapture(epicNumber, heldPr.number, title)
            else await pingOnSignoffHold(epicNumber, title)
          }
        }
      }
    }

    const body = card.body
    await upsert(epicNumber, EPIC_ROLLUP, body)
  }

  // ── issues event (#1838): a child closed/reopened → refresh its epic's card ──
  // Resolve the epic: the issue itself if it has sub-issues, else its parent via the
  // WS2 pipeline block (`<!-- pipeline: epic=N … -->`) in the body.
  if (context.eventName === 'issues') {
    return refreshEpicForIssue()
  }
  async function refreshEpicForIssue() {
    const issue = context.payload.issue
    let hasSubs = false
    try {
      const own = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
        { owner, repo, issue_number: issue.number, per_page: 1 })
      hasSubs = own.length > 0
    } catch (e) { /* not an epic */ }
    const epicNum = epicFromIssue({ hasSubs, body: issue.body, number: issue.number })
    if (epicNum) { await updateEpic(epicNum); core.info(`Refreshed epic card #${epicNum} (issues:${context.payload.action}).`) }
    else core.info(`#${issue.number} is not a pipeline epic/child — nothing to do.`)
    return
  }

  // Resolve candidate PR numbers from whatever event fired.
  const prNumbers = new Set()
  if (context.eventName === 'pull_request') {
    prNumbers.add(context.payload.pull_request.number)
  } else {
    await addAssociatedPrs()
  }
  async function addAssociatedPrs() {
    // `workflow_run` first — it is the only one of the three that actually fires for
    // our Actions-generated checks (#1884). It also carries `pull_requests`, but that
    // array is empty for a run from a fork, so resolve by head SHA like the others.
    const sha = prSourceSha(context.payload)
    if (sha) {
      const assoc = await github.paginate(
        github.rest.repos.listPullRequestsAssociatedWithCommit,
        { owner, repo, commit_sha: sha, per_page: 100 })
      assoc.forEach(p => prNumbers.add(p.number))
    }
  }
  if (!prNumbers.size) { core.info('No associated PRs — nothing to do.'); return }

  for (const pull_number of prNumbers) {
    let pr
    try { pr = (await github.rest.pulls.get({ owner, repo, pull_number })).data } catch { continue }
    if (pr.state !== 'open') continue
    // Pipeline-authored branches: the pi pipeline (`work-*`; `claude/issue-*` dropped in #2891). The pi branches were silently skipped before #1815, so no pi
    // worker PR ever got a status note — the main reason the owner saw no signal at all.
    const scope = statusScope({ head: pr.head.ref, base: pr.base.ref })
    if (scope === 'epic') {
      // epic → main (#3006): failure note only when a gate is red; no sticky, no rollup.
      await pingOnRed(pr, await ciState(pr.head.sha))
      core.info(`Checked red note for epic PR #${pull_number}.`); continue
    }
    if (scope !== 'leaf') {
      core.info(`#${pull_number} head ${pr.head.ref} is not a pipeline branch — skipping.`); continue
    }
    await updatePr(pr)
    core.info(`Updated sticky status for #${pull_number}.`)
  }
}
