import { describe, expect, it } from 'vitest'
import { decidePreview, liveAppFromConfig, previewGoneHtml, parseDeployComment, resolvePreviewUrl, type Preview } from '../server/utils/live-apps-core'

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
