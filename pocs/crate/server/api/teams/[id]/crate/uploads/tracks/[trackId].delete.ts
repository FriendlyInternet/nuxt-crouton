// Delete an uploaded track (#2237): its file, its genre tips and its undo history go with it,
// so undo can never point at a track that no longer exists.
import { and, eq } from 'drizzle-orm'
import { crateTracks, crateLookups, crateChanges } from '~~/server/db/schema'
import { deleteUpload } from '~~/server/utils/crate-uploads'
import { requireUploadedTrack } from '~~/server/utils/crate-upload-track'

export default defineEventHandler(async (event) => {
  const { team, track, blobKey } = await requireUploadedTrack(event)
  const db = useDB()
  await db.delete(crateChanges).where(and(eq(crateChanges.teamId, team.id), eq(crateChanges.trackId, track.id)))
  await db.delete(crateLookups).where(and(eq(crateLookups.teamId, team.id), eq(crateLookups.trackId, track.id)))
  await db.delete(crateTracks).where(eq(crateTracks.id, track.id))
  if (blobKey) await deleteUpload(event, blobKey)
  return { deleted: track.id }
})
