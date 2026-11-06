import { describe, it, expect, vi } from 'vitest'

const routes: Record<string, unknown> = {}
vi.mock('../server/utils/github', () => ({
  ghFetch: async (_e: unknown, path: string) => {
    const key = Object.keys(routes).find(k => path.includes(k))
    return key ? { data: routes[key], error: null } : { data: [], error: null }
  }
}))

import { listToTest } from '../server/utils/totest'
import { buildAppCards } from '../server/utils/apps-core'

const body = '## 🧪 How to test\n1. Open the app\n'
const b64 = (o: unknown) => btoa(JSON.stringify(o))

describe('listToTest → buildAppCards', () => {
  it('puts a labelled epic under its app with sign-in, and an unlabelled one under General', async () => {
    routes['issues?labels'] = [
      { number: 1, title: 'a', body, html_url: 'u1', labels: [{ name: 'app:velo' }] },
      { number: 2, title: 'b', body, html_url: 'u2', labels: [{ name: 'epic' }] }
    ]
    routes['apps/velo/deploy.config.json'] = { content: b64({ stagingUrl: 'https://v' }) }
    const res = await listToTest({} as never)
    expect(res.data.find(i => i.number === 1)).toMatchObject({ app: 'velo', stagingUrl: 'https://v' })
    expect(res.data.find(i => i.number === 2)!.app).toBeNull()
    const cards = buildAppCards({ apps: [{ app: 'velo', stagingUrl: 'https://v', hasSignIn: true }], previews: [], toTest: res.data, questions: [], decisions: [] })
    expect(cards.find(c => c.app === 'velo')!.signInUrl).toBe('/api/status/login/velo')
    expect(cards.find(c => c.app === 'velo')!.toTest.map(t => t.number)).toEqual([1])
    expect(cards.find(c => c.app === null)!.toTest.map(t => t.number)).toEqual([2])
  })

  it('falls back to the files of a merged PR that references the epic', async () => {
    routes['issues?labels'] = [{ number: 5, title: 'c', body, html_url: 'u5', labels: [] }]
    routes['pulls?state=closed'] = [{ number: 9, title: 'p', body: 'Closes #5', html_url: 'p9', merged_at: '2026-01-01' }]
    routes['pulls/9/files'] = [{ filename: 'apps/velo/app/x.vue' }]
    const res = await listToTest({} as never)
    expect(res.data.find(i => i.number === 5)!.app).toBe('velo')
  })
})
