import { describe, it, expect, vi } from 'vitest'

const routes: Record<string, unknown> = {}
vi.mock('../server/utils/github', () => ({
  requireStatusOwner: async () => undefined,
  ghFetch: async (_e: unknown, path: string) => {
    const key = Object.keys(routes).find(k => path.includes(k))
    return key ? { data: routes[key], error: null } : { data: [], error: null }
  }
}))
vi.mock('../server/utils/live-apps', () => ({
  listLiveApps: async () => ({ data: [{ app: 'velo', stagingUrl: 'https://v', hasSignIn: true }], error: null }),
  listPreviews: async () => ({ data: [], error: null })
}))

// The real route handler, with Nitro's auto-imported helper stubbed.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
const handler = (await import('../server/api/status/apps.get')).default as unknown as (e: unknown) => Promise<{ data: Array<{ app: string | null, signInUrl: string | null, toTest: Array<{ number: number }> }>, error: string | null }>

const body = '## 🧪 How to test\n1. Open the app\n'

describe('GET /api/status/apps handler', () => {
  it('returns app cards with sign-in and a General card, General after named apps', async () => {
    routes['issues?labels'] = [
      { number: 1, title: 'a', body, html_url: 'u1', labels: [{ name: 'app:velo' }] },
      { number: 2, title: 'b', body, html_url: 'u2', labels: [{ name: 'epic' }] }
    ]
    routes['apps/velo/deploy.config.json'] = { content: btoa(JSON.stringify({ stagingUrl: 'https://v' })) }
    const res = await handler({})
    expect(res.data.map(c => c.app)).toEqual(['velo', null])
    expect(res.data[0]!.signInUrl).toBe('/api/status/login/velo')
    expect(res.data[0]!.toTest.map(t => t.number)).toEqual([1])
    expect(res.data[1]!.toTest.map(t => t.number)).toEqual([2])
  })
})
