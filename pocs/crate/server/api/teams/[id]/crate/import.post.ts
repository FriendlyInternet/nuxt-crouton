// Bulk import from the Mac-side script (scripts/import.mjs, #2206).
// Idempotent: tracks upsert by rekordboxId, lookups by track, piles seed only into an empty tree.
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

const bodySchema = z.object({
  tracks: z.array(z.object({
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
    /** Initial tags: the XML Comments, or a prototype re-tag (edits.json). */
    tags: z.array(z.string())
  })).max(500).default([]),
  piles: z.array(z.object({ key: z.string(), name: z.string().min(1), parentKey: z.string().nullish(), order: z.number().int() })).max(1000).default([]),
  lookups: z.array(z.object({ rekordboxId: z.string(), fetchedAt: z.coerce.date(), results: z.any() })).max(500).default([])
})

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const audit = { teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id }
  return {
    ...await seedPiles(audit, body.piles),
    ...await upsertTracks(audit, body.tracks),
    ...await upsertLookups(audit, body.lookups)
  }
})
