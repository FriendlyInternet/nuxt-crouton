import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { crateChanges } from '../db/schema'

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

/** The handler's read: newest `limit` actions for one team. Windows by action (not row), so a 300-track rename can't crowd out the rest. */
export async function readRecentChanges(db: any, teamId: string, limit = 30): Promise<RecentChange[]> {
  const at = sql<number>`max(${crateChanges.createdAt})`
  // rowid breaks ties: createdAt is whole seconds, so two actions in one second share it.
  const seq = sql<number>`max(${crateChanges}.rowid)`
  const heads: { groupId: string }[] = await db.select({ groupId: crateChanges.groupId }).from(crateChanges)
    .where(eq(crateChanges.teamId, teamId)).groupBy(crateChanges.groupId).orderBy(desc(at), desc(seq)).limit(limit)
  if (!heads.length) return []
  const ids = heads.map(h => h.groupId)
  const rows: ChangeRow[] = await db.select({
    groupId: crateChanges.groupId,
    trackId: crateChanges.trackId,
    pileId: crateChanges.pileId,
    summary: crateChanges.summary,
    undoOf: crateChanges.undoOf,
    createdAt: crateChanges.createdAt
  }).from(crateChanges).where(and(eq(crateChanges.teamId, teamId), inArray(crateChanges.groupId, ids)))
  const folded = groupRecentChanges(rows, limit)
  const order = new Map(ids.map((g, i) => [g, i]))
  return folded.sort((a, b) => order.get(a.groupId)! - order.get(b.groupId)!)
}
