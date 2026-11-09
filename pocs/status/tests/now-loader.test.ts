import { describe, it, expect, vi } from 'vitest'

const calls: string[] = []
const blocked = Array.from({ length: 37 }, (_, i) => ({ number: 100 + i, title: `b${i}`, html_url: `u${100 + i}`, labels: [{ name: 'status:blocked' }] }))
const pulls = [{ number: 30, title: 'pr30', html_url: 'p30', head: { ref: 'work-30' }, user: { login: 'nuxt-harness', type: 'Bot' } }]
vi.mock('../server/utils/github', () => ({
  ghFetch: async (_e: unknown, path: string) => {
    calls.push(path)
    if (path.includes('/pulls?')) return { data: pulls, error: null }
    if (path.includes('labels=status:blocked')) return { data: blocked, error: null }
    if (path.includes('labels=work-this')) return { data: [], error: null }
    if (path.includes('/runs')) return { data: { workflow_runs: [] }, error: null }
    if (path.includes('/issues/30/comments')) return { data: [{ body: 'Review rejected twice. Held for you.' }], error: null }
    const n = Number(/issues\/(\d+)\/comments/.exec(path)?.[1])
    return { data: [{ body: `## 🔀 Blocked — question ${n}\n**Needs:** answer` }], error: null }
  }
}))

import { listNow } from '../server/utils/now'

describe('listNow with 37 blocked issues (real load)', () => {
  it('still reads the PR verdict: PR is Waiting with its reason, not Now; budget ≤ 25 calls', async () => {
    const r = await listNow({} as never)
    expect(r.data!.now).toEqual([])
    expect(r.data!.waiting.find(w => w.number === 30)).toMatchObject({ kind: 'pr', reason: expect.stringMatching(/rejected twice/i) })
    expect(r.data!.waiting.find(w => w.number === 100)!.reason).toBe('question 100')
    expect(calls.length).toBeLessThanOrEqual(25)
  })
})
