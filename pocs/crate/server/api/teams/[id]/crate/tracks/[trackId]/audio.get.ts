// Stream a track: rekordbox tracks redirect to a short-lived Dropbox link (#2207);
// uploaded tracks stream from crate's own storage with Range support (#2237).
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { BLOB_PREFIX, serveUpload } from '~~/server/utils/crate-uploads'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const [track] = await useDB().select({ audioPath: crateTracks.audioPath }).from(crateTracks)
    .where(and(eq(crateTracks.teamId, team.id), eq(crateTracks.id, trackId!))).limit(1)
  if (!track) throw createError({ status: 404, statusText: 'Track not found' })
  if (!track.audioPath) throw createError({ status: 404, statusText: 'No audio for this track' })
  if (track.audioPath.startsWith(BLOB_PREFIX)) return serveUpload(event, track.audioPath.slice(BLOB_PREFIX.length))
  return sendRedirect(event, await dropboxTemporaryLink(track.audioPath), 302)
})
