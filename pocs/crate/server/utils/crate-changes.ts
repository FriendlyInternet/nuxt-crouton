// Tag and pile writes + persistent undo (#2208/#2209/#2211). Every write records before/after,
// grouped per user action, so undo survives reloads. A row touches either a track (its tags) or a
// pile (its name + place; `null` = the pile doesn't exist), never both.
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { crateTracks, crateChanges, cratePiles } from '~~/server/db/schema'
import type { PileRow, PileSnap, PileWrite, TagWrite } from './crate-pile-ops'

export type { PileWrite, TagWrite }
interface Actor { teamId: string, userId: string }
export interface ChangeResult { groupId: string, tracks: TagWrite[], piles: PileRow[], removedPileIds: string[] }

// D1 caps a statement at 100 bound parameters (HANDOFF gotchas): chunk every IN (...) list.
const IN_CHUNK = 90
// And a Worker invocation at ~1000 queries: send writes as batches instead of one by one.
const BATCH = 50

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function run(statements: unknown[]) {
  const db = useDB() as unknown as { batch?: (s: unknown[]) => Promise<unknown> }
  for (const part of chunks(statements, BATCH)) {
    if (typeof db.batch === 'function') await db.batch(part)
    else for (const s of part) await s
  }
}

async function currentTags(teamId: string, trackIds: string[]) {
  const map = new Map<string, string[]>()
  for (const ids of chunks(trackIds, IN_CHUNK)) {
    const rows = await useDB().select({ id: crateTracks.id, tags: crateTracks.tags }).from(crateTracks)
      .where(and(eq(crateTracks.teamId, teamId), inArray(crateTracks.id, ids)))
    for (const r of rows as { id: string, tags: string[] | null }[]) map.set(r.id, r.tags ?? [])
  }
  return map
}

export async function loadPiles(teamId: string): Promise<PileRow[]> {
  const rows = await useDB().select({ id: cratePiles.id, name: cratePiles.name, parentId: cratePiles.parentId, order: cratePiles.order })
    .from(cratePiles).where(eq(cratePiles.teamId, teamId))
  return (rows as PileRow[]).map(p => ({ ...p, parentId: p.parentId ?? null }))
}

export async function loadTrackTags(teamId: string) {
  const rows = await useDB().select({ id: crateTracks.id, tags: crateTracks.tags }).from(crateTracks).where(eq(crateTracks.teamId, teamId))
  return (rows as { id: string, tags: string[] | null }[]).map(r => ({ id: r.id, tags: r.tags ?? [] }))
}

/** Keep the generated tree columns (`path`, `depth`) in step with `parentId` after pile writes. */
async function syncTreePaths(teamId: string) {
  const rows = await useDB().select({ id: cratePiles.id, parentId: cratePiles.parentId, path: cratePiles.path, depth: cratePiles.depth })
    .from(cratePiles).where(eq(cratePiles.teamId, teamId)) as { id: string, parentId: string | null, path: string, depth: number }[]
  const byId = new Map(rows.map(r => [r.id, r]))
  const stale = rows.flatMap((r) => {
    const chain: string[] = []
    for (let p: typeof r | undefined = r; p && !chain.includes(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) chain.unshift(p.id)
    const path = `/${chain.join('/')}/`
    const depth = chain.length - 1
    return r.path === path && r.depth === depth ? [] : [{ id: r.id, path, depth }]
  })
  await run(stale.map(s => useDB().update(cratePiles).set({ path: s.path, depth: s.depth })
    .where(and(eq(cratePiles.teamId, teamId), eq(cratePiles.id, s.id)))))
}

// Re-create first (an undone remove: its sub-piles move back into it), remove last.
function rank(w: PileWrite, existing: Map<string, PileRow>) {
  if (!w.after) return 2
  return existing.has(w.pileId) ? 1 : 0
}

/** Write new tags and/or pile states as ONE undoable action. */
export async function writeChanges(
  actor: Actor,
  change: { tracks?: TagWrite[], piles?: PileWrite[] },
  summary: string,
  undoOf: string | null = null
): Promise<ChangeResult> {
  const db = useDB()
  const groupId = nanoid()
  const audit = { teamId: actor.teamId, owner: actor.userId, createdBy: actor.userId, updatedBy: actor.userId }
  const statements: unknown[] = []

  const trackWrites = change.tracks ?? []
  const beforeTags = await currentTags(actor.teamId, trackWrites.map(w => w.trackId))
  const applied = trackWrites.filter(w => beforeTags.has(w.trackId))
  for (const w of applied) {
    statements.push(db.update(crateTracks).set({ tags: w.tags, updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(crateTracks.teamId, actor.teamId), eq(crateTracks.id, w.trackId))))
    statements.push(db.insert(crateChanges).values({ ...audit, groupId, trackId: w.trackId, before: beforeTags.get(w.trackId), after: w.tags, summary, undoOf }))
  }

  const pileWrites = change.piles ?? []
  const beforePiles = new Map((pileWrites.length ? await loadPiles(actor.teamId) : []).map(p => [p.id, p]))
  const ordered = [...pileWrites].sort((a, b) => rank(a, beforePiles) - rank(b, beforePiles))
  for (const w of ordered) {
    const prev = beforePiles.get(w.pileId)
    if (!w.after && !prev) continue
    const before: PileSnap | null = prev ? { name: prev.name, parentId: prev.parentId, order: prev.order } : null
    const where = and(eq(cratePiles.teamId, actor.teamId), eq(cratePiles.id, w.pileId))
    if (!w.after) statements.push(db.delete(cratePiles).where(where))
    else if (prev) statements.push(db.update(cratePiles).set({ ...w.after, updatedBy: actor.userId }).where(where))
    else statements.push(db.insert(cratePiles).values({ ...audit, id: w.pileId, ...w.after }))
    statements.push(db.insert(crateChanges).values({ ...audit, groupId, trackId: null, pileId: w.pileId, before, after: w.after, summary, undoOf }))
  }

  await run(statements)
  if (pileWrites.length) await syncTreePaths(actor.teamId)

  const touched = new Set(pileWrites.filter(w => w.after).map(w => w.pileId))
  return {
    groupId,
    tracks: applied,
    piles: touched.size ? (await loadPiles(actor.teamId)).filter(p => touched.has(p.id)) : [],
    removedPileIds: pileWrites.filter(w => !w.after).map(w => w.pileId)
  }
}

/** Write new tags for one or more tracks as ONE undoable action. */
export function writeTags(actor: Actor, writes: TagWrite[], summary: string) {
  return writeChanges(actor, { tracks: writes }, summary)
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
  return writeChanges(actor, {
    tracks: rows.filter(r => r.trackId).map(r => ({ trackId: r.trackId!, tags: (r.before ?? []) as string[] })),
    piles: rows.filter(r => r.pileId).map(r => ({ pileId: r.pileId!, after: (r.before ?? null) as PileSnap | null }))
  }, summary, last.groupId)
}
