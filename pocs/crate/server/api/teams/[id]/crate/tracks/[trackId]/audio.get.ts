// Stream a track: redirect the <audio> element to a short-lived Dropbox link (#2207).
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const [track] = await useDB().select({ audioPath: crateTracks.audioPath }).from(crateTracks)
    .where(and(eq(crateTracks.teamId, team.id), eq(crateTracks.id, trackId!))).limit(1)
  if (!track) throw createError({ status: 404, statusText: 'Track not found' })
  if (!track.audioPath) throw createError({ status: 404, statusText: 'No audio for this track' })
  return sendRedirect(event, await dropboxTemporaryLink(track.audioPath), 302)
})
