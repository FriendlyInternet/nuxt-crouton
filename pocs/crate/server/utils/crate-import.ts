// Bulk-import steps behind POST /api/teams/:id/crate/import (#2206).
import { and, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { crateTracks, cratePiles, crateLookups } from '~~/server/db/schema'

export interface ImportAudit { teamId: string, owner: string, createdBy: string, updatedBy: string }
type TrackIn = Omit<typeof crateTracks.$inferInsert, keyof ImportAudit | 'id' | 'createdAt' | 'updatedAt'> & { tags: string[] }
export interface PileIn { key: string, name: string, parentKey?: string | null, order: number }
export interface LookupIn { rekordboxId: string, fetchedAt: Date, results: unknown }

// D1 caps a query at 100 bound parameters — size every statement from its column count.
const MAX_PARAMS = 100
const chunk = <T>(rows: T[], size: number) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))
// `generatedColumns`: ids/timestamps drizzle adds per row; `fixedParams`: params bound once
// per statement (e.g. the values in an onConflictDoUpdate `set`).
const rowsPerInsert = (row: object, generatedColumns: number, fixedParams = 0) =>
  Math.max(1, Math.floor((MAX_PARAMS - fixedParams) / (Object.keys(row).length + generatedColumns)))

async function existingTracks(teamId: string, rekordboxIds: string[]) {
  const db = useDB()
  const found = new Map<string, { id: string, tags: string[] | null, originalComments: string | null }>()
  for (const part of chunk(rekordboxIds, MAX_PARAMS - 1)) {
    const rows = await db.select({ id: crateTracks.id, rekordboxId: crateTracks.rekordboxId, tags: crateTracks.tags, originalComments: crateTracks.originalComments })
      .from(crateTracks).where(and(eq(crateTracks.teamId, teamId), inArray(crateTracks.rekordboxId, part)))
    for (const r of rows) found.set(r.rekordboxId, r)
  }
  return found
}

/** Upsert by rekordboxId. Tags are the app's once edited there: the imported tags only
 *  replace stored tags that still equal what the previous import's Comments said. */
export async function upsertTracks(audit: ImportAudit, tracks: TrackIn[]) {
  if (!tracks.length) return { tracksInserted: 0, tracksUpdated: 0, tagsKept: 0 }
  const existing = await existingTracks(audit.teamId, tracks.map(t => t.rekordboxId))
  let tagsKept = 0
  const rows = tracks.map((t) => {
    const prev = existing.get(t.rekordboxId)
    if (prev && !sameTags(prev.tags, splitComments(prev.originalComments))) {
      tagsKept++
      return { ...audit, ...t, tags: prev.tags }
    }
    return { ...audit, ...t }
  })
  const db = useDB()
  for (const part of chunk(rows, rowsPerInsert(rows[0]!, 3, 2))) {
    await db.insert(crateTracks).values(part).onConflictDoUpdate({
      target: [crateTracks.teamId, crateTracks.rekordboxId],
      set: {
        name: sql`excluded.name`, artist: sql`excluded.artist`, album: sql`excluded.album`, genre: sql`excluded.genre`,
        year: sql`excluded.year`, bpm: sql`excluded.bpm`, tonality: sql`excluded.tonality`, durationSec: sql`excluded.durationSec`,
        label: sql`excluded.label`, dateAdded: sql`excluded.dateAdded`, location: sql`excluded.location`,
        audioPath: sql`excluded.audioPath`, originalComments: sql`excluded.originalComments`, tags: sql`excluded.tags`,
        updatedBy: audit.updatedBy, updatedAt: new Date()
      }
    })
  }
  return { tracksInserted: tracks.length - existing.size, tracksUpdated: existing.size, tagsKept }
}

/** Seed the pile tree once — never overwrite the owner's reorganising. */
export async function seedPiles(audit: ImportAudit, piles: PileIn[]) {
  const db = useDB()
  if (!piles.length) return { pilesInserted: 0 }
  const [anyPile] = await db.select({ id: cratePiles.id }).from(cratePiles).where(eq(cratePiles.teamId, audit.teamId)).limit(1)
  if (anyPile) return { pilesInserted: 0 }

  const byKey = new Map(piles.map(p => [p.key, p]))
  const placed = new Map<string, { id: string, path: string, depth: number }>()
  const rows: (typeof cratePiles.$inferInsert)[] = []
  const place = (key: string): { id: string, path: string, depth: number } => {
    const hit = placed.get(key)
    if (hit) return hit
    const p = byKey.get(key)!
    const parent = p.parentKey && byKey.has(p.parentKey) ? place(p.parentKey) : null
    const id = nanoid()
    const node = { id, path: `${parent?.path ?? '/'}${id}/`, depth: parent ? parent.depth + 1 : 0 }
    placed.set(key, node)
    rows.push({ ...audit, id, name: p.name, parentId: parent?.id ?? null, path: node.path, depth: node.depth, order: p.order })
    return node
  }
  piles.forEach(p => place(p.key))
  for (const part of chunk(rows, rowsPerInsert(rows[0]!, 2))) await db.insert(cratePiles).values(part)
  return { pilesInserted: rows.length }
}

/** Cached genre hints, keyed by the app's track id. */
export async function upsertLookups(audit: ImportAudit, lookups: LookupIn[]) {
  if (!lookups.length) return { lookupsUpserted: 0 }
  const tracks = await existingTracks(audit.teamId, lookups.map(l => l.rekordboxId))
  const rows = lookups.flatMap((l) => {
    const t = tracks.get(l.rekordboxId)
    return t ? [{ ...audit, trackId: t.id, fetchedAt: l.fetchedAt, results: l.results }] : []
  })
  const db = useDB()
  for (const part of chunk(rows, rows.length ? rowsPerInsert(rows[0]!, 3, 2) : 1)) {
    await db.insert(crateLookups).values(part).onConflictDoUpdate({
      target: [crateLookups.teamId, crateLookups.trackId],
      set: { fetchedAt: sql`excluded.fetchedAt`, results: sql`excluded.results`, updatedBy: audit.updatedBy, updatedAt: new Date() }
    })
  }
  return { lookupsUpserted: rows.length }
}

/** Put one source's result into each track's lookup, keeping every other source's entry. */
export async function mergeLookupSource(audit: ImportAudit, source: string, tips: { trackId: string, result: Record<string, unknown> }[]) {
  if (!tips.length) return { tipsMerged: 0 }
  const db = useDB()
  const existing = new Map<string, unknown[]>()
  for (const part of chunk(tips.map(t => t.trackId), MAX_PARAMS - 1)) {
    const rows = await db.select({ trackId: crateLookups.trackId, results: crateLookups.results }).from(crateLookups)
      .where(and(eq(crateLookups.teamId, audit.teamId), inArray(crateLookups.trackId, part)))
    for (const r of rows) existing.set(r.trackId, (r.results as unknown[] | null) ?? [])
  }
  const now = new Date()
  const rows = tips.map(t => ({
    ...audit,
    trackId: t.trackId,
    fetchedAt: now,
    results: [...(existing.get(t.trackId) ?? []).filter(r => (r as { source?: string }).source !== source), { ...t.result, source }]
  }))
  for (const part of chunk(rows, rowsPerInsert(rows[0]!, 3, 2))) {
    await db.insert(crateLookups).values(part).onConflictDoUpdate({
      target: [crateLookups.teamId, crateLookups.trackId],
      set: { fetchedAt: sql`excluded.fetchedAt`, results: sql`excluded.results`, updatedBy: audit.updatedBy, updatedAt: now }
    })
  }
  return { tipsMerged: rows.length }
}
