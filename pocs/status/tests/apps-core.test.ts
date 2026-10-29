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
    expect(cards.map(c => c.app)).toEqual(['velo', null, 'bare'])
    expect(cards[0]!.signInUrl).toBe('/api/status/login/velo')
    expect(cards[0]!.toTest).toHaveLength(2)
    expect(cards[1]!.signInUrl).toBeNull()
    expect(cards[2]!.signInUrl).toBeNull()
  })
})
