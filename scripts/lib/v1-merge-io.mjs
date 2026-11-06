/**
 * #3501 — the GitHub writes of the v1 merge path, kept out of the workflow's inline script
 * (the inline-size gate: a baselined block may not grow). Plain functions over an injected `github`.
 */
import { execFileSync } from 'node:child_process'
import { chooseOkReply } from './ok-reply.mjs'
import { mergeDecisionCheck, MERGE_DECISION } from './pr-merge-gate.mjs'

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
    async function mergeWithRetry(pr, pull_number, tick = true) {
      let merged = false
      for (let attempt = 1; attempt <= 3 && !merged; attempt++) {
        try {
          await github.rest.pulls.merge({ owner, repo, pull_number, merge_method: 'merge' })
          merged = true
          core.info(`Auto-merged non-gate sub-PR #${pull_number} into ${pr.base.ref}.`)
          // #3210 — tick "Merged" on the ticket's flow checklist (cosmetic; default-branch script).
          // v1 PRs are ticked by on-pr-close.yml instead (#3501), whoever merges them.
          if (tick) {
            try {
              const { issueFromPrBody } = await import('../flow-checklist.mjs')
              const closes = issueFromPrBody(pr.body || '')
              if (closes) execFileSync('node',
                ['scripts/flow-checklist.mjs', String(closes), 'merged', '--link', pr.html_url],
                { env: { ...env, GH_TOKEN: env.FLOW_TOKEN, GITHUB_REPOSITORY: `${owner}/${repo}` }, stdio: 'inherit' })
            } catch (e) { core.warning(`flow checklist tick failed (non-fatal): ${e.message}`) }
          }
        } catch (e) {
          const baseMoved = e.status === 405 && /base branch was modified/i.test(e.message || '')
          if (baseMoved && attempt < 3) {
            core.info(`merge #${pull_number}: base moved, retry ${attempt}/2 in 5s`)
            await new Promise(r => setTimeout(r, 5000))
            continue
          }
          if (isRateLimit(e)) throw e
          core.warning(`merge #${pull_number} failed: ${e.message}`)
          break
        }
      }
      return merged
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
