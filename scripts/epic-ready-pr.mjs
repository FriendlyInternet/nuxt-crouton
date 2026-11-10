#!/usr/bin/env node
// epic-ready-pr.mjs — the GitHub I/O executor for the `epic-ready-pr` job in
// .github/workflows/on-issue-close.yml (#3619, moved verbatim out of the inline script so it is
// testable; #3452 keeps decisions out of workflow YAML). The pure decisions live in epic-ready.mjs.
// Functions take the github-script `{ github, context, core }` (same shape as wave-release.mjs).
import { parsePipelineBlock } from './pipeline-context.mjs'
import { parseEpicNumber, decideOpen, resolveEpicTarget, packagesApprovalCarry, closesNumbers, collectApprovalLines, buildEpicMainPr } from './epic-ready.mjs'

/**
 * Resolve (epicNumber, epicBranch) from either the closed child's pipeline block
 * or a manual dispatch's branch input. When no block/epic is recorded, default
 * epicNumber to the closed issue's OWN number — mirrors the EPIC="${EPIC:-$ISSUE}"
 * convention every other pipeline step uses for a solo leaf dispatched directly via
 * `work-this` (#1686) rather than through a real multi-child epic. Resolution must
 * not depend on the pipeline block surviving to close-time — empirically it often
 * doesn't (#2152).
 * Returns { epicNumber, epicBranch, closedIssueNumber, blockEpicNumber } or { skip }.
 */
export async function resolveEpicAndBranch({ github, context, core }, { dispatchBranch } = {}) {
  const { owner, repo } = context.repo
  let epicNumber, epicBranch, closedIssueNumber = null, blockEpicNumber = null
  if (context.eventName === 'workflow_dispatch') {
    epicBranch = dispatchBranch
    epicNumber = parseEpicNumber(epicBranch)
    if (!epicNumber) { core.info(`could not resolve an epic number from ${epicBranch}; skip.`); return { skip: 'no epic number' } }
  } else {
    const closed = context.payload.issue
    closedIssueNumber = closed.number
    const block = parsePipelineBlock(closed.body || '')
    blockEpicNumber = block.epic
    epicNumber = block.epic ?? closed.number
    epicBranch = block.epic_branch
  }

  // Fall back to matching-refs if the block carried no branch (older children, or a
  // solo leaf whose block never persisted).
  if (!epicBranch) {
    try {
      const refs = await github.paginate('GET /repos/{owner}/{repo}/git/matching-refs/heads/{prefix}',
        { owner, repo, prefix: `epic/${epicNumber}-` })
      epicBranch = refs[0] ? refs[0].ref.replace('refs/heads/', '') : null
    } catch (e) { core.warning(`matching-refs epic/${epicNumber}-: ${e.message}`) }
  }
  if (!epicBranch) { core.info(`no epic branch for #${epicNumber}; skip.`); return { skip: 'no epic branch' } }
  return { epicNumber, epicBranch, closedIssueNumber, blockEpicNumber }
}

/**
 * Gather every merged sub-PR into the epic branch with its files/comments/reviews (#2494).
 * Any lookup failure warns and returns what was collected so far.
 */
export async function gatherCarryInput({ github, core, context }, epicBranch) {
  const { owner, repo } = context.repo
  const carryInput = []
  try {
    const merged = (await github.paginate(github.rest.pulls.list,
      { owner, repo, state: 'closed', base: epicBranch, per_page: 100 })).filter(p => p.merged_at)
    for (const p of merged) {
      const files = (await github.paginate(github.rest.pulls.listFiles,
        { owner, repo, pull_number: p.number, per_page: 100 })).map(f => f.filename)
      const comments = []
      const pick = c => comments.push({ login: c.user?.login, body: c.body })
      ;(await github.paginate(github.rest.issues.listComments,
        { owner, repo, issue_number: p.number, per_page: 100 })).forEach(pick)
      for (const n of closesNumbers(p.body)) {
        try {
          ;(await github.paginate(github.rest.issues.listComments,
            { owner, repo, issue_number: n, per_page: 100 })).forEach(pick)
        } catch (e) { core.warning(`comments on #${n} (closed by #${p.number}): ${e.message}`) }
      }
      const reviews = (await github.paginate(github.rest.pulls.listReviews,
        { owner, repo, pull_number: p.number, per_page: 100 })).map(r => ({ login: r.user?.login, state: r.state }))
      carryInput.push({ number: p.number, files, comments, reviews })
    }
  } catch (e) { core.warning(`sub-PR approval gather for ${epicBranch}: ${e.message} — the shared-code check will ask`) }
  return carryInput
}

function adjustForSoloLeaf({ core, epicNumber, closedIssueNumber, blockEpicNumber, subIssues }) {
  if (closedIssueNumber === null || epicNumber !== closedIssueNumber) return subIssues
  const { isSolo } = resolveEpicTarget({ closedIssueNumber, blockEpicNumber, subIssueCount: subIssues.length })
  if (!isSolo) { core.info(`#${closedIssueNumber} is a genuine epic (${subIssues.length} sub-issue(s)) — closed via /close-epic, not here; skip.`); return null }
  core.info(`#${closedIssueNumber} is a solo leaf (its own epic branch, no real sub-issues) — treating its own closure as the completion signal.`)
  return [{ number: closedIssueNumber, state: 'closed' }]
}

export async function runEpicReadyPr({ github, context, core }, { ownerLogin, dispatchBranch } = {}) {
  const { owner, repo } = context.repo
  const OWNER = ownerLogin || 'pmcp'

  const r = await resolveEpicAndBranch({ github, context, core }, { dispatchBranch })
  if (r.skip) return
  const { epicNumber, epicBranch, closedIssueNumber, blockEpicNumber } = r

  // 1) the epic's DIRECT sub-issues
  let subIssues = []
  try {
    subIssues = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner, repo, issue_number: epicNumber, per_page: 100 })
  } catch (e) { core.warning(`sub-issues for #${epicNumber}: ${e.message}`); return }

  // #2152: a genuine multi-child epic that closed directly (not via a sub-issue's PR
  // merging) is NOT this workflow's job — it closes via /close-epic (#856), so keep the
  // original skip. But a SOLO leaf using itself as its own integration branch (#1686) also
  // resolves epicNumber to its own number, with zero real sub-issues — that used to be
  // indistinguishable from the genuine-epic case and always skipped. Treat it as its
  // epic's one completed child instead.
  const adjusted = adjustForSoloLeaf({ core, epicNumber, closedIssueNumber, blockEpicNumber, subIssues })
  if (adjusted === null) return
  subIssues = adjusted

  // 2) any existing OPEN epic→main PR (idempotency guard)
  const existing = await github.paginate(github.rest.pulls.list,
    { owner, repo, state: 'open', head: `${owner}:${epicBranch}`, base: 'main', per_page: 100 })

  // 3) commits the epic branch is ahead of main
  let aheadCount = 0
  try {
    const cmp = (await github.rest.repos.compareCommitsWithBasehead(
      { owner, repo, basehead: `main...${epicBranch}` })).data
    aheadCount = cmp.ahead_by || 0
  } catch (e) { core.warning(`compare main...${epicBranch}: ${e.message}`); return }

  const { open, reason } = decideOpen({ subIssues, existingEpicMainPrs: existing, aheadCount })
  core.info(`epic #${epicNumber} (${epicBranch}): ${open ? 'OPEN' : 'skip'} — ${reason}`)
  if (!open) return

  // ── Shared-code sign-off carry (#2494) ─────────────────────────────────────────
  // #2481 failed "Packages edit declared" although the owner had approved all four
  // sub-PRs, and the attestation line had to be added by hand. Gather every merged
  // sub-PR into this epic branch; for the ones that touched packages/**, look for the
  // owner's approval on the PR (comment or APPROVED review) or on its `Closes #NN`
  // issue. The decision is the pure, unit-tested packagesApprovalCarry(); only the
  // fetching lives here. Any lookup failure degrades to "not approved" (the guard then
  // asks, as before) — never to a false declaration.
  // NOTE: a mid-loop throw keeps earlier approved PRs — see #3619 test
  const epicBody = (await github.rest.issues.get({ owner, repo, issue_number: epicNumber })).data.body || ''
  const carryInput = await gatherCarryInput({ github, context, core }, epicBranch)
  const carry = packagesApprovalCarry({ subPrs: carryInput, owner: OWNER })
  core.info(`packages sign-off carry: touched=${JSON.stringify(carry.packagesPrs)} approved=${JSON.stringify(carry.approved)} unapproved=${JSON.stringify(carry.unapproved)}`)
  // #2748: approvals already written as `Packages-approved:` lines on the epic or its
  // children are copied too (de-duplicated), so a hand-approved epic passes the guard.
  const declared = collectApprovalLines([epicBody, ...subIssues.map(s => s.body)])

  // Reference the epic WITHOUT closing it (postmortem gate, #856).
  const epic = (await github.rest.issues.get({ owner, repo, issue_number: epicNumber })).data
  const { title, body } = buildEpicMainPr({ epicNumber, epicBranch, epicTitle: epic.title, subIssues, carry, declared, owner: OWNER })

  let pr
  try {
    pr = (await github.rest.pulls.create({ owner, repo, head: epicBranch, base: 'main', title, body })).data
  } catch (e) { core.setFailed(`create epic→main PR failed: ${e.message}`); return }
  core.info(`Opened epic→main PR #${pr.number} (${epicBranch} → main).`)

  try {
    await github.rest.pulls.requestReviewers({ owner, repo, pull_number: pr.number, reviewers: [OWNER] })
    core.info(`Requested review from @${OWNER}.`)
  } catch (e) { core.warning(`requestReviewers @${OWNER}: ${e.message}`) }
}
