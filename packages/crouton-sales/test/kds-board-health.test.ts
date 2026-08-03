/**
 * KDS board health — the board must never lie silently (#1766).
 *
 * `KitchenDisplayRender.vue` polls every 2 s and, on failure, does this:
 *
 *     catch {
 *       // Transient blip — keep the last board until the next poll.
 *     }
 *
 * That is right for one dropped packet and catastrophic for a persistent error.
 * When the feed 500s for good — which is exactly what the D1 bound-parameter
 * bug caused past ~100 orders — the kitchen keeps seeing a frozen board of
 * stale tickets, with no error, no empty state and no spinner. Staff work from
 * a screen that stopped telling the truth an hour ago.
 *
 * `boardHealth` is the pure rule behind a visible indicator: tolerate a blip,
 * but say so once the board can no longer be trusted. Keeping the last board is
 * still correct — SHOWING it as live is not.
 */
import { describe, it, expect } from 'vitest'
import { boardHealth, STALE_AFTER_POLLS } from '../app/utils/board-health'

const POLL = 2_000
const at = (now: number, lastOkAt: number | null) => boardHealth({ now, lastOkAt, pollMs: POLL })

describe('boardHealth', () => {
  it('reports connecting before the first successful load', () => {
    // Nothing has ever arrived — this is not a stale board, it is a new one.
    expect(at(10_000, null)).toBe('connecting')
  })

  it('reports live immediately after a successful refresh', () => {
    expect(at(10_000, 10_000)).toBe('live')
  })

  it('tolerates a single dropped poll without alarming the kitchen', () => {
    // One blip is genuinely transient; crying wolf every hiccup trains staff to
    // ignore the indicator, which costs us the one time it matters.
    expect(at(10_000 + POLL, 10_000)).toBe('live')
  })

  it('still reports live at the edge of the tolerance window', () => {
    expect(at(10_000 + POLL * STALE_AFTER_POLLS, 10_000)).toBe('live')
  })

  it('reports stale once the feed has been failing beyond the tolerance window', () => {
    // The #1766 failure mode: the feed is permanently broken and the board
    // must stop presenting itself as current.
    expect(at(10_000 + POLL * (STALE_AFTER_POLLS + 1), 10_000)).toBe('stale')
  })

  it('reports stale after a long outage', () => {
    expect(at(10_000 + 60 * 60 * 1000, 10_000)).toBe('stale')
  })

  it('recovers to live as soon as a refresh succeeds again', () => {
    const recovered = at(100_000, 100_000)
    expect(recovered).toBe('live')
  })

  it('never reports stale for a clock that jumps backwards', () => {
    // A device whose clock resyncs must not flip the board to stale; treat a
    // negative age as fresh rather than enormous.
    expect(at(10_000, 20_000)).toBe('live')
  })

  it('scales its tolerance with the poll interval, not a hardcoded duration', () => {
    // A board polling slowly is not stale merely for polling slowly.
    const slow = boardHealth({ now: 10_000 + 30_000, lastOkAt: 10_000, pollMs: 30_000 })
    expect(slow).toBe('live')
  })
})
