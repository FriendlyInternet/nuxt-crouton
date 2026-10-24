// Everything the deck needs in one request: the pile tree + every track (compact). ~6.5k rows.
import { asc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks, cratePiles } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const [piles, tracks] = await Promise.all([
    db.select({ id: cratePiles.id, name: cratePiles.name, parentId: cratePiles.parentId, order: cratePiles.order })
      .from(cratePiles).where(eq(cratePiles.teamId, team.id)).orderBy(asc(cratePiles.order)),
    db.select({
      id: crateTracks.id, name: crateTracks.name, artist: crateTracks.artist,
      genre: crateTracks.genre, year: crateTracks.year, bpm: crateTracks.bpm, tonality: crateTracks.tonality,
      durationSec: crateTracks.durationSec, audioPath: crateTracks.audioPath, tags: crateTracks.tags
    }).from(crateTracks).where(eq(crateTracks.teamId, team.id)).orderBy(asc(crateTracks.dateAdded))
  ])
  return {
    piles,
    tracks: (tracks as (Omit<typeof crateTracks.$inferSelect, 'tags'> & { tags: string[] | null })[]).map(({ audioPath, ...t }) => ({ ...t, tags: (t.tags ?? []) as string[], hasAudio: !!audioPath }))
  }
})
