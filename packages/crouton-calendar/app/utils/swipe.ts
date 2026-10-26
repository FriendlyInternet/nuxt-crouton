/**
 * Decide whether a finished touch drag is a horizontal swipe (#2485).
 * Returns 'next' for a leftward swipe, 'prev' for rightward, or null when the
 * drag is too short or too vertical (so a slightly diagonal page scroll never
 * changes the week).
 */
export function swipeDirection(dx: number, dy: number, threshold = 50): 'next' | 'prev' | null {
  if (Math.abs(dx) < threshold) return null
  if (Math.abs(dx) < Math.abs(dy) * 2) return null
  return dx < 0 ? 'next' : 'prev'
}

/**
 * Lock a drag to an axis once it has moved far enough to tell (#2515).
 * Returns null while still undecided so the strip doesn't twitch on a tap.
 */
export function lockAxis(dx: number, dy: number, lockAfter = 10): 'x' | 'y' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < lockAfter) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}
