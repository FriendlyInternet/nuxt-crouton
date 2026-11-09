import { describe, it, expect, vi } from 'vitest'

// Fixture shaped like today's real data: 19 open PRs, 39 blocked issues (one of them the ticket of PR 1).
const calls: string[] = []
const bot = { login: 'nuxt-harness[bot]', type: 'Bot' }
const blocked = Array.from({ length: 39 }, (_, i) => ({ number: 100 + i, title: `b${i}`, html_url: `u${100 + i}`, labels: [{ name: 'status:blocked' }] }))
const pulls = Array.from({ length: 19 }, (_, i) => ({
  number: 1 + i, title: `pr${i + 1}`, html_url: `p${i + 1}`, body: i === 0 ? 'Closes #100' : `Closes #${500 + i}`,
  head: { ref: `work-${500 + i}`, sha: `a${i + 1}` }, base: { ref: 'main' }, user: { login: 'nuxt-harness[bot]', type: 'Bot' }
}))
// PR 2 has a final review hold on its current head; PR 3 is plain in-review.
const feed = [
  ...blocked.map(b => ({ issue_url: `https://api.github.com/repos/o/r/issues/${b.number}`, body: `## 🔀 Blocked — question ${b.number}\n**Needs:** answer`, created_at: '2026-11-01T00:00:00Z', user: bot })),
  { issue_url: 'https://api.github.com/repos/o/r/issues/2', body: '<!-- build-review-sha:a2 -->\n<!-- build-review-verdict:no-go -->\n<!-- build-review-final -->\n🔴 **Build rejected twice**', created_at: '2026-11-01T00:00:00Z', user: bot }
]
vi.mock('../server/utils/github', () => ({
  ghFetch: async (_e: unknown, path: string) => {
    calls.push(path)
    if (path.includes('/pulls?')) return { data: pulls, error: null }
    if (path.includes('labels=status:blocked')) return { data: blocked, error: null }
    if (path.includes('labels=')) return { data: [], error: null }
    if (path.includes('/runs')) return { data: { workflow_runs: [] }, error: null }
    if (path.includes('/issues/comments?')) return { data: path.includes('page=1') ? feed : [], error: null }
    return { data: [], error: null }
  }
}))

import { listNow } from '../server/utils/now'

describe('listNow on real-sized data (19 PRs, 39 blocked)', () => {
  it('every blocked issue has its reason; held PRs are Waiting, not Now; ≤ 25 calls', async () => {
    const r = await listNow({} as never)
    const d = r.data!
    expect(d.waiting.filter(w => w.kind === 'issue')).toHaveLength(39)
    for (const w of d.waiting.filter(w => w.kind === 'issue')) expect(w.reason).toBe(`question ${w.number}`)
    expect(d.waiting.find(w => w.number === 1)).toMatchObject({ kind: 'pr', reason: 'question 100' }) // ticket blocked
    expect(d.waiting.find(w => w.number === 2)).toMatchObject({ kind: 'pr' }) // final review hold
    expect(d.now.map(n => n.number)).not.toContain(1)
    expect(d.now.map(n => n.number)).not.toContain(2)
    expect(d.now).toHaveLength(17)
    expect(calls.length).toBeLessThanOrEqual(25)
  })
})
