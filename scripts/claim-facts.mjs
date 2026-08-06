#!/usr/bin/env node
// claim-facts.mjs — the READ side of the claim guard (#1890), extracted so the two pi lanes
// share one implementation (#2027).
//
// WHY THIS FILE EXISTS. The facts-gathering lived as a byte-identical `github-script` block
// inside BOTH `work-issue-pidev.yml` and `decompose-on-issue-pidev.yml`. That duplication is
// how the #2027 wedge got half-fixed: the worker's copy was repaired and the decomposer's kept
// the bug, so an epic hit exactly the refusal the worker no longer had. Two copies of a guard
// is one guard and one liability.
//
// The DECISION stays in `pipeline-loop-guard.mjs` (`decideClaim`) — pure and unit-tested. This
// module only turns the GitHub API into the facts that decision consumes, and it is unit-tested
// too (claim-facts.test.mjs) against a fake `github` client, because its two subtle fields are
// exactly the ones that were missing:
//
//   • `self.pr`   — the PR on `work-<issue>` is THIS pipeline's own branch, not a competitor.
//                   `resolveLane()` (#2010) routes a re-dispatch to the worker *because* that
//                   branch exists; without this the guard then refuses the lane chosen for it.
//   • `baseRef`   — our topology is `work-<n>` → `epic/<n>-<slug>` → `main`. A sub-PR merging
//                   into its EPIC branch is mid-flight, not landed. Treating it as landed
//                   refused #1791 permanently, and would refuse every epic-topology issue the
//                   moment its first sub-PR merged.

/** Does this PR body reference the issue with a closing keyword? */
export function referencesIssue(body, issueNumber) {
  const re = new RegExp(`(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\\s+#${issueNumber}\\b`, 'i')
  return re.test(String(body || ''))
}

/**
 * Gather the claim facts for one issue.
 *
 * @param {object}  o
 * @param {object}  o.github        an Octokit-shaped client (the `github` global in github-script)
 * @param {object}  o.context       the github-script `context`
 * @param {number}  o.issueNumber
 * @param {object} [o.core]         optional logger; only `warning` is used
 * @returns {Promise<object>} the shape `decideClaim` consumes
 */
export async function gatherClaimFacts({ github, context, issueNumber, core }) {
  const { owner, repo } = context.repo
  const warn = (m) => (core?.warning ? core.warning(m) : console.warn(m))

  const { data: issue } = await github.rest.issues.get({ owner, repo, issue_number: issueNumber })

  const q = `repo:${owner}/${repo} is:pr ${issueNumber} in:body`
  const { data: found } = await github.rest.search.issuesAndPullRequests({ q, per_page: 20 })

  // The search API returns neither head nor base ref, so each candidate is fetched. Both refs
  // are load-bearing (see the header), and the candidate list is small — at most 20, usually 1.
  const linkedPRs = []
  let selfPr = null
  for (const it of found.items || []) {
    if (!referencesIssue(it.body, issueNumber)) continue
    let headRef = null
    let baseRef = null
    let merged = Boolean(it.pull_request?.merged_at)
    try {
      const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: it.number })
      headRef = pr.head?.ref ?? null
      baseRef = pr.base?.ref ?? null
      merged = Boolean(pr.merged_at)
    } catch (e) {
      // Leave baseRef null. `decideClaim` then treats a merge as landed — the safer
      // pre-#2027 default, so an unreachable API cannot silently UNLOCK an issue.
      warn(`claim facts: could not fetch PR #${it.number} (${e.message})`)
    }
    if (headRef === `work-${issueNumber}`) selfPr = it.number
    linkedPRs.push({ number: it.number, state: it.state, merged, headRef, baseRef })
  }

  // When `status:in-progress` was applied — the weakest signal, so it needs its timestamp.
  let inProgressSince = null
  const hasInProgress = (issue.labels || []).some((l) => (l.name || l) === 'status:in-progress')
  if (hasInProgress) {
    const events = await github.paginate(github.rest.issues.listEvents,
      { owner, repo, issue_number: issueNumber, per_page: 100 })
    const last = events.filter((e) => e.event === 'labeled' && e.label?.name === 'status:in-progress').pop()
    inProgressSince = last?.created_at || null
  }

  return {
    issueState: issue.state,
    linkedPRs,
    inProgressSince,
    now: new Date().toISOString(),
    defaultBranch: context.payload?.repository?.default_branch || 'main',
    self: { pr: selfPr },
  }
}
