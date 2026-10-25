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
