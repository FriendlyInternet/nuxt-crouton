/**
 * KDS board health (#1766).
 *
 * The kitchen display polls its feed on a timer and, on failure, deliberately
 * keeps the last board on screen:
 *
 *     catch {
 *       // Transient blip — keep the last board until the next poll.
 *     }
 *
 * That is right for one dropped packet and catastrophic for a persistent error.
 * When the feed fails for good — which is what the D1 bound-parameter bug caused
 * past ~100 orders — staff keep reading a frozen board with no error, no empty
 * state and no spinner, and have no way to tell it stopped being true.
 *
 * Keeping the last board is still the right behaviour. Presenting it as LIVE is
 * not. This is the rule behind a visible indicator: tolerate a blip, then say so.
 */

export type BoardHealth =
  /** Nothing has arrived yet — a new board, not a stale one. */
  | 'connecting'
  /** The feed is current, or has missed few enough polls to be a blip. */
  | 'live'
  /** The feed has been failing long enough that the board can't be trusted. */
  | 'stale'

/**
 * Missed polls tolerated before the board is called stale. Crying wolf at every
 * hiccup trains staff to ignore the indicator, which costs us the one time it
 * actually matters.
 */
export const STALE_AFTER_POLLS = 3

export function boardHealth(input: {
  now: number
  /** When the feed last returned successfully; null before the first load. */
  lastOkAt: number | null
  /** The board's poll interval, so tolerance scales with it. */
  pollMs: number
}): BoardHealth {
  if (input.lastOkAt == null) return 'connecting'

  // A device whose clock resyncs backwards must not flip the board to stale, so
  // a negative age counts as fresh rather than enormous.
  const age = input.now - input.lastOkAt
  return age <= input.pollMs * STALE_AFTER_POLLS ? 'live' : 'stale'
}
