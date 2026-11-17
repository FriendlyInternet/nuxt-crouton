import { describe, expect, it } from 'vitest'
import { claimBadge } from '../app/utils/claim-badge'

// #4019 — the text of the chat-claim badge a card shows (Body.vue renders it).

describe('claimBadge', () => {
  it('id · nick', () => {
    expect(claimBadge({ payload: { claim: { chat: 'c7f3a1', name: 'products' } } })).toBe('c7f3a1 · products')
  })
  it('id only when the claim has no name', () => {
    expect(claimBadge({ payload: { claim: { chat: 'c7f3a1', name: '' } } })).toBe('c7f3a1')
    expect(claimBadge({ payload: { claim: { chat: 'c7f3a1' } } })).toBe('c7f3a1')
  })
  it('nothing when unclaimed, no payload, or the chat id is not 6 hex chars', () => {
    expect(claimBadge({ payload: {} })).toBeNull()
    expect(claimBadge({ payload: null })).toBeNull()
    expect(claimBadge({})).toBeNull()
    expect(claimBadge({ payload: { claim: { chat: 'zzzzzz', name: 'x' } } })).toBeNull()
    expect(claimBadge({ payload: { claim: { chat: 'c7f3a', name: 'x' } } })).toBeNull()
    expect(claimBadge({ payload: { claim: 'c7f3a1' } })).toBeNull()
  })
})
