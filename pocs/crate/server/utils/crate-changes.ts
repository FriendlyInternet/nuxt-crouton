// Tag writes + persistent undo (#2208/#2209). Every write records before/after per track,
// grouped per user action, so undo survives reloads.
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { crateTracks, crateChanges } from '~~/server/db/schema'

interface Actor { teamId: string, userId: string }
export interface TagWrite { trackId: string, tags: string[] }

async function currentTags(teamId: string, trackIds: string[]) {
  const rows = await useDB().select({ id: crateTracks.id, tags: crateTracks.tags }).from(crateTracks)
    .where(and(eq(crateTracks.teamId, teamId), inArray(crateTracks.id, trackIds)))
  return new Map((rows as { id: string, tags: string[] | null }[]).map(r => [r.id, r.tags ?? []]))
}

/** Write new tags for one or more tracks as ONE undoable action. */
export async function writeTags(actor: Actor, writes: TagWrite[], summary: string, undoOf: string | null = null) {
  const db = useDB()
  const before = await currentTags(actor.teamId, writes.map(w => w.trackId))
  const groupId = nanoid()
  const audit = { teamId: actor.teamId, owner: actor.userId, createdBy: actor.userId, updatedBy: actor.userId }
  const applied: TagWrite[] = []
  for (const w of writes) {
    if (!before.has(w.trackId)) continue
    await db.update(crateTracks).set({ tags: w.tags, updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(crateTracks.teamId, actor.teamId), eq(crateTracks.id, w.trackId)))
    await db.insert(crateChanges).values({ ...audit, groupId, trackId: w.trackId, before: before.get(w.trackId), after: w.tags, summary, undoOf })
    applied.push(w)
  }
  return { groupId, tracks: applied }
}

/** Revert the newest action that hasn't been undone yet (undos themselves aren't undone). */
export async function undoLast(actor: Actor) {
  const db = useDB()
  const undone = db.select({ g: crateChanges.undoOf }).from(crateChanges)
    .where(and(eq(crateChanges.teamId, actor.teamId), isNotNull(crateChanges.undoOf)))
  const [last] = await db.select({ groupId: crateChanges.groupId, at: sql<number>`max(${crateChanges.createdAt})` })
    .from(crateChanges)
    .where(and(eq(crateChanges.teamId, actor.teamId), isNull(crateChanges.undoOf), notInArray(crateChanges.groupId, undone)))
    .groupBy(crateChanges.groupId)
    .orderBy(desc(sql`max(${crateChanges.createdAt})`), desc(sql`max(rowid)`))
    .limit(1)
  if (!last) return null
  const rows: (typeof crateChanges.$inferSelect)[] = await db.select().from(crateChanges)
    .where(and(eq(crateChanges.teamId, actor.teamId), eq(crateChanges.groupId, last.groupId)))
  const summary = `Undo: ${rows[0]?.summary ?? ''}`.trim()
  return writeTags(actor, rows.map((r: typeof crateChanges.$inferSelect) => ({ trackId: r.trackId, tags: (r.before ?? []) as string[] })), summary, last.groupId)
}
