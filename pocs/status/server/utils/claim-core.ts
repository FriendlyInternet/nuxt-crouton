// Pure rules for the chat-claim badge on inbox cards (#4019). No Nitro, no `scripts/` imports
// (the Worker cannot load them) — so `activeClaim`, STALE_MS and MAX_HOPS are COPIED from
// scripts/lib/chat-claim.mjs (activeClaim, STALE_MS) and scripts/claim.mjs (MAX_HOPS) — keep in
// step. tests/claim-core.test.ts runs the same fixtures through the original (the parity guard).
import { cardKey, type Ask, type ExistingCard } from './cards-sync-core'

export const STALE_MS = 24 * 60 * 60 * 1000
export const MAX_HOPS = 3

export interface Claim { chat: string, name: string, since: string }
export interface ClaimComment { body?: string | null, createdAt?: string, created_at?: string }
export interface CardClaim { chat: string, name: string }

const CLAIM_RE = /<!--\s*claim:\s*chat=([0-9a-f]+)(?:\s+name="([^"]*)")?(?:\s+since=(\S+))?\s*-->/i
const RELEASE_RE = /<!--\s*claim-release:\s*chat=([0-9a-f]+)\s*-->/i

const timeOf = (c: ClaimComment) => Date.parse(c.createdAt || c.created_at || '') || 0

/** The live claim on ONE issue, or null. Copy of scripts/lib/chat-claim.mjs `activeClaim`. */
export function activeClaim({ state, comments = [], now = Date.now() }: {
  state?: string | null, comments?: ClaimComment[], now?: Date | number
} = {}): Claim | null {
  if (String(state || '').toLowerCase() === 'closed') return null
  const sorted = [...comments].sort((a, b) => timeOf(a) - timeOf(b))
  let claim: Claim | null = null
  for (const c of sorted) {
    const body = String(c.body || '')
    const rel = body.match(RELEASE_RE)
    if (rel && claim && rel[1]!.toLowerCase() === claim.chat) { claim = null; continue }
    const m = body.match(CLAIM_RE)
    if (m) claim = { chat: m[1]!.toLowerCase(), name: m[2] || '', since: m[3] || '' }
  }
  if (!claim) return null
  // Stale: the claiming chat said nothing on this issue (marker or 🤖 header) for 24 h.
  const mention = new RegExp(`chat[= ]${claim.chat}\\b`, 'i')
  const last = sorted.filter(c => mention.test(String(c.body || ''))).map(timeOf).pop() || 0
  if (+new Date(now) - last > STALE_MS) return null
  return claim
}

/**
 * Every ticket a live claim covers: the claimed issue itself and its sub-issues down to
 * `maxHops` levels (the mirror of `claimChain` walking up `parent`). The nearest claim wins, so a
 * direct claim on a child beats its epic's claim.
 */
export function claimsByTicket({ live, children, maxHops = MAX_HOPS }: {
  live: Array<{ issue: number, claim: { chat: string, name?: string } }>
  children: Record<number, number[]>
  maxHops?: number
}): Record<number, CardClaim> {
  const out: Record<number, CardClaim> = {}
  const dist: Record<number, number> = {}
  for (const { issue, claim } of live) {
    const value = { chat: claim.chat, name: claim.name || '' }
    for (const [n, d] of descendants(issue, children, maxHops)) {
      if (dist[n] !== undefined && dist[n]! <= d) continue
      dist[n] = d
      out[n] = value
    }
  }
  return out
}

/** `root` and its sub-issues down to `maxHops` levels, each with its depth (breadth first). */
function descendants(root: number, children: Record<number, number[]>, maxHops: number): Map<number, number> {
  const depth = new Map<number, number>([[root, 0]])
  const queue = [root]
  while (queue.length) {
    const n = queue.shift()!
    const d = depth.get(n)!
    if (d >= maxHops) continue
    for (const c of children[n] ?? []) {
      if (depth.has(c)) continue
      depth.set(c, d + 1)
      queue.push(c)
    }
  }
  return depth
}

/**
 * Put `payload.claim` on every ask whose ticket is claimed (an issue card by its number, a PR
 * card by its `Closes #N` issue in `prTicket`). `byTicket` null = the claim read failed: each ask
 * keeps the claim its stored card already has, so a failed read never changes a card.
 */
export function applyClaims(
  asks: Ask[],
  byTicket: Record<number, CardClaim> | null,
  existing: ExistingCard[],
  prTicket: Record<number, number | null | undefined>
): Ask[] {
  const stored = new Map(existing.map(c => [cardKey(c), c.payload?.claim]))
  return asks.map((a) => {
    const { claim: _drop, ...rest } = a.payload ?? {}
    let claim: unknown
    if (byTicket) {
      const ticket = a.sourceType === 'pr' ? prTicket[a.sourceNumber] : a.sourceNumber
      claim = ticket ? byTicket[ticket] : undefined
    } else {
      claim = stored.get(cardKey(a))
    }
    return claim ? { ...a, payload: { ...rest, claim } } : { ...a, payload: rest }
  })
}
