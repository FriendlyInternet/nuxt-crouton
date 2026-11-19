/** Recent-changes `@pick`: put that track on the deck, or say it is gone. */
export function pickRecentTrack<T extends { id: string }>(
  id: string,
  tracks: readonly T[],
  put: (track: T) => void,
  gone: () => void
) {
  const track = tracks.find(x => x.id === id)
  if (track) put(track)
  else gone()
}
