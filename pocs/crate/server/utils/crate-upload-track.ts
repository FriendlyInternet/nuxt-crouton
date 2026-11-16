// Find one uploaded track (#2237) for the rename/delete endpoints. Tracks that came from
// rekordbox are refused: their name and file belong to rekordbox, not to crate.
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { BLOB_PREFIX, UPLOAD_ID_PREFIX } from '~~/server/utils/crate-uploads'

export async function requireUploadedTrack(event: H3Event) {
  const { team } = await resolveTeamAndCheckMembership(event)
  const trackId = getRouterParam(event, 'trackId') ?? ''
  const [track] = await useDB().select({ id: crateTracks.id, rekordboxId: crateTracks.rekordboxId, audioPath: crateTracks.audioPath })
    .from(crateTracks).where(and(eq(crateTracks.teamId, team.id), eq(crateTracks.id, trackId))).limit(1)
  if (!track) throw createError({ status: 404, statusText: 'Track not found' })
  if (!track.rekordboxId.startsWith(UPLOAD_ID_PREFIX)) throw createError({ status: 403, statusText: 'Only uploads can be changed here' })
  return { team, track, blobKey: track.audioPath?.startsWith(BLOB_PREFIX) ? track.audioPath.slice(BLOB_PREFIX.length) : null }
}
