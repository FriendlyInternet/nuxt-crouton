import { describe, expect, it } from 'vitest'
import { NO_WHY_TEXT, packageLines } from '../app/utils/package-lines'
import type { InboxCard } from '../app/utils/inbox-core'

// #3785 — the ⚠️ "Touches <package>" lines a review card shows (Packages.vue renders these).

const card = (payload: Record<string, unknown> | null, o: Partial<InboxCard> = {}): InboxCard => ({
  id: 'c1', kind: 'review', state: 'waiting', askedAt: '2026-11-01T00:00:00Z', title: 'PR 42', ask: 'Look, then ok.',
  link: 'https://github.com/FriendlyInternet/nuxt-crouton/pull/42', payload, sourceType: 'pr', sourceNumber: 42, ...o
})
const FILES = 'https://github.com/FriendlyInternet/nuxt-crouton/pull/42/files'

describe('packageLines', () => {
  it('two packages → two lines, each with its own sentence and the same files link', () => {
    const lines = packageLines(card({ packages: [
      { name: 'crouton-core', why: 'Adds a field.', approval: 'owner yes 14:49' },
      { name: 'crouton-layout', why: 'Saves the layout.', approval: 'owner yes 14:49' }
    ] }))
    expect(lines).toEqual([
      { name: 'crouton-core', why: 'Adds a field.', whyText: 'Adds a field.', approval: 'owner yes 14:49', filesUrl: FILES },
      { name: 'crouton-layout', why: 'Saves the layout.', whyText: 'Saves the layout.', approval: 'owner yes 14:49', filesUrl: FILES }
    ])
  })

  it('one line per package', () => {
    expect(packageLines(card({ packages: [{ name: 'crouton-core', why: null, approval: null }] }))).toHaveLength(1)
  })

  it('no lines when payload.packages is empty, missing, or the payload is null', () => {
    expect(packageLines(card({ packages: [] }))).toEqual([])
    expect(packageLines(card({ review: 'go' }))).toEqual([])
    expect(packageLines(card(null))).toEqual([])
  })

  it('why: null → the "read the diff" sentence; approval null stays null', () => {
    const [l] = packageLines(card({ packages: [{ name: 'crouton-core', why: null, approval: null }] }))
    expect(l).toEqual({ name: 'crouton-core', why: null, whyText: NO_WHY_TEXT, approval: null, filesUrl: FILES })
    expect(NO_WHY_TEXT).toBe('No plain reason was written — read the diff.')
  })

  it('entries with no name are dropped; non-PR cards show nothing', () => {
    expect(packageLines(card({ packages: [{ why: 'x' }, null, { name: 'crouton-core' }] })).map(l => l.name)).toEqual(['crouton-core'])
    expect(packageLines(card({ packages: [{ name: 'crouton-core' }] }, { sourceType: 'issue' }))).toEqual([])
  })
})
