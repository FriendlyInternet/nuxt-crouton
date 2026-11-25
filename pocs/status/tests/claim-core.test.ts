import { describe, expect, it } from 'vitest'
import { activeClaim, applyClaims, claimsByTicket } from '../server/utils/claim-core'
import { planSync, type Ask, type ExistingCard } from '../server/utils/cards-sync-core'
// The original the Status copy must match (parity guard, #4019).
import { activeClaim as originalActiveClaim } from '../../../scripts/lib/chat-claim.mjs'

// #4019 — the chat-claim badge: which inbox card shows which chat drives its ticket.

const NOW = Date.parse('2026-11-17T12:00:00Z')
const H = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const claimC = (chat: string, name: string, hAgo: number) =>
  ({ body: `<!-- claim: chat=${chat} name="${name}" since=${H(hAgo).slice(0, 16)}Z -->\n> 🤖 chat ${chat}`, created_at: H(hAgo) })
const releaseC = (chat: string, hAgo: number) => ({ body: `<!-- claim-release: chat=${chat} -->\n> 🤖 chat ${chat}`, created_at: H(hAgo) })

const ask = (sourceType: 'issue' | 'pr', n: number, payload: Record<string, unknown> = {}): Ask => ({
  kind: sourceType === 'pr' ? 'review' : 'issue', sourceType, sourceNumber: n, sourceCommentId: 'c1',
  title: `T ${n}`, ask: 'Look.', link: `https://github.com/o/r/issues/${n}`, payload, askedAt: '2026-11-17T10:00:00.000Z'
})
const stored = (a: Ask, payload: Record<string, unknown>): ExistingCard => ({
  id: `card-${a.sourceNumber}`, kind: a.kind, sourceType: a.sourceType, sourceNumber: a.sourceNumber,
  sourceCommentId: a.sourceCommentId, title: a.title, ask: a.ask, link: a.link, payload, state: 'waiting', askedAt: a.askedAt
})

describe('claim-core', () => {
  it('(a) a direct live claim → { chat, name } on that ticket', () => {
    const claim = activeClaim({ state: 'open', comments: [claimC('c7f3a1', 'products', 2)], now: NOW })!
    expect(claim).toMatchObject({ chat: 'c7f3a1', name: 'products' })
    expect(claimsByTicket({ live: [{ issue: 10, claim }], children: {} })).toEqual({ 10: { chat: 'c7f3a1', name: 'products' } })
  })

  it('(b) the epic claim reaches a child (1 hop) and a great-grandchild (3 hops), not 4 hops', () => {
    const children = { 1: [2], 2: [3], 3: [4], 4: [5] }
    const out = claimsByTicket({ live: [{ issue: 1, claim: { chat: 'aaaaaa', name: 'epic' } }], children })
    expect(out[2]).toEqual({ chat: 'aaaaaa', name: 'epic' })
    expect(out[4]).toEqual({ chat: 'aaaaaa', name: 'epic' })
    expect(out[5]).toBeUndefined()
  })

  it('(c) a direct claim on a child beats its epic\'s claim', () => {
    const children = { 1: [2, 3], 2: [20] }
    const out = claimsByTicket({
      live: [{ issue: 1, claim: { chat: 'aaaaaa', name: 'epic' } }, { issue: 2, claim: { chat: 'bbbbbb', name: 'child' } }],
      children
    })
    expect(out[2]).toEqual({ chat: 'bbbbbb', name: 'child' })
    expect(out[20]).toEqual({ chat: 'bbbbbb', name: 'child' })
    expect(out[3]).toEqual({ chat: 'aaaaaa', name: 'epic' })
    // Order of `live` does not matter.
    const rev = claimsByTicket({
      live: [{ issue: 2, claim: { chat: 'bbbbbb', name: 'child' } }, { issue: 1, claim: { chat: 'aaaaaa', name: 'epic' } }],
      children
    })
    expect(rev).toEqual(out)
  })

  it('(d) released / older than 24 h / closed → no claim, the same as scripts/lib/chat-claim.mjs', () => {
    const fixtures = [
      { name: 'live', state: 'open', comments: [claimC('c7f3a1', 'products', 2)], want: true },
      { name: 'released', state: 'open', comments: [claimC('c7f3a1', 'products', 3), releaseC('c7f3a1', 1)], want: false },
      { name: 'stale', state: 'open', comments: [claimC('c7f3a1', 'products', 25)], want: false },
      { name: 'stale but mentioned since', state: 'open', comments: [claimC('c7f3a1', 'p', 30), { body: '> 🤖 chat c7f3a1 · update', created_at: H(1) }], want: true },
      { name: 'closed', state: 'CLOSED', comments: [claimC('c7f3a1', 'products', 2)], want: false },
      { name: 'other chat release', state: 'open', comments: [claimC('c7f3a1', 'products', 3), releaseC('dddddd', 1)], want: true },
      { name: 'camelCase createdAt', state: 'open', comments: [{ body: claimC('c7f3a1', 'x', 1).body, createdAt: H(1) }], want: true }
    ]
    for (const f of fixtures) {
      const mine = activeClaim({ state: f.state, comments: f.comments, now: NOW })
      const theirs = originalActiveClaim({ state: f.state, comments: f.comments, now: NOW })
      expect(mine, f.name).toEqual(theirs)
      expect(!!mine, f.name).toBe(f.want)
    }
  })

  it('(e) an issue card is keyed by its number, a PR card by its Closes #N; unclaimed → no claim key', () => {
    const byTicket = { 11: { chat: 'c7f3a1', name: 'products' } }
    const out = applyClaims([ask('issue', 11, { x: 1 }), ask('pr', 10), ask('issue', 12), ask('pr', 13)], byTicket, [], { 10: 11, 13: null })
    expect(out[0]!.payload).toEqual({ x: 1, claim: { chat: 'c7f3a1', name: 'products' } })
    expect(out[1]!.payload).toEqual({ claim: { chat: 'c7f3a1', name: 'products' } })
    expect('claim' in out[2]!.payload).toBe(false)
    expect('claim' in out[3]!.payload).toBe(false)
  })

  it('(f) a failed claim read keeps the stored claim, so planSync reports no update', () => {
    const a = ask('issue', 11, { x: 1 })
    const existing = [stored(a, { x: 1, claim: { chat: 'c7f3a1', name: 'products' } })]
    const asks = applyClaims([a], null, existing, {})
    expect(asks[0]!.payload.claim).toEqual({ chat: 'c7f3a1', name: 'products' })
    const plan = planSync({ asks, existing, listsComplete: true })
    expect(plan.counts.updated).toBe(0)
    expect(plan.update).toEqual([])
  })

  it('(g) a stored card with a claim and a fresh ask without one → planSync updates it (badge gone after release)', () => {
    const a = ask('issue', 11)
    const existing = [stored(a, { claim: { chat: 'c7f3a1', name: 'products' } })]
    const asks = applyClaims([a], {}, existing, {})
    const plan = planSync({ asks, existing, listsComplete: true })
    expect(plan.counts.updated).toBe(1)
    expect(plan.update[0]!.patch.payload).toEqual({})
  })
})
