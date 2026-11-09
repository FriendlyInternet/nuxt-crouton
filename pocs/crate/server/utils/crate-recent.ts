// The "Recent changes" list (#2209): crate_changes rows folded into one entry per user action.
export interface ChangeRow { groupId: string, trackId: string | null, pileId: string | null, summary: string | null, undoOf: string | null, createdAt: Date | number }
export interface RecentChange { groupId: string, summary: string, at: number, trackId: string | null, undone: boolean, isUndo: boolean }

const ms = (d: Date | number) => (d instanceof Date ? d.getTime() : d < 1e12 ? d * 1000 : d)

/** Newest first. `rows` may arrive in any order. An action is `undone` once a later undo points at it. */
export function groupRecentChanges(rows: ChangeRow[], limit = 30): RecentChange[] {
  const undone = new Set(rows.map(r => r.undoOf).filter((g): g is string => !!g))
  const groups = new Map<string, RecentChange>()
  for (const r of rows) {
    const at = ms(r.createdAt)
    const g = groups.get(r.groupId)
    if (!g) {
      groups.set(r.groupId, { groupId: r.groupId, summary: r.summary ?? 'Change', at, trackId: r.trackId, undone: undone.has(r.groupId), isUndo: !!r.undoOf })
      continue
    }
    g.at = Math.max(g.at, at)
    g.trackId ??= r.trackId
  }
  return [...groups.values()].sort((a, b) => b.at - a.at).slice(0, limit)
}
