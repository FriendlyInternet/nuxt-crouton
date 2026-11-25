// The merge-on-approval I/O behind .github/workflows/on-comment.yml `resume › mergegate` (#572, #1663, #4038).
// Moved out of the inline script so the check wait can be tested: the owner's `ok` merged #3942 with
// CI Gate red, because the App token bypasses the ruleset and the step read no checks. The rules live
// in pr-merge-gate.mjs (gateMergeDecision, checksHeldNote); this file only reads and writes GitHub.
import { liveCheckRuns, needsLiveFilter, requiredCheckState, isDone, RED_CONCLUSIONS } from './required-check-state.mjs'
import { withoutMergeDecision, gateMergeDecision, checksHeldNote } from './pr-merge-gate.mjs'

/** { ciGate, red } for a head SHA — the same reads as pr-status-io.mjs ciState(). A failed check-run read is 'missing' (never a merge). */
export async function readGateChecks({ github, core, owner, repo, sha }) {
  let runs
  try {
    runs = await github.paginate(github.rest.checks.listForRef, { owner, repo, ref: sha, per_page: 100 })
  } catch (e) {
    core.warning(`check-runs for ${sha}: ${e.message}`)
    return { ciGate: 'missing', red: [] }
  }
  if (needsLiveFilter(runs)) {
    try {
      const wf = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, head_sha: sha, per_page: 100 })
      runs = liveCheckRuns(runs, wf)
    } catch (e) { core.warning(`live check-runs for ${sha}: ${e.message}`) }
  }
  runs = withoutMergeDecision(runs)
  const red = runs.filter((r) => isDone(r) && RED_CONCLUSIONS.includes(r.conclusion)).map((r) => ({ name: r.name, conclusion: r.conclusion }))
  try {
    const statuses = (await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha })).data.statuses || []
    for (const s of statuses) if (['failure', 'error'].includes(s.state)) red.push({ name: s.context, conclusion: s.state })
  } catch (e) { core.warning(`combined status for ${sha}: ${e.message}`) }
  return { ciGate: requiredCheckState(runs, 'CI Gate'), red }
}

// Prose fallback for the link (#1663): Closes/Fixes/Resolves/Sub-issue/Refs #N at line start.
export const linkRe = (issue_number) => new RegExp(
  String.raw`^[\s>*_-]*(closes?d?|fix(e[sd])?|resolves?d?|sub-?issue|refs?)\b[\s:*_-]*#${issue_number}\b`, 'im')

async function linkReason({ github, context, core }, pr, issue_number) {
  // (1) GitHub's own linked-issue relation — wording-proof.
  try {
    const q = await github.graphql(
      `query($owner:String!,$repo:String!,$n:Int!){
         repository(owner:$owner,name:$repo){
           pullRequest(number:$n){
             closingIssuesReferences(first:20){ nodes{ number } } } } }`,
      { owner: context.repo.owner, repo: context.repo.repo, n: pr.number })
    const linked = (q?.repository?.pullRequest?.closingIssuesReferences?.nodes || []).map((x) => x.number)
    if (linked.includes(issue_number)) return 'linked-issue relation'
  } catch (e) { core.warning(`closingIssuesReferences #${pr.number}: ${e.message}`) }
  // (2) Prose fallback.
  if (linkRe(issue_number).test(pr.body || '')) return 'body reference'
  return null
}

/** Cross-referenced PR numbers on an issue's timeline. */
export async function crossReferencedPrs({ github, context }, issue_number) {
  const timeline = await github.paginate(github.rest.issues.listEventsForTimeline, { ...context.repo, issue_number })
  return [...new Set(timeline
    .filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request)
    .map((e) => e.source.issue.number))]
}

async function openPr({ github, context }, n) {
  try {
    const pr = (await github.rest.pulls.get({ ...context.repo, pull_number: n })).data
    return pr.state === 'open' && !pr.merged ? pr : null
  } catch { return null }
}

/** One candidate's answer: { merge, skip?, checks?, how }. Checks are read only after link and base pass. */
async function decideCandidate(io, pr, issue_number) {
  const { github, context, core } = io
  const how = await linkReason(io, pr, issue_number)
  const pre = gateMergeDecision({ pr, linkReason: how, ciGate: 'success', red: [], issue: issue_number })
  if (pre.skip) return { ...pre, how }
  const { ciGate, red } = await readGateChecks({ github, core, ...context.repo, sha: pr.head?.sha })
  return { ...gateMergeDecision({ pr, linkReason: how, ciGate, red, issue: issue_number }), how }
}

/** Mark ready (REST can't flip draft→ready; GraphQL can), then merge commit. Returns a skip string on failure. */
async function mergePr({ github, context, core }, pr, how) {
  const n = pr.number
  if (pr.draft) {
    try {
      await github.graphql(
        `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest { id } } }`,
        { id: pr.node_id })
    } catch (e) { core.warning(`markReady #${n}: ${e.message}`) }
  }
  try {
    await github.rest.pulls.merge({ ...context.repo, pull_number: n, merge_method: 'merge' })
    core.info(`Merged gate PR #${n} into ${pr.base.ref} (matched via ${how}).`)
    return null
  } catch (e) {
    core.warning(`merge #${n} failed: ${e.message}`)
    return `#${n} — matched via ${how}, but the merge failed: ${e.message}`
  }
}

// Clear the block ONLY on a real merge (#1665): a miss must keep status:blocked so a re-approval still triggers.
async function finish({ github, context, core }, issue_number, merged, checkSkips) {
  if (merged) {
    try { await github.rest.issues.removeLabel({ ...context.repo, issue_number, name: 'status:blocked' }) } catch { /* already gone */ }
    return core.info('Gate PR merged — schedule-waves will advance the chain.')
  }
  if (checkSkips.length) {
    try {
      await github.rest.issues.createComment({ ...context.repo, issue_number, body: checksHeldNote(issue_number, checkSkips) })
    } catch (e) { core.warning(`checks-held note: ${e.message}`) }
  }
  core.info('No gate PR merged — leaving status:blocked ON so a re-approval can still trigger.')
}

/** Find the issue's gate PR(s), merge each one whose checks are green. Returns { merged, skipped: string[] }. */
export async function runGateMerge(io) {
  const issue_number = io.context.payload.issue.number
  let merged = false
  const skipped = []
  const checkSkips = []
  for (const n of await crossReferencedPrs(io, issue_number)) {
    const pr = await openPr(io, n)
    if (!pr) continue
    const d = await decideCandidate(io, pr, issue_number)
    if (d.merge) {
      const failed = await mergePr(io, pr, d.how)
      if (failed) skipped.push(failed)
      else merged = true
      continue
    }
    if (d.skip) { skipped.push(d.skip); io.core.info(d.skip) }
    if (d.checks) checkSkips.push(d.skip)
  }
  await finish(io, issue_number, merged, checkSkips)
  return { merged, skipped }
}
