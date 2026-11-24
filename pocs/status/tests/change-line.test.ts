import { describe, expect, it } from 'vitest'
import { changeLine } from '../app/utils/change-line'
import type { InboxCard } from '../app/utils/inbox-core'

// #4373 — the "what changed" line a PR review card shows (Changes.vue renders it).

const card = (payload: Record<string, unknown> | null, o: Partial<InboxCard> = {}): InboxCard => ({
  id: 'c1', kind: 'review', state: 'waiting', askedAt: '2026-11-01T00:00:00Z', title: 'PR 42', ask: 'Look, then ok.',
  link: 'https://github.com/FriendlyInternet/nuxt-crouton/pull/42', payload, sourceType: 'pr', sourceNumber: 42, ...o
})
const FILES = 'https://github.com/FriendlyInternet/nuxt-crouton/pull/42/files'
const CHANGES = { files: 3, added: 12, removed: 4, top: ['pocs/status/app/components/cards/Review.vue', 'server/utils/a.ts', 'b.ts'] }

describe('changeLine', () => {
  // covers: T6
  it('PR card with changes → the text with short names and the /pull/<n>/files link', () => {
    expect(changeLine(card({ changes: CHANGES }))).toEqual({
      text: '3 files · +12 −4 · cards/Review.vue, utils/a.ts, b.ts',
      filesUrl: FILES
    })
  })

  // covers: T7
  it('issue card → null', () => {
    expect(changeLine(card({ changes: CHANGES }, { sourceType: 'issue' }))).toBeNull()
  })

  // covers: T8
  it('no payload.changes, a null payload, or malformed changes → null', () => {
    expect(changeLine(card({ review: 'go' }))).toBeNull()
    expect(changeLine(card(null))).toBeNull()
    expect(changeLine(card({ changes: { ...CHANGES, files: 'x' } }))).toBeNull()
    expect(changeLine(card({ changes: { ...CHANGES, added: undefined } }))).toBeNull()
    expect(changeLine(card({ changes: 'nope' }))).toBeNull()
  })

  // covers: T9
  it('one file → "1 file" singular', () => {
    const l = changeLine(card({ changes: { files: 1, added: 2, removed: 0, top: ['a/b/c.ts'] } }))
    expect(l?.text).toBe('1 file · +2 −0 · b/c.ts')
  })

  it('empty top → the counts only', () => {
    expect(changeLine(card({ changes: { files: 2, added: 0, removed: 0, top: [] } }))?.text).toBe('2 files · +0 −0')
  })
})

describe('changeLine — delivery card (#4501)', () => {
  const delivery = (changes: Record<string, unknown>) => card({ changes }, { kind: 'delivery', sourceType: 'issue', sourceNumber: 4388 })

  // covers: T3
  it('delivery card with changes.pr → links that PR\'s Files tab', () => {
    expect(changeLine(delivery({ ...CHANGES, pr: 4486, prCount: 1 }))).toEqual({
      text: '3 files · +12 −4 · cards/Review.vue, utils/a.ts, b.ts',
      filesUrl: 'https://github.com/FriendlyInternet/nuxt-crouton/pull/4486/files'
    })
  })

  // covers: T3
  it('prCount > 1 → "newest of N PRs into main" suffix', () => {
    expect(changeLine(delivery({ ...CHANGES, pr: 4486, prCount: 2 }))?.text).toMatch(/ · newest of 2 PRs into main$/)
  })

  // covers: T3
  it('delivery card without a valid pr → null; a non-delivery issue card with pr → null', () => {
    expect(changeLine(delivery(CHANGES))).toBeNull()
    expect(changeLine(delivery({ ...CHANGES, pr: 0 }))).toBeNull()
    expect(changeLine(delivery({ ...CHANGES, pr: '4486' }))).toBeNull()
    expect(changeLine(card({ changes: { ...CHANGES, pr: 4486 } }, { kind: 'issue', sourceType: 'issue' }))).toBeNull()
  })
})
