// GET /api/status/now helper: one batched GitHub read (≤ ~15 calls: 5 lists + comments for held items only).
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { classifyNow, type GhPr, type GhIssueLite, type GhRun, type GhComment, type NowResult } from './now-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
// 7 lists + 2 comment-feed pages + ≤16 per-item reads = ≤25 calls per refresh.
const MAX_COMMENT_READS = 16

export async function listNow(event: H3Event): Promise<{ data: NowResult | null, error: string | null }> {
  const [pulls, work, blocked, running, queued, approved, reviewing] = await Promise.all([
    ghFetch<GhPr[]>(event, `/repos/${REPO}/pulls?state=open&per_page=50`),
    ghFetch<GhIssueLite[]>(event, `/repos/${REPO}/issues?labels=work-this&state=open&per_page=50`),
    ghFetch<GhIssueLite[]>(event, `/repos/${REPO}/issues?labels=status:blocked&state=open&per_page=50`),
    ghFetch<{ workflow_runs?: GhRun[] }>(event, `/repos/${REPO}/actions/workflows/work-issue-pidev.yml/runs?status=in_progress&per_page=20`),
    ghFetch<{ workflow_runs?: GhRun[] }>(event, `/repos/${REPO}/actions/workflows/work-issue-pidev.yml/runs?status=queued&per_page=20`),
    ghFetch<GhIssueLite[]>(event, `/repos/${REPO}/issues?labels=plan:approved&state=open&per_page=50`),
    ghFetch<{ workflow_runs?: GhRun[] }>(event, `/repos/${REPO}/actions/workflows/build-review.yml/runs?status=in_progress&per_page=20`)
  ])
  const error = [pulls, work, blocked, running, queued, approved, reviewing].map(r => r.error).filter(Boolean).join('; ') || null
  if (pulls.error && work.error && blocked.error) return { data: null, error }

    // Comments: ONE repo-wide read (newest first, 2 pages) covers most held items; only items it missed
  // get a per-item read, open PRs first (a review hold lives in a PR's comments), within the call budget.
  const comments: Record<number, GhComment[]> = {}
  const feed = await Promise.all([1, 2].map(pg => ghFetch<(GhComment & { issue_url?: string })[]>(event, `/repos/${REPO}/issues/comments?sort=created&direction=desc&per_page=100&page=${pg}`)))
  for (const c of feed.flatMap(f => f.data ?? []).reverse()) {
    const n = Number(/\/issues\/(\d+)$/.exec(c.issue_url ?? '')?.[1])
    if (n) (comments[n] ??= []).push(c)
  }
  const missing = [
    ...(pulls.data ?? []).filter(p => !p.draft).map(p => p.number),
    ...(blocked.data ?? []).map(i => i.number)
  ].filter(n => !comments[n]).slice(0, MAX_COMMENT_READS)
  await Promise.all(missing.map(async (n) => {
    const r = await ghFetch<GhComment[]>(event, `/repos/${REPO}/issues/${n}/comments?per_page=100`)
    comments[n] = r.data ?? []
  }))

  return {
    data: classifyNow({
      pulls: pulls.data ?? [], workIssues: work.data ?? [], approvedIssues: approved.data ?? [], blockedIssues: blocked.data ?? [],
      runs: [...(running.data?.workflow_runs ?? []), ...(queued.data?.workflow_runs ?? []), ...(reviewing.data?.workflow_runs ?? [])], comments
    }),
    error
  }
}
