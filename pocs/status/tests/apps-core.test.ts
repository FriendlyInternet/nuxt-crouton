import { describe, it, expect } from 'vitest'
import { buildAppCards } from '../server/utils/apps-core'
import { appFromLabels } from '../server/utils/totest-core'

const item = (n: number, app: string | null) => ({ kind: 'epic' as const, number: n, title: 't', url: 'u', app, what: '', steps: [], to: '' })

describe('appFromLabels', () => {
  it('reads app: and poc: labels', () => {
    expect(appFromLabels([{ name: 'epic' }, { name: 'app:velo' }])).toBe('velo')
    expect(appFromLabels([{ name: 'poc:status' }])).toBe('status')
    expect(appFromLabels([{ name: 'epic' }])).toBeNull()
  })
})

describe('buildAppCards', () => {
  const apps = [{ app: 'velo', stagingUrl: 'https://v', hasSignIn: true }, { app: 'bare', stagingUrl: null, hasSignIn: false }]
  it('groups epics under their app with a sign-in link, null under General, most to-test first', () => {
    const cards = buildAppCards({ apps, previews: [], toTest: [item(1, 'velo'), item(2, 'velo'), item(3, null)], questions: [], decisions: [] })
    expect(cards.map(c => c.app)).toEqual(['velo', 'bare', null])
    expect(cards[0]!.signInUrl).toBe('/api/status/login/velo')
    expect(cards[0]!.toTest).toHaveLength(2)
    expect(cards[1]!.signInUrl).toBeNull()
    expect(cards[2]!.signInUrl).toBeNull()
  })
  it('puts General last even with the most to-test items', () => {
    const cards = buildAppCards({ apps, previews: [], toTest: [item(1, null), item(2, null), item(3, null), item(4, 'velo')], questions: [], decisions: [] })
    expect(cards.map(c => c.app)).toEqual(['velo', 'bare', null])
  })
  it('counts previews toward most to-test', () => {
    const pv = (pr: number) => ({ app: 'bare', pr, title: 't', updatedAt: '', url: 'u' })
    const cards = buildAppCards({ apps, previews: [pv(1), pv(2)], toTest: [item(1, 'velo')], questions: [], decisions: [] })
    expect(cards.map(c => c.app)).toEqual(['bare', 'velo'])
  })
  it('carries the app folder', () => {
    const cards = buildAppCards({ apps: [{ ...apps[0]!, dir: 'apps/velo' }], previews: [], toTest: [item(1, 'named'), item(2, null)], questions: [], decisions: [] })
    expect(cards.find(c => c.app === 'velo')!.dir).toBe('apps/velo')
    expect(cards.find(c => c.app === 'named')!.dir).toBeNull()
    expect(cards.find(c => c.app === null)!.dir).toBeNull()
  })
})
