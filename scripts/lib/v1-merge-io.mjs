/**
 * #3501 — the GitHub writes of the v1 merge path, kept out of the workflow's inline script
 * (the inline-size gate: a baselined block may not grow). Plain functions over an injected `github`.
 */
import { execFileSync } from 'node:child_process'
import { chooseOkReply } from './ok-reply.mjs'
import { mergeDecisionCheck, MERGE_DECISION, decideV1, shouldEnableAuto, canMergeNow } from './pr-merge-gate.mjs'

export const isRateLimit = (e) => e.status === 429 || String(e.response?.headers?.['x-ratelimit-remaining']) === '0' || /rate limit/i.test(e.message || '')

const AUTO = (kind) => kind === 'enable'
  ? 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }'
  : 'mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }'

/** Turn GitHub auto-merge on/off for a PR (throws on API refusal — the caller decides what it means). */
export const setAutoMerge = (github, pr, kind) => github.graphql(AUTO(kind), { id: pr.node_id })

/** Write `answer` as the required `Merge decision` check; no-op when the newest run already says it. Returns 'same'|'updated'|'created'. */
export async function publishMergeDecision({ github, owner, repo, pr, rawRuns, appSlug, answer }) {
  const payload = mergeDecisionCheck(answer)
  const mine = rawRuns.filter(r => r.name === MERGE_DECISION && r.app?.slug === appSlug).sort((a, b) => b.id - a.id)[0]
  if (mine && mine.status === payload.status && mine.conclusion === payload.conclusion && mine.output?.title === payload.output.title) return 'same'
  if (mine && mine.status !== 'completed') {
    await github.rest.checks.update({ owner, repo, check_run_id: mine.id, status: payload.status, conclusion: payload.conclusion, output: payload.output })
    return 'updated'
  }
  await github.rest.checks.create({ owner, repo, head_sha: pr.head.sha, ...payload })   // newest run of a name counts
  return 'created'
}

/**
 * The merge/hold/notice writes shared by the v1 and today's paths (moved out of the workflow's inline script).
 * `env` is process.env (FLOW_TOKEN for the checklist tick).
 */
export function makeMergeIo({ github, core, owner, repo, env }) {
    // #2904: two merges into the same base seconds apart — the second gets HTTP 405
    // "Base branch was modified". Retry that (only that) a few times; any other error is final.
    // #3210 — tick "Merged" on the ticket's flow checklist (cosmetic; default-branch script).
    // v1 PRs are ticked by on-pr-close.yml instead (#3501), whoever merges them.
    async function tickMerged(pr) {
      try {
        const { issueFromPrBody } = await import('../flow-checklist.mjs')
        const closes = issueFromPrBody(pr.body || '')
        if (closes) execFileSync('node',
          ['scripts/flow-checklist.mjs', String(closes), 'merged', '--link', pr.html_url],
          { env: { ...env, GH_TOKEN: env.FLOW_TOKEN, GITHUB_REPOSITORY: `${owner}/${repo}` }, stdio: 'inherit' })
      } catch (e) { core.warning(`flow checklist tick failed (non-fatal): ${e.message}`) }
    }

    const isBaseMoved = (e) => e.status === 405 && /base branch was modified/i.test(e.message || '')

    async function mergeWithRetry(pr, pull_number, tick = true) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await github.rest.pulls.merge({ owner, repo, pull_number, merge_method: 'merge' })
        } catch (e) {
          if (isBaseMoved(e) && attempt < 3) {
            core.info(`merge #${pull_number}: base moved, retry ${attempt}/2 in 5s`)
            await new Promise(r => setTimeout(r, 5000))
            continue
          }
          if (isRateLimit(e)) throw e
          core.warning(`merge #${pull_number} failed: ${e.message}`)
          return false
        }
        core.info(`Auto-merged non-gate sub-PR #${pull_number} into ${pr.base.ref}.`)
        if (tick) await tickMerged(pr)
        return true
      }
      return false
    }

    // The owner said ok but it cannot count yet: say why, once per reason and commit — never silent.
    async function okReplyNote({ pull_number, pr, go, reviewSt, prComments }) {
      const okBeforeFinal = ['final', 'needs-owner'].includes(reviewSt.kind) && !(new Date(go.approvedAt) > new Date(reviewSt.at))
      const reply = chooseOkReply({ state: reviewSt, ownerOk: true, okBeforeFinal })
      if (!reply) return
      const marker = `<!-- build-ok-waiting:${reply.reason}:${pr.head.sha} -->`
      if (prComments.some(c => (c.body || '').includes(marker))) return
      await github.rest.issues.createComment({ owner, repo, issue_number: pull_number,
        body: `${marker}\n<!-- pipeline-note -->\n${reply.text}\n\n<sub>🤖 agent pipeline (CI) · auto-merge (#3173)</sub>` })
    }

    // Shared-code pause (#339) announcement. `held` is the hold answer: {held, hasPkgs, hasWf}.
    async function announceSharedHold({ pull_number, pr, held }) {
      const sharedCode = held.held
      // #2150: announce once — the hourly sweep re-evaluates; the label is the durable 'already held' marker.
      const alreadyHeld = (pr.labels || []).some(l => l.name === 'status:needs-merge')
      if (alreadyHeld) { core.info(`#${pull_number} already held for shared-code review — not re-announcing.`); return }
      core.info(`#${pull_number} touches packages/ (${sharedCode.length} file(s)) — holding for a human.`)
      // `status:needs-merge`, NOT `status:blocked` (#2083): this hold asks for a click, not an answer.
      try { await github.rest.issues.addLabels({ owner, repo, issue_number: pull_number, labels: ['status:needs-merge'] }) } catch (e) { core.warning(`addLabel #${pull_number}: ${e.message}`) }
      // #2520: no review request or @mention — sub-PRs never notify the owner.
      const { hasPkgs, hasWf } = held
      const what = hasPkgs && hasWf ? 'shared code under `packages/` and CI workflows under `.github/workflows/`'
        : hasWf ? 'CI workflows under `.github/workflows/`' : 'shared code under `packages/`'
      const why = hasWf
        ? 'a workflow change never self-merges until you say so (#2442) — review it, then reply `ok` and it merges itself once green.'
        : 'a change to `packages/` ripples across every consuming app (the `packages/` HARD GATE, #350) and it is not releasable by this path — review it, confirm `pnpm typecheck` across apps, then reply `ok` and it merges itself once green.'
      const list = sharedCode.slice(0, 10).map(f => `- \`${f}\``).join('\n')
      const more = sharedCode.length > 10 ? `\n…and ${sharedCode.length - 10} more.` : ''
      await github.rest.issues.createComment({ owner, repo, issue_number: pull_number,
        body: `<!-- pipeline-note -->\n⏸️ **Held for a human — this build PR changes ${what}.**\n\n`
          + `**Fix:** ${why}\n\n`
          + `<details><summary>held files (${sharedCode.length})</summary>\n\n${list}${more}\n</details>\n\n`
          + '<sub>🤖 agent pipeline (CI) · auto-merge shared-code guard (#339)</sub>' })
    }

  return { mergeWithRetry, okReplyNote, announceSharedHold }
}

/** Off switch: PIPELINE_V1=off turns auto-merge off on a v1 PR (then today's path runs unchanged). */
export async function v1OffSwitch({ github, core, pr, pull_number }) {
  try {
    await setAutoMerge(github, pr, 'disable')
    core.info(`#${pull_number} v1 off — auto-merge switched off`)
  } catch (e) {
    if (isRateLimit(e)) throw e
    core.warning(`#${pull_number}: could not switch auto-merge off: ${e.message}`)
  }
}

/**
 * The v1 path for one PR (#3501): answer from review alone, publish it as the `Merge decision` check;
 * GitHub waits for CI and merges. `red` is a boolean, `checkState` the CI Gate state.
 */
export async function runV1({ github, core, owner, repo, env, pr, pull_number, go, prComments, rawRuns, red, checkState, BOTS, reviewState }) {
  const { mergeWithRetry, okReplyNote, announceSharedHold } = makeMergeIo({ github, core, owner, repo, env })
  // #3173: a work-* PR on an epic branch that the reviewer rejected twice (or that needs the owner's call, #3428) is held for the owner,
  // and the owner's `ok` AFTER that hold is the go (no `build:approved` is ever added for it). Pure over prComments: no API call.
  const reviewSt = pr.head.ref.startsWith('work-')
    ? reviewState({ comments: prComments, headSha: pr.head.sha, bots: [`${env.APP_SLUG}[bot]`] })
    : { kind: 'pending' }
  const labels = (pr.labels || []).map(l => l.name)
  const ask = (files) => decideV1({ draft: pr.draft, authorIsPipeline: BOTS.includes(pr.user.login), baseRef: pr.base.ref, headRef: pr.head.ref, labels, go,
    ownerHold: ['final', 'needs-owner'].includes(reviewSt.kind) ? reviewSt : null, headSha: pr.head.sha, headReview: reviewSt, red, files })
  let answer = ask()
  if (answer.needFiles) {
    const fl = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number })
    answer = ask(fl.map(f => f.filename))
  }
  core.info(`#${pull_number} v1 answer: ${answer.code} — ${answer.reason}`)
  const wrote = await publishMergeDecision({ github, owner, repo, pr, rawRuns, appSlug: env.APP_SLUG, answer })
  core.info(`#${pull_number} 'Merge decision' ${wrote}.`)
  if (shouldEnableAuto({ answer, autoMergeOn: !!pr.auto_merge })) {
    try {
      await setAutoMerge(github, pr, 'enable')
      core.info(`#${pull_number} v1 auto-merge enabled.`)
    } catch (e) {
      if (isRateLimit(e)) throw e
      core.info(`#${pull_number} enablePullRequestAutoMerge refused: ${e.message}`)
      // Already clean: GitHub refuses auto-merge. Merge here ONLY when every fact says merge (the App bypasses the ruleset).
      if (/clean status|already.*mergeable/i.test(e.message || '') && canMergeNow({ answer, ciGate: checkState, red })) await mergeWithRetry(pr, pull_number, false)
      else core.warning(`#${pull_number}: auto-merge not enabled: ${e.message}`)
    }
  }
  if (answer.code === 'shared-code') await announceSharedHold({ pull_number, pr, held: answer })
  if (answer.code === 'no-review' && go.go) await okReplyNote({ pull_number, pr, go, reviewSt, prComments })
  return answer
}
