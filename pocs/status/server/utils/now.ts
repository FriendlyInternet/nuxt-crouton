// GET /api/status/now helper: one batched GitHub read (≤ ~15 calls: 5 lists + comments for held items only).
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { classifyNow, type GhPr, type GhIssueLite, type GhRun, type GhComment, type NowResult } from './now-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const MAX_COMMENT_READS = 10

export async function listNow(event: H3Event): Promise<{ data: NowResult | null, error: string | null }> {
  const [pulls, work, blocked, running, queued] = await Promise.all([
    ghFetch<GhPr[]>(event, `/repos/${REPO}/pulls?state=open&per_page=50`),
    ghFetch<GhIssueLite[]>(event, `/repos/${REPO}/issues?labels=work-this&state=open&per_page=50`),
    ghFetch<GhIssueLite[]>(event, `/repos/${REPO}/issues?labels=status:blocked&state=open&per_page=50`),
    ghFetch<{ workflow_runs?: GhRun[] }>(event, `/repos/${REPO}/actions/workflows/work-issue-pidev.yml/runs?status=in_progress&per_page=20`),
    ghFetch<{ workflow_runs?: GhRun[] }>(event, `/repos/${REPO}/actions/workflows/work-issue-pidev.yml/runs?status=queued&per_page=20`)
  ])
  const error = [pulls, work, blocked, running, queued].map(r => r.error).filter(Boolean).join('; ') || null
  if (pulls.error && work.error && blocked.error) return { data: null, error }

  // Comments only for held candidates: blocked issues, plus the first non-draft open PRs.
  const candidates = [
    ...(blocked.data ?? []).map(i => i.number),
    ...(pulls.data ?? []).filter(p => !p.draft).map(p => p.number)
  ].slice(0, MAX_COMMENT_READS)
  const comments: Record<number, GhComment[]> = {}
  await Promise.all(candidates.map(async (n) => {
    const r = await ghFetch<GhComment[]>(event, `/repos/${REPO}/issues/${n}/comments?per_page=100`)
    comments[n] = r.data ?? []
  }))

  return {
    data: classifyNow({
      pulls: pulls.data ?? [], workIssues: work.data ?? [], blockedIssues: blocked.data ?? [],
      runs: [...(running.data?.workflow_runs ?? []), ...(queued.data?.workflow_runs ?? [])], comments
    }),
    error
  }
}
