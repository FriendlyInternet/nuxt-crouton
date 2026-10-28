// The wave scheduler's GitHub-facing half (#283, folded by #2893). Pure decisions live in
// wave-gate.mjs; this file does the reads/writes, so on-issue-close.yml, on-pr-close.yml and
// schedule-waves.yml (the CI-finished retry) share ONE release codepath.
//
// Every function takes the github-script globals: `{ github, context, core }`.
import * as gate from './wave-gate.mjs'

/** Collapse an epic branch's CI into success | failure | pending | unknown. */
async function branchStatus({ github, context, core }, ref) {
  if (!ref) return 'unknown'
  const { owner, repo } = context.repo
  try {
    const runs = await github.paginate(github.rest.checks.listForRef, { owner, repo, ref, per_page: 100 })
    return gate.summarizeChecks(runs)
  } catch (e) {
    // Never let a status lookup stall the chain — an unreadable ref is `unknown`, which releases.
    core.warning(`check lookup failed for ${ref}: ${e.message}`)
    return 'unknown'
  }
}

/** The `epic/*` branch a closed issue's PR landed on, or null. */
async function epicBranchOf({ github, context, core }, issue_number) {
  const { owner, repo } = context.repo
  try {
    const tl = await github.paginate(github.rest.issues.listEventsForTimeline, { owner, repo, issue_number, per_page: 100 })
    const prs = [...new Set(tl
      .filter(e => e.event === 'cross-referenced' && e.source?.issue?.pull_request)
      .map(e => e.source.issue.number))]
    for (const n of prs) {
      const pr = (await github.rest.pulls.get({ owner, repo, pull_number: n })).data
      if (pr.merged_at && /^epic\//.test(pr.base.ref)) return pr.base.ref
    }
  } catch (e) { core.warning(`epic-branch lookup failed for #${issue_number}: ${e.message}`) }
  return null
}

/**
 * Release every open dependent whose blockers are all closed — gated on its epic branch not
 * being red. Shared by the issue-closed path and the CI-green retry.
 */
export async function releaseReady(ctx, { onlyBlockedBy = null, branch = null } = {}) {
  const { github, context, core } = ctx
  const { owner, repo } = context.repo
  const q = `repo:${owner}/${repo} is:issue is:open in:body "Blocked-by:"`
  const found = await github.paginate(github.rest.search.issuesAndPullRequests, { q, per_page: 100 })

  for (const it of found) {
    const blockers = gate.parseBlockers(it.body)
    if (!blockers.length) continue
    if (onlyBlockedBy && !blockers.includes(onlyBlockedBy)) continue

    const blockerStates = []
    for (const b of blockers) {
      const bi = await github.rest.issues.get({ owner, repo, issue_number: b })
      blockerStates.push(bi.data.state)
    }

    // Which branch does this work land on? On the retry path we already know.
    const ref = branch ?? await epicBranchOf(ctx, blockers[blockers.length - 1])
    const status = ref ? await branchStatus(ctx, ref) : 'unknown'

    // `body` feeds releaseLabel (#1923): a child the decomposer created records the trigger label
    // it would have been dispatched with, so a blocked LEAF goes straight to its worker.
    const decision = gate.shouldRelease({ blockerStates, labels: it.labels, branchStatus: status, body: it.body })
    if (!decision.release) {
      core.info(`#${it.number}: ${decision.reason}`)
      if (decision.reason === 'branch-red') {
        const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: it.number, per_page: 100 })
        if (!comments.some(c => (c.body || '').includes(gate.HOLD_MARKER))) {
          await github.rest.issues.createComment({ owner, repo, issue_number: it.number,
            body: gate.formatHoldComment({ issueNumber: it.number, branch: ref, doneNumber: onlyBlockedBy ?? blockers[blockers.length - 1] }) })
        }
      }
      continue
    }

    const releaseWith = decision.label || 'delegate'
    await github.rest.issues.addLabels({ owner, repo, issue_number: it.number, labels: [releaseWith] })
    await github.rest.issues.createComment({ owner, repo, issue_number: it.number,
      body: gate.formatReleaseComment({ doneNumber: onlyBlockedBy ?? blockers[blockers.length - 1], branchStatus: status, label: releaseWith }) })
    core.info(`Released #${it.number} with ${releaseWith} (${decision.reason})`)
  }
}

/** CI finished on a branch → re-scan, releasing anything held for a red epic branch. */
export async function retryOnCiFinished(ctx) {
  const { context, core } = ctx
  const wr = context.payload.workflow_run
  if (!/^epic\//.test(wr.head_branch || '')) {
    core.info(`CI finished on '${wr.head_branch}' (not an epic branch) — nothing to retry.`); return
  }
  if (wr.conclusion !== 'success') {
    core.info(`CI on ${wr.head_branch} concluded '${wr.conclusion}' — still not releasable.`); return
  }
  core.info(`CI green on ${wr.head_branch} — retrying held waves.`)
  await releaseReady(ctx, { branch: wr.head_branch })
}

/**
 * A merged PR closes its `Closes #NN` issues. Sub-PRs merge into the EPIC branch, so GitHub does
 * NOT auto-close them (auto-close is default-branch only) — close them here; the resulting
 * `issues: closed` event drives the release path (one release codepath).
 */
export async function closeLinkedIssues(ctx) {
  const { github, context, core } = ctx
  const { owner, repo } = context.repo
  const pr = context.payload.pull_request
  if (!pr.merged) { core.info('PR closed unmerged — nothing to do.'); return }

  // #1021 defence-in-depth: only act on merges into the default branch or an epic/* branch.
  const base = pr.base.ref
  const defaultBranch = context.payload.repository.default_branch
  if (base !== defaultBranch && !/^epic\//.test(base)) {
    core.info(`PR merged into '${base}' (not ${defaultBranch}/epic/*) — not a close-driving merge.`); return
  }

  // #1021 root fix: match `Closes #NN` the way GitHub's native auto-close does — NEVER inside
  // code (the #839 incident: a quoted example closed a real issue).
  const prose = (pr.body || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const closes = [...prose.matchAll(/\bCloses\s+#(\d+)/gi)].map(x => Number(x[1]))
  if (!closes.length) { core.info('Merged PR has no `Closes #NN` (in prose) — nothing to do.'); return }
  for (const n of closes) {
    try {
      const gi = await github.rest.issues.get({ owner, repo, issue_number: n })
      if (gi.data.state === 'closed') continue
      // #1035: never auto-close a HELD issue — `status:blocked` means a human step is pending.
      const held = gi.data.labels.some(l => (typeof l === 'string' ? l : l.name) === 'status:blocked')
      if (held) { core.info(`#${n} is status:blocked (held for a human) — NOT auto-closing.`); continue }
      await github.rest.issues.update({ owner, repo, issue_number: n, state: 'closed', state_reason: 'completed' })
      core.info(`Closed #${n} (its PR merged into ${base}) — release runs on the issues:closed event.`)
    } catch (e) { core.warning(`Could not close #${n}: ${e.message}`) }
  }
}
