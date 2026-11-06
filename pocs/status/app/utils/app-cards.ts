// Card ordering for the Apps tab. `app` is null for the General card, which sorts last on ties.
export function sortAppCards<T extends { app: string | null, toTest: unknown[] }>(cards: T[]): T[] {
  return [...cards].sort((a, b) =>
    b.toTest.length - a.toTest.length
    || (a.app === null ? 1 : 0) - (b.app === null ? 1 : 0)
    || (a.app ?? '').localeCompare(b.app ?? '')
  )
}
