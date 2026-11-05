/** Split a rekordbox Comments string into tags: `"90s & Indie Rock, PMCP"` → `['90s & Indie Rock', 'PMCP']`. */
export function splitComments(comments: string | null | undefined): string[] {
  return (comments ?? '').split(',').map(t => t.trim()).filter(Boolean)
}

export function sameTags(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((t, i) => t === y[i])
}
