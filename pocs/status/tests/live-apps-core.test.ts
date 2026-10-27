import { describe, expect, it } from 'vitest'
import { loadLiveApps, loadPreviews, decidePreview, decidePrLogin, previewNoneHtml, liveAppFromConfig, previewGoneHtml, parseDeployComment, resolvePreviewUrl, type Preview } from '../server/utils/live-apps-core'

const body = '<!-- deploy-staging:velo -->\n🚀 **velo** preview for this PR: https://velo-pr12.example.workers.dev\n\n🔑 Review login'

describe('parseDeployComment', () => {
  it('extracts app and url', () => {
    expect(parseDeployComment(body)).toEqual({ app: 'velo', url: 'https://velo-pr12.example.workers.dev' })
  })
  it('ignores other comments and missing urls', () => {
    expect(parseDeployComment('hello')).toBeNull()
    expect(parseDeployComment('<!-- deploy-staging:velo -->\nno link')).toBeNull()
    expect(parseDeployComment(null)).toBeNull()
  })
})

describe('resolvePreviewUrl', () => {
  const previews: Preview[] = [{ app: 'velo', pr: 12, title: 't', updatedAt: '', url: 'https://a' }]
  it('resolves pr keys per app', () => {
    expect(resolvePreviewUrl(previews, 'velo', 'pr12')).toBe('https://a')
    expect(resolvePreviewUrl(previews, 'kassa', 'pr12')).toBeNull()
    expect(resolvePreviewUrl(previews, 'velo', 'pr13')).toBeNull()
    expect(resolvePreviewUrl(previews, 'velo', 'main')).toBeNull()
  })
})

describe('liveAppFromConfig', () => {
  it('honours reviewLogin opt-out', () => {
    expect(liveAppFromConfig('x', { stagingUrl: 'https://x', reviewLogin: false })).toEqual({ app: 'x', stagingUrl: 'https://x', hasSignIn: false })
    expect(liveAppFromConfig('y', {})).toEqual({ app: 'y', stagingUrl: null, hasSignIn: true })
  })
})

describe('decidePreview', () => {
  const open: Preview[] = [{ app: 'velo', pr: 12, title: 't', updatedAt: '', url: 'https://a' }]
  it('redirects to an open PR preview', () => {
    expect(decidePreview(open, 'velo', 'pr12')).toEqual({ gone: false, url: 'https://a' })
  })
  it('reports a merged/closed PR as gone', () => {
    expect(decidePreview(open, 'velo', 'pr99')).toEqual({ gone: true, pr: 99 })
    expect(decidePreview([], 'velo', 'pr12')).toEqual({ gone: true, pr: 12 })
  })
  it('renders a readable page linking to staging', () => {
    const html = previewGoneHtml(99, 'velo', 'https://velo.example')
    expect(html).toContain('PR #99 was merged or closed')
    expect(html).toContain('href="https://velo.example"')
  })
})

describe('GitHub call budget', () => {
  const cfg = (o: object) => ({ content: btoa(JSON.stringify(o)) })
  const makeGet = (failPath?: string, prs = 50) => {
    const calls: string[] = []
    const get = async (path: string) => {
      calls.push(path)
      if (failPath && path.includes(failPath)) return { data: null, error: 'GitHub 403' }
      if (path.includes('/git/trees/')) {
        const tree = Array.from({ length: 15 }, (_, i) => ({ path: `apps/a${i}/deploy.config.json`, type: 'blob' }))
        return { data: { tree: [...tree, { path: 'apps/x/README.md', type: 'blob' }] }, error: null }
      }
      if (path.includes('/contents/')) return { data: cfg({ stagingUrl: 'https://s' }), error: null }
      if (path.includes('/pulls?')) return { data: Array.from({ length: prs }, (_, i) => ({ number: i + 1, title: 't', updated_at: '' })), error: null }
      return { data: [{ body }], error: null }
    }
    return { calls, get: get as never }
  }
  it('stays within 25 calls for 15 apps and 10 open PRs', async () => {
    const { calls, get } = makeGet(undefined, 10)
    const apps = await loadLiveApps(get)
    const previews = await loadPreviews(get)
    expect(apps.data).toHaveLength(15)
    expect(previews.data).toHaveLength(10)
    expect(calls.filter(c => c.includes('/issues/')).length).toBe(10)
    expect(calls.length).toBeLessThanOrEqual(1 + 15 + 1 + 1 + 10)
  })
  it('shows an open PR whose deploy comment is older than 400 other comments; skips merged PRs', async () => {
    const mk = (app: string, pr: number) => ({ body: `<!-- deploy-staging:${app} -->\n🚀 preview for this PR: https://${app}-pr${pr}.example.dev` })
    const get = (async (path: string) => {
      if (path.includes('/pulls?')) return { data: [{ number: 7, title: 't', updated_at: '' }], error: null }
      if (path.includes('/issues/7/comments')) return { data: [mk('velo', 7)], error: null }
      if (path.includes('/issues/99/')) return { data: [mk('kassa', 99)], error: null }
      // repo-wide scan must not be needed
      return { data: Array.from({ length: 100 }, () => ({ body: 'hi' })), error: null }
    }) as never
    const r = await loadPreviews(get)
    expect(r.data.map(p => `${p.app}#${p.pr}`)).toEqual(['velo#7'])
  })
  it('reports failed config reads instead of swallowing them', async () => {
    const { get } = makeGet('/contents/')
    const r = await loadLiveApps(get)
    expect(r.data).toEqual([])
    expect(r.error).toContain('GitHub 403')
  })
})

describe('decidePrLogin', () => {
  const deploy = '<!-- deploy-staging:velo -->\npreview for this PR: https://velo-pr7.example.dev'
  const mk = (state: string, pages: Array<Array<{ body: string }>>) => (async (path: string) => {
    if (path.includes('/pulls/')) return { data: { state }, error: null }
    const page = Number(/&page=(\d+)/.exec(path)?.[1] ?? 1)
    return { data: pages[page - 1] ?? [], error: null }
  }) as never
  const filler = Array.from({ length: 100 }, () => ({ body: 'x' }))
  it('finds a deploy comment on page 3 of the PR own comments', async () => {
    const get = mk('open', [filler, filler, [{ body: deploy }]])
    expect(await decidePrLogin(get, 'velo', 'pr7')).toEqual({ gone: false, url: 'https://velo-pr7.example.dev' })
  })
  it('reports gone only when the PR is closed', async () => {
    expect(await decidePrLogin(mk('closed', [[{ body: deploy }]]), 'velo', 'pr7')).toEqual({ gone: true, pr: 7 })
  })
  it('says no build yet for an open PR without a comment', async () => {
    expect(await decidePrLogin(mk('open', [[{ body: 'hi' }]]), 'velo', 'pr7')).toEqual({ gone: 'none', pr: 7 })
    expect(previewNoneHtml(7, 'velo', 'https://s')).toContain('PR #7 has no test build yet')
  })
})
