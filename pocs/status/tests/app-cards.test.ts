import { describe, it, expect } from 'vitest'
import { toCardView } from '../app/utils/app-cards'

const item = (app: string | null, steps: string[] = ['a']) => ({ kind: 'epic' as const, number: 1, title: 't', app, steps })
const base = { app: 'bare', dir: null as string | null, stagingUrl: null as string | null, toTest: [] as ReturnType<typeof item>[], previews: [] as Array<{ pr: number }>, questions: [] as unknown[] }

describe('toCardView', () => {
  it('General card has no sign-in anywhere', () => {
    const v = toCardView({ ...base, app: null, toTest: [item(null)] })
    expect(v.title).toBe('General')
    expect(v.signIn).toBeNull()
    expect(v.toTest[0]!.signIn).toBeNull()
  })
  it('a PR preview sign-in works without a staging address', () => {
    const v = toCardView({ ...base, app: 'spike', previews: [{ pr: 3188 }] })
    expect(v.previews[0]!.signIn).toBe('/api/status/login/spike?key=pr3188')
    expect(v.signIn).toBeNull()
  })
  it('no review login still gets working links', () => {
    const v = toCardView({ ...base, stagingUrl: 'https://b', previews: [{ pr: 5 }], toTest: [item('bare')] })
    expect(v.signIn).toMatch(/\?key=main$/)
    expect(v.previews[0]!.signIn).toMatch(/\?key=pr5$/)
    expect(v.toTest[0]!.signIn).toMatch(/^\/api\/status\/login\/bare/)
    expect(v.toTest[0]!.signIn).toContain('walk=')
  })
  it('collapses only when nothing to test and nothing waiting', () => {
    expect(toCardView(base).collapsed).toBe(true)
    expect(toCardView({ ...base, toTest: [item('bare')] }).collapsed).toBe(false)
    expect(toCardView({ ...base, previews: [{ pr: 1 }] }).collapsed).toBe(false)
    expect(toCardView({ ...base, questions: [{}] }).collapsed).toBe(false)
  })
  it('last merged points at the app folder history', () => {
    const r = 'https://github.com/FriendlyInternet/nuxt-crouton/commits/main/'
    expect(toCardView({ ...base, app: 'status', dir: 'pocs/status' }).lastMergedHref).toBe(`${r}pocs/status`)
    expect(toCardView({ ...base, app: 'velo', dir: 'apps/velo' }).lastMergedHref).toBe(`${r}apps/velo`)
    expect(toCardView({ ...base, app: null }).lastMergedHref).toBe('/changelog')
    expect(toCardView(base).lastMergedHref).toBe('/changelog')
  })
})
