// Which Dropbox file each track plays (#2229) — lets the Mac-side audio script match its
// per-file analysis to tracks. Kept out of the library payload, which the phone loads.
import { and, eq, isNotNull } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  return useDB().select({ id: crateTracks.id, audioPath: crateTracks.audioPath })
    .from(crateTracks).where(and(eq(crateTracks.teamId, team.id), isNotNull(crateTracks.audioPath)))
})
