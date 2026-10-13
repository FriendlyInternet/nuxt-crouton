// Bulk import from the Mac-side script (scripts/import.mjs, #2206).
// Idempotent: tracks upsert by rekordboxId, lookups by track, piles seed only into an empty tree.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks, cratePiles, crateLookups } from '~~/server/db/schema'

const trackSchema = z.object({
  rekordboxId: z.string().min(1),
  name: z.string().min(1),
  artist: z.string().nullish(),
  album: z.string().nullish(),
  genre: z.string().nullish(),
  year: z.number().int().nullish(),
  bpm: z.number().nullish(),
  tonality: z.string().nullish(),
  durationSec: z.number().int().nullish(),
  label: z.string().nullish(),
  dateAdded: z.coerce.date().nullish(),
  location: z.string().min(1),
  audioPath: z.string().nullish(),
  originalComments: z.string().nullish(),
  /** Initial tags: the XML comments, or a prototype re-tag (edits.json). */
  tags: z.array(z.string())
})

const pileSchema = z.object({ key: z.string(), name: z.string().min(1), parentKey: z.string().nullish(), order: z.number().int() })

const lookupSchema = z.object({ rekordboxId: z.string(), fetchedAt: z.coerce.date(), results: z.any() })

const bodySchema = z.object({
  tracks: z.array(trackSchema).max(500).default([]),
  piles: z.array(pileSchema).max(1000).default([]),
  lookups: z.array(lookupSchema).max(500).default([])
})

// D1 caps a query at 100 bound parameters — size every multi-row statement from its column count.
const MAX_PARAMS = 100
const chunk = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))
const rowsPerInsert = (columns: number) => Math.max(1, Math.floor(MAX_PARAMS / columns))

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDB()
  const audit = { owner: user.id, createdBy: user.id, updatedBy: user.id, teamId: team.id }

  // Map existing rekordboxId → row (in parameter-safe chunks)
  async function existingTracks(ids: string[]) {
    const found = new Map<string, { id: string, tags: string[] | null, originalComments: string | null }>()
    for (const part of chunk(ids, MAX_PARAMS - 1)) {
      const rows = await db.select({ id: crateTracks.id, rekordboxId: crateTracks.rekordboxId, tags: crateTracks.tags, originalComments: crateTracks.originalComments })
        .from(crateTracks).where(and(eq(crateTracks.teamId, team.id), inArray(crateTracks.rekordboxId, part)))
      for (const r of rows) found.set(r.rekordboxId, r)
    }
    return found
  }

  // ── Tracks ── tags are owned by the app once edited there: only (re)take the imported tags
  // when the stored tags still equal what the last import's Comments said.
  let tracksInserted = 0, tracksUpdated = 0, tagsKept = 0
  if (body.tracks.length) {
    const existing = await existingTracks(body.tracks.map(t => t.rekordboxId))
    const rows = body.tracks.map((t) => {
      const prev = existing.get(t.rekordboxId)
      if (!prev) tracksInserted++
      else tracksUpdated++
      const untouched = !prev || sameTags(prev.tags, splitComments(prev.originalComments))
      if (!untouched) tagsKept++
      return { ...audit, ...t, tags: untouched ? t.tags : prev!.tags }
    })
    const columns = Object.keys(rows[0]!).length + 3 // + id, createdAt, updatedAt
    for (const part of chunk(rows, rowsPerInsert(columns))) {
      await db.insert(crateTracks).values(part).onConflictDoUpdate({
        target: [crateTracks.teamId, crateTracks.rekordboxId],
        set: {
          name: sql`excluded.name`, artist: sql`excluded.artist`, album: sql`excluded.album`, genre: sql`excluded.genre`,
          year: sql`excluded.year`, bpm: sql`excluded.bpm`, tonality: sql`excluded.tonality`, durationSec: sql`excluded.durationSec`,
          label: sql`excluded.label`, dateAdded: sql`excluded.dateAdded`, location: sql`excluded.location`,
          audioPath: sql`excluded.audioPath`, originalComments: sql`excluded.originalComments`, tags: sql`excluded.tags`,
          updatedBy: user.id, updatedAt: new Date()
        }
      })
    }
  }

  // ── Piles ── seed the tree once (never overwrite the owner's reorganising)
  let pilesInserted = 0
  if (body.piles.length) {
    const [any] = await db.select({ id: cratePiles.id }).from(cratePiles).where(eq(cratePiles.teamId, team.id)).limit(1)
    if (!any) {
      const byKey = new Map(body.piles.map(p => [p.key, p]))
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
      for (const p of body.piles) place(p.key)
      for (const part of chunk(rows, rowsPerInsert(Object.keys(rows[0]!).length + 2))) {
        await db.insert(cratePiles).values(part)
      }
      pilesInserted = rows.length
    }
  }

  // ── Lookups ── cached genre hints, keyed by the app's track id
  let lookupsUpserted = 0
  if (body.lookups.length) {
    const tracks = await existingTracks(body.lookups.map(l => l.rekordboxId))
    const rows = body.lookups.flatMap((l) => {
      const t = tracks.get(l.rekordboxId)
      return t ? [{ ...audit, trackId: t.id, fetchedAt: l.fetchedAt, results: l.results }] : []
    })
    if (rows.length) {
      for (const part of chunk(rows, rowsPerInsert(Object.keys(rows[0]!).length + 3))) {
        await db.insert(crateLookups).values(part).onConflictDoUpdate({
          target: [crateLookups.teamId, crateLookups.trackId],
          set: { fetchedAt: sql`excluded.fetchedAt`, results: sql`excluded.results`, updatedBy: user.id, updatedAt: new Date() }
        })
      }
    }
    lookupsUpserted = rows.length
  }

  return { tracksInserted, tracksUpdated, tagsKept, pilesInserted, lookupsUpserted }
})
