// Which Dropbox file each track plays (#2229) — lets the Mac-side audio script match its
// per-file analysis to tracks. Kept out of the library payload, which the phone loads.
// Uploaded tracks (#2237) aren't on the Mac yet, so they're left out.
import { and, eq, isNotNull, notLike } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { BLOB_PREFIX } from '~~/server/utils/crate-uploads'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  return useDB().select({ id: crateTracks.id, audioPath: crateTracks.audioPath })
    .from(crateTracks).where(and(eq(crateTracks.teamId, team.id), isNotNull(crateTracks.audioPath), notLike(crateTracks.audioPath, `${BLOB_PREFIX}%`)))
})
