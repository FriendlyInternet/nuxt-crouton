// The next inbox tracks for the web research agent (#2229): untagged, no agent tip yet, newest
// first, with the facts the agent searches from. Read by scripts/research.mjs on the Mac.
import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateLookups, crateTracks } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const limit = Math.min(Number(getQuery(event).limit) || 25, 200)
  const db = useDB()
  const researched = db.select({ id: crateLookups.trackId }).from(crateLookups)
    .where(and(eq(crateLookups.teamId, team.id), sql`${crateLookups.results} like '%"source":"Agent"%'`))
  return db.select({
    id: crateTracks.id, name: crateTracks.name, artist: crateTracks.artist, album: crateTracks.album,
    label: crateTracks.label, genre: crateTracks.genre, year: crateTracks.year, bpm: crateTracks.bpm,
    tonality: crateTracks.tonality, location: crateTracks.location, comments: crateTracks.originalComments
  }).from(crateTracks)
    .where(and(
      eq(crateTracks.teamId, team.id),
      // The inbox: no tags yet, or only the NEW marker.
      sql`(${crateTracks.tags} is null or ${crateTracks.tags} in ('[]', '["NEW"]'))`,
      notInArray(crateTracks.id, researched)
    ))
    .orderBy(desc(crateTracks.dateAdded)).limit(limit)
})
